require("dotenv").config();

const express = require("express");
const session = require("express-session");
const multer = require("multer");
const { parse } = require("csv-parse/sync");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const APP_URL = String(process.env.APP_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const DATA_DIR = path.resolve(process.env.DATA_DIR || "./data");
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || "./uploads");
const MAX_CSV_MB = Number(process.env.MAX_CSV_MB || 10);

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const dataFiles = {
  lines: path.join(DATA_DIR, "lines.json"),
  renewalRequests: path.join(DATA_DIR, "renewal-requests.json"),
  contractRequests: path.join(DATA_DIR, "contract-requests.json"),
  messages: path.join(DATA_DIR, "messages.json"),
  settings: path.join(DATA_DIR, "settings.json")
};

const defaultSettings = {
  businessName: "León TV",
  renewalAlertDays: 7,
  unknownMessage: "No reconozco ese comando.\n\nEscribe *#menu* para ver las opciones disponibles.",
  menuText: "👋 *LEÓN TV*\n\nConsulta tu línea escribiendo directamente:\n\n*#TUUSUARIO*\n\nEjemplo:\n#usuario123\n\n🔄 *Renovación de una línea actual*\n#renovar TUUSUARIO\n\n🆕 *Contratar una línea nueva*\n#contratar\n\n📱 *Instalación*\n#instalar\n\n🛠️ *Soporte*\n#soporte",
  installationText: "📱 *INSTALACIÓN LEÓN TV*\n\nSelecciona tu dispositivo:\n\n#android\n#firetv\n#lg\n#samsung",
  supportText: "🛠️ *SOPORTE TÉCNICO*\n\nIndica el dispositivo, la aplicación, el mensaje de error y una captura si es posible.",
  contractText: "🆕 *CONTRATAR LEÓN TV*\n\nSelecciona la duración:\n\n#contratar 1\n#contratar 3\n#contratar 6\n#contratar 12",
  contractConfirmation: "✅ *SOLICITUD DE CONTRATACIÓN RECIBIDA*\n\nDuración solicitada: {periodo}\n\nNos pondremos en contacto contigo.",
  renewalRequestConfirmation: "🔄 *SOLICITUD DE RENOVACIÓN RECIBIDA*\n\nLínea: {usuario}\nCaducidad actual: {caducidad}\n\nCuando la línea sea renovada, recibirás la confirmación por este chat.",
  renewedConfirmation: "✅ *TU LÍNEA HA SIDO RENOVADA*\n\nUsuario: {usuario}\nNueva fecha de caducidad: {caducidad}\n\n¡Gracias por confiar en León TV! 📺",
  autoAlertMessage: "⚠️ Tu línea está próxima a caducar. Hemos creado automáticamente un aviso de renovación para el equipo de León TV."
};

function ensureData() {
  const defaults = {
    lines: [],
    renewalRequests: [],
    contractRequests: [],
    messages: [],
    settings: defaultSettings
  };

  for (const [key, file] of Object.entries(dataFiles)) {
    if (!fs.existsSync(file)) writeJson(file, defaults[key]);
  }
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(temporary, file);
}

ensureData();

function esc(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalize(value = "") {
  return String(value).trim().toLowerCase();
}

function parseDate(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.startsWith("+")) return null;

  const date = new Date(raw.replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value) {
  const date = parseDate(value);
  if (!date) return String(value || "Sin fecha válida");

  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function toStorageDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Fecha de renovación no válida.");

  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  const sec = String(date.getSeconds()).padStart(2, "0");

  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${sec}`;
}

/**
 * Suma un mes natural a la caducidad.
 *
 * - Si la línea sigue activa, parte de su fecha de caducidad.
 * - Si ya ha caducado, parte del momento actual.
 * - Ajusta correctamente los finales de mes:
 *   31 de enero -> 28/29 de febrero.
 */
function addOneCalendarMonth(expiration) {
  const currentExpiration = parseDate(expiration);
  const now = new Date();

  const baseDate =
    currentExpiration && currentExpiration.getTime() > now.getTime()
      ? new Date(currentExpiration)
      : new Date(now);

  const originalDay = baseDate.getDate();

  // Cambiar primero al día 1 evita saltos al pasar entre meses.
  baseDate.setDate(1);
  baseDate.setMonth(baseDate.getMonth() + 1);

  const lastDayOfTargetMonth = new Date(
    baseDate.getFullYear(),
    baseDate.getMonth() + 1,
    0
  ).getDate();

  baseDate.setDate(Math.min(originalDay, lastDayOfTargetMonth));

  return toStorageDate(baseDate);
}

function getStatus(expiration) {
  const date = parseDate(expiration);

  if (!date) {
    return {
      label: "Sin fecha válida",
      icon: "⚪",
      css: "muted",
      days: null
    };
  }

  const days = Math.ceil((date.getTime() - Date.now()) / 86400000);

  if (days < 0) {
    return {
      label: "Caducada",
      icon: "🔴",
      css: "danger",
      days
    };
  }

  if (days <= 7) {
    return {
      label: "Próxima a caducar",
      icon: "🟠",
      css: "warning",
      days
    };
  }

  return {
    label: "Activa",
    icon: "🟢",
    css: "success",
    days
  };
}

function replaceTemplate(template, values) {
  let result = String(template || "");
  for (const [key, value] of Object.entries(values)) {
    result = result.replaceAll(`{${key}}`, String(value));
  }
  return result;
}

function page(title, content) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} | León TV</title>
<link rel="stylesheet" href="/public/style.css">
</head>
<body>${content}</body>
</html>`;
}

function adminLayout(title, content) {
  return page(title, `
  <div class="shell">
    <aside>
      <a class="logo" href="/admin"><span>LEÓN</span>BOT</a>
      <a href="/admin">Resumen</a>
      <a href="/admin/lines">Líneas</a>
      <a href="/admin/import">Importar CSV</a>
      <a href="/admin/renewals">Avisos de renovación</a>
      <a href="/admin/contracts">Contrataciones</a>
      <a href="/admin/settings">Ajustes</a>
      <a href="/admin/export">Exportar copia</a>
      <a href="/logout">Cerrar sesión</a>
    </aside>
    <main>
      <div class="heading">
        <h1>${esc(title)}</h1>
        <a class="button secondary" href="/" target="_blank">Estado del servicio</a>
      </div>
      ${content}
    </main>
  </div>`);
}

function requireAuth(req, res, next) {
  if (req.session?.admin) return next();
  res.redirect("/login");
}

async function metaRequest(endpoint, payload) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const version = process.env.META_GRAPH_VERSION || "v25.0";

  if (!token || !phoneId) throw new Error("Faltan las credenciales de WhatsApp.");

  const response = await fetch(
    `https://graph.facebook.com/${version}/${phoneId}/${endpoint}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Meta API ${response.status}: ${JSON.stringify(data)}`);
  }

  return data;
}

async function sendText(to, text) {
  return metaRequest("messages", {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: {
      preview_url: false,
      body: text
    }
  });
}

function findLine(username) {
  const lines = readJson(dataFiles.lines, []);
  return lines.find(line => normalize(line.username) === normalize(username));
}

function saveRenewalRequest({ username, phone, source, reason }) {
  const requests = readJson(dataFiles.renewalRequests, []);

  const existing = requests.find(item =>
    normalize(item.username) === normalize(username) &&
    item.phone === phone &&
    item.status === "pending"
  );

  if (existing) return existing;

  const request = {
    id: crypto.randomUUID(),
    username,
    phone,
    source,
    reason,
    status: "pending",
    requestedAt: new Date().toISOString(),
    completedAt: "",
    previousExpiration: "",
    newExpiration: "",
    notificationStatus: "pending",
    notificationError: ""
  };

  requests.unshift(request);
  writeJson(dataFiles.renewalRequests, requests);
  return request;
}

function saveContractRequest({ phone, months }) {
  const requests = readJson(dataFiles.contractRequests, []);

  const request = {
    id: crypto.randomUUID(),
    phone,
    months,
    status: "pending",
    requestedAt: new Date().toISOString(),
    notes: ""
  };

  requests.unshift(request);
  writeJson(dataFiles.contractRequests, requests);
  return request;
}

function logMessage(message) {
  const messages = readJson(dataFiles.messages, []);

  if (messages.some(item => item.messageId === message.messageId)) {
    return false;
  }

  messages.unshift(message);
  writeJson(dataFiles.messages, messages.slice(0, 3000));
  return true;
}

/**
 * Completa una renovación, actualiza la línea y avisa al cliente.
 * La renovación se guarda aunque el envío de WhatsApp falle.
 */
async function completeRenewalRequest(requestId, newExpiration) {
  const requests = readJson(dataFiles.renewalRequests, []);
  const renewalRequest = requests.find(item => item.id === requestId);

  if (!renewalRequest) {
    const error = new Error("Solicitud de renovación no encontrada.");
    error.statusCode = 404;
    throw error;
  }

  if (renewalRequest.status === "completed") {
    return renewalRequest;
  }

  const lines = readJson(dataFiles.lines, []);
  const line = lines.find(
    item => normalize(item.username) === normalize(renewalRequest.username)
  );

  if (!line) {
    const error = new Error("La línea ya no existe en el archivo de líneas.");
    error.statusCode = 404;
    throw error;
  }

  const previousExpiration = line.expiration;

  line.expiration = newExpiration;
  writeJson(dataFiles.lines, lines);

  renewalRequest.status = "completed";
  renewalRequest.completedAt = new Date().toISOString();
  renewalRequest.previousExpiration = previousExpiration;
  renewalRequest.newExpiration = newExpiration;
  renewalRequest.notificationStatus = "pending";
  renewalRequest.notificationError = "";

  const settings = readJson(dataFiles.settings, defaultSettings);

  try {
    const message = replaceTemplate(settings.renewedConfirmation, {
      usuario: line.username,
      caducidad: formatDate(newExpiration)
    });

    await sendText(renewalRequest.phone, message);
    renewalRequest.notificationStatus = "sent";
  } catch (error) {
    renewalRequest.notificationStatus = "error";
    renewalRequest.notificationError = String(error.message || error);

    console.error(
      `La línea ${line.username} se renovó, pero falló el aviso de WhatsApp:`,
      error
    );
  }

  writeJson(dataFiles.renewalRequests, requests);
  return renewalRequest;
}

/**
 * Reintenta únicamente la notificación de una renovación ya completada.
 */
async function retryRenewalNotification(requestId) {
  const requests = readJson(dataFiles.renewalRequests, []);
  const renewalRequest = requests.find(item => item.id === requestId);

  if (!renewalRequest) {
    const error = new Error("Solicitud de renovación no encontrada.");
    error.statusCode = 404;
    throw error;
  }

  if (renewalRequest.status !== "completed" || !renewalRequest.newExpiration) {
    const error = new Error("La renovación todavía no está completada.");
    error.statusCode = 400;
    throw error;
  }

  const settings = readJson(dataFiles.settings, defaultSettings);

  try {
    const message = replaceTemplate(settings.renewedConfirmation, {
      usuario: renewalRequest.username,
      caducidad: formatDate(renewalRequest.newExpiration)
    });

    await sendText(renewalRequest.phone, message);
    renewalRequest.notificationStatus = "sent";
    renewalRequest.notificationError = "";
  } catch (error) {
    renewalRequest.notificationStatus = "error";
    renewalRequest.notificationError = String(error.message || error);
    throw error;
  } finally {
    writeJson(dataFiles.renewalRequests, requests);
  }

  return renewalRequest;
}

app.set("trust proxy", 1);
app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: "2mb" }));
app.use("/public", express.static(path.join(__dirname, "public")));

app.use(session({
  secret: process.env.SESSION_SECRET || "debes-configurar-session-secret",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 8 * 60 * 60 * 1000
  }
}));

const upload = multer({
  dest: UPLOAD_DIR,
  limits: {
    fileSize: MAX_CSV_MB * 1024 * 1024
  },
  fileFilter: (_req, file, callback) => {
    const valid =
      file.originalname.toLowerCase().endsWith(".csv") ||
      ["text/csv", "application/vnd.ms-excel", "text/plain"].includes(file.mimetype);

    callback(valid ? null : new Error("Solo se permiten archivos CSV."), valid);
  }
});

app.get("/", (_req, res) => {
  res.send("LeonBot con líneas y renovaciones está funcionando.");
});

app.get("/login", (req, res) => {
  if (req.session?.admin) return res.redirect("/admin");

  res.send(page("Acceso", `
  <section class="login-page">
    <form class="login-card" method="post" action="/login">
      <a class="logo dark" href="/"><span>LEÓN</span>BOT</a>
      <h1>Panel de gestión</h1>
      <label>Usuario<input name="user" autocomplete="username" required></label>
      <label>Contraseña<input type="password" name="password" autocomplete="current-password" required></label>
      <button>Iniciar sesión</button>
    </form>
  </section>`));
});

app.post("/login", (req, res) => {
  if (
    String(req.body.user || "") === String(process.env.ADMIN_USER || "") &&
    String(req.body.password || "") === String(process.env.ADMIN_PASSWORD || "")
  ) {
    req.session.admin = true;

    return req.session.save(error => {
      if (error) return res.status(500).send("No se pudo guardar la sesión.");
      res.redirect("/admin");
    });
  }

  res.status(401).send(page("Acceso denegado", `
  <section class="login-page">
    <div class="login-card">
      <h1>Credenciales incorrectas</h1>
      <a class="button" href="/login">Volver</a>
    </div>
  </section>`));
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

app.get("/admin", requireAuth, (_req, res) => {
  const lines = readJson(dataFiles.lines, []);
  const renewals = readJson(dataFiles.renewalRequests, []);
  const contracts = readJson(dataFiles.contractRequests, []);

  const active = lines.filter(line => getStatus(line.expiration).css === "success").length;
  const expiring = lines.filter(line => ["warning", "danger"].includes(getStatus(line.expiration).css)).length;
  const pendingRenewals = renewals.filter(item => item.status === "pending").length;
  const pendingContracts = contracts.filter(item => item.status === "pending").length;

  res.send(adminLayout("Resumen", `
  <section class="stats">
    <article><strong>${lines.length}</strong><span>Líneas</span></article>
    <article><strong>${active}</strong><span>Activas</span></article>
    <article><strong>${pendingRenewals}</strong><span>Renovaciones pendientes</span></article>
    <article><strong>${pendingContracts}</strong><span>Contrataciones pendientes</span></article>
  </section>

  <section class="card">
    <h2>Flujo del sistema</h2>
    <p><code>#usuario</code> consulta una línea.</p>
    <p><code>#renovar usuario</code> solicita renovar una línea existente, sin elegir meses.</p>
    <p><code>#contratar 1</code>, <code>#contratar 3</code>, <code>#contratar 6</code> o <code>#contratar 12</code> solicita una nueva contratación.</p>
  </section>`));
});

app.get("/admin/lines", requireAuth, (req, res) => {
  const query = normalize(req.query.q || "");
  let lines = readJson(dataFiles.lines, []);

  if (query) {
    lines = lines.filter(line =>
      normalize(line.username).includes(query) ||
      normalize(line.notes).includes(query)
    );
  }

  const rows = lines.slice(0, 500).map(line => {
    const status = getStatus(line.expiration);

    return `
    <tr>
      <td><code>${esc(line.username)}</code></td>
      <td>${esc(line.notes || "")}</td>
      <td>${esc(formatDate(line.expiration))}</td>
      <td><span class="badge ${status.css}">${status.icon} ${esc(status.label)}</span></td>
    </tr>`;
  }).join("");

  res.send(adminLayout("Líneas", `
  <section class="card">
    <form class="search">
      <input name="q" value="${esc(req.query.q || "")}" placeholder="Buscar usuario o nota">
      <button>Buscar</button>
    </form>
    <p>Mostrando ${Math.min(lines.length, 500)} de ${lines.length} resultados.</p>
    <div class="table"><table>
      <thead><tr><th>Usuario</th><th>Notas</th><th>Caducidad</th><th>Estado</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </section>`));
});

app.get("/admin/import", requireAuth, (_req, res) => {
  res.send(adminLayout("Importar CSV", `
  <section class="card">
    <h2>Actualizar las líneas</h2>
    <p>Columnas admitidas: <code>ID</code>, <code>Username</code>, <code>Expiration</code> y <code>Reseller Notes</code>.</p>
    <form method="post" enctype="multipart/form-data">
      <label>Archivo CSV<input type="file" name="csv" accept=".csv,text/csv" required></label>
      <label class="check"><input type="checkbox" name="replace" checked> Reemplazar todas las líneas actuales</label>
      <button>Importar</button>
    </form>
  </section>`));
});

app.post("/admin/import", requireAuth, upload.single("csv"), (req, res) => {
  try {
    const content = fs.readFileSync(req.file.path, "utf8").replace(/^\uFEFF/, "");
    const records = parse(content, {
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true
    });

    const imported = records
      .map(row => ({
        id: String(row.ID || row.Id || row.id || "").trim(),
        username: String(row.Username || row.username || "").trim(),
        expiration: String(row.Expiration || row.expiration || "").trim(),
        notes: String(row["Reseller Notes"] || row.notes || "").trim(),
        active: true
      }))
      .filter(line => line.username);

    let result = imported;

    if (!req.body.replace) {
      const current = readJson(dataFiles.lines, []);
      const map = new Map(current.map(line => [normalize(line.username), line]));

      for (const line of imported) {
        map.set(normalize(line.username), line);
      }

      result = [...map.values()];
    }

    writeJson(dataFiles.lines, result);
    fs.unlinkSync(req.file.path);

    res.send(adminLayout("Importación completada", `
    <section class="card centered">
      <div class="big">✅</div>
      <h2>${imported.length} líneas importadas</h2>
      <a class="button" href="/admin/lines">Ver líneas</a>
    </section>`));
  } catch (error) {
    if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

    res.status(400).send(adminLayout("Error", `
    <section class="card">
      <h2>No se pudo importar el CSV</h2>
      <p>${esc(error.message)}</p>
      <a class="button" href="/admin/import">Volver</a>
    </section>`));
  }
});


app.get("/admin/renewals", requireAuth, (_req, res) => {
  const requests = readJson(dataFiles.renewalRequests, [])
    .sort((a, b) => {
      if (a.status !== b.status) {
        return a.status === "pending" ? -1 : 1;
      }

      return new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime();
    });

  const rows = requests.map(item => {
    const line = findLine(item.username);
    const currentStatus = line ? getStatus(line.expiration) : null;

    const lineInfo = line
      ? `
        <small class="line-meta">
          Caducidad actual:
          <strong>${esc(formatDate(line.expiration))}</strong>
          <br>
          Estado:
          <span class="badge ${currentStatus.css}">
            ${currentStatus.icon} ${esc(currentStatus.label)}
          </span>
        </small>
      `
      : `
        <small class="danger-text">
          La línea ya no existe en el archivo importado.
        </small>
      `;

    const pendingActions =
      item.status === "pending"
        ? `
          <div class="renewal-actions">
            <form
              method="post"
              action="/admin/renewals/${item.id}/complete-one-month"
              onsubmit="return confirm('¿Renovar esta línea un mes y enviar la confirmación al cliente?')"
            >
              <button type="submit" class="small full-button">
                Renovar +1 mes y avisar
              </button>
            </form>

            <details class="manual-renewal">
              <summary>Elegir otra fecha</summary>

              <form
                class="renew-form"
                method="post"
                action="/admin/renewals/${item.id}/complete"
              >
                <label>
                  Nueva caducidad
                  <input
                    type="datetime-local"
                    name="newExpiration"
                    required
                  >
                </label>

                <button type="submit" class="small secondary full-button">
                  Guardar fecha y avisar
                </button>
              </form>
            </details>
          </div>
        `
        : `
          <div class="completed-renewal">
            <small>
              Antes:
              <strong>${esc(formatDate(item.previousExpiration))}</strong>
              <br>
              Nueva caducidad:
              <strong>${esc(formatDate(item.newExpiration))}</strong>
              <br>
              WhatsApp:
              ${
                item.notificationStatus === "sent"
                  ? '<span class="notice-ok">✅ Enviado</span>'
                  : item.notificationStatus === "error"
                    ? '<span class="danger-text">❌ Error</span>'
                    : "Pendiente"
              }
            </small>

            ${
              item.notificationStatus === "error"
                ? `
                  <form
                    method="post"
                    action="/admin/renewals/${item.id}/retry-notification"
                  >
                    <button type="submit" class="small secondary full-button">
                      Reintentar aviso
                    </button>
                  </form>
                  <small class="danger-text error-detail">
                    ${esc(item.notificationError || "")}
                  </small>
                `
                : ""
            }
          </div>
        `;

    return `
      <tr>
        <td>
          <code>${esc(item.username)}</code>
          <br>
          ${lineInfo}
        </td>
        <td>${esc(item.phone)}</td>
        <td>
          ${esc(item.reason)}
          <br>
          <small>Origen: ${esc(item.source || "manual")}</small>
        </td>
        <td>${esc(new Date(item.requestedAt).toLocaleString("es-ES"))}</td>
        <td>
          <span class="badge ${item.status === "pending" ? "warning" : "success"}">
            ${item.status === "pending" ? "Pendiente" : "Completada"}
          </span>
        </td>
        <td>${pendingActions}</td>
      </tr>
    `;
  }).join("");

  const emptyState =
    requests.length === 0
      ? `
        <div class="empty-state">
          <div class="big">✅</div>
          <h3>No hay avisos de renovación</h3>
          <p>Cuando un cliente solicite una renovación, aparecerá aquí.</p>
        </div>
      `
      : `
        <div class="table">
          <table>
            <thead>
              <tr>
                <th>Línea</th>
                <th>WhatsApp</th>
                <th>Motivo</th>
                <th>Solicitud</th>
                <th>Estado</th>
                <th>Acción</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      `;

  res.send(adminLayout("Avisos de renovación", `
    <section class="card">
      <div class="section-heading">
        <div>
          <h2>Renovaciones solicitadas</h2>
          <p>
            El botón automático amplía la línea un mes natural y envía
            la confirmación al WhatsApp que realizó la solicitud.
          </p>
        </div>
      </div>

      <div class="info-box">
        <strong>Regla automática</strong>
        <span>
          Si la línea sigue activa, se suma un mes desde su caducidad.
          Si ya está caducada, se suma un mes desde hoy.
        </span>
      </div>

      ${emptyState}
    </section>
  `));
});

/**
 * Renovación rápida: +1 mes natural y aviso por WhatsApp.
 */
app.post(
  "/admin/renewals/:id/complete-one-month",
  requireAuth,
  async (req, res) => {
    try {
      const requests = readJson(dataFiles.renewalRequests, []);
      const renewalRequest = requests.find(item => item.id === req.params.id);

      if (!renewalRequest) {
        return res.status(404).send("Solicitud de renovación no encontrada.");
      }

      if (renewalRequest.status === "completed") {
        return res.redirect("/admin/renewals");
      }

      const line = findLine(renewalRequest.username);

      if (!line) {
        return res.status(404).send(
          "La línea ya no existe en el archivo de líneas."
        );
      }

      const newExpiration = addOneCalendarMonth(line.expiration);

      await completeRenewalRequest(req.params.id, newExpiration);
      return res.redirect("/admin/renewals");
    } catch (error) {
      console.error("Error completando la renovación automática:", error);
      return res
        .status(error.statusCode || 500)
        .send(esc(error.message || "No se pudo completar la renovación."));
    }
  }
);

/**
 * Renovación con una fecha elegida manualmente.
 */
app.post(
  "/admin/renewals/:id/complete",
  requireAuth,
  async (req, res) => {
    try {
      const newExpiration = toStorageDate(req.body.newExpiration);
      await completeRenewalRequest(req.params.id, newExpiration);
      return res.redirect("/admin/renewals");
    } catch (error) {
      console.error("Error completando la renovación manual:", error);
      return res
        .status(error.statusCode || 500)
        .send(esc(error.message || "No se pudo completar la renovación."));
    }
  }
);

/**
 * Reenvía el aviso si la línea se renovó pero Meta rechazó el mensaje.
 */
app.post(
  "/admin/renewals/:id/retry-notification",
  requireAuth,
  async (req, res) => {
    try {
      await retryRenewalNotification(req.params.id);
      return res.redirect("/admin/renewals");
    } catch (error) {
      console.error("Error reenviando el aviso de renovación:", error);
      return res.redirect("/admin/renewals");
    }
  }
);

app.get("/admin/contracts", requireAuth, (_req, res) => {
  const requests = readJson(dataFiles.contractRequests, []);

  const rows = requests.map(item => `
  <tr>
    <td>${esc(item.phone)}</td>
    <td>${esc(item.months)} meses</td>
    <td>${esc(new Date(item.requestedAt).toLocaleString("es-ES"))}</td>
    <td><span class="badge ${item.status === "pending" ? "warning" : "success"}">${esc(item.status)}</span></td>
    <td>
      <form method="post" action="/admin/contracts/${item.id}/toggle">
        <button class="small">${item.status === "pending" ? "Marcar gestionada" : "Reabrir"}</button>
      </form>
    </td>
  </tr>`).join("");

  res.send(adminLayout("Contrataciones", `
  <section class="card">
    <p>Estas solicitudes corresponden a altas nuevas de 1, 3, 6 o 12 meses.</p>
    <div class="table"><table>
      <thead><tr><th>WhatsApp</th><th>Duración</th><th>Fecha</th><th>Estado</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </section>`));
});

app.post("/admin/contracts/:id/toggle", requireAuth, (req, res) => {
  const requests = readJson(dataFiles.contractRequests, []);
  const request = requests.find(item => item.id === req.params.id);

  if (request) {
    request.status = request.status === "pending" ? "managed" : "pending";
    writeJson(dataFiles.contractRequests, requests);
  }

  res.redirect("/admin/contracts");
});

app.get("/admin/settings", requireAuth, (_req, res) => {
  const settings = readJson(dataFiles.settings, defaultSettings);

  res.send(adminLayout("Ajustes", `
  <section class="card">
    <form method="post">
      <label>Días para crear aviso automático
        <input type="number" min="0" max="365" name="renewalAlertDays" value="${esc(settings.renewalAlertDays)}">
      </label>

      <label>Mensaje del menú
        <textarea name="menuText" rows="12">${esc(settings.menuText)}</textarea>
      </label>

      <label>Mensaje de instalación
        <textarea name="installationText" rows="9">${esc(settings.installationText)}</textarea>
      </label>

      <label>Mensaje de soporte
        <textarea name="supportText" rows="8">${esc(settings.supportText)}</textarea>
      </label>

      <label>Mensaje de contratación
        <textarea name="contractText" rows="10">${esc(settings.contractText)}</textarea>
      </label>

      <label>Confirmación de contratación
        <textarea name="contractConfirmation" rows="8">${esc(settings.contractConfirmation)}</textarea>
      </label>

      <label>Confirmación de solicitud de renovación
        <textarea name="renewalRequestConfirmation" rows="9">${esc(settings.renewalRequestConfirmation)}</textarea>
      </label>

      <label>Confirmación cuando tú renuevas
        <textarea name="renewedConfirmation" rows="9">${esc(settings.renewedConfirmation)}</textarea>
      </label>

      <label>Aviso automático al consultar una línea próxima a caducar
        <textarea name="autoAlertMessage" rows="5">${esc(settings.autoAlertMessage)}</textarea>
      </label>

      <label>Mensaje para comandos desconocidos
        <textarea name="unknownMessage" rows="5">${esc(settings.unknownMessage)}</textarea>
      </label>

      <button>Guardar ajustes</button>
    </form>
  </section>`));
});

app.post("/admin/settings", requireAuth, (req, res) => {
  const current = readJson(dataFiles.settings, defaultSettings);

  const updated = {
    ...current,
    renewalAlertDays: Math.max(0, Number(req.body.renewalAlertDays || 0)),
    menuText: String(req.body.menuText || ""),
    installationText: String(req.body.installationText || ""),
    supportText: String(req.body.supportText || ""),
    contractText: String(req.body.contractText || ""),
    contractConfirmation: String(req.body.contractConfirmation || ""),
    renewalRequestConfirmation: String(req.body.renewalRequestConfirmation || ""),
    renewedConfirmation: String(req.body.renewedConfirmation || ""),
    autoAlertMessage: String(req.body.autoAlertMessage || ""),
    unknownMessage: String(req.body.unknownMessage || "")
  };

  writeJson(dataFiles.settings, updated);
  res.redirect("/admin/settings");
});

app.get("/admin/export", requireAuth, (_req, res) => {
  const backup = {
    exportedAt: new Date().toISOString(),
    lines: readJson(dataFiles.lines, []),
    renewalRequests: readJson(dataFiles.renewalRequests, []),
    contractRequests: readJson(dataFiles.contractRequests, []),
    messages: readJson(dataFiles.messages, []),
    settings: readJson(dataFiles.settings, defaultSettings)
  };

  res.setHeader(
    "Content-Disposition",
    `attachment; filename="leonbot-backup-${Date.now()}.json"`
  );

  res.type("application/json").send(JSON.stringify(backup, null, 2));
});

app.get("/webhook", (req, res) => {
  if (
    req.query["hub.mode"] === "subscribe" &&
    req.query["hub.verify_token"] === process.env.WEBHOOK_VERIFY_TOKEN
  ) {
    return res.status(200).send(req.query["hub.challenge"]);
  }

  res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  try {
    const message = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!message || message.type !== "text") return;

    const messageId = String(message.id || "");
    const phone = String(message.from || "");
    const incoming = String(message.text?.body || "").trim();
    const lower = normalize(incoming);

    if (!messageId || !phone || !incoming) return;

    const isNew = logMessage({
      messageId,
      phone,
      incoming,
      receivedAt: new Date().toISOString()
    });

    if (!isNew) return;

    const settings = readJson(dataFiles.settings, defaultSettings);

    if (lower === "#menu" || lower === "#ayuda") {
      await sendText(phone, settings.menuText);
      return;
    }

    if (lower === "#instalar") {
      await sendText(phone, settings.installationText);
      return;
    }

    if (lower === "#soporte") {
      await sendText(phone, settings.supportText);
      return;
    }

    if (lower === "#contratar") {
      await sendText(phone, settings.contractText);
      return;
    }

    const contractMatch = lower.match(/^#contratar\s+(1|3|6|12)(?:\s+mes(?:es)?)?$/);

    if (contractMatch) {
      const months = Number(contractMatch[1]);
      saveContractRequest({ phone, months });

      await sendText(
        phone,
        replaceTemplate(settings.contractConfirmation, {
          periodo: `${months} ${months === 1 ? "mes" : "meses"}`
        })
      );
      return;
    }

    const renewalMatch = incoming.match(/^#renovar\s+(.+)$/i);

    if (renewalMatch) {
      const username = renewalMatch[1].trim();
      const line = findLine(username);

      if (!line) {
        await sendText(phone, `No hemos encontrado la línea *${username}*.\n\nComprueba el usuario e inténtalo de nuevo.`);
        return;
      }

      saveRenewalRequest({
        username: line.username,
        phone,
        source: "explicit",
        reason: "Solicitud enviada por el cliente"
      });

      await sendText(
        phone,
        replaceTemplate(settings.renewalRequestConfirmation, {
          usuario: line.username,
          caducidad: formatDate(line.expiration)
        })
      );
      return;
    }

    if (lower.startsWith("#") && !lower.includes(" ")) {
      const username = incoming.slice(1).trim();
      const line = findLine(username);

      if (line) {
        const status = getStatus(line.expiration);
        const daysText =
          status.days === null
            ? "No disponible"
            : status.days < 0
              ? `Caducó hace ${Math.abs(status.days)} días`
              : `${status.days} días`;

        let response =
          `📺 *INFORMACIÓN DE TU LÍNEA*\n\n` +
          `👤 Usuario: *${line.username}*\n` +
          `${status.icon} Estado: *${status.label}*\n` +
          `📅 Caducidad: *${formatDate(line.expiration)}*\n` +
          `⏳ Tiempo restante: *${daysText}*`;

        const alertDays = Number(settings.renewalAlertDays || 0);

        if (status.days !== null && status.days <= alertDays) {
          saveRenewalRequest({
            username: line.username,
            phone,
            source: "automatic",
            reason:
              status.days < 0
                ? "Línea caducada consultada por el cliente"
                : `Caduca en ${status.days} días`
          });

          response += `\n\n${settings.autoAlertMessage}`;
        } else {
          response += `\n\nPara solicitar la renovación de esta línea escribe:\n*#renovar ${line.username}*`;
        }

        await sendText(phone, response);
        return;
      }
    }

    await sendText(phone, settings.unknownMessage);
  } catch (error) {
    console.error("Error procesando el webhook:", error);
  }
});

app.use((req, res) => {
  res.status(404).send(page("No encontrado", `
  <section class="login-page">
    <div class="login-card">
      <h1>Página no encontrada</h1>
      <p>${esc(req.path)}</p>
      <a class="button" href="/">Volver</a>
    </div>
  </section>`));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`LeonBot con líneas activo en el puerto ${PORT}`);
  console.log(`Panel: ${APP_URL}/admin`);
});
