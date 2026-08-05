const crypto = require("crypto");

function config() {
  return {
    version: process.env.META_GRAPH_VERSION || "v25.0",
    token: process.env.WHATSAPP_TOKEN || "",
    phoneId: process.env.WHATSAPP_PHONE_NUMBER_ID || ""
  };
}

async function metaRequest(body) {
  const { version, token, phoneId } = config();
  if (!token || !phoneId) throw new Error("Faltan WHATSAPP_TOKEN o WHATSAPP_PHONE_NUMBER_ID.");
  const response = await fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Meta API ${response.status}: ${JSON.stringify(data)}`);
  return data;
}

function sendText(to, text) {
  return metaRequest({
    messaging_product: "whatsapp", recipient_type: "individual", to,
    type: "text", text: { preview_url: true, body: String(text).slice(0, 4096) }
  });
}

function sendMedia(to, type, link, filename = "") {
  const allowed = new Set(["image", "document", "video", "audio"]);
  if (!allowed.has(type)) throw new Error(`Tipo multimedia no permitido: ${type}`);
  const media = { link };
  if (type === "document" && filename) media.filename = filename;
  return metaRequest({
    messaging_product: "whatsapp", recipient_type: "individual", to,
    type, [type]: media
  });
}

function verifySignature(rawBody, signatureHeader) {
  const appSecret = process.env.META_APP_SECRET || "";
  if (!appSecret) return true;
  if (!rawBody || !signatureHeader?.startsWith("sha256=")) return false;
  const expected = crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const received = signatureHeader.slice(7);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(received, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { sendText, sendMedia, verifySignature };
