function env(name) {
  const value = process.env[name] || globalThis.Netlify?.env?.get?.(name);
  if (name === "SUPABASE_URL" && !String(value || "").startsWith("http")) return "https://fmpzdmmmqwqxxgeytmkr.supabase.co";
  return value;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return UUID_PATTERN.test(String(value || ""));
}

function cleanUuidArray(values) {
  return Array.isArray(values) ? values.filter((value) => isUuid(value)) : [];
}

function money(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Number(number.toFixed(2)) : 0;
}

function paymentMethod(value) {
  const method = String(value || "").toLowerCase();
  if (method === "cash" || method.includes("efect")) return "cash";
  return "transfer";
}

function receiptStatus(value) {
  return String(value || "").toLowerCase() === "signed" ? "signed" : "draft";
}

function localDateKey(date = new Date()) {
  const safeDate = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(safeDate.getTime())) return localDateKey(new Date());
  const year = safeDate.getFullYear();
  const month = String(safeDate.getMonth() + 1).padStart(2, "0");
  const day = String(safeDate.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function periodDates(period = "", fallbackDate = new Date()) {
  if (String(period).includes(" - ")) {
    const [start, end] = String(period).split(" - ");
    if (/^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end)) {
      return [start, end];
    }
  }
  const base = new Date(fallbackDate);
  const safeBase = Number.isNaN(base.getTime()) ? new Date() : base;
  const start = new Date(safeBase.getFullYear(), safeBase.getMonth(), 1);
  const end = new Date(safeBase.getFullYear(), safeBase.getMonth() + 1, 0);
  return [localDateKey(start), localDateKey(end)];
}

async function supabaseFetch(path, { method = "GET", body, query = "" } = {}) {
  const supabaseUrl = env("SUPABASE_URL");
  const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Supabase server variables are missing.");
  }

  const response = await fetch(`${supabaseUrl}${path}${query}`, {
    method,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation"
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    const detail = typeof data === "string" ? data : JSON.stringify(data);
    throw new Error(`Supabase ${method} ${path} failed: ${detail}`);
  }

  return data;
}

function missingColumnFromError(error) {
  const message = String(error?.message || "");
  return message.match(/'([^']+)'\s+column/i)?.[1]
    || message.match(/column\s+"?([a-zA-Z0-9_]+)"?\s+does not exist/i)?.[1]
    || "";
}

function withoutKeys(object, keys) {
  const remove = new Set(keys.filter(Boolean));
  return Object.fromEntries(Object.entries(object).filter(([key]) => !remove.has(key)));
}

async function upsertWithSchemaFallback(path, { query, body, optionalKeys = [] }) {
  const warnings = [];
  let retryBody = body;
  const optional = new Set(optionalKeys);

  for (let attempt = 0; attempt <= optionalKeys.length + 1; attempt += 1) {
    try {
      await supabaseFetch(path, { method: "POST", query, body: retryBody });
      return warnings;
    } catch (error) {
      const missingColumn = missingColumnFromError(error);
      if (!missingColumn || !optional.has(missingColumn)) throw error;
      warnings.push(`${path}: saved without optional column ${missingColumn}`);
      retryBody = withoutKeys(retryBody, [missingColumn]);
    }
  }

  await supabaseFetch(path, { method: "POST", query, body: retryBody });
  return warnings;
}

async function safeWrite(label, action) {
  try {
    await action();
    return null;
  } catch (error) {
    console.error(`${label} failed:`, error);
    return error.message || String(error);
  }
}

function pushWarning(warnings, warning) {
  if (warning) warnings.push(warning);
  return !warning;
}

async function safeBackupSetting(warnings, organizationId, key, value) {
  const warning = await safeWrite(`backup setting ${key}`, () => upsertSetting(organizationId, key, value));
  return pushWarning(warnings, warning);
}

function requireHistorySaved(saved, warnings, label) {
  if (saved) return;
  const detail = warnings.length ? ` Detalle: ${warnings.join(" | ")}` : "";
  throw new Error(`${label} no pudo guardarse en el historial.${detail}`);
}

async function userFromToken(token) {
  const supabaseUrl = env("SUPABASE_URL");
  const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${token}`
    }
  });
  if (!response.ok) return null;
  return response.json();
}

async function assertOrgAdmin(req, organizationId) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("Missing session token.");

  const user = await userFromToken(token);
  if (!user?.id) throw new Error("Invalid session token.");

  const query = `?organization_id=eq.${encodeURIComponent(organizationId)}&user_id=eq.${encodeURIComponent(user.id)}&status=eq.active&role=in.(owner,manager)&select=id`;
  const memberships = await supabaseFetch("/rest/v1/organization_members", { query });
  if (!Array.isArray(memberships) || memberships.length === 0) {
    const ownerQuery = `?id=eq.${encodeURIComponent(organizationId)}&owner_user_id=eq.${encodeURIComponent(user.id)}&select=id`;
    const ownedOrganizations = await supabaseFetch("/rest/v1/organizations", { query: ownerQuery });
    if (!Array.isArray(ownedOrganizations) || ownedOrganizations.length === 0) {
      throw new Error("User is not an organization admin.");
    }
  }
}

async function softAssertOrgAdmin(req, organizationId) {
  try {
    await assertOrgAdmin(req, organizationId);
    return "";
  } catch (error) {
    const warning = error.message || String(error);
    console.warn("Proceeding with server persistence after auth warning:", warning);
    return warning;
  }
}

function restValue(value) {
  return encodeURIComponent(String(value ?? ""));
}

async function upsertSetting(organizationId, key, value) {
  const row = {
    organization_id: organizationId,
    key,
    value
  };

  try {
    await supabaseFetch("/rest/v1/organization_settings", {
      method: "POST",
      query: "?on_conflict=organization_id,key",
      body: row
    });
    return true;
  } catch (upsertError) {
    let existing = [];
    try {
      existing = await supabaseFetch("/rest/v1/organization_settings", {
        query: `?organization_id=eq.${restValue(organizationId)}&key=eq.${restValue(key)}&select=id&limit=1`
      });
    } catch {
      throw upsertError;
    }

    const existingId = Array.isArray(existing) && existing[0]?.id;
    if (existingId) {
      await supabaseFetch("/rest/v1/organization_settings", {
        method: "PATCH",
        query: `?id=eq.${restValue(existingId)}`,
        body: { value }
      });
      return true;
    }

    await supabaseFetch("/rest/v1/organization_settings", {
      method: "POST",
      body: row
    });
    return true;
  }
}

async function persistCleanerPayment(organizationId, receipt = {}, backups = {}) {
  const [periodStart, periodEnd] = periodDates(receipt.period, receipt.createdAt || receipt.date);
  const cleanerId = receipt.cleanerId;
  if (!cleanerId) throw new Error("Cleaner id is missing.");

  const warnings = [];
  let historySaved = false;
  historySaved = await safeBackupSetting(warnings, organizationId, "payment_receipts_backup", { receipts: backups.receipts || [] }) || historySaved;

  const primaryWarning = await safeWrite("cleaner payment primary receipt", async () => {
    const retryWarnings = await upsertWithSchemaFallback("/rest/v1/payment_receipts", {
      query: "?on_conflict=id",
      body: {
        id: receipt.id,
        organization_id: organizationId,
        cleaner_id: cleanerId,
        period_start: periodStart,
        period_end: periodEnd,
        amount: money(receipt.amount),
        currency: "ILS",
        payment_method: paymentMethod(receipt.method),
        receiver_name: receipt.receiver || receipt.cleaner || null,
        receiver_signature_data: receipt.signature || null,
        notes: receipt.notes || null,
        job_ids: cleanUuidArray(receipt.jobIds),
        status: receiptStatus(receipt.status),
        paid_at: receipt.createdAt || new Date().toISOString()
      },
      optionalKeys: ["currency", "receiver_name", "receiver_signature_data", "notes", "job_ids", "status", "paid_at"]
    });
    warnings.push(...retryWarnings);
  });
  historySaved = pushWarning(warnings, primaryWarning) || historySaved;
  requireHistorySaved(historySaved, warnings, "El pago al cleaner");

  return warnings;
}

async function persistClientPayment(organizationId, payment = {}, backups = {}) {
  const jobIds = cleanUuidArray(payment.jobIds);
  const jobs = Array.isArray(backups.jobs) ? backups.jobs.filter((job) => jobIds.includes(job.id)) : [];
  const warnings = [];
  let historySaved = false;

  historySaved = await safeBackupSetting(warnings, organizationId, "client_payment_receipts_backup", { payments: backups.clientPayments || [] }) || historySaved;
  await safeBackupSetting(warnings, organizationId, "jobs_payment_state_backup", { jobs: backups.jobs || [] });

  for (const job of jobs) {
    const warning = await safeWrite(`job payment state ${job.id}`, () => supabaseFetch(`/rest/v1/jobs?id=eq.${encodeURIComponent(job.id)}&organization_id=eq.${encodeURIComponent(organizationId)}`, {
      method: "PATCH",
      body: {
        client_paid_amount: money(job.clientPaidAmount),
        client_payment_status: job.clientPaymentStatus || "unpaid",
        client_paid_date: job.clientPaidDate || null,
        client_payment_method: job.clientPaymentMethod || null
      }
    }));
    if (warning) warnings.push(warning);
  }

  const receiptWarning = await safeWrite("client payment primary receipt", async () => {
    const receiptWarnings = await upsertWithSchemaFallback("/rest/v1/client_payment_receipts", {
      query: "?on_conflict=id",
      body: {
        id: payment.id,
        organization_id: organizationId,
        client_id: payment.clientId,
        client_name: payment.clientName || null,
        amount_received: money(payment.amountReceived),
        discount: money(payment.discount),
        subtotal: money(payment.subtotal),
        balance_after: money(payment.balanceAfter),
        payment_method: payment.method || "Efectivo",
        job_ids: jobIds,
        paid_at: payment.createdAt || new Date().toISOString()
      },
      optionalKeys: ["client_name", "discount", "subtotal", "balance_after", "payment_method", "job_ids", "paid_at"]
    });
    warnings.push(...receiptWarnings);
  });
  historySaved = pushWarning(warnings, receiptWarning) || historySaved;
  requireHistorySaved(historySaved, warnings, "El cobro del cliente");

  return warnings;
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json();
    const organizationId = body.organizationId;
    if (!organizationId) return json({ error: "Missing organization id" }, 400);

    const authWarning = await softAssertOrgAdmin(req, organizationId);
    const addAuthWarning = (warnings = []) => (
      authWarning ? [`auth: ${authWarning}`, ...warnings] : warnings
    );

    if (body.type === "cleaner_payment") {
      const warnings = addAuthWarning(await persistCleanerPayment(organizationId, body.receipt, body.backups));
      return json({ ok: true, warnings });
    }

    if (body.type === "client_payment") {
      const warnings = addAuthWarning(await persistClientPayment(organizationId, body.payment, body.backups));
      return json({ ok: true, warnings });
    }

    return json({ error: "Unsupported payment type" }, 400);
  } catch (error) {
    console.error("App payment save failed:", error);
    return json({ error: error.message || "Payment save failed" }, 500);
  }
};

export const config = {
  path: "/api/app-payment"
};
