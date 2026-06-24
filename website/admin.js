const config = window.JOBVISTO_CONFIG || {};
const adminEmail = String(config.adminEmail || config.ownerEmail || "jobvisto@zohomail.com").toLowerCase();
const supabaseClient = window.supabase && config.supabaseUrl && config.supabaseAnonKey
  ? window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey)
  : null;

const state = {
  user: null,
  session: null,
  clients: [],
  plans: []
};

const $ = (selector) => document.querySelector(selector);

function setText(selector, value) {
  const element = $(selector);
  if (element) element.textContent = value;
}

function showToast(message) {
  const toast = $("#toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 3200);
}

function setStatus(message, isError = false) {
  const status = $("#statusLine");
  if (!status) return;
  status.textContent = message || "";
  status.style.color = isError ? "var(--danger)" : "var(--muted)";
}

function formatDate(value) {
  if (!value) return "Sin fecha";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin fecha";
  return new Intl.DateTimeFormat("es", {
    year: "numeric",
    month: "short",
    day: "2-digit"
  }).format(date);
}

function paymentBadge(client) {
  if (client.plan_id === "free") return '<span class="badge paid">Free</span>';
  if (client.payment_status === "paid") return '<span class="badge paid">Al dia</span>';
  if (client.payment_status === "pending") return '<span class="badge pending">Pendiente</span>';
  return '<span class="badge unpaid">No al dia</span>';
}

function statusBadge(status) {
  return status === "active"
    ? '<span class="badge active">Activo</span>'
    : '<span class="badge inactive">Inactivo</span>';
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function planOptions(selectedPlanId) {
  return state.plans.map((plan) => {
    const selected = plan.id === selectedPlanId ? " selected" : "";
    return `<option value="${escapeHtml(plan.id)}"${selected}>${escapeHtml(plan.name)}</option>`;
  }).join("");
}

function renderMetrics(summary = {}) {
  setText("#totalClients", summary.total ?? state.clients.length);
  setText("#activeClients", summary.active ?? state.clients.filter((client) => client.status === "active").length);
  setText("#inactiveClients", summary.inactive ?? state.clients.filter((client) => client.status !== "active").length);
  setText("#paidClients", summary.paid ?? state.clients.filter((client) => client.payment_status === "paid" || client.plan_id === "free").length);
}

function renderTable() {
  const tbody = $("#clientsTableBody");
  if (!tbody) return;

  if (!state.clients.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">No hay clientes registrados.</td></tr>';
    return;
  }

  tbody.innerHTML = state.clients.map((client) => {
    const nextStatus = client.status === "active" ? "inactive" : "active";
    const statusLabel = client.status === "active" ? "Desactivar" : "Activar";
    return `
      <tr data-client-id="${escapeHtml(client.organization_id)}">
        <td>
          <div class="client-name">
            <strong>${escapeHtml(client.name || "Sin nombre")}</strong>
            <span>${escapeHtml(client.organization_type || "cuenta")}</span>
          </div>
        </td>
        <td>${escapeHtml(client.email || "Sin email")}</td>
        <td>${escapeHtml(client.plan_name || client.plan_id || "Sin plan")}</td>
        <td>${formatDate(client.created_at)}</td>
        <td>${statusBadge(client.status)}</td>
        <td>${paymentBadge(client)}</td>
        <td>
          <div class="row-actions">
            <button class="mini-button ${nextStatus === "inactive" ? "danger" : "neutral"}" type="button" data-action="status" data-next-status="${nextStatus}">
              ${statusLabel}
            </button>
            <div class="plan-control">
              <select data-plan-select aria-label="Cambiar plan de ${escapeHtml(client.name || "cliente")}">
                ${planOptions(client.plan_id)}
              </select>
              <button class="mini-button neutral" type="button" data-action="plan">Cambiar plan</button>
            </div>
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

function showAuth(message = "") {
  $("#adminAuth")?.classList.remove("hidden");
  $("#adminShell")?.classList.add("hidden");
  setText("#authMessage", message);
}

function showShell() {
  $("#adminAuth")?.classList.add("hidden");
  $("#adminShell")?.classList.remove("hidden");
}

async function getAccessToken() {
  if (!supabaseClient) throw new Error("Supabase no esta configurado.");
  const { data, error } = await supabaseClient.auth.getSession();
  if (error || !data?.session?.access_token) throw new Error("Sesion admin no disponible.");
  state.session = data.session;
  return data.session.access_token;
}

async function apiRequest(payload = null) {
  const token = await getAccessToken();
  const options = {
    method: payload ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${token}`
    }
  };
  if (payload) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(payload);
  }

  const response = await fetch("/api/admin-dashboard", options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "No se pudo cargar el dashboard admin.");
  return data;
}

async function loadDashboard() {
  try {
    setStatus("Cargando datos...");
    const data = await apiRequest();
    state.clients = Array.isArray(data.clients) ? data.clients : [];
    state.plans = Array.isArray(data.plans) ? data.plans : [];
    renderMetrics(data.summary || {});
    renderTable();
    setStatus(`Actualizado: ${new Intl.DateTimeFormat("es", { dateStyle: "short", timeStyle: "short" }).format(new Date())}`);
  } catch (error) {
    setStatus(error.message, true);
    showToast(error.message);
  }
}

async function ensureAdminSession() {
  if (!supabaseClient) {
    showAuth("Supabase no esta configurado para este sitio.");
    return;
  }

  const { data } = await supabaseClient.auth.getSession();
  const user = data?.session?.user || null;
  state.user = user;
  state.session = data?.session || null;

  if (!user) {
    showAuth();
    return;
  }

  if (String(user.email || "").toLowerCase() !== adminEmail) {
    await supabaseClient.auth.signOut();
    showAuth("Este usuario no esta autorizado para el dashboard admin.");
    return;
  }

  showShell();
  await loadDashboard();
}

async function handleLogin(event) {
  event.preventDefault();
  if (!supabaseClient) return;

  const form = event.currentTarget;
  const email = String(form.elements.email.value || "").trim().toLowerCase();
  const password = String(form.elements.password.value || "");
  setText("#authMessage", "");

  if (email !== adminEmail) {
    setText("#authMessage", "Este email no esta autorizado.");
    return;
  }

  const button = form.querySelector("button[type='submit']");
  if (button) button.disabled = true;
  try {
    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
    await ensureAdminSession();
  } catch (error) {
    setText("#authMessage", error.message || "No se pudo iniciar sesion.");
  } finally {
    if (button) button.disabled = false;
  }
}

async function updateClient(organizationId, payload) {
  setStatus("Guardando cambio manual...");
  const data = await apiRequest({ organizationId, ...payload });
  state.clients = Array.isArray(data.clients) ? data.clients : state.clients;
  state.plans = Array.isArray(data.plans) ? data.plans : state.plans;
  renderMetrics(data.summary || {});
  renderTable();
  setStatus("Cambio guardado.");
  showToast("Cambio manual guardado.");
}

async function handleTableClick(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const row = button.closest("tr[data-client-id]");
  const organizationId = row?.dataset.clientId;
  if (!organizationId) return;

  button.disabled = true;
  try {
    if (button.dataset.action === "status") {
      await updateClient(organizationId, { status: button.dataset.nextStatus });
    }
    if (button.dataset.action === "plan") {
      const planId = row.querySelector("[data-plan-select]")?.value;
      await updateClient(organizationId, { planId });
    }
  } catch (error) {
    setStatus(error.message, true);
    showToast(error.message);
  } finally {
    button.disabled = false;
  }
}

async function signOut() {
  if (supabaseClient) await supabaseClient.auth.signOut();
  state.user = null;
  state.session = null;
  state.clients = [];
  showAuth();
}

document.addEventListener("DOMContentLoaded", () => {
  $("#adminLoginForm")?.addEventListener("submit", handleLogin);
  $("#refreshButton")?.addEventListener("click", loadDashboard);
  $("#signOutButton")?.addEventListener("click", signOut);
  $("#clientsTableBody")?.addEventListener("click", handleTableClick);
  ensureAdminSession();
});
