function env(name) {
  const value = process.env[name] || globalThis.Netlify?.env?.get?.(name);
  if (name === "SUPABASE_URL" && !String(value || "").startsWith("http")) return "https://fmpzdmmmqwqxxgeytmkr.supabase.co";
  return value;
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

function clientLanguage(client = {}) {
  const language = String(client.preferred_language || "es").toLowerCase();
  return ["es", "en", "ru", "he"].includes(language) ? language : "es";
}

function cleanerFallbackName(language) {
  return {
    es: "tu cleaner",
    en: "your cleaner",
    ru: "ваш клинер",
    he: "הקלינר שלך"
  }[language] || "tu cleaner";
}

function emailCopy(language) {
  return {
    es: {
      openPortal: "Abrir portal",
      automatic: "Mensaje automatico enviado por JobVisto.",
      tomorrowSubject: (business) => `Recordatorio de tu servicio con ${business}`,
      tomorrowPreview: "Recordatorio automatico de servicio",
      tomorrowTitle: "Tu servicio esta confirmado",
      tomorrowBody: (name, business) => `Hola ${name}, manana tienes un servicio con <strong>${business}</strong>.`,
      schedule: "Horario",
      portalHint: "Desde el portal puedes revisar el estado del trabajo y dejar comentarios cuando termine.",
      arrivedSubject: (cleaner) => `${cleaner} ya llego`,
      arrivedPreview: "El cleaner marco llegada",
      arrivedTitle: (cleaner) => `${cleaner} ya llego`,
      arrivedBody: (name) => `Hola ${name}, el trabajo ya esta iniciando.`,
      onWaySubject: (cleaner) => `${cleaner} va en camino`,
      onWayPreview: "El cleaner va en camino",
      onWayTitle: (cleaner) => `${cleaner} va en camino`,
      onWayBody: (name) => `Hola ${name}, el cleaner ya va en camino para iniciar el servicio.`,
      finishedSubject: "Tu servicio fue marcado como terminado",
      finishedPreview: "Trabajo terminado",
      finishedTitle: "Servicio terminado",
      finishedBody: (name) => `Hola ${name}, tu servicio fue marcado como terminado.`,
      reviewHint: "Ahora puedes revisar la informacion del trabajo y dejar tu comentario sobre el servicio y el cleaner.",
      reviewAction: "Revisar servicio",
      estimated: "segun agenda"
    },
    en: {
      openPortal: "Open portal",
      automatic: "Automatic message sent by JobVisto.",
      tomorrowSubject: (business) => `Reminder for your service with ${business}`,
      tomorrowPreview: "Automatic service reminder",
      tomorrowTitle: "Your service is confirmed",
      tomorrowBody: (name, business) => `Hi ${name}, you have a service tomorrow with <strong>${business}</strong>.`,
      schedule: "Schedule",
      portalHint: "From the portal you can check the job status and leave feedback when it is finished.",
      arrivedSubject: (cleaner) => `${cleaner} has arrived`,
      arrivedPreview: "The cleaner marked arrival",
      arrivedTitle: (cleaner) => `${cleaner} has arrived`,
      arrivedBody: (name) => `Hi ${name}, the job is starting now.`,
      onWaySubject: (cleaner) => `${cleaner} is on the way`,
      onWayPreview: "The cleaner is on the way",
      onWayTitle: (cleaner) => `${cleaner} is on the way`,
      onWayBody: (name) => `Hi ${name}, the cleaner is on the way to start the service.`,
      finishedSubject: "Your service was marked as finished",
      finishedPreview: "Job finished",
      finishedTitle: "Service finished",
      finishedBody: (name) => `Hi ${name}, your service was marked as finished.`,
      reviewHint: "You can now review the job information and leave feedback about the service and cleaner.",
      reviewAction: "Review service",
      estimated: "as scheduled"
    },
    ru: {
      openPortal: "Открыть портал",
      automatic: "Автоматическое сообщение от JobVisto.",
      tomorrowSubject: (business) => `Напоминание о вашей услуге от ${business}`,
      tomorrowPreview: "Автоматическое напоминание об услуге",
      tomorrowTitle: "Ваша услуга подтверждена",
      tomorrowBody: (name, business) => `Здравствуйте, ${name}. Завтра у вас запланирована услуга от <strong>${business}</strong>.`,
      schedule: "Время",
      portalHint: "В портале можно проверить статус работы и оставить отзыв после завершения.",
      arrivedSubject: (cleaner) => `${cleaner} прибыл`,
      arrivedPreview: "Клинер отметил прибытие",
      arrivedTitle: (cleaner) => `${cleaner} прибыл`,
      arrivedBody: (name) => `Здравствуйте, ${name}. Работа начинается.`,
      onWaySubject: (cleaner) => `${cleaner} уже в пути`,
      onWayPreview: "Клинер уже в пути",
      onWayTitle: (cleaner) => `${cleaner} уже в пути`,
      onWayBody: (name) => `Здравствуйте, ${name}. Клинер уже едет, чтобы начать услугу.`,
      finishedSubject: "Ваша услуга отмечена как завершенная",
      finishedPreview: "Работа завершена",
      finishedTitle: "Услуга завершена",
      finishedBody: (name) => `Здравствуйте, ${name}. Ваша услуга отмечена как завершенная.`,
      reviewHint: "Теперь вы можете проверить информацию о работе и оставить отзыв об услуге и клинере.",
      reviewAction: "Проверить услугу",
      estimated: "по расписанию"
    },
    he: {
      openPortal: "פתח פורטל",
      automatic: "הודעה אוטומטית נשלחה על ידי JobVisto.",
      tomorrowSubject: (business) => `תזכורת לשירות שלך עם ${business}`,
      tomorrowPreview: "תזכורת שירות אוטומטית",
      tomorrowTitle: "השירות שלך אושר",
      tomorrowBody: (name, business) => `שלום ${name}, מחר יש לך שירות עם <strong>${business}</strong>.`,
      schedule: "שעה",
      portalHint: "בפורטל אפשר לראות את מצב העבודה ולהשאיר משוב בסיום.",
      arrivedSubject: (cleaner) => `${cleaner} הגיע`,
      arrivedPreview: "הקלינר סימן הגעה",
      arrivedTitle: (cleaner) => `${cleaner} הגיע`,
      arrivedBody: (name) => `שלום ${name}, העבודה מתחילה עכשיו.`,
      onWaySubject: (cleaner) => `${cleaner} בדרך`,
      onWayPreview: "הקלינר בדרך",
      onWayTitle: (cleaner) => `${cleaner} בדרך`,
      onWayBody: (name) => `שלום ${name}, הקלינר בדרך כדי להתחיל את השירות.`,
      finishedSubject: "השירות שלך סומן כהסתיים",
      finishedPreview: "העבודה הסתיימה",
      finishedTitle: "השירות הסתיים",
      finishedBody: (name) => `שלום ${name}, השירות שלך סומן כהסתיים.`,
      reviewHint: "עכשיו אפשר לבדוק את פרטי העבודה ולהשאיר משוב על השירות והקלינר.",
      reviewAction: "בדוק שירות",
      estimated: "לפי התכנון"
    }
  }[language] || emailCopy("es");
}
function emailShell({ preview, body, actionUrl, actionLabel = "Abrir portal", footer = "Mensaje automatico enviado por JobVisto.", direction = "ltr" }) {
  return `
    <div dir="${direction}" style="font-family:Arial,sans-serif;background:#f7faf9;padding:24px;color:#113235;">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #dbe7e4;border-radius:14px;padding:24px;">
        <img src="https://jobvisto.netlify.app/assets/Logo%20Jobvisto.png" alt="JobVisto" width="150" style="display:block;max-width:150px;height:auto;margin:0 0 18px;">
        <p style="margin:0 0 12px;color:#6b7a7a;font-size:13px;">${preview}</p>
        ${body}
        ${actionUrl ? `<p style="margin:24px 0 0;"><a href="${actionUrl}" style="display:inline-block;background:#007b7b;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700;">${actionLabel}</a></p>` : ""}
        <p style="margin:24px 0 0;color:#84908f;font-size:12px;">${footer}</p>
      </div>
    </div>
  `;
}

function templateFor(event, context) {
  const { client, cleaner, job, org, portalUrl } = context;
  const business = companyName(org);
  const { date, time } = formatDateTime(job.scheduled_start, org?.timezone || "UTC");
  const language = clientLanguage(client);
  const copy = emailCopy(language);
  const direction = language === "he" ? "rtl" : "ltr";
  const cleanerName = cleaner?.name || cleanerFallbackName(language);

  if (event === "tomorrow") {
    return {
      subject: copy.tomorrowSubject(business),
      preview: copy.tomorrowPreview,
      text: `${copy.tomorrowTitle}. ${copy.schedule}: ${time || copy.estimated}. ${portalUrl}`,
      html: emailShell({
        preview: copy.tomorrowPreview,
        actionUrl: portalUrl,
        actionLabel: copy.openPortal,
        footer: copy.automatic,
        direction,
        body: `
          <h2 style="margin:0 0 12px;color:#103235;">${copy.tomorrowTitle}</h2>
          <p>${copy.tomorrowBody(client.name, business)}</p>
          <p><strong>${copy.schedule}:</strong> ${date || time || copy.estimated}</p>
          <p>${copy.portalHint}</p>
        `
      })
    };
  }

  if (event === "arrived") {
    return {
      subject: copy.arrivedSubject(cleanerName),
      preview: copy.arrivedPreview,
      text: `${copy.arrivedTitle(cleanerName)}. ${portalUrl}`,
      html: emailShell({
        preview: copy.arrivedPreview,
        actionUrl: portalUrl,
        actionLabel: copy.openPortal,
        footer: copy.automatic,
        direction,
        body: `
          <h2 style="margin:0 0 12px;color:#103235;">${copy.arrivedTitle(cleanerName)}</h2>
          <p>${copy.arrivedBody(client.name)}</p>
          <p>${copy.portalHint}</p>
        `
      })
    };
  }

  if (event === "on_way") {
    return {
      subject: copy.onWaySubject(cleanerName),
      preview: copy.onWayPreview,
      text: `${copy.onWayTitle(cleanerName)}. ${portalUrl}`,
      html: emailShell({
        preview: copy.onWayPreview,
        actionUrl: portalUrl,
        actionLabel: copy.openPortal,
        footer: copy.automatic,
        direction,
        body: `
          <h2 style="margin:0 0 12px;color:#103235;">${copy.onWayTitle(cleanerName)}</h2>
          <p>${copy.onWayBody(client.name)}</p>
          <p>${copy.portalHint}</p>
        `
      })
    };
  }

  return {
    subject: copy.finishedSubject,
    preview: copy.finishedPreview,
    text: `${copy.finishedTitle}. ${portalUrl}`,
    html: emailShell({
      preview: copy.finishedPreview,
      actionUrl: portalUrl,
      actionLabel: copy.reviewAction,
      footer: copy.automatic,
      direction,
      body: `
        <h2 style="margin:0 0 12px;color:#103235;">${copy.finishedTitle}</h2>
        <p>${copy.finishedBody(client.name)}</p>
        <p>${copy.reviewHint}</p>
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

async function buildJobNotificationContext(jobId, siteUrl) {
  const jobs = await supabaseFetch("/rest/v1/jobs", {
    query: `?id=eq.${restValue(jobId)}&select=id,organization_id,client_id,assigned_cleaner_id,service_type,scheduled_start,actual_start,actual_end,status,updated_at,notify_client&limit=1`
  });
  const job = Array.isArray(jobs) ? jobs[0] : null;
  if (!job) throw new Error("Job not found.");
  if (job.notify_client === false) throw new Error("Client notifications are disabled for this job.");

  const [clientRows, cleanerRows, orgRows] = await Promise.all([
    supabaseFetch("/rest/v1/clients", {
      query: `?id=eq.${restValue(job.client_id)}&select=id,organization_id,name,email,portal_passcode,portal_active,notification_channel,preferred_language&limit=1`
    }),
    job.assigned_cleaner_id ? supabaseFetch("/rest/v1/cleaners", {
      query: `?id=eq.${restValue(job.assigned_cleaner_id)}&select=id,name,email,phone,access_key,portal_passcode,archived&limit=1`
    }) : [],
    supabaseFetch("/rest/v1/organizations", {
      query: `?id=eq.${restValue(job.organization_id)}&select=id,name,timezone,default_language&limit=1`
    })
  ]);

  const client = Array.isArray(clientRows) ? clientRows[0] : null;
  if (!client?.email || client.portal_active === false) throw new Error("Client cannot receive this notification.");

  return {
    job,
    client,
    cleaner: Array.isArray(cleanerRows) ? cleanerRows[0] : null,
    org: Array.isArray(orgRows) ? orgRows[0] : null,
    portalUrl: portalUrlForClient(client, siteUrl)
  };
}

export async function sendJobNotification({ event, jobId, siteUrl, dedupe = true } = {}) {
  const allowedEvents = new Set(["on_way", "arrived", "finished"]);
  if (!allowedEvents.has(event)) throw new Error("Unsupported notification event.");

  const context = await buildJobNotificationContext(jobId, siteUrl);
  const dedupeKey = `${context.job.id}:${event}:email`;
  if (dedupe && await notificationExists(dedupeKey)) {
    return { ok: true, skipped: true, reason: "already_sent", event, to: context.client.email };
  }

  const message = templateFor(event, context);
  const baseRow = {
    organization_id: context.job.organization_id,
    job_id: context.job.id,
    recipient_type: "client",
    recipient_id: context.client.id,
    recipient_email: context.client.email,
    channel: "email",
    template_key: event,
    dedupe_key: dedupeKey,
    subject: message.subject,
    payload: { service_type: context.job.service_type, scheduled_start: context.job.scheduled_start },
    status: "pending"
  };

  try {
    const provider = await sendEmail({ to: context.client.email, ...message });
    await saveNotification({
      ...baseRow,
      status: "sent",
      sent_at: new Date().toISOString(),
      provider_message_id: provider?.id || null
    });
    return { ok: true, event, to: context.client.email, providerMessageId: provider?.id || null };
  } catch (error) {
    await saveNotification({
      ...baseRow,
      status: "failed",
      error_message: error.message || String(error)
    });
    throw error;
  }
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

