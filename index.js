require("dotenv").config();
const express = require("express");

const app = express();
app.use(express.json());

const {
  PORT = 3000,
  META_GRAPH_VERSION = "v25.0",
  WHATSAPP_TOKEN,
  WHATSAPP_PHONE_NUMBER_ID,
  WEBHOOK_VERIFY_TOKEN
} = process.env;

const respuestas = {
  "#menu": [
    "📋 *COMANDOS DISPONIBLES*",
    "",
    "#pagar — Información de pago",
    "#precios — Tarifas",
    "#renovar — Renovaciones",
    "#soporte — Ayuda técnica"
  ].join("\n"),

  "#pagar": [
    "💳 *INFORMACIÓN DE PAGO*",
    "",
    "Bizum: PON_AQUI_TU_NUMERO",
    "Transferencia: PON_AQUI_TU_IBAN",
    "",
    "Cuando realices el pago, envía el justificante por este chat."
  ].join("\n"),

  "#precios": [
    "📺 *PRECIOS*",
    "",
    "1 mes: 9,99 €",
    "3 meses: 24,99 €",
    "6 meses: 44,99 €",
    "12 meses: 79,99 €"
  ].join("\n"),

  "#renovar": [
    "🔄 *RENOVACIÓN*",
    "",
    "Indica el nombre del titular y el periodo que deseas renovar."
  ].join("\n"),

  "#soporte": [
    "🛠️ *SOPORTE*",
    "",
    "Indica:",
    "• Dispositivo",
    "• Aplicación",
    "• Mensaje de error",
    "• Captura o fotografía, si es posible"
  ].join("\n")
};

app.get("/", (_req, res) => {
  res.status(200).send("LeonBot está funcionando.");
});

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === WEBHOOK_VERIFY_TOKEN) {
    console.log("Webhook verificado correctamente.");
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  try {
    const value = req.body?.entry?.[0]?.changes?.[0]?.value;
    const message = value?.messages?.[0];

    if (!message || message.type !== "text") return;

    const telefono = message.from;
    const comando = message.text?.body?.trim().toLowerCase();

    if (!telefono || !comando) return;

    const respuesta = respuestas[comando];

    if (!respuesta) {
      await enviarMensaje(
        telefono,
        "No reconozco ese comando.\n\nEscribe *#menu* para ver las opciones."
      );
      return;
    }

    await enviarMensaje(telefono, respuesta);
    console.log(`Respondido ${comando} a ${telefono}`);
  } catch (error) {
    console.error("Error procesando webhook:", error);
  }
});

async function enviarMensaje(destinatario, texto) {
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
    throw new Error("Faltan WHATSAPP_TOKEN o WHATSAPP_PHONE_NUMBER_ID en .env");
  }

  const url =
    `https://graph.facebook.com/${META_GRAPH_VERSION}/` +
    `${WHATSAPP_PHONE_NUMBER_ID}/messages`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: destinatario,
      type: "text",
      text: {
        preview_url: false,
        body: texto
      }
    })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Meta API ${response.status}: ${JSON.stringify(data)}`);
  }

  return data;
}

app.listen(PORT, () => {
  console.log(`LeonBot activo en el puerto ${PORT}`);
});
