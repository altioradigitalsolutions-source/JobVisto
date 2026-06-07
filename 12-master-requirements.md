# Master Requirements

Este documento es el colador del proyecto. Lo repetido se consolida, lo innecesario se deja fuera, y lo importante queda como requisito.

## Vision general

JobVisto es un SaaS global para organizar servicios de limpieza por hora o por trabajo.

Debe servir para:
- cleaners independientes,
- empresas de limpieza,
- clientes finales que reciben informacion del servicio.

El producto debe sentirse:
- profesional,
- facil,
- visual,
- confiable,
- digno de pagar.

No debe sentirse como:
- formulario basico,
- Excel bonito,
- sistema barato,
- app improvisada.

## Principio central

Cada trabajo debe quedar visto, probado, firmado y calculado.

Flujo base:
1. Trabajo creado.
2. Cliente organizado.
3. Cleaner ve calendario.
4. Recordatorios enviados.
5. Cleaner llega.
6. GPS registra llegada.
7. Cleaner sube fotos y checklist.
8. Cleaner termina.
9. Sistema calcula horas y monto estimado.
10. Cliente firma satisfaccion.
11. Se genera resumen.
12. Si es empresa, se puede registrar pago externo y firma del cleaner.

## Modo independiente

El independiente es el mismo cleaner.

Debe poder:
- registrarse,
- verificar email,
- entrar con Google,
- crear clientes,
- crear trabajos,
- registrar direccion,
- registrar tipo de pago esperado,
- poner precio por hora o precio fijo,
- ver calendario,
- ver trabajos de hoy/manana/semana/mes,
- recibir recordatorios,
- enviar recordatorios al cliente,
- abrir trabajo desde movil,
- marcar llegada,
- guardar GPS,
- tomar/subir fotos,
- marcar checklist,
- marcar salida,
- pedir firma del cliente,
- generar link privado del cliente,
- ver reportes,
- ver contabilidad estimada.

## Cliente del independiente

El cliente no necesita cuenta al inicio.

Debe poder recibir:
- recordatorio de cita,
- aviso de llegada,
- aviso de salida o finalizacion,
- link privado del servicio.

En el link puede ver:
- fecha,
- direccion o referencia del trabajo,
- hora de llegada,
- hora de salida,
- fotos,
- checklist,
- observaciones,
- firma/confirmacion,
- resumen del trabajo.

El link de cliente debe pensarse como portal privado:
- link permanente por cliente,
- clave/password entregada al cliente,
- historial desde primer trabajo hasta ultimo,
- cada trabajo se abre para ver detalle,
- confirmacion/firma solo desde pantalla del cliente.

En el panel administrativo debe existir una seccion de "Links clientes" donde se gestionan/copien esos links, pero no debe confundirse con la pantalla real del cliente final.

## Datos del cliente

Cuando se crea un cliente, guardar:
- nombre,
- telefono,
- email,
- direccion principal,
- notas de acceso,
- idioma preferido,
- metodo preferido de notificacion,
- metodo de pago esperado/acordado,
- notas internas,
- historial de trabajos.

Metodos de pago informativos:
- efectivo,
- transferencia,
- PayPal,
- Zelle,
- tarjeta,
- cheque,
- otro.

El sistema no cobra ese pago. Solo registra informacion.

## Calendario

Debe existir calendario interno.

Vistas:
- dia,
- semana,
- mes,
- lista,
- trabajos proximos.

Google Calendar puede venir despues.

Regla:
No depender de Google Calendar para el MVP. Primero calendario propio.

Calendario mensual:
- mostrar todos los dias del mes, aunque esten vacios,
- permitir mes anterior,
- permitir mes siguiente,
- volver a hoy,
- mostrar servicios dentro del dia,
- permitir abrir/expandir servicio para ver cliente, direccion, horario y estado,
- permitir abrir direccion en Google Maps usando enlace de busqueda.

Importante:
Google Maps para abrir direccion es diferente a Google Calendar. Se puede usar un enlace directo como `https://www.google.com/maps/search/?api=1&query=direccion`, sin crear eventos ni depender de Google Calendar.

## Notificaciones

Necesarias:
- recordatorio al cleaner,
- recordatorio al cliente,
- aviso de llegada,
- aviso de finalizacion,
- link del resumen.

Canales:
- email primero,
- WhatsApp despues,
- SMS despues,
- push despues.

WhatsApp debe ser funcion premium o de planes mas altos porque tiene costo y alto valor.

## Fotos y evidencia

El cleaner debe poder subir fotos del trabajo.

Tipos:
- antes,
- despues,
- evidencia general,
- incidencia.

Las fotos deben verse grandes y claras en:
- panel admin,
- vista del trabajo,
- link privado del cliente.

No deben quedar como miniaturas pobres. Deben sentirse como evidencia profesional.

Las fotos deben quedar guardadas dentro del sistema, no solo enviadas por WhatsApp. Eso crea historial, evidencia y profesionalismo.

## Incidencias

Durante el trabajo, el cleaner debe poder reportar problemas.

Ejemplos:
- cliente no abrio,
- falta material,
- dano encontrado,
- mascota o riesgo en el lugar,
- area demasiado sucia,
- trabajo extra no previsto.

Cada incidencia puede tener:
- nota,
- foto,
- fecha/hora,
- quien la reporto.

## Firma del cliente

Al terminar el servicio, el cliente puede:
- firmar digitalmente,
- escribir nombre,
- confirmar servicio completado.

Guardar:
- firma,
- nombre,
- fecha,
- hora,
- trabajo asociado,
- dispositivo/link usado.

## Contabilidad estimada para independiente

El sistema debe mostrar:
- horas trabajadas,
- precio por hora,
- precio fijo si aplica,
- subtotal,
- descuentos configurables,
- IVA/exento si aplica,
- total estimado,
- consolidado diario,
- consolidado semanal,
- consolidado mensual.

Debe soportar:
- tarifa por hora,
- precio fijo,
- tarifa por tipo de limpieza,
- reglas especiales por servicio.

Ejemplos de tarifas:
- limpieza normal,
- deep cleaning,
- oficina,
- limpieza antes de Shabat,
- servicio recurrente,
- servicio urgente.

Opcional futuro:
- bonos por puntualidad,
- bonos por buena calificacion,
- descuentos/ajustes configurables,
- horas extra.

Lenguaje obligatorio:
- estimado,
- aproximado,
- referencial.

No decir que es contabilidad legal oficial.

## Modo empresa

La empresa debe poder:
- crear organizacion,
- invitar cleaners,
- gestionar empleados o freelancers,
- crear clientes,
- crear trabajos,
- asignar cleaners,
- ver calendario general,
- ver estado por cleaner,
- recibir fotos/evidencia,
- ver firma del cliente,
- calcular monto debido por cleaner,
- registrar pago externo,
- capturar firma del cleaner por pago recibido.

## Comprobante de pago recibido

Solo modo empresa.

El sistema no paga dinero.

La empresa registra:
- monto,
- fecha,
- metodo,
- periodo,
- nota,
- cleaner.

El cleaner firma:
- nombre,
- firma digital,
- confirmacion de pago recibido.

Esto protege a la empresa y al cleaner.

## Dashboard que debe sentirse premium

Inspiracion de SaaS buenos:
- centro de comando,
- calendario visual,
- lista de trabajos,
- mapa o ubicacion,
- estados claros,
- fotos grandes,
- panel movil del cleaner,
- portal/link de cliente,
- reportes limpios.

Debe tener:
- resumen de hoy,
- trabajos activos,
- proximos trabajos,
- horas registradas,
- fotos subidas,
- pagos pendientes,
- firmas pendientes,
- alertas,
- acciones rapidas.

Reportes/exportes:
- PDF,
- Excel/CSV,
- resumen mensual,
- historial por cleaner,
- historial por cliente,
- trabajos pendientes de firma,
- pagos pendientes o registrados.

## Calificaciones

Puede existir como fase posterior:
- calificacion del cliente,
- puntualidad,
- calidad del trabajo,
- actitud,
- comentario opcional.

No es obligatorio para el MVP inicial, pero puede ayudar a empresas a identificar cleaners buenos y problemas recurrentes.

## Diseño visual esperado

Debe sentirse:
- SaaS moderno,
- high quality,
- confiable,
- operativo,
- facil de vender.

Evitar:
- mockups pobres,
- tarjetas demasiado basicas,
- pantallas vacias,
- textos enormes sin producto,
- bloques que parezcan plantilla generica.

La landing debe mostrar pantallas del sistema que parezcan reales:
- laptop/dashboard,
- movil cleaner,
- link cliente,
- calendario,
- reportes.

## Diferenciador contra competencia

Competidores como ZenMaid, Jobber, Housecall Pro, ScheduleCTRL, SaberTask e iTask muestran patrones fuertes:
- scheduling,
- dispatch,
- mobile app,
- customer communications,
- photos,
- payroll/reports,
- dashboard.

Nuestro diferenciador debe ser:
- simple para cleaners reales,
- precio bajo de entrada,
- independiente + empresa en un mismo sistema,
- firma del cliente,
- firma de pago recibido,
- link privado del cliente,
- contabilidad estimada sin ser contabilidad oficial,
- multidioma global.

## Lo que NO se debe agregar todavia

- pagos procesados dentro de la plataforma,
- contabilidad legal oficial,
- payroll legal por pais,
- GPS continuo todo el dia,
- app nativa antes de validar,
- integraciones bancarias,
- base fiscal mundial automatica.
