# LeonBot Profesional JSON — Render Ready

Versión ligera, sin SQLite, sin Supabase y sin dependencias nativas. Está preparada para compilar directamente en Render.

## Funciones

- WhatsApp Cloud API oficial de Meta.
- `#menu` generado automáticamente.
- Comandos editables desde el panel.
- Respuestas con texto, imágenes, PDF/documentos, vídeo y audio.
- Registro automático de clientes.
- Solicitudes y control de renovaciones.
- Historial de los últimos 500 mensajes.
- Gestor de archivos.
- Ajustes del bot.
- Exportación e importación de copias JSON.
- Login protegido, cookie firmada, protección CSRF y limitación de intentos.
- Verificación opcional de la firma de Meta.

## Sustituir el proyecto actual

1. Conserva la carpeta oculta `.git` y tu archivo `.env` local.
2. Borra los archivos del proyecto antiguo, incluido `db.js` y cualquier referencia a `better-sqlite3`.
3. Copia dentro el contenido de esta carpeta.
4. En CMD, dentro del proyecto:

```bash
npm install
npm run check
git add .
git commit -m "Instalar LeonBot profesional JSON"
git push
```

Render detectará el `push` y desplegará automáticamente.

## Variables de Render

En **Render → Environment** conserva o añade:

```env
APP_URL=https://leonbot-simple.onrender.com
META_GRAPH_VERSION=v25.0
WHATSAPP_TOKEN=TU_TOKEN_PERMANENTE
WHATSAPP_PHONE_NUMBER_ID=TU_PHONE_NUMBER_ID
WEBHOOK_VERIFY_TOKEN=LeonTVWebhook2026
META_APP_SECRET=TU_APP_SECRET_OPCIONAL
ADMIN_USER=admin
ADMIN_PASSWORD=UNA_CONTRASEÑA_SEGURA
SESSION_SECRET=UNA_CLAVE_MUY_LARGA_Y_ALEATORIA
DATA_DIR=./data
UPLOAD_DIR=./uploads
MAX_UPLOAD_MB=20
```

No necesitas añadir `PORT`: Render lo configura automáticamente.

## Configuración de Render

- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/health`
- Node: el proyecto fija `22.22.3` en `.node-version`.

No necesitas cambiar el webhook de Meta. Sigue siendo:

```text
https://leonbot-simple.onrender.com/webhook
```

## Acceso

```text
https://leonbot-simple.onrender.com/login
```

Usa `ADMIN_USER` y `ADMIN_PASSWORD`.

## Persistencia en Render gratuito

Render gratuito usa un sistema de archivos efímero. El bot compila y funciona, pero los cambios realizados desde el panel y los archivos subidos pueden desaparecer después de un reinicio o despliegue.

Para reducir el riesgo:

1. Entra en **Copias**.
2. Descarga una copia JSON después de cambios importantes.
3. Restaúrala desde el mismo panel si fuera necesario.

Los archivos JSON incluidos en GitHub sí vuelven con cada despliegue. Un disco persistente de Render requiere un servicio de pago.


## Mensaje de bienvenida

En **Ajustes** puedes escribir el mensaje y elegir: primera vez, después de 24 horas sin actividad o desactivado.
