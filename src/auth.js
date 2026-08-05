const crypto = require("crypto");

const COOKIE = "leonbot_auth";
const MAX_AGE_SECONDS = 8 * 60 * 60;

function secret() {
  return process.env.SESSION_SECRET || "";
}

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function sign(value) {
  return crypto.createHmac("sha256", secret()).update(value).digest("base64url");
}

function createToken(username) {
  const payload = encode({
    username,
    csrf: crypto.randomBytes(24).toString("hex"),
    exp: Date.now() + MAX_AGE_SECONDS * 1000
  });
  return `${payload}.${sign(payload)}`;
}

function verifyToken(token) {
  if (!token || !secret()) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!data.exp || data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

function cookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || "")
      .split(";")
      .map(item => item.trim())
      .filter(Boolean)
      .map(item => {
        const index = item.indexOf("=");
        return [decodeURIComponent(item.slice(0, index)), decodeURIComponent(item.slice(index + 1))];
      })
  );
}

function current(req) {
  return verifyToken(cookies(req)[COOKIE]);
}

function requireAuth(req, res, next) {
  const auth = current(req);
  if (!auth) return res.redirect("/login");
  req.auth = auth;
  next();
}

function requireCsrf(req, res, next) {
  if (!req.auth || !req.body || req.body._csrf !== req.auth.csrf) {
    return res.status(403).send("Solicitud rechazada: token CSRF incorrecto.");
  }
  next();
}

function login(res, username) {
  res.cookie(COOKIE, createToken(username), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: MAX_AGE_SECONDS * 1000,
    path: "/"
  });
}

function logout(res) {
  res.clearCookie(COOKIE, { path: "/" });
}

module.exports = { requireAuth, requireCsrf, current, login, logout };
