# Sustitución del proyecto actual

1. Descomprime el ZIP.
2. En GitHub, reemplaza el contenido del repositorio actual del bot.
3. No subas `.env`.
4. Puedes borrar los archivos antiguos que no aparezcan en esta versión.
5. Confirma el cambio con un commit.
6. En Render usa `Manual Deploy → Clear build cache & deploy` si no se despliega solo.

No debes cambiar el webhook ni volver a configurar Meta.

## Prueba recomendada

1. Desde el WhatsApp autorizado escribe `#TUUSUARIO`.
2. Escribe `#renovar TUUSUARIO`.
3. Abre el panel → Avisos de renovación.
4. Pulsa `Renovar +1 mes y avisar`.
5. Comprueba que el cliente recibe la nueva fecha.
