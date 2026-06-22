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

function restValue(value) {
  return encodeURIComponent(String(value ?? ""));
}

async function supabaseFetch(path, { method = "GET", body, query = "" } = {}) {
  const supabaseUrl = env("SUPABASE_URL");
  const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) throw new Error("Supabase server variables are missing.");

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

  const memberQuery = `?organization_id=eq.${restValue(organizationId)}&user_id=eq.${restValue(user.id)}&status=eq.active&role=in.(owner,manager)&select=id`;
  const memberships = await supabaseFetch("/rest/v1/organization_members", { query: memberQuery });
  if (Array.isArray(memberships) && memberships.length) return;

  const ownerQuery = `?id=eq.${restValue(organizationId)}&owner_user_id=eq.${restValue(user.id)}&select=id`;
  const owned = await supabaseFetch("/rest/v1/organizations", { query: ownerQuery });
  if (!Array.isArray(owned) || !owned.length) throw new Error("User is not an organization admin.");
}

function cleanJob(row = {}) {
  if (!isUuid(row.id) || !isUuid(row.organization_id) || !isUuid(row.client_id)) {
    throw new Error("Job has invalid ids.");
  }
  return {
    id: row.id,
    organization_id: row.organization_id,
    client_id: row.client_id,
    assigned_cleaner_id: isUuid(row.assigned_cleaner_id) ? row.assigned_cleaner_id : null,
    service_type: row.service_type || "Limpieza normal",
    scheduled_start: row.scheduled_start,
    scheduled_end: row.scheduled_end || null,
    actual_start: row.actual_start || null,
    actual_end: row.actual_end || null,
    client_hourly_rate: Number(row.client_hourly_rate || 0),
    extras_amount: Number(row.extras_amount || 0),
    request_review: Boolean(row.request_review),
    client_rating: row.client_rating || null,
    client_review_text: row.client_review_text || null,
    client_paid_amount: Number(row.client_paid_amount || 0),
    client_payment_status: row.client_payment_status || "unpaid",
    client_paid_date: row.client_paid_date || null,
    client_payment_method: row.client_payment_method || null,
    cleaner_on_way_at: row.cleaner_on_way_at || null,
    cleaner_lat: row.cleaner_lat || null,
    cleaner_lng: row.cleaner_lng || null,
    cleaner_location_accuracy: row.cleaner_location_accuracy || null,
    cleaner_location_at: row.cleaner_location_at || null,
    status: row.status || "scheduled",
    checklist: Array.isArray(row.checklist) ? row.checklist : []
  };
}

async function saveJobPayload(payload = {}) {
  const organizationId = payload.organizationId;
  if (!isUuid(organizationId)) throw new Error("Missing organization id.");

  if (payload.client) {
    await supabaseFetch("/rest/v1/clients", {
      method: "POST",
      query: "?on_conflict=id",
      body: payload.client
    });
  }

  if (payload.clientAddress) {
    try {
      await supabaseFetch("/rest/v1/client_addresses", {
        method: "POST",
        query: "?on_conflict=client_id",
        body: payload.clientAddress
      });
    } catch (error) {
      console.warn("Client address save skipped while saving job:", error);
    }
  }

  if (payload.cleaner) {
    await supabaseFetch("/rest/v1/cleaners", {
      method: "POST",
      query: "?on_conflict=id",
      body: payload.cleaner
    });
  }

  const jobs = (Array.isArray(payload.jobs) ? payload.jobs : [payload.job]).filter(Boolean).map(cleanJob);
  if (!jobs.length) throw new Error("No jobs to save.");
  await supabaseFetch("/rest/v1/jobs", {
    method: "POST",
    query: "?on_conflict=id",
    body: jobs
  });
  return { saved: jobs.length };
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const payload = await req.json();
    await assertOrgAdmin(req, payload.organizationId);
    const result = await saveJobPayload(payload);
    return json({ ok: true, ...result });
  } catch (error) {
    console.error("App job save failed:", error);
    return json({ error: error.message || "Job save failed" }, 500);
  }
};

export const config = {
  path: "/api/app-job"
};
