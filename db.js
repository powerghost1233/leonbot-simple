const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const dbPath = process.env.DATABASE_PATH || "./data/leonbot.sqlite";
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS commands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  command TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  response_text TEXT DEFAULT '',
  media_type TEXT DEFAULT 'none',
  media_url TEXT DEFAULT '',
  active INTEGER DEFAULT 1,
  usage_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT UNIQUE NOT NULL,
  name TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  last_message_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS renewals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL,
  plan TEXT DEFAULT '',
  amount REAL DEFAULT 0,
  renewal_date TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS message_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  whatsapp_message_id TEXT UNIQUE,
  phone TEXT NOT NULL,
  incoming_text TEXT DEFAULT '',
  matched_command TEXT DEFAULT '',
  status TEXT DEFAULT 'received',
  error TEXT DEFAULT '',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

if (db.prepare("SELECT COUNT(*) total FROM commands").get().total === 0) {
  const insert = db.prepare(`
    INSERT INTO commands(command,title,response_text,media_type,media_url,active)
    VALUES(?,?,?,'none','',1)
  `);
  const seed = [
    ["#menu","Menú principal","📋 *COMANDOS DISPONIBLES*\\n\\n#pagar — Información de pago\\n#precios — Tarifas\\n#renovar — Renovaciones\\n#soporte — Ayuda técnica"],
    ["#pagar","Información de pago","💳 *INFORMACIÓN DE PAGO*\\n\\nBizum: PON_AQUI_TU_NUMERO\\nTransferencia: PON_AQUI_TU_IBAN\\n\\nEnvía el justificante cuando realices el pago."],
    ["#precios","Tarifas","📺 *PRECIOS*\\n\\n1 mes: 9,99 €\\n3 meses: 24,99 €\\n6 meses: 44,99 €\\n12 meses: 79,99 €"],
    ["#renovar","Renovaciones","🔄 *RENOVACIÓN*\\n\\nIndica el nombre del titular y el periodo que deseas renovar."],
    ["#soporte","Soporte","🛠️ *SOPORTE*\\n\\nIndica el dispositivo, la aplicación, el mensaje de error y una captura si es posible."]
  ];
  db.transaction(() => seed.forEach(r => insert.run(...r)))();
}
module.exports = db;
