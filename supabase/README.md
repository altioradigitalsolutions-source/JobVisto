# JobVisto Supabase

Base de datos de produccion para JobVisto.

## Estado actual

La migracion principal esta en:

- `supabase/migrations/202606020001_jobvisto_schema.sql`

Incluye:

- usuarios/perfiles conectados a Supabase Auth,
- organizaciones para independientes y empresas,
- miembros de organizacion,
- cleaners,
- clientes y direcciones,
- trabajos,
- check-in/check-out,
- evidencias/fotos por area y momento,
- firmas del cliente,
- links privados,
- reglas de precios al cliente,
- reglas de pago/costo por cleaner,
- comprobantes de pago externo,
- notificaciones,
- planes y suscripciones,
- buckets privados para evidencia y firmas,
- seguridad RLS por organizacion.

## Para instalar en la cuenta real de Supabase

1. Crear un proyecto Supabase en la cuenta de `meir.meiras1@gmail.com`.
2. Instalar o abrir Supabase CLI.
3. Iniciar sesion:

```powershell
npx supabase login
```

4. Vincular este proyecto local al proyecto Supabase real:

```powershell
npx supabase link --project-ref TU_PROJECT_REF
```

5. Subir la base de datos:

```powershell
npx supabase db push
```

6. Copiar las claves publicas al frontend:

- crear `website/supabase-config.js`,
- copiar el contenido de `website/supabase-config.example.js`,
- reemplazar `TU_PROJECT_REF` y `TU_SUPABASE_ANON_KEY`.

## Importante

Ahora mismo la demo web usa `localStorage`. La siguiente fase es conectar la app a Supabase:

- login/registro con Supabase Auth,
- Stripe para activar suscripcion,
- CRUD real para clientes, cleaners y trabajos,
- Storage para fotos y firmas,
- funciones seguras para portales privados de cliente/cleaner.
