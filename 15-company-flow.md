# Company Flow

## Objetivo

El modo empresa permite que una organizacion de limpieza controle clientes, cleaners, trabajos, horarios, evidencia, firmas, estimaciones y comprobantes de pago recibido.

La empresa no usa JobVisto solo como calendario. Lo usa como centro operativo.

## 1. Registro de empresa

La empresa puede:
- registrarse con email y contrasena,
- continuar con Google,
- verificar email,
- crear organizacion.

Datos iniciales:
- nombre de empresa,
- pais,
- moneda,
- zona horaria,
- idioma,
- telefono,
- email de contacto,
- direccion opcional,
- cantidad aproximada de cleaners,
- plan seleccionado.

## 2. Onboarding rapido

Despues del registro:
1. Crear empresa.
2. Elegir plan.
3. Agregar primer cliente.
4. Invitar o crear primer cleaner.
5. Crear primer trabajo.
6. Ver calendario.

El onboarding debe guiar al usuario sin sentirse pesado.

## 3. Roles

### Owner

Control total:
- plan,
- billing,
- configuracion,
- usuarios,
- reportes,
- pagos registrados.

### Manager / Supervisor

Puede:
- crear trabajos,
- asignar cleaners,
- revisar evidencia,
- ver reportes,
- registrar pagos si tiene permiso.

### Cleaner

Puede:
- ver trabajos asignados,
- marcar llegada/salida,
- subir fotos,
- completar checklist,
- reportar incidencias,
- pedir firma del cliente,
- ver estados de pagos propios.

### Cliente final

No necesita cuenta para MVP.

Puede:
- recibir notificaciones,
- abrir link privado,
- ver resumen,
- firmar o confirmar servicio.

## 4. Clientes de empresa

La empresa crea clientes con:
- nombre,
- telefono,
- email,
- direccion,
- notas de acceso,
- idioma preferido,
- metodo de notificacion,
- instrucciones recurrentes,
- historial de trabajos,
- metodo de pago esperado o informativo.

## 5. Cleaners

La empresa puede crear o invitar cleaners.

Datos:
- nombre,
- email,
- telefono,
- tipo: empleado o freelancer,
- tarifa por hora,
- moneda,
- idioma,
- zona o ciudad,
- estado: activo/inactivo,
- permisos,
- notas internas.

El cleaner debe poder entrar desde movil.

## 6. Crear trabajo

Datos del trabajo:
- cliente,
- direccion,
- cleaner asignado,
- fecha,
- hora programada de inicio,
- hora estimada de fin,
- tipo de limpieza,
- tarifa por hora o precio fijo,
- checklist,
- notas internas,
- notas visibles para cleaner,
- si requiere fotos,
- si requiere firma cliente,
- si envia notificaciones al cliente.

Estados:
- pendiente,
- asignado,
- confirmado,
- en camino,
- en progreso,
- terminado,
- esperando firma,
- firmado,
- listo para pago,
- pagado,
- cancelado.

## 7. Calendario y dispatch

La empresa debe tener:
- vista diaria,
- vista semanal,
- vista mensual,
- lista de trabajos,
- vista por cleaner,
- filtros por estado,
- filtros por cliente.

Futuro:
- mapa,
- optimizacion de rutas,
- drag and drop de trabajos.

MVP:
- calendario propio con lista del dia y semana.

## 8. Dia del trabajo

Cleaner abre su trabajo en telefono.

Ve:
- cliente,
- direccion,
- hora,
- notas,
- checklist,
- boton para abrir mapa,
- boton "Llegue".

Cuando marca llegada:
- se guarda hora real,
- GPS aproximado,
- estado pasa a en progreso,
- cliente recibe aviso si esta activado,
- empresa ve en dashboard que cleaner llego.

## 9. Durante el trabajo

Cleaner puede:
- marcar checklist,
- subir fotos,
- registrar antes/despues,
- reportar incidencia,
- agregar nota.

Empresa puede ver progreso.

## 10. Finalizacion y firma cliente

Cleaner marca "Termine".

Sistema:
- guarda hora real de salida,
- calcula duracion,
- calcula estimado,
- genera resumen.

Cliente:
- firma en el telefono del cleaner,
- o firma desde link privado.

Guardar:
- nombre del firmante,
- firma,
- fecha/hora,
- trabajo,
- resumen asociado.

## 11. Reportes de empresa

Empresa ve:
- trabajos por periodo,
- horas por cleaner,
- clientes activos,
- fotos/evidencia,
- firmas pendientes,
- estimado por pagar a cleaners,
- estimado cobrado o por cobrar si se registra,
- incidencias,
- exportes PDF/CSV.

## 12. Pago externo y firma del cleaner

Cuando llega el momento de pagar:
1. Empresa abre pagos.
2. Elige periodo.
3. Ve cuanto se debe a cada cleaner.
4. Registra pago externo.
5. Elige metodo: efectivo, transferencia, PayPal, Zelle, tarjeta, cheque, otro.
6. Cleaner firma que recibio.
7. Sistema marca como pagado.

Este flujo NO procesa dinero.

## 13. Notificaciones de empresa

Notificaciones al cleaner:
- nuevo trabajo asignado,
- recordatorio de manana,
- cambio de horario,
- trabajo cancelado.

Notificaciones al cliente:
- cita confirmada,
- recordatorio de manana,
- cleaner llego,
- trabajo terminado,
- link de resumen,
- solicitud de firma.

MVP:
- email.

Futuro/pro:
- WhatsApp,
- SMS,
- push.

