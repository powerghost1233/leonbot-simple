# LeonBot PRO — líneas y renovación mensual

Versión completa para reemplazar el bot actual en Render.

## Qué hace

### Consulta de línea

El cliente escribe directamente:

```text
#SUUSUARIO
```

El bot devuelve:

- estado;
- fecha de caducidad;
- días restantes;
- instrucción para solicitar la renovación.

### Renovación de una línea existente

```text
#renovar SUUSUARIO
```

La solicitud aparece en:

```text
Panel → Avisos de renovación
```

Dispones de dos acciones:

- **Renovar +1 mes y avisar**
- **Elegir otra fecha**

La renovación automática aplica esta regla:

- línea activa → caducidad actual + 1 mes natural;
- línea caducada → fecha actual + 1 mes natural.

Ejemplos:

```text
28/08/2026 → 28/09/2026
31/01/2026 → 28/02/2026
```

Cuando pulsas el botón:

1. se actualiza `data/lines.json`;
2. la solicitud queda completada;
3. se envía al cliente la nueva caducidad por WhatsApp;
4. si Meta falla, aparece **Reintentar aviso**.

### Contrataciones nuevas

Las altas nuevas permanecen separadas:

```text
#contratar
#contratar 1
#contratar 3
#contratar 6
#contratar 12
```

## Instalación

1. Conserva las variables de entorno de Render.
2. Reemplaza todos los archivos del repositorio por los de este proyecto.
3. No subas `.env` ni `node_modules`.
4. Render desplegará automáticamente.

Build Command:

```bash
npm install
```

Start Command:

```bash
npm start
```

Panel:

```text
https://leonbot-simple.onrender.com/login
```

Webhook existente:

```text
https://leonbot-simple.onrender.com/webhook
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
SESSION_SECRET=UNA_CLAVE_MUY_LARGA

DATA_DIR=./data
UPLOAD_DIR=./uploads
MAX_CSV_MB=10
```

## Importante sobre Render gratuito

Los archivos JSON escritos durante la ejecución pueden perderse después de reinicios o
nuevos despliegues porque el almacenamiento gratuito es efímero. Usa **Exportar copia**
con frecuencia. Para un uso permanente, será necesario un disco persistente o un VPS.
