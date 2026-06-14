# JobVisto - Auditoria de planes y permisos

## Resumen ejecutivo

La pagina de precios promete paquetes claros, pero el sistema todavia no tiene una capa central de permisos por plan.

Estado actual:

- Los planes se muestran correctamente en la landing.
- El registro permite escoger plan.
- Stripe diferencia los tres planes pagados.
- Supabase guarda `plan_id` en la organizacion.
- Pero la app no bloquea de forma consistente clientes, cleaners, trabajos, reportes, pagos, portales ni funciones avanzadas segun el plan.

Conclusion: hoy varias cosas son mas texto comercial que control real. Antes de vender, conviene implementar una matriz unica de permisos y limites.

## Promesa comercial actual

### Freelancer Free

- Precio: `$0`
- 1 cleaner
- Hasta 3 clientes
- Hasta 5 trabajos por mes
- Calendario basico
- Evidencia fotografica
- Firmas digitales
- Portal del cliente
- Sin tarjeta de credito

### Independent

- Precio: `$9.99/mes`
- 1 cleaner
- Hasta 20 clientes
- Trabajos ilimitados
- Calendario completo
- Evidencia de foto y notas
- Firmas digitales
- Registro de llegada y salida
- Portal del cliente

### Company

- Precio: `$29.99/mes`
- Hasta 5 cleaners
- Clientes ilimitados
- Trabajos ilimitados
- Calendario por cleaner
- Fotos, notas y checklist
- Firmas digitales
- Portales para clientes y cleaners
- Reportes operativos
- Soporte por email

### Pro

- Precio: `$59.99/mes`
- Hasta 20 cleaners
- Todo lo de Company
- Recibos de pago de cleaners
- Pagos individuales o consolidados
- Reportes por cleaner, cliente y periodo
- Historial avanzado de trabajos
- Control de firmas pendientes
- Exportacion simple de datos
- Soporte prioritario

### Enterprise

- Precio personalizado
- Limites personalizados de cleaners
- Multi-sede
- Roles y permisos avanzados
- Onboarding personalizado
- Soporte prioritario
- Flujos personalizados
- Integraciones personalizadas

## Brechas encontradas

### 1. Plan Free no esta protegido

Promete:

- maximo 3 clientes,
- maximo 5 trabajos por mes,
- 1 cleaner.

Estado real:

- El formulario de clientes permite seguir creando clientes.
- El formulario de trabajos permite seguir creando trabajos.
- No hay chequeo mensual para los 5 trabajos.
- La base de datos tampoco bloquea por limite de plan.

Riesgo:

- Un usuario gratis podria usar mas de lo prometido y no tendria motivo fuerte para subir a Independent.

Prioridad: alta.

### 2. Independent no esta protegido

Promete:

- 1 cleaner,
- hasta 20 clientes,
- trabajos ilimitados,
- calendario completo,
- portal del cliente.

Estado real:

- El modo independent oculta algunas partes de cleaners/pagos, pero no es una regla completa de plan.
- La base guarda Independent como `solo`.
- No hay bloqueo central que impida mas de 20 clientes.
- El sistema usa `state.mode` para algunas pantallas, pero no una matriz real de permisos.

Riesgo:

- El plan Independent puede comportarse parecido a otros planes si el usuario entra por rutas o estados no previstos.

Prioridad: alta.

### 3. Company no coincide con Supabase

Promete:

- hasta 5 cleaners,
- clientes ilimitados,
- trabajos ilimitados,
- portales cliente y cleaner,
- reportes operativos.

Estado real:

- Landing y app dicen `Company - $29.99`.
- Supabase todavia tiene `starter` con precio `39.00`, lanzamiento `29.00` y solo `3` cleaners incluidos.
- No hay bloqueo real de 5 cleaners.

Riesgo:

- Inconsistencia comercial y tecnica: la pagina vende 5 cleaners, la base dice 3.

Prioridad: alta.

### 4. Pro no coincide con Supabase

Promete:

- hasta 20 cleaners,
- recibos de pago,
- pagos individuales o consolidados,
- reportes por cleaner/cliente/periodo,
- historial avanzado,
- firmas pendientes,
- exportacion simple.

Estado real:

- Landing y app dicen `Pro - $59.99`.
- Supabase todavia tiene `pro` con precio `79.00`, lanzamiento `59.00` y solo `8` cleaners incluidos.
- Recibos de pago existen en la app, pero no estan restringidos solo a Pro.
- Reportes existen, pero no estan restringidos por plan.
- No se encontro exportacion simple real funcionando.
- Control de firmas pendientes existe visualmente, pero no esta reservado para Pro.

Riesgo:

- Company o incluso cuentas no-Pro podrian usar funciones que deberian vender Pro.
- El usuario Pro paga mas pero recibe pocas diferencias reales protegidas.

Prioridad: alta.

### 5. Enterprise esta bien como flujo manual, pero falta formulario final

Estado real:

- No pasa por Stripe automaticamente.
- El boton abre correo prellenado.
- El correo actual es temporal.

Riesgo:

- Sirve para MVP, pero antes de vender conviene tener un correo/fomulario mas profesional.

Prioridad: media.

### 6. Registro por OAuth puede crear plan incorrecto

Estado real:

- Si un usuario entra por OAuth y no tiene organizacion, la app crea la organizacion como `solo` si el modo es independent o `starter` si el modo es company.
- Ese flujo no distingue Free vs Independent ni Company vs Pro.

Riesgo:

- Alguien podria terminar con un plan tecnico distinto al que esperaba.

Prioridad: alta.

### 7. No hay una matriz unica de permisos

Estado real:

- Hay planes en landing.
- Hay planes en `website/app.js`.
- Hay planes en Supabase.
- Pero no hay un objeto unico tipo `PLAN_ENTITLEMENTS` que diga: este plan puede hacer esto, hasta este limite.

Riesgo:

- Cada cambio comercial se vuelve peligroso porque hay que acordarse de modificar varios lugares.

Prioridad: alta.

## Feature nueva: avisos al cliente por estado del cleaner

Idea del usuario:

- Desde Pro en adelante, el cleaner podria avisar:
  - voy en camino,
  - ya llegue,
  - termine el trabajo.
- El cliente recibiria email, WhatsApp o SMS.
- En el aviso final debe ir el link del portal para revisar fotos, evidencia y confirmar.

Estado real:

- La base ya tiene tabla `notifications`.
- Los clientes tienen `notification_channel`.
- Los trabajos tienen `notify_client`.
- La app dice textos como "Cliente notificado", pero no envia un mensaje real.
- No hay integracion de email/WhatsApp/SMS para esos eventos.
- No existe todavia el estado "voy en camino".

Recomendacion comercial:

- Esta funcion encaja bien como beneficio Pro.
- Company podria tener portales y control interno.
- Pro podria tener automatizacion de avisos al cliente.
- Enterprise podria tener plantillas personalizadas, WhatsApp avanzado o integraciones.

## Matriz recomendada

### Free

- Clientes: maximo 3
- Cleaners: 1
- Trabajos: maximo 5 por mes
- Calendario: basico
- Evidencia: si
- Firmas: si
- Portal cliente: si
- Portal cleaner: no como equipo
- Recibos de pago a cleaner: no
- Reportes: basicos o resumen minimo
- Exportacion: no
- Avisos automaticos al cliente: no

### Independent

- Clientes: maximo 20
- Cleaners: 1
- Trabajos: ilimitados
- Calendario: completo
- Evidencia: si
- Firmas: si
- Portal cliente: si
- Portal cleaner: no como equipo
- Recibos de pago a cleaner: no
- Reportes: basicos
- Exportacion: no
- Avisos automaticos al cliente: no

### Company

- Clientes: ilimitados
- Cleaners: maximo 5
- Trabajos: ilimitados
- Calendario por cleaner: si
- Evidencia y checklist: si
- Firmas: si
- Portal cliente: si
- Portal cleaner: si
- Recibos de pago a cleaner: no o limitado, si quieres reservar valor para Pro
- Reportes operativos: si
- Exportacion: no
- Avisos automaticos al cliente: no o basico

### Pro

- Clientes: ilimitados
- Cleaners: maximo 20
- Trabajos: ilimitados
- Todo Company: si
- Recibos de pago a cleaner: si
- Pagos individuales/consolidados: si
- Reportes avanzados: si
- Historial avanzado: si
- Control de firmas pendientes: si
- Exportacion simple: si
- Avisos automaticos al cliente: si
  - voy en camino,
  - llegue,
  - termine,
  - link al portal para revisar fotos y confirmar.

### Enterprise

- Todo Pro
- Limites personalizados
- Multi-sede
- Roles avanzados
- Plantillas personalizadas
- Integraciones personalizadas
- WhatsApp/SMS avanzado segun acuerdo

## Acciones recomendadas antes de vender

1. Crear una matriz central de permisos en la app.
2. Actualizar Supabase `plans` para que coincida con la landing.
3. Bloquear creacion de clientes cuando el plan llegue al limite.
4. Bloquear creacion de cleaners cuando el plan llegue al limite.
5. Bloquear creacion de trabajos mensuales para Free cuando pase de 5.
6. Restringir recibos de pago de cleaners a Pro si se quiere usar como diferenciador.
7. Restringir reportes avanzados a Pro.
8. Agregar aviso visual de upgrade cuando el usuario choque con un limite.
9. Preparar la tabla `notifications` para guardar eventos aunque todavia no se envie WhatsApp real.
10. Luego conectar envio real por email primero; WhatsApp/SMS despues.

## Estado implementado - 2026-06-12

Ya se implemento la primera capa de control:

- Matriz central `PLAN_ENTITLEMENTS` en `website/app.js`.
- Free bloquea nuevos clientes al llegar a 3.
- Free bloquea nuevos trabajos si el mes pasa de 5.
- Independent bloquea nuevos clientes al llegar a 20.
- Free e Independent bloquean gestion de equipo/portal de cleaners desde el menu.
- Company limita cleaners a 5.
- Pro limita cleaners a 20.
- Recibos y pagos a cleaners quedan reservados para Pro.
- La pestaña interna de pagos a cleaners queda bloqueada si el plan no es Pro.
- El registro por Google/Microsoft ya distingue Free, Independent, Company y Pro al crear organizacion.
- Cuando el usuario llega a un limite, ahora se abre un cuadro de actualizacion con la rejilla de planes.
- En registro nuevo, el campo de plan ya no queda como selector dentro del formulario basico; al enviar los datos se abre la rejilla de planes.
- Si elige Free, la cuenta se registra con plan gratis.
- Si elige un plan pagado, la app envia al checkout de Stripe del plan elegido.
- Si un usuario existente vuelve de Stripe con sesion activa y pago confirmado, la app actualiza su organizacion al plan pagado detectado.
- Supabase ya tiene migracion `202606120004_align_plan_entitlements.sql` para alinear:
  - `free`,
  - `solo` / Independent,
  - `starter` / Company,
  - `pro` / Pro.

Pendiente de segunda capa:

- Bloqueos directos en base de datos para impedir saltarse la app.
- Separar reportes basicos/operativos/avanzados con mas precision visual.
- Implementar exportacion simple para Pro.
- Implementar avisos reales al cliente:
  - voy en camino,
  - llegue,
  - termine,
  - link al portal para revisar fotos y confirmar.
