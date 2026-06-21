function env(name) {
  return globalThis.Netlify?.env?.get ? globalThis.Netlify.env.get(name) : process.env[name];
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function restValue(value) {
  return encodeURIComponent(String(value ?? ""));
}

function normalizeKey(value) {
  return String(value || "").trim().toUpperCase();
}

function fallbackClientPortalKey(client = {}) {
  return `JV-${String(client.name || "").slice(0, 3).toUpperCase()}-${String(client.id || "").slice(-2)}`;
}

function clientPortalKeyMatches(client = {}, key = "") {
  if (client.archived || client.portal_active === false) return false;
  const expected = normalizeKey(client.portal_passcode || fallbackClientPortalKey(client));
  return expected && expected === normalizeKey(key);
}

function optionalRating(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 5) return null;
  return number;
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
      Prefer: "return=representation"
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

async function persistClientReview({ clientId, clientKey, jobId, rating, reviewText, cleanerFeedback = {} }) {
  const cleanRating = Number(rating);
  if (!clientId || !clientKey || !jobId) throw new Error("Missing portal review data.");
  if (!Number.isInteger(cleanRating) || cleanRating < 1 || cleanRating > 5) {
    throw new Error("Rating must be between 1 and 5.");
  }

  const clients = await supabaseFetch("/rest/v1/clients", {
    query: `?id=eq.${restValue(clientId)}&select=id,organization_id,name,portal_passcode,portal_active,archived&limit=1`
  });
  const client = Array.isArray(clients) ? clients[0] : null;
  if (!client || !clientPortalKeyMatches(client, clientKey)) throw new Error("Invalid client portal access.");

  const jobs = await supabaseFetch("/rest/v1/jobs", {
    query: `?id=eq.${restValue(jobId)}&client_id=eq.${restValue(client.id)}&organization_id=eq.${restValue(client.organization_id)}&select=id,request_review&limit=1`
  });
  const job = Array.isArray(jobs) ? jobs[0] : null;
  if (!job) throw new Error("Job not available for this client.");

  const baseBody = {
    client_rating: cleanRating,
    client_review_text: String(reviewText || "").trim() || null,
    request_review: true,
    updated_at: new Date().toISOString()
  };
  const qualityBody = {
    ...baseBody,
    cleaner_quality_rating: optionalRating(cleanerFeedback.qualityRating),
    cleaner_punctuality_rating: optionalRating(cleanerFeedback.punctualityRating),
    cleaner_professionalism_rating: optionalRating(cleanerFeedback.professionalismRating),
    cleaner_quality_text: String(cleanerFeedback.qualityText || "").trim() || null,
    cleaner_recommended: typeof cleanerFeedback.recommended === "boolean" ? cleanerFeedback.recommended : null
  };

  try {
    await supabaseFetch("/rest/v1/jobs", {
      method: "PATCH",
      query: `?id=eq.${restValue(job.id)}`,
      body: qualityBody
    });
  } catch (error) {
    if (!String(error.message || "").includes("cleaner_")) throw error;
    await supabaseFetch("/rest/v1/jobs", {
      method: "PATCH",
      query: `?id=eq.${restValue(job.id)}`,
      body: baseBody
    });
  }
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    await persistClientReview(await req.json());
    return json({ ok: true });
  } catch (error) {
    console.error("App review save failed:", error);
    return json({ error: error.message || "Review save failed" }, 500);
  }
};

export const config = {
  path: "/api/app-review"
};
