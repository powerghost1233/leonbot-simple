async function request(endpoint, body) {
  const version = process.env.META_GRAPH_VERSION || "v25.0";
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) throw new Error("Faltan credenciales de WhatsApp.");

  const response = await fetch(`https://graph.facebook.com/${version}/${phoneId}/${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const data = await response.json();
  if (!response.ok) throw new Error(`Meta API ${response.status}: ${JSON.stringify(data)}`);
  return data;
}

function sendText(to, text) {
  return request("messages", {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: { preview_url: true, body: text }
  });
}

function sendMedia(to, type, link, caption = "") {
  const media = { link };
  if (caption) media.caption = caption;
  if (type === "document") media.filename = decodeURIComponent(link.split("/").pop() || "archivo");
  return request("messages", {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type,
    [type]: media
  });
}

module.exports = { sendText, sendMedia };
