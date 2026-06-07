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
- Conectar login/registro real con Supabase Auth.
- Conectar fotos y firmas con Supabase Storage.
- Conectar Stripe para activar planes antes de dar acceso.

## Nota de seguridad

La llave `SUPABASE_SERVICE_ROLE_KEY` nunca debe ponerse en `website/` ni en el navegador. Solo se usa en funciones privadas del servidor o Netlify Functions.

