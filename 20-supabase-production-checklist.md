# JobVisto - Checklist Supabase Produccion

## Estado listo

- Base de datos creada como migracion SQL.
- Tablas principales preparadas para organizaciones, cleaners, clientes, trabajos, fotos, firmas, pagos, reglas y suscripciones.
- Seguridad RLS preparada por organizacion.
- Buckets privados preparados para evidencia y firmas.
- Variables necesarias documentadas en `.env.example`.
- Configuracion publica de frontend preparada en `website/supabase-config.example.js`.

## Falta para instalar en la cuenta real

1. Entrar a Supabase con la cuenta correcta:

```powershell
npx supabase login
```

2. Crear un proyecto Supabase desde la cuenta `meir.meiras1@gmail.com`.

3. Copiar el `project ref` del proyecto.

4. Vincular esta carpeta al proyecto:

```powershell
npx supabase link --project-ref TU_PROJECT_REF
```

5. Subir la base:

```powershell
npx supabase db push
```

## Despues de subir

- Copiar `Project URL` y `anon public key` desde Supabase.
- Crear `website/supabase-config.js` copiando `website/supabase-config.example.js`.
- Pegar URL y anon key reales.
- Guardar variables en Netlify para produccion.
- Verificar login/registro real con Supabase Auth.
- Verificar fotos y firmas con Supabase Storage.
- Probar Stripe con un checkout real de prueba y webhook real.
- Configurar marca y productos de Stripe segun `22-stripe-branding-and-checkout-plan.md`.

## Configuracion manual en Supabase Dashboard

En `Authentication > Security`:

- Activar leaked password protection.
- Usar contrasena minima de 8 caracteres.
- Exigir mayusculas, minusculas, numeros y simbolos.
- Activar secure password change si esta disponible.

En `Authentication > URL Configuration`:

- Configurar Site URL de produccion.
- Agregar Redirect URLs de produccion y localhost usado para pruebas.

En `Authentication > Providers > Email`:

- Revisar si el lanzamiento exige confirmacion de email antes de entrar.
- Configurar plantillas de correo con marca JobVisto antes de vender.
- Usar como fuente los archivos de `supabase/templates/`:
  - `confirmation.html` para confirmar cuenta.
  - `recovery.html` para resetear contrasena.
  - `magic_link.html` para enlace de acceso.
  - `invite.html` para invitaciones.
- Cambiar sender name de Supabase a `JobVisto`.
- Gmail puede servir temporalmente para pruebas y beta.
- Configurar SMTP propio o proveedor profesional antes de vender ampliamente para que el remitente no salga como Supabase/Gmail personal.
- Ver detalles en `21-email-smtp-and-branding-plan.md`.

## Pendiente comercial

- Revisar/cambiar el correo final de Enterprise antes de publicar. Ahora el enlace abre un correo prellenado para solicitud Enterprise, pero falta confirmar la direccion definitiva.

## Nota de seguridad

La llave `SUPABASE_SERVICE_ROLE_KEY` nunca debe ponerse en `website/` ni en el navegador. Solo se usa en funciones privadas del servidor o Netlify Functions.
