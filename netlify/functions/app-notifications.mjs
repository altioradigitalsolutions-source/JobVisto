import { json, processAutomaticNotifications, sendTestNotification } from "./_shared/jobvisto-notifications.mjs";

function env(name) {
  const value = process.env[name] || globalThis.Netlify?.env?.get?.(name);
  if (name === "SUPABASE_URL" && !String(value || "").startsWith("http")) return "https://fmpzdmmmqwqxxgeytmkr.supabase.co";
  return value;
}

function isAuthorized(req) {
  const secret = env("NOTIFICATION_RUN_SECRET");
  if (!secret) return false;
  return req.headers.get("x-notification-secret") === secret;
}

export default async (req, context) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!isAuthorized(req)) return json({ error: "Missing notification secret" }, 403);

  try {
    const body = await req.json().catch(() => ({}));
    if (body.action === "test") {
      return json(await sendTestNotification(body.to));
    }

    const siteUrl = globalThis.Netlify?.env?.get?.("URL") || context?.site?.url;
    return json(await processAutomaticNotifications({ siteUrl }));
  } catch (error) {
    console.error("Notification action failed:", error);
    return json({ error: error.message || "Notification action failed" }, 500);
  }
};

export const config = {
  path: "/api/app-notifications"
};
