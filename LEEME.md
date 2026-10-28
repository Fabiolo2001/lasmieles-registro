# Registro Las Mieles (Netlify)

Todo funciona dentro de Netlify:

- **Netlify Database:** guarda los picks y las notas.
- **Netlify Blobs:** guarda las fotos.
- **AI Gateway de Netlify:** lee los picks con Claude y se paga con los créditos de Netlify.

No hace falta ninguna cuenta externa.

## Publicar o actualizar

Abre PowerShell dentro de esta carpeta y ejecuta:

    npx -y netlify-cli deploy --prod --site 8303cd36-9ad2-4ee4-9f63-156f79eb69b7

La primera vez te pedirá iniciar sesión en Netlify en el navegador.

## Contraseña del equipo

Está en Netlify, en **Project configuration → Environment variables → TEAM_PASSWORD**. Si la cambias, vuelve a publicar para que se aplique.
