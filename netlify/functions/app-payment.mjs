function env(name) {
  return globalThis.Netlify?.env?.get ? globalThis.Netlify.env.get(name) : process.env[name];
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function cleanUuidArray(values) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return Array.isArray(values) ? values.filter((value) => uuid.test(String(value || ""))) : [];
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
  return [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)];
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
    throw new Error("User is not an organization admin.");
  }
}

async function upsertSetting(organizationId, key, value) {
  await supabaseFetch("/rest/v1/organization_settings", {
    method: "POST",
    query: "?on_conflict=organization_id,key",
    body: {
      organization_id: organizationId,
      key,
      value
    }
  });
}

async function persistCleanerPayment(organizationId, receipt = {}, backups = {}) {
  const [periodStart, periodEnd] = periodDates(receipt.period, receipt.createdAt || receipt.date);
  const cleanerId = receipt.cleanerId;
  if (!cleanerId) throw new Error("Cleaner id is missing.");

  await supabaseFetch("/rest/v1/payment_receipts", {
    method: "POST",
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
    }
  });

  await upsertSetting(organizationId, "payment_receipts_backup", { receipts: backups.receipts || [] });
}

async function persistClientPayment(organizationId, payment = {}, backups = {}) {
  const jobIds = cleanUuidArray(payment.jobIds);
  const jobs = Array.isArray(backups.jobs) ? backups.jobs.filter((job) => jobIds.includes(job.id)) : [];

  for (const job of jobs) {
    await supabaseFetch(`/rest/v1/jobs?id=eq.${encodeURIComponent(job.id)}&organization_id=eq.${encodeURIComponent(organizationId)}`, {
      method: "PATCH",
      body: {
        client_paid_amount: money(job.clientPaidAmount),
        client_payment_status: job.clientPaymentStatus || "unpaid",
        client_paid_date: job.clientPaidDate || null,
        client_payment_method: job.clientPaymentMethod || null
      }
    });
  }

  await supabaseFetch("/rest/v1/client_payment_receipts", {
    method: "POST",
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
    }
  });

  await upsertSetting(organizationId, "client_payment_receipts_backup", { payments: backups.clientPayments || [] });
  await upsertSetting(organizationId, "jobs_payment_state_backup", { jobs: backups.jobs || [] });
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json();
    const organizationId = body.organizationId;
    if (!organizationId) return json({ error: "Missing organization id" }, 400);

    await assertOrgAdmin(req, organizationId);

    if (body.type === "cleaner_payment") {
      await persistCleanerPayment(organizationId, body.receipt, body.backups);
      return json({ ok: true });
    }

    if (body.type === "client_payment") {
      await persistClientPayment(organizationId, body.payment, body.backups);
      return json({ ok: true });
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
