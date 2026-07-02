import { json, processAutomaticNotifications, sendJobNotification, sendTestNotification } from "./_shared/jobvisto-notifications.mjs";

function env(name) {
  const value = process.env[name] || globalThis.Netlify?.env?.get?.(name);
  if (name === "SUPABASE_URL" && !String(value || "").startsWith("http")) return "https://fmpzdmmmqwqxxgeytmkr.supabase.co";
  return value;
}

function restValue(value) {
  return encodeURIComponent(String(value ?? ""));
}

function isAuthorized(req) {
  const secret = env("NOTIFICATION_RUN_SECRET");
  if (!secret) return false;
  return req.headers.get("x-notification-secret") === secret;
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
      "Content-Type": "application/json"
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Supabase ${method} ${path} failed: ${JSON.stringify(data)}`);
  return data;
}

function cleanerKeyMatches(cleaner, key) {
  const given = String(key || "").trim().toUpperCase();
  if (!given) return false;
  const passcode = String(cleaner?.portal_passcode || "").trim().toUpperCase();
  const accessKey = String(cleaner?.access_key || "").trim().toUpperCase();
  return Boolean((passcode && passcode === given) || (accessKey && accessKey === given));
}

async function authorizeCleanerJob({ cleanerId, cleanerKey, jobId }) {
  const [cleaners, jobs] = await Promise.all([
    supabaseFetch("/rest/v1/cleaners", {
      query: `?id=eq.${restValue(cleanerId)}&select=id,access_key,portal_passcode,archived&limit=1`
    }),
    supabaseFetch("/rest/v1/jobs", {
      query: `?id=eq.${restValue(jobId)}&select=id,assigned_cleaner_id&limit=1`
    })
  ]);
  const cleaner = Array.isArray(cleaners) ? cleaners[0] : null;
  const job = Array.isArray(jobs) ? jobs[0] : null;
  if (!cleaner || cleaner.archived || !cleanerKeyMatches(cleaner, cleanerKey)) throw new Error("Invalid cleaner access.");
  if (!job || job.assigned_cleaner_id !== cleaner.id) throw new Error("Cleaner is not assigned to this job.");
}

export default async (req, context) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const siteUrl = globalThis.Netlify?.env?.get?.("URL") || context?.site?.url;

    if (body.action === "job-event") {
      const event = String(body.event || "");
      if (!["on_way", "finished"].includes(event)) return json({ error: "Unsupported notification event" }, 400);
      await authorizeCleanerJob(body);
      return json(await sendJobNotification({ event, jobId: body.jobId, siteUrl }));
    }

    if (!isAuthorized(req)) return json({ error: "Missing notification secret" }, 403);

    if (body.action === "test") {
      return json(await sendTestNotification(body.to));
    }

    return json(await processAutomaticNotifications({ siteUrl }));
  } catch (error) {
    console.error("Notification action failed:", error);
    return json({ error: error.message || "Notification action failed" }, 500);
  }
};

export const config = {
  path: "/api/app-notifications"
};
