import crypto from "node:crypto";

function env(name) {
  return process.env[name] || globalThis.Netlify?.env?.get?.(name);
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function sign(value) {
  const secret = env("VERIFICATION_CODE_SECRET") || env("RESEND_API_KEY") || env("SUPABASE_SERVICE_ROLE_KEY");
  if (!secret) throw new Error("Verification secret is missing.");
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}

function verificationToken(email, code, expiresAt) {
  const codeHash = sign(`${email}:${code}:${expiresAt}`);
  const payload = Buffer.from(JSON.stringify({ email, codeHash, expiresAt })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function readVerificationToken(token) {
  const [payload, signature] = String(token || "").split(".");
  if (!payload || !signature || sign(payload) !== signature) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

async function sendEmail({ to, code }) {
  const apiKey = env("RESEND_API_KEY");
  const from = env("EMAIL_FROM") || "JobVisto <onboarding@resend.dev>";
  const replyTo = env("EMAIL_REPLY_TO") || "jobvisto@zohomail.com";
  if (!apiKey) throw new Error("RESEND_API_KEY is missing.");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: "Tu codigo de verificacion JobVisto",
      html: `<p>Tu codigo de verificacion es:</p><h2>${code}</h2><p>Este codigo vence en 10 minutos.</p>`,
      text: `Tu codigo de verificacion JobVisto es ${code}. Este codigo vence en 10 minutos.`,
      ...(replyTo ? { reply_to: replyTo } : {})
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.message || data?.error || `Resend failed with status ${response.status}`);
  return data;
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json();
    const action = String(body.action || "");
    const email = normalizeEmail(body.email);
    if (!email || !email.includes("@")) return json({ error: "Email invalido." }, 400);

    if (action === "send") {
      const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
      const expiresAt = Date.now() + 10 * 60 * 1000;
      await sendEmail({ to: email, code });
      return json({ verificationToken: verificationToken(email, code, expiresAt), expiresAt });
    }

    if (action === "verify") {
      const code = String(body.code || "").trim();
      const tokenData = readVerificationToken(body.verificationToken);
      if (!tokenData || tokenData.email !== email || Date.now() > Number(tokenData.expiresAt)) {
        return json({ verified: false, error: "Codigo vencido. Envia uno nuevo." }, 400);
      }
      const expectedHash = sign(`${email}:${code}:${tokenData.expiresAt}`);
      if (expectedHash !== tokenData.codeHash) return json({ verified: false, error: "Codigo incorrecto." }, 400);
      return json({ verified: true });
    }

    return json({ error: "Accion invalida." }, 400);
  } catch (err) {
    return json({ error: err.message || "No se pudo procesar la verificacion." }, 500);
  }
};
