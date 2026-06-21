import { processAutomaticNotifications } from "./_shared/jobvisto-notifications.mjs";

export default async (req, context) => {
  const siteUrl = globalThis.Netlify?.env?.get?.("URL") || context?.site?.url;
  const result = await processAutomaticNotifications({ siteUrl });
  console.log("JobVisto automatic notifications:", JSON.stringify(result));
};

export const config = {
  schedule: "@hourly"
};
