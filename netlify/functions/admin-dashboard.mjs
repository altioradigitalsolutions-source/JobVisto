function env(name) {
  const netlifyValue = globalThis.Netlify?.env?.get?.(name);
  const value = netlifyValue || process.env[name];
  if (name === "SUPABASE_URL" && !String(value || "").startsWith("http")) return "https://aofsfxwfvagzgnhiyntb.supabase.co";
  return value;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_STATUSES = new Set(["active", "inactive"]);

function isUuid(value) {
  return UUID_PATTERN.test(String(value || ""));
}

function restValue(value) {
  return encodeURIComponent(String(value ?? ""));
}

async function supabaseFetch(path, { method = "GET", body, query = "", prefer = "return=representation" } = {}) {
  const supabaseUrl = env("SUPABASE_URL");
  const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) throw new Error("Supabase server variables are missing.");

  const response = await fetch(`${supabaseUrl}${path}${query}`, {
    method,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: prefer
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
  if (!supabaseUrl || !serviceRoleKey) throw new Error("Supabase server variables are missing.");

  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${token}`
    }
  });
  if (!response.ok) return null;
  return response.json();
}

async function assertAdmin(req) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("Missing session token.");

  const user = await userFromToken(token);
  if (!user?.email) throw new Error("Invalid session token.");

  const configuredAdminEmail = String(env("ADMIN_EMAIL") || env("JOBVISTO_ADMIN_EMAIL") || "jobvisto@zohomail.com").toLowerCase();
  if (String(user.email).toLowerCase() !== configuredAdminEmail) {
    throw new Error("Admin access denied.");
  }

  return user;
}

function latestByOrganization(rows = []) {
  const map = new Map();
  rows.forEach((row) => {
    const orgId = row.organization_id;
    if (!orgId) return;
    const current = map.get(orgId);
    const rowTime = new Date(row.updated_at || row.created_at || 0).getTime();
    const currentTime = new Date(current?.updated_at || current?.created_at || 0).getTime();
    if (!current || rowTime >= currentTime) map.set(orgId, row);
  });
  return map;
}

function latestPaymentByEmail(rows = []) {
  const map = new Map();
  rows.forEach((row) => {
    const email = String(row.email || "").toLowerCase();
    if (!email) return;
    const current = map.get(email);
    const rowTime = new Date(row.created_at || 0).getTime();
    const currentTime = new Date(current?.created_at || 0).getTime();
    if (!current || rowTime >= currentTime) map.set(email, row);
  });
  return map;
}

function paymentState({ organization, owner, subscription, stripePayment }) {
  if (organization.plan_id === "free") return "paid";

  const subscriptionStatus = String(subscription?.status || "").toLowerCase();
  const periodEnd = subscription?.current_period_end ? new Date(subscription.current_period_end) : null;
  const periodIsCurrent = periodEnd && !Number.isNaN(periodEnd.getTime()) ? periodEnd.getTime() >= Date.now() : true;
  if (["active", "trialing", "paid"].includes(subscriptionStatus) && periodIsCurrent) return "paid";

  const stripeStatus = String(stripePayment?.payment_status || "").toLowerCase();
  if (["paid", "succeeded", "complete", "active"].includes(stripeStatus)) return "paid";
  if (subscriptionStatus === "pending" || stripeStatus === "pending") return "pending";

  return owner?.email ? "unpaid" : "pending";
}

async function getDashboardData() {
  const [organizations, profiles, plans, subscriptions, stripePayments] = await Promise.all([
    supabaseFetch("/rest/v1/organizations", {
      query: "?select=id,name,type,owner_user_id,plan_id,status,created_at,updated_at&order=created_at.desc"
    }),
    supabaseFetch("/rest/v1/profiles", {
      query: "?select=id,full_name,email,created_at"
    }),
    supabaseFetch("/rest/v1/plans", {
      query: "?select=id,name,is_active,monthly_price,plan_type&order=monthly_price.asc"
    }),
    supabaseFetch("/rest/v1/subscriptions", {
      query: "?select=id,organization_id,plan_id,status,current_period_end,created_at,updated_at&order=created_at.desc"
    }),
    supabaseFetch("/rest/v1/stripe_payments", {
      query: "?select=email,plan_id,payment_status,billing_cycle,created_at&order=created_at.desc"
    })
  ]);

  const profilesById = new Map((Array.isArray(profiles) ? profiles : []).map((profile) => [profile.id, profile]));
  const plansById = new Map((Array.isArray(plans) ? plans : []).map((plan) => [plan.id, plan]));
  const subscriptionsByOrg = latestByOrganization(Array.isArray(subscriptions) ? subscriptions : []);
  const paymentsByEmail = latestPaymentByEmail(Array.isArray(stripePayments) ? stripePayments : []);

  const clients = (Array.isArray(organizations) ? organizations : []).map((organization) => {
    const owner = profilesById.get(organization.owner_user_id) || {};
    const plan = plansById.get(organization.plan_id) || {};
    const subscription = subscriptionsByOrg.get(organization.id);
    const stripePayment = paymentsByEmail.get(String(owner.email || "").toLowerCase());
    const status = organization.status === "active" ? "active" : "inactive";

    return {
      organization_id: organization.id,
      name: organization.name,
      organization_type: organization.type,
      owner_user_id: organization.owner_user_id,
      full_name: owner.full_name || "",
      email: owner.email || "",
      plan_id: organization.plan_id || "",
      plan_name: plan.name || organization.plan_id || "Sin plan",
      status,
      payment_status: paymentState({ organization, owner, subscription, stripePayment }),
      subscription_status: subscription?.status || "",
      created_at: organization.created_at,
      updated_at: organization.updated_at
    };
  });

  const summary = {
    total: clients.length,
    active: clients.filter((client) => client.status === "active").length,
    inactive: clients.filter((client) => client.status !== "active").length,
    paid: clients.filter((client) => client.payment_status === "paid").length
  };

  return {
    summary,
    clients,
    plans: (Array.isArray(plans) ? plans : []).filter((plan) => plan.is_active)
  };
}

async function updateOrganization(payload = {}) {
  const organizationId = payload.organizationId;
  if (!isUuid(organizationId)) throw new Error("Missing organization id.");

  const updates = {};
  if (payload.status !== undefined) {
    if (!ALLOWED_STATUSES.has(payload.status)) throw new Error("Invalid organization status.");
    updates.status = payload.status;
  }

  if (payload.planId !== undefined) {
    const planId = String(payload.planId || "").trim();
    const plans = await supabaseFetch("/rest/v1/plans", {
      query: `?id=eq.${restValue(planId)}&is_active=eq.true&select=id`
    });
    if (!Array.isArray(plans) || plans.length === 0) throw new Error("Invalid plan.");
    updates.plan_id = planId;
  }

  if (Object.keys(updates).length === 0) throw new Error("No manual change provided.");
  updates.updated_at = new Date().toISOString();

  await supabaseFetch("/rest/v1/organizations", {
    method: "PATCH",
    query: `?id=eq.${restValue(organizationId)}`,
    body: updates,
    prefer: "return=minimal"
  });
}

export default async (req) => {
  try {
    await assertAdmin(req);

    if (req.method === "GET") {
      return json(await getDashboardData());
    }

    if (req.method === "POST") {
      const payload = await req.json();
      await updateOrganization(payload);
      return json({ ok: true, ...(await getDashboardData()) });
    }

    return json({ error: "Method not allowed" }, 405);
  } catch (error) {
    console.error("Admin dashboard failed:", error);
    const message = error.message || "Admin dashboard failed.";
    const status = /denied|invalid session|missing session/i.test(message) ? 403 : 500;
    return json({ error: message }, status);
  }
};

export const config = {
  path: "/api/admin-dashboard"
};
