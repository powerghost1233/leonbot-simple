# Migración desde LeonBot Simple

## Archivos que debes conservar

- `.git/`
- `.env` (solo en tu ordenador; nunca se sube a GitHub)

## Archivos antiguos que debes eliminar

- `db.js`
- cualquier `database.sqlite`
- cualquier referencia a `better-sqlite3`
- el `package-lock.json` antiguo (se recrea con `npm install`)

## Comandos

```bash
npm install
npm run check
git status
git add .
git commit -m "Instalar LeonBot profesional JSON"
git push
```

Después revisa los logs de Render. La línea correcta es:

```text
LeonBot profesional JSON activo en el puerto ...
```
