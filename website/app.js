const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function mergeById(primary = [], backup = []) {
  const merged = new Map();
  [...(primary || []), ...(backup || [])].forEach((item) => {
    if (!item) return;
    const id = item.id || crypto.randomUUID();
    const existing = merged.get(id);
    if (!existing) {
      merged.set(id, { ...item, id });
      return;
    }
    const mergedItem = { ...existing, ...item, id };
    if (existing.status === "signed" && item.status !== "signed") {
      mergedItem.status = "signed";
      mergedItem.signature = existing.signature || item.signature;
      mergedItem.receiver = existing.receiver || item.receiver;
    }
    if (existing.signature && !item.signature) {
      mergedItem.signature = existing.signature;
      mergedItem.receiver = existing.receiver || item.receiver;
    }
    merged.set(id, mergedItem);
  });
  return [...merged.values()].sort((a, b) =>
    String(b.createdAt || b.date || "").localeCompare(String(a.createdAt || a.date || ""))
  );
}

const JOBVISTO_SUPABASE_URL = window.JOBVISTO_CONFIG?.supabaseUrl || "https://aofsfxwfvagzgnhiyntb.supabase.co";
const JOBVISTO_SUPABASE_ANON_KEY = window.JOBVISTO_CONFIG?.supabaseAnonKey || "sb_publishable_5eepp5D9Z1NZ88GbOCkHAA_FR1b6dyZ";

const supabaseClient = window.supabase ? window.supabase.createClient(
  JOBVISTO_SUPABASE_URL,
  JOBVISTO_SUPABASE_ANON_KEY
) : {
  auth: {
    getUser: async () => ({ data: { user: null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } })
  },
  rpc: async (name, body) => {
    const response = await fetch(`${JOBVISTO_SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: { apikey: JOBVISTO_SUPABASE_ANON_KEY, authorization: `Bearer ${JOBVISTO_SUPABASE_ANON_KEY}`, "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    return { data: response.ok ? await response.json() : null, error: response.ok ? null : await response.json().catch(() => ({ message: response.statusText })) };
  },
  from: (table) => ({
    update: (body) => ({
      eq: async (column, value) => {
        const response = await fetch(`${JOBVISTO_SUPABASE_URL}/rest/v1/${table}?${encodeURIComponent(column)}=eq.${encodeURIComponent(value)}`, {
          method: "PATCH",
          headers: { apikey: JOBVISTO_SUPABASE_ANON_KEY, authorization: `Bearer ${JOBVISTO_SUPABASE_ANON_KEY}`, "content-type": "application/json", prefer: "return=minimal" },
          body: JSON.stringify(body)
        });
        return { error: response.ok ? null : await response.json().catch(() => ({ message: response.statusText })) };
      }
    })
  })
};

async function supabaseData(query, label = "Supabase") {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

const DONE_DB_JOB_STATUSES = ["cleaner_finished", "client_confirmed", "signed", "admin_closed"];

function appStatusFromDbStatus(status) {
  const map = {
    draft: "Asignado",
    scheduled: "Asignado",
    assigned: "Asignado",
    open: "Disponible para tomar",
    in_site: "En progreso",
    cleaner_finished: "Terminado por limpiador",
    client_confirmed: "Confirmado por cliente",
    signed: "Firmado",
    admin_closed: "Terminado por administrador",
    suspended: "Vencido / no iniciado",
    cancelled: "Cancelado"
  };
  return map[status] || status || "Asignado";
}

function dbStatusFromAppStatus(status, cleanerId = "") {
  if (status === "Programado") return cleanerId ? "assigned" : "scheduled";
  if (status === "Asignado") return "assigned";
  const map = {
    "Disponible para tomar": "open",
    "En progreso": "in_site",
    "En sitio": "in_site",
    "En sitio vencido": "in_site",
    "Vencido / no iniciado": "scheduled",
    "Terminado por cleaner": "cleaner_finished",
    "Terminado por limpiador": "cleaner_finished",
    "Confirmado por cliente": "client_confirmed",
    "Terminado por cliente": "client_confirmed",
    "Firmado": "signed",
    "Terminado por administrador": "admin_closed",
    "Cancelado": "cancelled"
  };
  return map[status] || (cleanerId ? "assigned" : "open");
}

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
    const profile = await supabaseData(
      supabaseClient.from('profiles').select('*').eq('id', user.id).maybeSingle(),
      "Cargar perfil"
    );
    if (profile) {
      state.companyProfile.ownerName = profile.full_name || state.companyProfile.ownerName;
      state.companyProfile.email = profile.email || state.companyProfile.email;
      state.companyProfile.phone = profile.phone || state.companyProfile.phone;
    }

    // Fetch membership
    const memberships = await supabaseData(
      supabaseClient.from('organization_members').select('*').eq('user_id', user.id).eq('status', 'active'),
      "Cargar empresa"
    );
    if (memberships && memberships.length > 0) {
      const orgId = memberships[0].organization_id;
      state.orgId = orgId;

      // Fetch organization details
      const org = await supabaseData(
        supabaseClient.from('organizations').select('*').eq('id', orgId).maybeSingle(),
        "Cargar datos de empresa"
      );
      if (org) {
        state.mode = org.type;
        state.country = org.country;
        state.companyProfile.businessName = org.name;
        selectedPlan = appPlanFromDbPlan(org.plan_id);
      }

      // Fetch clients
      const clients = await supabaseData(
        supabaseClient.from('clients').select('*').eq('organization_id', orgId),
        "Cargar clientes"
      );
      if (clients) {
        state.clients = clients.map(c => ({
          id: c.id,
          name: c.name,
          phone: c.phone || "",
          email: c.email || "",
          address: "",
          country: state.country || "IL",
          preferredLanguage: c.preferred_language || state.language || "es",
          paymentMethod: c.default_payment_method === 'cash' ? 'Efectivo' : 'Transferencia',
          notes: c.notes || "",
          portalPasscode: c.portal_passcode || null,
          portalActive: c.portal_active !== false,
          archived: Boolean(c.archived),
          archivedAt: c.archived_at || ""
        }));
      }

      // Fetch client addresses
      const addresses = await supabaseData(
        supabaseClient.from('client_addresses').select('*').eq('organization_id', orgId),
        "Cargar direcciones"
      );
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
      const cleaners = await supabaseData(
        supabaseClient.from('cleaners').select('*').eq('organization_id', orgId),
        "Cargar cleaners"
      );
      if (cleaners) {
        state.cleaners = cleaners.map(c => ({
          id: c.id,
          name: c.name,
          phone: c.phone || "",
          email: c.email || "",
          status: c.status === 'available' ? 'Disponible' : 'Ocupada',
          key: c.access_key,
          country: c.country || state.country || "IL",
          city: c.city || "Zona principal",
          archived: Boolean(c.archived),
          archivedAt: c.archived_at || ""
        }));
      }

      // Fetch job evidence
      const evidence = await supabaseData(
        supabaseClient.from('job_evidence').select('*').eq('organization_id', orgId),
        "Cargar evidencias"
      );

      // Fetch client signatures
      const signatures = await supabaseData(
        supabaseClient.from('client_signatures').select('*').eq('organization_id', orgId),
        "Cargar firmas"
      );

      // Fetch jobs
      const jobs = await supabaseData(
        supabaseClient.from('jobs').select('*').eq('organization_id', orgId),
        "Cargar trabajos"
      );
      if (jobs) {
        state.jobs = jobs.map(j => {
          const dateStr = j.scheduled_start ? j.scheduled_start.slice(0, 10) : today();
          // Extract time or default
          const startStr = (j.actual_start || j.scheduled_start) ? new Date(j.actual_start || j.scheduled_start).toISOString().slice(11, 16) : "08:00";
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
            organizationId: j.organization_id,
            clientId: j.client_id,
            cleanerId: j.assigned_cleaner_id || "",
            date: dateStr,
            start: startStr,
            end: endStr,
            actualEnd: actualEndStr,
            serviceType: j.service_type || "Limpieza normal",
            rate: Number(j.client_hourly_rate || 65),
            extras: Number(j.extras_amount || 0),
            requestReview: Boolean(j.request_review),
            clientRating: j.client_rating ? Number(j.client_rating) : null,
            clientReviewText: j.client_review_text || "",
            cleanerQualityRating: j.cleaner_quality_rating ? Number(j.cleaner_quality_rating) : null,
            cleanerPunctualityRating: j.cleaner_punctuality_rating ? Number(j.cleaner_punctuality_rating) : null,
            cleanerProfessionalismRating: j.cleaner_professionalism_rating ? Number(j.cleaner_professionalism_rating) : null,
            cleanerQualityText: j.cleaner_quality_text || "",
            cleanerRecommended: typeof j.cleaner_recommended === "boolean" ? j.cleaner_recommended : null,
            clientPaidAmount: Number(j.client_paid_amount || 0),
            clientPaymentStatus: j.client_payment_status || "unpaid",
            clientPaidDate: j.client_paid_date || "",
            clientPaymentMethod: j.client_payment_method || "",
            cleanerOnWayAt: j.cleaner_on_way_at || "",
            cleanerLocation: cleanerLocationFromJobRow(j),
            status: appStatusFromDbStatus(j.status),
            tasks: j.checklist || [],
            checkedIn: j.status === 'in_site' || DONE_DB_JOB_STATUSES.includes(j.status),
            checkedOut: DONE_DB_JOB_STATUSES.includes(j.status) || jobSignatures.length > 0,
            cleanerFinished: DONE_DB_JOB_STATUSES.includes(j.status) || jobSignatures.length > 0,
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
      const receipts = await supabaseData(
        supabaseClient.from('payment_receipts').select('*').eq('organization_id', orgId),
        "Cargar pagos a limpiadores"
      );
      if (receipts) {
        state.receipts = receipts.map(r => ({
          id: r.id,
          organizationId: r.organization_id,
          cleanerId: r.cleaner_id,
          cleaner: state.cleaners.find(c => c.id === r.cleaner_id)?.name || 'Cleaner',
          amount: Number(r.amount),
          method: r.payment_method === 'cash' ? 'Efectivo' : 'Transferencia',
          period: `${r.period_start} - ${r.period_end}`,
          status: r.status === 'draft' ? 'pending_signature' : 'signed',
          signature: r.receiver_signature_data,
          receiver: r.receiver_name || "",
          jobIds: r.job_ids || [],
          date: new Date(r.paid_at).toLocaleDateString('es'),
          createdAt: r.created_at || r.paid_at || new Date().toISOString()
        }));
      }

      const clientPayments = await supabaseData(
        supabaseClient
          .from('client_payment_receipts')
          .select('*')
          .eq('organization_id', orgId),
        "Cargar cobros a clientes"
      );
      if (clientPayments) {
        state.clientPayments = clientPayments.map(p => ({
          id: p.id,
          organizationId: p.organization_id,
          clientId: p.client_id,
          clientName: state.clients.find(c => c.id === p.client_id)?.name || p.client_name || "Cliente",
          amountReceived: Number(p.amount_received || 0),
          discount: Number(p.discount || 0),
          subtotal: Number(p.subtotal || 0),
          balanceAfter: Number(p.balance_after || 0),
          method: p.payment_method || "Efectivo",
          jobIds: p.job_ids || [],
          date: p.paid_at ? new Date(p.paid_at).toLocaleString("es") : "",
          createdAt: p.created_at || p.paid_at || new Date().toISOString()
        }));
      }

      // Fetch organization settings
      const settings = await supabaseData(
        supabaseClient.from('organization_settings').select('*').eq('organization_id', orgId),
        "Cargar ajustes"
      );
      if (settings) {
        const greetingSetting = settings.find(s => s.key === 'greeting_name');
        if (greetingSetting && greetingSetting.value?.name) {
          state.companyProfile.greetingName = greetingSetting.value.name;
        }

        const addressSetting = settings.find(s => s.key === 'company_address');
        if (addressSetting && addressSetting.value?.address) {
          state.companyProfile.address = addressSetting.value.address;
        }

        const vatSetting = settings.find(s => s.key === 'vat_rate');
        if (vatSetting) {
          state.vatRate = Number(vatSetting.value?.rate !== undefined ? vatSetting.value.rate : 18);
        }
        const currencySetting = settings.find(s => s.key === 'currency_symbol');
        if (currencySetting) {
          state.currencySymbol = currencySetting.value?.symbol || (state.country === 'IL' ? '₪' : '$');
        }
        const serviceRulesSetting = settings.find(s => s.key === 'service_rules');
        if (serviceRulesSetting?.value) {
          state.serviceRules = { ...state.serviceRules, ...serviceRulesSetting.value };
        }
        const clientPriceRulesSetting = settings.find(s => s.key === 'client_price_rules');
        if (Array.isArray(clientPriceRulesSetting?.value?.rules)) {
          state.clientPriceRules = clientPriceRulesSetting.value.rules;
        }
        const costRulesSetting = settings.find(s => s.key === 'cost_rules');
        if (costRulesSetting?.value) {
          state.costRules = { ...state.costRules, ...costRulesSetting.value };
        }
        const receiptsBackupSetting = settings.find(s => s.key === 'payment_receipts_backup');
        if (Array.isArray(receiptsBackupSetting?.value?.receipts)) {
          state.receipts = mergeById(state.receipts || [], receiptsBackupSetting.value.receipts);
        }
        const clientPaymentsBackupSetting = settings.find(s => s.key === 'client_payment_receipts_backup');
        if (Array.isArray(clientPaymentsBackupSetting?.value?.payments)) {
          state.clientPayments = mergeById(state.clientPayments || [], clientPaymentsBackupSetting.value.payments);
        }
        const jobPaymentBackupSetting = settings.find(s => s.key === 'jobs_payment_state_backup');
        if (Array.isArray(jobPaymentBackupSetting?.value?.jobs)) {
          const paymentByJob = new Map(jobPaymentBackupSetting.value.jobs.map(item => [item.id, item]));
          state.jobs.forEach(job => {
            const savedPayment = paymentByJob.get(job.id);
            if (!savedPayment) return;
            job.clientPaidAmount = Number(savedPayment.clientPaidAmount || 0);
            job.clientPaymentStatus = savedPayment.clientPaymentStatus || job.clientPaymentStatus || "unpaid";
            job.clientPaidDate = savedPayment.clientPaidDate || job.clientPaidDate || "";
            job.clientPaymentMethod = savedPayment.clientPaymentMethod || job.clientPaymentMethod || "";
          });
        }
      }

      const notifications = await supabaseData(
        supabaseClient
          .from('notifications')
          .select('*')
          .eq('organization_id', orgId)
          .order('created_at', { ascending: false })
          .limit(80),
        "Cargar notificaciones"
      );
      state.notificationLogs = Array.isArray(notifications) ? notifications : [];
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
    });    // 2. Sync organization details
    await supabaseClient.from('organizations').update({
      name: state.companyProfile.businessName,
      type: state.mode,
      country: state.country,
      default_language: state.language
    }).eq('id', state.orgId);

    // 3. Sync extra settings
    await supabaseClient.from('organization_settings').upsert([
      { organization_id: state.orgId, key: 'greeting_name', value: { name: state.companyProfile.greetingName || firstName(state.companyProfile.ownerName) } },
      { organization_id: state.orgId, key: 'company_address', value: { address: state.companyProfile.address || "" } }
    ], { onConflict: 'organization_id,key' });

    // 4. Sync clients & addresses. Do not reconcile-delete here: a partial local
    // state or portal session must never delete production records.
    for (const client of state.clients) {
      await supabaseClient.from('clients').upsert({
        id: client.id,
        organization_id: state.orgId,
        name: client.name,
        phone: client.phone,
        email: client.email,
        preferred_language: client.preferredLanguage || state.language || 'es',
        default_payment_method: client.paymentMethod === 'Efectivo' ? 'cash' : 'transfer',
        notes: client.notes,
        portal_passcode: client.portalPasscode || null,
        portal_active: client.portalActive !== false,
        archived: Boolean(client.archived),
        archived_at: client.archivedAt || null
      });

      if (client.address) {
        await upsertClientAddress(client);
      }
    }

    // 5. Sync cleaners
    for (const cleaner of state.cleaners) {
      ensureCleanerPortalKey(cleaner);
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
        language: state.language || 'es',
        archived: Boolean(cleaner.archived),
        archived_at: cleaner.archivedAt || null
      });
    }

    // 6. Sync jobs
    for (const job of state.jobs) {
      const { error: jobSaveError } = await supabaseClient.from('jobs').upsert(jobSupabasePayload(job));
      if (jobSaveError) throw jobSaveError;

      // Sync signatures
      if (job.siteSignature) {
        const { error: siteDeleteError } = await supabaseClient.from('client_signatures').delete().eq('job_id', job.id).eq('signed_from', 'cleaner_device');
        if (siteDeleteError) throw siteDeleteError;
        const { error: siteInsertError } = await supabaseClient.from('client_signatures').insert({
          organization_id: state.orgId,
          job_id: job.id,
          signer_name: job.siteSignerName || 'Persona en sitio',
          signature_data: job.siteSignature,
          signed_from: 'cleaner_device'
        });
        if (siteInsertError) throw siteInsertError;
      }

      if (job.clientSignature) {
        const { error: clientDeleteError } = await supabaseClient.from('client_signatures').delete().eq('job_id', job.id).eq('signed_from', 'private_link');
        if (clientDeleteError) throw clientDeleteError;
        const { error: clientInsertError } = await supabaseClient.from('client_signatures').insert({
          organization_id: state.orgId,
          job_id: job.id,
          signer_name: 'Cliente',
          signature_data: job.clientSignature,
          signed_from: 'private_link'
        });
        if (clientInsertError) throw clientInsertError;
      }

      // Sync job evidence
      if (Array.isArray(job.evidence)) {
        for (const ev of job.evidence) {
          const dbPhase = ev.phase === 'Antes' ? 'before' : 'after';
          const { error: evidenceSaveError } = await supabaseClient.from('job_evidence').upsert({
            id: ev.id,
            organization_id: state.orgId,
            job_id: job.id,
            area: ev.section || 'General',
            phase: dbPhase,
            file_path: ev.url,
            caption: ev.comment || ''
          });
          if (evidenceSaveError) throw evidenceSaveError;
        }
      }
    }

    // 7. Sync receipts
    for (const receipt of state.receipts) {
      const [start, end] = receiptPeriodDates(receipt.period, receipt.createdAt || receipt.date);
      const { error: receiptSaveError } = await supabaseClient.from('payment_receipts').upsert({
        id: receipt.id,
        organization_id: state.orgId,
        cleaner_id: receipt.cleanerId || state.cleaners.find(c => c.name === receipt.cleaner)?.id,
        period_start: start,
        period_end: end,
        amount: receipt.amount,
        payment_method: receipt.method === 'Efectivo' ? 'cash' : 'transfer',
        receiver_name: receipt.receiver || receipt.cleaner || null,
        receiver_signature_data: receipt.signature,
        job_ids: receipt.jobIds || [],
        status: receipt.status === 'signed' ? 'signed' : 'draft'
      });
      if (receiptSaveError) {
        console.warn("Cleaner receipt table sync skipped; backup settings will keep it visible:", receiptSaveError);
      }
    }

    for (const payment of state.clientPayments || []) {
      const { error: clientPaymentSaveError } = await supabaseClient.from('client_payment_receipts').upsert({
        id: payment.id,
        organization_id: state.orgId,
        client_id: payment.clientId,
        client_name: payment.clientName || null,
        amount_received: Number(payment.amountReceived || 0),
        discount: Number(payment.discount || 0),
        subtotal: Number(payment.subtotal || 0),
        balance_after: Number(payment.balanceAfter || 0),
        payment_method: payment.method || 'Efectivo',
        job_ids: payment.jobIds || [],
        paid_at: payment.createdAt || new Date().toISOString()
      });
      if (clientPaymentSaveError) {
        console.warn("Client payment receipt table sync skipped; backup settings will keep it visible:", clientPaymentSaveError);
      }
    }

    // 8. Sync organization settings (vat_rate and currency_symbol)
    await supabaseClient.from('organization_settings').upsert({
      organization_id: state.orgId,
      key: 'vat_rate',
      value: { rate: state.vatRate }
    }, { onConflict: 'organization_id,key' });
    await supabaseClient.from('organization_settings').upsert({
      organization_id: state.orgId,
      key: 'currency_symbol',
      value: { symbol: state.currencySymbol }
    }, { onConflict: 'organization_id,key' });
    await supabaseClient.from('organization_settings').upsert({
      organization_id: state.orgId,
      key: 'service_rules',
      value: state.serviceRules || {}
    }, { onConflict: 'organization_id,key' });
    await supabaseClient.from('organization_settings').upsert({
      organization_id: state.orgId,
      key: 'client_price_rules',
      value: { rules: state.clientPriceRules || [] }
    }, { onConflict: 'organization_id,key' });
    await supabaseClient.from('organization_settings').upsert({
      organization_id: state.orgId,
      key: 'cost_rules',
      value: state.costRules || {}
    }, { onConflict: 'organization_id,key' });
    await supabaseClient.from('organization_settings').upsert({
      organization_id: state.orgId,
      key: 'payment_receipts_backup',
      value: { receipts: state.receipts || [] }
    }, { onConflict: 'organization_id,key' });
    await supabaseClient.from('organization_settings').upsert({
      organization_id: state.orgId,
      key: 'client_payment_receipts_backup',
      value: { payments: state.clientPayments || [] }
    }, { onConflict: 'organization_id,key' });
    await supabaseClient.from('organization_settings').upsert({
      organization_id: state.orgId,
      key: 'jobs_payment_state_backup',
      value: { jobs: jobPaymentBackupRows() }
    }, { onConflict: 'organization_id,key' });
  } catch (e) {
    console.error("Error saving state to Supabase: ", e);
    throw e;
  }
}

async function upsertClientAddress(client) {
  if (!client?.address || !state.orgId || !supabaseClient) return;
  const row = {
    organization_id: state.orgId,
    client_id: client.id,
    label: "Main",
    address_line: client.address,
    country: client.country || state.country || "IL"
  };

  const { error: upsertError } = await supabaseClient
    .from("client_addresses")
    .upsert(row, { onConflict: "client_id" });
  if (!upsertError) return;

  console.warn("Client address upsert failed; trying update/insert fallback:", upsertError);
  const { data: existing, error: lookupError } = await supabaseClient
    .from("client_addresses")
    .select("id")
    .eq("client_id", client.id)
    .limit(1)
    .maybeSingle();
  if (lookupError) throw upsertError;

  if (existing?.id) {
    const { error } = await supabaseClient
      .from("client_addresses")
      .update(row)
      .eq("id", existing.id);
    if (error) throw error;
    return;
  }

  const { error } = await supabaseClient.from("client_addresses").insert(row);
  if (error) throw error;
}

function jobSupabasePayload(job) {
  if (!job?.clientId || !isUuid(job.clientId)) {
    throw new Error("Selecciona un cliente valido antes de guardar el trabajo.");
  }
  if (job.cleanerId && !isUuid(job.cleanerId)) {
    throw new Error("El limpiador seleccionado no es valido. Vuelve a elegirlo.");
  }
  if (!job.date || !job.start) {
    throw new Error("Fecha y hora de inicio son obligatorias.");
  }

  const scheduledStart = `${job.date}T${job.scheduledStart || job.start || "08:00"}:00Z`;
  const actualStart = job.checkedIn ? `${job.date}T${job.start || "08:00"}:00Z` : null;
  const scheduledEnd = job.end ? `${job.date}T${job.end}:00Z` : null;
  const actualEnd = job.actualEnd ? `${job.date}T${job.actualEnd}:00Z` : null;

  return {
    id: job.id,
    organization_id: state.orgId,
    client_id: job.clientId,
    assigned_cleaner_id: job.cleanerId || null,
    service_type: job.serviceType || "Limpieza normal",
    scheduled_start: scheduledStart,
    scheduled_end: scheduledEnd,
    actual_start: actualStart,
    actual_end: actualEnd,
    client_hourly_rate: Number(job.rate || 0),
    extras_amount: Number(job.extras || 0),
    request_review: Boolean(job.requestReview),
    client_rating: job.clientRating || null,
    client_review_text: job.clientReviewText || null,
    client_paid_amount: Number(job.clientPaidAmount || 0),
    client_payment_status: job.clientPaymentStatus || "unpaid",
    client_paid_date: job.clientPaidDate || null,
    client_payment_method: job.clientPaymentMethod || null,
    cleaner_on_way_at: job.cleanerOnWayAt || null,
    ...cleanerLocationPayload(job.cleanerLocation),
    status: dbStatusFromAppStatus(job.status, job.cleanerId),
    checklist: Array.isArray(job.tasks) ? job.tasks : []
  };
}

function clientSupabasePayload(client) {
  return {
    id: client.id,
    organization_id: state.orgId,
    name: client.name,
    phone: client.phone,
    email: client.email,
    preferred_language: client.preferredLanguage || state.language || "es",
    default_payment_method: client.paymentMethod === "Efectivo" ? "cash" : "transfer",
    notes: client.notes,
    portal_passcode: client.portalPasscode || null,
    portal_active: client.portalActive !== false,
    archived: Boolean(client.archived),
    archived_at: client.archivedAt || null
  };
}

function clientAddressSupabasePayload(client) {
  if (!client?.address) return null;
  return {
    organization_id: state.orgId,
    client_id: client.id,
    label: "Main",
    address_line: client.address,
    country: client.country || state.country || "IL"
  };
}

function cleanerSupabasePayload(cleaner) {
  ensureCleanerPortalKey(cleaner);
  return {
    id: cleaner.id,
    organization_id: state.orgId,
    name: cleaner.name,
    phone: cleaner.phone,
    email: cleaner.email,
    access_key: cleaner.key,
    status: cleaner.status === "Disponible" ? "available" : "busy",
    country: cleaner.country || state.country || "IL",
    city: cleaner.city || "Zona principal",
    language: state.language || "es",
    archived: Boolean(cleaner.archived),
    archived_at: cleaner.archivedAt || null
  };
}

async function persistJobsThroughServer(jobsToSave) {
  const jobs = Array.isArray(jobsToSave) ? jobsToSave : [jobsToSave];
  const firstJob = jobs[0];
  const client = state.clients.find((item) => item.id === firstJob?.clientId);
  if (!client) throw new Error("El trabajo no tiene cliente seleccionado.");
  const cleaner = firstJob?.cleanerId ? state.cleaners.find((item) => item.id === firstJob.cleanerId) : null;
  const token = await currentSupabaseAccessToken();
  if (!token) throw new Error("No hay sesion activa para guardar el trabajo.");

  const response = await fetch("/api/app-job", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      organizationId: state.orgId,
      client: clientSupabasePayload(client),
      clientAddress: clientAddressSupabasePayload(client),
      cleaner: cleaner ? cleanerSupabasePayload(cleaner) : null,
      jobs: jobs.map(jobSupabasePayload)
    })
  });

  const text = await response.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }
  if (!response.ok || data?.ok === false) {
    throw new Error(data?.error || "No se pudo guardar el trabajo en el servidor.");
  }
}

async function saveJobsCritical(jobsToSave) {
  saveLocalState();
  if (!supabaseClient || !state.orgId || !state.user) return;
  ensureValidUuids();

  const jobs = Array.isArray(jobsToSave) ? jobsToSave : [jobsToSave];
  if (window.JOBVISTO_USE_SERVER_JOB_SAVE === true) {
    try {
      await persistJobsThroughServer(jobs);
      return;
    } catch (error) {
      console.warn("Server job save failed; trying browser Supabase save:", error);
    }
  }

  for (const job of jobs) {
    const client = state.clients.find((item) => item.id === job.clientId);
    if (!client) throw new Error("El trabajo no tiene cliente seleccionado.");

    const { error: clientError } = await supabaseClient.from("clients").upsert(clientSupabasePayload(client));
    if (clientError) throw clientError;
    if (client.address) await upsertClientAddress(client);

    if (job.cleanerId) {
      const cleaner = state.cleaners.find((item) => item.id === job.cleanerId);
      if (!cleaner) throw new Error("El limpiador seleccionado no existe.");
      const { error: cleanerError } = await supabaseClient.from("cleaners").upsert(cleanerSupabasePayload(cleaner));
      if (cleanerError) throw cleanerError;
    }

    const { error: jobError } = await supabaseClient.from("jobs").upsert(jobSupabasePayload(job));
    if (jobError) throw jobError;
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

function dbPlanIdForPlan(plan) {
  const normalized = normalizePlanKey(plan);
  if (normalized === "free") return "free";
  if (normalized === "independent") return "solo";
  if (normalized === "company") return "starter";
  if (normalized === "pro") return "pro";
  return "free";
}

function appPlanFromDbPlan(plan) {
  return normalizePlanKey(plan) || "free";
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
  clientPayments: JSON.parse(localStorage.getItem("jobvisto-client-payments") || "[]"),
  notificationLogs: [],
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
let signupVerification = JSON.parse(sessionStorage.getItem("jobvisto-signup-verification") || "null");
let calendarCursor = new Date();
let expandedJobId = null;
let signingReceiptId = null;
let signingJobId = null;
let pendingDeleteJobId = null;
let pendingArchiveCleanerId = null;
let pendingArchiveClientId = null;
let pendingDeleteReceiptId = null;
let pendingVoidClientPaymentId = null;
let signaturePad = null;
let portalClientId = null;
let portalCleanerId = null;
let portalCleanerAdmin = false;
let cleanerHistoryAdminUnlocked = false;
let cleanerHistoryAdminExpiresAt = 0;
let cleanerHistoryAdminTimer = null;
let cleanerReportMonth = "";
let selectedJobsMonth = "all";
let recentActivityExpanded = false;
let cleanerActiveTab = "summary";
let pendingSignupData = null;
let planChoiceContext = "signup";
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

const PLAN_ENTITLEMENTS = {
  free: {
    label: "Freelancer Free",
    maxClients: 3,
    maxCleaners: 1,
    maxMonthlyJobs: 5,
    cleanerPortal: false,
    cleanerPayments: false,
    advancedReports: false,
    simpleExport: false,
    clientNotifications: false
  },
  independent: {
    label: "Independent",
    maxClients: 20,
    maxCleaners: 1,
    maxMonthlyJobs: Infinity,
    cleanerPortal: false,
    cleanerPayments: false,
    advancedReports: false,
    simpleExport: false,
    clientNotifications: false
  },
  company: {
    label: "Company",
    maxClients: Infinity,
    maxCleaners: 5,
    maxMonthlyJobs: Infinity,
    cleanerPortal: true,
    cleanerPayments: false,
    advancedReports: false,
    simpleExport: false,
    clientNotifications: false
  },
  pro: {
    label: "Pro",
    maxClients: Infinity,
    maxCleaners: 20,
    maxMonthlyJobs: Infinity,
    cleanerPortal: true,
    cleanerPayments: true,
    advancedReports: true,
    simpleExport: true,
    clientNotifications: true
  }
};

const PLAN_CHOICE_CARDS = {
  free: {
    name: "Freelancer Free",
    price: "$0",
    note: "Para probar JobVisto",
    action: "Empezar gratis",
    features: ["1 limpiador", "3 clientes", "5 trabajos por mes", "Portal del cliente"]
  },
  independent: {
    name: "Independent",
    price: "$9.99",
    note: "Para limpiadores independientes",
    action: "Pagar Independent",
    features: ["1 limpiador", "20 clientes", "Trabajos ilimitados", "Calendario completo"]
  },
  company: {
    name: "Company",
    price: "$29.99",
    note: "Para equipos en crecimiento",
    action: "Pagar Company",
    features: ["5 limpiadores", "Clientes ilimitados", "Portal cliente y limpiador", "Reportes operativos"]
  },
  pro: {
    name: "Pro",
    price: "$59.99",
    note: "Para empresas establecidas",
    action: "Pagar Pro",
    featured: true,
    features: ["20 limpiadores", "Pagos a limpiadores", "Reportes avanzados", "Avisos al cliente"]
  }
};

const stripePaymentLinksLive = {
  independent: "https://buy.stripe.com/dRmfZh20RcvVcAuedT2ZO0o",
  company: "https://buy.stripe.com/eVq8wP8pfbrR1VQ8Tz2ZO0p",
  pro: "https://buy.stripe.com/cNifZh7lb9jJfMG8Tz2ZO0q"
};

const stripePaymentLinksTest = {
  independent: "https://buy.stripe.com/test_fZudR9eND9jJ6c6edT2ZO00",
  company: "https://buy.stripe.com/test_cNi28raxn3Zp6c6d9P2ZO01",
  pro: "https://buy.stripe.com/test_4gMaEXdJz7bB8ke5Hn2ZO02"
};

const stripePaymentLinks = stripePaymentLinksLive;

const demoAccounts = {
  "jobvisto@zohomail.com": {
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
    emailVerificationCopy: "We will send a code to your email to confirm your account.",
    sendCode: "Send code",
    receivedCode: "Received code",
    securePayment: "Secure payment",
    stripeCopy: "After email verification, the client goes to Stripe. When payment is approved, access is activated and the password is delivered.",
    payStripe: "Go to Stripe checkout",
    paymentReturnTitle: "Payment received",
    paymentReturnCopy: "Complete your account details to activate JobVisto with the plan you just paid for.",
    createAccount: "Create account and activate",
    fineprint: "",
    cleanerArrived: "Cleaner arrived",
    cleanerArrivedCopy: "Client notified, GPS saved and job in progress.",
    cleanerPrivatePortal: "Cleaner private portal",
    cleanerPortalLogo: "Cleaner portal",
    cleanerSummaryTab: "Summary",
    cleanerJobsTab: "Jobs",
    cleanerCalendarTab: "Calendar",
    cleanerHoursTab: "Worked hours",
    cleanerPaymentsTab: "Payments",
    cleanerReportTab: "Report",
    cleanerEncouragementTitle: "Keep it up!",
    cleanerEncouragementCopy: "Great work. You have 95% of jobs completed on time.",
    cleanerPerformance: "View performance",
    cleanerWelcomeCopy: "Here is a summary of your activity today.",
    cleanerOnline: "Online",
    cleanerRole: "Cleaner",
    cleanerAccessBadge: "Private cleaner access",
    cleanerAccessEyebrow: "Secure cleaner portal",
    cleanerAccessTitle: "Team access",
    cleanerAccessCopy: "Enter to view assigned jobs, take open jobs, and record arrival, photos and departure.",
    cleanerAccessTrust1: "Private link",
    cleanerAccessTrust2: "Evidence upload",
    cleanerAccessTrust3: "Hours tracking",
    cleanerAccessPassword: "Access password",
    cleanerAccessPasswordPlaceholder: "Example: JV-MARIA",
    cleanerPortalEnter: "Enter portal",
    cleanerAssignedTitle: "Your jobs",
    cleanerAssignedChip: "Assigned",
    cleanerOpenJobsTitle: "Open jobs",
    cleanerTakeChip: "Take",
    cleanerRecentActivity: "Recent activity",
    cleanerViewAll: "View all",
    cleanerJobHistory: "Job history",
    cleanerClosedChip: "Closed",
    cleanerAdminCorrections: "Admin-permission corrections",
    cleanerAdminCorrectionCopy: "To add photos to closed jobs, enter the admin password.",
    cleanerAdminPassword: "Admin password",
    cleanerActivatePermission: "Activate permission",
    cleanerMyCalendar: "My calendar",
    cleanerAgendaChip: "Schedule",
    cleanerCurrentMonth: "Current month",
    cleanerGeneratedPayments: "Generated payments",
    cleanerSignatureRequired: "Signature required",
    cleanerReportTitle: "Cleaner report",
    cleanerMonth: "Month",
    cleanerRemember: "Remember",
    cleanerFooterCopy: "Follow the checklist steps and upload clear photos. This helps guarantee fast payments and good reviews.",
    cleanerStep1: "Step 1",
    cleanerStep1Text: "Review instructions",
    cleanerStep2: "Step 2",
    cleanerStep2Text: "Mark arrival",
    cleanerStep3: "Step 3",
    cleanerStep3Text: "Upload photos",
    cleanerStep4: "Step 4",
    cleanerStep4Text: "Finish job",
    cleanerAdminView: "Admin view for cleaners",
    helloCleaner: "Hello, {name}",
    helloCleanerWave: "Hello, {name} \u{1F44B}",
    pendingJobs: "Pending",
    toDo: "to do",
    highPriority: "High priority",
    workedToday: "Worked today",
    estimated: "estimated",
    activeToday: "Active today",
    noRecordsToday: "No records today",
    workedMonth: "Worked month",
    finishedJobs: "Finished",
    readyToConfirm: "ready to confirm",
    noCompleted: "No completed jobs",
    masterAccess: "Master access",
    visibleCleaners: "visible cleaners",
    noRecentActivity: "No recent activity.",
    jobAssigned: "Job assigned",
    jobCompleted: "Job completed",
    photosUploaded: "Photos uploaded",
    checkInRegistered: "Check-in registered",
    noActiveCleanerJobs: "You do not have active jobs. Finished jobs are in history.",
    noFinishedJobs: "There are no finished jobs yet.",
    timeUndefined: "to define",
    editFromAdmin: "Edit from admin",
    takeJob: "Take job",
    noOpenJobs: "There are no open jobs to take.",
    unassignedCleaner: "Unassigned",
    adminCorrection: "Admin correction",
    arrival: "Arrival",
    actualDeparture: "Actual departure",
    saveHours: "Save hours",
    finishByAdmin: "Finish by admin",
    overdueCleanerWarning: "This job is past the estimated time. Check if you should finish it or notify administration.",
    arrivalReminder: "It is time for the service. Mark your arrival now so it is recorded for the client.",
    futureJobActions: "Job scheduled for the future. Actions activate automatically on the service day.",
    workBriefTitle: "What to do",
    noChecklist: "no checklist",
    workBriefInstruction: "First review instructions, mark arrival once, upload before/after photos by area, and confirm departure when finished.",
    alreadyArrived: "Arrived {time}",
    markArrived: "I arrived",
    addPhoto: "Add photo",
    finishedAt: "Finished {time}",
    finishJob: "Finished",
    areaOrPlace: "Area or place",
    areaPlaceholder: "Example: kitchen, bathroom, desk",
    moment: "Moment",
    comment: "Comment",
    commentPlaceholder: "Example: grease in kitchen, window finished...",
    cameraOrLibrary: "Camera or library",
    saveEvidence: "Save evidence",
    cancelCorrection: "Cancel correction",
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
    finances: "Finances",
    cleanerPayments: "Cleaner payments",
    clientPayments: "Client collections",
    paymentsSubtitle: "Manage and record charges and payments for completed jobs.",
    clientPaymentSubtitle: "Record client payments and keep pending balances up to date.",
    registerClientPayment: "Register client payment",
    clientBalances: "Client balances",
    totalAmount: "Total amount",
    amountReceived: "Amount received",
    discount: "Discount",
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
    serviceLockedCopy: "This service becomes available for real-hour registration at check-in and check-out.",
    noRecentServiceActivity: "No recent activity.",
    serviceAssigned: "Service assigned",
    scheduledJob: "Scheduled job",
    arrivedAt: "Arrived at {time}",
    arrivedAtWithLocation: "Arrived at {time} - location available",
    cleanerWillRegisterArrival: "The cleaner will register arrival when they reach the site.",
    clientMustConfirmService: "The client must confirm when the service is completed.",
    signatureRegistered: "Signature registered",
    digitalSignatureRequested: "A digital signature will be requested on site.",
    serviceConfirmed: "Service confirmed",
    confirmServiceCompleted: "Confirm service completed",
    serviceHistory: "Service history",
    evidence: "Evidence",
    noEvidenceYet: "No real photos have been uploaded for this job yet.",
    noClosedJobsHistory: "There are no closed jobs in the history yet.",
    noComment: "No comment",
    upcomingService: "Upcoming service",
    viewDetails: "View details >",
    viewAllServices: "View all services >",
    showingFullHistory: "Showing the full history.",
    statusLabel: "Status",
    noEvidenceLoaded: "No evidence uploaded.",
    emptyEvidenceTitle: "No photos uploaded yet",
    emptyEvidenceCopy: "Photos and evidence will appear here once they are uploaded.",
    evidenceHistory: "View evidence history >",
    photosUploaded: "photos uploaded",
    photosUploadAfterChecklist: "Photos will be uploaded when each checklist area is finished.",
    rateThisService: "Rate this service:",
    reviewPlaceholder: "Write a comment here (optional)...",
    sendRating: "Send rating",
    sendReview: "Send review",
    reviewThanks: "Thank you for your review!",
    reviewQuestion: "How was our service on {date}?",
    reviewCopy: "Your opinion matters to us. Please rate this service:",
    sending: "Sending...",
    reviewSavedToast: "Thanks for your rating.",
    reviewSaveError: "Could not save the review. Check internet and try again.",
    clientAccessNotFound: "Client access not found. Use the updated link.",
    cleanerAccessNotFound: "Cleaner access not found. Copy the updated link from Cleaners.",
    takeJobError: "Could not take the job. Another cleaner may have taken it.",
    takeJobSuccess: "Job assigned to your portal.",
    futureJobToast: "This job is scheduled for the future. Actions activate on the service day.",
    alreadyArrivedToast: "Arrival already registered at {time}.",
    registeringArrival: "Registering arrival and location...",
    arrivalSaveError: "Could not save the arrival. Check internet and try again.",
    arrivalWithLocation: "Arrival marked with location and visible to the client.",
    arrivalWithoutLocation: "Arrival marked. The phone did not provide GPS location.",
    photosAvailableServiceDay: "You can add photos on the service day.",
    markArrivalForClientTime: "First mark your arrival so the client can see the real time.",
    evidenceAvailableServiceDay: "Evidence is enabled on the service day.",
    markArrivalBeforePhotos: "First mark your arrival before uploading photos.",
    evidenceSaveError: "Could not save the evidence.",
    choosePhotos: "Choose one or more photos from the camera or library.",
    photoSaveError: "Could not save a photo. Try with fewer photos.",
    evidenceCorrected: "Evidence updated.",
    evidenceSavedVisible: "{count} photo(s) saved and visible to the client.",
    finishOnlyServiceDay: "This job can only be finished on the service day.",
    markArrivalBeforeFinish: "You cannot finish before marking arrival.",
    finishWithoutPhotosConfirm: "You have not uploaded photos yet. You can finish, but the client will not see evidence. Continue?",
    finishSaveError: "Could not finish the job. Check internet and try again.",
    finishNeedsSignature: "Job finished. On-site signature is still needed.",
    adminFinishNeedsSignature: "Job finished by administrator. On-site signature is still needed.",
    pendingJobsToast: "{count} pending job(s) in your portal.",
    noPendingJobsToast: "You have no pending jobs right now.",
    performanceReportOpen: "Performance report opened.",
    adminPhotoPermissionNeeded: "You need admin permission to edit historical photos.",
    chooseHistoryPhotos: "Choose one or more photos to add to the history.",
    historicalPhotoComment: "Historical photo added with admin permission.",
    historicalPhotoSaveError: "Could not save a historical photo.",
    adminJobClosed: "Job closed as finished by administrator.",
    adminHoursSavedClosed: "Hours saved and job closed by administrator.",
    adminArrivalCorrected: "Arrival corrected by administrator.",
    portalSessionClosed: "Session closed. Enter the password to return to the portal.",
    adminPermissionExpired: "Admin permission expired. Enter the key to edit historical photos again.",
    masterAccessActiveCopy: "Master access active. You can add photos to closed jobs.",
    adminPermissionActiveCopy: "Permission active for {time}. You can add photos to closed jobs.",
    wrongKey: "Incorrect key.",
    wrongAdminKey: "Incorrect admin key.",
    masterAccessActivated: "Master access activated.",
    adminPermissionActivated: "Admin permission active for 1 hour for historical photos.",
    realEvidencePortalInstruction: "To add real evidence, enter the cleaner portal and use Camera or library.",
    adminFinishSaveError: "Could not save the close in the database. Try again.",
    adminFinishReadyForClient: "Job finished. Summary ready for the client.",
    clientSignatureSaved: "Client signature saved.",
    cleanerLocationMessage: "{client}, the cleaner registered location for the JobVisto service {date}: {url}",
    openLocationMaps: "Open location in Maps",
    sendLocationWhatsapp: "Send location by WhatsApp",
    chooseAdminEvidencePhotos: "Choose one or more photos to save as administrative evidence.",
    adminEvidenceSaveError: "Could not save the administrative evidence.",
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
    serviceActivity: "Service activity",
    realTime: "Real time",
    privatePortalFooterTitle: "This is your private portal.",
    privatePortalFooterCopy: "Here you can follow your service status in real time, view evidence, review history and confirm when the job has been completed.",
    needHelp: "Need help?",
    contactAdminPanel: "Contact the administrator from your panel.",
    contact: "Contact",
    paymentSignatureTitle: "Payment received signature",
    paymentSignatureCopy: "The cleaner signs with finger or mouse to confirm the external payment was received.",
    paymentSignatureCleanerPortalCopy: "Sign with finger or mouse to confirm the payment generated by administration and request payment processing.",
    serviceSignatureTitle: "Service departure signature",
    serviceSignatureCopy: "The person on site signs with finger or mouse to confirm the cleaner finished.",
    signerName: "Signer name",
    clearSignature: "Clear signature",
    saveSignature: "Save signature",
    photoOfJob: "Job photo",
    close: "Close",
    confirmDeletion: "Confirm deletion",
    deleteSelectedJobCopy: "Only the selected job will be deleted.",
    relatedJobsSafeCopy: "Other jobs from the same client remain saved because they are separate records.",
    deleteThisJob: "Delete this job",
    archiveCleanerTitle: "Archive cleaner",
    archiveCleanerCopy: "The cleaner leaves the active team, but their history remains saved.",
    archiveCleanerHistoryCopy: "Previous jobs, payments, photos and signatures remain available for reports and history.",
    archiveCleanerAction: "Archive cleaner",
    archiveClientTitle: "Archive client",
    archiveClientCopy: "The client leaves the active list, but their history remains saved.",
    archiveClientHistoryCopy: "Previous jobs, photos and signatures remain available for reports and history.",
    archiveClientAction: "Archive client",
    deleteReceiptTitle: "Delete receipt",
    deleteReceiptCopy: "This action deletes the receipt and releases its jobs so another payment can be generated.",
    deleteReceiptAction: "Delete receipt",
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
    emailVerificationCopy: "Te enviaremos un codigo a tu correo para confirmar tu cuenta.",
    sendCode: "Enviar codigo",
    receivedCode: "Codigo recibido",
    securePayment: "Pago seguro",
    stripeCopy: "Despues de verificar el email, el cliente pasa a Stripe. Al aprobarse el pago se activa el acceso y se entrega la contrasena.",
    payStripe: "Ir al pago en Stripe",
    paymentReturnTitle: "Pago recibido",
    paymentReturnCopy: "Completa los datos de tu cuenta para activar JobVisto con el plan que acabas de pagar.",
    createAccount: "Crear cuenta y activar",
    fineprint: "",
    cleanerArrived: "El limpiador llego",
    cleanerArrivedCopy: "Cliente notificado, GPS guardado y trabajo en progreso.",
    cleanerPrivatePortal: "Portal privado del limpiador",
    cleanerPortalLogo: "Portal del limpiador",
    cleanerSummaryTab: "Resumen",
    cleanerJobsTab: "Trabajos",
    cleanerCalendarTab: "Calendario",
    cleanerHoursTab: "Horas trabajadas",
    cleanerPaymentsTab: "Pagos",
    cleanerReportTab: "Reporte",
    cleanerEncouragementTitle: "Sigue asi!",
    cleanerEncouragementCopy: "Excelente trabajo. Tienes 95% de trabajos completados a tiempo.",
    cleanerPerformance: "Ver rendimiento",
    cleanerWelcomeCopy: "Aqui tienes un resumen de tu actividad del dia.",
    cleanerOnline: "En linea",
    cleanerRole: "Limpiador",
    cleanerAccessBadge: "Acceso privado del limpiador",
    cleanerAccessEyebrow: "Portal seguro del limpiador",
    cleanerAccessTitle: "Acceso del equipo",
    cleanerAccessCopy: "Entra para ver tus trabajos asignados, tomar trabajos abiertos y registrar llegada, fotos y salida.",
    cleanerAccessTrust1: "Enlace privado",
    cleanerAccessTrust2: "Subida de evidencia",
    cleanerAccessTrust3: "Registro de horas",
    cleanerAccessPassword: "Clave de acceso",
    cleanerAccessPasswordPlaceholder: "Ejemplo: JV-MARIA",
    cleanerPortalEnter: "Entrar al portal",
    cleanerAssignedTitle: "Tus trabajos",
    cleanerAssignedChip: "Asignados",
    cleanerOpenJobsTitle: "Trabajos abiertos",
    cleanerTakeChip: "Tomar",
    cleanerRecentActivity: "Actividad reciente",
    cleanerViewAll: "Ver todas",
    cleanerJobHistory: "Historial de trabajos",
    cleanerClosedChip: "Cerrados",
    cleanerAdminCorrections: "Correcciones con permiso admin",
    cleanerAdminCorrectionCopy: "Para agregar fotos a trabajos cerrados, ingresa la clave administrativa.",
    cleanerAdminPassword: "Clave admin",
    cleanerActivatePermission: "Activar permiso",
    cleanerMyCalendar: "Mi calendario",
    cleanerAgendaChip: "Agenda",
    cleanerCurrentMonth: "Mes actual",
    cleanerGeneratedPayments: "Pagos generados",
    cleanerSignatureRequired: "Firma requerida",
    cleanerReportTitle: "Reporte del limpiador",
    cleanerMonth: "Mes",
    cleanerRemember: "Recuerda",
    cleanerFooterCopy: "Sigue los pasos del checklist y sube fotos claras. Asi garantizas pagos rapidos y buenas resenas.",
    cleanerStep1: "Paso 1",
    cleanerStep1Text: "Revisa instrucciones",
    cleanerStep2: "Paso 2",
    cleanerStep2Text: "Marca llegada",
    cleanerStep3: "Paso 3",
    cleanerStep3Text: "Sube fotos",
    cleanerStep4: "Paso 4",
    cleanerStep4Text: "Termina trabajo",
    cleanerAdminView: "Vista administrador de limpiadores",
    helloCleaner: "Hola, {name}",
    helloCleanerWave: "Hola, {name} \u{1F44B}",
    pendingJobs: "Pendientes",
    toDo: "por hacer",
    highPriority: "Prioridad alta",
    workedToday: "Hoy trabajado",
    estimated: "estimado",
    activeToday: "Activo hoy",
    noRecordsToday: "Sin registros hoy",
    workedMonth: "Mes trabajado",
    finishedJobs: "Terminados",
    readyToConfirm: "listos para confirmar",
    noCompleted: "Sin completados",
    masterAccess: "Acceso maestro",
    visibleCleaners: "limpiadores visibles",
    noRecentActivity: "Sin actividad reciente.",
    jobAssigned: "Trabajo asignado",
    jobCompleted: "Trabajo completado",
    photosUploaded: "Fotos subidas",
    checkInRegistered: "Check-in registrado",
    noActiveCleanerJobs: "No tienes trabajos activos. Los terminados estan en historial.",
    noFinishedJobs: "Todavia no hay trabajos terminados.",
    timeUndefined: "por definir",
    editFromAdmin: "Editar desde admin",
    takeJob: "Tomar trabajo",
    noOpenJobs: "No hay trabajos abiertos para tomar.",
    unassignedCleaner: "Sin asignar",
    adminCorrection: "Correccion de administrador",
    arrival: "Llegada",
    actualDeparture: "Salida real",
    saveHours: "Guardar horas",
    finishByAdmin: "Terminar por admin",
    overdueCleanerWarning: "Este trabajo esta pasado de la hora estimada. Revisa si debes terminarlo o avisar a la administracion.",
    arrivalReminder: "Ya es hora del servicio. Marca tu llegada ahora para que quede registrada para el cliente.",
    futureJobActions: "Trabajo programado para el futuro. Las acciones se activan automaticamente el mismo dia del servicio.",
    workBriefTitle: "Que hacer",
    noChecklist: "sin checklist",
    workBriefInstruction: "Primero revisa instrucciones, marca llegada una sola vez, sube fotos antes/despues por area y confirma salida al terminar.",
    alreadyArrived: "Llegada {time}",
    markArrived: "Ya llegue",
    addPhoto: "Agregar foto",
    finishedAt: "Terminado {time}",
    finishJob: "Termine",
    areaOrPlace: "Area o lugar",
    areaPlaceholder: "Ej: cocina, bano, escritorio",
    moment: "Momento",
    comment: "Comentario",
    commentPlaceholder: "Ej: grasa en cocina, ventana terminada...",
    cameraOrLibrary: "Camara o biblioteca",
    saveEvidence: "Guardar evidencia",
    cancelCorrection: "Cancelar correccion",
    tomorrowJobs: "3 trabajos manana",
    authPlatformKicker: "Todo en una sola plataforma",
    authVisualTitle: "Control total de tu empresa de limpieza, en tiempo real.",
    authVisualPoint1: "Clientes, limpiadores y trabajos organizados",
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
    cleaners: "Limpiadores",
    calendar: "Calendario",
    jobs: "Trabajos",
    clientLinks: "Enlaces clientes",
    reports: "Reportes",
    payments: "Pagos",
    finances: "Finanzas",
    cleanerPayments: "Pagos a limpiadores",
    clientPayments: "Cobros a clientes",
    paymentsSubtitle: "Gestiona y registra cobros y pagos de trabajos realizados.",
    clientPaymentSubtitle: "Registra cobros de clientes y manten saldos pendientes al dia.",
    registerClientPayment: "Registrar cobro de cliente",
    clientBalances: "Saldos de clientes",
    totalAmount: "Monto total",
    amountReceived: "Monto recibido",
    discount: "Descuento",
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
    activeCleaners: "Limpiadores activos",
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
    registerCleaner: "Registrar limpiador",
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
    clientAccessTrust1: "Enlace privado",
    clientAccessTrust2: "Evidencia del servicio",
    clientAccessTrust3: "Confirmacion del cliente",
    clientAccessTitle: "Acceso del cliente",
    clientAccessCopy: "Ingresa la clave que te envio la empresa o el limpiador para ver trabajos, fotos y confirmaciones.",
    portalPassword: "Clave del portal",
    portalPasswordPlaceholder: "Ejemplo: JV-CAS-c1",
    clientPortalEnter: "Entrar al portal",
    clientLabel: "Cliente",
    privateServiceSummary: "Resumen privado del servicio",
    currentService: "Servicio actual/proximo",
    serviceStatus: "Estado del servicio",
    cleanerArrival: "Llegada del limpiador",
    cleanerDeparture: "Salida del limpiador",
    visiblePhotos: "Fotos visibles",
    cleanerFinished: "El limpiador marco terminado",
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
    serviceLockedCopy: "Este servicio estara disponible para registrar horas reales al momento de entrada y salida.",
    noRecentServiceActivity: "Sin actividad reciente.",
    serviceAssigned: "Servicio asignado",
    scheduledJob: "Trabajo programado",
    arrivedAt: "Llego a las {time}",
    arrivedAtWithLocation: "Llego a las {time} - ubicacion disponible",
    cleanerWillRegisterArrival: "El limpiador registrara su entrada al llegar al sitio.",
    clientMustConfirmService: "El cliente debera confirmar la finalizacion del servicio.",
    signatureRegistered: "Firma registrada",
    digitalSignatureRequested: "Se solicitara firma digital en el sitio.",
    serviceConfirmed: "Servicio confirmado",
    confirmServiceCompleted: "Confirmo servicio completado",
    serviceHistory: "Historial de servicios",
    evidence: "Evidencia",
    noEvidenceYet: "Todavia no hay fotos reales cargadas para este trabajo.",
    noClosedJobsHistory: "Todavia no hay trabajos cerrados en el historial.",
    noComment: "Sin comentario",
    upcomingService: "Proximo servicio",
    viewDetails: "Ver detalles >",
    viewAllServices: "Ver todos los servicios >",
    showingFullHistory: "Mostrando todo el historial.",
    statusLabel: "Estado",
    noEvidenceLoaded: "Sin evidencias cargadas.",
    emptyEvidenceTitle: "Aun no hay fotos cargadas",
    emptyEvidenceCopy: "Las fotos y evidencias seran visibles aqui una vez que se carguen.",
    evidenceHistory: "Ver historial de evidencias >",
    photosUploaded: "fotos subidas",
    photosUploadAfterChecklist: "Las fotos se cargaran al finalizar cada area del checklist.",
    rateThisService: "Calificar este servicio:",
    reviewPlaceholder: "Escribe un comentario aqui (opcional)...",
    sendRating: "Enviar calificacion",
    sendReview: "Enviar resena",
    reviewThanks: "Gracias por tu resena!",
    reviewQuestion: "Como fue nuestro servicio el {date}?",
    reviewCopy: "Nos importa mucho tu opinion. Por favor califica este servicio:",
    sending: "Enviando...",
    reviewSavedToast: "Gracias por tu calificacion.",
    reviewSaveError: "No se pudo guardar la resena. Revisa internet e intenta nuevamente.",
    clientAccessNotFound: "Acceso de cliente no encontrado. Usa el enlace actualizado.",
    cleanerAccessNotFound: "Acceso de limpiador no encontrado. Copia el enlace actualizado desde Limpiadores.",
    takeJobError: "No se pudo tomar el trabajo. Puede que ya lo haya tomado otro limpiador.",
    takeJobSuccess: "Trabajo asignado a tu portal.",
    futureJobToast: "Este trabajo es futuro. Los botones se activan el dia del servicio.",
    alreadyArrivedToast: "Llegada ya registrada a las {time}.",
    registeringArrival: "Registrando llegada y ubicacion...",
    arrivalSaveError: "No se pudo guardar la llegada en la base. Revisa internet e intenta otra vez.",
    arrivalWithLocation: "Llegada marcada con ubicacion y visible para el cliente.",
    arrivalWithoutLocation: "Llegada marcada. El telefono no entrego ubicacion GPS.",
    photosAvailableServiceDay: "Podras agregar fotos el dia del servicio.",
    markArrivalForClientTime: "Primero marca tu llegada para que el cliente vea la hora real.",
    evidenceAvailableServiceDay: "La evidencia se habilita el dia del servicio.",
    markArrivalBeforePhotos: "Primero marca tu llegada antes de subir fotos.",
    evidenceSaveError: "No se pudo guardar la evidencia en la base.",
    choosePhotos: "Elige una o varias fotos de la camara o biblioteca.",
    photoSaveError: "No se pudo guardar una foto en la base. Intenta con menos fotos.",
    evidenceCorrected: "Evidencia corregida.",
    evidenceSavedVisible: "{count} foto(s) guardada(s) y visible(s) para el cliente.",
    finishOnlyServiceDay: "Este trabajo se puede terminar solo el dia del servicio.",
    markArrivalBeforeFinish: "No puedes terminar sin marcar llegada primero.",
    finishWithoutPhotosConfirm: "Todavia no subiste fotos. Puedes terminar, pero el cliente no vera evidencia. Deseas continuar?",
    finishSaveError: "No se pudo terminar el trabajo en la base. Revisa internet e intenta otra vez.",
    finishNeedsSignature: "Trabajo terminado. Falta firma en sitio.",
    adminFinishNeedsSignature: "Trabajo terminado por administrador. Falta firma en sitio.",
    pendingJobsToast: "{count} trabajo(s) pendiente(s) en tu portal.",
    noPendingJobsToast: "No tienes trabajos pendientes ahora.",
    performanceReportOpen: "Reporte de rendimiento abierto.",
    adminPhotoPermissionNeeded: "Necesitas activar permiso admin para editar fotos historicas.",
    chooseHistoryPhotos: "Elige una o varias fotos para agregar al historial.",
    historicalPhotoComment: "Foto historica agregada con permiso admin.",
    historicalPhotoSaveError: "No se pudo guardar una foto historica en la base.",
    adminJobClosed: "Trabajo cerrado como terminado por administrador.",
    adminHoursSavedClosed: "Horas guardadas y trabajo cerrado por administrador.",
    adminArrivalCorrected: "Llegada corregida por administrador.",
    portalSessionClosed: "Sesion cerrada. Ingresa la clave para volver al portal.",
    adminPermissionExpired: "Permiso admin caducado. Ingresa la clave para volver a editar fotos historicas.",
    masterAccessActiveCopy: "Acceso maestro activo. Puedes agregar fotos a trabajos cerrados.",
    adminPermissionActiveCopy: "Permiso activo por {time}. Puedes agregar fotos a trabajos cerrados.",
    wrongKey: "Clave incorrecta.",
    wrongAdminKey: "Clave admin incorrecta.",
    masterAccessActivated: "Acceso maestro activado.",
    adminPermissionActivated: "Permiso admin activado por 1 hora para fotos historicas.",
    realEvidencePortalInstruction: "Para agregar evidencia real entra al portal del limpiador y usa Camara o biblioteca.",
    adminFinishSaveError: "No se pudo guardar el cierre en la base. Intenta otra vez.",
    adminFinishReadyForClient: "Trabajo terminado. Resumen listo para el cliente.",
    clientSignatureSaved: "Firma del cliente guardada.",
    cleanerLocationMessage: "{client}, el limpiador registro ubicacion para el servicio JobVisto {date}: {url}",
    openLocationMaps: "Abrir ubicacion en Maps",
    sendLocationWhatsapp: "Enviar ubicacion por WhatsApp",
    chooseAdminEvidencePhotos: "Elige una o varias fotos para guardar como evidencia administrativa.",
    adminEvidenceSaveError: "No se pudo guardar la evidencia administrativa en la base.",
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
    cleanerCompleted: "El limpiador termino",
    clientConfirmationShort: "Confirmacion cliente",
    onsiteSignatureReceived: "recibida de",
    completedJobsHistoryBelow: "Los trabajos realizados quedan abajo en historial.",
    serviceActivity: "Actividad del servicio",
    realTime: "En tiempo real",
    privatePortalFooterTitle: "Este es tu portal privado.",
    privatePortalFooterCopy: "Aqui puedes dar seguimiento al estado de tu servicio en tiempo real, ver evidencias, revisar historial y confirmar cuando el trabajo haya sido completado.",
    needHelp: "Necesitas ayuda?",
    contactAdminPanel: "Contacta al administrador desde tu panel.",
    contact: "Contactar",
    paymentSignatureTitle: "Firma de pago recibido",
    paymentSignatureCopy: "El limpiador firma con dedo o mouse para confirmar que recibio el pago externo.",
    paymentSignatureCleanerPortalCopy: "Firma con dedo o mouse para confirmar el pago generado por administracion y solicitar que se realice el pago.",
    serviceSignatureTitle: "Firma de salida del servicio",
    serviceSignatureCopy: "La persona en sitio firma con dedo o mouse para confirmar que el limpiador termino.",
    signerName: "Nombre de quien firma",
    clearSignature: "Limpiar firma",
    saveSignature: "Guardar firma",
    photoOfJob: "Foto del trabajo",
    close: "Cerrar",
    confirmDeletion: "Confirmar eliminacion",
    deleteSelectedJobCopy: "Se eliminara solo el trabajo seleccionado.",
    relatedJobsSafeCopy: "Si existen otros trabajos del mismo cliente, quedan guardados porque son registros separados.",
    deleteThisJob: "Eliminar este trabajo",
    archiveCleanerTitle: "Archivar limpiador",
    archiveCleanerCopy: "El limpiador sale del equipo activo, pero su historial queda guardado.",
    archiveCleanerHistoryCopy: "Sus trabajos, pagos, fotos y firmas anteriores se mantienen para reportes e historial.",
    archiveCleanerAction: "Archivar limpiador",
    archiveClientTitle: "Archivar cliente",
    archiveClientCopy: "El cliente sale de la lista activa, pero su historial queda guardado.",
    archiveClientHistoryCopy: "Sus trabajos, fotos y firmas anteriores se mantienen para reportes e historial.",
    archiveClientAction: "Archivar cliente",
    deleteReceiptTitle: "Eliminar comprobante",
    deleteReceiptCopy: "Esta accion borra el comprobante y libera sus trabajos para generar otro pago.",
    deleteReceiptAction: "Eliminar comprobante",
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
    emailVerificationCopy: "Мы отправим код на ваш email, чтобы подтвердить учетную запись.",
    sendCode: "Отправить код",
    receivedCode: "Полученный код",
    securePayment: "Безопасная оплата",
    stripeCopy: "После проверки email клиент переходит в Stripe. После оплаты доступ активируется и выдается пароль.",
    payStripe: "Перейти к оплате Stripe",
    paymentReturnTitle: "Платеж получен",
    paymentReturnCopy: "Заполните данные аккаунта, чтобы активировать JobVisto с оплаченным тарифом.",
    createAccount: "Создать аккаунт и активировать",
    fineprint: "",
    cleanerArrived: "Клинер прибыл",
    cleanerArrivedCopy: "Клиент уведомлен, GPS сохранен, работа в процессе.",
    cleanerPrivatePortal: "Личный портал клинера",
    cleanerPortalLogo: "Портал клинера",
    cleanerSummaryTab: "Сводка",
    cleanerJobsTab: "Работы",
    cleanerCalendarTab: "Календарь",
    cleanerHoursTab: "Отработанные часы",
    cleanerPaymentsTab: "Платежи",
    cleanerReportTab: "Отчет",
    cleanerEncouragementTitle: "Продолжайте так!",
    cleanerEncouragementCopy: "Отличная работа. 95% работ выполнены вовремя.",
    cleanerPerformance: "Посмотреть результат",
    cleanerWelcomeCopy: "Здесь сводка вашей активности за сегодня.",
    cleanerOnline: "Онлайн",
    cleanerRole: "Клинер",
    cleanerAccessBadge: "Личный доступ клинера",
    cleanerAccessEyebrow: "Безопасный портал клинера",
    cleanerAccessTitle: "Доступ команды",
    cleanerAccessCopy: "Войдите, чтобы видеть назначенные работы, брать открытые работы и отмечать прибытие, фото и уход.",
    cleanerAccessTrust1: "Личная ссылка",
    cleanerAccessTrust2: "Загрузка фото",
    cleanerAccessTrust3: "Учет часов",
    cleanerAccessPassword: "Пароль доступа",
    cleanerAccessPasswordPlaceholder: "Пример: JV-MARIA",
    cleanerPortalEnter: "Войти в портал",
    cleanerAssignedTitle: "Ваши работы",
    cleanerAssignedChip: "Назначено",
    cleanerOpenJobsTitle: "Открытые работы",
    cleanerTakeChip: "Взять",
    cleanerRecentActivity: "Последняя активность",
    cleanerViewAll: "Показать все",
    cleanerJobHistory: "История работ",
    cleanerClosedChip: "Закрыто",
    cleanerAdminCorrections: "Исправления с разрешением админа",
    cleanerAdminCorrectionCopy: "Чтобы добавить фото к закрытым работам, введите пароль администратора.",
    cleanerAdminPassword: "Пароль админа",
    cleanerActivatePermission: "Активировать доступ",
    cleanerMyCalendar: "Мой календарь",
    cleanerAgendaChip: "Расписание",
    cleanerCurrentMonth: "Текущий месяц",
    cleanerGeneratedPayments: "Созданные платежи",
    cleanerSignatureRequired: "Нужна подпись",
    cleanerReportTitle: "Отчет клинера",
    cleanerMonth: "Месяц",
    cleanerRemember: "Помните",
    cleanerFooterCopy: "Следуйте чеклисту и загружайте четкие фото. Это помогает получать быстрые выплаты и хорошие отзывы.",
    cleanerStep1: "Шаг 1",
    cleanerStep1Text: "Проверьте инструкции",
    cleanerStep2: "Шаг 2",
    cleanerStep2Text: "Отметьте прибытие",
    cleanerStep3: "Шаг 3",
    cleanerStep3Text: "Загрузите фото",
    cleanerStep4: "Шаг 4",
    cleanerStep4Text: "Завершите работу",
    cleanerAdminView: "Админ-просмотр клинеров",
    helloCleaner: "Здравствуйте, {name}",
    helloCleanerWave: "Здравствуйте, {name} 👋",
    pendingJobs: "Ожидают",
    toDo: "к выполнению",
    highPriority: "Высокий приоритет",
    workedToday: "Сегодня отработано",
    estimated: "примерно",
    activeToday: "Активно сегодня",
    noRecordsToday: "Сегодня записей нет",
    workedMonth: "За месяц",
    finishedJobs: "Завершено",
    readyToConfirm: "готово к подтверждению",
    noCompleted: "Нет завершенных",
    masterAccess: "Мастер-доступ",
    visibleCleaners: "видимых клинеров",
    noRecentActivity: "Последней активности нет.",
    jobAssigned: "Работа назначена",
    jobCompleted: "Работа завершена",
    photosUploaded: "Фото загружены",
    checkInRegistered: "Прибытие отмечено",
    noActiveCleanerJobs: "У вас нет активных работ. Завершенные работы находятся в истории.",
    noFinishedJobs: "Пока нет завершенных работ.",
    timeUndefined: "уточнить",
    editFromAdmin: "Редактировать как админ",
    takeJob: "Взять работу",
    noOpenJobs: "Нет открытых работ, которые можно взять.",
    unassignedCleaner: "Не назначено",
    adminCorrection: "Исправление администратора",
    arrival: "Прибытие",
    actualDeparture: "Фактический уход",
    saveHours: "Сохранить часы",
    finishByAdmin: "Завершить как админ",
    overdueCleanerWarning: "Работа просрочена по расчетному времени. Проверьте, нужно ли завершить ее или сообщить администрации.",
    arrivalReminder: "Время услуги наступило. Отметьте прибытие, чтобы клиент видел реальное время.",
    futureJobActions: "Работа запланирована на будущее. Действия включатся автоматически в день услуги.",
    workBriefTitle: "Что делать",
    noChecklist: "без чеклиста",
    workBriefInstruction: "Сначала проверьте инструкции, один раз отметьте прибытие, загрузите фото до/после по зонам и подтвердите уход после завершения.",
    alreadyArrived: "Прибытие {time}",
    markArrived: "Я прибыл",
    addPhoto: "Добавить фото",
    finishedAt: "Завершено {time}",
    finishJob: "Завершить",
    areaOrPlace: "Зона или место",
    areaPlaceholder: "Пример: кухня, ванная, стол",
    moment: "Момент",
    comment: "Комментарий",
    commentPlaceholder: "Пример: жир на кухне, окно готово...",
    cameraOrLibrary: "Камера или галерея",
    saveEvidence: "Сохранить фото",
    cancelCorrection: "Отменить исправление",
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
    finances: "Финансы",
    cleanerPayments: "Выплаты клинерам",
    clientPayments: "Оплаты клиентов",
    paymentsSubtitle: "Управляйте оплатами и выплатами по выполненным работам.",
    clientPaymentSubtitle: "Регистрируйте оплаты клиентов и обновляйте задолженности.",
    registerClientPayment: "Зарегистрировать оплату клиента",
    clientBalances: "Балансы клиентов",
    totalAmount: "Общая сумма",
    amountReceived: "Полученная сумма",
    discount: "Скидка",
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
    serviceLockedCopy: "Эта услуга станет доступна для регистрации реального времени при входе и выходе.",
    noRecentServiceActivity: "Нет недавней активности.",
    serviceAssigned: "Услуга назначена",
    scheduledJob: "Работа запланирована",
    arrivedAt: "Прибыл в {time}",
    arrivedAtWithLocation: "Прибыл в {time} - геолокация доступна",
    cleanerWillRegisterArrival: "Клинер отметит прибытие, когда будет на месте.",
    clientMustConfirmService: "Клиент должен подтвердить завершение услуги.",
    signatureRegistered: "Подпись сохранена",
    digitalSignatureRequested: "На месте будет запрошена цифровая подпись.",
    serviceConfirmed: "Услуга подтверждена",
    confirmServiceCompleted: "Подтвердить завершение услуги",
    serviceHistory: "История услуг",
    evidence: "Фотоотчет",
    noEvidenceYet: "Для этой работы пока нет реальных загруженных фото.",
    noClosedJobsHistory: "В истории пока нет закрытых работ.",
    noComment: "Без комментария",
    upcomingService: "Ближайшая услуга",
    viewDetails: "Подробнее >",
    viewAllServices: "Посмотреть все услуги >",
    showingFullHistory: "Показана вся история.",
    statusLabel: "Статус",
    noEvidenceLoaded: "Доказательства не загружены.",
    emptyEvidenceTitle: "Фото пока не загружены",
    emptyEvidenceCopy: "Фото и доказательства появятся здесь после загрузки.",
    evidenceHistory: "Посмотреть историю доказательств >",
    photosUploaded: "фото загружено",
    photosUploadAfterChecklist: "Фото будут загружены после завершения каждого раздела чеклиста.",
    rateThisService: "Оцените эту услугу:",
    reviewPlaceholder: "Напишите комментарий здесь (необязательно)...",
    sendRating: "Отправить оценку",
    sendReview: "Отправить отзыв",
    reviewThanks: "Спасибо за отзыв!",
    reviewQuestion: "Как прошла наша услуга {date}?",
    reviewCopy: "Ваше мнение важно для нас. Пожалуйста, оцените эту услугу:",
    sending: "Отправка...",
    reviewSavedToast: "Спасибо за вашу оценку.",
    reviewSaveError: "Не удалось сохранить отзыв. Проверьте интернет и попробуйте снова.",
    clientAccessNotFound: "Доступ клиента не найден. Используйте обновленную ссылку.",
    cleanerAccessNotFound: "Доступ клинера не найден. Скопируйте обновленную ссылку из Cleaners.",
    takeJobError: "Не удалось взять работу. Возможно, ее уже взял другой клинер.",
    takeJobSuccess: "Работа назначена в ваш портал.",
    futureJobToast: "Эта работа запланирована на будущее. Кнопки включатся в день услуги.",
    alreadyArrivedToast: "Прибытие уже отмечено в {time}.",
    registeringArrival: "Регистрируем прибытие и местоположение...",
    arrivalSaveError: "Не удалось сохранить прибытие. Проверьте интернет и попробуйте снова.",
    arrivalWithLocation: "Прибытие отмечено с местоположением и видно клиенту.",
    arrivalWithoutLocation: "Прибытие отмечено. Телефон не передал GPS.",
    photosAvailableServiceDay: "Фото можно добавить в день услуги.",
    markArrivalForClientTime: "Сначала отметьте прибытие, чтобы клиент видел реальное время.",
    evidenceAvailableServiceDay: "Фотоотчет доступен в день услуги.",
    markArrivalBeforePhotos: "Сначала отметьте прибытие перед загрузкой фото.",
    evidenceSaveError: "Не удалось сохранить фотоотчет.",
    choosePhotos: "Выберите одно или несколько фото из камеры или галереи.",
    photoSaveError: "Не удалось сохранить фото. Попробуйте меньше фото.",
    evidenceCorrected: "Фотоотчет обновлен.",
    evidenceSavedVisible: "Сохранено фото: {count}. Клиент может их видеть.",
    finishOnlyServiceDay: "Эту работу можно завершить только в день услуги.",
    markArrivalBeforeFinish: "Нельзя завершить работу без отметки прибытия.",
    finishWithoutPhotosConfirm: "Вы еще не загрузили фото. Можно завершить, но клиент не увидит доказательства. Продолжить?",
    finishSaveError: "Не удалось завершить работу. Проверьте интернет и попробуйте снова.",
    finishNeedsSignature: "Работа завершена. Нужна подпись на месте.",
    adminFinishNeedsSignature: "Работа завершена администратором. Нужна подпись на месте.",
    pendingJobsToast: "В вашем портале ожидающих работ: {count}.",
    noPendingJobsToast: "Сейчас нет ожидающих работ.",
    performanceReportOpen: "Отчет по результатам открыт.",
    adminPhotoPermissionNeeded: "Нужно разрешение администратора для редактирования исторических фото.",
    chooseHistoryPhotos: "Выберите одно или несколько фото для добавления в историю.",
    historicalPhotoComment: "Историческое фото добавлено с разрешением администратора.",
    historicalPhotoSaveError: "Не удалось сохранить историческое фото.",
    adminJobClosed: "Работа закрыта как завершенная администратором.",
    adminHoursSavedClosed: "Часы сохранены, работа закрыта администратором.",
    adminArrivalCorrected: "Прибытие исправлено администратором.",
    portalSessionClosed: "Сессия закрыта. Введите пароль, чтобы вернуться в портал.",
    adminPermissionExpired: "Разрешение администратора истекло. Введите ключ, чтобы снова редактировать исторические фото.",
    masterAccessActiveCopy: "Мастер-доступ активен. Можно добавлять фото к закрытым работам.",
    adminPermissionActiveCopy: "Разрешение активно еще {time}. Можно добавлять фото к закрытым работам.",
    wrongKey: "Неверный ключ.",
    wrongAdminKey: "Неверный ключ администратора.",
    masterAccessActivated: "Мастер-доступ активирован.",
    adminPermissionActivated: "Разрешение администратора активно на 1 час для исторических фото.",
    realEvidencePortalInstruction: "Чтобы добавить реальные доказательства, войдите в портал клинера и используйте камеру или галерею.",
    adminFinishSaveError: "Не удалось сохранить закрытие в базе. Попробуйте снова.",
    adminFinishReadyForClient: "Работа завершена. Сводка готова для клиента.",
    clientSignatureSaved: "Подпись клиента сохранена.",
    cleanerLocationMessage: "{client}, клинер отметил местоположение для услуги JobVisto {date}: {url}",
    openLocationMaps: "Открыть местоположение в Maps",
    sendLocationWhatsapp: "Отправить местоположение в WhatsApp",
    chooseAdminEvidencePhotos: "Выберите одно или несколько фото для административного доказательства.",
    adminEvidenceSaveError: "Не удалось сохранить административное доказательство.",
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
    serviceActivity: "Активность услуги",
    realTime: "В реальном времени",
    privatePortalFooterTitle: "Это ваш личный портал.",
    privatePortalFooterCopy: "Здесь можно отслеживать статус услуги, смотреть фото, историю и подтверждать завершение работы.",
    needHelp: "Нужна помощь?",
    contactAdminPanel: "Свяжитесь с администратором через вашу панель.",
    contact: "Связаться",
    paymentSignatureTitle: "Подпись о получении оплаты",
    paymentSignatureCopy: "Клинер подписывает пальцем или мышью, чтобы подтвердить получение внешней оплаты.",
    paymentSignatureCleanerPortalCopy: "Подпишите пальцем или мышью, чтобы подтвердить платеж, созданный администрацией, и запросить выплату.",
    serviceSignatureTitle: "Подпись ухода с услуги",
    serviceSignatureCopy: "Человек на месте подписывает пальцем или мышью, чтобы подтвердить завершение работы клинером.",
    signerName: "Имя подписанта",
    clearSignature: "Очистить подпись",
    saveSignature: "Сохранить подпись",
    photoOfJob: "Фото работы",
    close: "Закрыть",
    confirmDeletion: "Подтвердить удаление",
    deleteSelectedJobCopy: "Будет удалена только выбранная работа.",
    relatedJobsSafeCopy: "Другие работы этого клиента останутся сохраненными, потому что это отдельные записи.",
    deleteThisJob: "Удалить эту работу",
    archiveCleanerTitle: "Архивировать клинера",
    archiveCleanerCopy: "Клинер уйдет из активной команды, но история сохранится.",
    archiveCleanerHistoryCopy: "Предыдущие работы, платежи, фото и подписи останутся для отчетов и истории.",
    archiveCleanerAction: "Архивировать клинера",
    archiveClientTitle: "Архивировать клиента",
    archiveClientCopy: "Клиент уйдет из активного списка, но история сохранится.",
    archiveClientHistoryCopy: "Предыдущие работы, фото и подписи останутся для отчетов и истории.",
    archiveClientAction: "Архивировать клиента",
    deleteReceiptTitle: "Удалить квитанцию",
    deleteReceiptCopy: "Это действие удалит квитанцию и освободит ее работы для нового платежа.",
    deleteReceiptAction: "Удалить квитанцию",
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
  state.language = language || "es";
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
  if ($("#idleTimeoutModal") && !$("#idleTimeoutModal").classList.contains("hidden")) {
    applyIdleModalCopy();
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

function planChoiceCopy(context, reason = "") {
  if (context === "limit") {
    return reason || "Llegaste al limite de tu plan actual. Elige un paquete superior para seguir creciendo.";
  }
  if (stripePaymentReturn) {
    return "Ya recibimos el pago. Completa el registro para activar tu cuenta.";
  }
  return "Primero guardamos tus datos basicos. Ahora elige si quieres empezar gratis o activar un plan pagado.";
}

function renderPlanChoiceGrid() {
  const grid = $("#planChoiceGrid");
  if (!grid) return;
  grid.innerHTML = Object.entries(PLAN_CHOICE_CARDS).map(([planKey, card]) => `
    <article class="plan-choice-option ${card.featured ? "is-featured" : ""}">
      <div>
        <h4>${escapeHtml(card.name)}</h4>
        <p class="muted">${escapeHtml(card.note)}</p>
      </div>
      <div class="plan-choice-price">${escapeHtml(card.price)}<small>/mes</small></div>
      <ul>
        ${card.features.map((feature) => `<li>${escapeHtml(feature)}</li>`).join("")}
      </ul>
      <button class="${planKey === "free" ? "ghost" : "primary"}" type="button" data-choose-plan="${planKey}">
        ${escapeHtml(card.action)}
      </button>
    </article>
  `).join("");
}

function openPlanChoiceModal(context = "signup", reason = "") {
  planChoiceContext = context;
  $("#planChoiceTitle").textContent = context === "limit" ? "Actualiza tu plan" : "Elige tu plan";
  $("#planChoiceCopy").textContent = planChoiceCopy(context, reason);
  renderPlanChoiceGrid();
  $("#planChoiceModal")?.classList.remove("hidden");
}

function closePlanChoiceModal() {
  $("#planChoiceModal")?.classList.add("hidden");
}

function goToStripeForPlan(planKey, email = "") {
  const link = stripePaymentLinks[planKey] || stripePaymentLinks.independent;
  const suffix = email ? `?prefilled_email=${encodeURIComponent(email)}` : "";
  location.href = `${link}${suffix}`;
}

function storeSignupVerification(value) {
  signupVerification = value;
  if (value) {
    sessionStorage.setItem("jobvisto-signup-verification", JSON.stringify(value));
  } else {
    sessionStorage.removeItem("jobvisto-signup-verification");
  }
}

async function sendSignupVerificationCode(email) {
  const response = await fetch("/.netlify/functions/app-verification-code", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "send", email })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || "No se pudo enviar el codigo.");
  storeSignupVerification({ email: String(email || "").trim().toLowerCase(), token: data.verificationToken, verified: false });
  verificationSent = true;
}

async function verifySignupCode(email, code) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!signupVerification?.token || signupVerification.email !== normalizedEmail) {
    throw new Error("Primero envia el codigo a tu correo.");
  }
  const response = await fetch("/.netlify/functions/app-verification-code", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "verify", email: normalizedEmail, code, verificationToken: signupVerification.token })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.verified) throw new Error(data?.error || "Codigo incorrecto.");
  storeSignupVerification({ ...signupVerification, verified: true });
}

async function choosePlan(planKey) {
  selectedPlan = normalizePlanKey(planKey) || "free";
  syncPlanSelection();
  closePlanChoiceModal();
  const email = pendingSignupData?.email || $("#authForm")?.elements.email?.value || "";

  if (selectedPlan !== "free") {
    goToStripeForPlan(selectedPlan, email);
    return;
  }

  if (pendingSignupData) {
    const data = pendingSignupData;
    pendingSignupData = null;
    await registerAccountWithSelectedPlan(data);
    return;
  }

  if (planChoiceContext === "limit") {
    toast("Ya estas en el plan gratis. Elige un plan pagado para aumentar limites.");
  }
}

async function registerAccountWithSelectedPlan(data) {
  toast("Registrando cuenta...");
  let finalPlan = selectedPlan;

  let stripePayment = null;
  try {
    const { data: payment } = await supabaseClient
      .from("stripe_payments")
      .select("*")
      .eq("email", data.email.toLowerCase())
      .in("payment_status", ["paid", "complete", "active", "trialing"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (payment) {
      stripePayment = payment;
      finalPlan = payment.plan_id === "solo" ? "independent" : (payment.plan_id === "starter" ? "company" : payment.plan_id);
    }
  } catch (err) {
    console.error("Error looking up Stripe payment:", err);
  }

  if (selectedPlan !== "free" && !stripePayment) {
    toast("Aun no encontramos el pago confirmado de Stripe para este email. Espera unos segundos y vuelve a intentar.");
    return;
  }

  const dbPlanId = dbPlanIdForPlan(finalPlan);
  const finalMode = ["free", "independent"].includes(finalPlan) ? "independent" : "company";

  const { data: authData, error } = await supabaseClient.auth.signUp({
    email: data.email,
    password: data.password,
    options: {
      data: {
        full_name: data.fullName || data.email.split('@')[0],
        phone: data.phone || "",
        company_name: data.companyName || `${data.fullName || 'Mi Empresa'}`,
        mode: finalMode,
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

    if (stripePayment && authData.session) {
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
          billing_cycle: stripePayment.billing_cycle || "monthly",
          started_at: new Date().toISOString()
        });
      }
    }

    if (authData.session) {
      await loadStateFromSupabase();
      enterApp(finalMode);
      toast("Cuenta creada y activada.");
    } else {
      toast("Registro exitoso. Por favor verifica tu correo para activar tu cuenta.");
    }
  }
}

async function applyPaidPlanForCurrentUser() {
  if (!stripePaymentReturn || !supabaseClient || !state.user?.email || !state.orgId) return;
  try {
    const { data: payment } = await supabaseClient
      .from("stripe_payments")
      .select("*")
      .eq("email", state.user.email.toLowerCase())
      .in("payment_status", ["paid", "complete", "active", "trialing"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!payment) return;

    const paidPlan = appPlanFromDbPlan(payment.plan_id);
    if (!paidPlan || paidPlan === "free") return;
    const dbPlanId = dbPlanIdForPlan(paidPlan);
    const orgType = ["independent", "free"].includes(paidPlan) ? "independent" : "company";

    await supabaseClient
      .from("organizations")
      .update({ plan_id: dbPlanId, type: orgType })
      .eq("id", state.orgId);

    await supabaseClient.from("subscriptions").insert({
      organization_id: state.orgId,
      plan_id: dbPlanId,
      status: "active",
      provider: "stripe",
      provider_customer_id: payment.customer_id,
      provider_subscription_id: payment.subscription_id,
      billing_cycle: payment.billing_cycle || "monthly",
      started_at: new Date().toISOString()
    });

    selectedPlan = paidPlan;
    state.mode = orgType;
    toast(`Plan actualizado a ${PLAN_CHOICE_CARDS[paidPlan]?.name || paidPlan}.`);
  } catch (err) {
    console.error("Error applying paid plan:", err);
  }
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

function localDateKey(date = new Date()) {
  const safeDate = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(safeDate.getTime())) return localDateKey(new Date());
  const year = safeDate.getFullYear();
  const month = String(safeDate.getMonth() + 1).padStart(2, "0");
  const day = String(safeDate.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function localDateFromKey(value) {
  const [year, month, day] = String(value || "").split("-").map(Number);
  if (!year || !month || !day) return new Date();
  return new Date(year, month - 1, day);
}

function today() {
  return localDateKey();
}

function currentPeriodLabel(date = new Date()) {
  return date.toLocaleDateString("es", { month: "long", year: "numeric" });
}

function receiptPeriodDates(period = "", fallbackDate = new Date()) {
  if (String(period).includes(" - ")) {
    const [start, end] = String(period).split(" - ");
    if (/^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end)) {
      return [start, end];
    }
  }
  const base = fallbackDate instanceof Date ? fallbackDate : new Date(fallbackDate);
  const safeBase = Number.isNaN(base.getTime()) ? new Date() : base;
  const startDate = new Date(safeBase.getFullYear(), safeBase.getMonth(), 1);
  const endDate = new Date(safeBase.getFullYear(), safeBase.getMonth() + 1, 0);
  return [localDateKey(startDate), localDateKey(endDate)];
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
      toast(t("adminPermissionExpired"));
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
  return localDateKey(date);
}

function compactLocalEvidence(evidence = []) {
  return (Array.isArray(evidence) ? evidence : []).map((item) => ({
    ...item,
    url: typeof item.url === "string" && item.url.startsWith("data:") ? "" : item.url
  }));
}

function compactJobForLocalStorage(job = {}) {
  return {
    ...job,
    evidence: compactLocalEvidence(job.evidence),
    clientSignature: typeof job.clientSignature === "string" && job.clientSignature.length > 5000 ? "" : job.clientSignature,
    siteSignature: typeof job.siteSignature === "string" && job.siteSignature.length > 5000 ? "" : job.siteSignature
  };
}

function compactReceiptForLocalStorage(receipt = {}) {
  return {
    ...receipt,
    signature: typeof receipt.signature === "string" && receipt.signature.length > 5000 ? "" : receipt.signature
  };
}

function setLocalStorageValue(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (error) {
    console.warn(`Local cache skipped for ${key}:`, error);
    return false;
  }
}

function setLocalStorageJson(key, value, fallbackValue = null) {
  const saved = setLocalStorageValue(key, JSON.stringify(value));
  if (saved || fallbackValue === null) return saved;
  return setLocalStorageValue(key, JSON.stringify(fallbackValue));
}

function saveLocalState() {
  setLocalStorageValue("jobvisto-mode", state.mode);
  setLocalStorageValue("jobvisto-country", state.country);
  setLocalStorageValue("jobvisto-language", state.language);
  setLocalStorageJson("jobvisto-clients", state.clients, []);
  setLocalStorageJson("jobvisto-cleaners", state.cleaners, []);
  setLocalStorageJson("jobvisto-jobs", (state.jobs || []).map(compactJobForLocalStorage), []);
  setLocalStorageJson("jobvisto-receipts", (state.receipts || []).map(compactReceiptForLocalStorage), []);
  setLocalStorageJson("jobvisto-client-payments", state.clientPayments || [], []);
  setLocalStorageJson("jobvisto-service-rules", state.serviceRules, {});
  setLocalStorageJson("jobvisto-client-price-rules", state.clientPriceRules, []);
  setLocalStorageJson("jobvisto-cost-rules", state.costRules, {});
  setLocalStorageJson("jobvisto-company-profile", state.companyProfile, {});
  setLocalStorageValue("jobvisto-vat-rate", String(state.vatRate));
  setLocalStorageValue("jobvisto-currency-symbol", state.currencySymbol);
}

function save() {
  saveLocalState();
  if (supabaseClient && state.orgId && state.user) {
    asyncSaveToSupabase().catch((error) => console.error("Background Supabase save failed:", error));
  }
}

async function saveAndSyncCritical() {
  saveLocalState();
  if (supabaseClient && state.orgId && state.user) {
    await asyncSaveToSupabase();
  }
}

function jobPaymentBackupRows() {
  return (state.jobs || []).map(job => ({
    id: job.id,
    clientPaidAmount: Number(job.clientPaidAmount || 0),
    clientPaymentStatus: job.clientPaymentStatus || "unpaid",
    clientPaidDate: job.clientPaidDate || "",
    clientPaymentMethod: job.clientPaymentMethod || ""
  }));
}

async function upsertOrganizationSetting(key, value) {
  if (!supabaseClient || !state.orgId || !state.user) return false;
  const row = {
    organization_id: state.orgId,
    key,
    value
  };
  const { error } = await supabaseClient.from("organization_settings").upsert(row, { onConflict: "organization_id,key" });
  if (!error) return true;

  console.warn(`Setting upsert failed for ${key}; trying update/insert fallback:`, error);
  const { data: existing, error: lookupError } = await supabaseClient
    .from("organization_settings")
    .select("id")
    .eq("organization_id", state.orgId)
    .eq("key", key)
    .limit(1)
    .maybeSingle();

  if (lookupError) throw error;

  if (existing?.id) {
    const { error: updateError } = await supabaseClient
      .from("organization_settings")
      .update({ value })
      .eq("id", existing.id);
    if (updateError) throw updateError;
    return true;
  }

  const { error: insertError } = await supabaseClient.from("organization_settings").insert(row);
  if (insertError) throw insertError;
  return true;
}

function shouldUseServerPaymentPersistence() {
  const host = window.location.hostname;
  return host && host !== "localhost" && host !== "127.0.0.1";
}

async function currentSupabaseAccessToken() {
  if (!supabaseClient?.auth?.getSession) return "";
  try {
    const { data, error } = await supabaseClient.auth.getSession();
    if (error) {
      console.warn("No active Supabase session token for server save:", error);
      return "";
    }
    return data?.session?.access_token || "";
  } catch (error) {
    console.warn("Could not read Supabase session token for server save:", error);
    return "";
  }
}

async function persistPaymentThroughServer(payload) {
  const token = await currentSupabaseAccessToken();
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch("/api/app-payment", {
    method: "POST",
    headers,
    body: JSON.stringify({
      organizationId: payload.organizationId || state.orgId,
      ...payload
    })
  });

  const text = await response.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }

  if (!response.ok || data?.ok === false) {
    throw new Error(data?.error || "No se pudo guardar el pago en el servidor.");
  }
  if (Array.isArray(data?.warnings) && data.warnings.length) {
    console.warn("Payment saved with fallback warnings:", data.warnings);
  }
  return data;
}

async function persistCleanerPaymentCritical(receipt) {
  saveLocalState();
  if (!supabaseClient || !state.orgId || !state.user) return;
  ensureValidUuids();
  saveLocalState();

  const [start, end] = receiptPeriodDates(receipt.period, receipt.createdAt || receipt.date);
  const cleanerRecord = activeCleaners().find((cleaner) =>
    cleaner.id === receipt.cleanerId || normalizeKey(cleaner.name) === normalizeKey(receipt.cleaner)
  );
  const cleanerId = receipt.cleanerId || cleanerRecord?.id || null;
  if (!cleanerId) throw new Error("No se encontro el cleaner activo para registrar el pago.");

  if (shouldUseServerPaymentPersistence()) {
    try {
      await persistPaymentThroughServer({
        type: "cleaner_payment",
        receipt: { ...receipt, cleanerId },
        backups: { receipts: state.receipts || [] }
      });
      return;
    } catch (error) {
      console.warn("Server cleaner payment persistence failed; falling back to browser persistence:", error);
    }
  }

  let backupSaved = false;
  let receiptSaved = false;
  let lastError = null;

  try {
    backupSaved = await upsertOrganizationSetting("payment_receipts_backup", { receipts: state.receipts || [] });
  } catch (error) {
    lastError = error;
    console.warn("Cleaner payment backup setting failed:", error);
  }

  try {
    const { error: receiptError } = await supabaseClient.from("payment_receipts").upsert({
      id: receipt.id,
      organization_id: state.orgId,
      cleaner_id: cleanerId,
      period_start: start,
      period_end: end,
      amount: Number(receipt.amount || 0),
      payment_method: receipt.method === "Efectivo" ? "cash" : "transfer",
      receiver_name: receipt.receiver || receipt.cleaner || null,
      receiver_signature_data: receipt.signature || null,
      job_ids: receipt.jobIds || [],
      status: receipt.status === "signed" ? "signed" : "draft"
    });
    if (receiptError) throw receiptError;
    receiptSaved = true;
  } catch (error) {
    lastError = error;
    console.warn("Cleaner payment primary table failed; keeping backup setting:", error);
  }

  if (!backupSaved && !receiptSaved) {
    throw lastError || new Error("No se pudo guardar el pago al cleaner.");
  }
}

async function persistClientPaymentCritical(payment, jobIds = []) {
  saveLocalState();
  if (!supabaseClient || !state.orgId || !state.user) return;
  ensureValidUuids();
  saveLocalState();

  const jobsBackup = jobPaymentBackupRows();

  if (shouldUseServerPaymentPersistence()) {
    try {
      await persistPaymentThroughServer({
        type: "client_payment",
        payment: { ...payment, jobIds },
        backups: {
          clientPayments: state.clientPayments || [],
          jobs: jobsBackup
        }
      });
      return;
    } catch (error) {
      console.warn("Server client payment persistence failed; falling back to browser persistence:", error);
    }
  }

  const jobsToPersist = (state.jobs || []).filter(job => jobIds.includes(job.id));
  let clientBackupSaved = false;
  let jobBackupSaved = false;
  let receiptSaved = false;
  let anyJobStatusSaved = false;
  let lastError = null;

  try {
    clientBackupSaved = await upsertOrganizationSetting("client_payment_receipts_backup", { payments: state.clientPayments || [] });
  } catch (error) {
    lastError = error;
    console.warn("Client payment backup setting failed:", error);
  }

  try {
    jobBackupSaved = await upsertOrganizationSetting("jobs_payment_state_backup", { jobs: jobsBackup });
  } catch (error) {
    lastError = error;
    console.warn("Job payment backup setting failed:", error);
  }

  for (const job of jobsToPersist) {
    try {
      const { error: jobPaymentError } = await supabaseClient
        .from("jobs")
        .update({
          client_paid_amount: Number(job.clientPaidAmount || 0),
          client_payment_status: job.clientPaymentStatus || "unpaid",
          client_paid_date: job.clientPaidDate || null,
          client_payment_method: job.clientPaymentMethod || null
        })
        .eq("id", job.id)
        .eq("organization_id", state.orgId);
      if (jobPaymentError) throw jobPaymentError;
      anyJobStatusSaved = true;
    } catch (error) {
      lastError = error;
      console.warn("Client payment job status failed; keeping backup setting:", error);
    }
  }

  try {
    const { error: receiptError } = await supabaseClient.from("client_payment_receipts").upsert({
      id: payment.id,
      organization_id: state.orgId,
      client_id: payment.clientId,
      client_name: payment.clientName || null,
      amount_received: Number(payment.amountReceived || 0),
      discount: Number(payment.discount || 0),
      subtotal: Number(payment.subtotal || 0),
      balance_after: Number(payment.balanceAfter || 0),
      payment_method: payment.method || "Efectivo",
      job_ids: payment.jobIds || [],
      paid_at: payment.createdAt || new Date().toISOString()
    });
    if (receiptError) throw receiptError;
    receiptSaved = true;
  } catch (error) {
    lastError = error;
    console.warn("Client payment primary table failed; keeping backup setting:", error);
  }

  if (!clientBackupSaved && !jobBackupSaved && !receiptSaved && !anyJobStatusSaved) {
    throw lastError || new Error("No se pudo guardar el cobro del cliente.");
  }
}

function recalculateClientPaymentJobs(extraJobIds = []) {
  const paidJobIds = new Set(extraJobIds);
  (state.clientPayments || []).forEach(payment => {
    (payment.jobIds || []).forEach(jobId => paidJobIds.add(jobId));
  });
  (state.jobs || []).forEach(job => {
    if (!paidJobIds.has(job.id)) return;
    job.clientPaidAmount = 0;
    job.clientPaymentStatus = "unpaid";
    job.clientPaidDate = "";
    job.clientPaymentMethod = "";
  });

  const payments = [...(state.clientPayments || [])].sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
  payments.forEach(payment => {
    let remainingToCover = roundMoney(Number(payment.amountReceived || 0) + Number(payment.discount || 0));
    (payment.jobIds || []).forEach(jobId => {
      if (remainingToCover <= 0) return;
      const job = (state.jobs || []).find(item => item.id === jobId);
      if (!job) return;
      const jobCost = roundMoney(estimateJob(job));
      const alreadyPaid = roundMoney(parseMoneyInput(job.clientPaidAmount));
      const owe = Math.max(0, roundMoney(jobCost - alreadyPaid));
      if (owe <= 0) return;

      const applied = Math.min(remainingToCover, owe);
      job.clientPaidAmount = roundMoney(alreadyPaid + applied);
      job.clientPaymentStatus = job.clientPaidAmount >= jobCost ? "paid" : "partial";
      job.clientPaidDate = payment.createdAt ? String(payment.createdAt).slice(0, 10) : today();
      job.clientPaymentMethod = payment.method || "";
      remainingToCover = roundMoney(remainingToCover - applied);
    });
  });
}

async function persistClientPaymentVoidCritical(paymentId, affectedJobIds = []) {
  saveLocalState();
  if (!supabaseClient || !state.orgId || !state.user) return;
  ensureValidUuids();
  saveLocalState();

  const jobsBackup = jobPaymentBackupRows();

  if (shouldUseServerPaymentPersistence()) {
    try {
      await persistPaymentThroughServer({
        type: "client_payment_void",
        paymentId,
        affectedJobIds,
        backups: {
          clientPayments: state.clientPayments || [],
          jobs: jobsBackup
        }
      });
      return;
    } catch (error) {
      console.warn("Server client payment void failed; falling back to browser persistence:", error);
    }
  }

  const jobIds = new Set(affectedJobIds);
  const jobsToPersist = (state.jobs || []).filter(job => jobIds.has(job.id));
  let clientBackupSaved = false;
  let jobBackupSaved = false;
  let receiptDeleted = false;
  let anyJobStatusSaved = false;
  let lastError = null;

  try {
    clientBackupSaved = await upsertOrganizationSetting("client_payment_receipts_backup", { payments: state.clientPayments || [] });
  } catch (error) {
    lastError = error;
    console.warn("Client payment backup setting failed after void:", error);
  }

  try {
    jobBackupSaved = await upsertOrganizationSetting("jobs_payment_state_backup", { jobs: jobsBackup });
  } catch (error) {
    lastError = error;
    console.warn("Job payment backup setting failed after void:", error);
  }

  for (const job of jobsToPersist) {
    try {
      const { error: jobPaymentError } = await supabaseClient
        .from("jobs")
        .update({
          client_paid_amount: Number(job.clientPaidAmount || 0),
          client_payment_status: job.clientPaymentStatus || "unpaid",
          client_paid_date: job.clientPaidDate || null,
          client_payment_method: job.clientPaymentMethod || null
        })
        .eq("id", job.id)
        .eq("organization_id", state.orgId);
      if (jobPaymentError) throw jobPaymentError;
      anyJobStatusSaved = true;
    } catch (error) {
      lastError = error;
      console.warn("Client payment job status void failed; keeping backup setting:", error);
    }
  }

  try {
    const { error: receiptError } = await supabaseClient
      .from("client_payment_receipts")
      .delete()
      .eq("id", paymentId)
      .eq("organization_id", state.orgId);
    if (receiptError) throw receiptError;
    receiptDeleted = true;
  } catch (error) {
    lastError = error;
    console.warn("Client payment receipt delete failed; keeping backup setting:", error);
  }

  if (!clientBackupSaved && !jobBackupSaved && !receiptDeleted && !anyJobStatusSaved) {
    throw lastError || new Error("No se pudo anular el cobro del cliente.");
  }
}

async function executeVoidClientPayment(paymentId) {
  const payment = (state.clientPayments || []).find(item => item.id === paymentId);
  if (!payment) {
    toast("No se encontro el cobro.");
    return;
  }

  const previousJobs = structuredClone(state.jobs || []);
  const previousClientPayments = structuredClone(state.clientPayments || []);
  const affectedJobIds = [...new Set(payment.jobIds || [])];

  state.clientPayments = (state.clientPayments || []).filter(item => item.id !== paymentId);
  recalculateClientPaymentJobs(affectedJobIds);

  try {
    await persistClientPaymentVoidCritical(paymentId, affectedJobIds);
    renderAll();
    toast("Cobro anulado. Balance del cliente actualizado.");
  } catch (error) {
    console.error("Error voiding client payment:", error);
    state.jobs = previousJobs;
    state.clientPayments = previousClientPayments;
    saveLocalState();
    renderAll();
    toast("No se pudo anular el cobro. Intentalo nuevamente.");
  }
}

function openVoidClientPaymentModal(paymentId) {
  const payment = (state.clientPayments || []).find(item => item.id === paymentId);
  if (!payment) {
    toast("No se encontro el cobro.");
    return;
  }
  const client = state.clients.find(item => item.id === payment.clientId);
  pendingVoidClientPaymentId = paymentId;
  $("#voidClientPaymentSummary").innerHTML = `
    <strong>${escapeHtml(payment.clientName || client?.name || "Cliente")} - ${money(payment.amountReceived || 0)}</strong>
    <span>${escapeHtml(payment.method || "Efectivo")} - ${escapeHtml(payment.date || "")}</span>
    <span>${payment.jobIds?.length || 0} trabajo${payment.jobIds?.length === 1 ? "" : "s"} incluido${payment.jobIds?.length === 1 ? "" : "s"}</span>
  `;
  $("#voidClientPaymentModal").classList.remove("hidden");
}

function closeVoidClientPaymentModal() {
  pendingVoidClientPaymentId = null;
  $("#voidClientPaymentModal").classList.add("hidden");
}

async function confirmVoidClientPayment() {
  const paymentId = pendingVoidClientPaymentId;
  closeVoidClientPaymentModal();
  if (!paymentId) return;
  await executeVoidClientPayment(paymentId);
}

function voidClientPayment(paymentId) {
  openVoidClientPaymentModal(paymentId);
}
window.voidClientPayment = voidClientPayment;

function clientFor(job) {
  return state.clients.find((client) => client.id === job.clientId) || state.clients[0];
}

function recordStatusKey(value) {
  return String(value || "").trim().toLowerCase();
}

function isArchivedRecord(record = {}) {
  const status = recordStatusKey(record.status || record.state || record.lifecycle);
  return Boolean(
    record.archived ||
    record.isArchived ||
    record.is_archived ||
    record.archivedAt ||
    record.archived_at ||
    record.deleted ||
    record.isDeleted ||
    record.is_deleted ||
    record.deletedAt ||
    record.deleted_at ||
    ["archived", "archive", "archivado", "deleted", "eliminado", "inactive", "inactivo"].includes(status)
  );
}

function activeClients() {
  return state.clients.filter((client) => !isArchivedRecord(client));
}

function archivedClients() {
  return state.clients.filter((client) => isArchivedRecord(client));
}

function activeCleaners() {
  return state.cleaners.filter((cleaner) => !isArchivedRecord(cleaner));
}

function archivedCleaners() {
  return state.cleaners.filter((cleaner) => isArchivedRecord(cleaner));
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
  const normalizeName = (value) => String(value || "").trim().toLowerCase();
  const activeCleanerList = activeCleaners();
  const activeCleanerIds = new Set(activeCleanerList.map((cleaner) => cleaner.id).filter(Boolean));
  const activeCleanerNames = new Set(activeCleanerList.map((cleaner) => normalizeName(cleaner.name)));
  state.costRules.specialRules = state.costRules.specialRules.filter((rule) => {
    if (rule.cleanerId) return activeCleanerIds.has(rule.cleanerId);
    return activeCleanerNames.has(normalizeName(rule.cleanerName));
  });
  if (state.costRules.specialCleaner && !activeCleanerNames.has(normalizeName(state.costRules.specialCleaner))) {
    state.costRules.specialCleaner = "";
    state.costRules.specialCleanerRate = 0;
  }
  const firstSpecialRule = state.costRules.specialRules[0];
  if (!firstSpecialRule) {
    state.costRules.specialCleaner = "";
    state.costRules.specialCleanerRate = 0;
  } else if (!state.costRules.specialCleaner) {
    state.costRules.specialCleaner = firstSpecialRule.cleanerName || "";
    state.costRules.specialCleanerRate = Number(firstSpecialRule.rate || 0);
  }
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

function parseMoneyInput(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const normalized = String(value || "")
    .replace(/[^\d,.-]/g, "")
    .replace(",", ".");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function syncCurrencyBadges() {
  $$(".pf-currency-badge").forEach((badge) => {
    badge.textContent = state.currencySymbol || "$";
  });
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
  let key = String(value || "").trim();
  const labelMatch = key.match(/(?:clave|key):\s*([A-Za-z0-9-]+)/i);
  if (labelMatch) key = labelMatch[1];
  return key.trim().toUpperCase();
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

function mapsUrlForLocation(location) {
  if (!location || !Number.isFinite(Number(location.lat)) || !Number.isFinite(Number(location.lng))) return "";
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${location.lat},${location.lng}`)}`;
}

function normalizePhoneForWhatsApp(phone) {
  const digits = String(phone || "").replace(/[^\d]/g, "");
  if (!digits) return "";
  return digits.startsWith("0") && state.country === "IL" ? `972${digits.slice(1)}` : digits;
}

function whatsAppUrl(phone, message) {
  const normalized = normalizePhoneForWhatsApp(phone);
  if (!normalized) return "";
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}

function cleanerLocationFromJobRow(row) {
  if (!row || row.cleaner_lat === null || row.cleaner_lat === undefined || row.cleaner_lng === null || row.cleaner_lng === undefined) return null;
  return {
    lat: Number(row.cleaner_lat),
    lng: Number(row.cleaner_lng),
    accuracy: row.cleaner_location_accuracy ? Number(row.cleaner_location_accuracy) : null,
    at: row.cleaner_location_at || row.updated_at || ""
  };
}

function cleanerLocationPayload(location) {
  if (!location) {
    return {
      cleaner_lat: null,
      cleaner_lng: null,
      cleaner_location_accuracy: null,
      cleaner_location_at: null
    };
  }
  return {
    cleaner_lat: Number(location.lat),
    cleaner_lng: Number(location.lng),
    cleaner_location_accuracy: location.accuracy ? Number(location.accuracy) : null,
    cleaner_location_at: location.at || new Date().toISOString()
  };
}

function captureCleanerLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
          at: new Date().toISOString()
        });
      },
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  });
}

function cleanerLocationLinksHtml(job, client = null) {
  const mapsUrl = mapsUrlForLocation(job?.cleanerLocation);
  if (!mapsUrl) return "";
  const message = t("cleanerLocationMessage")
    .replace("{client}", client?.name || t("clientLabel"))
    .replace("{date}", job.date || "")
    .replace("{url}", mapsUrl);
  const waUrl = client ? whatsAppUrl(client.phone, message) : "";
  return `
    <div class="location-actions">
      <a class="mini-action" href="${mapsUrl}" target="_blank" rel="noopener">${t("openLocationMaps")}</a>
      ${waUrl ? `<a class="mini-action" href="${waUrl}" target="_blank" rel="noopener">${t("sendLocationWhatsapp")}</a>` : ""}
    </div>
  `;
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
  return client.portalPasscode || `JV-${client.name.slice(0, 3).toUpperCase()}-${client.id.slice(-2)}`;
}

function clientPortalKeyPrefix(key) {
  const parts = normalizeKey(key).split("-").filter(Boolean);
  return parts.length >= 2 ? `${parts[0]}-${parts[1]}` : "";
}

function clientPortalKeyMatches(client, key) {
  const accessKey = normalizeKey(key);
  const expected = normalizeKey(clientPortalPassword(client));
  return expected === accessKey;
}

function cleanerPortalPassword(cleaner) {
  const fallbackName = String(cleaner?.name || "CLEANER").trim().split(/\s+/)[0] || "CLEANER";
  return cleaner?.key || `JV-${fallbackName.slice(0, 10).toUpperCase()}`;
}

function ensureCleanerPortalKey(cleaner) {
  if (!cleaner) return "";
  if (!String(cleaner.key || "").trim()) {
    cleaner.key = generateCleanerPasscode(cleaner.name || "Cleaner");
  }
  return cleaner.key;
}

function cleanerPortalDisplayKey(cleaner) {
  ensureCleanerPortalKey(cleaner);
  return cleanerPortalPassword(cleaner).trim();
}

function localClientPortalUrl(client) {
  if (state.companyProfile && state.companyProfile.portalUrl) {
    let customUrl = state.companyProfile.portalUrl.trim();
    if (customUrl) {
      if (!/^https?:\/\//i.test(customUrl)) {
        customUrl = 'https://' + customUrl;
      }
      return `${customUrl.replace(/\/$/, "").replace(/\/portal-clientes\.html$/i, "")}/portal-clientes.html?id=${encodeURIComponent(client.id)}&clave=${encodeURIComponent(clientPortalPassword(client))}`;
    }
  }
  const basePath = location.pathname.replace(/\/[^/]*$/, "");
  return `${location.origin}${basePath}/portal-clientes.html?id=${encodeURIComponent(client.id)}&clave=${encodeURIComponent(clientPortalPassword(client))}`;
}

function localCleanerPortalUrl(cleaner) {
  const cleanKey = cleanerPortalDisplayKey(cleaner);
  if (state.companyProfile && state.companyProfile.portalUrl) {
    let customUrl = state.companyProfile.portalUrl.trim();
    if (customUrl) {
      if (!/^https?:\/\//i.test(customUrl)) {
        customUrl = 'https://' + customUrl;
      }
      return `${customUrl.replace(/\/$/, "").replace(/\/portal-cleaners\.html$/i, "")}/portal-cleaners.html?id=${encodeURIComponent(cleaner.id)}&clave=${encodeURIComponent(cleanKey)}`;
    }
  }
  const basePath = location.pathname.replace(/\/[^/]*$/, "");
  return `${location.origin}${basePath}/portal-cleaners.html?id=${encodeURIComponent(cleaner.id)}&clave=${encodeURIComponent(cleanKey)}`;
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
    "Programado": { en: "Scheduled", es: "Programado", ru: "Запланировано" },
    "Asignado": { en: "Assigned", es: "Asignado", ru: "Назначено" },
    "Disponible para tomar": { en: "Available to take", es: "Disponible para tomar", ru: "Доступно для принятия" },
    "En progreso": { en: "In progress", es: "En progreso", ru: "В процессе" },
    "En sitio": { en: "On site", es: "En sitio", ru: "На месте" },
    "En sitio vencido": { en: "On-site overdue", es: "En sitio vencido", ru: "На месте, просрочено" },
    "Vencido / no iniciado": { en: "Overdue / not started", es: "Vencido / no iniciado", ru: "Просрочено / не начато" },
    "Terminado": { en: "Finished", es: "Terminado", ru: "Завершено" },
    "Terminado por cleaner": { en: "Finished by cleaner", es: "Terminado por limpiador", ru: "Завершено клинером" },
    "Terminado por limpiador": { en: "Finished by cleaner", es: "Terminado por limpiador", ru: "Завершено клинером" },
    "Terminado por cliente": { en: "Finished by client", es: "Terminado por cliente", ru: "Завершено клиентом" },
    "Confirmado por cliente": { en: "Finished by client", es: "Terminado por cliente", ru: "Завершено клиентом" },
    "Terminado por administrador": { en: "Finished by administrator", es: "Terminado por administrador", ru: "Завершено администратором" },
    "Firmado": { en: "Signed", es: "Firmado", ru: "Подписано" },
    "Pagado": { en: "Paid", es: "Pagado", ru: "Оплачено" },
    "Cancelado": { en: "Cancelled", es: "Cancelado", ru: "Отменено" },
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
  let status = payload.status || (payload.cleanerId ? "Asignado" : "Disponible para tomar");
  if (payload.cleanerId && (status === "Disponible para tomar" || status === "Programado")) {
    status = "Asignado";
  }
  if (!payload.cleanerId && status === "Asignado") {
    status = "Disponible para tomar";
  }
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

  if (status === "Terminado por cleaner" || status === "Terminado por limpiador") {
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
  return Boolean(job.checkedOut || job.cleanerFinished || job.signed || job.status === "Pagado" || job.status === "Terminado por cleaner" || job.status === "Terminado por limpiador" || job.status === "Confirmado por cliente" || job.status === "Terminado por cliente" || job.status === "Terminado por administrador");
}

function hasFinalTime(job) {
  return Boolean(job.actualEnd || job.checkedOut || job.cleanerFinished || job.status === "Terminado por administrador" || job.status === "Confirmado por cliente" || job.status === "Terminado por cliente" || job.status === "Pagado");
}

function isBillableDone(job) {
  return Boolean(isDone(job) && hasFinalTime(job));
}

function currentPlanKey() {
  const userPlan = normalizePlanKey(state.user?.plan);
  const selected = normalizePlanKey(selectedPlan);
  if (userPlan) return userPlan;
  if (selected) return selected;
  return state.mode === "company" ? "company" : "free";
}

function currentEntitlements() {
  return PLAN_ENTITLEMENTS[currentPlanKey()] || PLAN_ENTITLEMENTS.free;
}

function isUnlimited(value) {
  return value === Infinity;
}

function limitText(value) {
  return isUnlimited(value) ? "ilimitado" : String(value);
}

function recurringJobsPreview(payload, count, recurrence) {
  const safeCount = Math.max(1, Math.min(24, Number(count || 1)));
  const baseDate = localDateFromKey(payload.date);
  const intervalDays = recurrence === "weekly" ? 7 : recurrence === "biweekly" ? 14 : 0;

  return Array.from({ length: safeCount }, (_, index) => {
    const date = new Date(baseDate);
    if (recurrence === "monthly") date.setMonth(baseDate.getMonth() + index);
    else date.setDate(baseDate.getDate() + (intervalDays * index));
    return localDateKey(date);
  });
}

function planUpgradeMessage(reason) {
  const plan = currentEntitlements().label;
  return `${reason} Tu plan actual es ${plan}. Mejora el plan para desbloquear mas capacidad.`;
}

function canCreateClient(editingId = "") {
  const limit = currentEntitlements().maxClients;
  if (isUnlimited(limit) || editingId) return true;
  return activeClients().length < limit;
}

function canCreateCleaner(editingId = "") {
  const limit = currentEntitlements().maxCleaners;
  if (isUnlimited(limit) || editingId) return true;
  return activeCleaners().length < limit;
}

function canCreateJobs(payload, count, recurrence, editingId = "") {
  const limit = currentEntitlements().maxMonthlyJobs;
  if (isUnlimited(limit) || editingId) return true;
  const existingByMonth = new Map();
  state.jobs
    .filter((job) => job.id !== editingId)
    .forEach((job) => {
      const monthKey = String(job.date || "").slice(0, 7);
      if (!monthKey) return;
      existingByMonth.set(monthKey, (existingByMonth.get(monthKey) || 0) + 1);
    });

  for (const date of recurringJobsPreview(payload, count, recurrence)) {
    const monthKey = date.slice(0, 7);
    existingByMonth.set(monthKey, (existingByMonth.get(monthKey) || 0) + 1);
    if ((existingByMonth.get(monthKey) || 0) > limit) return false;
  }
  return true;
}

function enforcePlanAction(action, details = {}) {
  const entitlements = currentEntitlements();
  if (action === "client" && !canCreateClient(details.editingId)) {
    openPlanChoiceModal("limit", planUpgradeMessage(`El limite de clientes es ${limitText(entitlements.maxClients)}.`));
    return false;
  }
  if (action === "cleaner" && !canCreateCleaner(details.editingId)) {
    openPlanChoiceModal("limit", planUpgradeMessage(`El limite de cleaners es ${limitText(entitlements.maxCleaners)}.`));
    return false;
  }
  if (action === "job" && !canCreateJobs(details.payload, details.count, details.recurrence, details.editingId)) {
    openPlanChoiceModal("limit", planUpgradeMessage(`El limite del plan gratis es ${limitText(entitlements.maxMonthlyJobs)} trabajos por mes.`));
    return false;
  }
  if (action === "cleanerPayments" && !entitlements.cleanerPayments) {
    openPlanChoiceModal("limit", planUpgradeMessage("Los recibos y pagos a limpiadores son una funcion Pro."));
    return false;
  }
  if (action === "advancedReports" && !entitlements.advancedReports) {
    openPlanChoiceModal("limit", planUpgradeMessage("Los reportes avanzados son una funcion Pro."));
    return false;
  }
  return true;
}

function viewAllowedByPlan(name) {
  if (name === "cleaners") return currentEntitlements().cleanerPortal;
  return true;
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
  const byId = state.clients.find((item) => item.id === id);
  if (byId) {
    if (byId.portalActive === false) return null;
    if (!accessKey || normalizeKey(clientPortalPassword(byId)) === accessKey) return byId;
  }
  const byKey = state.clients.find((item) => normalizeKey(clientPortalPassword(item)) === accessKey);
  if (byKey && byKey.portalActive !== false) return byKey;
  if (byId && byId.portalActive !== false) return byId;
  return null;
}

function cleanerFromPortalAccess(id, key) {
  const accessKey = normalizeKey(key);
  const byId = state.cleaners.find((item) => item.id === id);
  if (byId && (!accessKey || normalizeKey(cleanerPortalPassword(byId)) === accessKey || portalCleanerAdmin)) return byId;
  return state.cleaners.find((item) => normalizeKey(cleanerPortalPassword(item)) === accessKey) || byId;
}

function cleanerPortalPendingCount(cleaner) {
  const jobs = portalCleanerAdmin ? state.jobs.filter((job) => job.cleanerId) : state.jobs.filter((job) => job.cleanerId === cleaner?.id);
  return jobs.filter((job) => !job.checkedOut && !job.cleanerFinished).length;
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
        const badgeLabel = isCurrent ? jobStatusLabel(job) : localizedJobStatus("Terminado por limpiador");
        const hasPayableAmount = hasRealBillingTimes(job);
        const dateLocale = state.language === "ru" ? "ru-RU" : state.language === "en" ? "en-US" : "es-ES";
        const formattedDate = new Date(job.date + 'T00:00:00').toLocaleDateString(dateLocale, { day: '2-digit', month: 'short', year: 'numeric' });
        
        return `
          <div class="cp-history-item-new ${isCurrent ? 'current' : 'past'}">
            <div class="cp-history-header-row">
              <strong>${formattedDate} &bull; ${isCurrent ? t("upcomingService") : escapeHtml(client.name)}</strong>
              <span class="cp-job-status-badge ${badgeClass}" style="padding: 2px 8px; border-radius: 99px;">${badgeLabel}</span>
            </div>
            <div class="cp-history-details-row">
              <span class="cp-history-detail-line">${escapeHtml(job.serviceType)} &bull; ${job.start}-${job.actualEnd || job.end || '-'}</span>
              ${!isCurrent ? `
                <span class="cp-history-sub-line">${evidenceCount(job)} ${evidenceCount(job) === 1 ? t("photoSingular") : t("photoPlural")} &bull; ${job.clientConfirmed ? t("confirmedByClient") : t("noClientConfirmation")} &bull; ${hasPayableAmount ? money(estimateJob(job)) : localText("amountPendingLower")}</span>
              ` : `
                <span class="cp-history-sub-line">${t("statusLabel")}: ${jobStatusLabel(job)}</span>
              `}
            </div>
            <button class="text-link cp-history-expand-btn" type="button" onclick="toggleHistoryJobDetails('${job.id}')">
              ${t("viewDetails")}
            </button>
            <div class="cp-history-job-expanded hidden" id="history-details-${job.id}">
              ${evidenceCount(job) ? photoBoardHtml(job, true) : `<p class="muted" style="margin: 8px 0 0 16px; font-size: 0.8rem;">${t("noEvidenceLoaded")}</p>`}
              ${!isCurrent ? `
                <div class="cp-history-review-section" style="margin-top: 16px; padding-top: 16px; border-top: 1px solid #e2ebe4; text-align: left;">
                  ${job.clientRating ? `
                    <div style="background: #fffcf5; border: 1px solid #f4e3c1; border-radius: 8px; padding: 12px; margin-top: 8px;">
                      <div style="color: var(--gold); font-size: 1.1rem; margin-bottom: 4px;">
                        ${"★".repeat(job.clientRating)}${"☆".repeat(5 - job.clientRating)}
                      </div>
                      <p style="margin: 0; font-size: 0.85rem; color: #557067; font-style: italic;">"${escapeHtml(job.clientReviewText || t("noComment"))}"</p>
                      ${cleanerFeedbackPromptHtml(job)}
                    </div>
                  ` : `
                    <div style="background: #f8faf9; border: 1px solid #dce6e2; border-radius: 8px; padding: 12px; margin-top: 8px;" id="historyReviewForm_${job.id}">
                      <strong style="font-size: 0.85rem; color: #07302d; display: block; margin-bottom: 6px;">${t("rateThisService")}</strong>
                      <form onsubmit="submitClientReview(event, '${job.id}')" style="display: flex; flex-direction: column; gap: 8px;">
                        <div class="star-rating-input" style="font-size: 1.8rem; color: #ccc; cursor: pointer; display: flex; gap: 6px; justify-content: flex-start;">
                          <span onclick="setReviewRating('${job.id}', 1)" id="star_${job.id}_1" style="transition: color 0.2s;">★</span>
                          <span onclick="setReviewRating('${job.id}', 2)" id="star_${job.id}_2" style="transition: color 0.2s;">★</span>
                          <span onclick="setReviewRating('${job.id}', 3)" id="star_${job.id}_3" style="transition: color 0.2s;">★</span>
                          <span onclick="setReviewRating('${job.id}', 4)" id="star_${job.id}_4" style="transition: color 0.2s;">★</span>
                          <span onclick="setReviewRating('${job.id}', 5)" id="star_${job.id}_5" style="transition: color 0.2s;">★</span>
                        </div>
                        <input type="hidden" name="rating" id="reviewRating_${job.id}" value="0" required>
                        <textarea name="reviewText" placeholder="${t("reviewPlaceholder")}" rows="2" style="width: 100%; border-radius: 6px; border: 1px solid var(--border-color); padding: 8px; font-size: 0.8rem; font-family: inherit; resize: vertical;"></textarea>
                        <button type="submit" class="primary" style="background: #35d17f; border: none; color: #07302d; font-size: 0.8rem; font-weight: bold; padding: 6px 12px; border-radius: 6px; align-self: flex-start; margin-top: 4px; cursor: pointer;">${t("sendRating")}</button>
                      </form>
                    </div>
                  `}
                </div>
              ` : ''}
            </div>
          </div>
        `;
      }).join("")}
    </div>
    <div style="margin-top: 16px; text-align: center;">
      <button class="ghost" type="button" style="font-size: 0.85rem; font-weight: 600; padding: 8px 16px; border-radius: 8px; border: 1px solid #e2ebe4; color: #07302d;" onclick="toast(t('showingFullHistory'))">
        ${t("viewAllServices")}
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
  open: { label: "Abierto", helper: "Disponible para que un limpiador lo tome.", className: "teal" },
  cleanerDone: { label: "Terminado por limpiador", helper: "Falta confirmacion final del cliente o admin.", className: "dark" },
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
      es: "Disponible para que un limpiador lo tome.",
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
  if (job.status === "Terminado por cleaner" || job.status === "Terminado por limpiador" || job.cleanerFinished || job.checkedOut) return "cleanerDone";
  if (job.date < today() && !job.checkedIn) return "expired";
  if (!job.cleanerId || job.status === "Disponible para tomar") return "open";
  return "assigned";
}

function jobsByCategory(jobs = state.jobs) {
  const order = ["overdueLive", "live", "expired", "assigned", "open", "cleanerDone", "clientDone", "adminDone"];
  return order.map((key) => ({
    key,
    config: localizedJobCategory(key),
    jobs: jobs.filter((job) => jobCategoryKey(job) === key)
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

function dataUrlByteSize(dataUrl) {
  const base64 = String(dataUrl || "").split(",")[1] || "";
  return Math.round((base64.length * 3) / 4);
}

async function compressImageFile(file, maxSize = 1024, quality = 0.68, targetBytes = 180 * 1024) {
  const original = await readFileAsDataUrl(file);
  if (!file.type.startsWith("image/")) return original;
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      let size = maxSize;
      let output = original;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const scale = Math.min(1, size / Math.max(image.width, image.height));
        const width = Math.max(1, Math.round(image.width * scale));
        const height = Math.max(1, Math.round(image.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        context.fillStyle = "#fff";
        context.fillRect(0, 0, width, height);
        context.drawImage(image, 0, 0, width, height);
        for (let q = quality; q >= 0.42; q -= 0.1) {
          output = canvas.toDataURL("image/jpeg", q);
          if (dataUrlByteSize(output) <= targetBytes) {
            resolve(output);
            return;
          }
        }
        size = Math.round(size * 0.72);
      }
      resolve(output);
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

function parsedClientAccess(params = new URLSearchParams(location.search)) {
  const rawId = decodeURIComponent(params.get("id") || "");
  const id = rawId.split(/\s+(clave|key):/i)[0].trim();
  const embeddedKey = rawId.match(/(?:clave|key):\s*([A-Z0-9-]+)/i)?.[1] || "";
  const key = params.get("clave") || params.get("key") || embeddedKey;
  return { id, key: normalizeKey(key) };
}

function portalPageVisible(selector) {
  const node = $(selector);
  return Boolean(node && !node.classList.contains("hidden") && node.style.display !== "none");
}

function cleanerPortalCredentials() {
  const access = parsedCleanerAccess();
  return {
    cleanerId: portalCleanerId || access.id,
    cleanerKey: normalizeKey($("#cleanerPortalPassword")?.value || access.key)
  };
}

function clientPortalCredentials() {
  const access = parsedClientAccess();
  return {
    clientId: portalClientId || access.id,
    clientKey: normalizeKey($("#clientPortalPassword")?.value || access.key)
  };
}

async function persistPortalEvidence(job, evidence) {
  if (!supabaseClient) return;
  const dbPhase = evidence.phase === "Antes" ? "before" : "after";
  let filePath = evidence.url;
  if (String(evidence.url || "").startsWith("data:")) {
    const extension = String(evidence.fileName || "photo.jpg").split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
    const storagePath = `${job.organizationId || state.orgId}/${job.id}/${evidence.id}.${extension === "jpeg" ? "jpg" : extension}`;
    const blob = await fetch(evidence.url).then((response) => response.blob());
    const { error: uploadError } = await supabaseClient.storage
      .from("job-evidence")
      .upload(storagePath, blob, {
        contentType: blob.type || "image/jpeg",
        upsert: true
      });
    if (uploadError) throw uploadError;
    const { data: signedData, error: signedError } = await supabaseClient.storage
      .from("job-evidence")
      .createSignedUrl(storagePath, 60 * 60 * 24 * 30);
    if (signedError) throw signedError;
    filePath = signedData?.signedUrl || storagePath;
    evidence.url = filePath;
  }
  if (portalPageVisible("#cleanerPortalPage") && !portalCleanerAdmin) {
    const { cleanerId, cleanerKey } = cleanerPortalCredentials();
    const { error } = await supabaseClient.rpc("portal_cleaner_save_evidence", {
      cleaner_id: cleanerId,
      cleaner_key: cleanerKey,
      evidence_id: evidence.id,
      job_id: job.id,
      p_area: evidence.section || "General",
      p_phase: dbPhase,
      p_file_path: filePath,
      p_caption: evidence.comment || ""
    });
    if (error) throw error;
    return;
  }

  const { error } = await supabaseClient.from("job_evidence").upsert({
    id: evidence.id,
    organization_id: job.organizationId || state.orgId,
    job_id: job.id,
    area: evidence.section || "General",
    phase: dbPhase,
    file_path: filePath,
    caption: evidence.comment || ""
  });
  if (error) throw error;
}

async function persistCleanerJobAction(action, job, extra = {}) {
  if (!supabaseClient) return;
  if (portalPageVisible("#cleanerPortalPage") && !portalCleanerAdmin) {
    const { cleanerId, cleanerKey } = cleanerPortalCredentials();
    const rpcMap = {
      take: "portal_cleaner_take_job",
      arrived: "portal_cleaner_mark_arrived",
      finish: "portal_cleaner_finish_job"
    };
    const payload = {
      cleaner_id: cleanerId,
      cleaner_key: cleanerKey,
      job_id: job.id
    };
    if (action === "take") payload.assigned_cleaner_id = extra.assigned_cleaner_id;
    if (action === "arrived") {
      payload.p_actual_start = extra.actual_start;
      payload.p_lat = extra.location?.lat ?? null;
      payload.p_lng = extra.location?.lng ?? null;
      payload.p_accuracy = extra.location?.accuracy ?? null;
      payload.p_location_at = extra.location?.at ?? null;
    }
    if (action === "finish") payload.p_actual_end = extra.actual_end;
    const { error } = await supabaseClient.rpc(rpcMap[action], payload);
    if (error) throw error;
    return;
  }

  if (action === "take") {
    const { error } = await supabaseClient.from("jobs").update({
      assigned_cleaner_id: extra.assigned_cleaner_id,
      status: "assigned"
    }).eq("id", job.id);
    if (error) throw error;
  } else if (action === "arrived") {
    const { error } = await supabaseClient.from("jobs").update({
      status: "in_site",
      actual_start: extra.actual_start,
      ...cleanerLocationPayload(extra.location || job.cleanerLocation)
    }).eq("id", job.id);
    if (error) throw error;
  } else if (action === "finish") {
    const { error } = await supabaseClient.from("jobs").update({
      status: dbStatusFromAppStatus(job.status, job.cleanerId),
      actual_end: extra.actual_end
    }).eq("id", job.id);
    if (error) throw error;
  }
}

async function persistPortalClientConfirmation(job) {
  if (!supabaseClient) return;
  if (portalPageVisible("#clientPortalPage")) {
    const { clientId, clientKey } = clientPortalCredentials();
    const { error } = await supabaseClient.rpc("portal_client_confirm_job", {
      client_id: clientId,
      client_key: clientKey,
      job_id: job.id
    });
    if (error) throw error;
    return;
  }

  await supabaseClient.from("jobs").update({ status: "client_confirmed" }).eq("id", job.id);
  await supabaseClient.from("client_signatures").delete().eq("job_id", job.id).eq("signed_from", "private_link");
  await supabaseClient.from("client_signatures").insert({
    organization_id: job.organizationId || state.orgId,
    job_id: job.id,
    signer_name: "Cliente",
    signature_data: "Confirmado via portal seguro",
    signed_from: "private_link"
  });
}

async function persistPortalClientReview(jobId, rating, text, cleanerFeedback = {}) {
  if (portalPageVisible("#clientPortalPage")) {
    const { clientId, clientKey } = clientPortalCredentials();
    let serverError = null;
    try {
      const response = await fetch("/api/app-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, clientKey, jobId, rating, reviewText: text || "", cleanerFeedback })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result?.ok === false) {
        throw new Error(result?.error || t("reviewSaveError"));
      }
      return;
    } catch (error) {
      serverError = error;
      console.warn("Portal review server save failed; trying RPC fallback:", error);
    }

    if (supabaseClient) {
      const { error } = await supabaseClient.rpc("portal_client_review_job", {
        client_id: clientId,
        client_key: clientKey,
        job_id: jobId,
        p_rating: rating,
        p_review_text: text || "",
        p_cleaner_quality_rating: cleanerFeedback.qualityRating || null,
        p_cleaner_punctuality_rating: cleanerFeedback.punctualityRating || null,
        p_cleaner_professionalism_rating: cleanerFeedback.professionalismRating || null,
        p_cleaner_quality_text: cleanerFeedback.qualityText || "",
        p_cleaner_recommended: typeof cleanerFeedback.recommended === "boolean" ? cleanerFeedback.recommended : null
      });
      if (!error) return;
      throw new Error(error.message || serverError?.message || t("reviewSaveError"));
    }

    throw new Error(serverError?.message || t("reviewSaveError"));
  }

  if (!supabaseClient) return;
  const { error } = await supabaseClient
    .from("jobs")
    .update({
      client_rating: rating,
      client_review_text: text || "",
      cleaner_quality_rating: cleanerFeedback.qualityRating || null,
      cleaner_punctuality_rating: cleanerFeedback.punctualityRating || null,
      cleaner_professionalism_rating: cleanerFeedback.professionalismRating || null,
      cleaner_quality_text: cleanerFeedback.qualityText || null,
      cleaner_recommended: typeof cleanerFeedback.recommended === "boolean" ? cleanerFeedback.recommended : null
    })
    .eq("id", jobId);
  if (error) throw error;
}

async function persistPortalSiteSignature(job) {
  if (!supabaseClient) return;
  if (portalPageVisible("#cleanerPortalPage") && !portalCleanerAdmin) {
    const { cleanerId, cleanerKey } = cleanerPortalCredentials();
    const { error } = await supabaseClient.rpc("portal_cleaner_save_site_signature", {
      cleaner_id: cleanerId,
      cleaner_key: cleanerKey,
      job_id: job.id,
      p_signer_name: job.siteSignerName || "Persona en sitio",
      p_signature_data: job.siteSignature
    });
    if (error) throw error;
    return;
  }

  await supabaseClient.from("client_signatures").delete().eq("job_id", job.id).eq("signed_from", "cleaner_device");
  const { error } = await supabaseClient.from("client_signatures").insert({
    organization_id: job.organizationId || state.orgId,
    job_id: job.id,
    signer_name: job.siteSignerName || "Persona en sitio",
    signature_data: job.siteSignature,
    signed_from: "cleaner_device"
  });
  if (error) throw error;
}

async function persistPortalReceiptSignature(receipt) {
  if (!supabaseClient) return;
  const cleanerId = receipt.cleanerId || state.cleaners.find(c => c.name === receipt.cleaner)?.id;
  if (portalPageVisible("#cleanerPortalPage") && !portalCleanerAdmin) {
    const { cleanerKey } = cleanerPortalCredentials();
    const { error } = await supabaseClient.rpc("portal_cleaner_sign_receipt", {
      cleaner_id: cleanerId,
      cleaner_key: cleanerKey,
      receipt_id: receipt.id,
      p_receiver_name: receipt.receiver || "Cleaner",
      p_signature_data: receipt.signature
    });
    if (error) throw error;
    try {
      await persistPaymentThroughServer({
        organizationId: receipt.organizationId || state.orgId,
        type: "cleaner_payment",
        receipt: { ...receipt, cleanerId },
        backups: { receipts: state.receipts || [] }
      });
    } catch (serverError) {
      console.warn("Receipt signature backup refresh failed after portal signature:", serverError);
    }
    return;
  }

  const [start, end] = receiptPeriodDates(receipt.period, receipt.createdAt || receipt.date);
  const { error } = await supabaseClient.from("payment_receipts").upsert({
    id: receipt.id,
    organization_id: receipt.organizationId || state.orgId,
    cleaner_id: cleanerId || null,
    period_start: start,
    period_end: end,
    amount: receipt.amount,
    payment_method: receipt.method === "Efectivo" ? "cash" : "transfer",
    receiver_name: receipt.receiver || receipt.cleaner || null,
    receiver_signature_data: receipt.signature,
    job_ids: receipt.jobIds || [],
    status: "signed"
  });
  if (error) throw error;
}

function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.add("show");
  setTimeout(() => node.classList.remove("show"), 2400);
}

function resetAuthSubmitButton() {
  const loginBtn = $("#authForm button[type='submit']");
  if (!loginBtn) return;
  loginBtn.disabled = false;
  loginBtn.textContent = selectedAuthAction === "login" ? "Ingresar" : "Registrarse";
}

function withTimeout(promise, ms, message = "La operacion tardo demasiado.") {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
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
  saveLocalState();
  $("#authScreen").classList.add("hidden");
  $("#appShell").classList.remove("hidden");
  resetIdleTime(true);
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

async function enterClientPortalFromUrl(params = new URLSearchParams(location.search)) {
  if (params.get("portal") === "cleaner") return await enterCleanerPortalFromUrl(params);
  const isClientPortalPath = window.location.pathname.toLowerCase().includes("portal-clientes");
  if (params.get("portal") !== "client" && !isClientPortalPath) return false;
  portalCleanerAdmin = false;
  const access = parsedClientAccess(params);
  const clientId = access.id;
  const accessKey = access.key;

  if (accessKey && (supabaseClient || JOBVISTO_SUPABASE_URL) && (!state.clients || state.clients.length === 0 || !state.clients.some(c => c.id === clientId))) {
    try {
      let data = null;
      let error = null;
      if (supabaseClient) {
        ({ data, error } = await supabaseClient.rpc('get_portal_client', {
          client_id: clientId || null,
          client_key: accessKey
        }));
      }
      if ((!data || error) && JOBVISTO_SUPABASE_URL && JOBVISTO_SUPABASE_ANON_KEY) {
        const response = await fetch(`${JOBVISTO_SUPABASE_URL}/rest/v1/rpc/get_portal_client`, {
          method: "POST",
          headers: {
            apikey: JOBVISTO_SUPABASE_ANON_KEY,
            authorization: `Bearer ${JOBVISTO_SUPABASE_ANON_KEY}`,
            "content-type": "application/json"
          },
          body: JSON.stringify({ client_id: clientId || null, client_key: accessKey })
        });
        if (response.ok) {
          data = await response.json();
          error = null;
        }
      }
      if (!error && data) {
        const cl = data.client;
        const org = data.organization;
        state.orgId = cl.organization_id;
        state.country = org.country || "IL";
        state.currencySymbol = org.currency === "ILS" ? "₪" : (org.currency === "USD" ? "$" : org.currency);

        let settings = data.settings || [];
        if (!settings.length) {
          const { data: settingsRows } = await supabaseClient.from('organization_settings').select('*').eq('organization_id', cl.organization_id);
          settings = settingsRows || [];
        }
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
          notes: cl.notes || "",
          portalPasscode: accessKey || null,
          portalActive: cl.portal_active !== false
        }];

        let addresses = data.addresses || [];
        if (!addresses.length) {
          const { data: addressRows } = await supabaseClient.from('client_addresses').select('*').eq('client_id', cl.id);
          addresses = addressRows || [];
        }
        if (addresses && addresses[0]) {
          state.clients[0].address = addresses[0].address_line;
        }

        state.cleaners = (data.cleaners || []).map(c => ({
          id: c.id,
          name: c.name,
          phone: c.phone || "",
          email: c.email || "",
          status: c.status === 'available' ? 'Disponible' : 'Ocupada',
          key: "",
          country: c.country || state.country || "IL",
          city: c.city || "Zona principal"
        }));

        state.jobs = (data.jobs || []).map(j => {
          const dateStr = j.scheduled_start ? j.scheduled_start.slice(0, 10) : today();
          const startStr = (j.actual_start || j.scheduled_start) ? new Date(j.actual_start || j.scheduled_start).toISOString().slice(11, 16) : "08:00";
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
            organizationId: j.organization_id,
            clientId: j.client_id,
            cleanerId: j.assigned_cleaner_id || "",
            date: dateStr,
            start: startStr,
            end: endStr,
            actualEnd: actualEndStr,
            serviceType: j.service_type || "Limpieza normal",
            rate: Number(j.client_hourly_rate || 65),
            extras: Number(j.extras_amount || 0),
            requestReview: Boolean(j.request_review),
            clientRating: j.client_rating ? Number(j.client_rating) : null,
            clientReviewText: j.client_review_text || "",
            cleanerQualityRating: j.cleaner_quality_rating ? Number(j.cleaner_quality_rating) : null,
            cleanerPunctualityRating: j.cleaner_punctuality_rating ? Number(j.cleaner_punctuality_rating) : null,
            cleanerProfessionalismRating: j.cleaner_professionalism_rating ? Number(j.cleaner_professionalism_rating) : null,
            cleanerQualityText: j.cleaner_quality_text || "",
            cleanerRecommended: typeof j.cleaner_recommended === "boolean" ? j.cleaner_recommended : null,
            clientPaidAmount: Number(j.client_paid_amount || 0),
            clientPaymentStatus: j.client_payment_status || "unpaid",
            clientPaidDate: j.client_paid_date || "",
            clientPaymentMethod: j.client_payment_method || "",
            cleanerOnWayAt: j.cleaner_on_way_at || "",
            cleanerLocation: cleanerLocationFromJobRow(j),
            status: appStatusFromDbStatus(j.status),
            tasks: j.checklist || [],
            checkedIn: j.status === 'in_site' || DONE_DB_JOB_STATUSES.includes(j.status),
            checkedOut: DONE_DB_JOB_STATUSES.includes(j.status) || jobSignatures.length > 0,
            cleanerFinished: DONE_DB_JOB_STATUSES.includes(j.status) || jobSignatures.length > 0,
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
  const shouldUnlock = Boolean(client && accessKey && clientPortalKeyMatches(client, accessKey));
  portalClientId = client?.id || null;
  
  // Force hide auth screen and shell
  $("#authScreen").classList.add("hidden");
  $("#authScreen").style.display = "none"; 
  $("#appShell").classList.add("hidden");
  $("#appShell").style.display = "none";
  
  $("#clientPortalPage").classList.remove("hidden");
  $("#clientPortalPassword").value = access.key || (client ? clientPortalPassword(client) : "");
  renderStandaloneClientPortal(shouldUnlock, { showMissingToast: Boolean(clientId || accessKey) });
  return true;
}

async function enterCleanerPortalFromUrl(params = new URLSearchParams(location.search)) {
  const access = parsedCleanerAccess(params);
  portalCleanerAdmin = access.key === normalizeKey(ADMIN_CLEANER_KEY);

  if (supabaseClient && (!state.cleaners || state.cleaners.length === 0 || !state.cleaners.some(c => c.id === access.id))) {
    try {
      const { data, error } = await supabaseClient.rpc('get_portal_cleaner', {
        cleaner_id: access.id || null,
        cleaner_key: access.key
      });
      if (!error && data) {
        const cl = data.cleaner;
        const org = data.organization;
        state.orgId = cl.organization_id;
        state.country = org.country || "IL";
        state.currencySymbol = org.currency === "ILS" ? "₪" : (org.currency === "USD" ? "$" : org.currency);

        let settings = data.settings || [];
        if (!settings.length) {
          const { data: settingsRows } = await supabaseClient.from('organization_settings').select('*').eq('organization_id', cl.organization_id);
          settings = settingsRows || [];
        }
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
          key: access.key || "",
          country: cl.country || state.country || "IL",
          city: cl.city || "Zona principal"
        }];

        state.clients = (data.clients || []).map(c => ({
          id: c.id,
          name: c.name,
          phone: c.phone || "",
          email: c.email || "",
          address: c.address || "",
          country: state.country || "IL",
          paymentMethod: c.default_payment_method === 'cash' ? 'Efectivo' : 'Transferencia',
          notes: c.notes || ""
        }));

        state.jobs = (data.jobs || []).map(j => {
          const dateStr = j.scheduled_start ? j.scheduled_start.slice(0, 10) : today();
          const startStr = (j.actual_start || j.scheduled_start) ? new Date(j.actual_start || j.scheduled_start).toISOString().slice(11, 16) : "08:00";
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
            organizationId: j.organization_id,
            clientId: j.client_id,
            cleanerId: j.assigned_cleaner_id || "",
            date: dateStr,
            start: startStr,
            end: endStr,
            actualEnd: actualEndStr,
            serviceType: j.service_type || "Limpieza normal",
            rate: Number(j.client_hourly_rate || 65),
            extras: Number(j.extras_amount || 0),
            requestReview: Boolean(j.request_review),
            clientRating: j.client_rating ? Number(j.client_rating) : null,
            clientReviewText: j.client_review_text || "",
            cleanerQualityRating: j.cleaner_quality_rating ? Number(j.cleaner_quality_rating) : null,
            cleanerPunctualityRating: j.cleaner_punctuality_rating ? Number(j.cleaner_punctuality_rating) : null,
            cleanerProfessionalismRating: j.cleaner_professionalism_rating ? Number(j.cleaner_professionalism_rating) : null,
            cleanerQualityText: j.cleaner_quality_text || "",
            cleanerRecommended: typeof j.cleaner_recommended === "boolean" ? j.cleaner_recommended : null,
            clientPaidAmount: Number(j.client_paid_amount || 0),
            clientPaymentStatus: j.client_payment_status || "unpaid",
            clientPaidDate: j.client_paid_date || "",
            clientPaymentMethod: j.client_payment_method || "",
            cleanerOnWayAt: j.cleaner_on_way_at || "",
            cleanerLocation: cleanerLocationFromJobRow(j),
            status: appStatusFromDbStatus(j.status),
            tasks: j.checklist || [],
            checkedIn: j.status === 'in_site' || DONE_DB_JOB_STATUSES.includes(j.status),
            checkedOut: DONE_DB_JOB_STATUSES.includes(j.status) || jobSignatures.length > 0,
            cleanerFinished: DONE_DB_JOB_STATUSES.includes(j.status) || jobSignatures.length > 0,
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
          organizationId: r.organization_id,
          cleanerId: r.cleaner_id,
          cleaner: state.cleaners.find(c => c.id === r.cleaner_id)?.name || 'Cleaner',
          amount: Number(r.amount),
          method: r.payment_method === 'cash' ? 'Efectivo' : 'Transferencia',
          period: `${r.period_start} - ${r.period_end}`,
          status: r.status === 'draft' ? 'pending_signature' : 'signed',
          signature: r.receiver_signature_data,
          receiver: r.receiver_name || "",
          date: new Date(r.paid_at).toLocaleDateString('es')
        }));
      }
    } catch (err) {
      console.error("Error loading cleaner portal dynamically: ", err);
    }
  }

  const cleaner = cleanerFromPortalAccess(access.id, access.key);
  const shouldUnlock = Boolean(cleaner && (portalCleanerAdmin || (access.key && normalizeKey(cleanerPortalPassword(cleaner)) === access.key)));
  portalCleanerId = cleaner?.id;
  
  // Force hide auth screen and shell
  $("#authScreen").classList.add("hidden");
  $("#authScreen").style.display = "none";
  $("#appShell").classList.add("hidden");
  $("#appShell").style.display = "none";
  
  $("#clientPortalPage").classList.add("hidden");
  $("#cleanerPortalPage").classList.remove("hidden");
  $("#cleanerPortalPassword").value = access.key || (cleaner ? cleanerPortalPassword(cleaner) : "");
  renderStandaloneCleanerPortal(shouldUnlock, { showMissingToast: Boolean(access.id || access.key) });
  return true;
}

function renderStandaloneClientPortal(unlocked = true, options = {}) {
  $("#clientPortalPage")?.classList.toggle("is-unlocked", unlocked);
  const client = state.clients.find((item) => item.id === portalClientId);
  if (!client) {
    $("#clientPortalPage")?.classList.remove("is-unlocked");
    $("#clientPortalLock").classList.remove("hidden");
    $("#clientPortalContent").classList.add("hidden");
    $("#clientPortalPassword").value = "";
    if (options.showMissingToast) {
      toast(t("clientAccessNotFound"));
    }
    return;
  }
  const job = currentClientJob(client?.id);
  const historyJobs = clientJobHistory(client?.id);
  const hasPayableAmount = job && hasRealBillingTimes(job);
  $("#clientPortalLock").classList.toggle("hidden", unlocked);
  $("#clientPortalContent").classList.toggle("hidden", !unlocked);
  document.querySelector(".portal-header")?.classList.toggle("hidden", !unlocked);

  const unpaidJobs = historyJobs.filter(j => isBillableDone(j) && j.clientPaymentStatus !== "paid");
  let pendingBalance = unpaidJobs.reduce((sum, j) => sum + Math.max(0, estimateJob(j) - parseMoneyInput(j.clientPaidAmount)), 0);
  
  // Si hay un trabajo actual con monto pero que no está terminado y no ha sido pagado, lo sumamos.
  if (hasPayableAmount && job && !isBillableDone(job) && job.clientPaymentStatus !== "paid") {
    pendingBalance += estimateJob(job);
  }
  
  const hasPending = pendingBalance > 0;

  // Build the left summary card
  const statusMap = {
    "Asignado": { label: localizedJobStatus("Asignado"), cls: "cp-status-assigned" },
    "En progreso": { label: localizedJobStatus("En progreso"), cls: "cp-status-inprogress" },
    "En sitio": { label: localizedJobStatus("En sitio"), cls: "cp-status-inprogress" },
    "Terminado por cleaner": { label: localizedJobStatus("Terminado por limpiador"), cls: "cp-status-done" },
    "Terminado por limpiador": { label: localizedJobStatus("Terminado por limpiador"), cls: "cp-status-done" },
    "Terminado por cliente": { label: localizedJobStatus("Terminado por cliente"), cls: "cp-status-done" },
    "Terminado por administrador": { label: localizedJobStatus("Terminado por administrador"), cls: "cp-status-done" },
  };
  const jobStatus = job ? (statusMap[job.status] || { label: localizedJobStatus(job.status), cls: "cp-status-assigned" }) : null;

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
    <span class="cp-summary-eyebrow-redesign">${t("clientLabel")}</span>
    <h2 class="cp-summary-title-redesign">${t("privateServiceSummary")}</h2>
    
    <div class="cp-summary-meta-redesign">
      <div class="cp-meta-row-redesign">
        <i data-lucide="user" class="cp-meta-icon-redesign"></i>
        <span><strong>${t("clientLabel")}:</strong> ${client.name}</span>
      </div>
      <div class="cp-meta-row-redesign">
        <i data-lucide="briefcase" class="cp-meta-icon-redesign"></i>
        <span><strong>${t("currentService")}:</strong> ${job.serviceType}</span>
      </div>
      <div class="cp-meta-row-redesign">
        <i data-lucide="calendar" class="cp-meta-icon-redesign"></i>
        <span><strong>${localText("dateAndTime")}:</strong> ${job.date} &bull; ${job.start}-${job.end || t("undefinedTime")}</span>
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
      ${mkRow("file-text", t("serviceStatus"), `<span class="cp-job-status-badge ${jobStatus?.cls || ''}" style="padding: 2px 8px; border-radius: 99px;">${jobStatus?.label || localizedJobStatus(job.status)}</span>`)}
      ${mkRow("clock", t("cleanerArrival") || "Llegada del cleaner", job.checkedIn ? job.start : pendingText)}
      ${mkRow("clock", t("cleanerDeparture") || "Salida del cleaner", job.checkedOut ? (job.actualEnd || job.end) : pendingText)}
      ${mkRow("camera", t("visiblePhotos"), `<strong>${evidenceCount(job)}</strong>`)}
      ${mkRow("help-circle", t("cleanerFinished"), (job.cleanerFinished || job.checkedOut) ? doneText : pendingText)}
      ${mkRow("check-circle", t("clientConfirmation"), job.clientConfirmed ? doneText : pendingText)}
      ${mkRow("edit-3", t("clientSignature"), job.clientSignature ? doneText : pendingText)}
      ${mkRow("edit-3", t("onsiteSignature"), job.siteSignature ? `${doneText} ${job.siteSignerName || ''}` : pendingText)}
      ${mkRow("clipboard-list", t("checklist"), `<span class="cp-tasks">${(job.tasks || []).join(", ") || "-"}</span>`)}
    </div>

    ${!hasPayableAmount ? `
      <div class="cp-blocked-service-card">
        <div class="cp-blocked-icon">
          <i data-lucide="lock"></i>
        </div>
        <div class="cp-blocked-text">
          <strong>${localText("serviceLocked")}</strong>
          <p>${t("serviceLockedCopy")}</p>
        </div>
      </div>
    ` : ''}

    <button class="primary cp-confirm-btn" id="clientPortalConfirmButton" ${!clientCanConfirmJob(job) ? 'disabled' : ''} data-i18n="confirmServiceCompleted" style="margin-top: 16px;">
      ${job.clientConfirmed ? t("serviceConfirmed") : hasPayableAmount ? t("confirmServiceCompleted") : blockedText}
    </button>
  ` : `
    <span class="cp-summary-eyebrow-redesign">${t("clientLabel")}</span>
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
      activityEl.innerHTML = `<p class='muted'>${t("noRecentServiceActivity")}</p>`;
    } else {
      const arrivalDetail = job.checkedIn
        ? t(job.cleanerLocation ? "arrivedAtWithLocation" : "arrivedAt").replace("{time}", job.start)
        : t("cleanerWillRegisterArrival");
      const activities = [
        { icon: "👤", color: "cp-act-green", label: t("serviceAssigned"), detail: `${client.name}`, time: job.date, show: true },
        { icon: "📅", color: "cp-act-blue", label: t("scheduledJob"), detail: `${job.date} - ${job.start}-${job.end || t("undefinedTime")}`, time: job.date, show: true },
        { icon: "🔔", color: "cp-act-orange", label: t("cleanerArrival"), detail: job.checkedIn ? t("arrivedAt").replace("{time}", job.start) : t("cleanerWillRegisterArrival"), time: "", show: true },
        { icon: "📷", color: "cp-act-purple", label: t("visiblePhotos"), detail: evidenceCount(job) > 0 ? `${evidenceCount(job)} ${t("photosUploaded")}` : t("photosUploadAfterChecklist"), time: "", show: true },
        { icon: "✅", color: "cp-act-teal", label: t("clientConfirmation"), detail: job.clientConfirmed ? t("serviceConfirmed") : t("clientMustConfirmService"), time: "", show: true },
        { icon: "✍", color: "cp-act-gray", label: t("clientSignature"), detail: job.clientSignature ? t("signatureRegistered") : t("digitalSignatureRequested"), time: "", show: true },
      ];
      const arrivalActivity = activities.find((item) => item.color === "cp-act-orange");
      if (arrivalActivity) {
        arrivalActivity.detail = arrivalDetail;
        arrivalActivity.html = job.checkedIn ? cleanerLocationLinksHtml(job, client) : "";
      }
      activityEl.innerHTML = activities.filter(a => a.show).map(a => `
        <div class="cp-act-item">
          <div class="cp-act-icon ${a.color}">${a.icon}</div>
          <div class="cp-act-body">
            <strong>${a.label}</strong>
            <span>${a.detail}</span>
            ${a.html || ""}
            ${a.time ? `<time>${a.time}</time>` : ''}
          </div>
        </div>
      `).join("");
    }
  }

  // Photos (Evidence)
  const photosEl = $("#clientPortalPhotos");
  if (photosEl) {
    if (job && evidenceCount(job) > 0) {
      photosEl.innerHTML = photoSectionsHtml(job);
    } else {
      photosEl.innerHTML = `
        <div class="cp-empty-evidence-card">
          <div class="cp-empty-image-wrap">
            <i data-lucide="image" class="cp-empty-image-icon"></i>
          </div>
          <strong>${t("emptyEvidenceTitle")}</strong>
          <p>${t("emptyEvidenceCopy")}</p>
          <button class="ghost cp-history-btn" type="button" onclick="document.querySelector('.cp-history-panel-separate').scrollIntoView({ behavior: 'smooth' })">
            <i data-lucide="folder-open"></i>
            ${t("evidenceHistory")}
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

function renderStandaloneCleanerPortal(unlocked = true, options = {}) {
  const cleaner = state.cleaners.find((item) => item.id === portalCleanerId);
  if (!cleaner) {
    $("#cleanerPortalLock").classList.remove("hidden");
    $("#cleanerPortalContent").classList.add("hidden");
    $("#cleanerPortalPage").classList.remove("is-unlocked");
    if (options.showMissingToast) {
      toast(t("cleanerAccessNotFound"));
    }
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
  $("#cleanerPortalTitle").textContent = portalCleanerAdmin
    ? t("cleanerAdminView")
    : t("helloCleaner").replace("{name}", cleaner.name);
  // Update greeting and avatar with real name
  const cleanerFirstName = (cleaner.name || "").split(" ")[0];
  const cleanerInitials = (cleaner.name || "?").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  if ($("#cleanerWelcomeGreeting")) $("#cleanerWelcomeGreeting").textContent = t("helloCleanerWave").replace("{name}", cleanerFirstName);
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
      ? t("masterAccessActiveCopy")
      : t("adminPermissionActiveCopy").replace("{time}", cleanerHistoryAdminTimeLeftLabel())
    : t("cleanerAdminCorrectionCopy");
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
      ? `\u2197 ${Math.round(((totalMinutes - lastWeekMinutes) / lastWeekMinutes) * 100)}%`
      : `\u2198 ${Math.round(((lastWeekMinutes - totalMinutes) / lastWeekMinutes) * 100)}%`)
    : (totalMinutes > 0 ? `\u2197 ${t("cleanerEncouragementTitle")}` : `\u2014 ${t("noRecordsToday")}`);
  const kpiHtml = `
    <article class="cleaner-kpi-card${hasPriority ? ' kpi-alert' : ''}">
      <div class="kpi-icon-wrap"><span class="kpi-icon">\u{1F4CB}</span></div>
      <div class="kpi-body">
          <span class="kpi-label">${t("pendingJobs")}</span>
          <strong class="kpi-value">${activeAssignedJobs.length}</strong>
          <small class="kpi-note">${t("toDo")}</small>
        </div>
      ${hasPriority ? `<span class="kpi-badge kpi-badge-red">\u2691 ${t("highPriority")}: ${urgentJobs.length}</span>` : ''}
    </article>
    <article class="cleaner-kpi-card">
      <div class="kpi-icon-wrap"><span class="kpi-icon">\u23F1</span></div>
      <div class="kpi-body">
        <span class="kpi-label">${t("workedToday")}</span>
        <strong class="kpi-value">${minutesLabel(todayMinutes)}</strong>
        <small class="kpi-note">${money(todayEarned)} ${t("estimated")}</small>
      </div>
      <span class="kpi-trend ${todayMinutes > 0 ? 'kpi-trend-up' : 'kpi-trend-neutral'}">${todayMinutes > 0 ? `\u2197 ${t("activeToday")}` : `\u2014 ${t("noRecordsToday")}`}</span>
    </article>
    <article class="cleaner-kpi-card">
      <div class="kpi-icon-wrap"><span class="kpi-icon">\u{1F4C5}</span></div>
      <div class="kpi-body">
        <span class="kpi-label">${t("workedMonth")}</span>
        <strong class="kpi-value">${minutesLabel(totalMinutes)}</strong>
        <small class="kpi-note">${money(earned)} ${t("estimated")}</small>
      </div>
      <span class="kpi-trend ${totalMinutes >= lastWeekMinutes ? 'kpi-trend-up' : 'kpi-trend-down'}">${trendLabel}</span>
    </article>
    <article class="cleaner-kpi-card">
      <div class="kpi-icon-wrap"><span class="kpi-icon">\u2705</span></div>
      <div class="kpi-body">
        <span class="kpi-label">${t("finishedJobs")}</span>
        <strong class="kpi-value">${completedJobs.length}</strong>
        <small class="kpi-note">${t("readyToConfirm")}</small>
      </div>
      <span class="kpi-trend ${completedJobs.length > 0 ? 'kpi-trend-up' : 'kpi-trend-neutral'}">${completedJobs.length > 0 ? `\u2197 ${t("cleanerEncouragementTitle")}` : `\u2014 ${t("noCompleted")}`}</span>
    </article>
  `;
  $("#cleanerStats").innerHTML = kpiHtml;
  if (portalCleanerAdmin) {
    $("#cleanerStats").insertAdjacentHTML("afterbegin", `
      <article class="cleaner-kpi-card admin-stat">
        <div class="kpi-icon-wrap"><span class="kpi-icon">\u{1F451}</span></div>
        <div class="kpi-body">
          <span class="kpi-label">${t("masterAccess")}</span>
          <strong class="kpi-value">${state.cleaners.length}</strong>
          <small class="kpi-note">${t("visibleCleaners")}</small>
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
      recentEl.innerHTML = `<p class='muted'>${t("noRecentActivity")}</p>`;
    } else {
      recentEl.innerHTML = recent.map(job => {
        const client = clientFor(job);
        const isDone = job.checkedOut || job.cleanerFinished;
        const hasPhotos = evidenceCount(job) > 0;
        const isCheckedIn = job.checkedIn;
        let iconClass = "take";
        let iconEmoji = "\u{1F4CB}";
        let actLabel = t("jobAssigned");
        if (isDone) { iconClass = "completed"; iconEmoji = "\u2705"; actLabel = t("jobCompleted"); }
        else if (hasPhotos) { iconClass = "photos"; iconEmoji = "\u{1F4F7}"; actLabel = t("photosUploaded"); }
        else if (isCheckedIn) { iconClass = "checkin"; iconEmoji = "\u{1F4CD}"; actLabel = t("checkInRegistered"); }
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
  $("#cleanerAssignedJobs").innerHTML = activeAssignedJobs.length ? activeAssignedJobs.map(cleanerJobHtml).join("") : `<p class='muted'>${t("noActiveCleanerJobs")}</p>`;
  $("#cleanerHistoryJobs").innerHTML = completedJobs.length ? completedJobs.map(cleanerHistoryHtml).join("") : `<p class='muted'>${t("noFinishedJobs")}</p>`;
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
        <span class="client-meta">${job.date} - ${job.start}-${job.end || t("timeUndefined")} - ${client.address}</span>
        ${portalCleanerAdmin
          ? `<button class="ghost" type="button" data-admin-edit-job="${job.id}">${t("editFromAdmin")}</button>`
          : `<button class="primary" type="button" data-take-job="${job.id}">${t("takeJob")}</button>`}
      </article>
    `;
  }).join("") : `<p class='muted'>${t("noOpenJobs")}</p>`;
  bindCleanerPortalChrome(cleaner);
  setCleanerTab(cleanerActiveTab);
  $$("[data-admin-edit-job]").forEach((button) => {
    button.addEventListener("click", async () => {
      $("#cleanerPortalPage").classList.add("hidden");
      $("#appShell").classList.remove("hidden");
      startJobEdit(button.dataset.adminEditJob);
    });
  });
  $$("[data-take-job]").forEach((button) => {
    button.addEventListener("click", async () => {
      const job = state.jobs.find((item) => item.id === button.dataset.takeJob);
      if (!job) return;
      const previousJob = structuredClone(job);
      job.cleanerId = cleaner.id;
      job.status = "Asignado";

      if (supabaseClient) {
        try {
          await persistCleanerJobAction("take", job, { assigned_cleaner_id: cleaner.id });
        } catch (err) {
          console.error("Error taking job in portal mode:", err);
          Object.assign(job, previousJob);
          renderStandaloneCleanerPortal(true);
          toast(t("takeJobError"));
          return;
        }
      }

      save();
      renderStandaloneCleanerPortal(true);
      toast(t("takeJobSuccess"));
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
        toast(t("futureJobToast"));
        return;
      }
      if (job.checkedIn && !portalCleanerAdmin) {
        toast(t("alreadyArrivedToast").replace("{time}", job.start || ""));
        return;
      }
      const previousJob = structuredClone(job);
      toast(t("registeringArrival"));
      const location = await captureCleanerLocation();
      job.checkedIn = true;
      job.start = currentTime();
      job.status = "En sitio";
      if (location) job.cleanerLocation = location;

      if (supabaseClient) {
        try {
          const actualStart = `${job.date}T${job.start}:00Z`;
          await persistCleanerJobAction("arrived", job, { actual_start: actualStart, location });
        } catch (err) {
          console.error("Error saving arrival in portal mode:", err);
          Object.assign(job, previousJob);
          renderStandaloneCleanerPortal(true);
          toast(t("arrivalSaveError"));
          return;
        }
      }

      save();
      renderStandaloneCleanerPortal(true);
      toast(location ? t("arrivalWithLocation") : t("arrivalWithoutLocation"));
    });
  });
  $$("[data-cleaner-photo]").forEach((button) => {
    button.addEventListener("click", async () => {
      const job = state.jobs.find((item) => item.id === button.dataset.cleanerPhoto);
      if (!job) return;
      if (cleanerActionsLocked(job)) {
        toast(t("photosAvailableServiceDay"));
        return;
      }
      if (!job.checkedIn && !portalCleanerAdmin) {
        toast(t("markArrivalForClientTime"));
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
        toast(t("evidenceAvailableServiceDay"));
        return;
      }
      if (!job.checkedIn && !portalCleanerAdmin) {
        toast(t("markArrivalBeforePhotos"));
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
        const previousPhoto = { ...photo };
        photo.section = section;
        photo.phase = phase;
        photo.comment = comment;
        if (files[0]) {
          photo.url = await compressImageFile(files[0]);
          photo.fileName = files[0].name;
        }
        try {
          if (supabaseClient) await persistPortalEvidence(job, photo);
          save();
        } catch (err) {
          Object.assign(photo, previousPhoto);
          console.error("Error updating evidence in portal mode:", err);
          toast(t("evidenceSaveError"));
          renderStandaloneCleanerPortal(true);
          return;
        }

        renderStandaloneCleanerPortal(true);
        toast(t("evidenceCorrected"));
        return;
      }
      if (!files.length) {
        toast(t("choosePhotos"));
        return;
      }
      const createdAt = new Date().toISOString();
      const createdEvidence = [];
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
        try {
          if (supabaseClient) await persistPortalEvidence(job, newEv);
          evidenceFor(job).push(newEv);
          createdEvidence.push(newEv);
        } catch (err) {
          console.error("Error inserting evidence in portal mode:", err);
          toast(t("photoSaveError"));
          break;
        }
      }
      job.photos = evidenceCount(job);
      save();
      renderStandaloneCleanerPortal(true);
      if (createdEvidence.length) {
        toast(t("evidenceSavedVisible").replace("{count}", createdEvidence.length));
      }
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
      form.querySelector('button[type="submit"]').textContent = t("saveEvidence");
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
      form.querySelector('button[type="submit"]').textContent = t("saveEvidence");
      button.classList.add("hidden");
    });
  });
  $$("[data-cleaner-finish]").forEach((button) => {
    button.addEventListener("click", async () => {
      const job = state.jobs.find((item) => item.id === button.dataset.cleanerFinish);
      if (!job) return;
      if (cleanerActionsLocked(job)) {
        toast(t("finishOnlyServiceDay"));
        return;
      }
      if (!job.checkedIn && !portalCleanerAdmin) {
        toast(t("markArrivalBeforeFinish"));
        return;
      }
      if (!evidenceCount(job) && !confirm(t("finishWithoutPhotosConfirm"))) return;
      if (portalCleanerAdmin && !job.checkedIn) {
        job.checkedIn = true;
        job.start = job.start || currentTime();
      }
      const previousJob = structuredClone(job);
      job.checkedOut = true;
      job.cleanerFinished = true;
      job.actualEnd = currentTime();
      job.status = portalCleanerAdmin ? "Terminado por administrador" : "Terminado por limpiador";

      if (supabaseClient) {
        try {
          const actualEnd = `${job.date}T${job.actualEnd}:00Z`;
          await persistCleanerJobAction("finish", job, { actual_end: actualEnd });
        } catch (err) {
          console.error("Error finishing job in portal mode:", err);
          Object.assign(job, previousJob);
          renderStandaloneCleanerPortal(true);
          toast(t("finishSaveError"));
          return;
        }
      }

      save();
      renderStandaloneCleanerPortal(true);
      openJobSignatureModal(job.id);
      toast(portalCleanerAdmin ? t("adminFinishNeedsSignature") : t("finishNeedsSignature"));
    });
  });
  bindCleanerAdminCorrections();
  bindPhotoActions(true);
}

function setCleanerTab(tabName = "summary") {
  cleanerActiveTab = tabName || "summary";
  $$("[data-cleaner-tab]").forEach((button) => button.classList.toggle("active", button.dataset.cleanerTab === tabName));
  $("#cleanerMobileMenuToggle")?.setAttribute("aria-expanded", "false");
  $("#cleanerPortalPage")?.classList.remove("mobile-menu-open");
  const map = {
    summary: "#cleanerTabSummary",
    jobs: "#cleanerTabJobs",
    calendar: "#cleanerTabCalendar",
    hours: "#cleanerTabHours",
    payments: "#cleanerTabPayments",
    report: "#cleanerTabReport"
  };
  Object.values(map).forEach((selector) => $(selector)?.classList.remove("active"));
  const activePanel = $(map[tabName] || map.summary);
  activePanel?.classList.add("active");
  $("#cleanerStats")?.classList.toggle("hidden", cleanerActiveTab !== "summary");
  if (cleanerActiveTab !== "summary") {
    activePanel?.scrollIntoView({ behavior: "smooth", block: "start" });
  } else {
    $("#cleanerPortalContent")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function bindCleanerPortalChrome(cleaner) {
  const pendingCount = cleanerPortalPendingCount(cleaner);
  const mobileMenuBtn = $("#cleanerMobileMenuToggle");
  if (mobileMenuBtn) {
    mobileMenuBtn.onclick = () => {
      const isOpen = $("#cleanerPortalPage")?.classList.toggle("mobile-menu-open");
      mobileMenuBtn.setAttribute("aria-expanded", isOpen ? "true" : "false");
    };
  }
  const performanceBtn = $("#cleanerPerformanceBtn");
  if (performanceBtn) {
    performanceBtn.onclick = () => {
      setCleanerTab("report");
      toast(t("performanceReportOpen"));
    };
  }
}

async function handleCleanerHistoryEvidenceSubmit(event) {
  event.preventDefault();
  if (!isCleanerHistoryAdminActive() && !portalCleanerAdmin) {
    toast(t("adminPhotoPermissionNeeded"));
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
    toast(t("chooseHistoryPhotos"));
    return;
  }
  const section = data.get("section") || "General";
  const phase = data.get("phase") || "Antes";
  const comment = data.get("comment") || t("historicalPhotoComment");
  const createdAt = new Date().toISOString();
  const createdEvidence = [];
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
    try {
      if (supabaseClient) await persistPortalEvidence(job, newEv);
      evidenceFor(job).push(newEv);
      createdEvidence.push(newEv);
    } catch (err) {
      console.error("Error inserting historical evidence in portal mode:", err);
      toast(t("historicalPhotoSaveError"));
      break;
    }
  }
  job.photos = evidenceCount(job);
  save();
  renderStandaloneCleanerPortal(true);
  setCleanerTab("jobs");
  if (createdEvidence.length) {
    toast(`${createdEvidence.length} foto${createdEvidence.length === 1 ? "" : "s"} agregada${createdEvidence.length === 1 ? "" : "s"} al historial.`);
  }
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

async function completeJobByAdmin(jobId) {
  const job = state.jobs.find((item) => item.id === jobId);
  if (!job) return;
  if (!await brandConfirm("¿Seguro que quieres cerrar este trabajo como terminado por administrador?")) return;
  closeJobByAdmin(job);
  save();
  if (supabaseClient) {
    const actualEnd = `${job.date}T${job.actualEnd}:00Z`;
    try {
      await persistCleanerJobAction("finish", job, { actual_end: actualEnd });
    } catch (err) {
      console.error("Error closing job by admin:", err);
    }
  }
  renderAll();
  if (!$("#cleanerPortalPage")?.classList.contains("hidden")) renderStandaloneCleanerPortal(true);
  toast(t("adminJobClosed"));
}

function bindCleanerAdminCorrections() {
  if (!portalCleanerAdmin) return;
  $$("[data-admin-save-job]").forEach((button) => {
    button.addEventListener("click", async () => {
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
      if (supabaseClient) {
        const payload = {
          status: dbStatusFromAppStatus(job.status, job.cleanerId),
          actual_start: job.checkedIn && job.start ? `${job.date}T${job.start}:00Z` : null,
          actual_end: job.actualEnd ? `${job.date}T${job.actualEnd}:00Z` : null
        };
        try {
          const { error } = await supabaseClient.from("jobs").update(payload).eq("id", job.id);
          if (error) throw error;
        } catch (err) {
          console.error("Error saving admin job correction:", err);
        }
      }
      renderAll();
      renderStandaloneCleanerPortal(true);
      toast(end ? t("adminHoursSavedClosed") : t("adminArrivalCorrected"));
    });
  });
  $$("[data-admin-finish-job]").forEach((button) => {
    button.addEventListener("click", () => completeJobByAdmin(button.dataset.adminFinishJob));
  });
}

function cleanerJobHtml(job) {
  const client = clientFor(job);
  const cleanerName = state.cleaners.find((item) => item.id === job.cleanerId)?.name || t("unassignedCleaner");
  const actionsLocked = cleanerActionsLocked(job);
  const actionDisabled = actionsLocked ? "disabled" : "";
  const formDisabled = actionsLocked ? "disabled" : "";
  const arrivedDisabled = (actionsLocked || (job.checkedIn && !portalCleanerAdmin)) ? "disabled" : "";
  const arrivedText = job.checkedIn ? t("alreadyArrived").replace("{time}", job.start || "") : t("markArrived");
  const finishedDisabled = (actionsLocked || ((job.checkedOut || job.cleanerFinished) && !portalCleanerAdmin)) ? "disabled" : "";
  const finishedText = job.checkedOut || job.cleanerFinished ? t("finishedAt").replace("{time}", job.actualEnd || "") : t("finishJob");
  const areaOptions = [...new Set([...(job.tasks || []), ...evidenceFor(job).map((item) => item.section).filter(Boolean)])];
  const areaListId = `areas-${job.id}`;
  const onWayUrl = whatsAppUrl(client.phone, `Hola ${client.name}, ${cleanerName} va en camino para el servicio de JobVisto (${job.date}, ${job.start}).`);
  return `
    <article class="client-item">
      <strong>${client.name}</strong>
      <span class="client-meta">${job.date} - ${job.start}-${job.actualEnd || job.end || t("timeUndefined")} - ${jobStatusLabel(job)}</span>
      ${portalCleanerAdmin ? `<span class="client-meta">${t("cleanerRole")}: ${cleanerName}</span>` : ""}
      <span class="client-meta">${client.address}</span>
      ${portalCleanerAdmin ? `
        <div class="admin-correction-box">
          <strong>${t("adminCorrection")}</strong>
          <div class="admin-correction-grid">
            <label>${t("arrival")}
              <input type="time" data-admin-start="${job.id}" value="${job.start || ""}">
            </label>
            <label>${t("actualDeparture")}
              <input type="time" data-admin-end="${job.id}" value="${job.actualEnd || ""}">
            </label>
            <button class="mini-action" type="button" data-admin-save-job="${job.id}">${t("saveHours")}</button>
            <button class="mini-action danger" type="button" data-admin-finish-job="${job.id}">${t("finishByAdmin")}</button>
          </div>
        </div>
      ` : ""}
      ${isOverdueLive(job) ? `<div class="arrival-alert">${t("overdueCleanerWarning")}</div>` : ""}
      ${shouldRemindArrival(job) ? `<div class="arrival-alert">${t("arrivalReminder")}</div>` : ""}
      ${actionsLocked ? `<div class="future-job-alert">${t("futureJobActions")}</div>` : ""}
      <div class="work-brief">
        <strong>${t("workBriefTitle")}</strong>
        <p>${job.serviceType}. ${t("checklist")}: ${(job.tasks || []).join(", ") || t("noChecklist")}.</p>
        <p>${t("workBriefInstruction")}</p>
      </div>
      <div class="receipt-actions">
        ${onWayUrl ? `<a class="mini-action" href="${onWayUrl}" target="_blank" rel="noopener">Voy en camino</a>` : ""}
        <button class="mini-action" type="button" data-cleaner-arrived="${job.id}" ${arrivedDisabled}>${arrivedText}</button>
        <button class="mini-action" type="button" data-cleaner-photo="${job.id}" ${actionDisabled}>${t("addPhoto")}</button>
        <button class="mini-action" type="button" data-cleaner-finish="${job.id}" ${finishedDisabled}>${finishedText}</button>
      </div>
      ${cleanerLocationLinksHtml(job, client)}
      <form class="evidence-form ${actionsLocked ? "is-locked" : ""}" data-evidence-form="${job.id}">
        <input type="hidden" name="evidenceId">
        <label>${t("areaOrPlace")}
          <input name="section" list="${areaListId}" placeholder="${t("areaPlaceholder")}" required ${formDisabled}>
          <datalist id="${areaListId}">
            ${areaOptions.map((task) => `<option value="${escapeHtml(task)}"></option>`).join("")}
          </datalist>
        </label>
        <label>${t("moment")}
          <select name="phase" ${formDisabled}>
            <option value="Antes">${t("before")}</option>
            <option value="Despues">${t("after")}</option>
          </select>
        </label>
        <label>${t("comment")} <input name="comment" placeholder="${t("commentPlaceholder")}" ${formDisabled}></label>
        <label>${t("cameraOrLibrary")} <input name="photo" type="file" accept="image/*" multiple ${formDisabled}></label>
        <div class="form-actions">
          <button class="primary" type="submit" ${formDisabled}>${t("saveEvidence")}</button>
          <button class="ghost hidden" type="button" data-cancel-evidence-edit="${job.id}">${t("cancelCorrection")}</button>
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
        <span>${job.date} - ${job.start}-${job.actualEnd || job.end || t("timeUndefined")} - ${money(cleanerCostForJob(job))}</span>
      </summary>
      <div class="history-body">
        <p class="muted">${client.address}</p>
        <p>${t("cleanerHoursTab")}: <strong>${minutesLabel(billableMinutes(job))}</strong></p>
        <p>${t("status")}: <strong>${jobStatusLabel(job)}</strong></p>
        <p>${t("photos")}: <strong>${evidenceCount(job)}</strong></p>
        <p>${t("onsiteSignature")}: <strong>${job.siteSignature ? `${t("onsiteSignatureReceived")} ${job.siteSignerName || t("onsitePerson")}` : t("pending")}</strong></p>
        ${canAdminEditHistory ? `
          <form class="evidence-form history-evidence-form" data-cleaner-history-evidence-form="${job.id}">
            <label>${t("areaOrPlace")}
              <input name="section" list="${areaListId}" placeholder="${t("areaPlaceholder")}" required>
              <datalist id="${areaListId}">
                ${areaOptions.map((task) => `<option value="${escapeHtml(task)}"></option>`).join("")}
              </datalist>
            </label>
            <label>${t("moment")}
              <select name="phase">
                <option value="Antes">${t("before")}</option>
                <option value="Despues">${t("after")}</option>
              </select>
            </label>
            <label>${t("comment")} <input name="comment" placeholder="${t("commentPlaceholder")}"></label>
            <label>${t("photos")} <input name="photo" type="file" accept="image/*" multiple></label>
            <div class="form-actions">
              <button class="primary" type="submit">${t("addPhoto")}</button>
            </div>
          </form>
        ` : `
          <div class="future-job-alert">${t("cleanerAdminCorrectionCopy")}</div>
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
  if (!upcoming.length) return `<p class='muted'>${t("noActiveCleanerJobs")}</p>`;
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
              <a class="map-link" href="${mapsUrl}" target="_blank" rel="noreferrer">Google Maps</a>
            </div>
          </article>
        `;
      }).join("")}
    </div>
  `;
}

function cleanerHoursHtml(jobs, totalMinutes) {
  if (!jobs.length) return `<p class='muted'>${t("noRecordsToday")}</p>`;
  return `
    <div class="report-line"><span>${t("cleanerCurrentMonth")}</span><strong>${minutesLabel(totalMinutes)}</strong></div>
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
    return `<p class='muted'>${t("noOpenJobs")}</p>`;
  }
  return receipts.map((receipt) => `
    <article class="receipt-item cleaner-payment-card ${receipt.status === "pending_signature" ? "pending" : ""}">
      <strong>${t("cleanerGeneratedPayments")}</strong>
      <span class="client-meta">${receipt.period || t("timeUndefined")} - ${receipt.method} - ${receipt.date}</span>
      <div class="cleaner-payment-amount">${money(receipt.amount || 0)}</div>
      <span class="badge ${receipt.status === "signed" ? "dark" : "gold"}">${receipt.status === "signed" ? localText("paymentSignatureReceived") : localText("paymentSignaturePending")}</span>
      ${receipt.signature ? `<img class="signature-preview" src="${receipt.signature}" alt="Firma de ${receipt.receiver || receipt.cleaner}">` : ""}
      <p class="muted">${t("signaturePending")}</p>
      <div class="receipt-actions">
        <button class="primary" type="button" data-cleaner-sign-payment="${receipt.id}">${receipt.signature ? t("onsiteSignature") : t("clientSignature")}</button>
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
          <small>${t("noRecordsToday")}</small>
        </div>
      </div>
    `;
  }
  return `
    <div class="cleaner-report-hero">
      <div>
        <span>${monthLabelFromKey(monthKey)}</span>
        <strong>${money(earned)}</strong>
        <small>${t("estimated")}</small>
      </div>
      <div class="cleaner-report-mini">
        <span>${jobs.length}</span>
        <small>${t("jobsWord")}</small>
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
  renderAutomaticNotifications();
  renderReports();
  renderPayments();
  renderSettings();
}

function renderMode() {
  const label = state.mode === "company" ? t("companyMode") : t("independentMode");
  const country = countryInfo(state.country);
  const profile = state.companyProfile || {};
  const entitlements = currentEntitlements();
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
  $$('[data-view="cleaners"]').forEach((node) => node.classList.toggle("hidden", !entitlements.cleanerPortal));
}

function renderDashboardReminders() {
  const container = $("#dashboardReminders");
  if (!container) return;
  
  const todayStr = today();
  const reminders = state.clients.filter(c => c.followUpDate && c.followUpDate <= todayStr);
  
  // Calculate debts
  const debts = [];
  state.clients.forEach(c => {
    const jobs = state.jobs.filter(j => j.clientId === c.id && isBillableDone(j) && j.clientPaymentStatus !== "paid");
    const debt = jobs.reduce((sum, j) => sum + Math.max(0, estimateJob(j) - parseMoneyInput(j.clientPaidAmount)), 0);
    if (debt > 0) debts.push({ client: c, debt, jobsCount: jobs.length });
  });
  
  if (reminders.length === 0 && debts.length === 0) {
    container.innerHTML = "";
    return;
  }
  
  let html = "";
  
  // Render Debts
  html += debts.map(d => `
    <div class="reminder-alert" style="border-left-color: var(--danger);">
      <div class="reminder-alert-content">
        <h4 style="color: var(--danger);">⚠️ Deuda pendiente: ${escapeHtml(d.client.name)}</h4>
        <p>El cliente tiene un saldo pendiente de <strong>${money(d.debt)}</strong> por ${d.jobsCount} trabajo(s) terminado(s) y no pagado(s).</p>
      </div>
      <div class="reminder-alert-actions">
        <button type="button" data-open-debt-client="${d.client.id}" style="color: var(--danger); border-color: var(--danger);">Ver deuda en Pagos</button>
      </div>
    </div>
  `).join("");
  
  // Render Follow-ups
  html += reminders.map(c => `
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
  
  container.innerHTML = html;
}

function notificationTemplates() {
  return [
    { key: "tomorrow", title: "Recordatorio de manana", trigger: "Se envia cada hora cuando el trabajo esta a unas 24 horas", audience: "Cliente", channel: "Email", copy: "Recordatorio: manana tienes un servicio con {empresa}. Hora estimada: {hora}." },
    { key: "arrived", title: "Cleaner llego", trigger: "Se envia cuando el cleaner marca llegada", audience: "Cliente", channel: "Email", copy: "{cleaner} ya llego y el trabajo esta iniciando." },
    { key: "finished", title: "Trabajo terminado", trigger: "Se envia cuando el cleaner termina el trabajo", audience: "Cliente", channel: "Email", copy: "Tu servicio fue marcado como terminado. Puedes revisar el portal y dejar feedback." }
  ];
}

function jobNotificationContext(job) {
  const client = clientFor(job);
  const cleaner = state.cleaners.find((item) => item.id === job.cleanerId);
  return {
    cliente: client?.name || "Cliente",
    cleanerName: cleaner?.name || "Cleaner por asignar",
    empresa: state.companyProfile?.businessName || "JobVisto",
    fecha: job.date || "sin fecha",
    hora: job.start || "por definir"
  };
}

function fillNotificationTemplate(copy, context) {
  return String(copy || "")
    .replaceAll("{cliente}", context.cliente)
    .replaceAll("{cleaner}", context.cleanerName)
    .replaceAll("{empresa}", context.empresa)
    .replaceAll("{fecha}", context.fecha)
    .replaceAll("{hora}", context.hora);
}

function daysUntilJob(job) {
  if (!job?.date) return 999;
  return Math.round((localDateFromKey(job.date) - localDateFromKey(today())) / (1000 * 60 * 60 * 24));
}

function notificationStatusFor(job, templateKey) {
  if (templateKey === "tomorrow") return daysUntilJob(job) <= 1 && daysUntilJob(job) >= 0 ? "ready" : "scheduled";
  if (templateKey === "arrived") return job.checkedIn ? "sent" : "waiting";
  if (templateKey === "finished") return isDone(job) ? "sent" : "waiting";
  return "scheduled";
}

function notificationStatusLabel(status) {
  return { sent: "Enviado", ready: "Listo", scheduled: "Programado", waiting: "Esperando evento", blocked: "Falta asignacion" }[status] || "Programado";
}

function notificationStatusClass(status) {
  return status === "sent" ? "dark" : status === "ready" ? "green" : status === "blocked" ? "danger" : "gold";
}

function notificationEventsForJob(job) {
  const context = jobNotificationContext(job);
  const client = clientFor(job);
  const logs = notificationLogsForJob(job.id);
  return notificationTemplates().map((template) => ({
    ...template,
    job,
    context,
    status: logs.find((log) => log.template_key === template.key)?.status || notificationStatusFor(job, template.key),
    client,
    message: fillNotificationTemplate(template.copy, context)
  }));
}

function notificationLogsForJob(jobId) {
  return (state.notificationLogs || []).filter((log) => log.job_id === jobId);
}

function languageName(code) {
  return { es: "Español", en: "English", ru: "Русский", he: "עברית" }[code] || "Español";
}

function notificationLogLabel(log) {
  if (!log) return "";
  const title = notificationTemplates().find((template) => template.key === log.template_key)?.title || log.template_key;
  const when = log.sent_at || log.created_at;
  const date = when ? new Date(when).toLocaleString("es") : "";
  return `${title} - ${log.status || "registrado"}${date ? ` - ${date}` : ""}`;
}

function renderAutomaticNotifications() {
  if (!$("#notificationsView")) return;
  const templates = notificationTemplates();
  const visibleJobs = [...state.jobs]
    .filter((job) => job.date >= today() || notificationLogsForJob(job.id).length)
    .sort((a, b) => `${a.date || ""} ${a.start || ""}`.localeCompare(`${b.date || ""} ${b.start || ""}`))
    .slice(0, 12);
  const events = visibleJobs.flatMap(notificationEventsForJob);
  const ready = events.filter((event) => event.status === "ready").length;
  const sent = events.filter((event) => event.status === "sent").length;
  const waiting = events.filter((event) => event.status === "waiting" || event.status === "scheduled").length;
  const clientsWithoutEmail = activeClients().filter((client) => !client.email);

  $("#notificationKpis").innerHTML = `
    <article><span>Emails enviados</span><strong>${sent}</strong><small>registrados en Supabase</small></article>
    <article><span>Listos para enviar</span><strong>${ready}</strong><small>Netlify los procesa cada hora</small></article>
    <article><span>En espera</span><strong>${waiting}</strong><small>por fecha o accion del cleaner</small></article>
    <article><span>Clientes sin email</span><strong>${clientsWithoutEmail.length}</strong><small>no recibiran avisos</small></article>
  `;

  $("#notificationFlow").innerHTML = templates.map((template, index) => `
    <article class="notification-flow-step">
      <span>${index + 1}</span>
      <div><strong>${template.title}</strong><small>${template.trigger}. Canal actual: ${template.channel}.</small></div>
    </article>
  `).join("");

  $("#notificationTemplates").innerHTML = clientsWithoutEmail.length ? clientsWithoutEmail.map((client) => `
    <article class="notification-template-card">
      <div><strong>${escapeHtml(client.name)}</strong><span>${languageName(client.preferredLanguage || state.language || "es")}</span></div>
      <p>Agrega un email en Clientes para que JobVisto pueda enviarle recordatorios automaticos.</p>
    </article>
  `).join("") : "<p class='muted'>Todos los clientes activos tienen email registrado.</p>";

  $("#notificationTimeline").innerHTML = visibleJobs.length ? visibleJobs.map((job) => {
    const context = jobNotificationContext(job);
    const client = clientFor(job);
    const logs = notificationLogsForJob(job.id);
    return `
      <article class="notification-job-card">
        <div class="notification-job-head">
          <div><strong>${escapeHtml(context.cliente)} - ${escapeHtml(job.date || "")}</strong><span>${escapeHtml(client?.email || "sin email")} - ${languageName(client?.preferredLanguage || state.language || "es")} - ${escapeHtml(jobStatusLabel(job))}</span></div>
          <span class="status-chip">${escapeHtml(job.serviceType || "Servicio")}</span>
        </div>
        <div class="notification-event-list">
          ${notificationEventsForJob(job).map((event) => `
            <div class="notification-event">
              <span class="badge ${notificationStatusClass(event.status)}">${notificationStatusLabel(event.status)}</span>
              <div><strong>${event.title}</strong><small>${event.message}</small></div>
            </div>
          `).join("")}
          ${logs.length ? `<div class="notification-event"><span class="badge dark">Historial</span><div>${logs.map((log) => `<small>${escapeHtml(notificationLogLabel(log))}</small>`).join("")}</div></div>` : ""}
        </div>
      </article>
    `;
  }).join("") : "<p class='muted'>Crea un trabajo futuro con cliente y email para ver su estado de notificacion.</p>";
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
    $("#metricSecondaryLabel").textContent = t("activeCleaners");
    $("#metricSecondaryValue").textContent = activeCleaners().length;
    $("#metricSecondaryNote").textContent = `${activeCleaners().length} limpiadores activos`;
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
  const titles = { dashboard: t("dashboard"), clients: t("clients"), cleaners: t("cleaners"), calendar: t("calendar"), jobs: t("jobs"), mobile: "Simulator", clientLinks: t("clientLinks"), notifications: "Notificaciones", reports: t("reports"), payments: t("payments"), settings: t("settings") };
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
          <p class="muted">Usa esto si el limpiador olvido subir fotos o si administracion cerro/corrigio el trabajo manualmente.</p>
          <form class="evidence-form" data-admin-evidence-form="${job.id}">
            <label>Area o lugar
              <input name="section" list="${areaListId}" placeholder="Ej: Cocina, bano, escritorio" required>
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
          <span><b>◷</b>${escapeHtml(timeText)}<small>${job.actualEnd ? "Real" : "Estimado"}</small></span>
          <span><b>⌘</b>${escapeHtml(job.serviceType || "Servicio")}<small>Servicio</small></span>
          <span><b>$</b>${money(billed)}<small>${isBillableDone(job) ? t("real") : t("planned")}</small></span>
        </div>
        <div class="job-proof-row">
          <span>▣ ${evidenceCount(job)} fotos</span>
          <span>⌁ ${escapeHtml(signatureText)}</span>
          <span>Limpiador: ${escapeHtml(cleanerName)}</span>
        </div>
        ${isOverdueLive(job) ? `<div class="job-alert">Alerta: sigue en sitio despues de la hora estimada.</div>` : ""}
        <div class="receipt-actions job-actions">
          <button class="mini-action" type="button" data-edit-job="${job.id}">✎ ${t("editJob")}</button>
          <button class="mini-action" type="button" data-toggle-evidence="${job.id}">◎ Ver detalles</button>
          ${!isDone(job) ? `<button class="mini-action primary-mini" type="button" data-admin-complete-job="${job.id}">✓ Completar trabajo</button>` : ""}
          <button class="mini-action danger" type="button" data-delete-job="${job.id}">${t("delete")}</button>
        </div>
        <details class="admin-evidence-box" id="jobEvidence-${job.id}">
          <summary>Evidencia administrativa</summary>
          <p class="muted">Usa esto si el limpiador olvido subir fotos o si administracion cerro/corrigio el trabajo manualmente.</p>
          <form class="evidence-form" data-admin-evidence-form="${job.id}">
            <label>Area o lugar
              <input name="section" list="${areaListId}" placeholder="Ej: Cocina, bano, escritorio" required>
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
  const statValues = [
    state.jobs.length,
    state.jobs.filter(isLiveJob).length,
    state.jobs.filter(isDone).length
  ];
  document.querySelectorAll(".map-stats strong").forEach((node, index) => {
    node.textContent = statValues[index] ?? node.textContent;
  });
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
  const dateLabel = (value) => {
    if (!value) return "";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return String(value);
    return parsed.toLocaleDateString("es", { day: "2-digit", month: "short", year: "numeric" });
  };
  const items = [];
  state.jobs.filter(isDone).forEach((job) => {
    items.push({
      icon: "OK",
      title: `${cleanerFor(job)?.name || "Cleaner"} ${t("completed")} ${clientFor(job).name}`,
      copy: job.serviceType || clientFor(job).address || "",
      time: dateLabel(job.date),
      sort: `${job.date || ""} ${job.actualEnd || job.end || ""}`
    });
  });
  state.jobs.forEach((job) => {
    evidenceFor(job).forEach((photo) => {
      items.push({
        icon: "IMG",
        title: `${cleanerFor(job)?.name || "Cleaner"} ${t("uploadedPhotos")}`,
        copy: `${clientFor(job).name} - ${photo.section || t("evidence")}`,
        time: dateLabel(photo.createdAt || job.date),
        sort: photo.createdAt || job.date || ""
      });
    });
  });
  (state.receipts || []).forEach((receipt) => {
    items.push({
      icon: "$",
      title: "Pago a cleaner registrado",
      copy: `${receipt.cleaner || "Cleaner"} - ${money(receipt.amount || 0)}`,
      time: dateLabel(receipt.createdAt || receipt.date),
      sort: receipt.createdAt || receipt.date || ""
    });
  });
  (state.clientPayments || []).forEach((payment) => {
    items.push({
      icon: "$",
      title: t("paymentReceived"),
      copy: `${money(payment.amountReceived || 0)} from ${payment.clientName || "Cliente"}`,
      time: dateLabel(payment.createdAt || payment.date),
      sort: payment.createdAt || payment.date || ""
    });
  });
  items.sort((a, b) => String(b.sort || "").localeCompare(String(a.sort || "")));
  if (!items.length) {
    target.innerHTML = `<p class="muted">Aun no hay actividad real registrada.</p>`;
    return;
  }
  const visibleItems = recentActivityExpanded ? items.slice(0, 30) : items.slice(0, 6);
  target.innerHTML = visibleItems.map((item) => `
    <article class="recent-item">
      <span>${escapeHtml(item.icon)}</span>
      <div>
        <strong>${escapeHtml(item.title)}</strong>
        <p>${escapeHtml(item.copy)}</p>
      </div>
      <time>${escapeHtml(item.time)}</time>
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
  const monthKeys = monthOptionsForJobs(state.jobs);
  const monthOptions = ["all", monthKeyOffset(1), monthKeyOffset(0), monthKeyOffset(-1), ...monthKeys]
    .filter((value, index, values) => value && values.indexOf(value) === index);
  if (selectedJobsMonth !== "all" && !monthOptions.includes(selectedJobsMonth)) selectedJobsMonth = "all";
  const visibleJobs = selectedJobsMonth === "all"
    ? state.jobs
    : state.jobs.filter((job) => String(job.date || "").slice(0, 7) === selectedJobsMonth);
  const groups = jobsByCategory(visibleJobs);
  const monthFilters = monthOptions.map((monthKey) => {
    const label = monthKey === "all" ? "Todos" : monthLabelFromKey(monthKey);
    return `<button class="mini-action ${selectedJobsMonth === monthKey ? "is-active" : ""}" type="button" data-job-month="${monthKey}">${escapeHtml(label)}</button>`;
  }).join("");
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
    <div class="job-month-filter" aria-label="Filtrar trabajos por mes">
      ${monthFilters}
    </div>
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
  const clientsForJobs = activeClients();
  $("#jobClientSelect").innerHTML = clientsForJobs.length
    ? `<option value="">Selecciona cliente</option>` + clientsForJobs.map((client) => `<option value="${client.id}">${client.name}</option>`).join("")
    : `<option value="">Primero crea un cliente</option>`;
  updateJobClientAddressHint();
  $$("[data-job-group]").forEach((button) => {
    button.addEventListener("click", () => {
      document.getElementById(`jobGroup-${button.dataset.jobGroup}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
  $$("[data-job-month]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedJobsMonth = button.dataset.jobMonth || "all";
      renderJobs();
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
    toast(t("chooseAdminEvidencePhotos"));
    return;
  }
  const section = data.get("section") || "General";
  const phase = data.get("phase") || "Antes";
  const comment = data.get("comment") || "Evidencia agregada por administracion.";
  const createdAt = new Date().toISOString();
  const createdEvidence = [];
  for (const file of files) {
    createdEvidence.push({
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
  try {
    for (const evidence of createdEvidence) {
      await persistPortalEvidence(job, evidence);
      evidenceFor(job).push(evidence);
    }
    job.photos = evidenceCount(job);
    saveLocalState();
    renderAll();
    toast(`Evidencia guardada correctamente: ${files.length} foto${files.length === 1 ? "" : "s"}.`);
  } catch (error) {
    console.error("Error saving admin evidence:", error);
    toast(t("adminEvidenceSaveError"));
  }
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
  
  if (form.elements.requestReview) {
    form.elements.requestReview.checked = Boolean(job.requestReview);
  }
  
  const reviewDisplay = $("#jobReviewDisplay");
  const reviewStars = $("#jobReviewStars");
  const reviewText = $("#jobReviewText");
  if (reviewDisplay && reviewStars && reviewText) {
    if (job.clientRating) {
      reviewDisplay.classList.remove("hidden");
      reviewStars.innerHTML = "⭐".repeat(job.clientRating) + "☆".repeat(5 - job.clientRating);
      reviewText.textContent = job.clientReviewText ? `"${job.clientReviewText}"` : "Sin comentarios adicionales.";
    } else {
      reviewDisplay.classList.add("hidden");
    }
  }
  
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
    <span>${cleaner ? `Limpiador: ${cleaner.name}` : "Sin limpiador asignado"}</span>
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
  if ($("#jobForm").elements.requestReview) {
    $("#jobForm").elements.requestReview.checked = false;
  }
  const reviewDisplay = $("#jobReviewDisplay");
  if (reviewDisplay) reviewDisplay.classList.add("hidden");
  applyServiceRuleToJobForm();
  updateJobClientAddressHint();
  $("#saveJobButton").textContent = "Crear trabajo";
  $("#cancelJobEdit").classList.add("hidden");
}

function addRecurringJobs(payload, count, recurrence) {
  const safeCount = Math.max(1, Math.min(24, Number(count || 1)));
  const baseDate = localDateFromKey(payload.date);
  const intervalDays = recurrence === "weekly" ? 7 : recurrence === "biweekly" ? 14 : 0;

  return Array.from({ length: safeCount }, (_, index) => {
    const date = new Date(baseDate);
    if (recurrence === "monthly") date.setMonth(baseDate.getMonth() + index);
    else date.setDate(baseDate.getDate() + (intervalDays * index));

    return {
      ...payload,
      id: index === 0 ? payload.id : safeId(),
      date: localDateKey(date),
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
    const accessKey = cleanerPortalDisplayKey(cleaner);
    const accessUrl = localCleanerPortalUrl(cleaner);
    return `
      <article class="client-item territory-card ${isArchived ? "archived-card" : ""}">
        <strong>${cleaner.name}</strong>
        <span class="badge ${badgeClass}">${stateLabel}</span>
        <span class="client-meta">${loc.country} - ${loc.city} - ${loc.region}</span>
        <span class="client-meta">${cleaner.phone || "sin telefono"} - ${cleaner.email || "sin email"}</span>
        <span class="client-meta">${active.length} pendiente${active.length === 1 ? "" : "s"} - ${done.length} terminado${done.length === 1 ? "" : "s"} - ${assigned.length} total</span>
        <div class="portal-access-box">
          <span>Clave: <strong>${accessKey}</strong></span>
          <code class="inline-link">${accessUrl}</code>
        </div>
        <div class="receipt-actions">
          ${isArchived ? `
            <button class="mini-action" type="button" data-edit-cleaner="${cleaner.id}">Editar historial</button>
            <button class="mini-action" type="button" data-restore-cleaner="${cleaner.id}">Restaurar</button>
            <button class="mini-action" type="button" data-open-cleaner-portal="${cleaner.id}">Ver historial</button>
          ` : `
            <button class="mini-action" type="button" data-edit-cleaner="${cleaner.id}">Editar limpiador</button>
            <button class="mini-action danger" type="button" data-archive-cleaner="${cleaner.id}">Eliminar limpiador</button>
            <button class="mini-action" type="button" data-copy-cleaner-key="${cleaner.id}">Copiar clave</button>
            <button class="mini-action" type="button" data-copy-cleaner-link="${cleaner.id}">Copiar enlace</button>
            <button class="mini-action" type="button" data-open-cleaner-portal="${cleaner.id}">Ver portal</button>
          `}
        </div>
      </article>
    `;
  };
  $("#cleanerCount").textContent = `${cleaners.length} limpiadores activos`;
  $("#jobCleanerSelect").innerHTML = `<option value="">Abrir para que un limpiador lo tome</option>` + cleaners.map((cleaner) => `<option value="${cleaner.id}">${cleaner.name}</option>`).join("");
  $("#cleanerTerritory").innerHTML = territoryHtml(cleaners.map((cleaner) => cleanerLocationRecord(cleaner)), "cleaners");
  $("#cleanerList").innerHTML = cleaners.map((cleaner) => cleanerCard(cleaner)).join("") || "<p class='muted'>No hay limpiadores activos todavia.</p>";
  $("#archivedCleanerList").innerHTML = archived.map((cleaner) => cleanerCard(cleaner, true)).join("") || "<p class='muted'>Todavia no hay limpiadores en historial.</p>";
  $$("[data-copy-cleaner-link]").forEach((button) => {
    button.addEventListener("click", () => copyCleanerLink(button.dataset.copyCleanerLink));
  });
  $$("[data-copy-cleaner-key]").forEach((button) => {
    button.addEventListener("click", () => copyCleanerKey(button.dataset.copyCleanerKey));
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
    button.addEventListener("click", async () => {
      const cleaner = state.cleaners.find((item) => item.id === button.dataset.openCleanerPortal);
      if (!cleaner) return;
      try {
        await ensureCleanerPortalAccessSynced(cleaner);
        window.open(localCleanerPortalUrl(cleaner), "_blank");
      } catch (error) {
        console.error("Cleaner portal key sync failed:", error);
        toast("No se pudo guardar la clave del limpiador. Intenta de nuevo.");
      }
    });
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
  try {
    await ensureCleanerPortalAccessSynced(cleaner);
  } catch (error) {
    console.error("Cleaner portal key sync failed:", error);
    toast("No se pudo guardar la clave del limpiador. Intenta de nuevo.");
    return;
  }
  const text = `${localCleanerPortalUrl(cleaner)}\nClave: ${cleanerPortalDisplayKey(cleaner)}`;
  try {
    await navigator.clipboard.writeText(text);
    toast("Enlace y clave del limpiador copiados.");
  } catch {
    window.prompt("Copia este acceso del limpiador:", text);
  }
}

async function copyCleanerKey(cleanerId) {
  const cleaner = state.cleaners.find((item) => item.id === cleanerId);
  if (!cleaner) return;
  try {
    await ensureCleanerPortalAccessSynced(cleaner);
  } catch (error) {
    console.error("Cleaner portal key sync failed:", error);
    toast("No se pudo guardar la clave del limpiador. Intenta de nuevo.");
    return;
  }
  const text = cleanerPortalDisplayKey(cleaner);
  try {
    await navigator.clipboard.writeText(text);
    toast("Clave del limpiador copiada.");
  } catch {
    window.prompt("Copia esta clave del limpiador:", text);
  }
}

async function ensureCleanerPortalAccessSynced(cleaner) {
  if (!cleaner) return null;
  ensureCleanerPortalKey(cleaner);
  saveLocalState();
  if (supabaseClient && state.orgId && state.user) {
    const { error } = await supabaseClient
      .from("cleaners")
      .upsert(cleanerSupabasePayload(cleaner));
    if (error) throw error;
  }
  return cleaner;
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
  $("#saveCleanerButton").textContent = "Actualizar limpiador";
  $("#cancelCleanerEdit").classList.remove("hidden");
  toast("Editando limpiador. Corrige y guarda.");
}

function resetCleanerForm() {
  const form = $("#cleanerForm");
  form.reset();
  form.elements.id.value = "";
  form.elements.country.value = state.country || "IL";
  $("#saveCleanerButton").textContent = "Guardar limpiador";
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
  if (state.costRules?.specialRules) {
    state.costRules.specialRules = state.costRules.specialRules.filter((rule) => rule.cleanerId !== cleaner.id && rule.cleanerName !== cleaner.name);
  }
  if (state.costRules?.specialCleaner === cleaner.name) {
    state.costRules.specialCleaner = "";
    state.costRules.specialCleanerRate = 0;
  }
  normalizeCostRules();
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
  normalizeCostRules();
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
  if (form.elements.preferredLanguage) form.elements.preferredLanguage.value = client.preferredLanguage || state.language || "es";
  
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
    const key = localDateKey(date);
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
  if (!job) {
    const mobileJobEl = $("#mobileJob");
    if (mobileJobEl) {
      mobileJobEl.innerHTML = `<p class="muted" style="padding: 16px; text-align: center;">No hay trabajos activos hoy.</p>`;
    }
    return;
  }
  const client = clientFor(job);
  $("#mobileJob").innerHTML = `
    <span class="status-chip">${job.status}</span>
    <h3>${client.name}</h3>
    <p class="muted">${client.address}</p>
    <div class="phone-step"><span>${localText("arrival")}</span><strong>${job.checkedIn ? job.start : localText("amountPending")}</strong></div>
    <div class="phone-step"><span>GPS</span><strong>${job.cleanerLocation ? localText("gpsSaved") : localText("gpsNotTaken")}</strong></div>
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
  const clientsWithActiveServices = rows.filter((row) => row.activeCount > 0).length;
  const historyCountTotal = rows.reduce((sum, row) => sum + row.historyCount, 0);
  $("#clientLinkKpis").innerHTML = `
    <article>
      <span class="client-link-kpi-icon">🔗</span>
      <div><p>Total de enlaces</p><strong>${rows.length}</strong><small>Portales activos</small></div>
    </article>
    <article>
      <span class="client-link-kpi-icon">👥</span>
      <div><p>Con servicio activo</p><strong>${clientsWithActiveServices}</strong><small>Clientes con trabajos activos/proximos</small></div>
    </article>
    <article>
      <span class="client-link-kpi-icon">◇</span>
      <div><p>Seguridad</p><strong>100%</strong><small>Enlaces seguros</small></div>
    </article>
    <article>
      <span class="client-link-kpi-icon">▣</span>
      <div><p>En historial</p><strong>${historyCountTotal}</strong><small>Enlaces utilizados</small></div>
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
      <span>Enlace del portal</span>
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
          <button type="button" title="Copiar enlace" data-copy-client-link="${client.id}">⧉</button>
        </div>
        <div class="client-link-url">
          <strong>${escapeHtml(portalUrl)}</strong>
          <span>Copiado el ${new Date().toLocaleDateString("es")} ${new Date().toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}</span>
        </div>
        <div class="client-link-actions">
          <button class="ghost" type="button" data-copy-client-link="${client.id}">Copiar enlace</button>
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
  const clientsWithActiveServices = rows.filter((row) => row.activeCount > 0).length;
  const historyCountTotal = rows.reduce((sum, row) => sum + row.historyCount, 0);
  const currentCountry = countryInfo(state.country);
  const countryPill = $("#clientLinksCountryPill");
  if (countryPill) countryPill.textContent = `${currentCountry.name} - ${currentCountry.dial}`;
  $("#clientLinkKpis").innerHTML = [
    { icon: "↗", label: "Total de enlaces", value: rows.length, copy: "Portales activos" },
    { icon: "☷", label: "Con servicio activo", value: clientsWithActiveServices, copy: "Clientes con trabajos activos/proximos" },
    { icon: "◇", label: "Seguridad", value: "100%", copy: "Enlaces seguros" },
    { icon: "▣", label: "En historial", value: historyCountTotal, copy: "Enlaces utilizados" }
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
      <span>Enlace del portal</span>
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
            <button type="button" title="Generar clave nueva" data-generate-client-key="${client.id}">↻</button>
            <button type="button" title="Copiar clave" data-copy-client-key="${client.id}">⧉</button>
          </div>
          <div class="client-link-url">
            <strong>${escapeHtml(displayUrl)}</strong>
            <span>Copiado el ${copiedLabel}</span>
          </div>
          <div class="client-link-actions">
            <button class="ghost" type="button" data-generate-client-key="${client.id}">Generar clave</button>
            <button class="ghost" type="button" data-copy-client-link="${client.id}">Copiar enlace</button>
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
  $$("[data-generate-client-key]").forEach((button) => {
    button.addEventListener("click", () => generateClientPortalKey(button.dataset.generateClientKey));
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
    toast("Enlace copiado. La clave ya esta incluida en la URL.");
  } catch {
    window.prompt("Copia este enlace:", text);
  }
}

async function generateClientPortalKey(clientId) {
  const client = state.clients.find((item) => item.id === clientId);
  if (!client) return;
  client.portalActive = true;
  client.portalPasscode = generateBrandPasscode(client.name);
  if (supabaseClient && state.user) {
    toast("Guardando clave nueva...");
    const { error } = await (async () => {
      const session = await supabaseClient.auth?.getSession?.();
      const token = session?.data?.session?.access_token;
      if (token && state.orgId) {
        const response = await fetch("/.netlify/functions/app-job", {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ organizationId: state.orgId, client: clientSupabasePayload(client) })
        });
        if (response.ok) return { error: null };
      }
      return supabaseClient.from("clients").update({ portal_active: true, portal_passcode: client.portalPasscode }).eq("id", client.id);
    })();
    if (error) {
      toast("No se pudo guardar la clave nueva. Intenta otra vez.");
      return;
    }
  }
  save();
  renderClientLinks();
  const text = `${localClientPortalUrl(client)}\nClave: ${client.portalPasscode}`;
  try {
    await navigator.clipboard.writeText(text);
    toast("Clave nueva generada y acceso copiado.");
  } catch {
    window.prompt("Copia este acceso del cliente:", text);
  }
}

function openClientPortalSettings(clientId) {
  const client = state.clients.find(c => c.id === clientId);
  if (!client) return;
  
  $("#cpsClientId").value = client.id;
  $("#cpsPortalActive").value = (client.portalActive !== false) ? "true" : "false";
  $("#cpsPortalPasscode").value = client.portalPasscode || "";
  
  $("#clientPortalSettingsModal").classList.remove("hidden");
}

function generateBrandPasscode(clientName) {
  const cleanName = String(clientName || "CL")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z]/g, "")
    .slice(0, 3)
    .toUpperCase();
  const prefix = cleanName.length >= 2 ? cleanName : "CL";
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const randomChars = Array.from({ length: 3 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  const randomDigits = Math.floor(10 + Math.random() * 90);
  return `JV-${prefix}-${randomChars}-${randomDigits}`;
}

function generateCleanerPasscode(cleanerName) {
  const cleanName = String(cleanerName || "CLN")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z]/g, "")
    .slice(0, 5)
    .toUpperCase();
  const prefix = cleanName.length >= 2 ? cleanName : "CLN";
  const randomDigits = Math.floor(100 + Math.random() * 900);
  return `JV-${prefix}-${randomDigits}`;
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
  const jobToReview = historyJobs.find(j => j.requestReview && !j.clientRating);
  const reviewedJob = historyJobs.find(j => j.requestReview && j.clientRating);
  const reviewJob = jobToReview || reviewedJob;
  
  const reviewHtml = reviewJob ? clientReviewHtml(reviewJob) : "";

  $("#photoBoard").innerHTML = job ? `
    ${photoSectionsHtml(job)}
    ${reviewHtml}
    <section class="panel client-history-panel">
      <h2>${t("serviceHistory")}</h2>
      ${clientHistoryHtml(historyJobs)}
    </section>
  ` : `
    ${reviewHtml}
    <section class="panel client-history-panel">
      <h2>${t("serviceHistory")}</h2>
      ${clientHistoryHtml(historyJobs)}
    </section>
  `;
  bindPhotoActions();
}

function clientReviewHtml(job) {
  if (!job || !job.requestReview) return "";
  
  if (job.clientRating) {
    return `
      <section class="panel client-history-panel" style="border: 2px solid var(--gold); margin-bottom: 24px;">
        <h2 style="color: var(--gold);">${t("reviewThanks")}</h2>
        <div style="color: var(--gold); font-size: 1.5rem; margin-bottom: 8px;">${"⭐".repeat(job.clientRating)}${"☆".repeat(5 - job.clientRating)}</div>
        <p style="margin:0;"><em>"${escapeHtml(job.clientReviewText || '')}"</em></p>
        ${cleanerFeedbackPromptHtml(job)}
      </section>
    `;
  }

  return `
    <section class="panel client-history-panel" style="border: 2px solid var(--gold); margin-bottom: 24px;" id="reviewSection_${job.id}">
      <h2 style="color: var(--gold);">${t("reviewQuestion").replace("{date}", job.date)}</h2>
      <p>${t("reviewCopy")}</p>
      <form onsubmit="submitClientReview(event, '${job.id}')" style="display: flex; flex-direction: column; gap: 10px; margin-top: 12px;">
        <p class="muted" style="margin:0;">Calificacion general del servicio</p>
        <div class="star-rating-input" style="font-size: 2.5rem; color: #ccc; cursor: pointer; display: flex; gap: 8px; justify-content: center;">
          <span onclick="setReviewRating('${job.id}', 1)" id="star_${job.id}_1">★</span>
          <span onclick="setReviewRating('${job.id}', 2)" id="star_${job.id}_2">★</span>
          <span onclick="setReviewRating('${job.id}', 3)" id="star_${job.id}_3">★</span>
          <span onclick="setReviewRating('${job.id}', 4)" id="star_${job.id}_4">★</span>
          <span onclick="setReviewRating('${job.id}', 5)" id="star_${job.id}_5">★</span>
        </div>
        <input type="hidden" name="rating" id="reviewRating_${job.id}" value="0" required>
        <textarea name="reviewText" placeholder="${t("reviewPlaceholder")}" rows="3" style="width: 100%; border-radius: 6px; border: 1px solid var(--border-color); padding: 8px; font-family: inherit; resize: vertical;"></textarea>
        <div class="cleaner-quality-form" style="background: var(--surface-2); border: 1px solid var(--border-color); border-radius: 8px; padding: 12px; display: grid; gap: 10px; text-align: left;">
          <strong>Feedback interno del cleaner</strong>
          <small class="muted">Esto ayuda a la empresa a controlar calidad. No se publica.</small>
          <label>Limpieza realizada
            <select name="cleanerQualityRating">
              <option value="">Sin calificar</option>
              <option value="5">5 - Excelente</option>
              <option value="4">4 - Buena</option>
              <option value="3">3 - Regular</option>
              <option value="2">2 - Mala</option>
              <option value="1">1 - Muy mala</option>
            </select>
          </label>
          <label>Puntualidad
            <select name="cleanerPunctualityRating">
              <option value="">Sin calificar</option>
              <option value="5">5 - Muy puntual</option>
              <option value="4">4 - Bien</option>
              <option value="3">3 - Regular</option>
              <option value="2">2 - Tarde</option>
              <option value="1">1 - Muy tarde</option>
            </select>
          </label>
          <label>Trato profesional
            <select name="cleanerProfessionalismRating">
              <option value="">Sin calificar</option>
              <option value="5">5 - Excelente</option>
              <option value="4">4 - Bueno</option>
              <option value="3">3 - Regular</option>
              <option value="2">2 - Malo</option>
              <option value="1">1 - Muy malo</option>
            </select>
          </label>
          <label>Comentario sobre el cleaner
            <textarea name="cleanerQualityText" rows="2" placeholder="Ej: llego tarde, dejo detalles, fue muy amable..." style="width: 100%; border-radius: 6px; border: 1px solid var(--border-color); padding: 8px; font-family: inherit; resize: vertical;"></textarea>
          </label>
          <label>Lo recomendarias otra vez?
            <select name="cleanerRecommended">
              <option value="">Sin responder</option>
              <option value="yes">Si</option>
              <option value="no">No</option>
            </select>
          </label>
        </div>
        <button type="submit" class="primary" style="background: var(--gold); border: none; color: black; font-weight: bold; margin-top: 8px;">${t("sendReview")}</button>
      </form>
    </section>
  `;
}

function cleanerFeedbackPromptHtml(job) {
  if (!job || !job.cleanerId) return "";
  if (hasCleanerQualityFeedback(job)) {
    return `
      <div class="cleaner-quality-form" style="margin-top: 14px; background: var(--surface-2); border: 1px solid var(--border-color); border-radius: 8px; padding: 12px; text-align: left;">
        <strong>Feedback del cleaner guardado</strong>
        <p class="muted" style="margin: 6px 0 0;">Gracias. Esta parte queda privada para control interno de la empresa.</p>
      </div>
    `;
  }
  const cleaner = cleanerFor(job);
  const cleanerName = cleaner.name || "el cleaner";
  return `
    <details class="cleaner-quality-form" style="margin-top: 14px; background: var(--surface-2); border: 1px solid var(--border-color); border-radius: 8px; padding: 12px; text-align: left;">
      <summary style="cursor: pointer; font-weight: 800;">Quieres puntuar al cleaner? Toma menos de 1 minuto</summary>
      <p class="muted" style="margin: 8px 0 10px;">Esto es privado para la empresa. Ayuda a saber si ${escapeHtml(cleanerName)} debe seguir, mejorar o recibir apoyo.</p>
      <form onsubmit="submitCleanerQualityReview(event, '${job.id}')" style="display: grid; gap: 10px;">
        <label>Limpieza realizada
          <select name="cleanerQualityRating" required>
            <option value="">Seleccionar</option>
            <option value="5">5 - Excelente</option>
            <option value="4">4 - Buena</option>
            <option value="3">3 - Regular</option>
            <option value="2">2 - Mala</option>
            <option value="1">1 - Muy mala</option>
          </select>
        </label>
        <label>Puntualidad
          <select name="cleanerPunctualityRating">
            <option value="">Sin calificar</option>
            <option value="5">5 - Muy puntual</option>
            <option value="4">4 - Bien</option>
            <option value="3">3 - Regular</option>
            <option value="2">2 - Tarde</option>
            <option value="1">1 - Muy tarde</option>
          </select>
        </label>
        <label>Trato profesional
          <select name="cleanerProfessionalismRating">
            <option value="">Sin calificar</option>
            <option value="5">5 - Excelente</option>
            <option value="4">4 - Bueno</option>
            <option value="3">3 - Regular</option>
            <option value="2">2 - Malo</option>
            <option value="1">1 - Muy malo</option>
          </select>
        </label>
        <label>Comentario sobre el cleaner
          <textarea name="cleanerQualityText" rows="2" placeholder="Ej: llego tarde, dejo detalles, fue muy amable..." style="width: 100%; border-radius: 6px; border: 1px solid var(--border-color); padding: 8px; font-family: inherit; resize: vertical;"></textarea>
        </label>
        <label>Lo recomendarias otra vez?
          <select name="cleanerRecommended">
            <option value="">Sin responder</option>
            <option value="yes">Si</option>
            <option value="no">No</option>
          </select>
        </label>
        <button type="submit" class="primary" style="align-self: flex-start;">Guardar feedback del cleaner</button>
      </form>
    </details>
  `;
}

window.setReviewRating = function(jobId, rating) {
  const ratingInput = document.getElementById(`reviewRating_${jobId}`);
  if (ratingInput) ratingInput.value = rating;
  for (let i = 1; i <= 5; i++) {
    const star = document.getElementById(`star_${jobId}_${i}`);
    if (star) {
      star.style.color = i <= rating ? "var(--gold)" : "#ccc";
    }
  }
};

window.submitClientReview = async function(event, jobId) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const rating = parseInt(formData.get("rating"), 10);
  const text = formData.get("reviewText");
  const cleanerFeedback = {
    qualityRating: Number(formData.get("cleanerQualityRating") || 0) || null,
    punctualityRating: Number(formData.get("cleanerPunctualityRating") || 0) || null,
    professionalismRating: Number(formData.get("cleanerProfessionalismRating") || 0) || null,
    qualityText: String(formData.get("cleanerQualityText") || "").trim(),
    recommended: formData.get("cleanerRecommended") === "yes" ? true : formData.get("cleanerRecommended") === "no" ? false : null
  };
  
  if (!rating || rating < 1 || rating > 5) {
    alert("Por favor selecciona una calificación de estrellas.");
    return;
  }
  
  const submitBtn = form.querySelector("button[type='submit']");
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = t("sending");
  }
  
  try {
    if (supabaseClient) {
      await withTimeout(persistPortalClientReview(jobId, rating, text, cleanerFeedback), 15000, t("reviewSaveError"));
    }

    const job = state.jobs.find(j => j.id === jobId);
    if (job) {
      job.clientRating = rating;
      job.clientReviewText = text;
      job.cleanerQualityRating = cleanerFeedback.qualityRating;
      job.cleanerPunctualityRating = cleanerFeedback.punctualityRating;
      job.cleanerProfessionalismRating = cleanerFeedback.professionalismRating;
      job.cleanerQualityText = cleanerFeedback.qualityText;
      job.cleanerRecommended = cleanerFeedback.recommended;
      save();
    }

    toast(t("reviewSavedToast"));
    if (portalPageVisible("#clientPortalPage")) {
      renderStandaloneClientPortal(true);
    } else {
      const clientViewId = new URLSearchParams(location.search).get("id");
      if (clientViewId) renderClientPortal(clientViewId, true);
      else renderAll();
    }
  } catch (error) {
    console.error("Error saving client review:", error);
    toast(t("reviewSaveError"));
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = t("sendRating");
    }
  }
};

window.submitCleanerQualityReview = async function(event, jobId) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const job = state.jobs.find(j => j.id === jobId);
  if (!job) return;
  const cleanerFeedback = {
    qualityRating: Number(formData.get("cleanerQualityRating") || 0) || null,
    punctualityRating: Number(formData.get("cleanerPunctualityRating") || 0) || null,
    professionalismRating: Number(formData.get("cleanerProfessionalismRating") || 0) || null,
    qualityText: String(formData.get("cleanerQualityText") || "").trim(),
    recommended: formData.get("cleanerRecommended") === "yes" ? true : formData.get("cleanerRecommended") === "no" ? false : null
  };

  if (!cleanerFeedback.qualityRating) {
    alert("Por favor selecciona la calificacion de limpieza del cleaner.");
    return;
  }

  const submitBtn = form.querySelector("button[type='submit']");
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = t("sending");
  }

  try {
    if (supabaseClient) {
      await withTimeout(
        persistPortalClientReview(jobId, job.clientRating || 5, job.clientReviewText || "", cleanerFeedback),
        15000,
        t("reviewSaveError")
      );
    }

    job.clientRating = job.clientRating || 5;
    job.cleanerQualityRating = cleanerFeedback.qualityRating;
    job.cleanerPunctualityRating = cleanerFeedback.punctualityRating;
    job.cleanerProfessionalismRating = cleanerFeedback.professionalismRating;
    job.cleanerQualityText = cleanerFeedback.qualityText;
    job.cleanerRecommended = cleanerFeedback.recommended;
    save();

    toast("Feedback del cleaner guardado.");
    if (portalPageVisible("#clientPortalPage")) {
      renderStandaloneClientPortal(true);
    } else {
      const clientViewId = new URLSearchParams(location.search).get("id");
      if (clientViewId) renderClientPortal(clientViewId, true);
      else renderAll();
    }
  } catch (error) {
    console.error("Error saving cleaner quality feedback:", error);
    toast(t("reviewSaveError"));
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Guardar feedback del cleaner";
    }
  }
};

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
      if (!await brandConfirm(t("confirmDeletePhoto"))) return;
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

function cleanerQualityScores(job) {
  return [job.cleanerQualityRating, job.cleanerPunctualityRating, job.cleanerProfessionalismRating]
    .map(Number)
    .filter((score) => Number.isFinite(score) && score >= 1 && score <= 5);
}

function cleanerQualityAverage(job) {
  const scores = cleanerQualityScores(job);
  if (!scores.length) return null;
  return scores.reduce((sum, score) => sum + score, 0) / scores.length;
}

function hasCleanerQualityFeedback(job) {
  return Boolean(
    cleanerQualityScores(job).length ||
    job.cleanerQualityText ||
    typeof job.cleanerRecommended === "boolean"
  );
}

function serviceQualityReportHtml(jobs = state.jobs) {
  const reviewedJobs = jobs
    .filter((job) => job.clientRating || job.clientReviewText)
    .sort((a, b) => `${b.date || ""} ${b.start || ""}`.localeCompare(`${a.date || ""} ${a.start || ""}`));

  if (!reviewedJobs.length) {
    return "<p class='muted'>Todavia no hay comentarios de servicio. Apareceran cuando los clientes completen el review del trabajo.</p>";
  }

  return reviewedJobs.map((job) => {
    const client = clientFor(job);
    const cleaner = cleanerFor(job);
    const stars = job.clientRating ? `${job.clientRating}/5` : "Sin estrellas";
    const comment = job.clientReviewText ? ` - "${escapeHtml(job.clientReviewText)}"` : "";
    return `
      <div class="report-line">
        <span>${escapeHtml(client.name)}<small>${escapeHtml(job.date || "")} - ${escapeHtml(job.serviceType || "Servicio")} - Cleaner: ${escapeHtml(cleaner.name || "Sin asignar")}${comment}</small></span>
        <strong>${stars}</strong>
      </div>
    `;
  }).join("");
}

function cleanerQualityReportHtml(jobs = state.jobs) {
  const rows = activeCleaners().map((cleaner) => {
    const cleanerJobs = jobs.filter((job) => job.cleanerId === cleaner.id && cleanerQualityAverage(job));
    const allScores = cleanerJobs.flatMap(cleanerQualityScores);
    const average = allScores.length ? allScores.reduce((sum, score) => sum + score, 0) / allScores.length : null;
    const lowJobs = cleanerJobs.filter((job) => cleanerQualityAverage(job) < 3.5 || job.cleanerRecommended === false);
    const latestCommentJob = [...cleanerJobs].reverse().find((job) => job.cleanerQualityText);
    return { cleaner, jobs: cleanerJobs, average, lowJobs, latestCommentJob };
  }).filter((row) => row.jobs.length);

  if (!rows.length) {
    return "<p class='muted'>Todavia no hay feedback interno de cleaners. Aparecera cuando los clientes completen la reseña del servicio.</p>";
  }

  return rows
    .sort((a, b) => (a.average ?? 0) - (b.average ?? 0))
    .map(({ cleaner, jobs, average, lowJobs, latestCommentJob }) => {
      const alertLabel = lowJobs.length ? `${lowJobs.length} alerta${lowJobs.length === 1 ? "" : "s"}` : "Sin alertas";
      const alertClass = lowJobs.length ? "gold" : "dark";
      const comment = latestCommentJob?.cleanerQualityText ? ` - "${escapeHtml(latestCommentJob.cleanerQualityText)}"` : "";
      return `
        <div class="report-line">
          <span>${escapeHtml(cleaner.name)}<small>${jobs.length} feedback${jobs.length === 1 ? "" : "s"}${comment}</small></span>
          <strong>${average.toFixed(1)}/5 <em class="badge ${alertClass}">${alertLabel}</em></strong>
        </div>
      `;
    }).join("");
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
    <article class="report-kpi"><i>♙</i><div><span>Invertido en limpiadores</span><strong>${state.currencySymbol}${cleanerCosts.toFixed(0)}</strong><small>+9.4% vs mes anterior</small></div></article>
    <article class="report-kpi"><i>%</i><div><span>Margen referencial</span><strong>${marginPct}%</strong><small>+5.2% vs mes anterior</small></div></article>
  `;

  const incomePct = total ? Math.round((grossProfit / total) * 100) : 0;
  const cleanerPct = total ? Math.round((cleanerCosts / total) * 100) : 0;
  const taxPct = total ? Math.round((tax / (total + tax)) * 100) : 0;
  $("#incomeDonut").style.background = `conic-gradient(var(--green) 0 ${incomePct}%, var(--gold) ${incomePct}% ${incomePct + cleanerPct}%, var(--teal) ${incomePct + cleanerPct}% 100%)`;
  $("#incomeLegend").innerHTML = `
    <div class="legend-item"><span><i style="background: var(--green)"></i>Ganancia bruta</span><strong>${state.currencySymbol}${grossProfit.toFixed(0)}</strong></div>
    <div class="legend-item"><span><i style="background: var(--gold)"></i>Pago a limpiadores</span><strong>${state.currencySymbol}${cleanerCosts.toFixed(0)}</strong></div>
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
    <div class="report-line"><span>Regla general del limpiador</span><strong>${state.currencySymbol}${state.costRules.generalCleanerRate}/h</strong></div>
    ${Object.entries(state.costRules.generalServiceRates || {}).map(([service, rate]) => `
      <div class="report-line"><span>${service}</span><strong>${state.currencySymbol}${rate}/h costo limpiador</strong></div>
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
    <div class="report-line"><span>Pago real/estimado a limpiadores</span><strong>${state.currencySymbol}${cleanerCosts.toFixed(0)}</strong></div>
    <div class="report-line"><span>Ganancia bruta real</span><strong>${state.currencySymbol}${grossProfit.toFixed(0)}</strong></div>
    <div class="report-line"><span>IVA estimado ${state.vatRate}%</span><strong>${state.currencySymbol}${tax.toFixed(0)}</strong></div>
    <div class="report-line"><span>Total referencial</span><strong>${state.currencySymbol}${(total + tax).toFixed(0)}</strong></div>
    <div class="report-line"><span>Trabajos completados</span><strong>${completed}</strong></div>
    <div class="report-line"><span>Trabajos registrados sin contabilizar</span><strong>${registeredJobs.length}</strong></div>
    <div class="report-line"><span>Horas realizadas</span><strong>${totalHours.toFixed(1)}h</strong></div>
  `;
  const serviceQualityReport = $("#serviceQualityReport");
  if (serviceQualityReport) serviceQualityReport.innerHTML = serviceQualityReportHtml(reportJobs);
  const cleanerQualityReport = $("#cleanerQualityReport");
  if (cleanerQualityReport) cleanerQualityReport.innerHTML = cleanerQualityReportHtml(reportJobs);
}

function renderSettings() {
  normalizeCostRules();
  const profile = state.companyProfile || {};
  const profileForm = $("#profileSettingsForm");
  if (profileForm) {
    profileForm.elements.businessName.value = profile.businessName || "";
    profileForm.elements.ownerName.value = profile.ownerName || "";
    if (profileForm.elements.greetingName) profileForm.elements.greetingName.value = profile.greetingName || firstName(profile.ownerName);
    profileForm.elements.phone.value = profile.phone || "";
    profileForm.elements.email.value = profile.email || "";
    profileForm.elements.address.value = profile.address || "";
    if (profileForm.elements.portalUrl) profileForm.elements.portalUrl.value = profile.portalUrl || "";
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
    : `<option value="">Sin limpiadores activos</option>`;
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
    button.addEventListener("click", async () => await deleteCostRule(button.dataset.deleteCostRule));
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
        <span class="client-meta">Plan: ${p.plan_id} · Ciclo: ${p.billing_cycle || 'monthly'} · Cliente: ${p.customer_id || 'N/A'}</span>
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

async function deleteCostRule(ruleId) {
  if (!await brandConfirm(t("confirmDeleteCostRule"))) return;
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
    button.addEventListener("click", async () => await deleteClientPriceRule(button.dataset.deleteClientPriceRule));
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

async function deleteClientPriceRule(ruleId) {
  if (!await brandConfirm("¿Eliminar esta regla especial del cliente?")) return;
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
  syncCurrencyBadges();
  // Toggle visibility of cleaners tab button based on mode
  const cleanersTabBtn = document.querySelector('[data-finance-tab="cleaners"]');
  const clientsTabBtn = document.querySelector('[data-finance-tab="clients"]');
  const cleanerPaymentsAllowed = currentEntitlements().cleanerPayments;
  
  if (!cleanerPaymentsAllowed) {
    if (cleanersTabBtn) cleanersTabBtn.classList.add("hidden");
    if (cleanersTabBtn && cleanersTabBtn.classList.contains("active")) {
      cleanersTabBtn.classList.remove("active");
      if (clientsTabBtn) {
        clientsTabBtn.classList.add("active");
        const cleanersContent = document.getElementById("financeCleanersTab");
        const clientsContent = document.getElementById("financeClientsTab");
        if (cleanersContent) cleanersContent.classList.add("hidden");
        if (clientsContent) clientsContent.classList.remove("hidden");
      }
    }
  } else {
    if (cleanersTabBtn) cleanersTabBtn.classList.remove("hidden");
  }

  // Cleaners Tab
  syncPaymentCleanerSelect();
  $("#paymentPeriod").value = $("#paymentPeriod").value || currentPeriodLabel();
  renderPaymentJobPicker();
  
  // Clients Tab
  syncClientPaymentSelect();
  renderClientPaymentJobPicker();
  renderClientBalances();
  renderClientPaymentReceipts();
  
  if (!cleanerPaymentsAllowed) {
    $("#paymentReceipts").innerHTML = "<p class='muted'>Los recibos y pagos a limpiadores estan disponibles desde el plan Pro.</p>";
    return;
  }

  $("#paymentReceipts").innerHTML = state.receipts.length
    ? state.receipts.map((receipt) => `
      <article class="receipt-item ${receipt.status === "pending_signature" ? "pending" : ""}">
        <strong>${receipt.cleaner} - ${money(receipt.amount)}</strong>
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
  const selected = names.find((name) => normalizeKey(name) === normalizeKey(selectedName));
  select.innerHTML = names.length
    ? names.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("")
    : `<option value="">Sin limpiadores activos</option>`;
  select.value = selected || names[0] || "";
}

function paymentCleanerRecord(name = $("#paymentCleanerSelect")?.value) {
  return activeCleaners().find((cleaner) => normalizeKey(cleaner.name) === normalizeKey(name));
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
  const amountVal = parseMoneyInput($("#paymentAmount")?.value);
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
    picker.innerHTML = "<p class='muted'>Selecciona un limpiador para ver trabajos realizados.</p>";
    return;
  }
  if (!jobs.length) {
    picker.innerHTML = "<p class='muted'>No hay trabajos terminados pendientes de pago para este limpiador.</p>";
    if (!receiptId) $("#paymentAmount").value = 0;
    return;
  }
  const selected = new Set(selectedJobIds);
  const shouldAutoSelect = !receiptId && !selected.size;
  picker.innerHTML = `
    <div class="payment-job-picker-head">
      <strong>Trabajos realizados a pagar</strong>
      <button class="mini-action" type="button" id="selectAllPaymentJobs">Seleccionar todos</button>
    </div>
    <div class="payment-job-list">
      ${jobs.map((job) => {
        const client = clientFor(job);
        const cost = cleanerCostForJob(job);
        const checked = shouldAutoSelect || selected.has(job.id);
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

function syncClientPaymentSelect() {
  const select = $("#clientPaymentSelect");
  if (!select) return;
  const clients = activeClients();
  select.innerHTML = clients.length
    ? clients.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("")
    : `<option value="">Sin clientes activos</option>`;
  // Update avatar initial
  const avatar = $("#clientPaymentAvatar");
  if (avatar) avatar.textContent = clients.length ? clients[0].name.charAt(0).toUpperCase() : "-";
}

function renderClientPaymentJobPicker() {
  const picker = $("#clientPaymentJobPicker");
  if (!picker) return;
  const clientId = $("#clientPaymentSelect")?.value;
  if (!clientId) { picker.innerHTML = ""; return; }
  const activeClient = activeClients().find((client) => client.id === clientId);
  if (!activeClient) {
    picker.innerHTML = `<p class="muted" style="padding: 8px 0;">Selecciona un cliente activo para registrar cobros.</p>`;
    const submitBtn = $("#clientPaymentSubmitBtn");
    if (submitBtn) submitBtn.disabled = true;
    return;
  }

  // Jobs that are finished and not fully paid for this client
  const unpaidJobs = state.jobs.filter(j =>
    j.clientId === clientId &&
    isBillableDone(j) &&
    j.clientPaymentStatus !== "paid"
  );

  if (!unpaidJobs.length) {
    picker.innerHTML = `<p class="muted" style="padding: 8px 0;">No hay trabajos pendientes de cobro para este cliente.</p>`;
    const amountInput = $("#clientPaymentAmount");
    if (amountInput) amountInput.value = 0;
    
    // Explicitly reset client payment form inputs
    const amountReceivedInput = $("#clientPaymentAmountReceived");
    if (amountReceivedInput) amountReceivedInput.value = 0;
    const discountInput = $("#clientPaymentDiscount");
    if (discountInput) discountInput.value = 0;

    const cpscSelectedJobs = $("#cpscSelectedJobs");
    if (cpscSelectedJobs) cpscSelectedJobs.textContent = "0";
    const cpscSubtotal = $("#cpscSubtotal");
    if (cpscSubtotal) cpscSubtotal.textContent = money(0);
    const cpscDiscount = $("#cpscDiscount");
    if (cpscDiscount) cpscDiscount.textContent = money(0);
    const cpscTotal = $("#cpscTotal");
    if (cpscTotal) cpscTotal.textContent = money(0);

    const submitBtn = $("#clientPaymentSubmitBtn");
    if (submitBtn) submitBtn.disabled = true;
    return;
  }

  picker.innerHTML = `
    <div class="payment-job-picker-head" style="border-bottom: 1px solid #eaeaea; padding-bottom: 10px; margin-bottom: 10px;">
      <h4 style="font-weight: 500; font-size: 1.05rem; margin: 0; color: #444; letter-spacing: 0.3px;">Trabajos pendientes de cobro</h4>
      <button class="mini-action" type="button" id="selectAllClientPaymentJobs" style="border-radius: 999px; background: transparent; border: 1px solid #d1d1d1;">Seleccionar todos</button>
    </div>
    <div class="payment-job-list">
      ${unpaidJobs.map(j => {
        const amount = estimateJob(j);
        const paid = parseMoneyInput(j.clientPaidAmount);
        const pending = Math.max(0, roundMoney(amount - paid));
        const cleaner = state.cleaners.find(c => c.id === j.cleanerId);
        const cleanerName = cleaner ? cleaner.name : "Sin asignar";
        const duration = minutesLabel(billableMinutes(j));
        return `
          <label class="payment-job-option">
            <input type="checkbox" class="client-payment-job-checkbox" value="${j.id}" data-amount="${pending}" checked>
            <span>
              <strong>${escapeHtml(j.serviceType || "Limpieza")} - ${escapeHtml(j.date)}</strong>
              <small>${j.start || ""}-${j.actualEnd || j.end || "por definir"} &bull; Limpiador: ${escapeHtml(cleanerName)} &bull; ${duration}</small>
            </span>
            <b>${money(pending)}</b>
          </label>`;
      }).join("")}
    </div>
  `;

  // Bind the select all button
  $("#selectAllClientPaymentJobs")?.addEventListener("click", () => {
    document.querySelectorAll(".client-payment-job-checkbox").forEach(cb => {
      cb.checked = true;
    });
    updateClientPaymentTotal();
  });

  updateClientPaymentTotal();
}

function updateClientPaymentTotal() {
  const checkboxes = document.querySelectorAll(".client-payment-job-checkbox:checked");
  let subtotal = 0;
  checkboxes.forEach(cb => { subtotal += parseMoneyInput(cb.dataset.amount); });
  subtotal = roundMoney(subtotal);
  
  const amountInput = $("#clientPaymentAmount");
  if (amountInput) amountInput.value = subtotal.toFixed(2);

  // Set Amount Received to match subtotal if it's currently 0 or empty (helps user auto-fill)
  const amountReceivedInput = $("#clientPaymentAmountReceived");
  if (amountReceivedInput && (parseMoneyInput(amountReceivedInput.value) === 0 || amountReceivedInput.value === "")) {
    amountReceivedInput.value = subtotal.toFixed(2);
  }

  const discountInput = $("#clientPaymentDiscount");
  const discount = roundMoney(parseMoneyInput(discountInput?.value));

  // Update summary card values
  const cpscSelectedJobs = $("#cpscSelectedJobs");
  if (cpscSelectedJobs) cpscSelectedJobs.textContent = checkboxes.length;

  const cpscSubtotal = $("#cpscSubtotal");
  if (cpscSubtotal) cpscSubtotal.textContent = money(subtotal);

  const cpscDiscount = $("#cpscDiscount");
  if (cpscDiscount) cpscDiscount.textContent = money(discount);

  const cpscTotal = $("#cpscTotal");
  if (cpscTotal) cpscTotal.textContent = money(Math.max(0, subtotal - discount));

  const submitBtn = $("#clientPaymentSubmitBtn");
  if (submitBtn) submitBtn.disabled = checkboxes.length === 0;
}

function renderClientBalances() {
  const container = $("#clientBalancesList");
  if (!container) return;

  const debts = [];
  activeClients().forEach(c => {
    const jobs = state.jobs.filter(j => j.clientId === c.id && isBillableDone(j) && j.clientPaymentStatus !== "paid");
    const debt = jobs.reduce((sum, j) => sum + Math.max(0, estimateJob(j) - parseMoneyInput(j.clientPaidAmount)), 0);
    if (debt > 0) debts.push({ client: c, debt, count: jobs.length });
  });
  
  if (debts.length === 0) {
    container.innerHTML = `
      <div class="pl-empty">
        <span>✅</span>
        <p data-i18n="noPendingBalances">No hay saldos pendientes.</p>
      </div>`;
    return;
  }
  
  container.innerHTML = debts.map(d => {
    const firstLetter = escapeHtml(d.client.name.charAt(0).toUpperCase());
    return `
    <article class="receipt-item">
      <div class="receipt-item-row">
        <div class="receipt-avatar">${firstLetter}</div>
        <div class="receipt-info">
          <strong>${escapeHtml(d.client.name)}</strong>
          <small>${d.count} trabajo(s) terminado(s) sin pagar</small>
        </div>
        <div class="receipt-amount-col">
          <span class="receipt-amount">${money(d.debt)}</span>
          <span class="receipt-status-pending">Deuda</span>
        </div>
      </div>
      <div class="receipt-actions" style="margin-top: 8px;">
        <button class="mini-action" type="button" onclick="selectClientForPayment('${d.client.id}')">Registrar cobro</button>
      </div>
    </article>
  `}).join("");
}

function renderClientPaymentReceipts() {
  const container = $("#clientPaymentReceipts");
  if (!container) return;
  const payments = [...(state.clientPayments || [])].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  if (!payments.length) {
    container.innerHTML = "<p class='muted'>Todavia no hay cobros registrados.</p>";
    return;
  }
  container.innerHTML = payments.slice(0, 8).map((payment) => {
    const client = state.clients.find((item) => item.id === payment.clientId);
    const balance = roundMoney(payment.balanceAfter || 0);
    return `
      <article class="receipt-item ${balance > 0 ? "pending" : ""}">
        <div class="receipt-item-row">
          <div class="receipt-avatar">${escapeHtml((client?.name || payment.clientName || "C").charAt(0).toUpperCase())}</div>
          <div class="receipt-info">
            <strong>${escapeHtml(payment.clientName || client?.name || "Cliente")} - ${money(payment.amountReceived)}</strong>
            <small>${escapeHtml(payment.method || "Efectivo")} - ${escapeHtml(payment.date || "")}</small>
            <small>${payment.jobIds?.length || 0} trabajo${payment.jobIds?.length === 1 ? "" : "s"} incluido${payment.jobIds?.length === 1 ? "" : "s"}</small>
          </div>
          <div class="receipt-amount-col">
            <span class="receipt-amount">${balance > 0 ? money(balance) : money(0)}</span>
            <span class="${balance > 0 ? "receipt-status-pending" : "receipt-status-done"}">${balance > 0 ? "Saldo" : "Pagado"}</span>
          </div>
        </div>
        <div class="receipt-actions" style="margin-top: 8px;">
          <button class="mini-action" type="button" onclick="voidClientPayment('${payment.id}')">Anular cobro</button>
        </div>
      </article>
    `;
  }).join("");
}

function selectClientForPayment(clientId) {
  const tabBtn = document.querySelector('[data-finance-tab="clients"]');
  if (tabBtn) {
    tabBtn.click();
  }
  const select = document.getElementById("clientPaymentSelect");
  if (select) {
    select.value = clientId;
    select.dispatchEvent(new Event("change"));
    
    // Also update client payment avatar
    const client = state.clients.find(c => c.id === clientId);
    const avatar = document.getElementById("clientPaymentAvatar");
    if (avatar && client) {
      avatar.textContent = client.name.charAt(0).toUpperCase();
    }
  }
}
window.selectClientForPayment = selectClientForPayment;

function openClientDebtPayment(clientId) {
  setView("payments");
  selectClientForPayment(clientId);
  setTimeout(() => {
    document.getElementById("clientPaymentForm")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 50);
}
window.openClientDebtPayment = openClientDebtPayment;

function processPaymentForm(event) {
  $("#paymentForm").reset();
  $("#paymentId").value = "";
  syncPaymentCleanerSelect();
  $("#paymentPeriod").value = currentPeriodLabel();
  $("#paymentAmount").value = 0;
  renderPaymentJobPicker();
  $("#savePaymentButton").textContent = "Registrar pago externo";
  $("#cancelPaymentEdit").classList.add("hidden");
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
  $("#signatureTitle").textContent = t("paymentSignatureTitle");
  $("#signatureModal .muted").textContent = isCleanerPortal
    ? t("paymentSignatureCleanerPortalCopy")
    : t("paymentSignatureCopy");
  $("#signatureReceiver").value = receipt?.receiver || receipt?.cleaner || "";
  $("#signatureModal").classList.remove("hidden");
  prepareSignaturePad();
}

function openJobSignatureModal(jobId) {
  signingJobId = jobId;
  signingReceiptId = null;
  const job = state.jobs.find((item) => item.id === jobId);
  const client = job ? clientFor(job) : null;
  $("#signatureTitle").textContent = t("serviceSignatureTitle");
  $("#signatureModal .muted").textContent = t("serviceSignatureCopy");
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

function openRecentActivityPanel() {
  setView("dashboard");
  recentActivityExpanded = true;
  renderRecentActivity();
  document.querySelector(".recent-panel")?.scrollIntoView({ behavior: "smooth", block: "center" });
  toast("Actividad reciente abierta.");
}

function setupDelegatedAppClicks() {
  document.addEventListener("click", (event) => {
    const debtButton = event.target.closest("[data-open-debt-client]");
    if (debtButton) {
      event.preventDefault();
      openClientDebtPayment(debtButton.dataset.openDebtClient);
      return;
    }

    const viewTargetButton = event.target.closest("[data-view-target]");
    if (viewTargetButton) {
      event.preventDefault();
      setView(viewTargetButton.dataset.viewTarget);
      return;
    }

    const openJobButton = event.target.closest("[data-open-job]");
    if (openJobButton) {
      event.preventDefault();
      setView("jobs");
      return;
    }

    if (event.target.closest(".recent-panel .text-link")) {
      event.preventDefault();
      recentActivityExpanded = true;
      renderRecentActivity();
      toast("Mostrando mas actividad.");
      return;
    }

    if (event.target.closest(".growth-banner .primary")) {
      event.preventDefault();
      setView("reports");
      document.getElementById("reportsView")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
}

function toggleMobileMenu() {
  const shell = $("#appShell");
  const toggle = $("#mobileMenuToggle");
  if (!shell || !toggle) return;
  const isOpen = shell.classList.toggle("mobile-menu-open");
  toggle.setAttribute("aria-expanded", String(isOpen));
}

function setView(name) {
  if (!viewAllowedByPlan(name)) {
    openPlanChoiceModal("limit", planUpgradeMessage("La gestion de equipo y portal de limpiadores empieza en Company."));
    name = "dashboard";
  }
  const mobileBottomNav = $(".mobile-bottom-nav");
  $$(".view").forEach((view) => view.classList.remove("active"));
  const targetView = $(`#${name}View`);
  if (!targetView) return;
  targetView.classList.add("active");
  $$(".sidebar nav button").forEach((button) => button.classList.toggle("active", button.dataset.view === name));
  
  // Sync mobile bottom nav items
  $$(".mobile-bottom-nav .nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.mobileView === name);
  });
  mobileBottomNav?.classList.toggle("hidden", name === "settings");

  $("#pageTitle").textContent = viewTitle(name);
  closeMobileMenu();
}

function setupEvents() {
  state.language = localStorage.getItem("jobvisto-language") || state.language || "es";
  applyStaticLanguage();
  setupDelegatedAppClicks();
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
  $("#closePlanChoiceModal")?.addEventListener("click", () => {
    pendingSignupData = null;
    closePlanChoiceModal();
  });
  $("#planChoiceModal")?.addEventListener("click", (event) => {
    if (event.target.id === "planChoiceModal") {
      pendingSignupData = null;
      closePlanChoiceModal();
    }
  });
  $("#planChoiceGrid")?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-choose-plan]");
    if (!button) return;
    await choosePlan(button.dataset.choosePlan);
  });
  $("#sendVerification").addEventListener("click", async () => {
    const email = String($("#authForm")?.elements.email.value || "").trim();
    if (!email) {
      toast("Ingresa tu correo para enviar el codigo.");
      return;
    }
    try {
      toast("Enviando codigo...");
      await sendSignupVerificationCode(email);
      toast("Codigo enviado al correo.");
    } catch (err) {
      toast(err.message || "No se pudo enviar el codigo.");
    }
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
      const email = String(data.email || "").trim();
      const password = String(data.password || "").trim();
      if (!email || !password) {
        resetAuthSubmitButton();
        toast(!email ? "Ingresa tu correo para continuar." : "Ingresa tu contrasena para continuar.");
        return;
      }
      toast("Iniciando sesion...");
      try {
        const { data: authData, error } = await supabaseClient.auth.signInWithPassword({
          email,
          password
        });
        if (error) {
          toast("Error: " + error.message);
          resetAuthSubmitButton();
          return;
        }
        state.user = authData.user;
        await withTimeout(loadStateFromSupabase(), 15000, "No se pudo cargar la cuenta. Reintenta en unos segundos.");
        enterApp(selectedAuthMode);
        toast("Bienvenido a JobVisto.");
      } catch (err) {
        console.error("Error during login:", err);
        toast("Error de inicio de sesion: " + err.message);
        resetAuthSubmitButton();
      }
      return;
    }
    
    if (!stripePaymentReturn) {
      const email = String(data.email || "").trim();
      const code = String(data.verifyCode || "").trim();
      try {
        await verifySignupCode(email, code);
      } catch (err) {
        toast(err.message || "Codigo incorrecto.");
        return;
      }
      pendingSignupData = data;
      openPlanChoiceModal("signup");
      return;
    }

    await registerAccountWithSelectedPlan(data);
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
    if (!enforcePlanAction("client", { editingId: data.id || "" })) return;
    const country = countryInfo(state.country);
    const payload = {
      id: data.id || crypto.randomUUID(),
      name: data.name,
      phoneLocal: data.phoneLocal,
      phone: data.phoneLocal ? `${country.dial} ${data.phoneLocal}` : "",
      email: data.email,
      preferredLanguage: data.preferredLanguage || state.language || "es",
      address: data.address,
      country: state.country,
      paymentMethod: data.paymentMethod,
      notes: data.notes,
      followUpDate: data.followUpDate || null,
      followUpNote: data.followUpNote || ""
    };
    const index = state.clients.findIndex((client) => client.id === data.id);
    if (index >= 0) state.clients[index] = { ...state.clients[index], ...payload };
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
    if (!enforcePlanAction("cleaner", { editingId: data.id || "" })) return;
    const existingCleaner = index >= 0 ? state.cleaners[index] : null;
    const payload = {
      id: data.id || crypto.randomUUID(),
      name: data.name,
      phone: data.phone,
      email: data.email,
      country: data.country || state.country || "IL",
      city: data.city || "Zona principal",
      status: existingCleaner?.status || "Disponible",
      key: data.key || existingCleaner?.key || generateCleanerPasscode(data.name),
      archived: Boolean(existingCleaner?.archived),
      archivedAt: existingCleaner?.archivedAt || ""
    };
    if (index >= 0) state.cleaners[index] = { ...state.cleaners[index], ...payload };
    else state.cleaners.push(payload);
    resetCleanerForm();
    save();
    renderAll();
    toast(index >= 0 ? "Limpiador actualizado." : "Limpiador registrado y listo para recibir trabajos.");
  });
  $("#cancelCleanerEdit").addEventListener("click", resetCleanerForm);
  $("#generateCleanerKey")?.addEventListener("click", () => {
    const form = $("#cleanerForm");
    const name = form.elements.name.value || "Cleaner";
    form.elements.key.value = generateCleanerPasscode(name);
    toast("Clave generada para este limpiador.");
  });
  $("#jobForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const previousJobs = structuredClone(state.jobs);
    const previousClients = structuredClone(state.clients);
    const data = Object.fromEntries(new FormData(event.currentTarget));
    if (!data.clientId) {
      toast("Selecciona un cliente antes de guardar el trabajo.");
      return;
    }
    
    // Auto-save address to client if it's missing
    const clientForJob = state.clients.find(c => c.id === data.clientId);
    if (!clientForJob) {
      toast("El cliente seleccionado no existe. Vuelve a elegirlo.");
      return;
    }
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
      tasks: (data.tasks || "Cocina, Banos, Pisos").split(",").map((task) => task.trim()).filter(Boolean),
      requestReview: event.currentTarget.elements.requestReview ? event.currentTarget.elements.requestReview.checked : false
    };
    const index = state.jobs.findIndex((job) => job.id === data.id);
    if (!enforcePlanAction("job", {
      payload,
      count: data.repeatCount,
      recurrence: data.recurrence,
      editingId: data.id || ""
    })) return;
    const previousJob = index >= 0 ? state.jobs[index] : {};
    applyJobStatusControl(payload, previousJob);
    let jobsToSave = [];
    if (index >= 0) {
      state.jobs[index] = { ...state.jobs[index], ...payload, recurrence: data.recurrence || state.jobs[index].recurrence || "" };
      jobsToSave = [state.jobs[index]];
    } else {
      jobsToSave = addRecurringJobs(payload, data.repeatCount, data.recurrence);
      state.jobs.push(...jobsToSave);
    }
    const createdCount = Number(data.repeatCount || 1);
    try {
      toast("Guardando trabajo en la nube...");
      await saveJobsCritical(jobsToSave);
    } catch (error) {
      console.error("Job save failed:", error);
      state.jobs = previousJobs;
      state.clients = previousClients;
      saveLocalState();
      renderAll();
      toast(`No se pudo guardar el trabajo: ${error.message || "revisa la conexion o permisos."}`);
      return;
    }
    saveLocalState();
    resetJobForm();
    renderAll();
    toast(index >= 0 ? "Trabajo actualizado y guardado." : createdCount > 1 ? `${createdCount} fechas creadas y guardadas.` : "Trabajo creado y guardado.");
  });
  $("#cancelJobEdit").addEventListener("click", resetJobForm);
  $("#jobServiceType").addEventListener("change", applyServiceRuleToJobForm);
  $("#jobClientSelect").addEventListener("change", updateJobClientAddressHint);
  $("#jobCleanerSelect").addEventListener("change", syncJobStatusWithCleaner);
  $("#checkInButton").addEventListener("click", async () => {
    const job = activeJob();
    if (!job) return;
    const previousJob = structuredClone(job);
    toast(t("registeringArrival"));
    const location = await captureCleanerLocation();
    job.checkedIn = true;
    job.status = "En progreso";
    job.start = job.start || currentTime();
    if (location) job.cleanerLocation = location;
    try {
      if (supabaseClient) {
        await persistCleanerJobAction("arrived", job, {
          actual_start: `${job.date}T${job.start}:00Z`,
          location
        });
      }
      save();
    } catch (err) {
      console.error("Error saving admin arrival:", err);
      Object.assign(job, previousJob);
      toast(t("arrivalSaveError"));
      renderAll();
      return;
    }
    renderAll();
    toast(location ? t("arrivalWithLocation") : t("arrivalWithoutLocation"));
  });
  $("#uploadPhotoButton").addEventListener("click", () => {
    toast(t("realEvidencePortalInstruction"));
  });
  $("#finishButton").addEventListener("click", async () => {
    const job = activeJob();
    if (!job.checkedIn) {
      toast(t("markArrivalBeforeFinish"));
      return;
    }
    const previousJob = structuredClone(job);
    job.checkedOut = true;
    job.cleanerFinished = true;
    job.actualEnd = job.actualEnd || currentTime();
    job.status = "Terminado por limpiador";
    try {
      if (supabaseClient) {
        await persistCleanerJobAction("finish", job, { actual_end: `${job.date}T${job.actualEnd}:00Z` });
      }
      save();
    } catch (err) {
      console.error("Error saving admin finish:", err);
      Object.assign(job, previousJob);
      renderAll();
      toast(t("adminFinishSaveError"));
      return;
    }
    renderAll();
    toast(t("adminFinishReadyForClient"));
  });
  $("#signatureButton").addEventListener("click", () => {
    const job = activeJob();
    job.signed = true;
    job.status = "Firmado";
    save();
    renderAll();
    toast(t("clientSignatureSaved"));
  });
  $("#unlockClientPortal").addEventListener("click", async () => {
    const entered = $("#clientPortalPassword").value.trim();
    let client = clientFromPortalAccess(portalClientId, entered);
    if (!client && supabaseClient && entered) {
      const toastEl = $("#toast");
      if (toastEl) toastEl.textContent = "";
      const remoteParams = new URLSearchParams();
      remoteParams.set("clave", entered);
      await enterClientPortalFromUrl(remoteParams);
      client = clientFromPortalAccess(portalClientId, entered);
      if (client && clientPortalKeyMatches(client, entered)) {
        renderStandaloneClientPortal(true);
        return;
      }
    }
    if (!client) {
      toast(t("clientAccessNotFound"));
      return;
    }
  if (!clientPortalKeyMatches(client, entered)) {
    toast(t("wrongKey"));
    return;
  }
    portalClientId = client.id;
    renderStandaloneClientPortal(true);
  });
  $("#clientPortalLogout").addEventListener("click", () => {
    $("#clientPortalPassword").value = "";
    renderStandaloneClientPortal(false);
    toast(t("portalSessionClosed"));
  });
  $("#unlockCleanerPortal").addEventListener("click", async () => {
    let cleaner = state.cleaners.find((item) => item.id === portalCleanerId);
    const entered = normalizeKey($("#cleanerPortalPassword").value);
    if (entered === normalizeKey(ADMIN_CLEANER_KEY)) {
      portalCleanerAdmin = true;
      portalCleanerId = state.cleaners[0]?.id || null;
      renderStandaloneCleanerPortal(true);
      toast(t("masterAccessActivated"));
      return;
    }
    const cleanerByKey = cleanerFromPortalAccess(portalCleanerId, entered);
    if (cleanerByKey) {
      cleaner = cleanerByKey;
      portalCleanerId = cleanerByKey.id;
    }
    if (!cleaner && supabaseClient && entered) {
      const toastEl = $("#toast");
      if (toastEl) toastEl.textContent = "";
      const remoteParams = new URLSearchParams();
      remoteParams.set("clave", $("#cleanerPortalPassword").value.trim());
      await enterCleanerPortalFromUrl(remoteParams);
      cleaner = cleanerFromPortalAccess(portalCleanerId, entered);
      if (cleaner && entered === normalizeKey(cleanerPortalPassword(cleaner))) {
        portalCleanerAdmin = false;
        clearCleanerHistoryAdminPermission();
        renderStandaloneCleanerPortal(true);
        return;
      }
    }
    if (!cleaner || entered !== normalizeKey(cleanerPortalPassword(cleaner))) {
      toast(t("wrongKey"));
      return;
    }
    portalCleanerAdmin = false;
    clearCleanerHistoryAdminPermission();
    renderStandaloneCleanerPortal(true);
  });
  $("#unlockCleanerHistoryAdmin").addEventListener("click", () => {
    const entered = normalizeKey($("#cleanerHistoryAdminKey").value);
    if (entered !== normalizeKey(ADMIN_CLEANER_KEY)) {
      toast(t("wrongAdminKey"));
      return;
    }
    activateCleanerHistoryAdminPermission();
    $("#cleanerHistoryAdminKey").value = "";
    renderStandaloneCleanerPortal(true);
    setCleanerTab("jobs");
    toast(t("adminPermissionActivated"));
  });
  $("#cleanerPortalLogout").addEventListener("click", () => {
    portalCleanerAdmin = false;
    clearCleanerHistoryAdminPermission();
    $("#cleanerPortalPassword").value = "";
    renderStandaloneCleanerPortal(false);
    toast(t("portalSessionClosed"));
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
  });
  $("#closeVoidClientPaymentModal").addEventListener("click", closeVoidClientPaymentModal);
  $("#cancelVoidClientPayment").addEventListener("click", closeVoidClientPaymentModal);
  $("#confirmVoidClientPaymentButton").addEventListener("click", confirmVoidClientPayment);
  $("#voidClientPaymentModal").addEventListener("click", (event) => {
    if (event.target.id === "voidClientPaymentModal") closeVoidClientPaymentModal();
  });
  
  document.addEventListener("click", async (event) => {
    const confirmBtn = event.target.closest("#clientPortalConfirmButton");
    if (!confirmBtn) return;
    const client = state.clients.find((item) => item.id === portalClientId);
    const job = currentClientJob(client?.id);
    if (!job) return;
    if (!clientCanConfirmJob(job)) {
      toast("El cliente solo puede confirmar cuando el servicio tenga entrada y salida reales.");
      return;
    }
    const previousJob = structuredClone(job);
    job.clientConfirmed = true;
    job.clientSignature = true;
    job.status = "Confirmado por cliente";

    // Direct Supabase Write for portal-based confirm
    if (supabaseClient) {
      try {
        await persistPortalClientConfirmation(job);
      } catch (err) {
        console.error("Error saving client confirmation in portal mode:", err);
        Object.assign(job, previousJob);
        renderStandaloneClientPortal(true);
        toast("No se pudo guardar la confirmacion. Revisa internet e intenta otra vez.");
        return;
      }
    }

    save();
    renderStandaloneClientPortal(true);
    toast("Cliente confirmo el servicio.");
  });

  $("#paymentForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!enforcePlanAction("cleanerPayments")) return;
    const data = Object.fromEntries(new FormData(event.currentTarget));
    if (!data.cleaner) {
      toast("Primero registra o selecciona un limpiador activo.");
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
      cleanerId: paymentCleanerRecord(data.cleaner)?.id || "",
      amount: jobIds.length ? Number(selectedTotal.toFixed(2)) : roundMoney(parseMoneyInput(data.amount)),
      method: data.method,
      period: data.period || currentPeriodLabel(),
      jobIds,
      status: "pending_signature",
      date: new Date().toLocaleString("es"),
      createdAt: new Date().toISOString()
    };
    if (payload.amount < 0 || (payload.amount === 0 && !jobIds.length)) {
      toast("Selecciona un trabajo o pon un monto mayor a cero.");
      return;
    }
    const previousReceipts = structuredClone(state.receipts);
    const index = state.receipts.findIndex((receipt) => receipt.id === data.id);
    if (index >= 0) state.receipts[index] = { ...state.receipts[index], ...payload };
    else state.receipts.unshift(payload);
    try {
      await persistCleanerPaymentCritical(payload);
      resetPaymentForm();
      renderAll();
      toast(index >= 0 ? "Pago actualizado. Firma pendiente." : "Pago registrado. Falta firma del limpiador.");
    } catch (error) {
      console.error("Error saving cleaner payment:", error);
      saveLocalState();
      resetPaymentForm();
      renderAll();
      toast("Pago guardado en respaldo. Si no aparece en otro dispositivo, recarga la pagina.");
    }
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

  $("#clientPaymentDiscount")?.addEventListener("input", updateClientPaymentTotal);
  $("#clientPaymentAmountReceived")?.addEventListener("input", updateClientPaymentTotal);
  
  document.addEventListener("change", (e) => {
    if (e.target.matches(".client-payment-job-checkbox")) {
      updateClientPaymentTotal();
    }
  });
  
  document.addEventListener("click", (e) => {
    if (e.target.matches("[data-finance-tab]")) {
      const tabName = e.target.dataset.financeTab;
      if (tabName === "cleaners" && !enforcePlanAction("cleanerPayments")) return;
      document.querySelectorAll("[data-finance-tab]").forEach(btn => btn.classList.remove("active"));
      e.target.classList.add("active");
      document.querySelectorAll(".finance-tab-content").forEach(tab => tab.classList.add("hidden"));
      const tabContent = document.getElementById(tabName === "clients" ? "financeClientsTab" : "financeCleanersTab");
      if (tabContent) tabContent.classList.remove("hidden");
      
      // Refresh client tab data when switching to it
      if (tabName === "clients") {
        syncClientPaymentSelect();
        renderClientPaymentJobPicker();
        renderClientBalances();
      }
    }
  });


  $("#clientPaymentForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    const formEl = event.currentTarget;
    // Collect checked job IDs from the dynamically rendered picker
    const jobIds = Array.from(document.querySelectorAll(".client-payment-job-checkbox:checked")).map(el => el.value);

    
    if (!jobIds.length) {
      toast("Selecciona al menos un trabajo para cobrar.");
      return;
    }
    
    const amountReceived = roundMoney(parseMoneyInput(data.amountReceived));
    const discount = roundMoney(parseMoneyInput(data.discount));
    let remainingToCover = roundMoney(amountReceived + discount);
    const selectedPendingTotal = roundMoney(Array.from(document.querySelectorAll(".client-payment-job-checkbox:checked")).reduce((sum, el) => sum + parseMoneyInput(el.dataset.amount), 0));
    const isZeroValueTestCollection = jobIds.length > 0 && selectedPendingTotal === 0 && amountReceived === 0 && discount === 0;
    
    if (remainingToCover <= 0 && !isZeroValueTestCollection) {
      toast("El monto cobrado debe ser mayor a cero.");
      return;
    }
    
    const previousJobs = structuredClone(state.jobs);
    const previousClientPayments = structuredClone(state.clientPayments || []);
    let totalSelected = 0;
    let totalPaidBefore = 0;
    jobIds.forEach(id => {
      const job = state.jobs.find(j => j.id === id);
      if (job) {
        const jobCost = roundMoney(estimateJob(job));
        const alreadyPaid = roundMoney(parseMoneyInput(job.clientPaidAmount));
        const owe = Math.max(0, roundMoney(jobCost - alreadyPaid));
        totalSelected = roundMoney(totalSelected + jobCost);
        totalPaidBefore = roundMoney(totalPaidBefore + alreadyPaid);
        
        if (remainingToCover >= owe) {
          job.clientPaidAmount = jobCost;
          job.clientPaymentStatus = "paid";
          job.clientPaidDate = today();
          job.clientPaymentMethod = data.method;
          remainingToCover = roundMoney(remainingToCover - owe);
        } else if (remainingToCover > 0) {
          job.clientPaidAmount = roundMoney(alreadyPaid + remainingToCover);
          job.clientPaymentStatus = "partial";
          job.clientPaidDate = today();
          job.clientPaymentMethod = data.method;
          remainingToCover = 0;
        }
      }
    });

    const client = state.clients.find(c => c.id === data.client);
    const balanceAfter = Math.max(0, roundMoney(totalSelected - totalPaidBefore - amountReceived - discount));
    const clientPayment = {
      id: crypto.randomUUID(),
      clientId: data.client,
      clientName: client?.name || "Cliente",
      amountReceived,
      discount,
      subtotal: totalSelected,
      balanceAfter,
      method: data.method,
      jobIds,
      date: new Date().toLocaleString("es"),
      createdAt: new Date().toISOString()
    };
    state.clientPayments = [
      clientPayment,
      ...(state.clientPayments || [])
    ];

    try {
      await persistClientPaymentCritical(clientPayment, jobIds);
      renderAll();
      toast(balanceAfter > 0 ? `Cobro parcial registrado. Saldo pendiente: ${money(balanceAfter)}.` : "Cobro registrado exitosamente.");
      formEl.reset();
    } catch (error) {
      console.error("Error saving client payment:", error);
      saveLocalState();
      renderAll();
      toast(balanceAfter > 0 ? `Cobro guardado en respaldo. Saldo pendiente: ${money(balanceAfter)}.` : "Cobro guardado en respaldo.");
      formEl.reset();
    }
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
      portalUrl: data.portalUrl?.trim() || "",
    };
    if (data.vatRate !== undefined) state.vatRate = Number(data.vatRate || 0);
    if (data.currencySymbol) state.currencySymbol = data.currencySymbol;
    save();
    renderAll();
    toast("Perfil guardado.");
  });

  // Client Portal Settings Modal listeners
  $("#closeClientPortalSettingsModal")?.addEventListener("click", () => {
    $("#clientPortalSettingsModal").classList.add("hidden");
  });
  
  $("#cancelClientPortalSettings")?.addEventListener("click", () => {
    $("#clientPortalSettingsModal").classList.add("hidden");
  });
  
  $("#cpsGenerateCodeBtn")?.addEventListener("click", () => {
    const clientId = $("#cpsClientId").value;
    const client = state.clients.find(c => c.id === clientId);
    const newCode = generateBrandPasscode(client ? client.name : "");
    $("#cpsPortalPasscode").value = newCode;
  });
  
  $("#clientPortalSettingsForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const clientId = $("#cpsClientId").value;
    const client = state.clients.find(c => c.id === clientId);
    if (!client) return;
    
    client.portalActive = $("#cpsPortalActive").value === "true";
    client.portalPasscode = $("#cpsPortalPasscode").value.trim();
    
    save();
    renderAll();
    $("#clientPortalSettingsModal").classList.add("hidden");
    toast("Ajustes del portal guardados.");
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
      const previous = {
        signed: job.signed,
        siteSignerName: job.siteSignerName,
        siteSignature: job.siteSignature
      };
      job.signed = true;
      job.siteSignerName = $("#signatureReceiver").value;
      job.siteSignature = $("#signatureCanvas").toDataURL("image/png");

      if (supabaseClient) {
        try {
          await persistPortalSiteSignature(job);
        } catch (err) {
          console.error("Error saving site signature in portal mode:", err);
          Object.assign(job, previous);
          toast("No se pudo guardar la firma. Intenta nuevamente.");
          return;
        }
      }

      save();
      renderStandaloneCleanerPortal(true);
      closeSignatureModal();
      toast("Firma de salida guardada.");
      return;
    }
    const receipt = state.receipts.find((item) => item.id === signingReceiptId);
    if (!receipt) return;
    const previous = {
      receiver: receipt.receiver,
      signature: receipt.signature,
      status: receipt.status
    };
    receipt.receiver = $("#signatureReceiver").value;
    receipt.signature = $("#signatureCanvas").toDataURL("image/png");
    receipt.status = "signed";

    if (supabaseClient) {
      try {
        await persistPortalReceiptSignature(receipt);
      } catch (err) {
        console.error("Error saving receipt signature in portal mode:", err);
        Object.assign(receipt, previous);
        toast("No se pudo guardar la firma del pago. Intenta nuevamente.");
        return;
      }
    }

    save();
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
      const authForm = $("#authForm");
      const authScreenVisible = !$("#authScreen")?.classList.contains("hidden");
      const hasTypedCredentials = Boolean(
        authForm?.elements.email?.value?.trim() &&
        authForm?.elements.password?.value?.trim()
      );
      if (loginBtn && (!authScreenVisible || hasTypedCredentials || event === "INITIAL_SESSION")) {
        loginBtn.disabled = true;
        loginBtn.textContent = event === "INITIAL_SESSION" ? "Cargando sesión..." : "Iniciando...";
      }

      const user = session.user;
      state.user = user;

      try {
        await withTimeout(loadStateFromSupabase(user), 15000, "No se pudo cargar la cuenta.");
        await withTimeout(applyPaidPlanForCurrentUser(), 10000, "No se pudo validar el plan.");

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

          const oauthPlan = currentPlanKey();
          const dbPlanId = dbPlanIdForPlan(oauthPlan);
          const orgType = ["free", "independent"].includes(oauthPlan) ? "independent" : "company";
          const { data: org, error: orgError } = await supabaseClient.from('organizations').insert({
            name: `${user.user_metadata?.full_name || user.email.split('@')[0]}'s Company`,
            type: orgType,
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
        toast("No se pudo cargar la cuenta. Revisa internet y presiona Ingresar otra vez.");

        const __urlParams = new URLSearchParams(location.search);
        const __portalType = __urlParams.get("portal");
        const __path = window.location.pathname.toLowerCase();
        if (!(__portalType === "client" || __portalType === "cleaner" || __path.includes("portal-clientes") || __path.includes("portal-cleaners"))) {
          $("#appShell").classList.add("hidden");
          $("#authScreen").classList.remove("hidden");
          if (loginBtn) {
            resetAuthSubmitButton();
          }
        }

        resetAuthSubmitButton();
      }
    } else {
      // Re-enable form buttons if they are signed out
      const loginBtn = $("#authForm button[type='submit']");
      if (loginBtn) {
        resetAuthSubmitButton();
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
      state.clientPayments = [];

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
let countdownValue = 300;
const MAX_IDLE_MINUTES = 5;
const IDLE_COUNTDOWN_SECONDS = 300;

function shouldTrackIdleSession() {
  const appShell = $("#appShell");
  const authScreen = $("#authScreen");
  const path = window.location.pathname.toLowerCase();
  const params = new URLSearchParams(location.search);
  const isPortal = params.get("portal") === "client" || params.get("portal") === "cleaner" || path.includes("portal-clientes") || path.includes("portal-cleaners");
  return Boolean(state.user && appShell && !appShell.classList.contains("hidden") && authScreen?.classList.contains("hidden") && !isPortal);
}

function resetIdleTime(keepSession = false) {
  idleTime = 0;
  if (keepSession && $("#idleTimeoutModal") && !$("#idleTimeoutModal").classList.contains("hidden")) {
    $("#idleTimeoutModal").classList.add("hidden");
    clearInterval(countdownInterval);
  }
}

function checkIdleTime() {
  if (!shouldTrackIdleSession()) {
    resetIdleTime();
    return;
  }
  idleTime++;
  
  if (idleTime >= MAX_IDLE_MINUTES) {
    showIdleModal();
  }
}

function idleModalCopy() {
  const lang = state.language || localStorage.getItem("jobvisto-language") || "es";
  const copy = {
    es: {
      security: "Seguridad de sesion",
      title: "Sigues trabajando en JobVisto?",
      body: "Por seguridad, tu sesion se cerrara automaticamente si no confirmas que sigues activo.",
      seconds: "segundos",
      stay: "Seguir conectado",
      logout: "Cerrar sesion",
      rtl: false
    },
    en: {
      security: "Session security",
      title: "Are you still working in JobVisto?",
      body: "For security, your session will close automatically if you do not confirm that you are still active.",
      seconds: "seconds",
      stay: "Stay connected",
      logout: "Log out",
      rtl: false
    },
    ru: {
      security: "Безопасность сессии",
      title: "Вы все еще работаете в JobVisto?",
      body: "В целях безопасности сессия закроется автоматически, если вы не подтвердите активность.",
      seconds: "секунд",
      stay: "Остаться в системе",
      logout: "Выйти",
      rtl: false
    },
    he: {
      security: "אבטחת התחברות",
      title: "האם אתה עדיין עובד ב-JobVisto?",
      body: "מטעמי אבטחה, ההתחברות תיסגר אוטומטית אם לא תאשר שאתה עדיין פעיל.",
      seconds: "שניות",
      stay: "להישאר מחובר",
      logout: "התנתק",
      rtl: true
    }
  };
  return copy[lang] || copy.es;
}

function applyIdleModalCopy() {
  const copy = idleModalCopy();
  const card = $(".idle-brand-card");
  if (card) card.setAttribute("dir", copy.rtl ? "rtl" : "ltr");
  $("#idleSecurityLabel").textContent = copy.security;
  $("#idleTitle").textContent = copy.title;
  $("#idleBody").textContent = copy.body;
  $("#idleSecondsLabel").textContent = copy.seconds;
  $("#stayLoggedInButton").textContent = copy.stay;
  $("#logOutNowButton").textContent = copy.logout;
}

function showIdleModal() {
  const modal = $("#idleTimeoutModal");
  if (!modal || !modal.classList.contains("hidden")) return;
  
  modal.classList.remove("hidden");
  countdownValue = IDLE_COUNTDOWN_SECONDS;
  applyIdleModalCopy();
  $("#idleCountdown").textContent = countdownValue;
  $("#idleCountdownEn").textContent = countdownValue;
  $("#idleCountdownVisual").textContent = countdownValue;
  
  clearInterval(countdownInterval);
  countdownInterval = setInterval(() => {
    countdownValue--;
    $("#idleCountdown").textContent = countdownValue;
    $("#idleCountdownEn").textContent = countdownValue;
    $("#idleCountdownVisual").textContent = countdownValue;
    
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
  state.user = null;
  state.orgId = null;
  window.location.reload();
}

// Attach idle listeners
["mousemove", "keydown", "touchstart", "scroll"].forEach(event => {
  window.addEventListener(event, () => {
    const idleModal = $("#idleTimeoutModal");
    if (idleModal && !idleModal.classList.contains("hidden")) return;
    resetIdleTime();
  }, { passive: true });
});

// Check every minute
idleInterval = setInterval(checkIdleTime, 60000);

if ($("#stayLoggedInButton")) {
  $("#stayLoggedInButton").addEventListener("click", () => resetIdleTime(true));
}
if ($("#logOutNowButton")) {
  $("#logOutNowButton").addEventListener("click", forceLogOut);
}
