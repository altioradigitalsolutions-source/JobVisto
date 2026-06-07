# Open Source Build Strategy

## Pregunta

Existe un sistema open source que podamos usar para evitar codificar todo?

## Respuesta corta

Hay piezas utiles, pero no encontre una base perfecta para nuestro producto completo.

Lo mas inteligente seria construir nuestro propio MVP, como se hizo con Convex/Convexa, pero tomando ideas de sistemas open source para no inventar mal los flujos.

## Opciones encontradas

### OpenSTR

Open source para gestion de limpieza en short-term rentals.

Tiene:
- scheduling,
- checklists,
- photo evidence,
- cleaner mobile flow,
- self-hosted.

Sirve como referencia fuerte para:
- fotos,
- checklist por area,
- experiencia del cleaner.

Limitacion:
- esta pensado para hosts/Airbnb/propiedades, no para empresas de limpieza globales ni cleaners independientes con membresia SaaS.

### OpenJornada

Open source para control horario.

Tiene:
- clock-in/clock-out,
- reportes,
- firma digital de registros,
- exportaciones.

Sirve como referencia fuerte para:
- control de horas,
- reportes mensuales,
- firma de registros.

Limitacion:
- no esta pensado para trabajos de limpieza, fotos, cliente final, link privado ni comprobante de pago recibido.

### Staffjoy

Open source de scheduling laboral.

Tiene:
- turnos,
- notificaciones,
- administracion de horarios.

Limitacion:
- proyecto antiguo y no cubre flujo de limpieza, evidencia, firmas ni pagos registrados.

### FieldOpt

Open source de field service / dispatch.

Tiene:
- asignacion de trabajos,
- mapa,
- capacidad de tecnicos,
- dispatch console.

Limitacion:
- mas orientado a tecnicos/field service general, no a limpieza simple para pequenas empresas.

## Recomendacion

No clonar un sistema completo.

Construir propio MVP con:
- Convex o stack similar para base de datos en tiempo real,
- app web responsive,
- sistema i18n desde el inicio,
- componentes simples,
- modelo multi-tenant para empresas e independientes.

Usar open source solo como referencia para:
- como estructurar checklists,
- como guardar evidencia,
- como modelar clock-in/out,
- como generar reportes,
- como pensar roles y permisos.

## Por que no usar directamente una base open source

- Puede traer demasiada complejidad.
- Puede tener licencia restrictiva.
- Puede estar pensada para otro mercado.
- Puede ser mas lento adaptar que construir el flujo exacto.
- Nuestro diferenciador es el flujo simple: prueba de servicio + prueba de pago recibido.

## Decision sugerida

Crear producto propio.

Primera version:
- sencilla,
- enfocada,
- web responsive,
- multidioma,
- sin pagos internos,
- con suscripcion propia.

