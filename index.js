require("dotenv").config();

const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");

const store = require("./src/store");
const auth = require("./src/auth");
const wa = require("./src/whatsapp");
const ui = require("./src/ui");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const APP_URL = String(process.env.APP_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || "./uploads");
const MAX_UPLOAD_MB = Math.max(1, Number(process.env.MAX_UPLOAD_MB || 20));
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.set("trust proxy", 1);
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' data: https:; media-src 'self' https:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
  next();
});
app.use(express.json({ limit: "2mb", verify: (req, _res, buf) => { req.rawBody = Buffer.from(buf); } }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));
app.use("/public", express.static(path.join(__dirname, "public"), { maxAge: "1h" }));
app.use("/uploads", express.static(UPLOAD_DIR, { maxAge: "1h" }));

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const safe = path.basename(file.originalname).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9._-]/g, "-");
      cb(null, `${Date.now()}-${safe}`);
    }
  }),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 }
});

function rateLimiter(windowMs, limit) {
  const buckets = new Map();
  return (req, res, next) => {
    const key = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    const current = buckets.get(key);
    if (!current || current.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    current.count += 1;
    if (current.count > limit) {
      res.setHeader("Retry-After", Math.ceil((current.resetAt - now) / 1000));
      return res.status(429).send("Demasiadas solicitudes. Inténtalo de nuevo más tarde.");
    }
    next();
  };
}
const loginLimiter = rateLimiter(15 * 60 * 1000, 10);
const webhookLimiter = rateLimiter(60 * 1000, 300);

function redirectWith(res, pathName, message) { res.redirect(`${pathName}?ok=${encodeURIComponent(message)}`); }
function flash(req) { return String(req.query.ok || ""); }
function normalizeCommand(value) {
  let command = String(value || "").trim().toLowerCase().replace(/\s+/g, "");
  if (!command.startsWith("#")) command = `#${command}`;
  if (!/^#[a-záéíóúüñ0-9_-]{1,40}$/i.test(command)) throw new Error("El comando solo puede contener letras, números, guiones y guion bajo.");
  return command;
}
function localMediaUrl(filename) { return `${APP_URL}/uploads/${encodeURIComponent(filename)}`; }
function mediaPathFromUrl(url) {
  const prefix = `${APP_URL}/uploads/`;
  if (!String(url).startsWith(prefix)) return null;
  return path.join(UPLOAD_DIR, path.basename(decodeURIComponent(String(url).slice(prefix.length))));
}
function removeLocalMedia(url) {
  const target = mediaPathFromUrl(url);
  if (target && fs.existsSync(target)) fs.unlinkSync(target);
}
function activeCommands() { return store.read("commands").filter(item => item.active); }
function buildMenu() {
  const settings = store.read("settings");
  const lines = activeCommands().filter(item => item.showInMenu).sort((a,b) => a.command.localeCompare(b.command, "es"))
    .map(item => `${item.command} — ${item.title}`);
  return [settings.menuTitle, "", ...lines, "", settings.menuFooter].filter(v => v !== undefined && v !== null).join("\n").slice(0, 4096);
}
function addMessage(record) {
  store.update("messages", items => [record, ...items].slice(0, 500));
}
function markProcessed(messageId) {
  let duplicate = false;
  store.update("processed", ids => {
    duplicate = ids.includes(messageId);
    return duplicate ? ids : [messageId, ...ids].slice(0, 1000);
  });
  return duplicate;
}
function upsertClient(phone, profileName = "") {
  const stamp = store.now();
  store.update("clients", clients => {
    const existing = clients.find(c => c.phone === phone);
    if (existing) {
      existing.lastSeenAt = stamp;
      existing.messageCount = Number(existing.messageCount || 0) + 1;
      if (!existing.name && profileName) existing.name = profileName;
    } else {
      clients.unshift({ id: store.id("cli"), phone, name: profileName, plan: "", expirationDate: "", notes: "", messageCount: 1, createdAt: stamp, lastSeenAt: stamp });
    }
    return clients;
  });
}
function shouldSendWelcome(settings, previousClient) {
  const mode = String(settings.welcomeMode || "disabled");
  if (mode === "disabled" || !String(settings.welcomeText || "").trim()) return false;
  if (!previousClient || !previousClient.welcomeSentAt) return true;
  if (mode === "first_time") return false;
  if (mode === "after_24h") {
    const lastActivity = new Date(previousClient.lastSeenAt || previousClient.welcomeSentAt).getTime();
    return !Number.isFinite(lastActivity) || Date.now() - lastActivity >= 24 * 60 * 60 * 1000;
  }
  return false;
}
function markWelcomeSent(phone) {
  store.update("clients", clients => {
    const client = clients.find(c => c.phone === phone);
    if (client) client.welcomeSentAt = store.now();
    return clients;
  });
}

function createRenewalRequest(phone) {
  const today = new Date().toISOString().slice(0,10);
  store.update("renewals", renewals => {
    const existing = renewals.find(r => r.clientPhone === phone && ["requested","pending"].includes(r.status));
    if (!existing) renewals.unshift({ id: store.id("ren"), clientPhone: phone, plan: "Por concretar", amount: 0, renewalDate: today, status: "requested", notes: "Solicitud automática recibida por WhatsApp.", createdAt: store.now(), updatedAt: store.now() });
    return renewals;
  });
}

app.get("/health", (_req, res) => res.status(200).json({ ok: true, service: "LeonBot", version: "3.0.0" }));
app.get("/", (_req, res) => res.send("LeonBot profesional está funcionando."));

app.get("/login", (req, res) => {
  if (auth.current(req)) return res.redirect("/admin");
  res.send(ui.page("Acceso", `<section class="login-shell"><div class="login-panel"><div class="login-logo"><span>LEON</span>BOT</div><p>Panel profesional de WhatsApp</p><form method="post" action="/login" class="form-stack"><label>Usuario<input name="user" autocomplete="username" required></label><label>Contraseña<input type="password" name="password" autocomplete="current-password" required></label><button type="submit">Entrar al panel</button>${req.query.error?'<div class="form-error">Usuario o contraseña incorrectos.</div>':''}</form></div></section>`));
});
app.post("/login", loginLimiter, (req, res) => {
  const configured = process.env.ADMIN_USER && process.env.ADMIN_PASSWORD && process.env.SESSION_SECRET;
  if (!configured) return res.status(503).send("Configura ADMIN_USER, ADMIN_PASSWORD y SESSION_SECRET en Render.");
  if (req.body.user !== process.env.ADMIN_USER || req.body.password !== process.env.ADMIN_PASSWORD) return res.redirect("/login?error=1");
  auth.login(res, req.body.user); res.redirect("/admin");
});
app.get("/logout", (_req, res) => { auth.logout(res); res.redirect("/login"); });

app.use("/admin", auth.requireAuth);

app.get("/admin", (req, res) => {
  const commands = store.read("commands"); const clients = store.read("clients"); const renewals = store.read("renewals"); const messages = store.read("messages");
  const top = [...commands].sort((a,b) => Number(b.usageCount||0)-Number(a.usageCount||0)).slice(0,5);
  const recent = messages.slice(0,8);
  res.send(ui.page("Inicio", `<section class="hero"><div><span class="eyebrow">CENTRO DE CONTROL</span><h1>LeonBot profesional</h1><p>Gestiona respuestas, clientes, archivos y renovaciones desde un único panel.</p></div><div class="status-pill">● API activa</div></section><section class="stats"><article><strong>${commands.filter(x=>x.active).length}</strong><span>Comandos activos</span></article><article><strong>${clients.length}</strong><span>Clientes registrados</span></article><article><strong>${renewals.filter(x=>["requested","pending"].includes(x.status)).length}</strong><span>Renovaciones abiertas</span></article><article><strong>${messages.length}</strong><span>Mensajes registrados</span></article></section><div class="warning"><strong>Render gratuito:</strong> las modificaciones hechas desde el panel se guardan en JSON, pero pueden perderse tras un reinicio o despliegue. Usa <a href="/admin/backup">Copias</a> para exportarlas.</div><section class="grid-2"><article class="card"><div class="card-head"><h2>Comandos más usados</h2><a href="/admin/commands">Gestionar</a></div>${top.length?`<div class="rank-list">${top.map(x=>`<div><code>${ui.esc(x.command)}</code><span>${Number(x.usageCount||0)} usos</span></div>`).join("")}</div>`:'<p class="muted">Todavía no hay datos.</p>'}</article><article class="card"><div class="card-head"><h2>Actividad reciente</h2><a href="/admin/messages">Ver todo</a></div>${recent.length?`<div class="activity">${recent.map(x=>`<div><strong>${ui.esc(x.phone)}</strong><span>${ui.esc(x.incomingText||x.type)}</span><time>${ui.fmtDate(x.createdAt)}</time></div>`).join("")}</div>`:'<p class="muted">Todavía no hay mensajes.</p>'}</article></section>`, { auth:req.auth, active:"home", flash:flash(req) }));
});

function commandForm(req, command = {}) {
  return `<form class="card form-grid" method="post" enctype="multipart/form-data" action="${command.id?`/admin/commands/${command.id}`:"/admin/commands"}">${ui.csrf(req)}<label>Comando<input name="command" value="${ui.esc(command.command||"#")}" required></label><label>Título visible<input name="title" value="${ui.esc(command.title||"")}" required></label><label class="full">Respuesta de texto<textarea name="text" rows="9" placeholder="Escribe la respuesta que recibirá el cliente">${ui.esc(command.text||"")}</textarea></label><label>Tipo de archivo<select name="mediaType">${["none","image","document","video","audio"].map(v=>`<option value="${v}" ${ui.selected(command.mediaType||"none",v)}>${v}</option>`).join("")}</select></label><label>URL pública del archivo<input name="mediaUrl" value="${ui.esc(command.mediaUrl||"")}" placeholder="https://..."></label><label class="full">O subir archivo<input type="file" name="media"></label>${command.mediaUrl?`<div class="full current-file">Archivo actual: <a href="${ui.esc(command.mediaUrl)}" target="_blank" rel="noopener">${ui.esc(command.mediaFilename||command.mediaUrl)}</a></div>`:""}<label class="check"><input type="checkbox" name="active" ${ui.checked(command.active!==false)}> Comando activo</label><label class="check"><input type="checkbox" name="showInMenu" ${ui.checked(command.showInMenu!==false)}> Mostrar en #menu</label><label class="check full"><input type="checkbox" name="createsRenewalRequest" ${ui.checked(command.createsRenewalRequest)}> Crear solicitud de renovación al utilizarlo</label><div class="full form-actions"><button type="submit">Guardar comando</button><a class="button secondary" href="/admin/commands">Cancelar</a></div></form>`;
}
app.get("/admin/commands", (req,res) => {
  const rows = store.read("commands").sort((a,b)=>a.command.localeCompare(b.command,"es"));
  res.send(ui.page("Comandos", `<div class="page-head"><div><span class="eyebrow">AUTOMATIZACIÓN</span><h1>Comandos</h1><p>Crea y modifica las respuestas sin tocar el código.</p></div><a class="button" href="/admin/commands/new">+ Nuevo comando</a></div><div class="table-card"><table><thead><tr><th>Comando</th><th>Título</th><th>Contenido</th><th>Estado</th><th>Usos</th><th></th></tr></thead><tbody>${rows.map(x=>`<tr><td><code>${ui.esc(x.command)}</code></td><td>${ui.esc(x.title)}</td><td>${x.mediaType!=="none"?`<span class="badge">${ui.esc(x.mediaType)}</span>`:"Texto"}</td><td><span class="status ${x.active?"on":"off"}">${x.active?"Activo":"Pausado"}</span></td><td>${Number(x.usageCount||0)}</td><td class="row-actions"><a class="button small secondary" href="/admin/commands/${x.id}/edit">Editar</a><form method="post" action="/admin/commands/${x.id}/toggle">${ui.csrf(req)}<button class="small" type="submit">${x.active?"Pausar":"Activar"}</button></form><form method="post" action="/admin/commands/${x.id}/delete" data-confirm="¿Eliminar este comando?">${ui.csrf(req)}<button class="small danger" type="submit">Eliminar</button></form></td></tr>`).join("")}</tbody></table></div>`, {auth:req.auth,active:"commands",flash:flash(req)}));
});
app.get("/admin/commands/new", (req,res)=>res.send(ui.page("Nuevo comando",`<div class="page-head"><div><span class="eyebrow">NUEVO</span><h1>Crear comando</h1></div></div>${commandForm(req)}`,{auth:req.auth,active:"commands"})));
app.get("/admin/commands/:id/edit", (req,res)=>{const x=store.read("commands").find(c=>c.id===req.params.id);if(!x)return res.sendStatus(404);res.send(ui.page("Editar comando",`<div class="page-head"><div><span class="eyebrow">EDICIÓN</span><h1>${ui.esc(x.command)}</h1></div></div>${commandForm(req,x)}`,{auth:req.auth,active:"commands"}));});
app.post("/admin/commands", upload.single("media"), auth.requireCsrf, (req,res,next)=>{try{const command=normalizeCommand(req.body.command);const commands=store.read("commands");if(commands.some(x=>x.command===command))throw new Error("Ese comando ya existe.");const stamp=store.now();commands.push({id:store.id("cmd"),command,title:String(req.body.title||"").trim(),text:String(req.body.text||""),mediaType:req.body.mediaType||"none",mediaUrl:req.file?localMediaUrl(req.file.filename):String(req.body.mediaUrl||"").trim(),mediaFilename:req.file?req.file.originalname:"",active:Boolean(req.body.active),showInMenu:Boolean(req.body.showInMenu),createsRenewalRequest:Boolean(req.body.createsRenewalRequest),usageCount:0,createdAt:stamp,updatedAt:stamp});store.write("commands",commands);redirectWith(res,"/admin/commands","Comando creado correctamente.");}catch(e){next(e);}});
app.post("/admin/commands/:id", upload.single("media"), auth.requireCsrf, (req,res,next)=>{try{store.update("commands",commands=>{const x=commands.find(c=>c.id===req.params.id);if(!x)throw new Error("Comando no encontrado.");const command=normalizeCommand(req.body.command);if(commands.some(c=>c.id!==x.id&&c.command===command))throw new Error("Ese comando ya existe.");if(req.file&&x.mediaUrl)removeLocalMedia(x.mediaUrl);Object.assign(x,{command,title:String(req.body.title||"").trim(),text:String(req.body.text||""),mediaType:req.body.mediaType||"none",mediaUrl:req.file?localMediaUrl(req.file.filename):String(req.body.mediaUrl||"").trim(),mediaFilename:req.file?req.file.originalname:x.mediaFilename||"",active:Boolean(req.body.active),showInMenu:Boolean(req.body.showInMenu),createsRenewalRequest:Boolean(req.body.createsRenewalRequest),updatedAt:store.now()});return commands;});redirectWith(res,"/admin/commands","Cambios guardados.");}catch(e){next(e);}});
app.post("/admin/commands/:id/toggle", auth.requireCsrf, (req,res)=>{store.update("commands",commands=>{const x=commands.find(c=>c.id===req.params.id);if(x){x.active=!x.active;x.updatedAt=store.now();}return commands;});redirectWith(res,"/admin/commands","Estado actualizado.");});
app.post("/admin/commands/:id/delete", auth.requireCsrf, (req,res)=>{store.update("commands",commands=>{const x=commands.find(c=>c.id===req.params.id);if(x)removeLocalMedia(x.mediaUrl);return commands.filter(c=>c.id!==req.params.id);});redirectWith(res,"/admin/commands","Comando eliminado.");});

app.get("/admin/clients", (req,res)=>{const clients=store.read("clients").sort((a,b)=>String(b.lastSeenAt).localeCompare(String(a.lastSeenAt)));res.send(ui.page("Clientes",`<div class="page-head"><div><span class="eyebrow">CONTACTOS</span><h1>Clientes</h1><p>Se registran automáticamente cuando escriben al bot.</p></div></div><div class="table-card"><table><thead><tr><th>Cliente</th><th>Teléfono</th><th>Plan</th><th>Vencimiento</th><th>Mensajes</th><th>Última actividad</th><th></th></tr></thead><tbody>${clients.map(x=>`<tr><td>${ui.esc(x.name||"Sin nombre")}</td><td><code>${ui.esc(x.phone)}</code></td><td>${ui.esc(x.plan||"—")}</td><td>${ui.esc(x.expirationDate||"—")}</td><td>${Number(x.messageCount||0)}</td><td>${ui.fmtDate(x.lastSeenAt)}</td><td><a class="button small secondary" href="/admin/clients/${x.id}/edit">Editar</a></td></tr>`).join("")}</tbody></table></div>`,{auth:req.auth,active:"clients",flash:flash(req)}));});
app.get("/admin/clients/:id/edit",(req,res)=>{const x=store.read("clients").find(c=>c.id===req.params.id);if(!x)return res.sendStatus(404);res.send(ui.page("Editar cliente",`<div class="page-head"><div><span class="eyebrow">CLIENTE</span><h1>${ui.esc(x.name||x.phone)}</h1></div></div><form class="card form-grid" method="post" action="/admin/clients/${x.id}">${ui.csrf(req)}<label>Teléfono<input value="${ui.esc(x.phone)}" disabled></label><label>Nombre<input name="name" value="${ui.esc(x.name||"")}"></label><label>Plan<input name="plan" value="${ui.esc(x.plan||"")}"></label><label>Fecha de vencimiento<input type="date" name="expirationDate" value="${ui.esc(x.expirationDate||"")}"></label><label class="full">Notas<textarea name="notes" rows="7">${ui.esc(x.notes||"")}</textarea></label><div class="full form-actions"><button>Guardar cliente</button><a class="button secondary" href="/admin/clients">Cancelar</a></div></form>`,{auth:req.auth,active:"clients"}));});
app.post("/admin/clients/:id",auth.requireCsrf,(req,res)=>{store.update("clients",clients=>{const x=clients.find(c=>c.id===req.params.id);if(x)Object.assign(x,{name:String(req.body.name||"").trim(),plan:String(req.body.plan||"").trim(),expirationDate:String(req.body.expirationDate||""),notes:String(req.body.notes||"")});return clients;});redirectWith(res,"/admin/clients","Cliente actualizado.");});

app.get("/admin/renewals",(req,res)=>{const renewals=store.read("renewals").sort((a,b)=>String(a.renewalDate).localeCompare(String(b.renewalDate)));const clients=store.read("clients");const clientName=phone=>clients.find(c=>c.phone===phone)?.name||phone;res.send(ui.page("Renovaciones",`<div class="page-head"><div><span class="eyebrow">SEGUIMIENTO</span><h1>Renovaciones</h1></div></div><form class="card form-grid" method="post" action="/admin/renewals">${ui.csrf(req)}<label>Cliente<select name="clientPhone" required><option value="">Seleccionar</option>${clients.map(c=>`<option value="${ui.esc(c.phone)}">${ui.esc(c.name||c.phone)} — ${ui.esc(c.phone)}</option>`).join("")}</select></label><label>Plan<input name="plan" placeholder="12 meses"></label><label>Importe (€)<input type="number" min="0" step="0.01" name="amount" value="0"></label><label>Fecha<input type="date" name="renewalDate" required></label><label>Estado<select name="status"><option value="requested">Solicitada</option><option value="pending">Pendiente</option><option value="paid">Pagada</option><option value="cancelled">Cancelada</option></select></label><label class="full">Notas<textarea name="notes" rows="3"></textarea></label><div class="full"><button>Añadir renovación</button></div></form><div class="table-card"><table><thead><tr><th>Cliente</th><th>Plan</th><th>Importe</th><th>Fecha</th><th>Estado</th><th></th></tr></thead><tbody>${renewals.map(x=>`<tr><td>${ui.esc(clientName(x.clientPhone))}<small>${ui.esc(x.clientPhone)}</small></td><td>${ui.esc(x.plan||"—")}</td><td>${Number(x.amount||0).toFixed(2)} €</td><td>${ui.esc(x.renewalDate)}</td><td><span class="badge">${ui.esc(x.status)}</span></td><td class="row-actions"><form method="post" action="/admin/renewals/${x.id}/status">${ui.csrf(req)}<select name="status"><option ${ui.selected(x.status,"requested")} value="requested">Solicitada</option><option ${ui.selected(x.status,"pending")} value="pending">Pendiente</option><option ${ui.selected(x.status,"paid")} value="paid">Pagada</option><option ${ui.selected(x.status,"cancelled")} value="cancelled">Cancelada</option></select><button class="small">Guardar</button></form><form method="post" action="/admin/renewals/${x.id}/delete" data-confirm="¿Eliminar esta renovación?">${ui.csrf(req)}<button class="small danger">Eliminar</button></form></td></tr>`).join("")}</tbody></table></div>`,{auth:req.auth,active:"renewals",flash:flash(req)}));});
app.post("/admin/renewals",auth.requireCsrf,(req,res)=>{store.update("renewals",items=>[{id:store.id("ren"),clientPhone:req.body.clientPhone,plan:String(req.body.plan||""),amount:Number(req.body.amount||0),renewalDate:req.body.renewalDate,status:req.body.status||"pending",notes:String(req.body.notes||""),createdAt:store.now(),updatedAt:store.now()},...items]);redirectWith(res,"/admin/renewals","Renovación añadida.");});
app.post("/admin/renewals/:id/status",auth.requireCsrf,(req,res)=>{store.update("renewals",items=>{const x=items.find(r=>r.id===req.params.id);if(x){x.status=req.body.status;x.updatedAt=store.now();}return items;});redirectWith(res,"/admin/renewals","Estado actualizado.");});
app.post("/admin/renewals/:id/delete",auth.requireCsrf,(req,res)=>{store.update("renewals",items=>items.filter(r=>r.id!==req.params.id));redirectWith(res,"/admin/renewals","Renovación eliminada.");});

app.get("/admin/messages",(req,res)=>{const messages=store.read("messages");res.send(ui.page("Mensajes",`<div class="page-head"><div><span class="eyebrow">REGISTRO</span><h1>Mensajes</h1><p>Se conservan los últimos 500 eventos.</p></div></div><div class="table-card"><table><thead><tr><th>Fecha</th><th>Teléfono</th><th>Mensaje</th><th>Resultado</th><th>Error</th></tr></thead><tbody>${messages.map(x=>`<tr><td>${ui.fmtDate(x.createdAt)}</td><td><code>${ui.esc(x.phone)}</code></td><td>${ui.esc(x.incomingText||"")}</td><td><span class="badge">${ui.esc(x.status||x.type)}</span></td><td class="error-cell">${ui.esc(x.error||"")}</td></tr>`).join("")}</tbody></table></div>`,{auth:req.auth,active:"messages"}));});

app.get("/admin/files",(req,res)=>{const files=fs.readdirSync(UPLOAD_DIR,{withFileTypes:true}).filter(x=>x.isFile()&&x.name!==".gitkeep").map(x=>{const stat=fs.statSync(path.join(UPLOAD_DIR,x.name));return {name:x.name,size:stat.size,mtime:stat.mtime};}).sort((a,b)=>b.mtime-a.mtime);res.send(ui.page("Archivos",`<div class="page-head"><div><span class="eyebrow">MULTIMEDIA</span><h1>Archivos</h1><p>Imágenes, PDF, documentos, vídeos y audios.</p></div></div><form class="card form-grid" method="post" enctype="multipart/form-data" action="/admin/files">${ui.csrf(req)}<label class="full">Subir archivo (máximo ${MAX_UPLOAD_MB} MB)<input type="file" name="media" required></label><div class="full"><button>Subir archivo</button></div></form><div class="file-grid">${files.map(x=>`<article class="file-card"><div class="file-icon">◫</div><div><strong>${ui.esc(x.name)}</strong><span>${(x.size/1024/1024).toFixed(2)} MB · ${ui.fmtDate(x.mtime)}</span><a href="${localMediaUrl(x.name)}" target="_blank" rel="noopener">Abrir URL</a></div><form method="post" action="/admin/files/delete" data-confirm="¿Eliminar este archivo?">${ui.csrf(req)}<input type="hidden" name="filename" value="${ui.esc(x.name)}"><button class="small danger">Eliminar</button></form></article>`).join("")||'<p class="muted">No hay archivos subidos.</p>'}</div>`,{auth:req.auth,active:"files",flash:flash(req)}));});
app.post("/admin/files",upload.single("media"),auth.requireCsrf,(req,res)=>{if(!req.file)return res.status(400).send("No se recibió ningún archivo.");redirectWith(res,"/admin/files","Archivo subido.");});
app.post("/admin/files/delete",auth.requireCsrf,(req,res)=>{const filename=path.basename(String(req.body.filename||""));const target=path.join(UPLOAD_DIR,filename);if(fs.existsSync(target))fs.unlinkSync(target);store.update("commands",commands=>{for(const x of commands){if(x.mediaUrl===localMediaUrl(filename)){x.mediaUrl="";x.mediaFilename="";x.mediaType="none";x.updatedAt=store.now();}}return commands;});redirectWith(res,"/admin/files","Archivo eliminado.");});

app.get("/admin/settings",(req,res)=>{const x=store.read("settings");res.send(ui.page("Ajustes",`<div class="page-head"><div><span class="eyebrow">CONFIGURACIÓN</span><h1>Ajustes del bot</h1></div></div><form class="card form-grid" method="post" action="/admin/settings">${ui.csrf(req)}<label>Nombre comercial<input name="businessName" value="${ui.esc(x.businessName)}"></label><label>Título del menú<input name="menuTitle" value="${ui.esc(x.menuTitle)}"></label><label class="full">Pie del menú<textarea name="menuFooter" rows="3">${ui.esc(x.menuFooter)}</textarea></label><label class="full">Respuesta para comando desconocido<textarea name="unknownCommandText" rows="4">${ui.esc(x.unknownCommandText)}</textarea></label><label class="check"><input type="checkbox" name="replyToUnknownCommands" ${ui.checked(x.replyToUnknownCommands)}> Responder a comandos desconocidos</label><label class="check"><input type="checkbox" name="replyToNormalMessages" ${ui.checked(x.replyToNormalMessages)}> Responder también a mensajes normales</label><div class="full settings-divider"><span class="eyebrow">MENSAJE DE BIENVENIDA</span><h2>Respuesta automática inicial</h2><p class="muted">Elige cuándo quieres que el cliente reciba la bienvenida.</p></div><label>Modo de envío<select name="welcomeMode"><option value="first_time" ${ui.selected(x.welcomeMode,"first_time")}>Enviar solo la primera vez</option><option value="after_24h" ${ui.selected(x.welcomeMode,"after_24h")}>Enviar después de 24 horas sin actividad</option><option value="disabled" ${ui.selected(x.welcomeMode,"disabled")}>Desactivar</option></select></label><label class="full">Texto de bienvenida<textarea name="welcomeText" rows="12" placeholder="Escribe aquí el mensaje de bienvenida">${ui.esc(x.welcomeText||"")}</textarea></label><div class="full"><button>Guardar ajustes</button></div></form>`,{auth:req.auth,active:"settings",flash:flash(req)}));});
app.post("/admin/settings",auth.requireCsrf,(req,res)=>{const allowedModes=new Set(["first_time","after_24h","disabled"]);const welcomeMode=allowedModes.has(req.body.welcomeMode)?req.body.welcomeMode:"disabled";store.write("settings",{businessName:String(req.body.businessName||"León TV"),menuTitle:String(req.body.menuTitle||"📋 *MENÚ*").slice(0,300),menuFooter:String(req.body.menuFooter||"").slice(0,1000),unknownCommandText:String(req.body.unknownCommandText||"").slice(0,3000),replyToUnknownCommands:Boolean(req.body.replyToUnknownCommands),replyToNormalMessages:Boolean(req.body.replyToNormalMessages),welcomeMode,welcomeText:String(req.body.welcomeText||"").slice(0,4096)});redirectWith(res,"/admin/settings","Ajustes y mensaje de bienvenida guardados.");});

app.get("/admin/backup",(req,res)=>res.send(ui.page("Copias de seguridad",`<div class="page-head"><div><span class="eyebrow">SEGURIDAD</span><h1>Copias de seguridad</h1><p>Exporta los JSON antes de cada despliegue o reinicio.</p></div></div><section class="grid-2"><article class="card"><h2>Exportar</h2><p>Descarga comandos, clientes, renovaciones, mensajes y ajustes en un solo archivo.</p><a class="button" href="/admin/backup/download">Descargar copia JSON</a></article><article class="card"><h2>Restaurar</h2><form method="post" enctype="multipart/form-data" action="/admin/backup/import" class="form-stack">${ui.csrf(req)}<input type="file" name="backup" accept="application/json,.json" required><button>Importar copia</button></form></article></section><div class="warning"><strong>Nota:</strong> la copia JSON no incluye los archivos multimedia de la carpeta uploads.</div>`,{auth:req.auth,active:"backup",flash:flash(req)})));
app.get("/admin/backup/download",(req,res)=>{const backup=store.exportAll();res.setHeader("Content-Type","application/json; charset=utf-8");res.setHeader("Content-Disposition",`attachment; filename="leonbot-backup-${new Date().toISOString().slice(0,10)}.json"`);res.send(JSON.stringify(backup,null,2));});
app.post("/admin/backup/import",upload.single("backup"),auth.requireCsrf,(req,res,next)=>{try{if(!req.file)throw new Error("No se recibió la copia.");const payload=JSON.parse(fs.readFileSync(req.file.path,"utf8"));store.importAll(payload);fs.unlinkSync(req.file.path);redirectWith(res,"/admin/backup","Copia restaurada correctamente.");}catch(e){next(e);}});

app.get("/webhook",(req,res)=>{if(req.query["hub.mode"]==="subscribe"&&req.query["hub.verify_token"]===process.env.WEBHOOK_VERIFY_TOKEN)return res.status(200).send(req.query["hub.challenge"]);res.sendStatus(403);});
app.post("/webhook",webhookLimiter,async(req,res)=>{
  if(!wa.verifySignature(req.rawBody,req.headers["x-hub-signature-256"]))return res.sendStatus(401);
  res.sendStatus(200);
  const message=req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if(!message||message.type!=="text")return;
  if(markProcessed(message.id))return;
  const phone=message.from; const incoming=String(message.text?.body||"").trim();
  const profileName=req.body?.entry?.[0]?.changes?.[0]?.value?.contacts?.[0]?.profile?.name||"";
  const key=incoming.split(/\s+/)[0].toLowerCase();
  const base={id:store.id("msg"),whatsappMessageId:message.id,phone,incomingText:incoming,createdAt:store.now()};
  try{
    const previousClient=store.read("clients").find(c=>c.phone===phone);
    upsertClient(phone,profileName);
    const settings=store.read("settings");
    if(shouldSendWelcome(settings,previousClient)){
      await wa.sendText(phone,settings.welcomeText);
      markWelcomeSent(phone);
    }
    if(key==="#menu"||key==="#ayuda"){await wa.sendText(phone,buildMenu());addMessage({...base,status:"answered",matchedCommand:"#menu"});return;}
    const command=activeCommands().find(x=>x.command===key);
    if(!command){const isCommand=key.startsWith("#");if((isCommand&&settings.replyToUnknownCommands)||(!isCommand&&settings.replyToNormalMessages))await wa.sendText(phone,isCommand?settings.unknownCommandText:buildMenu());addMessage({...base,status:"unmatched",matchedCommand:""});return;}
    if(command.text)await wa.sendText(phone,command.text);
    if(command.mediaType!=="none"&&command.mediaUrl)await wa.sendMedia(phone,command.mediaType,command.mediaUrl,command.mediaFilename||"");
    if(command.createsRenewalRequest)createRenewalRequest(phone);
    store.update("commands",commands=>{const x=commands.find(c=>c.id===command.id);if(x){x.usageCount=Number(x.usageCount||0)+1;x.updatedAt=store.now();}return commands;});
    addMessage({...base,status:"answered",matchedCommand:command.command});
    console.log(`Respondido ${command.command} a ${phone}`);
  }catch(error){
    console.error("Error procesando webhook:",error);
    store.update("processed", ids => ids.filter(id => id !== message.id));
    addMessage({...base,status:"error",matchedCommand:key,error:String(error.message||error).slice(0,2000)});
  }
});

app.use((error,req,res,_next)=>{console.error(error);const status=error instanceof multer.MulterError?400:500;res.status(status).send(ui.page("Error",`<section class="login-shell"><div class="login-panel"><h1>No se pudo completar la operación</h1><p>${ui.esc(error.message||"Error inesperado")}</p><a class="button" href="/admin">Volver</a></div></section>`));});
app.listen(PORT,()=>console.log(`LeonBot profesional JSON activo en el puerto ${PORT}`));
