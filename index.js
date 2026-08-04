require("dotenv").config();
const express = require("express");
const session = require("express-session");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const db = require("./db");
const { sendText, sendMedia } = require("./whatsapp");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const APP_URL = (process.env.APP_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const UPLOAD_DIR = process.env.UPLOAD_DIR || "./uploads";
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_r,_f,cb) => cb(null, UPLOAD_DIR),
  filename: (_r,f,cb) => {
    const safe = f.originalname.normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-zA-Z0-9._-]/g,"-");
    cb(null, `${Date.now()}-${safe}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 40 * 1024 * 1024 } });

app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: "2mb" }));
app.use("/public", express.static(path.join(__dirname,"public")));
app.use("/uploads", express.static(path.resolve(UPLOAD_DIR)));
app.use(session({
  secret: process.env.SESSION_SECRET || "cambia-esto",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 8*60*60*1000 }
}));

const esc = (v="") => String(v).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
const page = (title,body) => `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} | LeonBot</title><link rel="stylesheet" href="/public/style.css"></head><body>${body}</body></html>`;
const layout = (title,body) => page(title, `<header><div><b>LEONBOT</b><small>Panel profesional de WhatsApp</small></div><nav><a href="/admin">Inicio</a><a href="/admin/commands">Comandos</a><a href="/admin/clients">Clientes</a><a href="/admin/renewals">Renovaciones</a><a href="/logout">Salir</a></nav></header><main><h1>${esc(title)}</h1>${body}</main>`);
const auth = (req,res,next) => req.session?.ok ? next() : res.redirect("/login");
const norm = v => { let s=String(v||"").trim().toLowerCase().replace(/\s+/g,""); return s.startsWith("#")?s:"#"+s; };

app.get("/",(_r,res)=>res.send("LeonBot profesional está funcionando."));
app.get("/login",(_r,res)=>res.send(page("Acceso",`<section class="login"><form class="card" method="post"><b class="brand">LEONBOT</b><h1>Acceso al panel</h1><label>Usuario<input name="user" required></label><label>Contraseña<input type="password" name="password" required></label><button>Entrar</button></form></section>`)));
app.post("/login",(req,res)=>{
  if(req.body.user===process.env.ADMIN_USER && req.body.password===process.env.ADMIN_PASSWORD){req.session.ok=true;return res.redirect("/admin");}
  res.status(401).send(page("Error",`<section class="login"><div class="card"><h1>Credenciales incorrectas</h1><a class="button" href="/login">Volver</a></div></section>`));
});
app.get("/logout",(req,res)=>req.session.destroy(()=>res.redirect("/login")));

app.get("/admin",auth,(_r,res)=>{
  const c=db.prepare("SELECT COUNT(*) total FROM commands").get().total;
  const cl=db.prepare("SELECT COUNT(*) total FROM clients").get().total;
  const r=db.prepare("SELECT COUNT(*) total FROM renewals WHERE status='pending'").get().total;
  const m=db.prepare("SELECT COUNT(*) total FROM message_log").get().total;
  res.send(layout("Resumen",`<section class="stats"><div><strong>${c}</strong>Comandos</div><div><strong>${cl}</strong>Clientes</div><div><strong>${r}</strong>Renovaciones pendientes</div><div><strong>${m}</strong>Mensajes</div></section><section class="card"><p>Webhook: <code>${esc(APP_URL)}/webhook</code></p><p>Los cambios se aplican inmediatamente.</p></section>`));
});

function commandForm(row={}) {
  return `<form class="card grid" method="post" enctype="multipart/form-data" action="${row.id?`/admin/commands/${row.id}`:"/admin/commands"}">
  <label>Comando<input name="command" value="${esc(row.command||"#")}" required></label>
  <label>Título<input name="title" value="${esc(row.title||"")}" required></label>
  <label class="full">Respuesta<textarea name="response_text" rows="10">${esc(row.response_text||"")}</textarea></label>
  <label>Tipo<select name="media_type">${["none","image","document","video"].map(v=>`<option value="${v}" ${row.media_type===v?"selected":""}>${v}</option>`).join("")}</select></label>
  <label>URL pública<input name="media_url" value="${esc(row.media_url||"")}"></label>
  <label class="full">O subir archivo<input type="file" name="media"></label>
  <label class="check"><input type="checkbox" name="active" ${row.active!==0?"checked":""}>Activo</label>
  <div class="full"><button>Guardar</button> <a class="button secondary" href="/admin/commands">Cancelar</a></div></form>`;
}

app.get("/admin/commands",auth,(_r,res)=>{
  const rows=db.prepare("SELECT * FROM commands ORDER BY command").all().map(x=>`<tr><td><code>${esc(x.command)}</code></td><td>${esc(x.title)}</td><td>${esc(x.media_type)}</td><td>${x.active?"Sí":"No"}</td><td>${x.usage_count}</td><td><a class="button small" href="/admin/commands/${x.id}/edit">Editar</a> <form class="inline" method="post" action="/admin/commands/${x.id}/delete"><button class="danger small">Eliminar</button></form></td></tr>`).join("");
  res.send(layout("Comandos",`<p><a class="button" href="/admin/commands/new">Nuevo comando</a></p><div class="table"><table><thead><tr><th>Comando</th><th>Título</th><th>Archivo</th><th>Activo</th><th>Usos</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`));
});
app.get("/admin/commands/new",auth,(_r,res)=>res.send(layout("Nuevo comando",commandForm())));
app.get("/admin/commands/:id/edit",auth,(req,res)=>{const x=db.prepare("SELECT * FROM commands WHERE id=?").get(req.params.id);if(!x)return res.sendStatus(404);res.send(layout("Editar comando",commandForm(x)));});
app.post("/admin/commands",auth,upload.single("media"),(req,res)=>{
  const url=req.file?`${APP_URL}/uploads/${encodeURIComponent(req.file.filename)}`:String(req.body.media_url||"").trim();
  db.prepare("INSERT INTO commands(command,title,response_text,media_type,media_url,active) VALUES(?,?,?,?,?,?)").run(norm(req.body.command),req.body.title,req.body.response_text||"",req.body.media_type||"none",url,req.body.active?1:0);
  res.redirect("/admin/commands");
});
app.post("/admin/commands/:id",auth,upload.single("media"),(req,res)=>{
  const old=db.prepare("SELECT * FROM commands WHERE id=?").get(req.params.id);if(!old)return res.sendStatus(404);
  const url=req.file?`${APP_URL}/uploads/${encodeURIComponent(req.file.filename)}`:String(req.body.media_url||"").trim();
  db.prepare("UPDATE commands SET command=?,title=?,response_text=?,media_type=?,media_url=?,active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(norm(req.body.command),req.body.title,req.body.response_text||"",req.body.media_type||"none",url,req.body.active?1:0,req.params.id);
  res.redirect("/admin/commands");
});
app.post("/admin/commands/:id/delete",auth,(req,res)=>{db.prepare("DELETE FROM commands WHERE id=?").run(req.params.id);res.redirect("/admin/commands");});

app.get("/admin/clients",auth,(_r,res)=>{
  const rows=db.prepare("SELECT * FROM clients ORDER BY COALESCE(last_message_at,created_at) DESC").all().map(x=>`<tr><td>${esc(x.name||"Sin nombre")}</td><td><code>${esc(x.phone)}</code></td><td>${esc(x.notes||"")}</td><td>${esc(x.last_message_at||"")}</td><td><a class="button small" href="/admin/clients/${x.id}/edit">Editar</a></td></tr>`).join("");
  res.send(layout("Clientes",`<div class="table"><table><thead><tr><th>Nombre</th><th>Teléfono</th><th>Notas</th><th>Último mensaje</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`));
});
app.get("/admin/clients/:id/edit",auth,(req,res)=>{const x=db.prepare("SELECT * FROM clients WHERE id=?").get(req.params.id);if(!x)return res.sendStatus(404);res.send(layout("Editar cliente",`<form class="card grid" method="post" action="/admin/clients/${x.id}"><label>Teléfono<input value="${esc(x.phone)}" disabled></label><label>Nombre<input name="name" value="${esc(x.name||"")}"></label><label class="full">Notas<textarea name="notes" rows="8">${esc(x.notes||"")}</textarea></label><div class="full"><button>Guardar</button></div></form>`));});
app.post("/admin/clients/:id",auth,(req,res)=>{db.prepare("UPDATE clients SET name=?,notes=? WHERE id=?").run(req.body.name||"",req.body.notes||"",req.params.id);res.redirect("/admin/clients");});

app.get("/admin/renewals",auth,(_r,res)=>{
  const clients=db.prepare("SELECT id,name,phone FROM clients ORDER BY name,phone").all();
  const rows=db.prepare("SELECT r.*,c.name,c.phone FROM renewals r JOIN clients c ON c.id=r.client_id ORDER BY renewal_date").all().map(x=>`<tr><td>${esc(x.name||x.phone)}</td><td>${esc(x.plan)}</td><td>${Number(x.amount).toFixed(2)} €</td><td>${esc(x.renewal_date)}</td><td>${esc(x.status)}</td><td><form class="inline" method="post" action="/admin/renewals/${x.id}/toggle"><button class="small">${x.status==="pending"?"Marcar pagada":"Reabrir"}</button></form> <form class="inline" method="post" action="/admin/renewals/${x.id}/delete"><button class="danger small">Eliminar</button></form></td></tr>`).join("");
  res.send(layout("Renovaciones",`<form class="card grid" method="post" action="/admin/renewals"><label>Cliente<select name="client_id" required><option value="">Seleccionar</option>${clients.map(c=>`<option value="${c.id}">${esc(c.name||c.phone)} — ${esc(c.phone)}</option>`).join("")}</select></label><label>Plan<input name="plan"></label><label>Importe<input type="number" step="0.01" name="amount" value="0"></label><label>Fecha<input type="date" name="renewal_date" required></label><label class="full">Notas<textarea name="notes"></textarea></label><div class="full"><button>Añadir</button></div></form><div class="table"><table><thead><tr><th>Cliente</th><th>Plan</th><th>Importe</th><th>Fecha</th><th>Estado</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`));
});
app.post("/admin/renewals",auth,(req,res)=>{db.prepare("INSERT INTO renewals(client_id,plan,amount,renewal_date,notes) VALUES(?,?,?,?,?)").run(req.body.client_id,req.body.plan||"",Number(req.body.amount||0),req.body.renewal_date,req.body.notes||"");res.redirect("/admin/renewals");});
app.post("/admin/renewals/:id/toggle",auth,(req,res)=>{const x=db.prepare("SELECT status FROM renewals WHERE id=?").get(req.params.id);db.prepare("UPDATE renewals SET status=? WHERE id=?").run(x.status==="pending"?"paid":"pending",req.params.id);res.redirect("/admin/renewals");});
app.post("/admin/renewals/:id/delete",auth,(req,res)=>{db.prepare("DELETE FROM renewals WHERE id=?").run(req.params.id);res.redirect("/admin/renewals");});

app.get("/webhook",(req,res)=>{
  if(req.query["hub.mode"]==="subscribe" && req.query["hub.verify_token"]===process.env.WEBHOOK_VERIFY_TOKEN) return res.status(200).send(req.query["hub.challenge"]);
  res.sendStatus(403);
});
app.post("/webhook",async(req,res)=>{
  res.sendStatus(200);
  try{
    const msg=req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if(!msg || msg.type!=="text") return;
    const phone=msg.from, incoming=String(msg.text?.body||"").trim(), key=incoming.toLowerCase().replace(/\s+/g,"");
    try{db.prepare("INSERT INTO message_log(whatsapp_message_id,phone,incoming_text) VALUES(?,?,?)").run(msg.id,phone,incoming);}catch(e){if(String(e.message).includes("UNIQUE"))return;throw e;}
    db.prepare("INSERT INTO clients(phone,last_message_at) VALUES(?,CURRENT_TIMESTAMP) ON CONFLICT(phone) DO UPDATE SET last_message_at=CURRENT_TIMESTAMP").run(phone);
    const cmd=db.prepare("SELECT * FROM commands WHERE command=? AND active=1").get(key);
    if(!cmd){await sendText(phone,"No reconozco ese comando.\\n\\nEscribe *#menu* para ver las opciones.");db.prepare("UPDATE message_log SET status='unmatched' WHERE whatsapp_message_id=?").run(msg.id);return;}
    if(cmd.response_text) await sendText(phone,cmd.response_text);
    if(cmd.media_type!=="none" && cmd.media_url) await sendMedia(phone,cmd.media_type,cmd.media_url,cmd.response_text?"":cmd.title);
    db.prepare("UPDATE commands SET usage_count=usage_count+1 WHERE id=?").run(cmd.id);
    db.prepare("UPDATE message_log SET matched_command=?,status='answered' WHERE whatsapp_message_id=?").run(cmd.command,msg.id);
    console.log(`Respondido ${cmd.command} a ${phone}`);
  }catch(e){console.error("Error webhook:",e);}
});

app.listen(PORT,()=>console.log(`LeonBot profesional activo en el puerto ${PORT}`));
