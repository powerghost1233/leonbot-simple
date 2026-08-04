# LeonBot Simple

Bot mínimo de comandos para WhatsApp Cloud API.

## Comandos incluidos

- `#menu`
- `#pagar`
- `#precios`
- `#renovar`
- `#soporte`

## Ejecutarlo en el ordenador

1. Instala Node.js.
2. Copia `.env.example` y renombra la copia como `.env`.
3. Pega tu token en `.env`.
4. Abre una terminal en esta carpeta.
5. Ejecuta:

```bash
npm install
npm start
```

Abre `http://localhost:3000`. Debe mostrar:

`LeonBot está funcionando.`

## Personalizar respuestas

Edita el objeto `respuestas` situado al principio de `index.js`.
