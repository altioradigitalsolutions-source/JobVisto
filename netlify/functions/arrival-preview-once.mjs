function env(name) {
  return process.env[name] || globalThis.Netlify?.env?.get?.(name);
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

async function sendEmail({ to, subject, html, text }) {
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
      subject,
      html,
      text,
      ...(replyTo ? { reply_to: replyTo } : {})
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.message || data?.error || `Resend failed with status ${response.status}`);
  return data;
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const to = "jobvisto@zohomail.com";
  const cleanerName = "Sarah G";
  const clientName = "JobVisto";
  const portalUrl = "https://jobvisto.netlify.app/portal-clientes";
  const sent = await sendEmail({
    to,
    subject: `${cleanerName} ya llego`,
    text: `${cleanerName} ya llego. ${portalUrl}`,
    html: `
      <div style="display:none;max-height:0;overflow:hidden;">El cleaner marco llegada</div>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4faf8;padding:32px 0;font-family:Arial,sans-serif;color:#243b3a;">
        <tr>
          <td align="center">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #d9ebe5;">
              <tr>
                <td style="background:#063f34;padding:24px 28px;color:#ffffff;">
                  <strong style="font-size:20px;">JobVisto</strong>
                  <p style="margin:6px 0 0;color:#cfeee5;">Notificacion automatica</p>
                </td>
              </tr>
              <tr>
                <td style="padding:28px;">
                  <h2 style="margin:0 0 12px;color:#103235;">${cleanerName} ya llego</h2>
                  <p>Hola ${clientName}, el trabajo ya esta iniciando.</p>
                  <p>Puedes abrir tu portal para ver el estado del trabajo, llegada y evidencia disponible.</p>
                  <p style="margin:24px 0;">
                    <a href="${portalUrl}" style="background:#109968;color:#ffffff;text-decoration:none;padding:13px 18px;border-radius:12px;font-weight:700;">Abrir portal</a>
                  </p>
                  <p style="font-size:13px;color:#6b7c7a;">Este es un email automatico de JobVisto.</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    `
  });

  return json({ ok: true, to, providerMessageId: sent?.id || null });
};
