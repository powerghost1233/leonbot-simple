# LeonBot: líneas, renovaciones y contrataciones

Este proyecto sustituye al bot actual de WhatsApp y añade:

- Consulta de una línea con `#usuario`.
- Cálculo automático de estado, caducidad y días restantes.
- Aviso automático en el panel cuando una línea está caducada o próxima a caducar.
- Solicitud manual con `#renovar usuario`.
- Renovación desde el panel introduciendo la nueva fecha.
- Mensaje automático al cliente cuando tú completas la renovación.
- Contrataciones nuevas separadas:
  - `#contratar 1`
  - `#contratar 3`
  - `#contratar 6`
  - `#contratar 12`
- Importación de CSV.
- Ajustes editables desde el panel.
- Copia de seguridad JSON.

## Comportamiento

### Consulta

```text
#usuario123
```

El bot busca `usuario123` en `data/lines.json`.

### Renovación

```text
#renovar usuario123
```

No pregunta por meses. Crea un aviso pendiente en el panel.

En el panel introduces la nueva fecha y pulsas `Renovar y avisar`. El bot:

1. actualiza la caducidad;
2. marca el aviso como completado;
3. envía la confirmación al WhatsApp del cliente.

### Contratación nueva

```text
#contratar 6
```

Crea una solicitud de alta de 6 meses.

## Instalación

Reemplaza el proyecto actual del bot por este, conservando las variables de Render.

Build:

```bash
npm install
```

Start:

```bash
npm start
```

## Variables necesarias

```env
PORT=3000
APP_URL=https://leonbot-simple.onrender.com
NODE_ENV=production

META_GRAPH_VERSION=v25.0
WHATSAPP_TOKEN=TOKEN_PERMANENTE
WHATSAPP_PHONE_NUMBER_ID=PHONE_NUMBER_ID
WEBHOOK_VERIFY_TOKEN=LeonTVWebhook2026

ADMIN_USER=powerghost
ADMIN_PASSWORD=TU_CONTRASEÑA
SESSION_SECRET=UNA_CLAVE_LARGA

DATA_DIR=./data
UPLOAD_DIR=./uploads
MAX_CSV_MB=10
```

## Render gratuito

Render gratuito usa almacenamiento efímero. Los avisos, cambios de fechas y solicitudes pueden perderse tras reinicios o despliegues.

Usa `Exportar copia` con frecuencia. Para funcionamiento permanente, usa un disco persistente o un VPS.
