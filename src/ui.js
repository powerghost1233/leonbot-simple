function esc(value = "") {
  return String(value)
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function fmtDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? esc(value) : new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function page(title, body, options = {}) {
  const { auth, flash = "", active = "" } = options;
  const nav = auth ? `<header class="topbar"><a class="brand" href="/admin"><span>LEON</span>BOT</a><button class="nav-toggle" type="button" aria-label="Abrir menú">☰</button><nav>${[
    ["Inicio","/admin","home"], ["Comandos","/admin/commands","commands"], ["Clientes","/admin/clients","clients"],
    ["Renovaciones","/admin/renewals","renewals"], ["Mensajes","/admin/messages","messages"], ["Archivos","/admin/files","files"],
    ["Ajustes","/admin/settings","settings"], ["Copias","/admin/backup","backup"]
  ].map(([label,url,key]) => `<a class="${active===key?"active":""}" href="${url}">${label}</a>`).join("")}<a href="/logout">Salir</a></nav></header>` : "";
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(title)} | LeonBot</title><link rel="stylesheet" href="/public/style.css"><script defer src="/public/app.js"></script></head><body>${nav}${auth?`<main class="container">${flash?`<div class="flash">${esc(flash)}</div>`:""}${body}</main>`:body}</body></html>`;
}

function csrf(req) { return `<input type="hidden" name="_csrf" value="${esc(req.auth.csrf)}">`; }
function checked(value) { return value ? "checked" : ""; }
function selected(value, expected) { return value === expected ? "selected" : ""; }

module.exports = { esc, fmtDate, page, csrf, checked, selected };
