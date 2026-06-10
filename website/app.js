const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const supabaseClient = window.supabase ? window.supabase.createClient(
  window.JOBVISTO_CONFIG?.supabaseUrl || "",
  window.JOBVISTO_CONFIG?.supabaseAnonKey || ""
) : null;

// Supabase Data Integration Helpers
async function loadStateFromSupabase(currentUser = null) {
  if (!supabaseClient) return;
  try {
    let user = currentUser;
    if (!user) {
      const { data } = await supabaseClient.auth.getUser();
      user = data?.user;
    }
    if (!user) return;
    state.user = user;

    // Fetch profile
    const { data: profile } = await supabaseClient.from('profiles').select('*').eq('id', user.id).maybeSingle();
    if (profile) {
      state.companyProfile.ownerName = profile.full_name || state.companyProfile.ownerName;
      state.companyProfile.email = profile.email || state.companyProfile.email;
      state.companyProfile.phone = profile.phone || state.companyProfile.phone;
    }

    // Fetch membership
    const { data: memberships } = await supabaseClient.from('organization_members').select('*').eq('user_id', user.id).eq('status', 'active');
    if (memberships && memberships.length > 0) {
      const orgId = memberships[0].organization_id;
      state.orgId = orgId;

      // Fetch organization details
      const { data: org } = await supabaseClient.from('organizations').select('*').eq('id', orgId).maybeSingle();
      if (org) {
        state.mode = org.type;
        state.country = org.country;
        state.companyProfile.businessName = org.name;
        selectedPlan = normalizePlanKey(org.plan_id);
      }

      // Fetch clients
      const { data: clients } = await supabaseClient.from('clients').select('*').eq('organization_id', orgId);
      if (clients) {
        state.clients = clients.map(c => ({
          id: c.id,
          name: c.name,
          phone: c.phone || "",
          email: c.email || "",
          address: "",
          country: state.country || "IL",
          paymentMethod: c.default_payment_method === 'cash' ? 'Efectivo' : 'Transferencia',
          notes: c.notes || ""
        }));
      }

      // Fetch client addresses
      const { data: addresses } = await supabaseClient.from('client_addresses').select('*').eq('organization_id', orgId);
      if (addresses) {
        state.clients.forEach(c => {
          const addr = addresses.find(a => a.client_id === c.id);
          if (addr) {
            c.address = addr.address_line;
            if (addr.country) c.country = addr.country;
          }
        });
      }

      // Fetch cleaners
      const { data: cleaners } = await supabaseClient.from('cleaners').select('*').eq('organization_id', orgId);
      if (cleaners) {
        state.cleaners = cleaners.map(c => ({
          id: c.id,
          name: c.name,
          phone: c.phone || "",
          email: c.email || "",
          status: c.status === 'available' ? 'Disponible' : 'Ocupada',
          key: c.access_key,
          country: c.country || state.country || "IL",
          city: c.city || "Zona principal"
        }));
      }

      // Fetch job evidence
      const { data: evidence } = await supabaseClient.from('job_evidence').select('*').eq('organization_id', orgId);

      // Fetch client signatures
      const { data: signatures } = await supabaseClient.from('client_signatures').select('*').eq('organization_id', orgId);

      // Fetch jobs
      const { data: jobs } = await supabaseClient.from('jobs').select('*').eq('organization_id', orgId);
      if (jobs) {
        state.jobs = jobs.map(j => {
          const dateStr = j.scheduled_start ? j.scheduled_start.slice(0, 10) : today();
          // Extract time or default
          const startStr = j.scheduled_start ? new Date(j.scheduled_start).toISOString().slice(11, 16) : "08:00";
          const endStr = j.scheduled_end ? new Date(j.scheduled_end).toISOString().slice(11, 16) : "12:00";
          const actualEndStr = j.actual_end ? new Date(j.actual_end).toISOString().slice(11, 16) : "";
          
          const jobEvidence = evidence ? evidence.filter(e => e.job_id === j.id).map(e => ({
            id: e.id,
            section: e.area,
            phase: e.phase === 'before' ? 'Antes' : 'Despues',
            comment: e.caption || "",
            url: e.file_path,
            createdAt: e.created_at
          })) : [];

          const jobSignatures = signatures ? signatures.filter(s => s.job_id === j.id) : [];
          const siteSig = jobSignatures.find(s => s.signed_from === 'cleaner_device');
          const clientSig = jobSignatures.find(s => s.signed_from === 'private_link') || jobSignatures[0];

          return {
            id: j.id,
            clientId: j.client_id,
            cleanerId: j.assigned_cleaner_id || "",
            date: dateStr,
            start: startStr,
            end: endStr,
            actualEnd: actualEndStr,
            serviceType: j.service_type || "Limpieza normal",
            rate: Number(j.client_hourly_rate || 65),
            extras: Number(j.extras_amount || 0),
            status: j.status === 'scheduled' ? 'Asignado' : 
                    j.status === 'open' ? 'Disponible para tomar' : 
                    j.status === 'in_site' ? 'En progreso' :
                    j.status === 'cleaner_finished' ? 'Terminado por cleaner' :
                    j.status === 'client_confirmed' ? 'Confirmado por cliente' :
                    j.status === 'signed' ? 'Firmado' : j.status,
            tasks: j.checklist || [],
            checkedIn: j.status === 'in_site' || j.status === 'cleaner_finished' || j.status === 'client_confirmed' || j.status === 'signed',
            checkedOut: j.status === 'cleaner_finished' || j.status === 'client_confirmed' || j.status === 'signed' || jobSignatures.length > 0,
            cleanerFinished: j.status === 'cleaner_finished' || j.status === 'client_confirmed' || j.status === 'signed' || jobSignatures.length > 0,
            clientConfirmed: j.status === 'client_confirmed' || j.status === 'signed' || clientSig !== undefined,
            signed: j.status === 'client_confirmed' || j.status === 'signed' || jobSignatures.length > 0,
            siteSignature: siteSig ? siteSig.signature_data : "",
            siteSignerName: siteSig ? siteSig.signer_name : "",
            clientSignature: clientSig ? clientSig.signature_data : "",
            evidence: jobEvidence,
            photos: jobEvidence.length
          };
        });
      }

      // Fetch receipts
      const { data: receipts } = await supabaseClient.from('payment_receipts').select('*').eq('organization_id', orgId);
      if (receipts) {
        state.receipts = receipts.map(r => ({
          id: r.id,
          cleanerId: r.cleaner_id,
          cleaner: state.cleaners.find(c => c.id === r.cleaner_id)?.name || 'Cleaner',
          amount: Number(r.amount),
          method: r.payment_method === 'cash' ? 'Efectivo' : 'Transferencia',
          period: `${r.period_start} - ${r.period_end}`,
          status: r.status === 'draft' ? 'pending_signature' : 'signed',
          signature: r.receiver_signature_data,
          date: new Date(r.paid_at).toLocaleDateString('es')
        }));
      }

      // Fetch organization settings
      const { data: settings } = await supabaseClient.from('organization_settings').select('*').eq('organization_id', orgId);
      if (settings) {
        const vatSetting = settings.find(s => s.key === 'vat_rate');
        if (vatSetting) {
          state.vatRate = Number(vatSetting.value?.rate !== undefined ? vatSetting.value.rate : 18);
        }
        const currencySetting = settings.find(s => s.key === 'currency_symbol');
        if (currencySetting) {
          state.currencySymbol = currencySetting.value?.symbol || (state.country === 'IL' ? '₪' : '$');
        }
      }
    }
  } catch (e) {
    console.error("Error loading state from Supabase: ", e);
  }
}

function isUuid(str) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

function ensureValidUuids() {
  const idMap = {};
  
  // Clients
  state.clients.forEach(c => {
    if (!isUuid(c.id)) {
      const newId = crypto.randomUUID();
      idMap[c.id] = newId;
      c.id = newId;
    }
  });

  // Cleaners
  state.cleaners.forEach(c => {
    if (!isUuid(c.id)) {
      const newId = crypto.randomUUID();
      idMap[c.id] = newId;
      c.id = newId;
    }
  });

  // Jobs
  state.jobs.forEach(j => {
    if (!isUuid(j.id)) {
      j.id = crypto.randomUUID();
    }
    if (idMap[j.clientId]) {
      j.clientId = idMap[j.clientId];
    }
    if (idMap[j.cleanerId]) {
      j.cleanerId = idMap[j.cleanerId];
    }
  });

  // Receipts
  state.receipts.forEach(r => {
    if (!isUuid(r.id)) {
      r.id = crypto.randomUUID();
    }
    if (idMap[r.cleanerId]) {
      r.cleanerId = idMap[r.cleanerId];
    }
  });
}

async function asyncSaveToSupabase() {
  if (!supabaseClient || !state.orgId || !state.user) return;
  try {
    ensureValidUuids();

    // 1. Sync profile
    await supabaseClient.from('profiles').upsert({
      id: state.user.id,
      full_name: state.companyProfile.ownerName,
      email: state.companyProfile.email,
      phone: state.companyProfile.phone,
      preferred_language: state.language
    });

    // 2. Sync organization details
    await supabaseClient.from('organizations').update({
      name: state.companyProfile.businessName,
      type: state.mode,
      country: state.country,
      default_language: state.language
    }).eq('id', state.orgId);

    // 3. Clean up deleted clients
    const currentClientIds = state.clients.map(c => c.id).filter(Boolean);
    if (currentClientIds.length > 0) {
      const formattedIds = currentClientIds.map(id => `'${id}'`).join(',');
      await supabaseClient.from('clients').delete().eq('organization_id', state.orgId).not('id', 'in', `(${formattedIds})`);
    } else {
      await supabaseClient.from('clients').delete().eq('organization_id', state.orgId);
    }

    // 4. Sync clients & addresses
    for (const client of state.clients) {
      await supabaseClient.from('clients').upsert({
        id: client.id,
        organization_id: state.orgId,
        name: client.name,
        phone: client.phone,
        email: client.email,
        preferred_language: state.language || 'es',
        default_payment_method: client.paymentMethod === 'Efectivo' ? 'cash' : 'transfer',
        notes: client.notes
      });

      if (client.address) {
        await supabaseClient.from('client_addresses').upsert({
          organization_id: state.orgId,
          client_id: client.id,
          address_line: client.address,
          country: client.country || state.country || 'IL'
        }, { onConflict: 'client_id' });
      }
    }

    // 5. Clean up deleted cleaners
    const currentCleanerIds = state.cleaners.map(c => c.id).filter(Boolean);
    if (currentCleanerIds.length > 0) {
      const formattedIds = currentCleanerIds.map(id => `'${id}'`).join(',');
      await supabaseClient.from('cleaners').delete().eq('organization_id', state.orgId).not('id', 'in', `(${formattedIds})`);
    } else {
      await supabaseClient.from('cleaners').delete().eq('organization_id', state.orgId);
    }

    // 6. Sync cleaners
    for (const cleaner of state.cleaners) {
      await supabaseClient.from('cleaners').upsert({
        id: cleaner.id,
        organization_id: state.orgId,
        name: cleaner.name,
        phone: cleaner.phone,
        email: cleaner.email,
        access_key: cleaner.key,
        status: cleaner.status === 'Disponible' ? 'available' : 'busy',
        country: cleaner.country || state.country || 'IL',
        city: cleaner.city || 'Zona principal',
        language: state.language || 'es'
      });
    }

    // 7. Clean up deleted jobs
    const currentJobIds = state.jobs.map(j => j.id).filter(Boolean);
    if (currentJobIds.length > 0) {
      const formattedIds = currentJobIds.map(id => `'${id}'`).join(',');
      await supabaseClient.from('jobs').delete().eq('organization_id', state.orgId).not('id', 'in', `(${formattedIds})`);
    } else {
      await supabaseClient.from('jobs').delete().eq('organization_id', state.orgId);
    }

    // 8. Sync jobs
    for (const job of state.jobs) {
      const scheduledStart = `${job.date}T${job.start || "08:00"}:00Z`;
      const scheduledEnd = job.end ? `${job.date}T${job.end}:00Z` : null;
      const actualEnd = job.actualEnd ? `${job.date}T${job.actualEnd}:00Z` : null;
      
      const dbStatus = job.status === 'Asignado' ? 'scheduled' :
                       job.status === 'Disponible para tomar' ? 'open' :
                       (job.status === 'En progreso' || job.status === 'En sitio') ? 'in_site' :
                       job.status === 'Terminado por cleaner' ? 'cleaner_finished' :
                       job.status === 'Confirmado por cliente' ? 'client_confirmed' :
                       job.status === 'Firmado' ? 'signed' : job.status;

      await supabaseClient.from('jobs').upsert({
        id: job.id,
        organization_id: state.orgId,
        client_id: job.clientId,
        assigned_cleaner_id: job.cleanerId || null,
        service_type: job.serviceType,
        scheduled_start: scheduledStart,
        scheduled_end: scheduledEnd,
        actual_end: actualEnd,
        client_hourly_rate: job.rate,
        extras_amount: job.extras,
        status: dbStatus,
        checklist: job.tasks
      });

      // Sync signatures
      if (job.siteSignature) {
        await supabaseClient.from('client_signatures').delete().eq('job_id', job.id).eq('signed_from', 'cleaner_device');
        await supabaseClient.from('client_signatures').insert({
          organization_id: state.orgId,
          job_id: job.id,
          signer_name: job.siteSignerName || 'Persona en sitio',
          signature_data: job.siteSignature,
          signed_from: 'cleaner_device'
        });
      }

      if (job.clientSignature) {
        await supabaseClient.from('client_signatures').delete().eq('job_id', job.id).eq('signed_from', 'private_link');
        await supabaseClient.from('client_signatures').insert({
          organization_id: state.orgId,
          job_id: job.id,
          signer_name: 'Cliente',
          signature_data: job.clientSignature,
          signed_from: 'private_link'
        });
      }

      // Sync job evidence
      if (Array.isArray(job.evidence)) {
        for (const ev of job.evidence) {
          const dbPhase = ev.phase === 'Antes' ? 'before' : 'after';
          await supabaseClient.from('job_evidence').upsert({
            id: ev.id,
            organization_id: state.orgId,
            job_id: job.id,
            area: ev.section || 'General',
            phase: dbPhase,
            file_path: ev.url,
            caption: ev.comment || ''
          });
        }
      }
    }

    // 9. Clean up deleted job evidence
    const currentEvidenceIds = state.jobs.flatMap(j => (j.evidence || []).map(e => e.id)).filter(Boolean);
    if (currentEvidenceIds.length > 0) {
      const formattedIds = currentEvidenceIds.map(id => `'${id}'`).join(',');
      await supabaseClient.from('job_evidence').delete().eq('organization_id', state.orgId).not('id', 'in', `(${formattedIds})`);
    } else {
      await supabaseClient.from('job_evidence').delete().eq('organization_id', state.orgId);
    }

    // 10. Clean up deleted payment receipts
    const currentReceiptIds = state.receipts.map(r => r.id).filter(Boolean);
    if (currentReceiptIds.length > 0) {
      const formattedIds = currentReceiptIds.map(id => `'${id}'`).join(',');
      await supabaseClient.from('payment_receipts').delete().eq('organization_id', state.orgId).not('id', 'in', `(${formattedIds})`);
    } else {
      await supabaseClient.from('payment_receipts').delete().eq('organization_id', state.orgId);
    }

    // 11. Sync receipts
    for (const receipt of state.receipts) {
      const [start, end] = receipt.period ? receipt.period.split(" - ") : [today(), today()];
      await supabaseClient.from('payment_receipts').upsert({
        id: receipt.id,
        organization_id: state.orgId,
        cleaner_id: receipt.cleanerId || state.cleaners.find(c => c.name === receipt.cleaner)?.id,
        period_start: start,
        period_end: end,
        amount: receipt.amount,
        payment_method: receipt.method === 'Efectivo' ? 'cash' : 'transfer',
        receiver_signature_data: receipt.signature,
        status: receipt.status === 'signed' ? 'signed' : 'draft'
      });
    }

    // 12. Sync organization settings (vat_rate and currency_symbol)
    await supabaseClient.from('organization_settings').upsert({
      organization_id: state.orgId,
      key: 'vat_rate',
      value: { rate: state.vatRate }
    });
    await supabaseClient.from('organization_settings').upsert({
      organization_id: state.orgId,
      key: 'currency_symbol',
      value: { symbol: state.currencySymbol }
    });
  } catch (e) {
    console.error("Error saving state to Supabase: ", e);
  }
}

const pageParams = new URLSearchParams(location.search);

function normalizePlanKey(plan) {
  const value = String(plan || "").toLowerCase();
  if (["free", "freelancer", "freelancer-free", "freelancer free"].includes(value)) return "free";
  if (["solo", "independent", "independiente"].includes(value)) return "independent";
  if (["starter", "empresa-starter", "empresa starter", "company", "empresa"].includes(value)) return "company";
  if (["pro", "empresa-pro", "empresa pro"].includes(value)) return "pro";
  return "";
}

const state = {
  mode: pageParams.get("mode") || localStorage.getItem("jobvisto-mode") || "independent",
  country: localStorage.getItem("jobvisto-country") || "IL",
  language: localStorage.getItem("jobvisto-language") || "es",
  companyProfile: JSON.parse(localStorage.getItem("jobvisto-company-profile") || "null") || {
    businessName: "JobVisto Cleaning",
    ownerName: "Miguel",
    greetingName: "Miguel",
    phone: "+972 50 000 0000",
    email: "admin@jobvisto.demo",
    address: "Tel Aviv, Israel",
    photo: ""
  },
  user: null,
  clients: JSON.parse(localStorage.getItem("jobvisto-clients") || "null") || [
    { id: "c1", name: "Casa Cohen", phone: "+972 50 111 2222", email: "cohen@email.com", address: "Herzl 42, Tel Aviv", paymentMethod: "Efectivo", notes: "Codigo 2418. Cliente prefiere fotos grandes." },
    { id: "c2", name: "Oficina North", phone: "+972 50 333 4444", email: "office@email.com", address: "HaYarkon 18, Tel Aviv", paymentMethod: "Transferencia", notes: "Limpiar sala de reuniones primero." }
  ],
  cleaners: JSON.parse(localStorage.getItem("jobvisto-cleaners") || "null") || [
    { id: "cl1", name: "Maria Lopez", phone: "+972 50 777 1000", email: "maria@jobvisto.demo", status: "Disponible", key: "JV-MARIA" },
    { id: "cl2", name: "Rina Katz", phone: "+972 50 777 2000", email: "rina@jobvisto.demo", status: "Ocupada", key: "JV-RINA" }
  ],
  jobs: JSON.parse(localStorage.getItem("jobvisto-jobs") || "null") || [
    { id: "j1", clientId: "c1", cleanerId: "cl1", date: today(), start: "08:00", end: "12:00", serviceType: "Limpieza normal", rate: 65, status: "En progreso", photos: 2, signed: false, checkedIn: true, checkedOut: false, tasks: ["Cocina", "Banos", "Pisos"] },
    { id: "j2", clientId: "c2", cleanerId: "", date: today(), start: "13:00", end: "16:00", serviceType: "Oficina", rate: 75, status: "Disponible para tomar", photos: 0, signed: false, checkedIn: false, checkedOut: false, tasks: ["Escritorios", "Banos", "Basura"] },
    { id: "j3", clientId: "c1", cleanerId: "cl2", date: addDays(1), start: "09:30", end: "11:30", serviceType: "Deep cleaning", rate: 85, status: "Programado", photos: 0, signed: false, checkedIn: false, checkedOut: false, tasks: ["Horno", "Ventanas", "Ducha"] }
  ],
  receipts: JSON.parse(localStorage.getItem("jobvisto-receipts") || "[]"),
  serviceRules: JSON.parse(localStorage.getItem("jobvisto-service-rules") || "null") || {
    "Limpieza normal": 60,
    "Deep cleaning": 95,
    "Oficina": 75,
    "Antes de Shabat": 85,
    "Urgente": 110,
    "Proyecto / primera visita": 0
  },
  clientPriceRules: JSON.parse(localStorage.getItem("jobvisto-client-price-rules") || "[]"),
  costRules: JSON.parse(localStorage.getItem("jobvisto-cost-rules") || "null") || {
    generalCleanerRate: 50,
    generalServiceRates: {},
    specialCleanerRate: 60,
    specialCleaner: "Maria Lopez",
    specialRules: [
      { id: "cr1", cleanerId: "cl1", cleanerName: "Maria Lopez", rate: 60, mode: "replace" }
    ]
  },
  vatRate: Number(localStorage.getItem("jobvisto-vat-rate") !== null ? localStorage.getItem("jobvisto-vat-rate") : 18),
  currencySymbol: localStorage.getItem("jobvisto-currency-symbol") || (localStorage.getItem("jobvisto-country") === "IL" ? "₪" : "$")
};

if (state.companyProfile?.ownerName === "Alex Morgan") {
  state.companyProfile.ownerName = "Miguel";
}
if (state.companyProfile?.greetingName === "Alex" || state.companyProfile?.greetingName === "Alex Morgan") {
  state.companyProfile.greetingName = "Miguel";
}

let selectedAuthMode = state.mode;
const stripePaymentReturn = ["success", "paid"].includes(String(pageParams.get("payment") || pageParams.get("stripe") || "").toLowerCase());
let selectedAuthAction = pageParams.get("intent") === "signup" || pageParams.get("plan") || stripePaymentReturn ? "signup" : "login";
let selectedPlan = normalizePlanKey(pageParams.get("plan")) || (state.mode === "company" ? "company" : "free");
let verificationSent = false;
let calendarCursor = new Date();
let expandedJobId = null;
let signingReceiptId = null;
let signingJobId = null;
let pendingDeleteJobId = null;
let pendingArchiveCleanerId = null;
let pendingArchiveClientId = null;
let pendingDeleteReceiptId = null;
let signaturePad = null;
let portalClientId = null;
let portalCleanerId = null;
let portalCleanerAdmin = false;
let cleanerHistoryAdminUnlocked = false;
let cleanerHistoryAdminExpiresAt = 0;
let cleanerHistoryAdminTimer = null;
let cleanerReportMonth = "";
const ADMIN_CLEANER_KEY = "JV-ADMIN";
const HISTORY_ADMIN_PERMISSION_MS = 60 * 60 * 1000;

normalizeCostRules();

const countries = {
  IL: { name: "Israel", dial: "+972", currency: "ILS" },
  PT: { name: "Portugal", dial: "+351", currency: "EUR" },
  US: { name: "Estados Unidos", dial: "+1", currency: "USD" },
  EC: { name: "Ecuador", dial: "+593", currency: "USD" },
  ES: { name: "Espana", dial: "+34", currency: "EUR" },
  CO: { name: "Colombia", dial: "+57", currency: "COP" },
  MX: { name: "Mexico", dial: "+52", currency: "MXN" }
};

const dialCodes = {
  AD: "+376", AE: "+971", AF: "+93", AG: "+1", AI: "+1", AL: "+355", AM: "+374", AO: "+244", AR: "+54", AT: "+43", AU: "+61", AW: "+297", AZ: "+994",
  BA: "+387", BB: "+1", BD: "+880", BE: "+32", BF: "+226", BG: "+359", BH: "+973", BI: "+257", BJ: "+229", BM: "+1", BN: "+673", BO: "+591", BR: "+55", BS: "+1", BT: "+975", BW: "+267", BY: "+375", BZ: "+501",
  CA: "+1", CD: "+243", CF: "+236", CG: "+242", CH: "+41", CI: "+225", CL: "+56", CM: "+237", CN: "+86", CO: "+57", CR: "+506", CU: "+53", CV: "+238", CY: "+357", CZ: "+420",
  DE: "+49", DJ: "+253", DK: "+45", DM: "+1", DO: "+1", DZ: "+213", EC: "+593", EE: "+372", EG: "+20", ER: "+291", ES: "+34", ET: "+251",
  FI: "+358", FJ: "+679", FR: "+33", GA: "+241", GB: "+44", GD: "+1", GE: "+995", GH: "+233", GI: "+350", GM: "+220", GN: "+224", GQ: "+240", GR: "+30", GT: "+502", GW: "+245", GY: "+592",
  HK: "+852", HN: "+504", HR: "+385", HT: "+509", HU: "+36", ID: "+62", IE: "+353", IL: "+972", IN: "+91", IQ: "+964", IR: "+98", IS: "+354", IT: "+39",
  JM: "+1", JO: "+962", JP: "+81", KE: "+254", KG: "+996", KH: "+855", KM: "+269", KN: "+1", KR: "+82", KW: "+965", KY: "+1", KZ: "+7",
  LA: "+856", LB: "+961", LC: "+1", LI: "+423", LK: "+94", LR: "+231", LS: "+266", LT: "+370", LU: "+352", LV: "+371", LY: "+218",
  MA: "+212", MC: "+377", MD: "+373", ME: "+382", MG: "+261", MK: "+389", ML: "+223", MM: "+95", MN: "+976", MO: "+853", MR: "+222", MT: "+356", MU: "+230", MV: "+960", MW: "+265", MX: "+52", MY: "+60", MZ: "+258",
  NA: "+264", NE: "+227", NG: "+234", NI: "+505", NL: "+31", NO: "+47", NP: "+977", NZ: "+64", OM: "+968",
  PA: "+507", PE: "+51", PG: "+675", PH: "+63", PK: "+92", PL: "+48", PR: "+1", PS: "+970", PT: "+351", PY: "+595",
  QA: "+974", RO: "+40", RS: "+381", RU: "+7", RW: "+250", SA: "+966", SC: "+248", SD: "+249", SE: "+46", SG: "+65", SI: "+386", SK: "+421", SL: "+232", SN: "+221", SO: "+252", SR: "+597", SV: "+503", SY: "+963",
  TH: "+66", TJ: "+992", TN: "+216", TR: "+90", TT: "+1", TW: "+886", TZ: "+255", UA: "+380", UG: "+256", US: "+1", UY: "+598", UZ: "+998",
  VA: "+39", VE: "+58", VN: "+84", ZA: "+27", ZM: "+260", ZW: "+263"
};

const plans = {
  free: { name: "Freelancer Free", price: "$0/mes", mode: "independent" },
  independent: { name: "Independent", price: "$9.99/mes", mode: "independent" },
  company: { name: "Company", price: "$29.99/mes", mode: "company" },
  pro: { name: "Pro", price: "$59.99/mes", mode: "company" }
};

const stripePaymentLinks = {
  independent: "https://buy.stripe.com/dRmfZh20RcvVcAuedT2ZO0o",
  company: "https://buy.stripe.com/eVq8wP8pfbrR1VQ8Tz2ZO0p",
  pro: "https://buy.stripe.com/cNifZh7lb9jJfMG8Tz2ZO0q"
};

const demoAccounts = {
  "admin@jobvisto.com": {
    mode: "company",
    name: "Altiora Cleaning",
    plan: "pro",
    password: "JobVisto2026!"
  },
  "maria@jobvisto.demo": {
    mode: "independent",
    name: "Maria Lopez",
    plan: "independent",
    password: "JobVisto2026!"
  }
};

const i18n = {
  en: {
    authEyebrow: "Private access",
    authTitle: "Manage cleaning jobs, evidence and signatures from today.",
    authCopy: "Log in if you already have an account, or register to activate your plan with email verification and secure payment.",
    login: "Log in",
    signup: "Register",
    password: "Password",
    accountCountry: "Account country",
    independent: "Independent",
    company: "Company",
    fullName: "Full name",
    fullNamePlaceholder: "Name and last name",
    companyName: "Company name",
    companyNamePlaceholder: "Only if applicable",
    phone: "Phone",
    phonePlaceholder: "Contact number",
    plan: "Plan",
    emailVerification: "Email verification",
    emailVerificationCopy: "First we confirm that the email belongs to the client. In production, a real email will be sent.",
    sendCode: "Send code",
    receivedCode: "Received code",
    securePayment: "Secure payment",
    stripeCopy: "After email verification, the client goes to Stripe. When payment is approved, access is activated and the password is delivered.",
    payStripe: "Go to Stripe checkout",
    paymentReturnTitle: "Payment received",
    paymentReturnCopy: "Complete your account details to activate JobVisto with the plan you just paid for.",
    createAccount: "Create account and activate",
    fineprint: "Real payment will connect with Stripe. This screen prepares the registration, verification and activation flow.",
    cleanerArrived: "Cleaner arrived",
    cleanerArrivedCopy: "Client notified, GPS saved and job in progress.",
    tomorrowJobs: "3 jobs tomorrow",
    authPlatformKicker: "All in one platform",
    authVisualTitle: "Total control of your cleaning company, in real time.",
    authVisualPoint1: "Clients, cleaners and jobs organized",
    authVisualPoint2: "Photo evidence and digital signatures",
    authVisualPoint3: "Reports and metrics in real time",
    authVisualPoint4: "Access from any device",
    excellent: "Excellent",
    ratingCopy: "4.8 out of 5 from 200+ reviews",
    secureReliable: "Safe and reliable",
    secureReliableCopy: "Your data is protected",
    access247: "24/7 access",
    access247Copy: "From anywhere and any device",
    manyUsers: "Thousands of users",
    manyUsersCopy: "Cleaning companies already trust JobVisto",
    dedicatedSupport: "Dedicated support",
    dedicatedSupportCopy: "We are ready to help you",
    rememberMe: "Remember me",
    forgotPassword: "Forgot your password?",
    dashboard: "Dashboard",
    clients: "Clients",
    cleaners: "Cleaners",
    calendar: "Calendar",
    jobs: "Jobs",
    clientLinks: "Client links",
    reports: "Reports",
    payments: "Payments",
    settings: "Settings",
    logout: "Log out",
    newJob: "New job",
    newClient: "New client",
    dashboardGreeting: "Good morning, Miguel! 👋",
    dashboardSubtitle: "Here's what's happening with your business today.",
    searchPlaceholder: "Search anything...",
    administrator: "Administrator",
    operationalSummary: "Operational summary",
    todayJobs: "Today's jobs",
    completedJobs: "Completed jobs",
    completedHours: "Completed hours",
    estimatedRevenue: "Revenue",
    activeClients: "Active clients",
    activeCleaners: "Active cleaners",
    pendingSignatures: "Pending signatures",
    thisWeek: "this week",
    thisMonth: "this month",
    needConfirmation: "need confirmation",
    today: "Today",
    live: "Live",
    quickActions: "Quick actions",
    todaysSchedule: "Today's schedule",
    viewAllJobs: "View all jobs",
    jobsMap: "Jobs map",
    jobsScheduled: "Jobs scheduled",
    inProgress: "In progress",
    completed: "completed",
    recentActivity: "Recent activity",
    viewAll: "View all",
    growBusiness: "Grow your cleaning business",
    growBusinessCopy: "Save time, get more clients, and increase your revenue with JobVisto.",
    exploreFeatures: "Explore features",
    uploadedPhotos: "uploaded photos",
    paymentReceived: "Payment received",
    newClientRegistered: "New client registered",
    unassigned: "Unassigned",
    createClient: "Create client",
    registerCleaner: "Register cleaner",
    createJob: "Create job",
    viewJobProgress: "View job progress",
    viewConsolidated: "View consolidated",
    signupGoogle: "Register with Google",
    continueGoogle: "Continue with Google",
    microsoft: "Microsoft",
    microsoftSoon: "Microsoft access will be available soon.",
    orContinue: "or continue with",
    continuePayment: "Continue to payment",
    selectedPlan: "Selected plan",
    companyMode: "Company",
    independentMode: "Independent",
    liveJobs: "live jobs",
    dayAgenda: "day agenda",
    noJobsToday: "no jobs today",
    closedThisMonth: "closed this month",
    noLiveAgenda: "No live jobs or agenda for today.",
    job: "job",
    jobsWord: "jobs",
    inLiveNow: "live now",
    agendaToday: "on today's agenda",
    noScheduledToday: "No jobs scheduled today",
    doneThisMonth: "done this month",
    registeredNotCounted: "registered, not counted yet",
    real: "real",
    operationalAlert: "operational alert",
    registered: "registered",
    signaturesPending: "pending signatures",
    planned: "planned",
    editJob: "Edit job",
    delete: "Delete",
    signed: "signed",
    signaturePending: "signature pending",
    clientPrivatePortal: "Client private portal",
    clientAccessEyebrow: "Secure client portal",
    clientAccessTrust1: "Private link",
    clientAccessTrust2: "Service evidence",
    clientAccessTrust3: "Client confirmation",
    clientAccessTitle: "Client access",
    clientAccessCopy: "Enter the password sent by the company or cleaner to view jobs, photos and confirmations.",
    portalPassword: "Portal password",
    portalPasswordPlaceholder: "Example: JV-CAS-c1",
    clientPortalEnter: "Enter portal",
    clientLabel: "Client",
    privateServiceSummary: "Private service summary",
    currentService: "Current/upcoming service",
    serviceStatus: "Service status",
    cleanerArrival: "Cleaner arrival",
    cleanerDeparture: "Cleaner departure",
    visiblePhotos: "Visible photos",
    cleanerFinished: "Cleaner marked finished",
    clientConfirmation: "Client confirmation",
    clientSignature: "Client signature",
    onsiteSignature: "On-site signature",
    checklist: "Checklist",
    pending: "pending",
    yes: "yes",
    confirmed: "confirmed",
    signedBy: "signed by",
    onsitePerson: "person on site",
    noActiveJobs: "no active jobs",
    portalHistoryAvailable: "This portal remains available to review service history.",
    noActiveService: "No active service",
    serviceConfirmed: "Service confirmed",
    confirmServiceCompleted: "Confirm service completed",
    serviceHistory: "Service history",
    evidence: "Evidence",
    noEvidenceYet: "No real photos have been uploaded for this job yet.",
    noClosedJobsHistory: "There are no closed jobs in the history yet.",
    noComment: "No comment",
    viewLarge: "view large",
    correct: "Correct",
    before: "Before",
    after: "After",
    dateLabel: "Date",
    photoSingular: "photo",
    photoPlural: "photos",
    undefinedTime: "to define",
    confirmedByClient: "confirmed by client",
    noClientConfirmation: "no client confirmation",
    adminAccess: "Admin access",
    readOnly: "read only",
    status: "Status",
    photos: "Photos",
    cleanerCompleted: "Cleaner finished",
    clientConfirmationShort: "Client confirmation",
    onsiteSignatureReceived: "received from",
    completedJobsHistoryBelow: "Completed jobs appear below in the history.",
    confirmDeleteJob: "Are you sure you want to delete this job?",
    confirmDeletePhoto: "Are you sure you want to delete this photo?",
    confirmDeleteCostRule: "Are you sure you want to delete this special rule?",
    jobDeleted: "Job deleted.",
    photoDeleted: "Photo deleted.",
    costRuleDeleted: "Special rule deleted."
  },
  es: {
    authEyebrow: "Acceso privado",
    authTitle: "Organiza limpiezas, evidencia y firmas desde hoy.",
    authCopy: "Ingresa si ya tienes cuenta o registrate para activar tu plan con verificacion de correo y pago seguro.",
    login: "Ingresar",
    signup: "Registrarse",
    password: "Contrasena",
    accountCountry: "Pais de la cuenta",
    independent: "Independiente",
    company: "Empresa",
    fullName: "Nombre completo",
    fullNamePlaceholder: "Nombre y apellido",
    companyName: "Nombre de empresa",
    companyNamePlaceholder: "Solo si aplica",
    phone: "Telefono",
    phonePlaceholder: "Numero de contacto",
    plan: "Plan",
    emailVerification: "Verificacion de email",
    emailVerificationCopy: "Primero confirmamos que el correo pertenece al cliente. En produccion se enviara un email real.",
    sendCode: "Enviar codigo",
    receivedCode: "Codigo recibido",
    securePayment: "Pago seguro",
    stripeCopy: "Despues de verificar el email, el cliente pasa a Stripe. Al aprobarse el pago se activa el acceso y se entrega la contrasena.",
    payStripe: "Ir al pago en Stripe",
    paymentReturnTitle: "Pago recibido",
    paymentReturnCopy: "Completa los datos de tu cuenta para activar JobVisto con el plan que acabas de pagar.",
    createAccount: "Crear cuenta y activar",
    fineprint: "El pago real se conectara con Stripe. Esta pantalla deja armado el flujo de registro, verificacion y activacion.",
    cleanerArrived: "Cleaner llego",
    cleanerArrivedCopy: "Cliente notificado, GPS guardado y trabajo en progreso.",
    tomorrowJobs: "3 trabajos manana",
    authPlatformKicker: "Todo en una sola plataforma",
    authVisualTitle: "Control total de tu empresa de limpieza, en tiempo real.",
    authVisualPoint1: "Clientes, cleaners y trabajos organizados",
    authVisualPoint2: "Evidencia fotografica y firmas digitales",
    authVisualPoint3: "Reportes y metricas en tiempo real",
    authVisualPoint4: "Accede desde cualquier dispositivo",
    excellent: "Excelente",
    ratingCopy: "4.8 de 5 en 200+ resenas",
    secureReliable: "Seguro y confiable",
    secureReliableCopy: "Tus datos siempre protegidos",
    access247: "Acceso 24/7",
    access247Copy: "Desde cualquier lugar y dispositivo",
    manyUsers: "Miles de usuarios",
    manyUsersCopy: "Empresas de limpieza ya confian en JobVisto",
    dedicatedSupport: "Soporte dedicado",
    dedicatedSupportCopy: "Estamos listos para ayudarte",
    rememberMe: "Recordarme",
    forgotPassword: "Olvidaste tu contrasena?",
    dashboard: "Panel",
    clients: "Clientes",
    cleaners: "Cleaners",
    calendar: "Calendario",
    jobs: "Trabajos",
    clientLinks: "Links clientes",
    reports: "Reportes",
    payments: "Pagos",
    settings: "Ajustes",
    logout: "Salir",
    newJob: "Nuevo trabajo",
    newClient: "Nuevo cliente",
    dashboardGreeting: "Good morning, Miguel! 👋",
    dashboardSubtitle: "Here's what's happening with your business today.",
    searchPlaceholder: "Buscar algo...",
    administrator: "Administrador",
    operationalSummary: "Resumen operativo",
    todayJobs: "Trabajos de hoy",
    completedJobs: "Trabajos realizados",
    completedHours: "Horas realizadas",
    estimatedRevenue: "Ganancia real",
    activeClients: "Clientes activos",
    activeCleaners: "Cleaners activos",
    pendingSignatures: "Firmas pendientes",
    thisWeek: "esta semana",
    thisMonth: "este mes",
    needConfirmation: "requieren confirmacion",
    today: "Hoy",
    live: "En vivo",
    quickActions: "Acciones rapidas",
    todaysSchedule: "Agenda de hoy",
    viewAllJobs: "Ver todos los trabajos",
    jobsMap: "Mapa de trabajos",
    jobsScheduled: "Trabajos programados",
    inProgress: "En progreso",
    completed: "completo",
    recentActivity: "Actividad reciente",
    viewAll: "Ver todo",
    growBusiness: "Haz crecer tu empresa de limpieza",
    growBusinessCopy: "Ahorra tiempo, consigue mas clientes y aumenta tus ingresos con JobVisto.",
    exploreFeatures: "Explorar funciones",
    uploadedPhotos: "subio fotos",
    paymentReceived: "Pago recibido",
    newClientRegistered: "Nuevo cliente registrado",
    unassigned: "Sin asignar",
    createClient: "Crear cliente",
    registerCleaner: "Registrar cleaner",
    createJob: "Crear trabajo",
    viewJobProgress: "Ver progreso de trabajos",
    viewConsolidated: "Ver consolidado",
    signupGoogle: "Registrarse con Google",
    continueGoogle: "Continuar con Google",
    microsoft: "Microsoft",
    microsoftSoon: "El acceso con Microsoft estara disponible pronto.",
    orContinue: "o continuar con",
    continuePayment: "Continuar al pago",
    selectedPlan: "Plan seleccionado",
    companyMode: "Empresa",
    independentMode: "Independiente",
    liveJobs: "trabajos en vivo",
    dayAgenda: "agenda del dia",
    noJobsToday: "sin trabajos hoy",
    closedThisMonth: "cerrados este mes",
    noLiveAgenda: "No hay trabajos en vivo ni agenda para hoy.",
    job: "trabajo",
    jobsWord: "trabajos",
    inLiveNow: "en vivo ahora",
    agendaToday: "en agenda",
    noScheduledToday: "Hoy no hay trabajos programados",
    doneThisMonth: "hechos este mes",
    registeredNotCounted: "registrados sin contabilizar",
    real: "real",
    operationalAlert: "alerta operativa",
    registered: "registrados",
    signaturesPending: "firmas pendientes",
    planned: "registrado",
    editJob: "Editar trabajo",
    delete: "Eliminar",
    signed: "firmado",
    signaturePending: "firma pendiente",
    clientPrivatePortal: "Portal privado cliente",
    clientAccessEyebrow: "Portal seguro del cliente",
    clientAccessTrust1: "Link privado",
    clientAccessTrust2: "Evidencia del servicio",
    clientAccessTrust3: "Confirmacion del cliente",
    clientAccessTitle: "Acceso del cliente",
    clientAccessCopy: "Ingresa la clave que te envio la empresa o el cleaner para ver trabajos, fotos y confirmaciones.",
    portalPassword: "Clave del portal",
    portalPasswordPlaceholder: "Ejemplo: JV-CAS-c1",
    clientPortalEnter: "Entrar al portal",
    clientLabel: "Cliente",
    privateServiceSummary: "Resumen privado del servicio",
    currentService: "Servicio actual/proximo",
    serviceStatus: "Estado del servicio",
    cleanerArrival: "Llegada del cleaner",
    cleanerDeparture: "Salida del cleaner",
    visiblePhotos: "Fotos visibles",
    cleanerFinished: "Cleaner marco terminado",
    clientConfirmation: "Confirmacion del cliente",
    clientSignature: "Firma del cliente",
    onsiteSignature: "Firma en sitio",
    checklist: "Checklist",
    pending: "pendiente",
    yes: "si",
    confirmed: "confirmado",
    signedBy: "firmada por",
    onsitePerson: "persona en sitio",
    noActiveJobs: "sin trabajos activos",
    portalHistoryAvailable: "Este portal queda disponible para consultar el historial de servicios.",
    noActiveService: "Sin servicio activo",
    serviceConfirmed: "Servicio confirmado",
    confirmServiceCompleted: "Confirmo servicio completado",
    serviceHistory: "Historial de servicios",
    evidence: "Evidencia",
    noEvidenceYet: "Todavia no hay fotos reales cargadas para este trabajo.",
    noClosedJobsHistory: "Todavia no hay trabajos cerrados en el historial.",
    noComment: "Sin comentario",
    viewLarge: "ver grande",
    correct: "Corregir",
    before: "Antes",
    after: "Despues",
    dateLabel: "Fecha",
    photoSingular: "foto",
    photoPlural: "fotos",
    undefinedTime: "por definir",
    confirmedByClient: "confirmado por cliente",
    noClientConfirmation: "sin confirmacion del cliente",
    adminAccess: "Acceso admin",
    readOnly: "solo lectura",
    status: "Estado",
    photos: "Fotos",
    cleanerCompleted: "Cleaner termino",
    clientConfirmationShort: "Confirmacion cliente",
    onsiteSignatureReceived: "recibida de",
    completedJobsHistoryBelow: "Los trabajos realizados quedan abajo en historial.",
    confirmDeleteJob: "Seguro quieres eliminar este trabajo?",
    confirmDeletePhoto: "Seguro quieres eliminar esta foto?",
    confirmDeleteCostRule: "Seguro quieres eliminar esta regla especial?",
    jobDeleted: "Trabajo eliminado.",
    photoDeleted: "Foto eliminada.",
    costRuleDeleted: "Regla especial eliminada."
  },
  ru: {
    authEyebrow: "Приватный доступ",
    authTitle: "Управляйте уборками, фотоотчетами и подписями уже сегодня.",
    authCopy: "Войдите, если у вас уже есть аккаунт, или зарегистрируйтесь, чтобы активировать тариф с проверкой email и безопасной оплатой.",
    login: "Войти",
    signup: "Регистрация",
    password: "Пароль",
    accountCountry: "Страна аккаунта",
    independent: "Независимый",
    company: "Компания",
    fullName: "Полное имя",
    fullNamePlaceholder: "Имя и фамилия",
    companyName: "Название компании",
    companyNamePlaceholder: "Если применимо",
    phone: "Телефон",
    phonePlaceholder: "Контактный номер",
    plan: "Тариф",
    emailVerification: "Проверка email",
    emailVerificationCopy: "Сначала мы подтверждаем, что email принадлежит клиенту. В продакшене будет отправлено настоящее письмо.",
    sendCode: "Отправить код",
    receivedCode: "Полученный код",
    securePayment: "Безопасная оплата",
    stripeCopy: "После проверки email клиент переходит в Stripe. После оплаты доступ активируется и выдается пароль.",
    payStripe: "Перейти к оплате Stripe",
    paymentReturnTitle: "Платеж получен",
    paymentReturnCopy: "Заполните данные аккаунта, чтобы активировать JobVisto с оплаченным тарифом.",
    createAccount: "Создать аккаунт и активировать",
    fineprint: "Реальная оплата будет подключена к Stripe. Этот экран готовит регистрацию, проверку и активацию.",
    cleanerArrived: "Клинер прибыл",
    cleanerArrivedCopy: "Клиент уведомлен, GPS сохранен, работа в процессе.",
    tomorrowJobs: "3 работы завтра",
    authPlatformKicker: "Все в одной платформе",
    authVisualTitle: "Полный контроль клининговой компании в реальном времени.",
    authVisualPoint1: "Клиенты, клинеры и работы организованы",
    authVisualPoint2: "Фотоотчеты и цифровые подписи",
    authVisualPoint3: "Отчеты и метрики в реальном времени",
    authVisualPoint4: "Доступ с любого устройства",
    excellent: "Отлично",
    ratingCopy: "4.8 из 5 на основе 200+ отзывов",
    secureReliable: "Безопасно и надежно",
    secureReliableCopy: "Ваши данные защищены",
    access247: "Доступ 24/7",
    access247Copy: "Из любого места и устройства",
    manyUsers: "Тысячи пользователей",
    manyUsersCopy: "Клининговые компании уже доверяют JobVisto",
    dedicatedSupport: "Выделенная поддержка",
    dedicatedSupportCopy: "Мы готовы помочь",
    rememberMe: "Запомнить меня",
    forgotPassword: "Забыли пароль?",
    dashboard: "Панель",
    clients: "Клиенты",
    cleaners: "Клинеры",
    calendar: "Календарь",
    jobs: "Работы",
    clientLinks: "Ссылки клиентов",
    reports: "Отчеты",
    payments: "Платежи",
    settings: "Настройки",
    logout: "Выйти",
    newJob: "Новая работа",
    newClient: "Новый клиент",
    dashboardGreeting: "Доброе утро, Miguel! 👋",
    dashboardSubtitle: "Вот что происходит в вашем бизнесе сегодня.",
    searchPlaceholder: "Искать...",
    administrator: "Администратор",
    operationalSummary: "Оперативная сводка",
    todayJobs: "Работы сегодня",
    completedJobs: "Выполненные работы",
    completedHours: "Отработанные часы",
    estimatedRevenue: "Доход",
    activeClients: "Активные клиенты",
    activeCleaners: "Активные клинеры",
    pendingSignatures: "Ожидают подписи",
    thisWeek: "на этой неделе",
    thisMonth: "в этом месяце",
    needConfirmation: "нужно подтверждение",
    today: "Сегодня",
    live: "В работе",
    quickActions: "Быстрые действия",
    todaysSchedule: "Расписание на сегодня",
    viewAllJobs: "Все работы",
    jobsMap: "Карта работ",
    jobsScheduled: "Работ запланировано",
    inProgress: "В процессе",
    completed: "завершено",
    recentActivity: "Недавняя активность",
    viewAll: "Смотреть все",
    growBusiness: "Развивайте клининговый бизнес",
    growBusinessCopy: "Экономьте время, привлекайте клиентов и увеличивайте доход с JobVisto.",
    exploreFeatures: "Изучить функции",
    uploadedPhotos: "загрузил фото",
    paymentReceived: "Платеж получен",
    newClientRegistered: "Новый клиент зарегистрирован",
    unassigned: "Не назначено",
    createClient: "Создать клиента",
    registerCleaner: "Добавить клинера",
    createJob: "Создать работу",
    viewJobProgress: "Ход работ",
    viewConsolidated: "Сводный отчет",
    signupGoogle: "Регистрация через Google",
    continueGoogle: "Продолжить через Google",
    microsoft: "Microsoft",
    microsoftSoon: "Вход через Microsoft скоро будет доступен.",
    orContinue: "или продолжить через",
    continuePayment: "Перейти к оплате",
    selectedPlan: "Выбранный тариф",
    companyMode: "Компания",
    independentMode: "Независимый",
    liveJobs: "работы в процессе",
    dayAgenda: "повестка дня",
    noJobsToday: "сегодня нет работ",
    closedThisMonth: "закрыто в этом месяце",
    noLiveAgenda: "Сегодня нет работ в процессе или в расписании.",
    job: "работа",
    jobsWord: "работ",
    inLiveNow: "в процессе сейчас",
    agendaToday: "в расписании сегодня",
    noScheduledToday: "Сегодня нет запланированных работ",
    doneThisMonth: "выполнено в этом месяце",
    registeredNotCounted: "зарегистрировано, еще не учтено",
    real: "реально",
    operationalAlert: "операционная тревога",
    registered: "зарегистрировано",
    signaturesPending: "подписи ожидаются",
    planned: "запланировано",
    editJob: "Редактировать",
    delete: "Удалить",
    signed: "подписано",
    signaturePending: "подпись ожидается",
    clientPrivatePortal: "Портал клиента",
    clientAccessEyebrow: "Безопасный портал клиента",
    clientAccessTrust1: "Приватная ссылка",
    clientAccessTrust2: "Доказательства услуги",
    clientAccessTrust3: "Подтверждение клиента",
    clientAccessTitle: "Доступ клиента",
    clientAccessCopy: "Введите пароль, который отправила компания или клинер, чтобы увидеть работы, фото и подтверждения.",
    portalPassword: "Пароль портала",
    portalPasswordPlaceholder: "Пример: JV-CAS-c1",
    clientPortalEnter: "Войти в портал",
    clientLabel: "Клиент",
    privateServiceSummary: "Приватная сводка услуги",
    currentService: "Текущая/следующая услуга",
    serviceStatus: "Статус услуги",
    cleanerArrival: "Прибытие клинера",
    cleanerDeparture: "Уход клинера",
    visiblePhotos: "Видимые фото",
    cleanerFinished: "Клинер отметил завершение",
    clientConfirmation: "Подтверждение клиента",
    clientSignature: "Подпись клиента",
    onsiteSignature: "Подпись на месте",
    checklist: "Чеклист",
    pending: "ожидается",
    yes: "да",
    confirmed: "подтверждено",
    signedBy: "подписано",
    onsitePerson: "человек на месте",
    noActiveJobs: "нет активных работ",
    portalHistoryAvailable: "Этот портал остается доступным для просмотра истории услуг.",
    noActiveService: "Нет активной услуги",
    serviceConfirmed: "Услуга подтверждена",
    confirmServiceCompleted: "Подтвердить завершение услуги",
    serviceHistory: "История услуг",
    evidence: "Фотоотчет",
    noEvidenceYet: "Для этой работы пока нет реальных загруженных фото.",
    noClosedJobsHistory: "В истории пока нет закрытых работ.",
    noComment: "Без комментария",
    viewLarge: "открыть крупно",
    correct: "Исправить",
    before: "До",
    after: "После",
    dateLabel: "Дата",
    photoSingular: "фото",
    photoPlural: "фото",
    undefinedTime: "уточнить",
    confirmedByClient: "подтверждено клиентом",
    noClientConfirmation: "нет подтверждения клиента",
    adminAccess: "Доступ администратора",
    readOnly: "только просмотр",
    status: "Статус",
    photos: "Фото",
    cleanerCompleted: "Клинер завершил",
    clientConfirmationShort: "Подтверждение клиента",
    onsiteSignatureReceived: "получено от",
    completedJobsHistoryBelow: "Выполненные работы отображаются ниже в истории.",
    confirmDeleteJob: "Вы уверены, что хотите удалить эту работу?",
    confirmDeletePhoto: "Вы уверены, что хотите удалить это фото?",
    confirmDeleteCostRule: "Вы уверены, что хотите удалить это специальное правило?",
    jobDeleted: "Работа удалена.",
    photoDeleted: "Фото удалено.",
    costRuleDeleted: "Специальное правило удалено."
  }
};

function t(key, fallback = "") {
  return i18n[state.language]?.[key] || i18n.en[key] || fallback || key;
}

function applyStaticLanguage() {
  document.documentElement.lang = state.language;
  $$("[data-i18n]").forEach((node) => {
    node.textContent = t(node.dataset.i18n, node.textContent);
  });
  $$("[data-i18n-placeholder]").forEach((node) => {
    node.placeholder = t(node.dataset.i18nPlaceholder, node.placeholder);
  });
  $$("[data-language]").forEach((button) => {
    button.classList.toggle("active", button.dataset.language === state.language);
  });
  setAuthAction(selectedAuthAction);
  syncPlanSelection();
  applyStripePaymentReturnState();
}

function setLanguage(language) {
  state.language = i18n[language] ? language : "en";
  save();
  populateCountrySelect();
  applyStaticLanguage();
  renderAll();
  if (!$("#clientPortalPage").classList.contains("hidden")) {
    renderStandaloneClientPortal($("#clientPortalLock").classList.contains("hidden"));
  }
  if (!$("#cleanerPortalPage").classList.contains("hidden")) {
    renderStandaloneCleanerPortal($("#cleanerPortalLock").classList.contains("hidden"));
  }
}

function countryInfo(code) {
  const local = countries[code];
  const name = new Intl.DisplayNames([state.language || "en"], { type: "region" }).of(code) || local?.name || code;
  return { name, dial: local?.dial || dialCodes[code] || "+", currency: local?.currency || "USD" };
}

function populateCountrySelect() {
  try {
    const select = $("#accountCountry");
    if (!select && !$("#cleanerCountry")) return;
    const supported = Object.keys(dialCodes);
    
    let names;
    try {
      names = new Intl.DisplayNames([state.language || "en"], { type: "region" });
    } catch (e) {
      console.warn("Intl.DisplayNames not supported or failed:", e);
    }

    const options = supported
      .filter((code) => /^[A-Z]{2}$/.test(code))
      .map((code) => {
        let name = code;
        try {
          if (names) name = names.of(code) || code;
        } catch (e) {
          name = countries[code]?.name || code;
        }
        return { code, name, dial: dialCodes[code] || countries[code]?.dial || "+" };
      })
      .sort((a, b) => {
        try {
          return a.name.localeCompare(b.name, state.language || "en");
        } catch (e) {
          return a.name.localeCompare(b.name);
        }
      });
    const html = options.map((item) => `<option value="${item.code}">${item.name} (${item.dial})</option>`).join("");
    if (select) {
      select.innerHTML = html;
      select.value = state.country || "IL";
      if (!select.value) select.value = "IL";
    }
    const cleanerCountry = $("#cleanerCountry");
    if (cleanerCountry) {
      const current = cleanerCountry.value || state.country || "IL";
      cleanerCountry.innerHTML = html;
      cleanerCountry.value = current;
      if (!cleanerCountry.value) cleanerCountry.value = state.country || "IL";
    }
  } catch (globalError) {
    console.error("Critical error populating country select:", globalError);
  }
}

function setAuthAction(action) {
  selectedAuthAction = action;
  $$("[data-auth-action]").forEach((button) => button.classList.toggle("active", button.dataset.authAction === action));
  $("#signupFields")?.classList.toggle("hidden", action !== "signup");
  $("#googleLogin").textContent = action === "signup" ? t("signupGoogle") : t("continueGoogle");
  $("#authSubmit").textContent = action === "signup"
    ? (stripePaymentReturn ? t("createAccount") : t("continuePayment"))
    : t("login");
}

function syncPlanSelection() {
  const plan = plans[selectedPlan] ? selectedPlan : "free";
  selectedPlan = plan;
  const planSelect = $("#signupPlan");
  if (planSelect) planSelect.value = plan;
  const planInfo = plans[plan];
  selectedAuthMode = planInfo.mode;
  $$("[data-auth-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.authMode === selectedAuthMode);
  });
  const title = $("#paymentPlanTitle");
  if (title) title.textContent = `${t("selectedPlan")}: ${planInfo.name} - ${planInfo.price}`;
  if (stripePaymentReturn) {
    $$("[data-auth-mode]").forEach((button) => {
      button.disabled = true;
      button.setAttribute("aria-disabled", "true");
    });
  }
}

function showPaymentStep() {
  $("#paymentStep")?.classList.remove("hidden");
  syncPlanSelection();
}

function applyStripePaymentReturnState() {
  const banner = $("#paymentSuccessBanner");
  if (banner) banner.classList.toggle("hidden", !stripePaymentReturn);
  if (!stripePaymentReturn) return;
  selectedAuthAction = "signup";
  verificationSent = true;
  setAuthAction("signup");
  syncPlanSelection();
  $("#signupPlanField")?.classList.add("hidden");
  $("#verificationBox")?.classList.add("hidden");
  $("#paymentStep")?.classList.add("hidden");
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function currentPeriodLabel(date = new Date()) {
  return date.toLocaleDateString("es", { month: "long", year: "numeric" });
}

function isFutureJob(job) {
  return Boolean(job?.date && job.date > today());
}

function cleanerActionsLocked(job) {
  return Boolean(isFutureJob(job) && !portalCleanerAdmin);
}

function isCleanerHistoryAdminActive() {
  if (!cleanerHistoryAdminUnlocked) return false;
  if (Date.now() < cleanerHistoryAdminExpiresAt) return true;
  cleanerHistoryAdminUnlocked = false;
  cleanerHistoryAdminExpiresAt = 0;
  if (cleanerHistoryAdminTimer) {
    clearTimeout(cleanerHistoryAdminTimer);
    cleanerHistoryAdminTimer = null;
  }
  return false;
}

function cleanerHistoryAdminTimeLeftLabel() {
  const remainingMs = Math.max(0, cleanerHistoryAdminExpiresAt - Date.now());
  const minutes = Math.ceil(remainingMs / 60000);
  if (minutes >= 60) return "1 hora";
  return `${minutes} min`;
}

function activateCleanerHistoryAdminPermission() {
  cleanerHistoryAdminUnlocked = true;
  cleanerHistoryAdminExpiresAt = Date.now() + HISTORY_ADMIN_PERMISSION_MS;
  if (cleanerHistoryAdminTimer) clearTimeout(cleanerHistoryAdminTimer);
  cleanerHistoryAdminTimer = setTimeout(() => {
    cleanerHistoryAdminUnlocked = false;
    cleanerHistoryAdminExpiresAt = 0;
    if (!$("#cleanerPortalPage")?.classList.contains("hidden")) {
      renderStandaloneCleanerPortal(true);
      setCleanerTab("jobs");
      toast("Permiso admin caducado. Ingresa la clave para volver a editar fotos historicas.");
    }
  }, HISTORY_ADMIN_PERMISSION_MS);
}

function clearCleanerHistoryAdminPermission() {
  cleanerHistoryAdminUnlocked = false;
  cleanerHistoryAdminExpiresAt = 0;
  if (cleanerHistoryAdminTimer) {
    clearTimeout(cleanerHistoryAdminTimer);
    cleanerHistoryAdminTimer = null;
  }
}

function addDays(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function save() {
  localStorage.setItem("jobvisto-mode", state.mode);
  localStorage.setItem("jobvisto-country", state.country);
  localStorage.setItem("jobvisto-language", state.language);
  localStorage.setItem("jobvisto-clients", JSON.stringify(state.clients));
  localStorage.setItem("jobvisto-cleaners", JSON.stringify(state.cleaners));
  localStorage.setItem("jobvisto-jobs", JSON.stringify(state.jobs));
  localStorage.setItem("jobvisto-receipts", JSON.stringify(state.receipts));
  localStorage.setItem("jobvisto-service-rules", JSON.stringify(state.serviceRules));
  localStorage.setItem("jobvisto-client-price-rules", JSON.stringify(state.clientPriceRules));
  localStorage.setItem("jobvisto-cost-rules", JSON.stringify(state.costRules));
  localStorage.setItem("jobvisto-company-profile", JSON.stringify(state.companyProfile));
  localStorage.setItem("jobvisto-vat-rate", String(state.vatRate));
  localStorage.setItem("jobvisto-currency-symbol", state.currencySymbol);
  
  if (supabaseClient && state.orgId && state.user) {
    asyncSaveToSupabase();
  }
}

function clientFor(job) {
  return state.clients.find((client) => client.id === job.clientId) || state.clients[0];
}

function activeClients() {
  return state.clients.filter((client) => !client.archived);
}

function archivedClients() {
  return state.clients.filter((client) => client.archived);
}

function activeCleaners() {
  return state.cleaners.filter((cleaner) => !cleaner.archived);
}

function archivedCleaners() {
  return state.cleaners.filter((cleaner) => cleaner.archived);
}

function cleanerFor(job) {
  return state.cleaners.find((cleaner) => cleaner.id === job.cleanerId);
}

function normalizeCostRules() {
  if (!state.costRules) state.costRules = {};
  state.costRules.generalCleanerRate = Number(state.costRules.generalCleanerRate || 0);
  if (!state.costRules.generalServiceRates) state.costRules.generalServiceRates = {};
  state.costRules.generalServiceRates = Object.fromEntries(
    Object.entries(state.serviceRules || {}).map(([service]) => [
      service,
      Number(state.costRules.generalServiceRates?.[service] || state.costRules.generalCleanerRate || 0)
    ])
  );
  if (!Array.isArray(state.costRules.specialRules)) state.costRules.specialRules = [];
  if (!state.costRules.specialRules.length && state.costRules.specialCleaner) {
    const cleaner = state.cleaners.find((item) => item.name === state.costRules.specialCleaner);
    state.costRules.specialRules.push({
      id: safeId(),
      cleanerId: cleaner?.id || "",
      cleanerName: state.costRules.specialCleaner,
      rate: Number(state.costRules.specialCleanerRate || 0),
      serviceRates: {},
      mode: "replace"
    });
  }
  state.costRules.specialRules = state.costRules.specialRules.map((rule) => ({
    ...rule,
    serviceRates: Object.fromEntries(
      Object.entries(state.serviceRules || {}).map(([service]) => [
        service,
        Number(rule.serviceRates?.[service] || rule.rate || 0)
      ])
    )
  }));
}

function specialCostRuleForCleaner(cleaner) {
  if (!cleaner) return null;
  return state.costRules.specialRules.find((rule) => rule.cleanerId === cleaner.id || rule.cleanerName === cleaner.name) || null;
}

function currentMonthKey() {
  return today().slice(0, 7);
}

function monthKeyOffset(offset = 0) {
  const date = new Date();
  date.setMonth(date.getMonth() + offset);
  return date.toISOString().slice(0, 7);
}

function isCurrentMonth(job) {
  return String(job.date || "").slice(0, 7) === currentMonthKey();
}

function monthLabelFromKey(monthKey) {
  if (!monthKey) return "Mes actual";
  return new Date(`${monthKey}-01T00:00:00`).toLocaleDateString("es", { month: "long", year: "numeric" });
}

function monthOptionsForJobs(jobs) {
  const keys = [...new Set([monthKeyOffset(0), monthKeyOffset(-1), monthKeyOffset(-2), ...jobs.map((job) => String(job.date || "").slice(0, 7)).filter(Boolean)])]
    .sort((a, b) => b.localeCompare(a));
  return keys;
}

function timeToMinutes(value) {
  const [hours = 0, minutes = 0] = String(value || "00:00").split(":").map(Number);
  return (hours * 60) + minutes;
}

function minutesToTime(total) {
  const minutes = Math.max(0, total);
  const hours = Math.floor(minutes / 60) % 24;
  return `${String(hours).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function billableMinutes(job) {
  if (!isBillableDone(job)) return 0;
  const start = timeToMinutes(job.start);
  const end = timeToMinutes(job.actualEnd || job.end || job.start);
  const diff = end >= start ? end - start : 0;
  return Math.max(0, diff);
}

function estimateJob(job) {
  if (!isBillableDone(job)) return 0;
  const hours = billableMinutes(job) / 60;
  return (hours * Number(job.rate || 0)) + Number(job.extras || 0);
}

function estimateScheduledJob(job) {
  const start = timeToMinutes(job.start);
  const end = timeToMinutes(job.actualEnd || job.end || job.start);
  const minutes = Math.max(0, end - start);
  return ((minutes / 60) * Number(job.rate || 0)) + Number(job.extras || 0);
}

function jobHours(job) {
  return billableMinutes(job) / 60;
}

function minutesLabel(minutes) {
  const total = Math.max(0, Math.round(minutes || 0));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (!hours) return `${rest} min`;
  return `${hours}h ${String(rest).padStart(2, "0")}m`;
}

function money(value) {
  const amount = Number(value || 0);
  return `${state.currencySymbol || '$'}${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function firstName(value) {
  return String(value || "Miguel").trim().split(/\s+/)[0] || "Miguel";
}

function dashboardGreetingText() {
  const name = firstName(state.companyProfile?.greetingName || state.companyProfile?.ownerName);
  const greetings = {
    en: `Good morning, ${name}! \u{1F44B}`,
    es: `Buenos d\u00edas, ${name}! \u{1F44B}`,
    ru: `\u0414\u043e\u0431\u0440\u043e\u0435 \u0443\u0442\u0440\u043e, ${name}! \u{1F44B}`
  };
  return greetings[state.language] || greetings.en;
}

function clientPriceRuleFor(clientId) {
  return (state.clientPriceRules || []).find((rule) => rule.clientId === clientId);
}

function rateForClientService(clientId, serviceType) {
  const special = clientPriceRuleFor(clientId);
  const specialRate = Number(special?.serviceRates?.[serviceType] || 0);
  if (specialRate > 0) return specialRate;
  return Number(state.serviceRules?.[serviceType] || 0);
}

function normalizeKey(value) {
  return String(value || "").trim().toUpperCase();
}

function safeId() {
  return crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function fullAddressForClient(client) {
  const base = String(client?.address || "").trim();
  if (!base) return "";
  const country = countryInfo(client.country || state.country).name;
  return base.toLowerCase().includes(country.toLowerCase()) ? base : `${base}, ${country}`;
}

function mapsUrlForClient(client) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddressForClient(client))}`;
}

function addressSuggestions() {
  const examples = [
    "Herzl 42, Tel Aviv, Israel",
    "HaYarkon 18, Tel Aviv, Israel",
    "Patachya 2, Jerusalem, Israel",
    "Rothschild Boulevard 1, Tel Aviv, Israel",
    "Dizengoff 99, Tel Aviv, Israel",
    "Allenby Street 32, Tel Aviv, Israel",
    "Jaffa Street 45, Jerusalem, Israel",
    "Ben Yehuda 10, Jerusalem, Israel"
  ];
  return [...new Set([...state.clients.map(fullAddressForClient), ...examples].filter(Boolean))];
}

function renderAddressSuggestions() {
  const list = $("#addressSuggestions");
  if (!list) return;
  list.innerHTML = addressSuggestions().map((address) => `<option value="${escapeHtml(address)}"></option>`).join("");
}

function updateJobClientAddressHint() {
  const select = $("#jobClientSelect");
  const hint = $("#jobClientAddressHint");
  const mirror = $("#jobAddressMirror");
  if (!select || !hint) return;
  const client = state.clients.find((item) => item.id === select.value);
  const address = client ? fullAddressForClient(client) : "";
  hint.textContent = client ? `Google Maps opens only for directions: ${address}` : "";
  if (mirror) mirror.value = address;
  applyServiceRuleToJobForm();
}

function cleanerCostForJob(job) {
  const cleaner = cleanerFor(job);
  const rule = specialCostRuleForCleaner(cleaner);
  const clientRate = Number(job.rate || state.serviceRules[job.serviceType] || 0);
  const generalRate = Number(state.costRules.generalServiceRates?.[job.serviceType] ?? state.costRules.generalCleanerRate ?? 0);
  const specialRate = Number(rule?.rate || 0);
  const serviceSpecialRate = Number(rule?.serviceRates?.[job.serviceType] || specialRate || 0);
  let cleanerRate = generalRate;
  if (rule?.mode === "match_client") cleanerRate = clientRate;
  else if (rule?.mode === "add") cleanerRate = generalRate + serviceSpecialRate;
  else if (rule) cleanerRate = serviceSpecialRate;
  return jobHours(job) * cleanerRate;
}

function clientPortalPassword(client) {
  return `JV-${client.name.slice(0, 3).toUpperCase()}-${client.id.slice(-2)}`;
}

function clientPortalKeyPrefix(key) {
  const parts = normalizeKey(key).split("-").filter(Boolean);
  return parts.length >= 2 ? `${parts[0]}-${parts[1]}` : "";
}

function clientPortalKeyMatches(client, key) {
  const accessKey = normalizeKey(key);
  const expected = normalizeKey(clientPortalPassword(client));
  return expected === accessKey || clientPortalKeyPrefix(expected) === clientPortalKeyPrefix(accessKey);
}

function cleanerPortalPassword(cleaner) {
  const fallbackName = String(cleaner?.name || "CLEANER").trim().split(/\s+/)[0] || "CLEANER";
  return cleaner?.key || `JV-${fallbackName.slice(0, 10).toUpperCase()}`;
}

function localClientPortalUrl(client) {
  const basePath = location.pathname.replace(/\/[^/]*$/, "");
  return `${location.origin}${basePath}/portal-clientes.html?id=${encodeURIComponent(client.id)}&clave=${encodeURIComponent(clientPortalPassword(client))}`;
}

function localCleanerPortalUrl(cleaner) {
  const basePath = location.pathname.replace(/\/[^/]*$/, "");
  return `${location.origin}${basePath}/portal-cleaners.html?id=${encodeURIComponent(cleaner.id)}&clave=${encodeURIComponent(cleanerPortalPassword(cleaner))}`;
}

function currentTime() {
  return new Date().toTimeString().slice(0, 5);
}

function localText(key) {
  const labels = {
    amountToPay: { en: "Amount to pay", es: "Monto a pagar", ru: "Сумма к оплате" },
    amountPending: { en: "Pending", es: "Pendiente", ru: "Ожидает" },
    amountPendingLower: { en: "amount pending", es: "monto pendiente", ru: "сумма ожидает" },
    noPendingBalance: { en: "No pending balance", es: "Sin saldo pendiente", ru: "Нет ожидающего баланса" },
    billingPendingCopy: {
      en: "It is calculated only when real cleaner or administrator arrival and departure times exist.",
      es: "Se calcula solo cuando exista entrada y salida real del cleaner o del administrador.",
      ru: "Рассчитывается только после реального времени прихода и ухода клинера или администратора."
    },
    noActivePaymentCopy: {
      en: "There is no active or upcoming service pending.",
      es: "No hay servicio actual o proximo pendiente.",
      ru: "Нет активной или предстоящей услуги."
    },
    paymentMethodExpected: { en: "Expected method", es: "Metodo esperado", ru: "Ожидаемый способ" },
    client: { en: "Client", es: "Cliente", ru: "Клиент" },
    dateAndTime: { en: "Date and time", es: "Fecha y hora", ru: "Дата и время" },
    serviceLocked: {
      en: "Service locked until real hours are registered",
      es: "Servicio bloqueado hasta registrar horas reales",
      ru: "Услуга заблокирована до регистрации реальных часов"
    },
    inHistory: { en: "In history", es: "En historial", ru: "В истории" },
    inAction: { en: "In action", es: "En accion", ru: "В работе" },
    available: { en: "Available", es: "Disponible", ru: "Доступно" },
    arrival: { en: "Arrival", es: "Llegada", ru: "Приход" },
    departure: { en: "Departure", es: "Salida", ru: "Уход" },
    gpsSaved: { en: "Saved", es: "Guardado", ru: "Сохранено" },
    gpsNotTaken: { en: "Not taken", es: "No tomado", ru: "Не снято" },
    signature: { en: "Signature", es: "Firma", ru: "Подпись" },
    ready: { en: "Ready", es: "Lista", ru: "Готово" },
    paymentSignatureReceived: { en: "Signature received", es: "Firma recibida", ru: "Подпись получена" },
    paymentSignaturePending: { en: "Signature pending", es: "Pendiente de firma", ru: "Ожидает подписи" },
    cleanerPaymentSignaturePending: { en: "Cleaner signature pending", es: "Pendiente firma cleaner", ru: "Ожидает подписи клинера" },
    paymentSignedReceived: { en: "Signed received", es: "Firmado recibido", ru: "Получение подписано" }
  };
  return labels[key]?.[state.language] || labels[key]?.en || key;
}

function localizedJobStatus(status) {
  const labels = {
    "Asignado": { en: "Assigned", es: "Asignado", ru: "Назначено" },
    "Disponible para tomar": { en: "Available to take", es: "Disponible para tomar", ru: "Доступно для принятия" },
    "En progreso": { en: "In progress", es: "En progreso", ru: "В процессе" },
    "En sitio": { en: "On site", es: "En sitio", ru: "На месте" },
    "En sitio vencido": { en: "On-site overdue", es: "En sitio vencido", ru: "На месте, просрочено" },
    "Vencido / no iniciado": { en: "Overdue / not started", es: "Vencido / no iniciado", ru: "Просрочено / не начато" },
    "Terminado": { en: "Finished", es: "Terminado", ru: "Завершено" },
    "Terminado por cleaner": { en: "Finished by cleaner", es: "Terminado por cleaner", ru: "Завершено клинером" },
    "Terminado por cliente": { en: "Finished by client", es: "Terminado por cliente", ru: "Завершено клиентом" },
    "Confirmado por cliente": { en: "Finished by client", es: "Terminado por cliente", ru: "Завершено клиентом" },
    "Terminado por administrador": { en: "Finished by administrator", es: "Terminado por administrador", ru: "Завершено администратором" },
    "Pagado": { en: "Paid", es: "Pagado", ru: "Оплачено" },
    "No iniciado": { en: "Not started", es: "No iniciado", ru: "Не начато" }
  };
  return labels[status]?.[state.language] || labels[status]?.en || status;
}

function statusValueForJob(job) {
  if (job.status === "Terminado por cliente") return "Terminado por cliente";
  if (job.status === "Confirmado por cliente") return "Terminado por cliente";
  if (job.status === "En sitio vencido") return "En sitio vencido";
  if (job.status === "Vencido / no iniciado") return "Vencido / no iniciado";
  if (isOverdueLive(job)) return "En sitio vencido";
  if (isLiveJob(job)) return "En progreso";
  if (job.status) return job.status;
  return job.cleanerId ? "Asignado" : "Disponible para tomar";
}

function applyJobStatusControl(payload, previousJob = {}) {
  const status = payload.status || (payload.cleanerId ? "Asignado" : "Disponible para tomar");
  payload.status = status;

  if (status === "Disponible para tomar") {
    payload.cleanerId = "";
    payload.checkedIn = false;
    payload.checkedOut = false;
    payload.cleanerFinished = false;
    payload.clientConfirmed = false;
    payload.signed = false;
    payload.actualEnd = "";
    return payload;
  }

  if (status === "Asignado" || status === "Vencido / no iniciado") {
    payload.checkedIn = false;
    payload.checkedOut = false;
    payload.cleanerFinished = false;
    payload.clientConfirmed = false;
    payload.signed = false;
    payload.actualEnd = "";
    return payload;
  }

  if (status === "En progreso" || status === "En sitio vencido") {
    payload.checkedIn = true;
    payload.checkedOut = false;
    payload.cleanerFinished = false;
    payload.clientConfirmed = false;
    payload.signed = false;
    payload.actualEnd = "";
    return payload;
  }

  if (status === "Terminado por cleaner") {
    payload.checkedIn = true;
    payload.checkedOut = true;
    payload.cleanerFinished = true;
    payload.clientConfirmed = false;
    payload.actualEnd = payload.actualEnd || previousJob.actualEnd || payload.end || currentTime();
    return payload;
  }

  if (status === "Terminado por cliente") {
    payload.status = "Confirmado por cliente";
    payload.checkedIn = true;
    payload.checkedOut = true;
    payload.cleanerFinished = true;
    payload.clientConfirmed = true;
    payload.signed = true;
    payload.actualEnd = payload.actualEnd || previousJob.actualEnd || payload.end || currentTime();
    return payload;
  }

  if (status === "Terminado por administrador") {
    payload.checkedIn = true;
    payload.checkedOut = true;
    payload.cleanerFinished = true;
    payload.actualEnd = payload.actualEnd || previousJob.actualEnd || payload.end || currentTime();
  }

  return payload;
}

function shouldRemindArrival(job) {
  return job.date <= today() && !job.checkedIn && timeToMinutes(currentTime()) >= timeToMinutes(job.start);
}

function isDone(job) {
  return Boolean(job.checkedOut || job.cleanerFinished || job.signed || job.status === "Pagado" || job.status === "Confirmado por cliente" || job.status === "Terminado por cliente" || job.status === "Terminado por administrador");
}

function hasFinalTime(job) {
  return Boolean(job.actualEnd || job.checkedOut || job.cleanerFinished || job.status === "Terminado por administrador" || job.status === "Confirmado por cliente" || job.status === "Terminado por cliente" || job.status === "Pagado");
}

function isBillableDone(job) {
  return Boolean(isDone(job) && hasFinalTime(job));
}

function hasRealBillingTimes(job) {
  return Boolean(job.checkedIn && job.actualEnd && isDone(job));
}

function clientCanConfirmJob(job) {
  return Boolean(job && hasRealBillingTimes(job) && !job.clientConfirmed);
}

function isLiveJob(job) {
  return Boolean((job.checkedIn || job.status === "En progreso" || job.status === "En sitio vencido") && !isDone(job));
}

function isOverdueLive(job) {
  if (job.status === "En sitio vencido") return true;
  if (!isLiveJob(job)) return false;
  return job.date < today() || (job.date === today() && job.end && timeToMinutes(currentTime()) > timeToMinutes(job.end));
}

function isCurrentOrUpcomingJob(job) {
  return Boolean(isLiveJob(job) || (!isDone(job) && job.date >= today()));
}

function jobsForClient(clientId) {
  return state.jobs
    .filter((job) => job.clientId === clientId)
    .sort((a, b) => `${a.date} ${a.start}`.localeCompare(`${b.date} ${b.start}`));
}

function currentClientJob(clientId) {
  const jobs = jobsForClient(clientId);
  return jobs.find(isLiveJob) || jobs.find(isCurrentOrUpcomingJob) || null;
}

function clientFromPortalAccess(id, key) {
  const accessKey = normalizeKey(key);
  const accessPrefix = clientPortalKeyPrefix(accessKey);
  const byId = state.clients.find((item) => item.id === id);
  if (byId && (!accessKey || normalizeKey(clientPortalPassword(byId)) === accessKey)) return byId;
  return state.clients.find((item) => normalizeKey(clientPortalPassword(item)) === accessKey)
    || state.clients.find((item) => accessPrefix && clientPortalKeyPrefix(clientPortalPassword(item)) === accessPrefix)
    || byId;
}

function cleanerFromPortalAccess(id, key) {
  const accessKey = normalizeKey(key);
  const byId = state.cleaners.find((item) => item.id === id);
  if (byId && (!accessKey || normalizeKey(cleanerPortalPassword(byId)) === accessKey || portalCleanerAdmin)) return byId;
  return state.cleaners.find((item) => normalizeKey(cleanerPortalPassword(item)) === accessKey) || byId;
}

function clientJobHistory(clientId) {
  return jobsForClient(clientId)
    .filter((job) => !isCurrentOrUpcomingJob(job))
    .sort((a, b) => `${b.date} ${b.start}`.localeCompare(`${a.date} ${a.start}`));
}

function clientHistoryHtml(historyJobs) {
  if (!historyJobs.length) {
    return `<p class="muted">${t("noClosedJobsHistory")}</p>`;
  }
  return historyJobs.map((job, index) => {
    const client = clientFor(job);
    const hasPayableAmount = hasRealBillingTimes(job);
    return `
      <details class="history-job client-history-item" ${index === 0 ? "open" : ""}>
        <summary>
          <strong>${job.date} - ${client.name}</strong>
          <span>${jobStatusLabel(job)}</span>
        </summary>
        <div class="history-body">
          <p>${client.address}</p>
          <p>${job.serviceType} - ${job.start}-${job.actualEnd || job.end || t("undefinedTime")}</p>
          <p>${evidenceCount(job)} ${evidenceCount(job) === 1 ? t("photoSingular") : t("photoPlural")} - ${job.clientConfirmed ? t("confirmedByClient") : t("noClientConfirmation")} - ${hasPayableAmount ? money(estimateJob(job)) : localText("amountPendingLower")}</p>
          ${evidenceCount(job) ? photoBoardHtml(job, true) : ""}
        </div>
      </details>
    `;
  }).join("");
}

function clientHistoryTimelineHtml(historyJobs, currentJob) {
  const allJobs = [];
  if (currentJob) {
    allJobs.push({ ...currentJob, isCurrent: true });
  }
  historyJobs.forEach(job => {
    allJobs.push({ ...job, isCurrent: false });
  });

  if (!allJobs.length) {
    return `<p class="muted">${t("noClosedJobsHistory")}</p>`;
  }

  return `
    <div class="cp-history-list">
      ${allJobs.map((job, index) => {
        const client = clientFor(job);
        const isCurrent = job.isCurrent;
        const badgeClass = isCurrent ? 'cp-status-assigned' : 'cp-status-done';
        const badgeLabel = isCurrent ? (job.status || 'Programado') : 'Terminado por cleaner';
        const hasPayableAmount = hasRealBillingTimes(job);
        const formattedDate = new Date(job.date + 'T00:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
        
        return `
          <div class="cp-history-item-new ${isCurrent ? 'current' : 'past'}">
            <div class="cp-history-header-row">
              <strong>${formattedDate} &bull; ${isCurrent ? 'Próximo servicio' : escapeHtml(client.name)}</strong>
              <span class="cp-job-status-badge ${badgeClass}" style="padding: 2px 8px; border-radius: 99px;">${badgeLabel}</span>
            </div>
            <div class="cp-history-details-row">
              <span class="cp-history-detail-line">${escapeHtml(job.serviceType)} &bull; ${job.start}–${job.actualEnd || job.end || '—'}</span>
              ${!isCurrent ? `
                <span class="cp-history-sub-line">${evidenceCount(job)} fotos &bull; ${job.clientConfirmed ? t("confirmedByClient") : t("noClientConfirmation")} &bull; ${hasPayableAmount ? money(estimateJob(job)) : localText("amountPendingLower")}</span>
              ` : `
                <span class="cp-history-sub-line">Estado: ${escapeHtml(job.status)}</span>
              `}
            </div>
            <button class="text-link cp-history-expand-btn" type="button" onclick="toggleHistoryJobDetails('${job.id}')">
              Ver detalles &gt;
            </button>
            <div class="cp-history-job-expanded hidden" id="history-details-${job.id}">
              ${evidenceCount(job) ? photoBoardHtml(job, true) : `<p class="muted" style="margin: 8px 0 0; font-size: 0.8rem;">Sin evidencias cargadas.</p>`}
            </div>
          </div>
        `;
      }).join("")}
    </div>
    <div style="margin-top: 16px; text-align: center;">
      <button class="ghost" type="button" style="font-size: 0.85rem; font-weight: 600; padding: 8px 16px; border-radius: 8px; border: 1px solid #e2ebe4; color: #07302d;" onclick="toast('Mostrando todo el historial.')">
        Ver todos los servicios &gt;
      </button>
    </div>
  `;
}

window.toggleHistoryJobDetails = function(jobId) {
  const el = document.getElementById(`history-details-${jobId}`);
  if (el) {
    el.classList.toggle("hidden");
  }
};

async function copyClientKey(clientId) {
  const client = state.clients.find((item) => item.id === clientId);
  if (!client) return;
  const key = clientPortalPassword(client);
  try {
    await navigator.clipboard.writeText(key);
    toast("Clave copiada: " + key);
  } catch {
    window.prompt("Copia esta clave:", key);
  }
}

function jobStatusLabel(job) {
  if (isOverdueLive(job)) return localizedJobStatus("En sitio vencido");
  if (isLiveJob(job)) return localizedJobStatus("En sitio");
  if (job.status === "Confirmado por cliente") return localizedJobStatus("Terminado por cliente");
  if (job.status === "Terminado por cliente") return localizedJobStatus("Terminado por cliente");
  if (job.status === "Vencido / no iniciado") return localizedJobStatus("Vencido / no iniciado");
  if (isDone(job)) return localizedJobStatus(job.status || "Terminado");
  if (job.date < today() && !job.checkedIn) return localizedJobStatus("No iniciado");
  return localizedJobStatus(job.status || "Asignado");
}

function jobBadgeClass(job) {
  if (isOverdueLive(job)) return "danger";
  if (isLiveJob(job)) return "green";
  if (job.status === "Vencido / no iniciado") return "danger";
  if (job.status === "Disponible para tomar") return "teal";
  if (isDone(job)) return "dark";
  if (job.date < today() && !job.checkedIn) return "danger";
  return "gold";
}

const jobCategoryConfig = {
  overdueLive: { label: "En sitio vencido", helper: "Llegada marcada, pero paso la hora estimada.", className: "danger" },
  live: { label: "En proceso", helper: "Trabajo abierto ahora.", className: "live" },
  expired: { label: "Vencido / no iniciado", helper: "Fechas pasadas sin llegada registrada.", className: "danger" },
  assigned: { label: "Asignado", helper: "Agendado para iniciar.", className: "gold" },
  open: { label: "Abierto", helper: "Disponible para que un cleaner lo tome.", className: "teal" },
  cleanerDone: { label: "Terminado por cleaner", helper: "Falta confirmacion final del cliente o admin.", className: "dark" },
  clientDone: { label: "Terminado por cliente", helper: "Servicio confirmado por el cliente.", className: "green" },
  adminDone: { label: "Terminado por administrador", helper: "Cerrado manualmente por administracion.", className: "dark" }
};

function localizedJobCategory(key) {
  const config = jobCategoryConfig[key];
  const helpers = {
    overdueLive: {
      en: "Arrival was marked, but the estimated end time passed.",
      es: "Llegada marcada, pero paso la hora estimada.",
      ru: "Приход отмечен, но расчетное время окончания прошло."
    },
    live: { en: "Job is open now.", es: "Trabajo abierto ahora.", ru: "Работа сейчас открыта." },
    expired: {
      en: "Past dates without recorded arrival.",
      es: "Fechas pasadas sin llegada registrada.",
      ru: "Прошедшие даты без отмеченного прихода."
    },
    assigned: { en: "Scheduled to start.", es: "Agendado para iniciar.", ru: "Запланировано к началу." },
    open: {
      en: "Available for a cleaner to take.",
      es: "Disponible para que un cleaner lo tome.",
      ru: "Доступно для принятия клинером."
    },
    cleanerDone: {
      en: "Needs final confirmation from client or admin.",
      es: "Falta confirmacion final del cliente o admin.",
      ru: "Нужно финальное подтверждение клиента или администратора."
    },
    clientDone: {
      en: "Service confirmed by the client.",
      es: "Servicio confirmado por el cliente.",
      ru: "Услуга подтверждена клиентом."
    },
    adminDone: {
      en: "Manually closed by administration.",
      es: "Cerrado manualmente por administracion.",
      ru: "Закрыто администратором вручную."
    }
  };
  return {
    ...config,
    label: localizedJobStatus(config.label),
    helper: helpers[key]?.[state.language] || helpers[key]?.en || config.helper
  };
}

function jobCategoryKey(job) {
  if (job.status === "En sitio vencido") return "overdueLive";
  if (job.status === "En progreso") return "live";
  if (job.status === "Vencido / no iniciado") return "expired";
  if (isOverdueLive(job)) return "overdueLive";
  if (isLiveJob(job)) return "live";
  if (job.status === "Confirmado por cliente" || job.status === "Terminado por cliente" || job.clientConfirmed) return "clientDone";
  if (job.status === "Terminado por administrador") return "adminDone";
  if (job.status === "Terminado por cleaner" || job.cleanerFinished || job.checkedOut) return "cleanerDone";
  if (job.date < today() && !job.checkedIn) return "expired";
  if (!job.cleanerId || job.status === "Disponible para tomar") return "open";
  return "assigned";
}

function jobsByCategory() {
  const order = ["overdueLive", "live", "expired", "assigned", "open", "cleanerDone", "clientDone", "adminDone"];
  return order.map((key) => ({
    key,
    config: localizedJobCategory(key),
    jobs: state.jobs.filter((job) => jobCategoryKey(job) === key)
  }));
}

function locationMeta(value = "") {
  const text = String(value || "");
  const country = countryInfo(state.country).name || "Pais";
  const cityHints = ["Tel Aviv", "Jerusalem", "Haifa", "Guayaquil", "Quito", "San Francisco", "New York", "Bogota", "Medellin", "Miami"];
  const city = cityHints.find((item) => text.toLowerCase().includes(item.toLowerCase())) || text.split(",").map((part) => part.trim()).filter(Boolean).pop() || "Zona principal";
  const regionMap = {
    "Tel Aviv": "Centro",
    Jerusalem: "Jerusalem",
    Haifa: "Norte",
    Guayaquil: "Costa",
    Quito: "Sierra",
    "San Francisco": "California",
    "New York": "New York",
    Bogota: "Cundinamarca",
    Medellin: "Antioquia",
    Miami: "Florida"
  };
  return { country, region: regionMap[city] || "Zona operativa", city };
}

function evidenceFor(job) {
  if (!Array.isArray(job.evidence)) job.evidence = [];
  return job.evidence;
}

function evidenceCount(job) {
  return Array.isArray(job.evidence) ? job.evidence.length : 0;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function compressImageFile(file, maxSize = 1280, quality = 0.72) {
  const original = await readFileAsDataUrl(file);
  if (!file.type.startsWith("image/")) return original;
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
      const width = Math.max(1, Math.round(image.width * scale));
      const height = Math.max(1, Math.round(image.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    image.onerror = () => resolve(original);
    image.src = original;
  });
}

function parsedCleanerAccess(params = new URLSearchParams(location.search)) {
  const rawId = decodeURIComponent(params.get("id") || "");
  const id = rawId.split(/\s+clave:/i)[0].trim();
  const embeddedKey = rawId.match(/clave:\s*([A-Z0-9-]+)/i)?.[1] || "";
  const key = params.get("clave") || embeddedKey;
  return { id, key: normalizeKey(key) };
}

function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.add("show");
  setTimeout(() => node.classList.remove("show"), 2400);
}

function enterApp(mode) {
  portalCleanerAdmin = false;
  state.mode = mode;
  if (!state.country || selectedAuthAction === "signup") {
    state.country = $("#accountCountry").value || "IL";
  }
  const account = currentDemoAccount();
  if (!state.user || !state.user.id) {
    state.user = account
      ? { name: account.name, plan: account.plan }
      : { name: mode === "company" ? "Altiora Cleaning" : "Maria Lopez", plan: selectedPlan };
  } else {
    state.user.name = state.companyProfile.ownerName || state.user.name || state.user.email?.split('@')[0] || "Usuario";
    state.user.plan = selectedPlan || "free";
  }
  save();
  $("#authScreen").classList.add("hidden");
  $("#appShell").classList.remove("hidden");
  renderAll();
}

function currentDemoAccount() {
  const email = ($("#authForm")?.elements.email.value || "").trim().toLowerCase();
  return demoAccounts[email] || null;
}

function authModeLabel(mode) {
  return mode === "company" ? t("company") : t("independent");
}

function selectAuthMode(mode) {
  selectedAuthMode = mode;
  if (selectedAuthMode === "independent" && !["free", "independent"].includes(selectedPlan)) selectedPlan = "free";
  if (selectedAuthMode === "company" && ["free", "independent"].includes(selectedPlan)) selectedPlan = "company";
  syncPlanSelection();
  $$("[data-auth-mode]").forEach((item) => item.classList.toggle("active", item.dataset.authMode === selectedAuthMode));
}

function validateDemoAccount(action, data = {}) {
  const email = String(data.email || $("#authForm")?.elements.email.value || "").trim().toLowerCase();
  const password = String(data.password || "");
  const account = demoAccounts[email];

  if (!account) return true;

  if (account.mode !== selectedAuthMode) {
    toast(`This email belongs to a ${authModeLabel(account.mode)} account. Select ${authModeLabel(account.mode)} to log in.`);
    selectAuthMode(account.mode);
    return false;
  }

  if (action === "login" && password && password !== account.password) {
    toast("Incorrect password for this account.");
    return false;
  }

  if (action === "signup") {
    toast(`This email is already registered as ${authModeLabel(account.mode)}. Use Log in.`);
    setAuthAction("login");
    return false;
  }

  selectedPlan = account.plan;
  return true;
}

async function enterClientPortalFromUrl() {
  const params = new URLSearchParams(location.search);
  if (params.get("portal") === "cleaner") return await enterCleanerPortalFromUrl(params);
  if (params.get("portal") !== "client") return false;
  portalCleanerAdmin = false;
  const clientId = params.get("id");
  const accessKey = normalizeKey(params.get("clave"));

  if (supabaseClient && (!state.clients || state.clients.length === 0 || !state.clients.some(c => c.id === clientId))) {
    try {
      const { data, error } = await supabaseClient.rpc('get_portal_client', {
        client_id: clientId,
        client_key: accessKey
      });
      if (!error && data) {
        const cl = data.client;
        const org = data.organization;
        state.orgId = cl.organization_id;
        state.country = org.country || "IL";
        state.currencySymbol = org.currency === "ILS" ? "₪" : (org.currency === "USD" ? "$" : org.currency);

        const { data: settings } = await supabaseClient.from('organization_settings').select('*').eq('organization_id', cl.organization_id);
        if (settings) {
          const vatSetting = settings.find(s => s.key === 'vat_rate');
          if (vatSetting) state.vatRate = Number(vatSetting.value?.rate !== undefined ? vatSetting.value.rate : 18);
          const currencySetting = settings.find(s => s.key === 'currency_symbol');
          if (currencySetting) state.currencySymbol = currencySetting.value?.symbol || state.currencySymbol;
        }

        state.clients = [{
          id: cl.id,
          name: cl.name,
          phone: cl.phone || "",
          email: cl.email || "",
          address: "",
          country: state.country || "IL",
          paymentMethod: cl.default_payment_method === 'cash' ? 'Efectivo' : 'Transferencia',
          notes: cl.notes || ""
        }];

        const { data: addresses } = await supabaseClient.from('client_addresses').select('*').eq('client_id', cl.id);
        if (addresses && addresses[0]) {
          state.clients[0].address = addresses[0].address_line;
        }

        state.cleaners = (data.cleaners || []).map(c => ({
          id: c.id,
          name: c.name,
          phone: c.phone || "",
          email: c.email || "",
          status: c.status === 'available' ? 'Disponible' : 'Ocupada',
          key: c.access_key,
          country: c.country || state.country || "IL",
          city: c.city || "Zona principal"
        }));

        state.jobs = (data.jobs || []).map(j => {
          const dateStr = j.scheduled_start ? j.scheduled_start.slice(0, 10) : today();
          const startStr = j.scheduled_start ? new Date(j.scheduled_start).toISOString().slice(11, 16) : "08:00";
          const endStr = j.scheduled_end ? new Date(j.scheduled_end).toISOString().slice(11, 16) : "12:00";
          const actualEndStr = j.actual_end ? new Date(j.actual_end).toISOString().slice(11, 16) : "";
          
          const jobEvidence = (data.evidence || []).filter(e => e.job_id === j.id).map(e => ({
            id: e.id,
            section: e.area,
            phase: e.phase === 'before' ? 'Antes' : 'Despues',
            comment: e.caption || "",
            url: e.file_path,
            createdAt: e.created_at
          }));

          const jobSignatures = (data.signatures || []).filter(s => s.job_id === j.id);
          const siteSig = jobSignatures.find(s => s.signed_from === 'cleaner_device');
          const clientSig = jobSignatures.find(s => s.signed_from === 'private_link') || jobSignatures[0];

          return {
            id: j.id,
            clientId: j.client_id,
            cleanerId: j.assigned_cleaner_id || "",
            date: dateStr,
            start: startStr,
            end: endStr,
            actualEnd: actualEndStr,
            serviceType: j.service_type || "Limpieza normal",
            rate: Number(j.client_hourly_rate || 65),
            extras: Number(j.extras_amount || 0),
            status: j.status === 'scheduled' ? 'Asignado' : 
                    j.status === 'open' ? 'Disponible para tomar' : 
                    j.status === 'in_site' ? 'En progreso' :
                    j.status === 'cleaner_finished' ? 'Terminado por cleaner' :
                    j.status === 'client_confirmed' ? 'Confirmado por cliente' :
                    j.status === 'signed' ? 'Firmado' : j.status,
            tasks: j.checklist || [],
            checkedIn: j.status === 'in_site' || j.status === 'cleaner_finished' || j.status === 'client_confirmed' || j.status === 'signed',
            checkedOut: j.status === 'cleaner_finished' || j.status === 'client_confirmed' || j.status === 'signed' || jobSignatures.length > 0,
            cleanerFinished: j.status === 'cleaner_finished' || j.status === 'client_confirmed' || j.status === 'signed' || jobSignatures.length > 0,
            clientConfirmed: j.status === 'client_confirmed' || j.status === 'signed' || clientSig !== undefined,
            signed: j.status === 'client_confirmed' || j.status === 'signed' || jobSignatures.length > 0,
            siteSignature: siteSig ? siteSig.signature_data : "",
            siteSignerName: siteSig ? siteSig.signer_name : "",
            clientSignature: clientSig ? clientSig.signature_data : "",
            evidence: jobEvidence,
            photos: jobEvidence.length
          };
        });
      }
    } catch (err) {
      console.error("Error loading client portal dynamically: ", err);
    }
  }

  const client = clientFromPortalAccess(clientId, accessKey);
  const shouldUnlock = Boolean(client && (!accessKey || clientPortalKeyMatches(client, accessKey)));
  portalClientId = client?.id || null;
  
  // Force hide auth screen and shell
  $("#authScreen").classList.add("hidden");
  $("#authScreen").style.display = "none"; 
  $("#appShell").classList.add("hidden");
  $("#appShell").style.display = "none";
  
  $("#clientPortalPage").classList.remove("hidden");
  $("#clientPortalPassword").value = params.get("clave") || (client ? clientPortalPassword(client) : "");
  renderStandaloneClientPortal(shouldUnlock);
  return true;
}

async function enterCleanerPortalFromUrl(params = new URLSearchParams(location.search)) {
  const access = parsedCleanerAccess(params);
  portalCleanerAdmin = access.key === normalizeKey(ADMIN_CLEANER_KEY);

  if (supabaseClient && (!state.cleaners || state.cleaners.length === 0 || !state.cleaners.some(c => c.id === access.id))) {
    try {
      const { data, error } = await supabaseClient.rpc('get_portal_cleaner', {
        cleaner_id: access.id,
        cleaner_key: access.key
      });
      if (!error && data) {
        const cl = data.cleaner;
        const org = data.organization;
        state.orgId = cl.organization_id;
        state.country = org.country || "IL";
        state.currencySymbol = org.currency === "ILS" ? "₪" : (org.currency === "USD" ? "$" : org.currency);

        const { data: settings } = await supabaseClient.from('organization_settings').select('*').eq('organization_id', cl.organization_id);
        if (settings) {
          const vatSetting = settings.find(s => s.key === 'vat_rate');
          if (vatSetting) state.vatRate = Number(vatSetting.value?.rate !== undefined ? vatSetting.value.rate : 18);
          const currencySetting = settings.find(s => s.key === 'currency_symbol');
          if (currencySetting) state.currencySymbol = currencySetting.value?.symbol || state.currencySymbol;
        }

        state.cleaners = [{
          id: cl.id,
          name: cl.name,
          phone: cl.phone || "",
          email: cl.email || "",
          status: cl.status === 'available' ? 'Disponible' : 'Ocupada',
          key: cl.access_key,
          country: cl.country || state.country || "IL",
          city: cl.city || "Zona principal"
        }];

        state.clients = (data.clients || []).map(c => ({
          id: c.id,
          name: c.name,
          phone: c.phone || "",
          email: c.email || "",
          address: "",
          country: state.country || "IL",
          paymentMethod: c.default_payment_method === 'cash' ? 'Efectivo' : 'Transferencia',
          notes: c.notes || ""
        }));

        state.jobs = (data.jobs || []).map(j => {
          const dateStr = j.scheduled_start ? j.scheduled_start.slice(0, 10) : today();
          const startStr = j.scheduled_start ? new Date(j.scheduled_start).toISOString().slice(11, 16) : "08:00";
          const endStr = j.scheduled_end ? new Date(j.scheduled_end).toISOString().slice(11, 16) : "12:00";
          const actualEndStr = j.actual_end ? new Date(j.actual_end).toISOString().slice(11, 16) : "";
          
          const jobEvidence = (data.evidence || []).filter(e => e.job_id === j.id).map(e => ({
            id: e.id,
            section: e.area,
            phase: e.phase === 'before' ? 'Antes' : 'Despues',
            comment: e.caption || "",
            url: e.file_path,
            createdAt: e.created_at
          }));

          const jobSignatures = (data.signatures || []).filter(s => s.job_id === j.id);
          const siteSig = jobSignatures.find(s => s.signed_from === 'cleaner_device');
          const clientSig = jobSignatures.find(s => s.signed_from === 'private_link') || jobSignatures[0];

          return {
            id: j.id,
            clientId: j.client_id,
            cleanerId: j.assigned_cleaner_id || "",
            date: dateStr,
            start: startStr,
            end: endStr,
            actualEnd: actualEndStr,
            serviceType: j.service_type || "Limpieza normal",
            rate: Number(j.client_hourly_rate || 65),
            extras: Number(j.extras_amount || 0),
            status: j.status === 'scheduled' ? 'Asignado' : 
                    j.status === 'open' ? 'Disponible para tomar' : 
                    j.status === 'in_site' ? 'En progreso' :
                    j.status === 'cleaner_finished' ? 'Terminado por cleaner' :
                    j.status === 'client_confirmed' ? 'Confirmado por cliente' :
                    j.status === 'signed' ? 'Firmado' : j.status,
            tasks: j.checklist || [],
            checkedIn: j.status === 'in_site' || j.status === 'cleaner_finished' || j.status === 'client_confirmed' || j.status === 'signed',
            checkedOut: j.status === 'cleaner_finished' || j.status === 'client_confirmed' || j.status === 'signed' || jobSignatures.length > 0,
            cleanerFinished: j.status === 'cleaner_finished' || j.status === 'client_confirmed' || j.status === 'signed' || jobSignatures.length > 0,
            clientConfirmed: j.status === 'client_confirmed' || j.status === 'signed' || clientSig !== undefined,
            signed: j.status === 'client_confirmed' || j.status === 'signed' || jobSignatures.length > 0,
            siteSignature: siteSig ? siteSig.signature_data : "",
            siteSignerName: siteSig ? siteSig.signer_name : "",
            clientSignature: clientSig ? clientSig.signature_data : "",
            evidence: jobEvidence,
            photos: jobEvidence.length
          };
        });

        state.receipts = (data.receipts || []).map(r => ({
          id: r.id,
          cleanerId: r.cleaner_id,
          cleaner: state.cleaners.find(c => c.id === r.cleaner_id)?.name || 'Cleaner',
          amount: Number(r.amount),
          method: r.payment_method === 'cash' ? 'Efectivo' : 'Transferencia',
          period: `${r.period_start} - ${r.period_end}`,
          status: r.status === 'draft' ? 'pending_signature' : 'signed',
          signature: r.receiver_signature_data,
          date: new Date(r.paid_at).toLocaleDateString('es')
        }));
      }
    } catch (err) {
      console.error("Error loading cleaner portal dynamically: ", err);
    }
  }

  const cleaner = cleanerFromPortalAccess(access.id, access.key);
  const shouldUnlock = Boolean(cleaner && (portalCleanerAdmin || !access.key || normalizeKey(cleanerPortalPassword(cleaner)) === access.key));
  portalCleanerId = cleaner?.id;
  
  // Force hide auth screen and shell
  $("#authScreen").classList.add("hidden");
  $("#authScreen").style.display = "none";
  $("#appShell").classList.add("hidden");
  $("#appShell").style.display = "none";
  
  $("#clientPortalPage").classList.add("hidden");
  $("#cleanerPortalPage").classList.remove("hidden");
  $("#cleanerPortalPassword").value = access.key || (cleaner ? cleanerPortalPassword(cleaner) : "");
  renderStandaloneCleanerPortal(shouldUnlock);
  return true;
}

function renderStandaloneClientPortal(unlocked = true) {
  const client = state.clients.find((item) => item.id === portalClientId);
  if (!client) {
    $("#clientPortalLock").classList.remove("hidden");
    $("#clientPortalContent").classList.add("hidden");
    $("#clientPortalPassword").value = "";
    toast("Acceso de cliente no encontrado. Copia el link actualizado desde Links clientes.");
    return;
  }
  const job = currentClientJob(client?.id);
  const historyJobs = clientJobHistory(client?.id);
  const hasPayableAmount = job && hasRealBillingTimes(job);
  $("#clientPortalLock").classList.toggle("hidden", unlocked);
  $("#clientPortalContent").classList.toggle("hidden", !unlocked);
  document.querySelector(".portal-header")?.classList.toggle("hidden", !unlocked);

  const unpaidJobs = historyJobs.filter(j => j.status.includes("Terminado") && j.clientPaymentStatus !== "paid");
  let pendingBalance = unpaidJobs.reduce((sum, j) => sum + ((parseFloat(j.amount) || 0) - (parseFloat(j.clientPaidAmount) || 0)), 0);
  
  // Si hay un trabajo actual con monto pero que no está terminado y no ha sido pagado, lo sumamos.
  if (hasPayableAmount && job && !job.status.includes("Terminado") && job.clientPaymentStatus !== "paid") {
    pendingBalance += estimateJob(job);
  }
  
  const hasPending = pendingBalance > 0;

  // Build the left summary card
  const statusMap = {
    "Asignado": { label: "Asignado", cls: "cp-status-assigned" },
    "En progreso": { label: "En sitio / en proceso", cls: "cp-status-inprogress" },
    "En sitio": { label: "En sitio / en proceso", cls: "cp-status-inprogress" },
    "Terminado por cleaner": { label: "Terminado por cleaner", cls: "cp-status-done" },
    "Terminado por cliente": { label: "Terminado por cliente", cls: "cp-status-done" },
    "Terminado por administrador": { label: "Terminado por administrador", cls: "cp-status-done" },
  };
  const jobStatus = job ? (statusMap[job.status] || { label: job.status, cls: "cp-status-assigned" }) : null;

  const mkRow = (iconName, label, value, valueCls = "") => `
    <div class="cp-info-row-redesign">
      <span class="cp-info-label-redesign">
        <i data-lucide="${iconName}" class="cp-row-icon-redesign"></i>
        ${label}
      </span>
      <span class="cp-info-value-redesign${valueCls ? ' ' + valueCls : ''}">${value}</span>
    </div>`;

  const pendingText = `<span style="color: #f59e0b; font-weight: 700;">${t("pending")}</span>`;
  const doneText = `<span style="color: #35d17f; font-weight: 700;">✓</span>`;
  const blockedText = `<span style="color: #ef4444; font-weight: 700;">${localText("serviceLocked")}</span>`;
  const initials = String(client.name || "JV").split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();

  $("#clientPortalSummary").innerHTML = job ? `
    <span class="cp-summary-eyebrow-redesign">Cliente</span>
    <h2 class="cp-summary-title-redesign">${t("privateServiceSummary")}</h2>
    
    <div class="cp-summary-meta-redesign">
      <div class="cp-meta-row-redesign">
        <i data-lucide="user" class="cp-meta-icon-redesign"></i>
        <span><strong>Cliente:</strong> ${client.name}</span>
      </div>
      <div class="cp-meta-row-redesign">
        <i data-lucide="briefcase" class="cp-meta-icon-redesign"></i>
        <span><strong>Servicio actual/próximo:</strong> ${job.serviceType}</span>
      </div>
      <div class="cp-meta-row-redesign">
        <i data-lucide="calendar" class="cp-meta-icon-redesign"></i>
        <span><strong>Fecha y hora:</strong> ${job.date} &bull; ${job.start}–${job.end || t("undefinedTime")}</span>
      </div>
    </div>

    <div class="cp-payment-card-redesign ${hasPending ? '' : 'cp-payment-locked'}">
      <div class="cp-payment-icon-circle">
        <i data-lucide="dollar-sign"></i>
      </div>
      <div class="cp-payment-text-wrap">
        <span class="cp-payment-label-redesign">${localText("amountToPay")}</span>
        <strong class="cp-payment-amount-redesign">${hasPending ? money(pendingBalance) : money(0)}</strong>
        <p class="cp-payment-desc-redesign">${hasPending ? `${localText("paymentMethodExpected")}: ${client.paymentMethod || '—'}` : localText("noPendingBalance")}</p>
      </div>
    </div>

    <div class="cp-checklist-rows-redesign">
      ${mkRow("file-text", t("serviceStatus") || "Estado del servicio", `<span class="cp-job-status-badge ${jobStatus?.cls || ''}" style="padding: 2px 8px; border-radius: 99px;">${jobStatus?.label || job.status}</span>`)}
      ${mkRow("clock", t("cleanerArrival") || "Llegada del cleaner", job.checkedIn ? job.start : pendingText)}
      ${mkRow("clock", t("cleanerDeparture") || "Salida del cleaner", job.checkedOut ? (job.actualEnd || job.end) : pendingText)}
      ${mkRow("camera", t("visiblePhotos") || "Fotos visibles", `<strong>${evidenceCount(job)}</strong>`)}
      ${mkRow("help-circle", t("cleanerFinished") || "Cleaner marco terminado", (job.cleanerFinished || job.checkedOut) ? doneText : pendingText)}
      ${mkRow("check-circle", t("clientConfirmation") || "Confirmacion del cliente", job.clientConfirmed ? doneText : pendingText)}
      ${mkRow("edit-3", t("clientSignature") || "Firma del cliente", job.clientSignature ? doneText : pendingText)}
      ${mkRow("edit-3", t("onsiteSignature") || "Firma en sitio", job.siteSignature ? `${doneText} ${job.siteSignerName || ''}` : pendingText)}
      ${mkRow("clipboard-list", t("checklist") || "Checklist", `<span class="cp-tasks">${(job.tasks || []).join(", ") || '—'}</span>`)}
    </div>

    ${!hasPayableAmount ? `
      <div class="cp-blocked-service-card">
        <div class="cp-blocked-icon">
          <i data-lucide="lock"></i>
        </div>
        <div class="cp-blocked-text">
          <strong>${t("serviceLocked") || "Servicio bloqueado"}</strong>
          <p>Este servicio estará disponible para registro de horas reales al momento de entrada y salida.</p>
        </div>
      </div>
    ` : ''}

    <button class="primary cp-confirm-btn" id="clientPortalConfirmButton" ${!clientCanConfirmJob(job) ? 'disabled' : ''} data-i18n="confirmServiceCompleted" style="margin-top: 16px;">
      ${job.clientConfirmed ? t("serviceConfirmed") : hasPayableAmount ? t("confirmServiceCompleted") : blockedText}
    </button>
  ` : `
    <span class="cp-summary-eyebrow-redesign">Cliente</span>
    <h2 class="cp-summary-title-redesign">${t("privateServiceSummary")}</h2>
    <div class="cp-client-info-empty" style="margin-top: 16px; display: flex; align-items: center; gap: 12px;">
      <div class="cp-client-avatar">${initials}</div>
      <strong style="color: #fff;">${client.name}</strong>
    </div>
    <div class="cp-payment-card-redesign ${hasPending ? '' : 'cp-payment-locked'}" style="margin-top: 20px;">
      <div class="cp-payment-icon-circle">
        <i data-lucide="dollar-sign"></i>
      </div>
      <div class="cp-payment-text-wrap">
        <span class="cp-payment-label-redesign">${localText("amountToPay")}</span>
        <strong class="cp-payment-amount-redesign">${hasPending ? money(pendingBalance) : money(0)}</strong>
        <p class="cp-payment-desc-redesign">${hasPending ? `${localText("paymentMethodExpected")}: ${client.paymentMethod || '—'}` : localText("noPendingBalance")}</p>
      </div>
    </div>
    <p class="muted" style="margin-top:16px;">${t("portalHistoryAvailable")}</p>
    <button class="primary cp-confirm-btn" id="clientPortalConfirmButton" disabled>${t("noActiveService")}</button>
  `;

  // Activity timeline (right column)
  const activityEl = $("#clientPortalActivity");
  if (activityEl) {
    if (!job) {
      activityEl.innerHTML = "<p class='muted'>Sin actividad reciente.</p>";
    } else {
      const activities = [
        { icon: "👤", color: "cp-act-green", label: t("serviceAssigned") || "Servicio asignado", detail: `${client.name}`, time: job.date, show: true },
        { icon: "📅", color: "cp-act-blue", label: t("scheduledJob") || "Trabajo programado", detail: `${job.date} • ${job.start}–${job.end || '—'}`, time: job.date, show: true },
        { icon: "🔔", color: "cp-act-orange", label: t("cleanerArrival") || "Pendiente de llegada", detail: job.checkedIn ? `Llegó a las ${job.start}` : "El cleaner registrará su entrada al llegar al sitio.", time: "", show: true },
        { icon: "📷", color: "cp-act-purple", label: t("visiblePhotos") || "Pendiente de fotos", detail: evidenceCount(job) > 0 ? `${evidenceCount(job)} fotos subidas` : "Las fotos se cargarán al finalizar cada área del checklist.", time: "", show: true },
        { icon: "✅", color: "cp-act-teal", label: t("clientConfirmation") || "Pendiente de confirmación", detail: job.clientConfirmed ? "Servicio confirmado" : "El cliente deberá confirmar la finalización del servicio.", time: "", show: true },
        { icon: "✍", color: "cp-act-gray", label: t("clientSignature") || "Pendiente de firma", detail: job.clientSignature ? "Firma registrada" : "Se solicitará firma digital en el sitio.", time: "", show: true },
      ];
      activityEl.innerHTML = activities.filter(a => a.show).map(a => `
        <div class="cp-act-item">
          <div class="cp-act-icon ${a.color}">${a.icon}</div>
          <div class="cp-act-body">
            <strong>${a.label}</strong>
            <span>${a.detail}</span>
            ${a.time ? `<time>${a.time}</time>` : ''}
          </div>
        </div>
      `).join("");
    }
  }

  // Photos (Evidence)
  const photosEl = $("#clientPortalPhotos");
  if (photosEl) {
    if (job && job.photos > 0) {
      photosEl.innerHTML = photoSectionsHtml(job);
    } else {
      photosEl.innerHTML = `
        <div class="cp-empty-evidence-card">
          <div class="cp-empty-image-wrap">
            <i data-lucide="image" class="cp-empty-image-icon"></i>
          </div>
          <strong>Aún no hay fotos cargadas</strong>
          <p>Las fotos y evidencias serán visibles aquí una vez que se carguen.</p>
          <button class="ghost cp-history-btn" type="button" onclick="document.querySelector('.cp-history-panel-separate').scrollIntoView({ behavior: 'smooth' })">
            <i data-lucide="folder-open"></i>
            Ver historial de evidencias &gt;
          </button>
        </div>
      `;
    }
  }

  // History List
  const historyEl = $("#clientPortalHistoryList");
  if (historyEl) {
    historyEl.innerHTML = clientHistoryTimelineHtml(historyJobs, job);
  }

  bindPhotoActions();

  // Instantiate Lucide icons
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function renderStandaloneCleanerPortal(unlocked = true) {
  const cleaner = state.cleaners.find((item) => item.id === portalCleanerId);
  if (!cleaner) {
    $("#cleanerPortalLock").classList.remove("hidden");
    $("#cleanerPortalContent").classList.add("hidden");
    toast("Acceso de cleaner no encontrado. Copia el link actualizado desde Cleaners.");
    return;
  }
  const assignedJobs = portalCleanerAdmin ? state.jobs.filter((job) => job.cleanerId) : state.jobs.filter((job) => job.cleanerId === cleaner.id);
  const openJobs = state.jobs.filter((job) => !job.cleanerId || job.status === "Disponible para tomar");
  const completedJobs = assignedJobs.filter((job) => job.checkedOut || job.cleanerFinished);
  const activeAssignedJobs = assignedJobs.filter((job) => !job.checkedOut && !job.cleanerFinished);
  const reportMonths = monthOptionsForJobs(assignedJobs);
  if (!cleanerReportMonth || !reportMonths.includes(cleanerReportMonth)) cleanerReportMonth = currentMonthKey();
  const workedJobs = assignedJobs.filter((job) => String(job.date || "").slice(0, 7) === cleanerReportMonth && isBillableDone(job));
  const totalMinutes = workedJobs.reduce((sum, job) => sum + billableMinutes(job), 0);
  const totalHours = totalMinutes / 60;
  const earned = workedJobs.reduce((sum, job) => sum + cleanerCostForJob(job), 0);
  const todayWorkedJobs = workedJobs.filter((job) => job.date === today());
  const todayMinutes = todayWorkedJobs.reduce((sum, job) => sum + billableMinutes(job), 0);
  const todayEarned = todayWorkedJobs.reduce((sum, job) => sum + cleanerCostForJob(job), 0);
  const cleanerReceipts = receiptsForCleaner(cleaner);
  $("#cleanerPortalLock").classList.toggle("hidden", unlocked);
  $("#cleanerPortalContent").classList.toggle("hidden", !unlocked);
  $("#cleanerPortalPage").classList.toggle("is-unlocked", unlocked);
  $("#cleanerPortalTitle").textContent = portalCleanerAdmin ? "Vista administrador de cleaners" : `Hola, ${cleaner.name}`;
  // Update greeting and avatar with real name
  const cleanerFirstName = (cleaner.name || "").split(" ")[0];
  const cleanerInitials = (cleaner.name || "?").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  if ($("#cleanerWelcomeGreeting")) $("#cleanerWelcomeGreeting").textContent = `Hola, ${cleanerFirstName} \u{1F44B}`;
  if ($("#cleanerWidgetName")) $("#cleanerWidgetName").textContent = cleaner.name;
  const avatarEl = document.querySelector(".widget-avatar");
  if (avatarEl) {
    avatarEl.innerHTML = cleaner.photo
      ? `<img src="${cleaner.photo}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" alt="">`
      : cleanerInitials;
  }
  const historyAdminActive = isCleanerHistoryAdminActive();
  $("#cleanerHistoryAdminBox").classList.toggle("is-unlocked", historyAdminActive || portalCleanerAdmin);
  $("#cleanerHistoryAdminBox").querySelector("p").textContent = (historyAdminActive || portalCleanerAdmin)
    ? portalCleanerAdmin
      ? "Acceso maestro activo. Puedes agregar fotos a trabajos cerrados."
      : `Permiso activo por ${cleanerHistoryAdminTimeLeftLabel()}. Puedes agregar fotos a trabajos cerrados.`
    : "Para agregar fotos a trabajos cerrados, ingresa la clave administrativa.";
  const todayStr = today();
  const urgentJobs = activeAssignedJobs.filter(j => j.date <= todayStr);
  const hasPriority = urgentJobs.length > 0;
  const lastWeekJobs = assignedJobs.filter(j => {
    if (!isBillableDone(j)) return false;
    const d = new Date(j.date || "");
    const diff = (new Date() - d) / (1000 * 60 * 60 * 24);
    return diff >= 7 && diff < 14;
  });
  const lastWeekMinutes = lastWeekJobs.reduce((s, j) => s + billableMinutes(j), 0);
  const trendLabel = lastWeekMinutes > 0
    ? (totalMinutes > lastWeekMinutes
      ? `\u2197 ${Math.round(((totalMinutes - lastWeekMinutes) / lastWeekMinutes) * 100)}% m\u00e1s que sem. pasada`
      : `\u2198 ${Math.round(((lastWeekMinutes - totalMinutes) / lastWeekMinutes) * 100)}% menos que sem. pasada`)
    : (totalMinutes > 0 ? "\u2197 \u00a1Buen trabajo!" : "\u2014 Sin registros hoy");
  const kpiHtml = `
    <article class="cleaner-kpi-card${hasPriority ? ' kpi-alert' : ''}">
      <div class="kpi-icon-wrap"><span class="kpi-icon">\u{1F4CB}</span></div>
      <div class="kpi-body">
        <span class="kpi-label">Pendientes</span>
        <strong class="kpi-value">${activeAssignedJobs.length}</strong>
        <small class="kpi-note">por hacer</small>
      </div>
      ${hasPriority ? `<span class="kpi-badge kpi-badge-red">\u2691 Prioridad alta: ${urgentJobs.length}</span>` : ''}
    </article>
    <article class="cleaner-kpi-card">
      <div class="kpi-icon-wrap"><span class="kpi-icon">\u23F1</span></div>
      <div class="kpi-body">
        <span class="kpi-label">Hoy trabajado</span>
        <strong class="kpi-value">${minutesLabel(todayMinutes)}</strong>
        <small class="kpi-note">${money(todayEarned)} estimado</small>
      </div>
      <span class="kpi-trend ${todayMinutes > 0 ? 'kpi-trend-up' : 'kpi-trend-neutral'}">${todayMinutes > 0 ? '\u2197 Activo hoy' : '\u2014 Sin registros hoy'}</span>
    </article>
    <article class="cleaner-kpi-card">
      <div class="kpi-icon-wrap"><span class="kpi-icon">\u{1F4C5}</span></div>
      <div class="kpi-body">
        <span class="kpi-label">Mes trabajado</span>
        <strong class="kpi-value">${minutesLabel(totalMinutes)}</strong>
        <small class="kpi-note">${money(earned)} estimado</small>
      </div>
      <span class="kpi-trend ${totalMinutes >= lastWeekMinutes ? 'kpi-trend-up' : 'kpi-trend-down'}">${trendLabel}</span>
    </article>
    <article class="cleaner-kpi-card">
      <div class="kpi-icon-wrap"><span class="kpi-icon">\u2705</span></div>
      <div class="kpi-body">
        <span class="kpi-label">Terminados</span>
        <strong class="kpi-value">${completedJobs.length}</strong>
        <small class="kpi-note">listos para confirmar</small>
      </div>
      <span class="kpi-trend ${completedJobs.length > 0 ? 'kpi-trend-up' : 'kpi-trend-neutral'}">${completedJobs.length > 0 ? '\u2197 \u00a1Buen trabajo!' : '\u2014 Sin completados'}</span>
    </article>
  `;
  $("#cleanerStats").innerHTML = kpiHtml;
  if (portalCleanerAdmin) {
    $("#cleanerStats").insertAdjacentHTML("afterbegin", `
      <article class="cleaner-kpi-card admin-stat">
        <div class="kpi-icon-wrap"><span class="kpi-icon">\u{1F451}</span></div>
        <div class="kpi-body">
          <span class="kpi-label">Acceso maestro</span>
          <strong class="kpi-value">${state.cleaners.length}</strong>
          <small class="kpi-note">cleaners visibles</small>
        </div>
      </article>
    `);
  }
  // Render recent activity timeline
  const recentEl = $("#cleanerRecentActivity");
  if (recentEl) {
    const allJobsForCleaner = portalCleanerAdmin ? state.jobs : state.jobs.filter(j => j.cleanerId === cleaner.id);
    const recent = [...allJobsForCleaner]
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
      .slice(0, 5);
    if (recent.length === 0) {
      recentEl.innerHTML = "<p class='muted'>Sin actividad reciente.</p>";
    } else {
      recentEl.innerHTML = recent.map(job => {
        const client = clientFor(job);
        const isDone = job.checkedOut || job.cleanerFinished;
        const hasPhotos = evidenceCount(job) > 0;
        const isCheckedIn = job.checkedIn;
        let iconClass = "take";
        let iconEmoji = "\u{1F4CB}";
        let actLabel = "Trabajo asignado";
        if (isDone) { iconClass = "completed"; iconEmoji = "\u2705"; actLabel = "Trabajo completado"; }
        else if (hasPhotos) { iconClass = "photos"; iconEmoji = "\u{1F4F7}"; actLabel = "Fotos subidas"; }
        else if (isCheckedIn) { iconClass = "checkin"; iconEmoji = "\u{1F4CD}"; actLabel = "Check-in registrado"; }
        return `
          <div class="timeline-item">
            <span class="timeline-icon ${iconClass}">${iconEmoji}</span>
            <div class="timeline-info">
              <strong>${actLabel}</strong>
              <span>${client.name} \u2022 ${job.date} \u2022 ${job.start || ""}</span>
            </div>
            <span class="timeline-time">${job.date || ""}</span>
          </div>
        `;
      }).join("");
    }
  }
  $("#cleanerAssignedJobs").innerHTML = activeAssignedJobs.length ? activeAssignedJobs.map(cleanerJobHtml).join("") : "<p class='muted'>No tienes trabajos activos. Los terminados estan en historial.</p>";
  $("#cleanerHistoryJobs").innerHTML = completedJobs.length ? completedJobs.map(cleanerHistoryHtml).join("") : "<p class='muted'>Todavia no hay trabajos terminados.</p>";
  $("#cleanerCalendar").innerHTML = cleanerCalendarHtml(assignedJobs);
  $("#cleanerHoursReport").innerHTML = cleanerHoursHtml(workedJobs, totalMinutes);
  $("#cleanerPaymentReceipts").innerHTML = cleanerPaymentsHtml(cleanerReceipts);
  $("#cleanerReportMonth").innerHTML = reportMonths.map((monthKey) => `<option value="${monthKey}">${monthLabelFromKey(monthKey)}</option>`).join("");
  $("#cleanerReportMonth").value = cleanerReportMonth;
  $("#cleanerMoneyReport").innerHTML = cleanerMoneyHtml(workedJobs, earned, cleanerReportMonth);
  $("#cleanerOpenJobs").innerHTML = openJobs.length ? openJobs.map((job) => {
    const client = clientFor(job);
    return `
      <article class="client-item">
        <strong>${client.name}</strong>
        <span class="client-meta">${job.date} - ${job.start}-${job.end || "por definir"} - ${client.address}</span>
        ${portalCleanerAdmin
          ? `<button class="ghost" type="button" data-admin-edit-job="${job.id}">Editar desde admin</button>`
          : `<button class="primary" type="button" data-take-job="${job.id}">Tomar trabajo</button>`}
      </article>
    `;
  }).join("") : "<p class='muted'>No hay trabajos abiertos para tomar.</p>";
  $$("[data-admin-edit-job]").forEach((button) => {
    button.addEventListener("click", () => {
      $("#cleanerPortalPage").classList.add("hidden");
      $("#appShell").classList.remove("hidden");
      startJobEdit(button.dataset.adminEditJob);
    });
  });
  $$("[data-take-job]").forEach((button) => {
    button.addEventListener("click", async () => {
      const job = state.jobs.find((item) => item.id === button.dataset.takeJob);
      if (!job) return;
      job.cleanerId = cleaner.id;
      job.status = "Asignado";
      save();

      if (supabaseClient) {
        try {
          await supabaseClient.from("jobs").update({
            assigned_cleaner_id: cleaner.id,
            status: "scheduled"
          }).eq("id", job.id);
        } catch (err) {
          console.error("Error taking job in portal mode:", err);
        }
      }

      renderStandaloneCleanerPortal(true);
      toast("Trabajo asignado a tu portal.");
    });
  });
  $$("[data-cleaner-tab]").forEach((button) => {
    button.addEventListener("click", () => setCleanerTab(button.dataset.cleanerTab));
  });
  $("#cleanerReportMonth").onchange = (event) => {
    cleanerReportMonth = event.target.value || currentMonthKey();
    renderStandaloneCleanerPortal(true);
    setCleanerTab("report");
  };
  $$("[data-cleaner-history-evidence-form]").forEach((form) => {
    form.addEventListener("submit", handleCleanerHistoryEvidenceSubmit);
  });
  $$("[data-cleaner-sign-payment]").forEach((button) => {
    button.addEventListener("click", () => openSignatureModal(button.dataset.cleanerSignPayment));
  });
  $$("[data-cleaner-arrived]").forEach((button) => {
    button.addEventListener("click", async () => {
      const job = state.jobs.find((item) => item.id === button.dataset.cleanerArrived);
      if (!job) return;
      if (cleanerActionsLocked(job)) {
        toast("Este trabajo es futuro. Los botones se activan el dia del servicio.");
        return;
      }
      if (job.checkedIn && !portalCleanerAdmin) {
        toast(`Llegada ya registrada a las ${job.start}.`);
        return;
      }
      job.checkedIn = true;
      job.start = currentTime();
      job.status = "En sitio";
      save();

      if (supabaseClient) {
        try {
          const scheduledStart = `${job.date}T${job.start}:00Z`;
          await supabaseClient.from("jobs").update({
            status: "in_site",
            scheduled_start: scheduledStart
          }).eq("id", job.id);
        } catch (err) {
          console.error("Error saving arrival in portal mode:", err);
        }
      }

      renderStandaloneCleanerPortal(true);
      toast("Llegada marcada y visible para el cliente.");
    });
  });
  $$("[data-cleaner-photo]").forEach((button) => {
    button.addEventListener("click", () => {
      const job = state.jobs.find((item) => item.id === button.dataset.cleanerPhoto);
      if (!job) return;
      if (cleanerActionsLocked(job)) {
        toast("Podras agregar fotos el dia del servicio.");
        return;
      }
      if (!job.checkedIn && !portalCleanerAdmin) {
        toast("Primero marca tu llegada para que el cliente vea la hora real.");
        return;
      }
      const form = document.querySelector(`[data-evidence-form="${job.id}"]`);
      form?.scrollIntoView({ behavior: "smooth", block: "center" });
      form?.querySelector('input[type="file"]')?.click();
    });
  });
  $$("[data-evidence-form]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const job = state.jobs.find((item) => item.id === form.dataset.evidenceForm);
      if (!job) return;
      if (cleanerActionsLocked(job)) {
        toast("La evidencia se habilita el dia del servicio.");
        return;
      }
      if (!job.checkedIn && !portalCleanerAdmin) {
        toast("Primero marca tu llegada antes de subir fotos.");
        return;
      }
      const data = new FormData(form);
      const evidenceId = data.get("evidenceId");
      const files = data.getAll("photo").filter((file) => file instanceof File && file.size);
      const section = data.get("section") || "General";
      const phase = data.get("phase") || "Antes";
      const comment = data.get("comment") || "";
      if (evidenceId) {
        const photo = evidenceFor(job).find((item) => item.id === evidenceId);
        if (!photo) return;
        photo.section = section;
        photo.phase = phase;
        photo.comment = comment;
        if (files[0]) {
          photo.url = await compressImageFile(files[0]);
          photo.fileName = files[0].name;
        }
        save();

        if (supabaseClient) {
          try {
            const dbPhase = photo.phase === "Antes" ? "before" : "after";
            await supabaseClient.from("job_evidence").upsert({
              id: photo.id,
              organization_id: job.organizationId || state.orgId,
              job_id: job.id,
              area: photo.section,
              phase: dbPhase,
              file_path: photo.url,
              caption: photo.comment
            });
          } catch (err) {
            console.error("Error updating evidence in portal mode:", err);
          }
        }

        renderStandaloneCleanerPortal(true);
        toast("Evidencia corregida.");
        return;
      }
      if (!files.length) {
        toast("Elige una o varias fotos de la camara o biblioteca.");
        return;
      }
      const createdAt = new Date().toISOString();
      for (const file of files) {
        const compressedUrl = await compressImageFile(file);
        const newEv = {
          id: safeId(),
          section,
          phase,
          comment,
          url: compressedUrl,
          fileName: file.name,
          createdAt
        };
        evidenceFor(job).push(newEv);

        if (supabaseClient) {
          try {
            const dbPhase = newEv.phase === "Antes" ? "before" : "after";
            await supabaseClient.from("job_evidence").insert({
              id: newEv.id,
              organization_id: job.organizationId || state.orgId,
              job_id: job.id,
              area: newEv.section,
              phase: dbPhase,
              file_path: newEv.url,
              caption: newEv.comment
            });
          } catch (err) {
            console.error("Error inserting evidence in portal mode:", err);
          }
        }
      }
      job.photos = evidenceCount(job);
      save();
      renderStandaloneCleanerPortal(true);
      toast(`${files.length} foto${files.length === 1 ? "" : "s"} guardada${files.length === 1 ? "" : "s"} y visible${files.length === 1 ? "" : "s"} para el cliente.`);
    });
  });
  $$("[data-edit-photo]").forEach((button) => {
    button.addEventListener("click", () => {
      const found = findEvidence(button.dataset.editPhoto);
      if (!found) return;
      const form = document.querySelector(`[data-evidence-form="${found.job.id}"]`);
      if (!form) return;
      form.elements.evidenceId.value = found.photo.id;
      form.elements.section.value = found.photo.section || "";
      form.elements.phase.value = found.photo.phase || "Antes";
      form.elements.comment.value = found.photo.comment || "";
      form.querySelector('button[type="submit"]').textContent = "Guardar correccion";
      form.querySelector("[data-cancel-evidence-edit]")?.classList.remove("hidden");
      form.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  });
  $$("[data-cancel-evidence-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      const form = document.querySelector(`[data-evidence-form="${button.dataset.cancelEvidenceEdit}"]`);
      if (!form) return;
      form.reset();
      form.elements.evidenceId.value = "";
      form.querySelector('button[type="submit"]').textContent = "Guardar evidencia";
      button.classList.add("hidden");
    });
  });
  $$("[data-cleaner-finish]").forEach((button) => {
    button.addEventListener("click", async () => {
      const job = state.jobs.find((item) => item.id === button.dataset.cleanerFinish);
      if (!job) return;
      if (cleanerActionsLocked(job)) {
        toast("Este trabajo se puede terminar solo el dia del servicio.");
        return;
      }
      if (!job.checkedIn && !portalCleanerAdmin) {
        toast("No puedes terminar sin marcar llegada primero.");
        return;
      }
      if (!evidenceCount(job) && !confirm("Todavia no subiste fotos. Puedes terminar, pero el cliente no vera evidencia. Deseas continuar?")) return;
      if (portalCleanerAdmin && !job.checkedIn) {
        job.checkedIn = true;
        job.start = job.start || currentTime();
      }
      job.checkedOut = true;
      job.cleanerFinished = true;
      job.actualEnd = currentTime();
      job.status = portalCleanerAdmin ? "Terminado por administrador" : "Terminado por cleaner";
      save();

      if (supabaseClient) {
        try {
          const actualEnd = `${job.date}T${job.actualEnd}:00Z`;
          const scheduledStart = `${job.date}T${job.start}:00Z`;
          const statusStr = portalCleanerAdmin ? "Terminado por administrador" : "cleaner_finished";
          await supabaseClient.from("jobs").update({
            status: statusStr,
            scheduled_start: scheduledStart,
            actual_end: actualEnd
          }).eq("id", job.id);
        } catch (err) {
          console.error("Error finishing job in portal mode:", err);
        }
      }

      renderStandaloneCleanerPortal(true);
      openJobSignatureModal(job.id);
      toast(portalCleanerAdmin ? "Trabajo terminado por administrador. Falta firma en sitio." : "Trabajo terminado. Falta firma en sitio.");
    });
  });
  bindCleanerAdminCorrections();
  bindPhotoActions(true);
}

function setCleanerTab(tabName = "summary") {
  $$("[data-cleaner-tab]").forEach((button) => button.classList.toggle("active", button.dataset.cleanerTab === tabName));
  const map = {
    summary: "#cleanerTabSummary",
    jobs: "#cleanerTabJobs",
    calendar: "#cleanerTabCalendar",
    hours: "#cleanerTabHours",
    payments: "#cleanerTabPayments",
    report: "#cleanerTabReport"
  };
  Object.values(map).forEach((selector) => $(selector)?.classList.remove("active"));
  $(map[tabName] || map.summary)?.classList.add("active");
}

async function handleCleanerHistoryEvidenceSubmit(event) {
  event.preventDefault();
  if (!isCleanerHistoryAdminActive() && !portalCleanerAdmin) {
    toast("Necesitas activar permiso admin para editar fotos historicas.");
    renderStandaloneCleanerPortal(true);
    setCleanerTab("jobs");
    return;
  }
  const form = event.currentTarget;
  const job = state.jobs.find((item) => item.id === form.dataset.cleanerHistoryEvidenceForm);
  if (!job) return;
  const data = new FormData(form);
  const files = data.getAll("photo").filter((file) => file instanceof File && file.size);
  if (!files.length) {
    toast("Elige una o varias fotos para agregar al historial.");
    return;
  }
  const section = data.get("section") || "General";
  const phase = data.get("phase") || "Antes";
  const comment = data.get("comment") || "Foto historica agregada con permiso admin.";
  const createdAt = new Date().toISOString();
  for (const file of files) {
    const compressedUrl = await compressImageFile(file);
    const newEv = {
      id: safeId(),
      section,
      phase,
      comment: `Admin: ${comment}`,
      url: compressedUrl,
      fileName: file.name,
      createdAt,
      source: "admin-history"
    };
    evidenceFor(job).push(newEv);

    if (supabaseClient) {
      try {
        const dbPhase = newEv.phase === "Antes" ? "before" : "after";
        await supabaseClient.from("job_evidence").insert({
          id: newEv.id,
          organization_id: job.organizationId || state.orgId,
          job_id: job.id,
          area: newEv.section,
          phase: dbPhase,
          file_path: newEv.url,
          caption: newEv.comment
        });
      } catch (err) {
        console.error("Error inserting historical evidence in portal mode:", err);
      }
    }
  }
  job.photos = evidenceCount(job);
  save();
  renderStandaloneCleanerPortal(true);
  setCleanerTab("jobs");
  toast(`${files.length} foto${files.length === 1 ? "" : "s"} agregada${files.length === 1 ? "" : "s"} al historial.`);
}

function closeJobByAdmin(job, start, end) {
  if (!job) return;
  job.start = start || job.start || currentTime();
  job.actualEnd = end || job.actualEnd || job.end || currentTime();
  job.checkedIn = true;
  job.checkedOut = true;
  job.cleanerFinished = true;
  job.status = "Terminado por administrador";
}

function completeJobByAdmin(jobId) {
  const job = state.jobs.find((item) => item.id === jobId);
  if (!job) return;
  if (!window.confirm("Seguro que quieres cerrar este trabajo como terminado por administrador?")) return;
  closeJobByAdmin(job);
  save();
  renderAll();
  if (!$("#cleanerPortalPage")?.classList.contains("hidden")) renderStandaloneCleanerPortal(true);
  toast("Trabajo cerrado como terminado por administrador.");
}

function bindCleanerAdminCorrections() {
  if (!portalCleanerAdmin) return;
  $$("[data-admin-save-job]").forEach((button) => {
    button.addEventListener("click", () => {
      const job = state.jobs.find((item) => item.id === button.dataset.adminSaveJob);
      if (!job) return;
      const start = document.querySelector(`[data-admin-start="${job.id}"]`)?.value;
      const end = document.querySelector(`[data-admin-end="${job.id}"]`)?.value;
      if (start) {
        job.start = start;
        job.checkedIn = true;
        if (!isDone(job)) job.status = "En sitio";
      }
      if (end) closeJobByAdmin(job, start, end);
      save();
      renderAll();
      renderStandaloneCleanerPortal(true);
      toast(end ? "Horas guardadas y trabajo cerrado por administrador." : "Llegada corregida por administrador.");
    });
  });
  $$("[data-admin-finish-job]").forEach((button) => {
    button.addEventListener("click", () => completeJobByAdmin(button.dataset.adminFinishJob));
  });
}

function cleanerJobHtml(job) {
  const client = clientFor(job);
  const cleanerName = state.cleaners.find((item) => item.id === job.cleanerId)?.name || "Sin asignar";
  const actionsLocked = cleanerActionsLocked(job);
  const actionDisabled = actionsLocked ? "disabled" : "";
  const formDisabled = actionsLocked ? "disabled" : "";
  const arrivedDisabled = (actionsLocked || (job.checkedIn && !portalCleanerAdmin)) ? "disabled" : "";
  const arrivedText = job.checkedIn ? `Llegada ${job.start}` : "Ya llegue";
  const finishedDisabled = (actionsLocked || ((job.checkedOut || job.cleanerFinished) && !portalCleanerAdmin)) ? "disabled" : "";
  const finishedText = job.checkedOut || job.cleanerFinished ? `Terminado ${job.actualEnd || ""}` : "Termine";
  const areaOptions = [...new Set([...(job.tasks || []), ...evidenceFor(job).map((item) => item.section).filter(Boolean)])];
  const areaListId = `areas-${job.id}`;
  return `
    <article class="client-item">
      <strong>${client.name}</strong>
      <span class="client-meta">${job.date} - ${job.start}-${job.actualEnd || job.end || "por definir"} - ${job.status}</span>
      ${portalCleanerAdmin ? `<span class="client-meta">Cleaner: ${cleanerName}</span>` : ""}
      <span class="client-meta">${client.address}</span>
      ${portalCleanerAdmin ? `
        <div class="admin-correction-box">
          <strong>Correccion de administrador</strong>
          <div class="admin-correction-grid">
            <label>Llegada
              <input type="time" data-admin-start="${job.id}" value="${job.start || ""}">
            </label>
            <label>Salida real
              <input type="time" data-admin-end="${job.id}" value="${job.actualEnd || ""}">
            </label>
            <button class="mini-action" type="button" data-admin-save-job="${job.id}">Guardar horas</button>
            <button class="mini-action danger" type="button" data-admin-finish-job="${job.id}">Terminar por admin</button>
          </div>
        </div>
      ` : ""}
      ${isOverdueLive(job) ? `<div class="arrival-alert">Este trabajo esta pasado de la hora estimada. Revisa si debes terminarlo o avisar a la administracion.</div>` : ""}
      ${shouldRemindArrival(job) ? `<div class="arrival-alert">Ya es hora del servicio. Marca tu llegada ahora para que quede registrada para el cliente.</div>` : ""}
      ${actionsLocked ? `<div class="future-job-alert">Trabajo programado para el futuro. Las acciones se activan automaticamente el mismo dia del servicio.</div>` : ""}
      <div class="work-brief">
        <strong>Que hacer</strong>
        <p>${job.serviceType}. Checklist: ${(job.tasks || []).join(", ") || "sin checklist"}.</p>
        <p>Primero revisa instrucciones, marca llegada una sola vez, sube fotos antes/despues por area y confirma salida al terminar.</p>
      </div>
      <div class="receipt-actions">
        <button class="mini-action" type="button" data-cleaner-arrived="${job.id}" ${arrivedDisabled}>${arrivedText}</button>
        <button class="mini-action" type="button" data-cleaner-photo="${job.id}" ${actionDisabled}>Agregar foto</button>
        <button class="mini-action" type="button" data-cleaner-finish="${job.id}" ${finishedDisabled}>${finishedText}</button>
      </div>
      <form class="evidence-form ${actionsLocked ? "is-locked" : ""}" data-evidence-form="${job.id}">
        <input type="hidden" name="evidenceId">
        <label>Area o lugar
          <input name="section" list="${areaListId}" placeholder="Ej: Kitchen, bathroom, escritorio" required ${formDisabled}>
          <datalist id="${areaListId}">
            ${areaOptions.map((task) => `<option value="${escapeHtml(task)}"></option>`).join("")}
          </datalist>
        </label>
        <label>Momento
          <select name="phase" ${formDisabled}>
            <option>Antes</option>
            <option>Despues</option>
          </select>
        </label>
        <label>Comentario <input name="comment" placeholder="Ej: grasa en cocina, ventana terminada..." ${formDisabled}></label>
        <label>Camara o biblioteca <input name="photo" type="file" accept="image/*" capture="environment" multiple ${formDisabled}></label>
        <div class="form-actions">
          <button class="primary" type="submit" ${formDisabled}>Guardar evidencia</button>
          <button class="ghost hidden" type="button" data-cancel-evidence-edit="${job.id}">Cancelar correccion</button>
        </div>
      </form>
      ${photoBoardHtml(job, true, { canDelete: true })}
    </article>
  `;
}

function cleanerHistoryHtml(job) {
  const client = clientFor(job);
  const canAdminEditHistory = isCleanerHistoryAdminActive() || portalCleanerAdmin;
  const areaOptions = [...new Set([...(job.tasks || []), ...evidenceFor(job).map((item) => item.section).filter(Boolean)])];
  const areaListId = `history-areas-${job.id}`;
  return `
    <details class="history-job">
      <summary>
        <strong>${client.name}</strong>
        <span>${job.date} - ${job.start}-${job.actualEnd || job.end || "por definir"} - ${money(cleanerCostForJob(job))}</span>
      </summary>
      <div class="history-body">
        <p class="muted">${client.address}</p>
        <p>Tiempo trabajado: <strong>${minutesLabel(billableMinutes(job))}</strong></p>
        <p>Estado: <strong>${job.status}</strong></p>
        <p>Fotos: <strong>${evidenceCount(job)}</strong></p>
        <p>Firma en sitio: <strong>${job.siteSignature ? `recibida de ${job.siteSignerName || "persona en sitio"}` : "pendiente"}</strong></p>
        ${canAdminEditHistory ? `
          <form class="evidence-form history-evidence-form" data-cleaner-history-evidence-form="${job.id}">
            <label>Area o lugar
              <input name="section" list="${areaListId}" placeholder="Ej: Kitchen, bathroom, escritorio" required>
              <datalist id="${areaListId}">
                ${areaOptions.map((task) => `<option value="${escapeHtml(task)}"></option>`).join("")}
              </datalist>
            </label>
            <label>Momento
              <select name="phase">
                <option>Antes</option>
                <option>Despues</option>
              </select>
            </label>
            <label>Comentario <input name="comment" placeholder="Ej: foto agregada con permiso admin..."></label>
            <label>Fotos <input name="photo" type="file" accept="image/*" multiple></label>
            <div class="form-actions">
              <button class="primary" type="submit">Agregar fotos al historial</button>
            </div>
          </form>
        ` : `
          <div class="future-job-alert">Fotos historicas bloqueadas. Requiere clave admin para corregir evidencia.</div>
        `}
        ${photoBoardHtml(job, true)}
      </div>
    </details>
  `;
}

function cleanerCalendarHtml(jobs) {
  const upcoming = [...jobs]
    .filter((job) => !isDone(job))
    .sort((a, b) => `${a.date} ${a.start}`.localeCompare(`${b.date} ${b.start}`))
    .slice(0, 16);
  if (!upcoming.length) return "<p class='muted'>No tienes trabajos pendientes en calendario. Los terminados quedan en Historial.</p>";
  return `
    <div class="mini-calendar-list">
      ${upcoming.map((job) => {
        const client = clientFor(job);
        const fullAddress = fullAddressForClient(client);
        const mapsUrl = mapsUrlForClient(client);
        return `
          <article class="calendar-mini-card ${isDone(job) ? "done" : ""}">
            <span>${new Date(`${job.date}T00:00:00`).toLocaleDateString("es", { day: "2-digit", month: "short" })}</span>
            <div>
              <strong>${client.name}</strong>
              <p>${job.start}-${job.actualEnd || job.end || t("undefinedTime")} - ${jobStatusLabel(job)}</p>
              <p>${fullAddress}</p>
              <a class="map-link" href="${mapsUrl}" target="_blank" rel="noreferrer">Abrir en Google Maps</a>
            </div>
          </article>
        `;
      }).join("")}
    </div>
  `;
}

function cleanerHoursHtml(jobs, totalMinutes) {
  if (!jobs.length) return "<p class='muted'>Cuando marques llegada y salida, aqui se veran tus horas reales.</p>";
  return `
    <div class="report-line"><span>Total del mes</span><strong>${minutesLabel(totalMinutes)}</strong></div>
    <div class="hour-list">
      ${jobs.map((job) => {
        const client = clientFor(job);
        return `<div class="report-line"><span>${client.name} - ${job.date}</span><strong>${minutesLabel(billableMinutes(job))}</strong></div>`;
      }).join("")}
    </div>
  `;
}

function receiptsForCleaner(cleaner) {
  if (portalCleanerAdmin) return state.receipts;
  return state.receipts.filter((receipt) => normalizeKey(receipt.cleaner) === normalizeKey(cleaner.name));
}

function cleanerPaymentsHtml(receipts) {
  if (!receipts.length) {
    return "<p class='muted'>Todavia no hay pagos generados por el administrador.</p>";
  }
  return receipts.map((receipt) => `
    <article class="receipt-item cleaner-payment-card ${receipt.status === "pending_signature" ? "pending" : ""}">
      <strong>Pago generado por administrador</strong>
      <span class="client-meta">${receipt.period || "Periodo no definido"} - ${receipt.method} - ${receipt.date}</span>
      <div class="cleaner-payment-amount">${money(receipt.amount || 0)}</div>
      <span class="badge ${receipt.status === "signed" ? "dark" : "gold"}">${receipt.status === "signed" ? localText("paymentSignatureReceived") : localText("paymentSignaturePending")}</span>
      ${receipt.signature ? `<img class="signature-preview" src="${receipt.signature}" alt="Firma de ${receipt.receiver || receipt.cleaner}">` : ""}
      <p class="muted">Firma este pago para confirmar que lo revisaste y que administracion puede realizar el pago.</p>
      <div class="receipt-actions">
        <button class="primary" type="button" data-cleaner-sign-payment="${receipt.id}">${receipt.signature ? "Ver / reemplazar firma" : "Firmar para recibir pago"}</button>
      </div>
    </article>
  `).join("");
}

function cleanerMoneyHtml(jobs, earned, monthKey = currentMonthKey()) {
  const totalMinutes = jobs.reduce((sum, job) => sum + billableMinutes(job), 0);
  const average = jobs.length ? earned / jobs.length : 0;
  if (!jobs.length) {
    return `
      <div class="cleaner-report-hero empty">
        <div>
          <span>${monthLabelFromKey(monthKey)}</span>
          <strong>${money(0)}</strong>
          <small>Sin trabajos con horas reales en este periodo.</small>
        </div>
      </div>
    `;
  }
  return `
    <div class="cleaner-report-hero">
      <div>
        <span>${monthLabelFromKey(monthKey)}</span>
        <strong>${money(earned)}</strong>
        <small>Total estimado a recibir</small>
      </div>
      <div class="cleaner-report-mini">
        <span>${jobs.length}</span>
        <small>trabajos</small>
      </div>
      <div class="cleaner-report-mini">
        <span>${minutesLabel(totalMinutes)}</span>
        <small>horas</small>
      </div>
      <div class="cleaner-report-mini">
        <span>${money(average)}</span>
        <small>promedio</small>
      </div>
    </div>
    <div class="cleaner-report-list">
      ${jobs.map((job) => {
        const client = clientFor(job);
        return `
          <article class="cleaner-report-job">
            <div>
              <strong>${client.name}</strong>
              <span>${job.date} - ${job.start}-${job.actualEnd || job.end || "por definir"} - ${job.serviceType}</span>
            </div>
            <div>
              <strong>${money(cleanerCostForJob(job))}</strong>
              <span>${minutesLabel(billableMinutes(job))}</span>
            </div>
          </article>
        `;
      }).join("")}
    </div>
  `;
}

function renderAll() {
  renderMode();
  renderAddressSuggestions();
  updatePageTitle();
  renderMetrics();
  renderJobs();
  renderClients();
  renderCleaners();
  renderCalendar();
  renderMobile();
  renderClientLinks();
  renderReports();
  renderPayments();
  renderSettings();
}

function renderMode() {
  const label = state.mode === "company" ? t("companyMode") : t("independentMode");
  const country = countryInfo(state.country);
  const profile = state.companyProfile || {};
  $("#modeLabel").textContent = label;
  $("#accountCountryPill").textContent = `${country.name} - ${country.dial}`;
  $("#clientDialCode").value = country.dial;
  const avatar = $(".user-chip .avatar-dot");
  const userName = $(".user-chip strong");
  if (avatar) {
    avatar.textContent = profile.ownerName ? profile.ownerName.slice(0, 1).toUpperCase() : "A";
    avatar.style.backgroundImage = profile.photo ? `url("${profile.photo}")` : "";
  }
  if (userName) userName.textContent = profile.ownerName || "Miguel";
  $$("[data-i18n='dashboardGreeting']").forEach((node) => {
    node.textContent = dashboardGreetingText();
  });
  $$("[data-company-nav]").forEach((node) => node.classList.toggle("hidden", state.mode !== "company"));
}

function renderDashboardReminders() {
  const container = $("#dashboardReminders");
  if (!container) return;
  
  const todayStr = new Date().toISOString().split('T')[0];
  const reminders = state.clients.filter(c => c.followUpDate && c.followUpDate <= todayStr);
  
  if (reminders.length === 0) {
    container.innerHTML = "";
    return;
  }
  
  container.innerHTML = reminders.map(c => `
    <div class="reminder-alert">
      <div class="reminder-alert-content">
        <h4>🔔 Recordatorio: Contactar a ${escapeHtml(c.name)}</h4>
        <p>${escapeHtml(c.followUpNote || 'El cliente pausó el servicio y requiere seguimiento hoy.')}</p>
      </div>
      <div class="reminder-alert-actions">
        <button type="button" data-clear-reminder="${c.id}">Marcar como contactado</button>
      </div>
    </div>
  `).join("");
}

function renderMetrics() {
  renderDashboardReminders();
  const monthJobs = state.jobs.filter(isCurrentMonth);
  const billableJobs = monthJobs.filter(isBillableDone);
  const monthTotal = billableJobs.reduce((sum, job) => sum + estimateJob(job), 0);
  const todayJobs = state.jobs.filter((job) => job.date === today());
  const liveJobs = state.jobs.filter(isLiveJob);
  const overdueJobs = state.jobs.filter(isOverdueLive);
  const doneJobs = monthJobs.filter(isDone);
  const registeredJobs = monthJobs.filter((job) => !isBillableDone(job));
  const pendingSignatures = state.jobs.filter((job) => isDone(job) && !job.signed && !job.siteSignature).length;
  const weekHours = billableJobs.reduce((sum, job) => sum + jobHours(job), 0);

  $("#metricJobs").textContent = liveJobs.length || todayJobs.length;
  $("#metricJobsNote").textContent = liveJobs.length ? t("liveJobs") : todayJobs.length ? t("dayAgenda") : t("noJobsToday");
  $("#metricDone").textContent = doneJobs.length;
  $("#metricDoneNote").textContent = t("closedThisMonth");
  $("#metricHours").textContent = weekHours.toFixed(1);
  $("#metricRevenue").textContent = money(monthTotal);
  $("#metricSignatures").textContent = pendingSignatures;
  $("#metricClients").textContent = activeClients().length;
  if (state.mode === "company") {
    $("#metricSecondaryLabel").textContent = "Active cleaners";
    $("#metricSecondaryValue").textContent = activeCleaners().length;
    $("#metricSecondaryNote").textContent = `${activeCleaners().length} cleaners activos`;
  } else {
    $("#metricSecondaryLabel").textContent = t("pendingSignatures");
    $("#metricSecondaryValue").textContent = pendingSignatures;
    $("#metricSecondaryNote").textContent = `${pendingSignatures} requeridas`;
  }
  $("#summaryTitle").textContent = liveJobs.length
    ? `${liveJobs.length} ${liveJobs.length === 1 ? t("job") : t("jobsWord")} ${t("inLiveNow")}`
    : todayJobs.length
      ? `${t("today")}: ${todayJobs.length} ${todayJobs.length === 1 ? t("job") : t("jobsWord")} ${t("agendaToday")}`
      : t("noScheduledToday");
  $("#summaryCopy").textContent = `${doneJobs.length} ${t("doneThisMonth")}, ${registeredJobs.length} ${t("registeredNotCounted")}, ${money(monthTotal)} ${t("real")} y ${overdueJobs.length} ${t("operationalAlert")}.`;
  $("#summaryChips").innerHTML = `
    <span class="chip">${liveJobs.length} ${t("live")}</span>
    <span class="chip blue">${weekHours.toFixed(1)}h ${t("completedHours").toLowerCase()}</span>
    <span class="chip">${registeredJobs.length} ${t("registered")}</span>
    <span class="chip gold">${pendingSignatures} ${t("signaturesPending")}</span>
    <span class="chip dark">${money(monthTotal)} ${t("real")}</span>
  `;
}

function viewTitle(name) {
  const titles = { dashboard: t("dashboard"), clients: t("clients"), cleaners: t("cleaners"), calendar: t("calendar"), jobs: t("jobs"), mobile: "Simulator", clientLinks: t("clientLinks"), reports: t("reports"), payments: t("payments"), settings: t("settings") };
  return titles[name] || t("dashboard");
}

function updatePageTitle() {
  const active = $(".view.active");
  const name = active?.id?.replace("View", "") || "dashboard";
  $("#pageTitle").textContent = name === "dashboard" ? dashboardGreetingText() : viewTitle(name);
}

function jobHtml(job) {
  const client = clientFor(job);
  const badge = jobBadgeClass(job);
  const endLabel = job.actualEnd ? `fin real ${job.actualEnd}` : `fin estimado ${job.end || "por definir"}`;
  const areaOptions = [...new Set([...(job.tasks || []), ...evidenceFor(job).map((item) => item.section).filter(Boolean)])];
  const areaListId = `admin-areas-${job.id}`;
  const cleaner = state.cleaners.find((item) => item.id === job.cleanerId);
  const cleanerName = cleaner ? cleaner.name : "Sin asignar";
  return `
    <article class="job-item ${isOverdueLive(job) ? "warning-job" : ""}">
      <div class="job-time-col">
        <span class="time-bullet ${badge}"></span>
        <strong class="job-start-time">${job.start}</strong>
        <small class="job-date-label">${job.date}</small>
      </div>
      <div class="job-content-col">
        <header>
          <div class="job-title-group">
            <strong>${client.name}</strong>
            <span class="job-service-tag">${job.serviceType}</span>
          </div>
          <span class="badge ${badge}">${jobStatusLabel(job)}</span>
        </header>
        <div class="job-meta-row">
          <span class="meta-item address-item">📍 ${client.address}</span>
          <span class="meta-item cleaner-item">🧹 ${cleanerName}</span>
        </div>
        <div class="job-meta-row">
          <span class="meta-item">📷 ${evidenceCount(job)} fotos</span>
          <span class="meta-item">✍️ ${job.signed || job.siteSignature ? t("signed") : t("signaturePending")}</span>
          <span class="meta-item price-item">💰 ${isBillableDone(job) ? `${t("real")} ${money(estimateJob(job))}` : `${t("planned")} ${money(estimateScheduledJob(job))}`}</span>
        </div>
        ${isOverdueLive(job) ? `<div class="job-alert">Alerta: sigue en sitio despues de la hora estimada.</div>` : ""}
        <div class="receipt-actions">
          <button class="mini-action" type="button" data-edit-job="${job.id}">${t("editJob")}</button>
          ${!isDone(job) ? `<button class="mini-action" type="button" data-admin-complete-job="${job.id}">Terminar admin</button>` : ""}
          <button class="mini-action danger" type="button" data-delete-job="${job.id}">${t("delete")}</button>
        </div>
        <details class="admin-evidence-box">
          <summary>Evidencia administrativa</summary>
          <p class="muted">Usa esto si el cleaner olvido subir fotos o si administracion cerro/corrigio el trabajo manualmente.</p>
          <form class="evidence-form" data-admin-evidence-form="${job.id}">
            <label>Area o lugar
              <input name="section" list="${areaListId}" placeholder="Ej: Kitchen, bathroom, escritorio" required>
              <datalist id="${areaListId}">
                ${areaOptions.map((task) => `<option value="${escapeHtml(task)}"></option>`).join("")}
              </datalist>
            </label>
            <label>Momento
              <select name="phase">
                <option>Antes</option>
                <option>Despues</option>
              </select>
            </label>
            <label>Comentario <input name="comment" placeholder="Ej: correccion admin, foto enviada por WhatsApp..."></label>
            <label>Foto <input name="photo" type="file" accept="image/*" multiple></label>
            <div class="form-actions">
              <button class="primary" type="submit">Guardar evidencia</button>
            </div>
          </form>
          ${photoBoardHtml(job, true, { canDelete: true })}
        </details>
      </div>
    </article>
  `;
}

function jobGroupIcon(key) {
  const icons = {
    overdueLive: "!",
    live: "◷",
    expired: "!",
    assigned: "▣",
    open: "◷",
    cleanerDone: "⌁",
    clientDone: "✓",
    adminDone: "◇"
  };
  return icons[key] || "▣";
}

function jobCardHtml(job) {
  const client = clientFor(job);
  const badge = jobBadgeClass(job);
  const cleaner = state.cleaners.find((item) => item.id === job.cleanerId);
  const cleanerName = cleaner ? cleaner.name : t("unassigned");
  const [year = "", month = "", day = ""] = String(job.date || "").split("-");
  const monthLabel = month ? new Date(`${job.date}T00:00:00`).toLocaleDateString("en", { month: "short" }).toUpperCase() : "JOB";
  const timeText = `${job.start || "--:--"} - ${job.actualEnd || job.end || "--:--"}`;
  const billed = isBillableDone(job) ? estimateJob(job) : estimateScheduledJob(job);
  const signatureText = job.signed || job.siteSignature ? t("signed") : t("signaturePending");
  const areaOptions = [...new Set([...(job.tasks || []), ...evidenceFor(job).map((item) => item.section).filter(Boolean)])];
  const areaListId = `admin-areas-${job.id}`;

  return `
    <article class="job-item modern-job-card ${isOverdueLive(job) ? "warning-job" : ""}">
      <div class="job-date-card">
        <span>${escapeHtml(monthLabel)}</span>
        <strong>${escapeHtml(day || "--")}</strong>
        <small>${escapeHtml(year || "")}</small>
      </div>
      <div class="job-content-col">
        <header>
          <div class="job-title-group">
            <strong>${escapeHtml(client.name)}</strong>
            <span>${escapeHtml(client.address || fullAddressForClient(client))}</span>
          </div>
          <span class="badge ${badge}">${jobStatusLabel(job)}</span>
        </header>
        <div class="job-facts-row">
          <span><b>◷</b>${escapeHtml(timeText)}<small>${job.actualEnd ? "Real" : "Estimated"}</small></span>
          <span><b>⌘</b>${escapeHtml(job.serviceType || "Service")}<small>Service</small></span>
          <span><b>$</b>${money(billed)}<small>${isBillableDone(job) ? t("real") : t("planned")}</small></span>
        </div>
        <div class="job-proof-row">
          <span>▣ ${evidenceCount(job)} photos</span>
          <span>⌁ ${escapeHtml(signatureText)}</span>
          <span>Cleaner: ${escapeHtml(cleanerName)}</span>
        </div>
        ${isOverdueLive(job) ? `<div class="job-alert">Alerta: sigue en sitio despues de la hora estimada.</div>` : ""}
        <div class="receipt-actions job-actions">
          <button class="mini-action" type="button" data-edit-job="${job.id}">✎ ${t("editJob")}</button>
          <button class="mini-action" type="button" data-toggle-evidence="${job.id}">◎ View details</button>
          ${!isDone(job) ? `<button class="mini-action primary-mini" type="button" data-admin-complete-job="${job.id}">✓ Complete job</button>` : ""}
          <button class="mini-action danger" type="button" data-delete-job="${job.id}">${t("delete")}</button>
        </div>
        <details class="admin-evidence-box" id="jobEvidence-${job.id}">
          <summary>Evidencia administrativa</summary>
          <p class="muted">Usa esto si el cleaner olvido subir fotos o si administracion cerro/corrigio el trabajo manualmente.</p>
          <form class="evidence-form" data-admin-evidence-form="${job.id}">
            <label>Area o lugar
              <input name="section" list="${areaListId}" placeholder="Ej: Kitchen, bathroom, escritorio" required>
              <datalist id="${areaListId}">
                ${areaOptions.map((task) => `<option value="${escapeHtml(task)}"></option>`).join("")}
              </datalist>
            </label>
            <label>Momento
              <select name="phase">
                <option>Antes</option>
                <option>Despues</option>
              </select>
            </label>
            <label>Comentario <input name="comment" placeholder="Ej: correccion admin, foto enviada por WhatsApp..."></label>
            <label>Foto <input name="photo" type="file" accept="image/*" multiple></label>
            <div class="form-actions">
              <button class="primary" type="submit">Guardar evidencia</button>
            </div>
          </form>
          ${photoBoardHtml(job, true, { canDelete: true })}
        </details>
      </div>
    </article>
  `;
}

function dashboardScheduleHtml(jobs) {
  if (!jobs.length) return `<p class='muted'>${t("noLiveAgenda")}</p>`;
  return jobs
    .sort((a, b) => `${a.date} ${a.start}`.localeCompare(`${b.date} ${b.start}`))
    .map((job) => {
      const client = clientFor(job);
      const cleaner = cleanerFor(job);
      const badge = jobBadgeClass(job);
      return `
        <article class="schedule-item">
          <time>${formatTimeLabel(job.start)}</time>
          <span class="schedule-dot ${badge}"></span>
          <div class="schedule-card">
            <div>
              <strong>${escapeHtml(job.serviceType || client.name)}</strong>
              <p>${escapeHtml(client.address || "")}</p>
            </div>
            <div class="schedule-assignee">
              <span class="mini-avatar">${escapeHtml((cleaner?.name || "JV").slice(0, 1))}</span>
              <strong>${escapeHtml(cleaner?.name || t("unassigned"))}</strong>
              <small class="badge ${badge}">${jobStatusLabel(job)}</small>
            </div>
          </div>
        </article>
      `;
    })
    .join("");
}

function formatTimeLabel(value = "") {
  if (!value) return "--:--";
  const [hourRaw, minute = "00"] = String(value).split(":");
  const hour = Number(hourRaw);
  if (Number.isNaN(hour)) return value;
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${String(displayHour).padStart(2, "0")}:${minute} ${suffix}`;
}

function renderDashboardMap(jobs = state.jobs.filter((job) => job.date === today() || isLiveJob(job))) {
  const frame = $("#dashboardMapFrame");
  const list = $("#dashboardMapList");
  if (!frame || !list) return;
  const mappedJobs = jobs.length ? jobs : state.jobs.slice(0, 3);
  const firstClient = mappedJobs[0] ? clientFor(mappedJobs[0]) : activeClients()[0];
  const query = firstClient ? fullAddressForClient(firstClient) : state.companyProfile?.address || "Tel Aviv, Israel";
  frame.src = `https://maps.google.com/maps?q=${encodeURIComponent(query)}&z=13&output=embed`;
  list.innerHTML = mappedJobs.slice(0, 4).map((job, index) => {
    const client = clientFor(job);
    return `
      <a class="map-job-chip" href="${mapsUrlForClient(client)}" target="_blank" rel="noreferrer">
        <span>${index + 1}</span>
        <strong>${escapeHtml(client.name)}</strong>
        <small>${escapeHtml(client.address || fullAddressForClient(client))}</small>
      </a>
    `;
  }).join("");
}

function renderRecentActivity() {
  const target = $("#recentActivityList");
  if (!target) return;
  const recentJob = state.jobs.find(isDone) || state.jobs[0];
  const recentClient = activeClients()[0];
  const recentCleaner = activeCleaners()[0];
  const items = [
    {
      icon: "✓",
      title: recentJob ? `${cleanerFor(recentJob)?.name || "John D."} ${t("completed")} ${clientFor(recentJob).name}` : t("completedJobs"),
      copy: recentJob ? clientFor(recentJob).address : t("noLiveAgenda"),
      time: "2 min ago"
    },
    {
      icon: "▣",
      title: `${recentCleaner?.name || "Sarah M."} ${t("uploadedPhotos")}`,
      copy: recentJob?.serviceType || t("evidence"),
      time: "5 min ago"
    },
    {
      icon: "$",
      title: t("paymentReceived"),
      copy: `${money(320)} ${recentClient ? `from ${recentClient.name}` : ""}`,
      time: "12 min ago"
    },
    {
      icon: "+",
      title: t("newClientRegistered"),
      copy: recentClient?.name || "David Wilson",
      time: "25 min ago"
    }
  ];
  target.innerHTML = items.map((item) => `
    <article class="recent-item">
      <span>${item.icon}</span>
      <div>
        <strong>${escapeHtml(item.title)}</strong>
        <p>${escapeHtml(item.copy)}</p>
      </div>
      <time>${item.time}</time>
    </article>
  `).join("");
}

function dashboardSearchItems() {
  return [
    ...activeClients().map((client) => ({
      type: "Cliente",
      title: client.name,
      copy: client.address || client.email || "",
      view: "clients"
    })),
    ...activeCleaners().map((cleaner) => ({
      type: "Cleaner",
      title: cleaner.name,
      copy: `${cleaner.phone || ""} ${cleaner.email || ""}`.trim(),
      view: "cleaners"
    })),
    ...state.jobs.map((job) => {
      const client = clientFor(job);
      return {
        type: "Trabajo",
        title: `${client.name} - ${job.serviceType}`,
        copy: `${job.date} ${job.start || ""} ${jobStatusLabel(job)}`,
        view: "jobs"
      };
    })
  ];
}

function renderDashboardSearch() {
  const input = $("#dashboardSearch");
  const box = $("#dashboardSearchResults");
  if (!input || !box) return;
  const query = input.value.trim().toLowerCase();
  if (!query) {
    box.classList.add("hidden");
    box.innerHTML = "";
    return;
  }
  const matches = dashboardSearchItems()
    .filter((item) => `${item.type} ${item.title} ${item.copy}`.toLowerCase().includes(query))
    .slice(0, 8);
  box.innerHTML = matches.length ? matches.map((item) => `
    <button type="button" data-search-view="${item.view}">
      <span>${escapeHtml(item.type)}</span>
      <strong>${escapeHtml(item.title)}</strong>
      <small>${escapeHtml(item.copy)}</small>
    </button>
  `).join("") : `<p>No encontre resultados.</p>`;
  box.classList.remove("hidden");
  $$("[data-search-view]").forEach((button) => {
    button.addEventListener("click", () => {
      setView(button.dataset.searchView);
      input.value = "";
      box.classList.add("hidden");
    });
  });
}

function renderJobDashboard() {
  const groups = jobsByCategory();
  const cards = groups.map((group) => `
    <button class="job-status-card ${group.config.className}" type="button" data-job-group="${group.key}">
      <i aria-hidden="true">${jobGroupIcon(group.key)}</i>
      <span>${group.config.label}</span>
      <strong>${group.jobs.length}</strong>
      <small>${group.config.helper}</small>
    </button>
  `).join("");
  const lists = groups
    .filter((group) => group.jobs.length)
    .map((group) => `
      <section class="job-group ${group.config.className}" id="jobGroup-${group.key}">
        <div class="panel-head">
          <div>
            <h4>${group.config.label}</h4>
            <p class="muted">${group.config.helper}</p>
          </div>
          <span class="status-chip">${group.jobs.length}</span>
        </div>
        <div class="job-list">${group.jobs.map(jobCardHtml).join("")}</div>
      </section>
    `).join("");
  return `
    <div class="job-status-board">${cards}</div>
    <div class="job-group-list">${lists || "<p class='muted'>No hay trabajos registrados.</p>"}</div>
  `;
}

function renderJobs() {
  const dashboardJobs = state.jobs.filter((job) => job.date === today() || isLiveJob(job));
  $("#todayJobs").innerHTML = dashboardScheduleHtml(dashboardJobs);
  renderRecentActivity();
  renderDashboardMap(dashboardJobs);
  $("#allJobs").innerHTML = renderJobDashboard();
  $("#jobCount").textContent = `${state.jobs.length} ${state.jobs.length === 1 ? t("job") : t("jobsWord")}`;
  $("#jobClientSelect").innerHTML = activeClients().map((client) => `<option value="${client.id}">${client.name}</option>`).join("");
  updateJobClientAddressHint();
  $$("[data-job-group]").forEach((button) => {
    button.addEventListener("click", () => {
      document.getElementById(`jobGroup-${button.dataset.jobGroup}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
  $$("[data-edit-job]").forEach((button) => {
    button.addEventListener("click", () => startJobEdit(button.dataset.editJob));
  });
  $$("[data-admin-complete-job]").forEach((button) => {
    button.addEventListener("click", () => completeJobByAdmin(button.dataset.adminCompleteJob));
  });
  $$("[data-toggle-evidence]").forEach((button) => {
    button.addEventListener("click", () => {
      const details = $(`#jobEvidence-${button.dataset.toggleEvidence}`);
      if (details) details.open = !details.open;
    });
  });
  $$("[data-delete-job]").forEach((button) => {
    button.addEventListener("click", () => openDeleteJobModal(button.dataset.deleteJob));
  });
  $$("[data-admin-evidence-form]").forEach((form) => {
    form.addEventListener("submit", handleAdminEvidenceSubmit);
  });
  bindPhotoActions(true);
}

async function handleAdminEvidenceSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const job = state.jobs.find((item) => item.id === form.dataset.adminEvidenceForm);
  if (!job) return;
  const data = new FormData(form);
  const files = data.getAll("photo").filter((file) => file instanceof File && file.size);
  if (!files.length) {
    toast("Elige una o varias fotos para guardar como evidencia administrativa.");
    return;
  }
  const section = data.get("section") || "General";
  const phase = data.get("phase") || "Antes";
  const comment = data.get("comment") || "Evidencia agregada por administracion.";
  const createdAt = new Date().toISOString();
  for (const file of files) {
    evidenceFor(job).push({
      id: safeId(),
      section,
      phase,
      comment: `Admin: ${comment}`,
      url: await compressImageFile(file),
      fileName: file.name,
      createdAt,
      source: "admin"
    });
  }
  job.photos = evidenceCount(job);
  save();
  renderAll();
  toast(`${files.length} foto${files.length === 1 ? "" : "s"} agregada${files.length === 1 ? "" : "s"} por administracion.`);
}

function startJobEdit(jobId) {
  const job = state.jobs.find((item) => item.id === jobId);
  if (!job) return;
  const form = $("#jobForm");
  form.elements.id.value = job.id;
  form.elements.clientId.value = job.clientId;
  form.elements.cleanerId.value = job.cleanerId || "";
  form.elements.date.value = job.date || "";
  form.elements.start.value = job.start || "";
  form.elements.end.value = job.end || "";
  form.elements.actualEnd.value = job.actualEnd || "";
  form.elements.status.value = statusValueForJob(job);
  form.elements.recurrence.value = job.recurrence || "";
  form.elements.repeatCount.value = 1;
  form.elements.serviceType.value = job.serviceType || "Limpieza normal";
  form.elements.rate.value = job.rate || 0;
  form.elements.extras.value = job.extras || 0;
  form.elements.tasks.value = (job.tasks || []).join(", ");
  updateJobClientAddressHint();
  $("#saveJobButton").textContent = "Actualizar trabajo";
  $("#cancelJobEdit").classList.remove("hidden");
  setView("jobs");
  toast("Editando trabajo. Puedes corregir horas, precio, tipo o checklist.");
}

function openDeleteJobModal(jobId) {
  const job = state.jobs.find((item) => item.id === jobId);
  if (!job) {
    toast("Ese trabajo ya no existe.");
    renderAll();
    return;
  }
  const client = clientFor(job);
  const cleaner = state.cleaners.find((item) => item.id === job.cleanerId);
  pendingDeleteJobId = jobId;
  $("#deleteJobSummary").innerHTML = `
    <strong>${client.name}</strong>
    <span>${job.date || "-"} · ${job.start || "-"}-${job.actualEnd || job.end || "-"} · ${jobStatusLabel(job)}</span>
    <span>${client.address || "Sin direccion registrada"}</span>
    <span>${cleaner ? `Cleaner: ${cleaner.name}` : "Sin cleaner asignado"}</span>
  `;
  $("#deleteJobModal").classList.remove("hidden");
}

function closeDeleteJobModal() {
  pendingDeleteJobId = null;
  $("#deleteJobModal").classList.add("hidden");
}

function deletePendingJob() {
  const jobId = pendingDeleteJobId;
  if (!jobId) {
    closeDeleteJobModal();
    return;
  }
  const job = state.jobs.find((item) => item.id === jobId);
  if (!job) {
    closeDeleteJobModal();
    toast("Ese trabajo ya no existe.");
    renderAll();
    return;
  }
  const clientName = clientFor(job).name;
  state.jobs = state.jobs.filter((item) => item.id !== jobId);
  state.evidence = state.evidence.filter((item) => item.jobId !== jobId);
  if ($("#jobId").value === jobId) resetJobForm();
  if (expandedJobId === jobId) expandedJobId = null;
  if (signingJobId === jobId) signingJobId = null;
  closeDeleteJobModal();
  save();
  renderAll();
  toast(`Trabajo eliminado: ${clientName} (${job.date || "sin fecha"}).`);
}

function resetJobForm() {
  $("#jobForm").reset();
  $("#jobId").value = "";
  $("#jobForm").elements.status.value = "Asignado";
  $("#jobForm").elements.repeatCount.value = 1;
  applyServiceRuleToJobForm();
  updateJobClientAddressHint();
  $("#saveJobButton").textContent = "Crear trabajo";
  $("#cancelJobEdit").classList.add("hidden");
}

function addRecurringJobs(payload, count, recurrence) {
  const safeCount = Math.max(1, Math.min(24, Number(count || 1)));
  const baseDate = new Date(`${payload.date}T00:00:00`);
  const intervalDays = recurrence === "weekly" ? 7 : recurrence === "biweekly" ? 14 : 0;

  return Array.from({ length: safeCount }, (_, index) => {
    const date = new Date(baseDate);
    if (recurrence === "monthly") date.setMonth(baseDate.getMonth() + index);
    else date.setDate(baseDate.getDate() + (intervalDays * index));

    return {
      ...payload,
      id: index === 0 ? payload.id : safeId(),
      date: date.toISOString().slice(0, 10),
      recurrence: recurrence || "",
      seriesId: payload.seriesId || payload.id,
      status: payload.status || (payload.cleanerId ? "Asignado" : "Disponible para tomar"),
      photos: 0,
      signed: Boolean(payload.signed),
      checkedIn: Boolean(payload.checkedIn),
      checkedOut: Boolean(payload.checkedOut),
      cleanerFinished: Boolean(payload.cleanerFinished),
      clientConfirmed: Boolean(payload.clientConfirmed)
    };
  });
}

function applyServiceRuleToJobForm() {
  const form = $("#jobForm");
  if (!form) return;
  const type = form.elements.serviceType.value;
  const rate = rateForClientService(form.elements.clientId.value, type);
  if (rate !== undefined) form.elements.rate.value = rate;
}

function syncJobStatusWithCleaner() {
  const form = $("#jobForm");
  if (!form || form.elements.id.value) return;
  const currentStatus = form.elements.status.value;
  if (!["Asignado", "Disponible para tomar"].includes(currentStatus)) return;
  form.elements.status.value = form.elements.cleanerId.value ? "Asignado" : "Disponible para tomar";
}

function renderClients() {
  const clients = activeClients();
  const archived = archivedClients();
  $("#clientCount").textContent = `${clients.length} clientes`;
  $("#clientTerritory").innerHTML = territoryHtml(clients.map((client) => ({ ...locationMeta(client.address), item: client })), "clientes");
  $("#clientList").innerHTML = clients.map((client) => {
    const loc = locationMeta(client.address);
    const jobs = state.jobs.filter((job) => job.clientId === client.id);
    return `
      <article class="client-item territory-card">
        <strong>${client.name}</strong>
        <span class="client-meta">${loc.city} - ${loc.region}</span>
        <span class="client-meta">${client.address}</span>
        <span class="client-meta">${jobs.length} trabajo${jobs.length === 1 ? "" : "s"} - ${client.paymentMethod}</span>
        <div class="receipt-actions">
          <button class="mini-action" type="button" data-edit-client="${client.id}">Editar cliente</button>
          <button class="mini-action danger" type="button" data-archive-client="${client.id}">Eliminar cliente</button>
        </div>
      </article>
    `;
  }).join("");
  $("#archivedClientList").innerHTML = archived.length ? archived.map((client) => {
    const loc = locationMeta(client.address);
    const jobs = state.jobs.filter((job) => job.clientId === client.id);
    return `
      <article class="client-item archived-card">
        <strong>${client.name}</strong>
        <span class="badge dark">Archivado</span>
        <span class="client-meta">${loc.city} - ${loc.region}</span>
        <span class="client-meta">${jobs.length} trabajo${jobs.length === 1 ? "" : "s"} guardado${jobs.length === 1 ? "" : "s"} en historial</span>
        <div class="receipt-actions">
          <button class="mini-action" type="button" data-restore-client="${client.id}">Restaurar</button>
        </div>
      </article>
    `;
  }).join("") : "<p class='muted'>No hay clientes eliminados.</p>";
  $$("[data-edit-client]").forEach((button) => {
    button.addEventListener("click", () => startClientEdit(button.dataset.editClient));
  });
  $$("[data-archive-client]").forEach((button) => {
    button.addEventListener("click", () => archiveClient(button.dataset.archiveClient));
  });
  $$("[data-restore-client]").forEach((button) => {
    button.addEventListener("click", () => restoreClient(button.dataset.restoreClient));
  });
}

function renderCleaners() {
  const cleaners = activeCleaners();
  const archived = archivedCleaners();
  const cleanerCard = (cleaner, isArchived = false) => {
    const loc = cleanerLocationRecord(cleaner);
    const assigned = state.jobs.filter((job) => job.cleanerId === cleaner.id);
    const active = assigned.filter((job) => !isDone(job));
    const done = assigned.filter(isDone);
    const live = assigned.filter(isLiveJob);
    const stateLabel = isArchived ? localText("inHistory") : live.length ? localText("inAction") : active.length ? localizedJobStatus("Asignado") : localText("available");
    const badgeClass = isArchived ? "dark" : live.length ? "green" : active.length ? "gold" : "dark";
    return `
      <article class="client-item territory-card ${isArchived ? "archived-card" : ""}">
        <strong>${cleaner.name}</strong>
        <span class="badge ${badgeClass}">${stateLabel}</span>
        <span class="client-meta">${loc.country} - ${loc.city} - ${loc.region}</span>
        <span class="client-meta">${cleaner.phone || "sin telefono"} - ${cleaner.email || "sin email"}</span>
        <span class="client-meta">${active.length} pendiente${active.length === 1 ? "" : "s"} - ${done.length} terminado${done.length === 1 ? "" : "s"} - ${assigned.length} total</span>
        <code class="inline-link">${localCleanerPortalUrl(cleaner)}</code>
        <div class="receipt-actions">
          ${isArchived ? `
            <button class="mini-action" type="button" data-edit-cleaner="${cleaner.id}">Editar historial</button>
            <button class="mini-action" type="button" data-restore-cleaner="${cleaner.id}">Restaurar</button>
            <button class="mini-action" type="button" data-open-cleaner-portal="${cleaner.id}">Ver historial</button>
          ` : `
            <button class="mini-action" type="button" data-edit-cleaner="${cleaner.id}">Editar cleaner</button>
            <button class="mini-action danger" type="button" data-archive-cleaner="${cleaner.id}">Eliminar cleaner</button>
            <button class="mini-action" type="button" data-copy-cleaner-link="${cleaner.id}">Copiar acceso</button>
            <button class="mini-action" type="button" data-open-cleaner-portal="${cleaner.id}">Ver portal</button>
          `}
        </div>
      </article>
    `;
  };
  $("#cleanerCount").textContent = `${cleaners.length} cleaners activos`;
  $("#jobCleanerSelect").innerHTML = `<option value="">Abrir para que un cleaner lo tome</option>` + cleaners.map((cleaner) => `<option value="${cleaner.id}">${cleaner.name}</option>`).join("");
  $("#cleanerTerritory").innerHTML = territoryHtml(cleaners.map((cleaner) => cleanerLocationRecord(cleaner)), "cleaners");
  $("#cleanerList").innerHTML = cleaners.map((cleaner) => cleanerCard(cleaner)).join("") || "<p class='muted'>No hay cleaners activos todavia.</p>";
  $("#archivedCleanerList").innerHTML = archived.map((cleaner) => cleanerCard(cleaner, true)).join("") || "<p class='muted'>Todavia no hay cleaners en historial.</p>";
  $$("[data-copy-cleaner-link]").forEach((button) => {
    button.addEventListener("click", () => copyCleanerLink(button.dataset.copyCleanerLink));
  });
  $$("[data-edit-cleaner]").forEach((button) => {
    button.addEventListener("click", () => startCleanerEdit(button.dataset.editCleaner));
  });
  $$("[data-archive-cleaner]").forEach((button) => {
    button.addEventListener("click", () => openArchiveCleanerModal(button.dataset.archiveCleaner));
  });
  $$("[data-restore-cleaner]").forEach((button) => {
    button.addEventListener("click", () => restoreCleaner(button.dataset.restoreCleaner));
  });
  $$("[data-open-cleaner-portal]").forEach((button) => {
    button.addEventListener("click", () => window.open(localCleanerPortalUrl(state.cleaners.find((item) => item.id === button.dataset.openCleanerPortal)), "_blank"));
  });
}

function cleanerLocationRecord(cleaner) {
  const fallback = locationMeta(cleaner.city || cleaner.phone || cleaner.email);
  const countryCode = cleaner.country || state.country || "IL";
  return {
    country: countryInfo(countryCode).name,
    region: cleaner.region || fallback.region || "Zona operativa",
    city: cleaner.city || fallback.city || "Zona principal",
    item: cleaner
  };
}

function territoryHtml(records, label) {
  const byCountry = records.reduce((acc, record) => {
    const key = record.country || countryInfo(state.country).name || "Pais";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const countryNames = Object.keys(byCountry);
  const country = countryNames.length === 1 ? countryNames[0] : `${countryNames.length} paises`;
  const byCity = records.reduce((acc, record) => {
    const key = `${record.country || country}::${record.city || "Zona principal"}`;
    if (!acc[key]) acc[key] = { country: record.country || country, city: record.city || "Zona principal", region: record.region, count: 0 };
    acc[key].count += 1;
    return acc;
  }, {});
  const cities = Object.entries(byCity);
  return `
    <section class="territory-board">
      <div class="territory-map">
        <span>${country}</span>
        <strong>${records.length}</strong>
        <small>${label} registrados</small>
      </div>
      <div class="territory-zones">
        ${cities.map(([, data]) => `
          <article>
            <strong>${data.city}</strong>
            <span>${data.country} - ${data.region}</span>
            <b>${data.count}</b>
          </article>
        `).join("") || "<p class='muted'>Sin zonas todavia.</p>"}
      </div>
    </section>
  `;
}

async function copyCleanerLink(cleanerId) {
  const cleaner = state.cleaners.find((item) => item.id === cleanerId);
  if (!cleaner) return;
  const text = `${localCleanerPortalUrl(cleaner)}\nClave: ${cleaner.key}`;
  try {
    await navigator.clipboard.writeText(text);
    toast("Acceso del cleaner copiado.");
  } catch {
    window.prompt("Copia este acceso del cleaner:", text);
  }
}

function startCleanerEdit(cleanerId) {
  const cleaner = state.cleaners.find((item) => item.id === cleanerId);
  if (!cleaner) return;
  const form = $("#cleanerForm");
  form.elements.id.value = cleaner.id;
  form.elements.name.value = cleaner.name || "";
  form.elements.phone.value = cleaner.phone || "";
  form.elements.email.value = cleaner.email || "";
  form.elements.country.value = cleaner.country || state.country || "IL";
  form.elements.city.value = cleaner.city || "";
  form.elements.key.value = cleaner.key || "";
  $("#saveCleanerButton").textContent = "Actualizar cleaner";
  $("#cancelCleanerEdit").classList.remove("hidden");
  toast("Editando cleaner. Corrige y guarda.");
}

function resetCleanerForm() {
  const form = $("#cleanerForm");
  form.reset();
  form.elements.id.value = "";
  form.elements.country.value = state.country || "IL";
  $("#saveCleanerButton").textContent = "Guardar cleaner";
  $("#cancelCleanerEdit").classList.add("hidden");
}

function openArchiveCleanerModal(cleanerId) {
  const cleaner = state.cleaners.find((item) => item.id === cleanerId);
  if (!cleaner) return;
  pendingArchiveCleanerId = cleanerId;
  const assigned = state.jobs.filter((job) => job.cleanerId === cleanerId);
  const active = assigned.filter((job) => !isDone(job));
  const done = assigned.filter(isDone);
  const payments = state.receipts.filter((receipt) => receipt.cleanerId === cleanerId);
  $("#archiveCleanerSummary").innerHTML = `
    <strong>${cleaner.name}</strong>
    <span>${cleaner.phone || "sin telefono"} - ${cleaner.email || "sin email"}</span>
    <span>${active.length} trabajos activos/asignados - ${done.length} terminados - ${payments.length} comprobantes</span>
  `;
  $("#archiveCleanerModal").classList.remove("hidden");
}

function closeArchiveCleanerModal() {
  pendingArchiveCleanerId = null;
  $("#archiveCleanerModal").classList.add("hidden");
}

function archivePendingCleaner() {
  const cleanerId = pendingArchiveCleanerId;
  const cleaner = state.cleaners.find((item) => item.id === cleanerId);
  if (!cleaner) {
    closeArchiveCleanerModal();
    return;
  }
  cleaner.archived = true;
  cleaner.archivedAt = new Date().toISOString();
  if ($("#cleanerId").value === cleaner.id) resetCleanerForm();
  save();
  renderAll();
  closeArchiveCleanerModal();
  toast("Cleaner movido al historial. Sus trabajos y pagos quedan guardados.");
}

function restoreCleaner(cleanerId) {
  const cleaner = state.cleaners.find((item) => item.id === cleanerId);
  if (!cleaner) return;
  cleaner.archived = false;
  delete cleaner.archivedAt;
  cleaner.status = cleaner.status || "Disponible";
  save();
  renderAll();
  toast("Cleaner restaurado al equipo activo.");
}

function startClientEdit(clientId) {
  const client = state.clients.find((item) => item.id === clientId);
  if (!client) return;
  const form = $("#clientForm");
  form.elements.id.value = client.id;
  form.elements.name.value = client.name || "";
  form.elements.phoneLocal.value = client.phoneLocal || (client.phone || "").replace(/^\+\d+\s*/, "");
  form.elements.email.value = client.email || "";
  
  const addressInput = form.querySelector('[name="address"]');
  if (addressInput) addressInput.value = client.address || "";
  
  form.elements.paymentMethod.value = client.paymentMethod || "Efectivo";
  form.elements.notes.value = client.notes || "";
  
  if (form.elements.followUpDate) form.elements.followUpDate.value = client.followUpDate || "";
  if (form.elements.followUpNote) form.elements.followUpNote.value = client.followUpNote || "";
  
  $("#saveClientButton").textContent = "Actualizar cliente";
  $("#cancelClientEdit").classList.remove("hidden");
  toast("Editando cliente. Corrige y guarda.");
}

function resetClientForm() {
  $("#clientForm").reset();
  $("#clientId").value = "";
  $("#saveClientButton").textContent = "Guardar cliente";
  $("#cancelClientEdit").classList.add("hidden");
  renderMode();
}

function archiveClient(clientId) {
  const client = state.clients.find((item) => item.id === clientId);
  if (!client) return;
  pendingArchiveClientId = clientId;
  const clientJobs = state.jobs.filter((job) => job.clientId === clientId);
  const active = clientJobs.filter((job) => !isDone(job));
  const done = clientJobs.filter(isDone);
  $("#archiveClientSummary").innerHTML = `
    <strong>${client.name}</strong>
    <span>${client.address || "Sin direccion registrada"}</span>
    <span>${active.length} trabajos activos/asignados - ${done.length} terminados en historial</span>
  `;
  $("#archiveClientModal").classList.remove("hidden");
}

function closeArchiveClientModal() {
  pendingArchiveClientId = null;
  $("#archiveClientModal").classList.add("hidden");
}

function archivePendingClient() {
  const clientId = pendingArchiveClientId;
  const client = state.clients.find((item) => item.id === clientId);
  if (!client) {
    closeArchiveClientModal();
    return;
  }
  client.archived = true;
  client.archivedAt = new Date().toISOString();
  if ($("#clientId").value === client.id) resetClientForm();
  save();
  renderAll();
  closeArchiveClientModal();
  toast("Cliente movido al historial. Sus trabajos y fotos quedan guardados.");
}

function restoreClient(clientId) {
  const client = state.clients.find((item) => item.id === clientId);
  if (!client) return;
  client.archived = false;
  delete client.archivedAt;
  save();
  renderAll();
  toast("Cliente restaurado.");
}

function renderCalendar() {
  const year = calendarCursor.getFullYear();
  const month = calendarCursor.getMonth();
  const firstDay = new Date(year, month, 1);
  const start = new Date(firstDay);
  const weekStartsOnSundayIndex = firstDay.getDay();
  start.setDate(firstDay.getDate() - weekStartsOnSundayIndex);
  const monthLabel = calendarCursor.toLocaleDateString("es", { month: "long", year: "numeric" });
  $("#calendarTitle").textContent = `Calendario mensual - ${monthLabel}`;

  const weekdays = ["Dom", "Lun", "Mar", "Mie", "Jue", "Vie", "Sab"]
    .map((day) => `<div class="calendar-weekday">${day}</div>`)
    .join("");

  const cells = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const key = date.toISOString().slice(0, 10);
    const dayJobs = state.jobs.filter((job) => job.date === key);
    const outside = date.getMonth() !== month;
    const isToday = key === today();
    return `
      <article class="day-card ${outside ? "outside-month" : ""} ${isToday ? "today" : ""}">
        <strong><span>${date.getDate()}</span><small>${dayJobs.length ? `${dayJobs.length} servicio${dayJobs.length === 1 ? "" : "s"}` : "vacio"}</small></strong>
        ${dayJobs.map((job) => calendarJobHtml(job)).join("") || "<span class='muted'>Sin servicios</span>"}
      </article>
    `;
  }).join("");

  $("#calendarGrid").innerHTML = weekdays + cells;
  $$("[data-calendar-job]").forEach((button) => {
    button.addEventListener("click", () => {
      expandedJobId = expandedJobId === button.dataset.calendarJob ? null : button.dataset.calendarJob;
      renderCalendar();
    });
  });
}

function calendarJobHtml(job) {
  const client = clientFor(job);
  const isExpanded = expandedJobId === job.id;
  const done = isDone(job);
  const fullAddress = fullAddressForClient(client);
  const mapsUrl = mapsUrlForClient(client);
  return `
    <button class="day-job ${done ? "done" : ""} ${isLiveJob(job) ? "live" : ""}" type="button" data-calendar-job="${job.id}">
      ${job.start} - ${client.name}
    </button>
    ${isExpanded ? `
      <div class="day-detail">
        <p><strong>${job.serviceType}</strong></p>
        <p>${fullAddress}</p>
        <p>${job.start}-${job.actualEnd || job.end || t("undefinedTime")} - ${jobStatusLabel(job)}</p>
        <a class="map-link" href="${mapsUrl}" target="_blank" rel="noreferrer">Abrir en Google Maps</a>
      </div>
    ` : ""}
  `;
}

function activeJob() {
  return state.jobs.find(isLiveJob) || state.jobs.find((job) => job.date === today()) || state.jobs[0];
}

function renderMobile() {
  const job = activeJob();
  const client = clientFor(job);
  $("#mobileJob").innerHTML = `
    <span class="status-chip">${job.status}</span>
    <h3>${client.name}</h3>
    <p class="muted">${client.address}</p>
    <div class="phone-step"><span>${localText("arrival")}</span><strong>${job.checkedIn ? job.start : localText("amountPending")}</strong></div>
    <div class="phone-step"><span>GPS</span><strong>${job.checkedIn ? localText("gpsSaved") : localText("gpsNotTaken")}</strong></div>
    <div class="phone-step"><span>${t("photos")}</span><strong>${evidenceCount(job)}</strong></div>
    <div class="phone-step"><span>${localText("departure")}</span><strong>${job.checkedOut ? (job.actualEnd || job.end) : localText("amountPending")}</strong></div>
    <div class="phone-step"><span>${localText("signature")}</span><strong>${job.signed ? localText("ready") : localText("amountPending")}</strong></div>
    <h4>Checklist</h4>
    ${job.tasks.map((task) => `<div class="phone-step"><span>${task}</span><strong>OK</strong></div>`).join("")}
  `;
}

function renderClientLinks() {
  const clients = activeClients();
  const rows = clients.map((client) => {
    const clientJobs = state.jobs.filter((job) => job.clientId === client.id);
    const activeCount = clientJobs.filter(isCurrentOrUpcomingJob).length;
    const historyCount = clientJobHistory(client.id).length;
    const portalUrl = localClientPortalUrl(client);
    const portalPassword = clientPortalPassword(client);
    const loc = locationMeta(client.address || "");
    return { client, activeCount, historyCount, portalUrl, portalPassword, loc };
  });
  const connectedCount = rows.filter((row) => row.activeCount > 0).length;
  const historyCountTotal = rows.reduce((sum, row) => sum + row.historyCount, 0);
  $("#clientLinkKpis").innerHTML = `
    <article>
      <span class="client-link-kpi-icon">🔗</span>
      <div><p>Total de links</p><strong>${rows.length}</strong><small>Portales activos</small></div>
    </article>
    <article>
      <span class="client-link-kpi-icon">👥</span>
      <div><p>Clientes conectados</p><strong>${connectedCount}</strong><small>Acceso a portal</small></div>
    </article>
    <article>
      <span class="client-link-kpi-icon">◇</span>
      <div><p>Seguridad</p><strong>100%</strong><small>Enlaces seguros</small></div>
    </article>
    <article>
      <span class="client-link-kpi-icon">▣</span>
      <div><p>En historial</p><strong>${historyCountTotal}</strong><small>Links utilizados</small></div>
    </article>
  `;
  $("#clientLinksCountryPill").textContent = `${countryInfo(state.country).name} · ${countryInfo(state.country).dial}`;
  const query = ($("#clientLinkSearch")?.value || "").trim().toLowerCase();
  const filter = $("#clientLinkFilter")?.value || "all";
  const filtered = rows.filter(({ client, activeCount, historyCount }) => {
    const matchesQuery = !query || [client.name, client.address, client.email].some((value) => String(value || "").toLowerCase().includes(query));
    const matchesFilter = filter === "all" || (filter === "active" && activeCount > 0) || (filter === "history" && historyCount > 0);
    return matchesQuery && matchesFilter;
  });
  $("#clientLinksList").innerHTML = `
    <div class="client-link-table-head">
      <span>Cliente</span>
      <span>Estado</span>
      <span>En historial</span>
      <span>Clave</span>
      <span>Link del portal</span>
      <span>Acciones</span>
    </div>
    ${filtered.length ? filtered.map(({ client, activeCount, historyCount, portalUrl, portalPassword, loc }) => {
    const initials = String(client.name || "JV").split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
    return `
      <article class="client-link-card">
        <div class="client-link-client">
          <span class="client-link-avatar">${escapeHtml(initials)}</span>
          <div>
            <strong>${escapeHtml(client.name)}</strong>
            <span>${escapeHtml(client.address || `${loc.city} - ${loc.region}`)}</span>
          </div>
        </div>
        <span class="client-link-status"><i></i>Activo</span>
        <div class="client-link-history">
          <strong>${activeCount} activo/proximo</strong>
          <span>${historyCount} en historial</span>
        </div>
        <div class="client-link-key">
          <code>${escapeHtml(portalPassword)}</code>
          <button type="button" title="Copiar link" data-copy-client-link="${client.id}">⧉</button>
        </div>
        <div class="client-link-url">
          <strong>${escapeHtml(portalUrl)}</strong>
          <span>Copiado el ${new Date().toLocaleDateString("es")} ${new Date().toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}</span>
        </div>
        <div class="client-link-actions">
          <button class="ghost" type="button" data-copy-client-link="${client.id}">Copiar link</button>
          <button class="primary" type="button" data-open-client-portal="${client.id}">Ver portal</button>
          <button class="ghost icon-only" type="button" data-open-client-portal="${client.id}" aria-label="Mas opciones">⋮</button>
        </div>
      </article>
    `;
  }).join("") : `<div class="client-link-empty">No hay clientes que coincidan con la busqueda.</div>`}
  `;
  $("#clientLinkSearch")?.addEventListener("input", renderClientLinks, { once: true });
  $("#clientLinkFilter")?.addEventListener("change", renderClientLinks, { once: true });
  $$("[data-copy-client-link]").forEach((button) => {
    button.addEventListener("click", () => copyClientLink(button.dataset.copyClientLink));
  });
  $$("[data-open-client-portal]").forEach((button) => {
    button.addEventListener("click", () => {
      const client = state.clients.find((item) => item.id === button.dataset.openClientPortal);
      if (!client) return;
      window.open(localClientPortalUrl(client), "_blank");
    });
  });
  renderClientPortal(state.clients[0]?.id, true);
}

function renderClientLinks() {
  const clients = activeClients();
  const rows = clients.map((client) => {
    const clientJobs = state.jobs.filter((job) => job.clientId === client.id);
    const activeCount = clientJobs.filter(isCurrentOrUpcomingJob).length;
    const historyCount = clientJobHistory(client.id).length;
    const portalUrl = localClientPortalUrl(client);
    const portalPassword = clientPortalPassword(client);
    const loc = locationMeta(client.address || "");
    return { client, activeCount, historyCount, portalUrl, portalPassword, loc };
  });
  const connectedCount = rows.filter((row) => row.activeCount > 0).length;
  const historyCountTotal = rows.reduce((sum, row) => sum + row.historyCount, 0);
  const currentCountry = countryInfo(state.country);
  const countryPill = $("#clientLinksCountryPill");
  if (countryPill) countryPill.textContent = `${currentCountry.name} - ${currentCountry.dial}`;
  $("#clientLinkKpis").innerHTML = [
    { icon: "↗", label: "Total de links", value: rows.length, copy: "Portales activos" },
    { icon: "☷", label: "Clientes conectados", value: connectedCount, copy: "Acceso a portal" },
    { icon: "◇", label: "Seguridad", value: "100%", copy: "Enlaces seguros" },
    { icon: "▣", label: "En historial", value: historyCountTotal, copy: "Links utilizados" }
  ].map((item) => `
    <article>
      <span class="client-link-kpi-icon">${item.icon}</span>
      <div>
        <p>${item.label}</p>
        <strong>${item.value}</strong>
        <small>${item.copy}</small>
      </div>
    </article>
  `).join("");

  const query = ($("#clientLinkSearch")?.value || "").trim().toLowerCase();
  const filter = $("#clientLinkFilter")?.value || "all";
  const filtered = rows.filter(({ client, activeCount, historyCount }) => {
    const matchesQuery = !query || [client.name, client.address, client.email].some((value) => String(value || "").toLowerCase().includes(query));
    const matchesFilter = filter === "all" || (filter === "active" && activeCount > 0) || (filter === "history" && historyCount > 0);
    return matchesQuery && matchesFilter;
  });
  const copiedLabel = new Date().toLocaleString("es", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  $("#clientLinksList").innerHTML = `
    <div class="client-link-table-head">
      <span>Cliente</span>
      <span>Estado</span>
      <span>En historial</span>
      <span>Clave</span>
      <span>Link del portal</span>
      <span>Acciones</span>
    </div>
    ${filtered.length ? filtered.map(({ client, activeCount, historyCount, portalUrl, portalPassword, loc }) => {
      const initials = String(client.name || "JV").split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
      const displayUrl = portalUrl;
      return `
        <article class="client-link-card">
          <div class="client-link-client">
            <span class="client-link-avatar">${escapeHtml(initials)}</span>
            <div>
              <strong>${escapeHtml(client.name)}</strong>
              <span>${escapeHtml(client.address || `${loc.city} - ${loc.region}`)}</span>
            </div>
          </div>
          <span class="client-link-status"><i></i>Activo</span>
          <div class="client-link-history">
            <strong>${activeCount} activo/proximo</strong>
            <span>${historyCount} en historial</span>
          </div>
          <div class="client-link-key">
            <code>${escapeHtml(portalPassword)}</code>
            <button type="button" title="Copiar clave" data-copy-client-key="${client.id}">⧉</button>
          </div>
          <div class="client-link-url">
            <strong>${escapeHtml(displayUrl)}</strong>
            <span>Copiado el ${copiedLabel}</span>
          </div>
          <div class="client-link-actions">
            <button class="ghost" type="button" data-copy-client-link="${client.id}">Copiar link</button>
            <button class="primary" type="button" data-open-client-portal="${client.id}">Ver portal</button>
            <button class="ghost icon-only" type="button" data-open-client-portal="${client.id}" aria-label="Mas opciones">⋮</button>
          </div>
        </article>
      `;
    }).join("") : `<div class="client-link-empty">No hay clientes que coincidan con la busqueda.</div>`}
  `;
  $("#clientLinkSearch")?.addEventListener("input", renderClientLinks, { once: true });
  $("#clientLinkFilter")?.addEventListener("change", renderClientLinks, { once: true });
  $$("[data-copy-client-link]").forEach((button) => {
    button.addEventListener("click", () => copyClientLink(button.dataset.copyClientLink));
  });
  $$("[data-copy-client-key]").forEach((button) => {
    button.addEventListener("click", () => copyClientKey(button.dataset.copyClientKey));
  });
  $$("[data-open-client-portal]").forEach((button) => {
    button.addEventListener("click", () => {
      const client = state.clients.find((item) => item.id === button.dataset.openClientPortal);
      if (!client) return;
      window.open(localClientPortalUrl(client), "_blank");
    });
  });
  renderClientPortal(state.clients[0]?.id, true);
}

async function copyClientLink(clientId) {
  const client = state.clients.find((item) => item.id === clientId);
  if (!client) return;
  const text = localClientPortalUrl(client);
  try {
    await navigator.clipboard.writeText(text);
    toast("Link copiado. La clave ya esta incluida en la URL.");
  } catch {
    window.prompt("Copia este link:", text);
  }
}

function renderClientPortal(clientId, keepHidden = false) {
  const selectedClient = state.clients.find((item) => item.id === clientId) || state.clients[0];
  const job = currentClientJob(selectedClient?.id);
  const historyJobs = clientJobHistory(selectedClient?.id);
  const client = job ? clientFor(job) : selectedClient;
  if (!client) return;
  if (!keepHidden) $("#clientPortalPreview").classList.remove("hidden");
  $("#clientSummary").innerHTML = job ? `
    <p class="muted">${client.name} - ${client.address}</p>
    <p>${t("adminAccess")}: <strong>${t("readOnly")}</strong></p>
    <p>${t("currentService")}: <strong>${job.serviceType}</strong></p>
    <p>${t("status")}: <strong>${jobStatusLabel(job)}</strong></p>
    <p>${t("cleanerArrival")}: <strong>${job.checkedIn ? job.start : t("pending")}</strong></p>
    <p>${t("cleanerDeparture")}: <strong>${job.checkedOut ? (job.actualEnd || job.end) : t("pending")}</strong></p>
    <p>${t("photos")}: <strong>${evidenceCount(job)}</strong></p>
    <p>${t("cleanerCompleted")}: <strong>${job.cleanerFinished || job.checkedOut ? t("yes") : t("pending")}</strong></p>
    <p>${t("clientConfirmationShort")}: <strong>${job.clientConfirmed ? t("confirmedByClient") : t("pending")}</strong></p>
    <p>${t("onsiteSignature")}: <strong>${job.siteSignature ? `${t("onsiteSignatureReceived")} ${job.siteSignerName || t("onsitePerson")}` : t("pending")}</strong></p>
    <p>${t("checklist")}: <strong>${job.tasks.join(", ")}</strong></p>
  ` : `
    <p class="muted">${client.name} - ${client.address}</p>
    <p>${t("adminAccess")}: <strong>${t("readOnly")}</strong></p>
    <p>${t("currentService")}: <strong>${t("noActiveJobs")}</strong></p>
    <p>${t("completedJobsHistoryBelow")}</p>
  `;
  $("#photoBoard").innerHTML = job ? `
    ${photoSectionsHtml(job)}
    <section class="panel client-history-panel">
      <h2>${t("serviceHistory")}</h2>
      ${clientHistoryHtml(historyJobs)}
    </section>
  ` : `
    <section class="panel client-history-panel">
      <h2>${t("serviceHistory")}</h2>
      ${clientHistoryHtml(historyJobs)}
    </section>
  `;
  bindPhotoActions();
}

function renderPhotoBoard(selector, job, options = {}) {
  document.querySelector(selector).innerHTML = photoSectionsHtml(job, options);
}

function photoBoardHtml(job, compact = false, options = {}) {
  return `<div class="photo-board ${compact ? "compact" : ""}">${photoSectionsHtml(job, options)}</div>`;
}

function photoSectionsHtml(job, options = {}) {
  const evidence = evidenceFor(job);
  if (!evidence.length) {
    return `<article class="photo-section empty-evidence"><strong>${t("evidence")}</strong><p class="photo-comment">${t("noEvidenceYet")}</p></article>`;
  }
  const grouped = evidence.reduce((acc, item) => {
    const dateKey = new Date(item.createdAt || Date.now()).toLocaleDateString("es");
    if (!acc[dateKey]) acc[dateKey] = [];
    acc[dateKey].push(item);
    return acc;
  }, {});
  return Object.entries(grouped).map(([dateLabel, items], index) => `
    <details class="evidence-group" ${index === 0 ? "open" : ""}>
      <summary>${t("dateLabel")} ${index + 1} - ${dateLabel} (${items.length} ${items.length === 1 ? t("photoSingular") : t("photoPlural")})</summary>
      <div class="evidence-area-list">
        ${Object.entries(items.reduce((areaAcc, item) => {
          const area = item.section || "General";
          if (!areaAcc[area]) areaAcc[area] = [];
          areaAcc[area].push(item);
          return areaAcc;
        }, {})).map(([area, areaItems]) => `
          <article class="evidence-area">
            <h4>${escapeHtml(area)}</h4>
            <div class="evidence-phase-grid">
              ${[{ key: "Antes", label: t("before") }, { key: "Despues", label: t("after") }].map(({ key: phase, label }) => {
                const phaseItems = areaItems.filter((item) => normalizeKey(item.phase) === normalizeKey(phase));
                return `
                  <section class="evidence-phase">
                    <strong>${label}</strong>
                    ${phaseItems.length ? `<div class="evidence-grid">
                      ${phaseItems.map((item) => `
                        <article class="evidence-card">
                          <button class="photo-tile has-photo evidence-thumb" type="button" data-view-photo="${item.id}">
                            <img src="${item.url}" alt="${escapeHtml(item.section)} ${escapeHtml(item.phase)}">
                            <small>${escapeHtml(item.comment || t("viewLarge"))}</small>
                          </button>
                          <p class="photo-comment">${escapeHtml(item.comment || t("noComment"))}</p>
                          ${options.canDelete ? `
                            <div class="receipt-actions">
                              <button class="mini-action" type="button" data-edit-photo="${item.id}">${t("correct")}</button>
                              <button class="mini-action danger" type="button" data-delete-photo="${item.id}">${t("delete")}</button>
                            </div>
                          ` : ""}
                        </article>
                      `).join("")}
                    </div>` : `<p class="phase-empty">${t("pending")}</p>`}
                  </section>
                `;
              }).join("")}
            </div>
          </article>
        `).join("")}
      </div>
    </details>
  `).join("");
}

function findEvidence(photoId) {
  for (const job of state.jobs) {
    const photo = evidenceFor(job).find((item) => item.id === photoId);
    if (photo) return { job, photo };
  }
  return null;
}

function openPhotoModal(photoId) {
  const found = findEvidence(photoId);
  if (!found) return;
  $("#photoModalTitle").textContent = `${found.photo.section} - ${found.photo.phase}`;
  $("#photoModalMeta").textContent = new Date(found.photo.createdAt || Date.now()).toLocaleString("es");
  $("#photoModalImage").src = found.photo.url;
  $("#photoModalComment").textContent = found.photo.comment || t("noComment");
  $("#photoModal").classList.remove("hidden");
}

function bindPhotoActions(canDelete = false) {
  $$("[data-view-photo]").forEach((button) => {
    button.addEventListener("click", () => openPhotoModal(button.dataset.viewPhoto));
  });
  if (!canDelete) return;
  $$("[data-delete-photo]").forEach((button) => {
    button.addEventListener("click", async () => {
      const found = findEvidence(button.dataset.deletePhoto);
      if (!found) return;
      if (!window.confirm(t("confirmDeletePhoto"))) return;
      found.job.evidence = evidenceFor(found.job).filter((item) => item.id !== button.dataset.deletePhoto);
      found.job.photos = evidenceCount(found.job);
      save();

      if (supabaseClient) {
        try {
          await supabaseClient.from("job_evidence").delete().eq("id", button.dataset.deletePhoto);
        } catch (err) {
          console.error("Error deleting evidence in portal mode:", err);
        }
      }

      if (!$("#cleanerPortalPage")?.classList.contains("hidden")) {
        renderStandaloneCleanerPortal(true);
      } else {
        renderAll();
      }
      toast(t("photoDeleted"));
    });
  });
}

function renderReports() {
  const reportJobs = state.jobs.filter(isCurrentMonth);
  const billableJobs = reportJobs.filter(isBillableDone);
  const registeredJobs = reportJobs.filter((job) => !isBillableDone(job));
  const total = billableJobs.reduce((sum, job) => sum + estimateJob(job), 0);
  const cleanerCosts = billableJobs.reduce((sum, job) => sum + cleanerCostForJob(job), 0);
  const grossProfit = Math.max(0, total - cleanerCosts);
  const tax = total * (state.vatRate / 100);
  const completed = billableJobs.length;
  const activeClients = new Set(billableJobs.map((job) => job.clientId)).size;
  const totalHours = billableJobs.reduce((sum, job) => sum + jobHours(job), 0);
  const costPct = total ? Math.round((cleanerCosts / total) * 100) : 0;
  const marginPct = Math.max(0, 100 - costPct);
  const totalEvidence = reportJobs.reduce((sum, job) => sum + evidenceCount(job), 0);
  const signedJobs = reportJobs.filter((job) => job.signed || job.siteSignature || job.clientSignature).length;
  const gpsJobs = reportJobs.filter((job) => job.checkedIn || job.checkedOut).length;

  $("#reportKpis").innerHTML = `
    <article class="report-kpi"><i>${state.currencySymbol}</i><div><span>Ganancia bruta real</span><strong>${state.currencySymbol}${grossProfit.toFixed(0)}</strong><small>+18.6% vs mes anterior</small></div></article>
    <article class="report-kpi"><i>☷</i><div><span>Clientes atendidos</span><strong>${activeClients}</strong><small>+12% vs mes anterior</small></div></article>
    <article class="report-kpi"><i>♙</i><div><span>Invertido en cleaners</span><strong>${state.currencySymbol}${cleanerCosts.toFixed(0)}</strong><small>+9.4% vs mes anterior</small></div></article>
    <article class="report-kpi"><i>%</i><div><span>Margen referencial</span><strong>${marginPct}%</strong><small>+5.2% vs mes anterior</small></div></article>
  `;

  const incomePct = total ? Math.round((grossProfit / total) * 100) : 0;
  const cleanerPct = total ? Math.round((cleanerCosts / total) * 100) : 0;
  const taxPct = total ? Math.round((tax / (total + tax)) * 100) : 0;
  $("#incomeDonut").style.background = `conic-gradient(var(--green) 0 ${incomePct}%, var(--gold) ${incomePct}% ${incomePct + cleanerPct}%, var(--teal) ${incomePct + cleanerPct}% 100%)`;
  $("#incomeLegend").innerHTML = `
    <div class="legend-item"><span><i style="background: var(--green)"></i>Ganancia bruta</span><strong>${state.currencySymbol}${grossProfit.toFixed(0)}</strong></div>
    <div class="legend-item"><span><i style="background: var(--gold)"></i>Pago cleaners</span><strong>${state.currencySymbol}${cleanerCosts.toFixed(0)}</strong></div>
    <div class="legend-item"><span><i style="background: var(--teal)"></i>IVA estimado</span><strong>${state.currencySymbol}${tax.toFixed(0)}</strong></div>
  `;

  const clientTotals = state.clients.map((client) => {
    const jobs = billableJobs.filter((job) => job.clientId === client.id);
    return { name: client.name, total: jobs.reduce((sum, job) => sum + estimateJob(job), 0), jobs: jobs.length };
  }).filter((item) => item.jobs);
  const maxClientTotal = Math.max(1, ...clientTotals.map((item) => item.total));
  $("#clientBars").innerHTML = clientTotals.map((item) => `
    <div class="bar-row">
      <div class="bar-top"><span>${item.name}<small>${item.jobs} servicio${item.jobs === 1 ? "" : "s"}</small></span><strong>${state.currencySymbol}${item.total.toFixed(0)}</strong></div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.max(8, (item.total / maxClientTotal) * 100)}%"></div></div>
    </div>
  `).join("") || "<p class='muted'>Aún no hay clientes con trabajos completados este mes.</p>";

  const trendValues = [32, 28, 35, 31, 52, 27, 46, 42, 68];
  $("#reportTrendLine").innerHTML = trendValues.map((value, index) => `<span style="--h:${value}%;--i:${index}"></span>`).join("");
  const goal = 60;
  const goalPct = Math.min(100, Math.round((completed / goal) * 100));
  $("#reportGauge").innerHTML = `
    <div class="gauge-ring" style="--pct:${goalPct}%"><strong>${completed}</strong><span>de ${goal}</span></div>
    <small>${goalPct}% del objetivo</small>
  `;
  $("#reportEvidenceStats").innerHTML = `
    <article><span>▣</span><strong>${totalEvidence}</strong><small>Fotos</small></article>
    <article><span>⌁</span><strong>${signedJobs}</strong><small>Firmas</small></article>
    <article><span>⌖</span><strong>${gpsJobs}</strong><small>GPS</small></article>
  `;

  $("#costRules").innerHTML = `
    <div class="report-line"><span>Regla general cleaner</span><strong>${state.currencySymbol}${state.costRules.generalCleanerRate}/h</strong></div>
    ${Object.entries(state.costRules.generalServiceRates || {}).map(([service, rate]) => `
      <div class="report-line"><span>${service}</span><strong>${state.currencySymbol}${rate}/h costo cleaner</strong></div>
    `).join("")}
    ${state.costRules.specialRules.length ? state.costRules.specialRules.map((rule) => `
      <div class="report-line">
        <span>${rule.cleanerName}</span>
        <strong>${rule.mode === "match_client" ? "Igual al cliente" : rule.mode === "add" ? `General + especial` : `Reemplaza por servicio`}</strong>
      </div>
    `).join("") : `<div class="report-line"><span>Reglas especiales</span><strong>Sin excepciones</strong></div>`}
  `;

  $("#reportLines").innerHTML = `
    <div class="report-line"><span>Subtotal real</span><strong>${state.currencySymbol}${total.toFixed(0)}</strong></div>
    <div class="report-line"><span>Pago real/estimado a cleaners</span><strong>${state.currencySymbol}${cleanerCosts.toFixed(0)}</strong></div>
    <div class="report-line"><span>Ganancia bruta real</span><strong>${state.currencySymbol}${grossProfit.toFixed(0)}</strong></div>
    <div class="report-line"><span>IVA estimado ${state.vatRate}%</span><strong>${state.currencySymbol}${tax.toFixed(0)}</strong></div>
    <div class="report-line"><span>Total referencial</span><strong>${state.currencySymbol}${(total + tax).toFixed(0)}</strong></div>
    <div class="report-line"><span>Trabajos completados</span><strong>${completed}</strong></div>
    <div class="report-line"><span>Trabajos registrados sin contabilizar</span><strong>${registeredJobs.length}</strong></div>
    <div class="report-line"><span>Horas realizadas</span><strong>${totalHours.toFixed(1)}h</strong></div>
  `;
}

function renderSettings() {
  const profile = state.companyProfile || {};
  const profileForm = $("#profileSettingsForm");
  if (profileForm) {
    profileForm.elements.businessName.value = profile.businessName || "";
    profileForm.elements.ownerName.value = profile.ownerName || "";
    if (profileForm.elements.greetingName) profileForm.elements.greetingName.value = profile.greetingName || firstName(profile.ownerName);
    profileForm.elements.phone.value = profile.phone || "";
    profileForm.elements.email.value = profile.email || "";
    profileForm.elements.address.value = profile.address || "";
    if (profileForm.elements.vatRate) profileForm.elements.vatRate.value = state.vatRate;
    if (profileForm.elements.currencySymbol) profileForm.elements.currencySymbol.value = state.currencySymbol;
  }
  const photoPreview = $("#profilePhotoPreview");
  if (photoPreview) {
    photoPreview.textContent = profile.photo ? "" : (profile.ownerName || profile.businessName || "JV").slice(0, 2).toUpperCase();
    photoPreview.style.backgroundImage = profile.photo ? `url("${profile.photo}")` : "";
  }
  $("#serviceRulesEditor").innerHTML = Object.entries(state.serviceRules).map(([name, rate]) => `
    <label>${name}<input name="${name}" type="number" min="0" value="${rate}"></label>
  `).join("");
  renderClientPriceRulesSettings();
  const costForm = $("#costRulesForm");
  costForm.elements.generalCleanerRate.value = state.costRules.generalCleanerRate;
  $("#generalCleanerRulesEditor").innerHTML = serviceRateInputs("generalService__", state.costRules.generalServiceRates);
  $("#specialCleanerRulesEditor").innerHTML = serviceRateInputs("specialService__", {});
  const ruleCleaners = activeCleaners();
  $("#specialCleanerSelect").innerHTML = ruleCleaners.length
    ? ruleCleaners.map((cleaner) => `<option value="${cleaner.id}">${cleaner.name}</option>`).join("")
    : `<option value="">Sin cleaners activos</option>`;
  if (!ruleCleaners.some((cleaner) => cleaner.id === costForm.elements.specialCleanerId.value) && ruleCleaners[0]) {
    costForm.elements.specialCleanerId.value = ruleCleaners[0].id;
  }
  $("#specialCostRulesList").innerHTML = state.costRules.specialRules.length ? state.costRules.specialRules.map((rule) => {
    const serviceSummary = Object.entries(rule.serviceRates || {})
      .map(([service, rate]) => `${service}: $${rate}/h`)
      .join(" · ");
    const finalText = rule.mode === "match_client"
      ? "Cobra el mismo valor que se cobra al cliente"
      : rule.mode === "add"
        ? `Se suma a la regla general. Base especial: $${rule.rate}/h`
        : `Reemplaza la regla general. Base especial: $${rule.rate}/h`;
    return `
      <article class="cost-rule-card">
        <div>
          <strong>${rule.cleanerName}</strong>
          <span>${finalText}</span>
          ${rule.mode !== "match_client" ? `<small>${serviceSummary}</small>` : ""}
        </div>
        <div class="receipt-actions">
          <button class="mini-action" type="button" data-edit-cost-rule="${rule.id}">Editar</button>
          <button class="mini-action danger" type="button" data-delete-cost-rule="${rule.id}">Eliminar</button>
        </div>
      </article>
    `;
  }).join("") : "<p class='muted'>No hay reglas particulares guardadas todavia.</p>";
  $$("[data-edit-cost-rule]").forEach((button) => {
    button.addEventListener("click", () => startCostRuleEdit(button.dataset.editCostRule));
  });
  $$("[data-delete-cost-rule]").forEach((button) => {
    button.addEventListener("click", () => deleteCostRule(button.dataset.deleteCostRule));
  });

  // Render Super Admin Stripe Payments Panel
  const isSuperAdmin = state.user?.email === window.JOBVISTO_CONFIG?.ownerEmail;
  const adminPanel = $("#adminPaymentsPanel");
  if (adminPanel) {
    if (isSuperAdmin) {
      adminPanel.classList.remove("hidden");
      loadAndRenderAdminPayments();
    } else {
      adminPanel.classList.add("hidden");
    }
  }
}

async function loadAndRenderAdminPayments() {
  const listEl = $("#adminPaymentsList");
  if (!listEl) return;
  
  if (!supabaseClient) {
    listEl.innerHTML = "<p class='muted'>Supabase no esta configurado.</p>";
    return;
  }
  
  try {
    const { data: payments, error } = await supabaseClient
      .from("stripe_payments")
      .select("*")
      .order("created_at", { ascending: false });
      
    if (error) throw error;
    
    if (!payments || payments.length === 0) {
      listEl.innerHTML = "<p class='muted'>No se han registrado pagos de Stripe todavia.</p>";
      return;
    }
    
    listEl.innerHTML = payments.map(p => `
      <article class="receipt-item">
        <strong>${p.email}</strong>
        <span class="client-meta">Plan: ${p.plan_id} · Cliente: ${p.customer_id || 'N/A'}</span>
        <span class="client-meta">Suscripcion: ${p.subscription_id || 'N/A'}</span>
        <span class="client-meta">Sesion: ${p.session_id || 'N/A'}</span>
        <span class="badge ${p.payment_status === 'paid' || p.payment_status === 'complete' ? 'dark' : 'gold'}">${p.payment_status}</span>
        <span class="client-meta">Fecha: ${new Date(p.created_at).toLocaleString()}</span>
      </article>
    `).join("");
  } catch (err) {
    console.error("Error loading stripe payments for admin:", err);
    listEl.innerHTML = `<p class="muted error">Error al cargar pagos: ${err.message}</p>`;
  }
}

function resetCostRuleForm() {
  const costForm = $("#costRulesForm");
  costForm.elements.ruleId.value = "";
  costForm.elements.specialCleanerRate.value = "";
  costForm.elements.specialMode.value = "replace";
  $("#specialCleanerRulesEditor").innerHTML = serviceRateInputs("specialService__", {});
  const firstActiveCleaner = activeCleaners()[0];
  if (firstActiveCleaner) costForm.elements.specialCleanerId.value = firstActiveCleaner.id;
  costForm.querySelector("button[type='submit']").textContent = "Guardar reglas de costos";
}

function startCostRuleEdit(ruleId) {
  const rule = state.costRules.specialRules.find((item) => item.id === ruleId);
  if (!rule) return;
  const costForm = $("#costRulesForm");
  costForm.elements.ruleId.value = rule.id;
  costForm.elements.specialCleanerId.value = rule.cleanerId;
  costForm.elements.specialMode.value = rule.mode || "replace";
  costForm.elements.specialCleanerRate.value = rule.rate;
  $("#specialCleanerRulesEditor").innerHTML = serviceRateInputs("specialService__", rule.serviceRates || {});
  costForm.querySelector("button[type='submit']").textContent = "Actualizar regla de costos";
  toast("Editando regla especial.");
}

function deleteCostRule(ruleId) {
  if (!window.confirm(t("confirmDeleteCostRule"))) return;
  state.costRules.specialRules = state.costRules.specialRules.filter((rule) => rule.id !== ruleId);
  save();
  renderAll();
  toast(t("costRuleDeleted"));
}

function renderClientPriceRulesSettings() {
  const form = $("#clientPriceRulesForm");
  if (!form) return;
  const clients = activeClients();
  const selectedClientId = form.elements.clientId?.value;
  $("#specialClientPriceSelect").innerHTML = clients.length
    ? clients.map((client) => `<option value="${client.id}">${escapeHtml(client.name)}</option>`).join("")
    : `<option value="">Sin clientes activos</option>`;
  if (clients.length && !clients.some((client) => client.id === selectedClientId)) {
    form.elements.clientId.value = clients[0].id;
  }
  if (!$("#specialClientPricesEditor").innerHTML.trim()) {
    $("#specialClientPricesEditor").innerHTML = serviceRateInputs("clientService__", {});
  }
  const rules = state.clientPriceRules || [];
  $("#specialClientPriceRulesList").innerHTML = rules.length ? rules.map((rule) => {
    const client = state.clients.find((item) => item.id === rule.clientId);
    const serviceSummary = Object.entries(rule.serviceRates || {})
      .filter(([, rate]) => Number(rate) > 0)
      .map(([service, rate]) => `${service}: $${rate}/h`)
      .join(" - ");
    return `
      <article class="cost-rule-card client-price-rule-card">
        <div>
          <strong>${escapeHtml(client?.name || rule.clientName || "Cliente")}</strong>
          <span>Precio independiente para este cliente</span>
          <small>${escapeHtml(serviceSummary || "Usa la regla general en todos los servicios")}</small>
        </div>
        <div class="receipt-actions">
          <button class="mini-action" type="button" data-edit-client-price-rule="${rule.id}">Editar</button>
          <button class="mini-action danger" type="button" data-delete-client-price-rule="${rule.id}">Eliminar</button>
        </div>
      </article>
    `;
  }).join("") : "<p class='muted'>No hay precios especiales por cliente todavia.</p>";
  $$("[data-edit-client-price-rule]").forEach((button) => {
    button.addEventListener("click", () => startClientPriceRuleEdit(button.dataset.editClientPriceRule));
  });
  $$("[data-delete-client-price-rule]").forEach((button) => {
    button.addEventListener("click", () => deleteClientPriceRule(button.dataset.deleteClientPriceRule));
  });
}

function resetClientPriceRuleForm() {
  const form = $("#clientPriceRulesForm");
  if (!form) return;
  form.elements.clientRuleId.value = "";
  $("#specialClientPricesEditor").innerHTML = serviceRateInputs("clientService__", {});
  const firstClient = activeClients()[0];
  if (firstClient) form.elements.clientId.value = firstClient.id;
  form.querySelector("button[type='submit']").textContent = "Guardar regla del cliente";
}

function startClientPriceRuleEdit(ruleId) {
  const rule = (state.clientPriceRules || []).find((item) => item.id === ruleId);
  const form = $("#clientPriceRulesForm");
  if (!rule || !form) return;
  form.elements.clientRuleId.value = rule.id;
  form.elements.clientId.value = rule.clientId;
  $("#specialClientPricesEditor").innerHTML = serviceRateInputs("clientService__", rule.serviceRates || {});
  form.querySelector("button[type='submit']").textContent = "Actualizar regla del cliente";
  toast("Editando precio especial del cliente.");
}

function deleteClientPriceRule(ruleId) {
  if (!window.confirm("Eliminar esta regla especial del cliente?")) return;
  state.clientPriceRules = (state.clientPriceRules || []).filter((rule) => rule.id !== ruleId);
  save();
  resetClientPriceRuleForm();
  renderAll();
  toast("Regla especial del cliente eliminada.");
}

function serviceRateInputs(namePrefix, values = {}) {
  return Object.entries(state.serviceRules).map(([service]) => `
    <label>${service}<input name="${namePrefix}${escapeHtml(service)}" type="number" min="0" value="${Number(values[service] || 0)}"></label>
  `).join("");
}

function readServiceRates(form, namePrefix, fallback = 0) {
  return Object.fromEntries(Object.keys(state.serviceRules).map((service) => [
    service,
    Number(form.elements[`${namePrefix}${service}`]?.value || fallback || 0)
  ]));
}

function renderPayments() {
  // Cleaners Tab
  syncPaymentCleanerSelect();
  $("#paymentPeriod").value = $("#paymentPeriod").value || currentPeriodLabel();
  renderPaymentJobPicker();
  
  // Clients Tab
  syncClientPaymentSelect();
  renderClientPaymentJobPicker();
  renderClientBalances();
  
  $("#paymentReceipts").innerHTML = state.receipts.length
    ? state.receipts.map((receipt) => `
      <article class="receipt-item ${receipt.status === "pending_signature" ? "pending" : ""}">
        <strong>${receipt.cleaner} - $${receipt.amount}</strong>
        <span class="client-meta">${receipt.period || "Periodo no definido"} - ${receipt.method} - ${receipt.date}</span>
        ${receipt.jobIds?.length ? `<span class="client-meta">${receipt.jobIds.length} trabajo${receipt.jobIds.length === 1 ? "" : "s"} incluido${receipt.jobIds.length === 1 ? "" : "s"}</span>` : ""}
        <span class="badge ${receipt.status === "signed" ? "dark" : "gold"}">${receipt.status === "signed" ? localText("paymentSignedReceived") : localText("cleanerPaymentSignaturePending")}</span>
        ${receipt.signature ? `<img class="signature-preview" src="${receipt.signature}" alt="Firma de ${receipt.receiver || receipt.cleaner}">` : ""}
        <div class="receipt-actions">
          <button class="mini-action" type="button" data-edit-payment="${receipt.id}">Editar</button>
          <button class="mini-action" type="button" data-sign-payment="${receipt.id}">${receipt.signature ? "Ver / reemplazar firma" : "Firmar recibido"}</button>
          ${receipt.signature ? `<button class="mini-action danger" type="button" data-delete-payment-signature="${receipt.id}">Eliminar firma</button>` : ""}
          <button class="mini-action danger" type="button" data-delete-payment-receipt="${receipt.id}">Eliminar comprobante</button>
        </div>
        <span class="client-meta">${receipt.date}</span>
      </article>
    `).join("")
    : "<p class='muted'>Todavia no hay pagos registrados.</p>";
  $$("[data-edit-payment]").forEach((button) => {
    button.addEventListener("click", () => startPaymentEdit(button.dataset.editPayment));
  });
  $$("[data-sign-payment]").forEach((button) => {
    button.addEventListener("click", () => openSignatureModal(button.dataset.signPayment));
  });
  $$("[data-delete-payment-signature]").forEach((button) => {
    button.addEventListener("click", () => deletePaymentSignature(button.dataset.deletePaymentSignature));
  });
  $$("[data-delete-payment-receipt]").forEach((button) => {
    button.addEventListener("click", () => openDeleteReceiptModal(button.dataset.deletePaymentReceipt));
  });
}

function syncPaymentCleanerSelect(selectedName = "") {
  const select = $("#paymentCleanerSelect");
  if (!select) return;
  const names = activeCleaners().map((cleaner) => cleaner.name);
  if (selectedName && !names.some((name) => normalizeKey(name) === normalizeKey(selectedName))) {
    names.push(selectedName);
  }
  select.innerHTML = names.length
    ? names.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("")
    : `<option value="">Sin cleaners activos</option>`;
  select.value = selectedName || names[0] || "";
}

function paymentCleanerRecord(name = $("#paymentCleanerSelect")?.value) {
  return activeCleaners().find((cleaner) => normalizeKey(cleaner.name) === normalizeKey(name))
    || state.cleaners.find((cleaner) => normalizeKey(cleaner.name) === normalizeKey(name));
}

function receiptPaidJobIds(exceptReceiptId = "") {
  return new Set(state.receipts
    .filter((receipt) => receipt.id !== exceptReceiptId)
    .flatMap((receipt) => Array.isArray(receipt.jobIds) ? receipt.jobIds : []));
}

function paymentJobsForCleaner(cleanerName, exceptReceiptId = "") {
  const cleaner = paymentCleanerRecord(cleanerName);
  if (!cleaner) return [];
  const paidIds = receiptPaidJobIds(exceptReceiptId);
  return state.jobs
    .filter((job) => job.cleanerId === cleaner.id && isBillableDone(job) && !paidIds.has(job.id))
    .sort((a, b) => `${b.date} ${b.start}`.localeCompare(`${a.date} ${a.start}`));
}

function selectedPaymentJobIds() {
  return $$("[data-payment-job]:checked").map((input) => input.value);
}

function syncPaymentAmountFromJobs() {
  const selectedIds = selectedPaymentJobIds();
  const total = selectedIds.reduce((sum, jobId) => {
    const job = state.jobs.find((item) => item.id === jobId);
    return sum + (job ? cleanerCostForJob(job) : 0);
  }, 0);
  if (selectedIds.length) $("#paymentAmount").value = total.toFixed(2);
  if ($("#paymentAmountReceived")) $("#paymentAmountReceived").value = total.toFixed(2);
  syncPaymentSummaryCard();
}

function syncPaymentSummaryCard() {
  const selectedIds = selectedPaymentJobIds();
  const amountVal = parseFloat($("#paymentAmount")?.value || 0) || 0;
  const subtotalEl = $("#pscSubtotal");
  const totalEl = $("#pscTotal");
  if (subtotalEl) subtotalEl.textContent = money(amountVal);
  if (totalEl) totalEl.textContent = money(amountVal);
  // Update job count row
  const firstRow = document.querySelector(".psc-row");
  if (firstRow) firstRow.querySelector("strong").textContent = selectedIds.length;
}

function renderPaymentJobPicker(selectedJobIds = []) {
  const picker = $("#paymentJobPicker");
  if (!picker) return;
  const form = $("#paymentForm");
  const cleanerName = form.elements.cleaner.value;
  const receiptId = form.elements.id.value;
  const jobs = paymentJobsForCleaner(cleanerName, receiptId);
  if (!cleanerName) {
    picker.innerHTML = "<p class='muted'>Selecciona un cleaner para ver trabajos realizados.</p>";
    return;
  }
  if (!jobs.length) {
    picker.innerHTML = "<p class='muted'>No hay trabajos terminados pendientes de pago para este cleaner.</p>";
    if (!receiptId) $("#paymentAmount").value = 0;
    return;
  }
  const selected = new Set(selectedJobIds);
  picker.innerHTML = `
    <div class="payment-job-picker-head">
      <strong>Trabajos realizados a pagar</strong>
      <button class="mini-action" type="button" id="selectAllPaymentJobs">Seleccionar todos</button>
    </div>
    <div class="payment-job-list">
      ${jobs.map((job) => {
        const client = clientFor(job);
        const cost = cleanerCostForJob(job);
        const checked = selected.size ? selected.has(job.id) : false;
        return `
          <label class="payment-job-option">
            <input type="checkbox" value="${job.id}" data-payment-job ${checked ? "checked" : ""}>
            <span>
              <strong>${client.name} - ${job.date}</strong>
              <small>${job.start}-${job.actualEnd || job.end || "por definir"} - ${job.serviceType} - ${minutesLabel(billableMinutes(job))}</small>
            </span>
            <b>${money(cost)}</b>
          </label>
        `;
      }).join("")}
    </div>
  `;
  $$("[data-payment-job]").forEach((input) => {
    input.addEventListener("change", syncPaymentAmountFromJobs);
  });
  $("#selectAllPaymentJobs")?.addEventListener("click", () => {
    $$("[data-payment-job]").forEach((input) => {
      input.checked = true;
    });
    syncPaymentAmountFromJobs();
  });
  syncPaymentAmountFromJobs();
}

function deletePaymentSignature(receiptId) {
  const receipt = state.receipts.find((item) => item.id === receiptId);
  if (!receipt) return;
  delete receipt.signature;
  delete receipt.receiver;
  receipt.status = "pending_signature";
  save();
  renderPayments();
  toast("Firma eliminada. El pago queda pendiente para firmar nuevamente.");
}

function openDeleteReceiptModal(receiptId) {
  const receipt = state.receipts.find((item) => item.id === receiptId);
  if (!receipt) return;
  pendingDeleteReceiptId = receiptId;
  $("#deleteReceiptSummary").innerHTML = `
    <strong>${receipt.cleaner} - ${money(receipt.amount)}</strong>
    <span>${receipt.period || "Periodo no definido"} - ${receipt.method}</span>
    <span>${receipt.jobIds?.length ? `${receipt.jobIds.length} trabajo${receipt.jobIds.length === 1 ? "" : "s"} asociado${receipt.jobIds.length === 1 ? "" : "s"}` : "Pago manual sin trabajos asociados"}</span>
  `;
  $("#deleteReceiptModal").classList.remove("hidden");
}

function closeDeleteReceiptModal() {
  pendingDeleteReceiptId = null;
  $("#deleteReceiptModal").classList.add("hidden");
}

function deletePendingReceipt() {
  const receiptId = pendingDeleteReceiptId;
  const receipt = state.receipts.find((item) => item.id === receiptId);
  if (!receipt) {
    closeDeleteReceiptModal();
    return;
  }
  state.receipts = state.receipts.filter((item) => item.id !== receiptId);
  resetPaymentForm();
  save();
  renderAll();
  closeDeleteReceiptModal();
  toast("Comprobante eliminado. Los trabajos asociados vuelven a estar disponibles.");
}

function resetPaymentForm() {
  $("#paymentForm").reset();
  $("#paymentId").value = "";
  syncPaymentCleanerSelect();
  $("#paymentPeriod").value = currentPeriodLabel();
  $("#paymentAmount").value = 0;
  renderPaymentJobPicker();
  $("#savePaymentButton").textContent = "Registrar pago externo";
  $("#cancelPaymentEdit").classList.add("hidden");
}

function startPaymentEdit(receiptId) {
  const receipt = state.receipts.find((item) => item.id === receiptId);
  if (!receipt) return;
  const form = $("#paymentForm");
  syncPaymentCleanerSelect(receipt.cleaner || "");
  form.elements.id.value = receipt.id;
  form.elements.cleaner.value = receipt.cleaner || "";
  form.elements.amount.value = receipt.amount || "";
  form.elements.method.value = receipt.method || "Efectivo";
  form.elements.period.value = receipt.period || "";
  renderPaymentJobPicker(receipt.jobIds || []);
  $("#savePaymentButton").textContent = "Actualizar pago";
  $("#cancelPaymentEdit").classList.remove("hidden");
  toast("Editando pago registrado.");
}

function openSignatureModal(receiptId) {
  signingReceiptId = receiptId;
  signingJobId = null;
  const receipt = state.receipts.find((item) => item.id === receiptId);
  const isCleanerPortal = !$("#cleanerPortalPage")?.classList.contains("hidden");
  $("#signatureTitle").textContent = "Firma de pago recibido";
  $("#signatureModal .muted").textContent = isCleanerPortal
    ? "Firma con dedo o mouse para confirmar el pago generado por administracion y solicitar que se realice el pago."
    : "El cleaner firma con dedo o mouse para confirmar que recibio el pago externo.";
  $("#signatureReceiver").value = receipt?.receiver || receipt?.cleaner || "";
  $("#signatureModal").classList.remove("hidden");
  prepareSignaturePad();
}

function openJobSignatureModal(jobId) {
  signingJobId = jobId;
  signingReceiptId = null;
  const job = state.jobs.find((item) => item.id === jobId);
  const client = job ? clientFor(job) : null;
  $("#signatureTitle").textContent = "Firma de salida del servicio";
  $("#signatureModal .muted").textContent = "La persona en sitio firma con dedo o mouse para confirmar que el cleaner termino.";
  $("#signatureReceiver").value = client?.name || "";
  $("#signatureModal").classList.remove("hidden");
  prepareSignaturePad();
}

function closeSignatureModal() {
  $("#signatureModal").classList.add("hidden");
  signingReceiptId = null;
  signingJobId = null;
}

function prepareSignaturePad() {
  const canvas = $("#signatureCanvas");
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.lineWidth = 4;
  context.lineCap = "round";
  context.strokeStyle = "#14201d";
  signaturePad = { drawing: false, context };
}

function signaturePoint(event) {
  const canvas = $("#signatureCanvas");
  const rect = canvas.getBoundingClientRect();
  const source = event.touches ? event.touches[0] : event;
  return {
    x: ((source.clientX - rect.left) / rect.width) * canvas.width,
    y: ((source.clientY - rect.top) / rect.height) * canvas.height
  };
}

function startSignature(event) {
  event.preventDefault();
  const point = signaturePoint(event);
  signaturePad.drawing = true;
  signaturePad.context.beginPath();
  signaturePad.context.moveTo(point.x, point.y);
}

function drawSignature(event) {
  if (!signaturePad?.drawing) return;
  event.preventDefault();
  const point = signaturePoint(event);
  signaturePad.context.lineTo(point.x, point.y);
  signaturePad.context.stroke();
}

function endSignature() {
  if (signaturePad) signaturePad.drawing = false;
}

function closeMobileMenu() {
  const shell = $("#appShell");
  const toggle = $("#mobileMenuToggle");
  if (!shell || !toggle) return;
  shell.classList.remove("mobile-menu-open");
  toggle.setAttribute("aria-expanded", "false");
}

function toggleMobileMenu() {
  const shell = $("#appShell");
  const toggle = $("#mobileMenuToggle");
  if (!shell || !toggle) return;
  const isOpen = shell.classList.toggle("mobile-menu-open");
  toggle.setAttribute("aria-expanded", String(isOpen));
}

function setView(name) {
  $$(".view").forEach((view) => view.classList.remove("active"));
  $(`#${name}View`).classList.add("active");
  $$(".sidebar nav button").forEach((button) => button.classList.toggle("active", button.dataset.view === name));
  
  // Sync mobile bottom nav items
  $$(".mobile-bottom-nav .nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.mobileView === name);
  });

  $("#pageTitle").textContent = viewTitle(name);
  closeMobileMenu();
}

function setupEvents() {
  applyStaticLanguage();
  $$("[data-language]").forEach((button) => {
    button.addEventListener("click", () => setLanguage(button.dataset.language));
  });
  setAuthAction(selectedAuthAction);
  syncPlanSelection();
  applyStripePaymentReturnState();
  $$("[data-auth-action]").forEach((button) => {
    button.addEventListener("click", () => setAuthAction(button.dataset.authAction));
  });
  $$("[data-auth-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.authMode === selectedAuthMode);
  });
  $$("[data-auth-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      selectAuthMode(button.dataset.authMode);
    });
  });
  $("#signupPlan").addEventListener("change", (event) => {
    selectedPlan = event.target.value;
    syncPlanSelection();
  });
  $("#sendVerification").addEventListener("click", () => {
    verificationSent = true;
    toast("Codigo enviado al correo. En esta version usa 123456 para continuar.");
  });
  $("#stripePayButton").addEventListener("click", () => {
    if (selectedPlan === "free") {
      enterApp("independent");
      toast("Plan gratis activado. Bienvenido a JobVisto.");
      return;
    }
    const link = stripePaymentLinks[selectedPlan] || stripePaymentLinks.independent;
    location.href = link;
  });
  $("#authForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    if (selectedAuthAction === "login") {
      toast("Iniciando sesion...");
      try {
        const { data: authData, error } = await supabaseClient.auth.signInWithPassword({
          email: data.email,
          password: data.password
        });
        if (error) {
          toast("Error: " + error.message);
          return;
        }
        state.user = authData.user;
        await loadStateFromSupabase();
        enterApp(selectedAuthMode);
        toast("Bienvenido a JobVisto.");
      } catch (err) {
        console.error("Error during login:", err);
        toast("Error de inicio de sesion: " + err.message);
      }
      return;
    }
    
    if (selectedPlan !== "free" && !stripePaymentReturn) {
      toast("Redirigiendo a Stripe para realizar el pago...");
      const link = stripePaymentLinks[selectedPlan] || stripePaymentLinks.independent;
      setTimeout(() => {
        location.href = `${link}?prefilled_email=${encodeURIComponent(data.email)}`;
      }, 1000);
      return;
    }

    toast("Registrando cuenta...");
    let finalPlan = selectedPlan;
    
    // Check for Stripe payment matching the email before signing up
    let stripePayment = null;
    try {
      const { data: payment } = await supabaseClient
        .from("stripe_payments")
        .select("*")
        .eq("email", data.email.toLowerCase())
        .maybeSingle();
      if (payment) {
        stripePayment = payment;
        finalPlan = payment.plan_id === "solo" ? "independent" : (payment.plan_id === "starter" ? "company" : payment.plan_id);
      }
    } catch (err) {
      console.error("Error looking up Stripe payment:", err);
    }

    const dbPlanId = finalPlan === "independent" ? "solo" : (finalPlan === "company" ? "starter" : finalPlan);

    const { data: authData, error } = await supabaseClient.auth.signUp({
      email: data.email,
      password: data.password,
      options: {
        data: {
          full_name: data.fullName || data.email.split('@')[0],
          phone: data.phone || "",
          company_name: data.companyName || `${data.fullName || 'Mi Empresa'}`,
          mode: finalPlan === "independent" ? "independent" : "company",
          plan_id: dbPlanId,
          country: state.country || "IL",
          language: state.language || "es"
        }
      }
    });

    if (error) {
      toast("Error: " + error.message);
      return;
    }

    const user = authData.user;
    if (user) {
      state.user = user;
      
      // If Stripe payment exists, associate it with the subscription in the database (will require orgId)
      if (stripePayment && authData.session) {
        // Wait briefly for trigger execution to complete organization setup
        await new Promise(resolve => setTimeout(resolve, 800));
        await loadStateFromSupabase();
        if (state.orgId) {
          await supabaseClient.from("subscriptions").insert({
            organization_id: state.orgId,
            plan_id: dbPlanId,
            status: "active",
            provider: "stripe",
            provider_customer_id: stripePayment.customer_id,
            provider_subscription_id: stripePayment.subscription_id,
            started_at: new Date().toISOString()
          });
        }
      }

      if (authData.session) {
        await loadStateFromSupabase();
        enterApp(finalPlan === "independent" ? "independent" : "company");
        toast("Cuenta creada y activada.");
      } else {
        toast("Registro exitoso. Por favor verifica tu correo para activar tu cuenta.");
      }
    }
  });
  $("#googleLogin").addEventListener("click", async () => {
    if (supabaseClient) {
      toast("Conectando con Google...");
      const { data, error } = await supabaseClient.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin + window.location.pathname
        }
      });
      if (error) toast("Error: " + error.message);
    } else {
      toast("Supabase no esta configurado.");
    }
  });
  $(".google.microsoft")?.addEventListener("click", async () => {
    if (supabaseClient) {
      toast("Conectando con Microsoft...");
      const { data, error } = await supabaseClient.auth.signInWithOAuth({
        provider: 'azure',
        options: {
          redirectTo: window.location.origin + window.location.pathname
        }
      });
      if (error) toast("Error: " + error.message);
    } else {
      toast("Supabase no esta configurado.");
    }
  });
  const forgotBtn = $(".forgot-link");
  if (forgotBtn) {
    forgotBtn.addEventListener("click", async () => {
      const email = $("#authForm")?.elements.email.value?.trim();
      if (!email) {
        toast("Por favor, ingresa tu correo electronico primero.");
        return;
      }
      if (supabaseClient) {
        toast("Enviando enlace de recuperacion...");
        const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin + window.location.pathname
        });
        if (error) {
          toast("Error: " + error.message);
        } else {
          toast("Enlace de recuperacion enviado. Revisa tu correo.");
        }
      } else {
        toast("Supabase no esta configurado.");
      }
    });
  }
  $("#mobileMenuToggle").addEventListener("click", toggleMobileMenu);
  $("#dashboardMobileMenu")?.addEventListener("click", toggleMobileMenu);
  $("#globalMobileMenu")?.addEventListener("click", toggleMobileMenu);
  $("#mobileMenuBackdrop").addEventListener("click", closeMobileMenu);
  $$(".sidebar nav button").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
  $$("[data-view-target]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.viewTarget)));
  $$("[data-open-job]").forEach((button) => button.addEventListener("click", () => setView("jobs")));
  $("#logoutButton").addEventListener("click", async () => {
    if (supabaseClient) await supabaseClient.auth.signOut();
    state.user = null;
    state.orgId = null;
    $("#appShell").classList.add("hidden");
    $("#authScreen").classList.remove("hidden");
  });
  $("#clientForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    const country = countryInfo(state.country);
    const payload = {
      id: data.id || crypto.randomUUID(),
      name: data.name,
      phoneLocal: data.phoneLocal,
      phone: data.phoneLocal ? `${country.dial} ${data.phoneLocal}` : "",
      email: data.email,
      address: data.address,
      country: state.country,
      paymentMethod: data.paymentMethod,
      notes: data.notes,
      followUpDate: data.followUpDate || null,
      followUpNote: data.followUpNote || ""
    };
    const index = state.clients.findIndex((client) => client.id === data.id);
    if (index >= 0) state.clients[index] = payload;
    else state.clients.push(payload);
    resetClientForm();
    save();
    renderAll();
    toast(index >= 0 ? "Cliente actualizado." : "Cliente guardado.");
  });
  $("#cancelClientEdit").addEventListener("click", resetClientForm);
  $("#cleanerForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    const index = state.cleaners.findIndex((cleaner) => cleaner.id === data.id);
    const existingCleaner = index >= 0 ? state.cleaners[index] : null;
    const payload = {
      id: data.id || crypto.randomUUID(),
      name: data.name,
      phone: data.phone,
      email: data.email,
      country: data.country || state.country || "IL",
      city: data.city || "Zona principal",
      status: existingCleaner?.status || "Disponible",
      key: data.key || `JV-${data.name.slice(0, 5).toUpperCase().replace(/\s/g, "")}`
    };
    if (index >= 0) state.cleaners[index] = { ...state.cleaners[index], ...payload };
    else state.cleaners.push(payload);
    resetCleanerForm();
    save();
    renderAll();
    toast(index >= 0 ? "Cleaner actualizado." : "Cleaner registrado y listo para recibir trabajos.");
  });
  $("#cancelCleanerEdit").addEventListener("click", resetCleanerForm);
  $("#jobForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    
    // Auto-save address to client if it's missing
    const clientForJob = state.clients.find(c => c.id === data.clientId);
    if (clientForJob && !clientForJob.address && data.jobAddress) {
      clientForJob.address = data.jobAddress.trim();
    }

    const payload = {
      id: data.id || crypto.randomUUID(),
      clientId: data.clientId,
      cleanerId: data.cleanerId,
      date: data.date,
      start: data.start,
      end: data.end,
      actualEnd: data.actualEnd,
      status: data.status || (data.cleanerId ? "Asignado" : "Disponible para tomar"),
      serviceType: data.serviceType,
      rate: Number(data.rate),
      extras: Number(data.extras || 0),
      tasks: (data.tasks || "Cocina, Banos, Pisos").split(",").map((task) => task.trim()).filter(Boolean)
    };
    const index = state.jobs.findIndex((job) => job.id === data.id);
    const previousJob = index >= 0 ? state.jobs[index] : {};
    applyJobStatusControl(payload, previousJob);
    if (index >= 0) {
      state.jobs[index] = { ...state.jobs[index], ...payload, recurrence: data.recurrence || state.jobs[index].recurrence || "" };
    } else {
      state.jobs.push(...addRecurringJobs(payload, data.repeatCount, data.recurrence));
    }
    resetJobForm();
    save();
    renderAll();
    const createdCount = Number(data.repeatCount || 1);
    toast(index >= 0 ? "Trabajo actualizado." : createdCount > 1 ? `${createdCount} fechas creadas y agregadas al calendario.` : "Trabajo creado y agregado al calendario.");
  });
  $("#cancelJobEdit").addEventListener("click", resetJobForm);
  $("#jobServiceType").addEventListener("change", applyServiceRuleToJobForm);
  $("#jobClientSelect").addEventListener("change", updateJobClientAddressHint);
  $("#jobCleanerSelect").addEventListener("change", syncJobStatusWithCleaner);
  $("#checkInButton").addEventListener("click", () => {
    const job = activeJob();
    job.checkedIn = true;
    job.status = "En progreso";
    save();
    renderAll();
    toast("Llegada marcada. GPS guardado y cliente notificado.");
  });
  $("#uploadPhotoButton").addEventListener("click", () => {
    toast("Para agregar evidencia real entra al portal del cleaner y usa Camara o biblioteca.");
  });
  $("#finishButton").addEventListener("click", () => {
    const job = activeJob();
    if (!job.checkedIn) {
      toast("Primero marca llegada para poder terminar el trabajo.");
      return;
    }
    job.checkedOut = true;
    job.cleanerFinished = true;
    job.actualEnd = job.actualEnd || currentTime();
    job.status = "Terminado por cleaner";
    save();
    renderAll();
    toast("Trabajo terminado. Resumen listo para el cliente.");
  });
  $("#signatureButton").addEventListener("click", () => {
    const job = activeJob();
    job.signed = true;
    job.status = "Firmado";
    save();
    renderAll();
    toast("Firma del cliente guardada.");
  });
  $("#unlockClientPortal").addEventListener("click", () => {
    const entered = $("#clientPortalPassword").value.trim();
    const client = clientFromPortalAccess(portalClientId, entered);
    if (!client) {
      toast("Acceso de cliente no encontrado. Usa el link actualizado.");
      return;
    }
  if (!clientPortalKeyMatches(client, entered)) {
    toast("Clave incorrecta.");
    return;
  }
    portalClientId = client.id;
    renderStandaloneClientPortal(true);
  });
  $("#clientPortalLogout").addEventListener("click", () => {
    $("#clientPortalPassword").value = "";
    renderStandaloneClientPortal(false);
    toast("Sesion cerrada. Ingresa la clave para volver al portal.");
  });
  $("#unlockCleanerPortal").addEventListener("click", () => {
    let cleaner = state.cleaners.find((item) => item.id === portalCleanerId);
    const entered = normalizeKey($("#cleanerPortalPassword").value);
    if (entered === normalizeKey(ADMIN_CLEANER_KEY)) {
      portalCleanerAdmin = true;
      portalCleanerId = state.cleaners[0]?.id || null;
      renderStandaloneCleanerPortal(true);
      toast("Acceso maestro activado.");
      return;
    }
    const cleanerByKey = state.cleaners.find((item) => normalizeKey(item.key) === entered);
    if (cleanerByKey) {
      cleaner = cleanerByKey;
      portalCleanerId = cleanerByKey.id;
    }
    if (!cleaner || entered !== normalizeKey(cleaner.key)) {
      toast("Clave incorrecta.");
      return;
    }
    portalCleanerAdmin = false;
    clearCleanerHistoryAdminPermission();
    renderStandaloneCleanerPortal(true);
  });
  $("#unlockCleanerHistoryAdmin").addEventListener("click", () => {
    const entered = normalizeKey($("#cleanerHistoryAdminKey").value);
    if (entered !== normalizeKey(ADMIN_CLEANER_KEY)) {
      toast("Clave admin incorrecta.");
      return;
    }
    activateCleanerHistoryAdminPermission();
    $("#cleanerHistoryAdminKey").value = "";
    renderStandaloneCleanerPortal(true);
    setCleanerTab("jobs");
    toast("Permiso admin activado por 1 hora para fotos historicas.");
  });
  $("#cleanerPortalLogout").addEventListener("click", () => {
    portalCleanerAdmin = false;
    clearCleanerHistoryAdminPermission();
    $("#cleanerPortalPassword").value = "";
    renderStandaloneCleanerPortal(false);
    toast("Sesion cerrada. Ingresa la clave para volver al portal.");
  });
  $("#closePhotoModal").addEventListener("click", () => $("#photoModal").classList.add("hidden"));
  $("#closeDeleteJobModal").addEventListener("click", closeDeleteJobModal);
  $("#cancelDeleteJob").addEventListener("click", closeDeleteJobModal);
  $("#confirmDeleteJobButton").addEventListener("click", deletePendingJob);
  $("#deleteJobModal").addEventListener("click", (event) => {
    if (event.target.id === "deleteJobModal") closeDeleteJobModal();
  });
  $("#closeArchiveCleanerModal").addEventListener("click", closeArchiveCleanerModal);
  $("#cancelArchiveCleaner").addEventListener("click", closeArchiveCleanerModal);
  $("#confirmArchiveCleanerButton").addEventListener("click", archivePendingCleaner);
  $("#archiveCleanerModal").addEventListener("click", (event) => {
    if (event.target.id === "archiveCleanerModal") closeArchiveCleanerModal();
  });
  $("#closeArchiveClientModal").addEventListener("click", closeArchiveClientModal);
  $("#cancelArchiveClient").addEventListener("click", closeArchiveClientModal);
  $("#confirmArchiveClientButton").addEventListener("click", archivePendingClient);
  $("#archiveClientModal").addEventListener("click", (event) => {
    if (event.target.id === "archiveClientModal") closeArchiveClientModal();
  });
  $("#closeDeleteReceiptModal").addEventListener("click", closeDeleteReceiptModal);
  $("#cancelDeleteReceipt").addEventListener("click", closeDeleteReceiptModal);
  $("#confirmDeleteReceiptButton").addEventListener("click", deletePendingReceipt);
  $("#deleteReceiptModal").addEventListener("click", (event) => {
    if (event.target.id === "deleteReceiptModal") closeDeleteReceiptModal();
  });  $("#clientPortalConfirmButton").addEventListener("click", async () => {
    const client = state.clients.find((item) => item.id === portalClientId);
    const job = currentClientJob(client?.id);
    if (!job) return;
    if (!clientCanConfirmJob(job)) {
      toast("El cliente solo puede confirmar cuando el servicio tenga entrada y salida reales.");
      return;
    }
    job.clientConfirmed = true;
    job.clientSignature = true;
    job.status = "Confirmado por cliente";
    save();

    // Direct Supabase Write for portal-based confirm
    if (supabaseClient) {
      try {
        await supabaseClient.from("jobs").update({
          status: "client_confirmed"
        }).eq("id", job.id);

        await supabaseClient.from("client_signatures").delete().eq("job_id", job.id).eq("signed_from", "private_link");
        await supabaseClient.from("client_signatures").insert({
          organization_id: job.organizationId || state.orgId,
          job_id: job.id,
          signer_name: "Cliente",
          signature_data: "Confirmado via portal seguro",
          signed_from: "private_link"
        });
      } catch (err) {
        console.error("Error saving client confirmation in portal mode:", err);
      }
    }

    renderStandaloneClientPortal(true);
    toast("Cliente confirmo el servicio.");
  });

  $("#paymentForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    if (!data.cleaner) {
      toast("Primero registra o selecciona un cleaner activo.");
      return;
    }
    const jobIds = selectedPaymentJobIds();
    const selectedTotal = jobIds.reduce((sum, jobId) => {
      const job = state.jobs.find((item) => item.id === jobId);
      return sum + (job ? cleanerCostForJob(job) : 0);
    }, 0);
    const payload = {
      id: data.id || crypto.randomUUID(),
      cleaner: data.cleaner,
      amount: jobIds.length ? Number(selectedTotal.toFixed(2)) : Number(data.amount || 0),
      method: data.method,
      period: data.period || currentPeriodLabel(),
      jobIds,
      status: "pending_signature",
      date: new Date().toLocaleString("es")
    };
    const index = state.receipts.findIndex((receipt) => receipt.id === data.id);
    if (index >= 0) state.receipts[index] = { ...state.receipts[index], ...payload };
    else state.receipts.unshift(payload);
    resetPaymentForm();
    save();
    renderAll();
    toast(index >= 0 ? "Pago actualizado. Firma pendiente." : "Pago registrado. Falta firma del cleaner.");
  });
  $("#paymentCleanerSelect").addEventListener("change", () => {
    $("#paymentId").value = "";
    $("#paymentAmount").value = 0;
    renderPaymentJobPicker();
  });
  
  // CLIENT PAYMENTS EVENTS
  $("#clientPaymentSelect")?.addEventListener("change", () => {
    renderClientPaymentJobPicker();
  });
  
  document.addEventListener("change", (e) => {
    if (e.target.matches(".client-payment-job-checkbox")) {
      updateClientPaymentTotal();
    }
  });
  
  document.addEventListener("click", (e) => {
    if (e.target.matches("[data-finance-tab]")) {
      const tabName = e.target.dataset.financeTab;
      document.querySelectorAll("[data-finance-tab]").forEach(btn => btn.classList.remove("active"));
      e.target.classList.add("active");
      document.querySelectorAll(".finance-tab-content").forEach(tab => tab.classList.add("hidden"));
      const tabContent = document.getElementById(tabName === "clients" ? "financeClientsTab" : "financeCleanersTab");
      if (tabContent) tabContent.classList.remove("hidden");
    }
  });

  $("#clientPaymentForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    const formEl = event.currentTarget;
    const jobIds = Array.from(formEl.querySelectorAll("input[name='jobIds']:checked")).map(el => el.value);
    
    if (!jobIds.length) {
      toast("Selecciona al menos un trabajo para cobrar.");
      return;
    }
    
    const amountReceived = parseFloat(data.amountReceived) || 0;
    const discount = parseFloat(data.discount) || 0;
    let remainingToCover = amountReceived + discount;
    
    if (remainingToCover <= 0) {
      toast("El monto cobrado debe ser mayor a cero.");
      return;
    }
    
    jobIds.forEach(id => {
      const job = state.jobs.find(j => j.id === id);
      if (job) {
        const jobCost = parseFloat(job.amount) || 0;
        const alreadyPaid = parseFloat(job.clientPaidAmount) || 0;
        const owe = jobCost - alreadyPaid;
        
        if (remainingToCover >= owe) {
          job.clientPaidAmount = jobCost;
          job.clientPaymentStatus = "paid";
          job.clientPaidDate = new Date().toISOString().split('T')[0];
          job.clientPaymentMethod = data.method;
          remainingToCover -= owe;
        } else if (remainingToCover > 0) {
          job.clientPaidAmount = alreadyPaid + remainingToCover;
          job.clientPaymentStatus = "partial";
          job.clientPaidDate = new Date().toISOString().split('T')[0];
          job.clientPaymentMethod = data.method;
          remainingToCover = 0;
        }
      }
    });

    save();
    renderAll();
    toast("Cobro registrado exitosamente.");
    formEl.reset();
  });

  $("#cancelPaymentEdit").addEventListener("click", resetPaymentForm);
  $("#dashboardSearch")?.addEventListener("input", renderDashboardSearch);
  $("#dashboardSearch")?.addEventListener("focus", renderDashboardSearch);
  document.addEventListener("click", (event) => {
    const searchBox = $(".search-box");
    if (searchBox && !searchBox.contains(event.target)) {
      $("#dashboardSearchResults")?.classList.add("hidden");
    }
  });
  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      $("#dashboardSearch")?.focus();
    }
  });
  document.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-clear-reminder]");
    if (btn) {
      const clientId = btn.dataset.clearReminder;
      const client = state.clients.find(c => c.id === clientId);
      if (client) {
        client.followUpDate = null;
        client.followUpNote = "";
        save();
        renderAll();
        toast("Recordatorio completado.");
      }
    }
  });

  $("#profileSettingsForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    state.companyProfile = {
      ...state.companyProfile,
      businessName: data.businessName?.trim() || "JobVisto Cleaning",
      ownerName: data.ownerName?.trim() || "Usuario Demo",
      greetingName: data.greetingName?.trim() || firstName(data.ownerName) || "Miguel",
      phone: data.phone?.trim() || "",
      email: data.email?.trim() || "",
      address: data.address?.trim() || "",
    };
    if (data.vatRate !== undefined) state.vatRate = Number(data.vatRate || 0);
    if (data.currencySymbol) state.currencySymbol = data.currencySymbol;
    save();
    renderAll();
    toast("Perfil guardado.");
  });
  $("#profilePhotoInput")?.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast("Selecciona una imagen valida.");
      return;
    }
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      state.companyProfile = { ...state.companyProfile, photo: reader.result };
      save();
      renderMode();
      renderSettings();
      toast("Foto actualizada.");
    });
    reader.readAsDataURL(file);
  });
  $("#serviceRulesForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    state.serviceRules = Object.fromEntries(Object.entries(data).map(([name, rate]) => [name, Number(rate || 0)]));
    normalizeCostRules();
    save();
    renderAll();
    toast("Reglas de precios guardadas.");
  });
  $("#clientPriceRulesForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    const client = state.clients.find((item) => item.id === data.clientId);
    if (!client) {
      toast("Primero selecciona un cliente activo.");
      return;
    }
    const serviceRates = readServiceRates(form, "clientService__", 0);
    const hasRate = Object.values(serviceRates).some((rate) => Number(rate) > 0);
    if (!hasRate) {
      toast("Pon al menos un precio especial para ese cliente.");
      return;
    }
    const existingIndex = (state.clientPriceRules || []).findIndex((rule) => rule.id === data.clientRuleId || rule.clientId === data.clientId);
    const rule = {
      id: data.clientRuleId || state.clientPriceRules?.[existingIndex]?.id || safeId(),
      clientId: client.id,
      clientName: client.name,
      serviceRates
    };
    state.clientPriceRules = [...(state.clientPriceRules || [])];
    if (existingIndex >= 0) state.clientPriceRules[existingIndex] = rule;
    else state.clientPriceRules.push(rule);
    save();
    resetClientPriceRuleForm();
    renderAll();
    toast("Regla especial del cliente guardada.");
  });
  $("#costRulesForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    const form = event.currentTarget;
    const cleaner = state.cleaners.find((item) => item.id === data.specialCleanerId);
    const rate = Number(data.specialCleanerRate || 0);
    const generalServiceRates = readServiceRates(form, "generalService__", Number(data.generalCleanerRate || 0));
    const specialServiceRates = readServiceRates(form, "specialService__", rate);
    const mode = data.specialMode === "match_client" ? "match_client" : data.specialMode === "add" ? "add" : "replace";
    const existingIndex = state.costRules.specialRules.findIndex((rule) => rule.id === data.ruleId || rule.cleanerId === data.specialCleanerId);
    const hasSpecialValues = mode === "match_client" || rate > 0 || Object.values(specialServiceRates).some((value) => value > 0);
    const specialRule = cleaner && hasSpecialValues ? {
      id: data.ruleId || state.costRules.specialRules[existingIndex]?.id || safeId(),
      cleanerId: cleaner.id,
      cleanerName: cleaner.name,
      rate,
      serviceRates: specialServiceRates,
      mode
    } : null;
    state.costRules = {
      generalCleanerRate: Number(data.generalCleanerRate || 0),
      generalServiceRates,
      specialCleaner: specialRule?.cleanerName || state.costRules.specialCleaner || "Sin especial",
      specialCleanerRate: specialRule?.rate || state.costRules.specialCleanerRate || 0,
      specialRules: [...state.costRules.specialRules]
    };
    if (specialRule) {
      if (existingIndex >= 0) state.costRules.specialRules[existingIndex] = specialRule;
      else state.costRules.specialRules.push(specialRule);
    }
    save();
    resetCostRuleForm();
    renderAll();
    toast("Reglas de costos guardadas.");
  });
  $("#prevMonth").addEventListener("click", () => {
    calendarCursor.setMonth(calendarCursor.getMonth() - 1);
    expandedJobId = null;
    renderCalendar();
  });
  $("#nextMonth").addEventListener("click", () => {
    calendarCursor.setMonth(calendarCursor.getMonth() + 1);
    expandedJobId = null;
    renderCalendar();
  });
  $("#todayMonth").addEventListener("click", () => {
    calendarCursor = new Date();
    expandedJobId = null;
    renderCalendar();
  });
  $("#closeSignatureModal").addEventListener("click", closeSignatureModal);
  $("#clearSignature").addEventListener("click", prepareSignaturePad);
  $("#saveSignature").addEventListener("click", async () => {
    if (signingJobId) {
      const job = state.jobs.find((item) => item.id === signingJobId);
      if (!job) return;
      job.signed = true;
      job.siteSignerName = $("#signatureReceiver").value;
      job.siteSignature = $("#signatureCanvas").toDataURL("image/png");
      save();

      if (supabaseClient) {
        try {
          await supabaseClient.from("client_signatures").delete().eq("job_id", job.id).eq("signed_from", "cleaner_device");
          await supabaseClient.from("client_signatures").insert({
            organization_id: job.organizationId || state.orgId,
            job_id: job.id,
            signer_name: job.siteSignerName || "Persona en sitio",
            signature_data: job.siteSignature,
            signed_from: "cleaner_device"
          });
        } catch (err) {
          console.error("Error saving site signature in portal mode:", err);
        }
      }

      renderStandaloneCleanerPortal(true);
      closeSignatureModal();
      toast("Firma de salida guardada.");
      return;
    }
    const receipt = state.receipts.find((item) => item.id === signingReceiptId);
    if (!receipt) return;
    receipt.receiver = $("#signatureReceiver").value;
    receipt.signature = $("#signatureCanvas").toDataURL("image/png");
    receipt.status = "signed";
    save();

    if (supabaseClient) {
      try {
        const cleanerId = receipt.cleanerId || state.cleaners.find(c => c.name === receipt.cleaner)?.id;
        const [start, end] = receipt.period ? receipt.period.split(" - ") : [today(), today()];
        await supabaseClient.from("payment_receipts").upsert({
          id: receipt.id,
          organization_id: receipt.organizationId || state.orgId,
          cleaner_id: cleanerId || null,
          period_start: start,
          period_end: end,
          amount: receipt.amount,
          payment_method: receipt.method === "Efectivo" ? "cash" : "transfer",
          receiver_signature_data: receipt.signature,
          status: "signed"
        });
      } catch (err) {
        console.error("Error saving receipt signature in portal mode:", err);
      }
    }

    if (!$("#cleanerPortalPage")?.classList.contains("hidden")) {
      renderStandaloneCleanerPortal(true);
    } else {
      renderPayments();
    }
    closeSignatureModal();
    toast("Firma guardada. Pago marcado como recibido.");
  });
  const canvas = $("#signatureCanvas");
  canvas.addEventListener("mousedown", startSignature);
  canvas.addEventListener("mousemove", drawSignature);
  window.addEventListener("mouseup", endSignature);
  canvas.addEventListener("touchstart", startSignature, { passive: false });
  canvas.addEventListener("touchmove", drawSignature, { passive: false });
  window.addEventListener("touchend", endSignature);

  // Mobile bottom navigation event listeners
  $$(".mobile-bottom-nav [data-mobile-view]").forEach((button) => {
    button.addEventListener("click", () => {
      setView(button.dataset.mobileView);
    });
  });

  $("#mobileFabButton").addEventListener("click", () => {
    resetJobForm();
    setView("jobs");
  });

  $("#mobileMoreButton").addEventListener("click", () => {
    $("#mobileMoreModal").classList.remove("hidden");
  });

  $("#closeMobileMoreModal").addEventListener("click", () => {
    $("#mobileMoreModal").classList.add("hidden");
  });

  $("#mobileMoreModal").addEventListener("click", (event) => {
    if (event.target.id === "mobileMoreModal") {
      $("#mobileMoreModal").classList.add("hidden");
    }
  });

  $$(".mobile-more-grid [data-more-view]").forEach((button) => {
    button.addEventListener("click", () => {
      setView(button.dataset.moreView);
      $("#mobileMoreModal").classList.add("hidden");
    });
  });
}

populateCountrySelect();
setupEvents();

const _pathname = window.location.pathname.toLowerCase();
if (_pathname.includes("portal-clientes")) {
  enterClientPortalFromUrl();
} else if (_pathname.includes("portal-cleaners")) {
  enterCleanerPortalFromUrl();
} else {
  enterClientPortalFromUrl(); // For backwards compatibility with old /app links
}

if (supabaseClient) {
  supabaseClient.auth.onAuthStateChange(async (event, session) => {
    if (event === "PASSWORD_RECOVERY") {
      const newPassword = prompt("Ingresa tu nueva contraseña / Enter your new password:");
      if (newPassword) {
        toast("Actualizando contraseña...");
        const { error } = await supabaseClient.auth.updateUser({ password: newPassword });
        if (error) {
          toast("Error: " + error.message);
        } else {
          toast("Contraseña actualizada con éxito.");
        }
      }
    }
    if (session) {
      // Disable login button to prevent overlapping submissions
      const loginBtn = $("#authForm button[type='submit']");
      if (loginBtn) {
        loginBtn.disabled = true;
        loginBtn.textContent = event === "INITIAL_SESSION" ? "Cargando sesión..." : "Iniciando...";
      }

      const user = session.user;
      state.user = user;

      try {
        await loadStateFromSupabase(user);

        // If they don't have an organization, they signed up via OAuth (Google/Microsoft) or email verification completed but profile/org weren't created due to RLS
        if (!state.orgId) {
          // Create profile if not exists
          const { data: profile, error: profileGetError } = await supabaseClient.from('profiles').select('*').eq('id', user.id).maybeSingle();
          if (profileGetError) throw profileGetError;
          
          if (!profile) {
            const { error: profileInsertError } = await supabaseClient.from('profiles').insert({
              id: user.id,
              full_name: user.user_metadata?.full_name || user.email.split('@')[0],
              email: user.email,
              phone: user.phone || "",
              preferred_language: state.language || "es"
            });
            if (profileInsertError) throw profileInsertError;
          }

          // Create organization with a valid plan ID ('solo' for independent/free, 'starter' for company)
          const dbPlanId = (state.mode === 'independent') ? 'solo' : 'starter';
          const { data: org, error: orgError } = await supabaseClient.from('organizations').insert({
            name: `${user.user_metadata?.full_name || user.email.split('@')[0]}'s Company`,
            type: state.mode || 'independent',
            owner_user_id: user.id,
            country: state.country || 'IL',
            default_language: state.language || 'es',
            plan_id: dbPlanId
          }).select().single();
          
          if (orgError) throw orgError;
          
          if (org) {
            state.orgId = org.id;
          }
        }

        enterApp(state.mode);
      } catch (err) {
        console.error("Error during session load or profile setup:", err);
        toast("Error de sesión. Restableciendo... / Session error. Resetting...");
        try {
          if (supabaseClient) await supabaseClient.auth.signOut();
        } catch (_) {}
        state.user = null;
        state.orgId = null;
        state.clients = [];
        state.cleaners = [];
        state.jobs = [];
        state.receipts = [];
        localStorage.clear();
        const __urlParams = new URLSearchParams(location.search);
        const __portalType = __urlParams.get("portal");
        const __path = window.location.pathname.toLowerCase();
        if (__portalType === "client" || __portalType === "cleaner" || __path.includes("portal-clientes") || __path.includes("portal-cleaners")) return;

        $("#appShell").classList.add("hidden");
        $("#authScreen").classList.remove("hidden");
        if (loginBtn) {
          loginBtn.disabled = false;
          loginBtn.textContent = selectedAuthAction === "login" ? "Log in" : "Register";
        }
      }
    } else {
      // Re-enable form buttons if they are signed out
      const loginBtn = $("#authForm button[type='submit']");
      if (loginBtn) {
        loginBtn.disabled = false;
        loginBtn.textContent = selectedAuthAction === "login" ? "Log in" : "Register";
      }

      // ✅ Portal pages (cleaner/client) authenticate via URL params, NOT via Supabase session.
      // Use synchronous URL check — DOM state can't be relied on due to async Supabase loading.
      const _urlParams = new URLSearchParams(location.search);
      const _portalType = _urlParams.get("portal");
      const _path = window.location.pathname.toLowerCase();
      if (_portalType === "client" || _portalType === "cleaner" || _path.includes("portal-clientes") || _path.includes("portal-cleaners")) return;

      // Clear current state to prevent stale data display
      state.user = null;
      state.orgId = null;
      state.clients = [];
      state.cleaners = [];
      state.jobs = [];
      state.receipts = [];

      $("#appShell").classList.add("hidden");
      $("#authScreen").classList.remove("hidden");
    }
  });
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

// Session Idle Timeout Logic
let idleTime = 0;
let idleInterval;
let countdownInterval;
let countdownValue = 60;
const MAX_IDLE_MINUTES = 30; // 30 minutes of inactivity allowed

function resetIdleTime() {
  idleTime = 0;
  if ($("#idleTimeoutModal") && $("#idleTimeoutModal").open) {
    $("#idleTimeoutModal").close();
    clearInterval(countdownInterval);
  }
}

function checkIdleTime() {
  if (!state.user) return; // Only track logged in users
  idleTime++;
  
  if (idleTime >= MAX_IDLE_MINUTES) {
    showIdleModal();
  }
}

function showIdleModal() {
  const modal = $("#idleTimeoutModal");
  if (!modal || modal.open) return;
  
  modal.showModal();
  countdownValue = 60;
  $("#idleCountdown").textContent = countdownValue;
  $("#idleCountdownEn").textContent = countdownValue;
  
  clearInterval(countdownInterval);
  countdownInterval = setInterval(() => {
    countdownValue--;
    $("#idleCountdown").textContent = countdownValue;
    $("#idleCountdownEn").textContent = countdownValue;
    
    if (countdownValue <= 0) {
      clearInterval(countdownInterval);
      forceLogOut();
    }
  }, 1000);
}

async function forceLogOut() {
  if (supabaseClient) {
    try {
      await supabaseClient.auth.signOut();
    } catch (e) {}
  }
  localStorage.clear();
  window.location.reload();
}

// Attach idle listeners
["mousemove", "keydown", "touchstart", "scroll"].forEach(event => {
  window.addEventListener(event, resetIdleTime, { passive: true });
});

// Check every minute
idleInterval = setInterval(checkIdleTime, 60000);

if ($("#stayLoggedInButton")) {
  $("#stayLoggedInButton").addEventListener("click", resetIdleTime);
}
if ($("#logOutNowButton")) {
  $("#logOutNowButton").addEventListener("click", forceLogOut);
}
