const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.resolve(process.env.DATA_DIR || "./data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const defaults = {
  commands: [],
  clients: [],
  renewals: [],
  messages: [],
  processed: [],
  settings: {
    businessName: "León TV",
    menuTitle: "📋 *MENÚ DE INFORMACIÓN*",
    menuFooter: "Escribe el comando que necesites.",
    unknownCommandText: "No reconozco ese comando. Escribe *#menu* para ver las opciones.",
    replyToUnknownCommands: true,
    replyToNormalMessages: false,
    welcomeMode: "after_24h",
    welcomeText: "👋 ¡Hola! Bienvenido a *León TV*.\n\nGracias por ponerte en contacto con nosotros. 😊\n\n🤖 Este asistente puede ayudarte automáticamente. Escribe *#menu* para ver todas las opciones disponibles.\n\nSi necesitas atención personal, escribe tu consulta normalmente y te responderemos lo antes posible."
  }
};

function filePath(name) {
  if (!Object.prototype.hasOwnProperty.call(defaults, name)) {
    throw new Error(`Colección JSON desconocida: ${name}`);
  }
  return path.join(DATA_DIR, `${name}.json`);
}

function ensure(name) {
  const target = filePath(name);
  if (!fs.existsSync(target)) write(name, defaults[name]);
}

function read(name) {
  ensure(name);
  const raw = fs.readFileSync(filePath(name), "utf8");
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`El archivo data/${name}.json no contiene JSON válido: ${error.message}`);
  }
}

function write(name, value) {
  const target = filePath(name);
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temp, target);
  return value;
}

function update(name, updater) {
  const current = read(name);
  const next = updater(structuredClone(current));
  return write(name, next === undefined ? current : next);
}

function id(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
}

function now() {
  return new Date().toISOString();
}

function seed() {
  Object.keys(defaults).forEach(ensure);
  const commands = read("commands");
  if (commands.length) return;
  const stamp = now();
  write("commands", [
    {
      id: id("cmd"), command: "#pagar", title: "Información de pago",
      text: "💳 *INFORMACIÓN DE PAGO*\n\nBizum: PON_AQUÍ_TU_NÚMERO\nTransferencia: PON_AQUÍ_TU_IBAN\n\nCuando realices el pago, envía el justificante por este chat.",
      mediaType: "none", mediaUrl: "", mediaFilename: "", active: true,
      showInMenu: true, createsRenewalRequest: false, usageCount: 0,
      createdAt: stamp, updatedAt: stamp
    },
    {
      id: id("cmd"), command: "#precios", title: "Precios y planes",
      text: "📺 *PRECIOS*\n\nEdita esta respuesta desde el panel con tus tarifas reales.",
      mediaType: "none", mediaUrl: "", mediaFilename: "", active: true,
      showInMenu: true, createsRenewalRequest: false, usageCount: 0,
      createdAt: stamp, updatedAt: stamp
    },
    {
      id: id("cmd"), command: "#renovar", title: "Solicitar renovación",
      text: "🔄 *RENOVACIÓN*\n\nHe registrado tu solicitud. Indica el nombre del titular y el periodo que deseas renovar.",
      mediaType: "none", mediaUrl: "", mediaFilename: "", active: true,
      showInMenu: true, createsRenewalRequest: true, usageCount: 0,
      createdAt: stamp, updatedAt: stamp
    },
    {
      id: id("cmd"), command: "#soporte", title: "Soporte técnico",
      text: "🛠️ *SOPORTE*\n\nIndica:\n• Dispositivo\n• Aplicación utilizada\n• Mensaje de error\n• Captura o fotografía, si es posible",
      mediaType: "none", mediaUrl: "", mediaFilename: "", active: true,
      showInMenu: true, createsRenewalRequest: false, usageCount: 0,
      createdAt: stamp, updatedAt: stamp
    }
  ]);
}

function exportAll() {
  return {
    format: "leonbot-backup-v1",
    exportedAt: now(),
    data: Object.fromEntries(Object.keys(defaults).map(name => [name, read(name)]))
  };
}

function importAll(payload) {
  if (!payload || payload.format !== "leonbot-backup-v1" || !payload.data) {
    throw new Error("El archivo no es una copia válida de LeonBot.");
  }
  for (const name of Object.keys(defaults)) {
    if (payload.data[name] === undefined) continue;
    const expectedArray = Array.isArray(defaults[name]);
    if (expectedArray !== Array.isArray(payload.data[name])) {
      throw new Error(`Formato incorrecto en ${name}.`);
    }
  }
  for (const name of Object.keys(defaults)) {
    if (payload.data[name] !== undefined) write(name, payload.data[name]);
  }
}

seed();
module.exports = { read, write, update, id, now, exportAll, importAll, DATA_DIR };
