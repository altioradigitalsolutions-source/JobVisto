# AI Handoff Guide

## Contexto corto

Estamos definiendo un SaaS para cleaners independientes y empresas de limpieza. El sistema debe ser simple, visual y operativo. No procesa pagos reales entre partes; registra evidencia, calcula estimaciones y crea comprobantes.

## Objetivo del producto

Dar control operativo a negocios de limpieza:
- trabajos,
- horarios,
- check-in/check-out,
- fotos,
- checklist,
- firma cliente,
- reportes,
- estimaciones,
- comprobante de pago recibido.

## Reglas de producto

- Mantenerlo simple.
- Siempre diferenciar modo independiente y modo empresa.
- No convertirlo en software contable oficial.
- No decir que el sistema paga a los cleaners.
- Usar lenguaje de estimacion: "aproximado", "referencial", "estimado".
- GPS solo en eventos de entrada/salida al inicio, no rastreo continuo.
- Pensar el producto como global y multidioma desde el inicio.
- Definir textos primero en espanol; despues traducir a ingles, hebreo y ruso.
- Preparar soporte RTL para hebreo.

## Modos

### Independiente

Un cleaner gestiona sus propios clientes y trabajos.

Debe tener:
- trabajos,
- clientes,
- check-in/out,
- fotos,
- firma cliente,
- link privado,
- reportes e ingresos estimados.

No debe tener:
- comprobante de pago a cleaner.

### Empresa

Una organizacion gestiona varios cleaners.

Debe tener todo lo anterior y ademas:
- cleaners,
- asignacion de trabajos,
- reportes por cleaner,
- calculo de monto debido,
- comprobante de pago recibido con firma del cleaner.

## Diferenciador a preservar

La combinacion:

1. Prueba de servicio.
2. Prueba de horas.
3. Firma del cliente.
4. Estimacion financiera.
5. Firma del cleaner al recibir pago.

Esto es mas importante que agregar muchas funciones.

## Siguiente paso recomendado

Antes de programar:
1. Elegir nombre.
2. Definir stack tecnico.
3. Crear modelo de datos.
4. Crear wireframes basicos.
5. Implementar MVP web responsive.

## Idiomas objetivo

Inicial:
- Espanol.
- Ingles.
- Hebreo.
- Ruso.

Futuro:
- Agregar idiomas segun paises objetivo.

La interfaz debe guardar los textos en archivos de traduccion o sistema i18n, no escritos directamente dentro de los componentes.
