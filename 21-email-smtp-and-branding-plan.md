# JobVisto - Email SMTP y marca

## Objetivo

Que los correos de JobVisto no salgan feos, blancos o con marca Supabase, sino con:

- nombre de remitente `JobVisto`,
- asunto claro,
- plantilla HTML con marca JobVisto,
- enlaces de confirmacion, recuperacion e invitacion bien presentados.

## Estado preparado en codigo

Las plantillas HTML estan en:

- `supabase/templates/confirmation.html`
- `supabase/templates/recovery.html`
- `supabase/templates/magic_link.html`
- `supabase/templates/invite.html`

La configuracion local de Supabase ya apunta a esas plantillas desde `supabase/config.toml`.

## Gmail como solucion temporal

Se puede usar Gmail para empezar, especialmente si todavia no hay correo empresarial.

Ventajas:

- rapido de activar,
- no requiere comprar dominio nuevo,
- suficiente para pruebas y primeros usuarios controlados.

Limitaciones:

- puede mostrar el remitente como Gmail o una direccion personal,
- tiene limites diarios,
- puede caer mas facil en promociones/spam,
- no se ve tan profesional como `support@jobvisto.com` o `hello@jobvisto.com`,
- normalmente requiere una contrasena de aplicacion si la cuenta tiene verificacion en dos pasos.

Uso recomendado:

- Gmail sirve para pruebas, beta y primeros clientes cercanos.
- Antes de vender ampliamente, migrar a correo con dominio o proveedor SMTP profesional.

## Recomendado para produccion

Opcion ideal:

- comprar/conectar dominio de JobVisto,
- crear correo tipo `support@jobvisto.com`, `hello@jobvisto.com` o `no-reply@jobvisto.com`,
- usar un proveedor SMTP transaccional:
  - Resend,
  - SendGrid,
  - Postmark,
  - Brevo,
  - Mailgun.

Configuracion esperada en Supabase Dashboard:

- Sender name: `JobVisto`
- Sender email: correo definitivo de JobVisto
- SMTP host, port, user y password del proveedor elegido
- Plantillas HTML copiadas desde `supabase/templates/`

## Pendiente de decision

- Confirmar si se usara Gmail temporalmente.
- Confirmar correo final para Enterprise.
- Confirmar dominio/correo definitivo de JobVisto antes de publicar.
