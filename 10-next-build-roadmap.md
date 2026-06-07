# Next Build Roadmap

## Lo que ya tenemos

- Idea base del producto.
- Dos modos: independiente y empresa.
- Diferenciador: prueba de servicio + prueba de pago recibido.
- Precios iniciales.
- Plan multidioma global.
- Decision de construir producto propio en vez de adaptar open source completo.
- Nombre candidato principal: JobVisto.
- Primera landing/prototipo visual.

## Lo que falta antes de construir app real

### 1. Nombre y marca

- Verificar dominio.
- Verificar redes sociales.
- Verificar si existe marca parecida.
- Elegir nombre final.
- Crear tono de marca.

### 2. Landing comercial

La landing debe quedar muy premium:
- laptop/dashboard convincente,
- movil del cleaner,
- seccion de beneficios,
- planes claros,
- prueba gratis o precio fundador,
- CTA en cada paquete.

### 3. Estructura del sistema

Roles:
- owner/admin de plataforma,
- empresa,
- supervisor/manager,
- cleaner empleado/freelancer,
- cleaner independiente,
- cliente final por link privado.

### 4. Onboarding

#### Independiente

1. Crea cuenta.
2. Elige idioma.
3. Configura moneda y pais.
4. Agrega primer cliente.
5. Crea primer trabajo.
6. Usa check-in/check-out.

#### Empresa

1. Crea organizacion.
2. Elige plan.
3. Invita cleaners.
4. Agrega clientes.
5. Crea trabajos.
6. Revisa reportes.
7. Registra pagos externos y firma de cleaner.

### 5. App responsive para cleaners

La parte del cleaner debe funcionar perfecto en telefono:
- ver trabajo asignado,
- abrir direccion,
- marcar llegada,
- subir fotos,
- marcar tareas,
- marcar salida,
- pedir firma del cliente,
- ver estado de pago.

No necesita app nativa al inicio. Web responsive tipo app es suficiente.

### 6. Base de datos inicial

Entidades necesarias:
- users,
- organizations,
- memberships,
- cleaners,
- clients,
- jobs,
- job_checkins,
- job_photos,
- job_tasks,
- client_signatures,
- payment_receipts,
- notifications,
- settings,
- translations.

### 7. MVP tecnico

Primera app real:
- auth,
- dashboard empresa,
- dashboard independiente,
- crear trabajo,
- check-in/check-out,
- fotos,
- firma cliente,
- calculo de horas,
- planes,
- comprobante de pago recibido.

## Prioridad inmediata

1. Terminar landing premium.
2. Validar nombre.
3. Dibujar flujo de pantallas.
4. Definir base de datos.
5. Comenzar MVP real.

