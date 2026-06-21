function env(name) {
  return globalThis.Netlify?.env?.get ? globalThis.Netlify.env.get(name) : process.env[name];
}

function restValue(value) {
  return encodeURIComponent(String(value ?? ""));
}

function jsonHeaders(extra = {}) {
  return { "Content-Type": "application/json", ...extra };
}

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: jsonHeaders()
  });
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

function fallbackClientPortalKey(client = {}) {
  return `JV-${String(client.name || "").slice(0, 3).toUpperCase()}-${String(client.id || "").slice(-2)}`;
}

function portalUrlForClient(client, siteUrl) {
  const base = String(siteUrl || env("URL") || "https://jobvisto.netlify.app").replace(/\/$/, "");
  const key = client.portal_passcode || fallbackClientPortalKey(client);
  return `${base}/portal-clientes.html?id=${encodeURIComponent(client.id)}&clave=${encodeURIComponent(key)}`;
}

function formatDateTime(value, timeZone = "UTC") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: "", time: "" };
  const formatter = new Intl.DateTimeFormat("es", {
    timeZone,
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
  const parts = formatter.formatToParts(date);
  const dateText = formatter.format(date).replace(",", "");
  const hour = parts.find((part) => part.type === "hour")?.value || "";
  const minute = parts.find((part) => part.type === "minute")?.value || "";
  return { date: dateText, time: hour && minute ? `${hour}:${minute}` : "" };
}

function companyName(org = {}) {
  return org.name || "JobVisto";
}

function emailShell({ preview, body, actionUrl, actionLabel = "Abrir portal" }) {
  return `
    <div style="font-family:Arial,sans-serif;background:#f7faf9;padding:24px;color:#113235;">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #dbe7e4;border-radius:14px;padding:24px;">
        <p style="margin:0 0 12px;color:#6b7a7a;font-size:13px;">${preview}</p>
        ${body}
        ${actionUrl ? `<p style="margin:24px 0 0;"><a href="${actionUrl}" style="display:inline-block;background:#007b7b;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700;">${actionLabel}</a></p>` : ""}
        <p style="margin:24px 0 0;color:#84908f;font-size:12px;">Mensaje automatico enviado por JobVisto.</p>
      </div>
    </div>
  `;
}

function templateFor(event, context) {
  const { client, cleaner, job, org, portalUrl } = context;
  const business = companyName(org);
  const cleanerName = cleaner?.name || "tu cleaner";
  const { date, time } = formatDateTime(job.scheduled_start, org?.timezone || "UTC");

  if (event === "tomorrow") {
    return {
      subject: `Recordatorio de tu servicio con ${business}`,
      preview: "Recordatorio automatico de servicio",
      text: `Hola ${client.name}, manana tienes un servicio con ${business}. Hora estimada: ${time || "segun agenda"}. Puedes ver el estado desde tu portal: ${portalUrl}`,
      html: emailShell({
        preview: "Recordatorio automatico de servicio",
        actionUrl: portalUrl,
        body: `
          <h2 style="margin:0 0 12px;color:#103235;">Tu servicio esta confirmado</h2>
          <p>Hola ${client.name}, manana tienes un servicio con <strong>${business}</strong>.</p>
          <p><strong>Horario:</strong> ${date || time || "segun agenda"}</p>
          <p>Desde el portal puedes revisar el estado del trabajo y dejar comentarios cuando termine.</p>
        `
      })
    };
  }

  if (event === "arrived") {
    return {
      subject: `${cleanerName} ya llego`,
      preview: "El cleaner marco llegada",
      text: `Hola ${client.name}, ${cleanerName} ya llego y el trabajo esta iniciando. Puedes seguir el servicio aqui: ${portalUrl}`,
      html: emailShell({
        preview: "El cleaner marco llegada",
        actionUrl: portalUrl,
        body: `
          <h2 style="margin:0 0 12px;color:#103235;">${cleanerName} ya llego</h2>
          <p>Hola ${client.name}, el trabajo ya esta iniciando.</p>
          <p>Puedes abrir tu portal para ver el estado del servicio.</p>
        `
      })
    };
  }

  return {
    subject: `Tu servicio fue marcado como terminado`,
    preview: "Trabajo terminado",
    text: `Hola ${client.name}, tu servicio fue marcado como terminado. Puedes revisar el portal y dejar tu comentario: ${portalUrl}`,
    html: emailShell({
      preview: "Trabajo terminado",
      actionUrl: portalUrl,
      actionLabel: "Revisar servicio",
      body: `
        <h2 style="margin:0 0 12px;color:#103235;">Servicio terminado</h2>
        <p>Hola ${client.name}, tu servicio fue marcado como terminado.</p>
        <p>Ahora puedes revisar la informacion del trabajo y dejar tu comentario sobre el servicio y el cleaner.</p>
      `
    })
  };
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
  if (!response.ok) {
    throw new Error(data?.message || data?.error || `Resend failed with status ${response.status}`);
  }
  return data;
}

async function fetchRowsByIds(path, ids, columns = "*") {
  const cleanIds = [...new Set((ids || []).filter(Boolean))];
  if (!cleanIds.length) return new Map();
  const rows = await supabaseFetch(path, {
    query: `?id=in.(${cleanIds.map(restValue).join(",")})&select=${columns}`
  });
  return new Map((Array.isArray(rows) ? rows : []).map((row) => [row.id, row]));
}

async function notificationExists(dedupeKey) {
  const rows = await supabaseFetch("/rest/v1/notifications", {
    query: `?dedupe_key=eq.${restValue(dedupeKey)}&select=id,status&limit=1`
  });
  return Array.isArray(rows) && rows.length > 0;
}

async function saveNotification(row) {
  await supabaseFetch("/rest/v1/notifications", {
    method: "POST",
    body: row,
    prefer: "resolution=ignore-duplicates,return=representation"
  });
}

function eligibleEvents(job, now = new Date()) {
  const events = [];
  const start = new Date(job.scheduled_start);
  const hoursUntilStart = (start.getTime() - now.getTime()) / 36e5;
  const doneStatuses = new Set(["cleaner_finished", "client_confirmed", "signed", "admin_closed"]);

  if (hoursUntilStart >= 20 && hoursUntilStart <= 28 && ["scheduled", "assigned", "open"].includes(job.status)) {
    events.push("tomorrow");
  }
  if (job.status === "in_site" && job.actual_start) {
    events.push("arrived");
  }
  if (doneStatuses.has(job.status) && (job.actual_end || job.updated_at)) {
    events.push("finished");
  }

  return events;
}

export async function processAutomaticNotifications({ siteUrl } = {}) {
  const now = new Date();
  const lower = new Date(now.getTime() - 48 * 36e5).toISOString();
  const upper = new Date(now.getTime() + 30 * 36e5).toISOString();
  const jobs = await supabaseFetch("/rest/v1/jobs", {
    query: `?scheduled_start=gte.${restValue(lower)}&scheduled_start=lte.${restValue(upper)}&notify_client=eq.true&status=in.(scheduled,assigned,open,in_site,cleaner_finished,client_confirmed,signed,admin_closed)&select=id,organization_id,client_id,assigned_cleaner_id,service_type,scheduled_start,actual_start,actual_end,status,updated_at`
  });

  const visibleJobs = Array.isArray(jobs) ? jobs : [];
  const clients = await fetchRowsByIds("/rest/v1/clients", visibleJobs.map((job) => job.client_id), "id,organization_id,name,email,portal_passcode,portal_active,notification_channel,preferred_language");
  const cleaners = await fetchRowsByIds("/rest/v1/cleaners", visibleJobs.map((job) => job.assigned_cleaner_id), "id,name,email,phone");
  const orgs = await fetchRowsByIds("/rest/v1/organizations", visibleJobs.map((job) => job.organization_id), "id,name,timezone,default_language");

  const result = { checked: visibleJobs.length, sent: 0, skipped: 0, failed: 0, errors: [] };

  for (const job of visibleJobs) {
    const client = clients.get(job.client_id);
    if (!client?.email || client.portal_active === false) {
      result.skipped += 1;
      continue;
    }

    for (const event of eligibleEvents(job, now)) {
      const dedupeKey = `${job.id}:${event}:email`;
      if (await notificationExists(dedupeKey)) {
        result.skipped += 1;
        continue;
      }

      const context = {
        job,
        client,
        cleaner: cleaners.get(job.assigned_cleaner_id),
        org: orgs.get(job.organization_id),
        portalUrl: portalUrlForClient(client, siteUrl)
      };
      const message = templateFor(event, context);
      const baseRow = {
        organization_id: job.organization_id,
        job_id: job.id,
        recipient_type: "client",
        recipient_id: client.id,
        recipient_email: client.email,
        channel: "email",
        template_key: event,
        dedupe_key: dedupeKey,
        subject: message.subject,
        payload: { service_type: job.service_type, scheduled_start: job.scheduled_start },
        status: "pending"
      };

      try {
        const provider = await sendEmail({ to: client.email, ...message });
        await saveNotification({
          ...baseRow,
          status: "sent",
          sent_at: new Date().toISOString(),
          provider_message_id: provider?.id || null
        });
        result.sent += 1;
      } catch (error) {
        await saveNotification({
          ...baseRow,
          status: "failed",
          error_message: error.message || String(error)
        });
        result.failed += 1;
        result.errors.push({ jobId: job.id, event, error: error.message || String(error) });
      }
    }
  }

  return result;
}

export async function sendTestNotification(to) {
  const target = String(to || env("EMAIL_REPLY_TO") || "jobvisto@zohomail.com").trim();
  if (!target) throw new Error("Missing test recipient email.");
  const sent = await sendEmail({
    to: target,
    subject: "JobVisto: email automatico conectado",
    text: "La conexion de emails automaticos de JobVisto esta funcionando.",
    html: emailShell({
      preview: "Prueba de conexion",
      body: `
        <h2 style="margin:0 0 12px;color:#103235;">Email conectado</h2>
        <p>La conexion de emails automaticos de JobVisto esta funcionando.</p>
      `
    })
  });
  return { ok: true, providerMessageId: sent?.id || null, to: target };
}
