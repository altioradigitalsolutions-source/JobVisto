# Screen Map

## Public website

1. Landing.
2. Pricing.
3. Login.
4. Register.
5. Forgot password.
6. Email verification.

## Shared onboarding

1. Choose account type:
   - independent cleaner,
   - company.
2. Language.
3. Country/currency/timezone.
4. Notification preferences.

## Independent cleaner screens

### Dashboard

Debe mostrar:
- trabajos de hoy,
- proximos trabajos,
- horas trabajadas,
- ingresos estimados,
- firmas pendientes,
- recordatorios.

### Clients

- lista de clientes,
- crear cliente,
- editar cliente,
- historial del cliente.

### Calendar

- dia,
- semana,
- mes,
- lista.

### Jobs

- crear trabajo,
- editar trabajo,
- trabajo actual,
- historial.

### Mobile job view

- detalles,
- direccion,
- checklist,
- fotos,
- llegar,
- terminar,
- firma cliente.

Nota:
Esta pantalla pertenece al acceso del cleaner, no al menu principal del admin/empresa. El admin no necesita "ver la pantalla del cleaner"; necesita ver el progreso resumido en Panel, Trabajos y Reportes.

### Reports

- diario,
- semanal,
- mensual,
- ingresos estimados,
- horas.

### Settings

- perfil,
- idioma,
- moneda,
- tarifas,
- notificaciones,
- plan.

## Company screens

### Company dashboard

Debe mostrar:
- trabajos activos,
- cleaners en sitio,
- trabajos de hoy,
- alertas,
- firmas pendientes,
- pagos pendientes,
- horas registradas,
- ingresos/estimados.

### Clients

- lista,
- crear cliente,
- detalle,
- historial,
- trabajos recurrentes.

### Cleaners

- lista,
- crear/invitar cleaner,
- detalle,
- tarifa,
- historial,
- pagos.

### Calendar / Dispatch

- calendario,
- lista por dia,
- filtro por cleaner,
- filtro por estado,
- asignacion de trabajos.

### Jobs

- crear trabajo,
- detalle,
- evidencia,
- firma,
- incidencias,
- estado.

Desde aqui el admin ve lo que hizo el cleaner:
- llegada,
- salida,
- GPS,
- fotos,
- checklist,
- firma cliente.

No debe llamarse "Vista cleaner" dentro del admin.

### Payments

- periodo,
- monto estimado por cleaner,
- registrar pago externo,
- firma del cleaner,
- historial de recibos.

Flujo correcto:
1. Admin registra pago externo.
2. El pago queda pendiente de firma.
3. Cleaner firma con dedo/mouse o desde enlace seguro.
4. Comprobante pasa a firmado.
5. Admin puede abrir y ver firma.

### Reports

- horas por cleaner,
- trabajos por cliente,
- fotos/evidencia,
- firmas,
- pagos,
- exportar PDF/CSV.

Reportes deben incluir:
- graficas,
- ingresos estimados,
- costos de cleaners,
- margen referencial,
- clientes atendidos,
- servicios realizados,
- reglas generales de costo,
- reglas particulares por cleaner.

### Settings

- organizacion,
- usuarios,
- permisos,
- idiomas,
- monedas,
- impuestos estimados,
- notificaciones,
- plan.

## Client links admin

Pantalla del admin/independiente para gestionar portales de clientes.

Debe mostrar:
- lista de clientes,
- link permanente por cliente,
- clave temporal o clave del portal,
- trabajos asociados,
- boton copiar link,
- boton previsualizar portal.

## Client private portal

Pantalla del cliente final, no del admin.

Debe pedir:
- clave o password del cliente.

Debe mostrar:
- logo/nombre de cleaner o empresa,
- historial de trabajos del cliente,
- posibilidad de abrir un trabajo especifico,
- fecha del servicio,
- hora de llegada,
- hora de salida,
- fotos grandes antes/despues,
- checklist completado,
- notas visibles,
- firma/confirmacion,
- boton para confirmar servicio si falta.

Regla:
El boton "Confirmo servicio completado" pertenece al portal del cliente, no al cleaner ni al admin.

## Platform admin screens

Para nosotros como dueños de JobVisto:
- usuarios,
- organizaciones,
- planes,
- pagos de membresia,
- uso por cuenta,
- soporte,
- logs,
- idiomas,
- configuracion global.
