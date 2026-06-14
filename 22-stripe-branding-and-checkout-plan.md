# JobVisto - Stripe branding y checkout real

## Objetivo

Que el checkout real de Stripe no se vea generico ni falso, sino claramente de JobVisto:

- logo de JobVisto,
- colores de marca,
- productos con nombres correctos,
- textos claros para clientes,
- prueba real en modo test antes de publicar.

## Activos de marca disponibles

Usar estos archivos del proyecto:

- Logo principal: `website/assets/Logo Jobvisto.png`
- Logo negativo: `website/assets/Logo Jobvisto negativo.png`
- Logo blanco transparente: `website/assets/Logo Jobvisto white transparent.png`
- Icono: `website/assets/jobvisto-icon-512.png`
- Paleta de colores: `website/assets/Paleta de colores Jobvisto.png`

## Configuracion de marca en Stripe Dashboard

En Stripe Dashboard, entrar en modo test primero y configurar:

- Business name: `JobVisto`
- Public business name: `JobVisto`
- Support email: pendiente de definir
- Support phone: pendiente de definir si aplica
- Statement descriptor: `JOBVISTO`
- Shortened descriptor: `JOBVISTO`
- Logo: subir `Logo Jobvisto.png`
- Icon: subir `jobvisto-icon-512.png`
- Brand color recomendado: `#008551`
- Accent color recomendado: `#c58a22`

Nota: si el logo principal no se ve bien en fondo claro dentro de Stripe, probar con el logo vertical o el icono.

## Productos en Stripe

Los tres productos de pago deben existir en modo test y luego replicarse en modo live:

### JobVisto Independent

- Precio: `9.99 USD / mes`
- Tipo: suscripcion mensual
- Descripcion: Para profesionales independientes que gestionan clientes, trabajos, evidencias y pagos desde un solo lugar.
- Plan interno esperado: `independent`

### JobVisto Company

- Precio: `29.99 USD / mes`
- Tipo: suscripcion mensual
- Descripcion: Para empresas pequenas o medianas que coordinan cleaners, clientes, trabajos y control operativo diario.
- Plan interno esperado: `company`

### JobVisto Pro

- Precio: `59.99 USD / mes`
- Tipo: suscripcion mensual
- Descripcion: Para equipos con mayor volumen, supervision avanzada y necesidad de control financiero y operativo.
- Plan interno esperado: `pro`

## Enterprise

Enterprise no debe pasar por Stripe automaticamente por ahora.

Flujo recomendado:

- Boton: `Contact sales`
- Accion actual: abre correo prellenado.
- Pendiente: confirmar correo final de ventas.
- Mejor opcion futura: formulario corto conectado a email/CRM.

Recordatorio: el correo actual `meir.meiras1@gmail.com` es temporal y hay que revisarlo antes de publicar.

## Llaves y datos que faltan para prueba real

Para hacer la prueba real con print necesito, cuando tengas acceso:

- `sk_test_...` de Stripe
- `whsec_...` del webhook de Stripe en modo test
- payment links de test para Independent, Company y Pro
- confirmar el dominio o URL local donde Stripe debe volver despues del pago

No usar `sk_live_...` para pruebas.

## Prueba real que hay que hacer

Cuando esten las llaves de test:

1. Configurar variables temporales de modo test.
2. Crear o confirmar los tres payment links en Stripe test.
3. Entrar al checkout real de Stripe.
4. Verificar que se vea marca JobVisto.
5. Pagar con tarjeta de prueba `4242 4242 4242 4242`.
6. Verificar que Stripe mande el webhook.
7. Verificar que JobVisto guarde el pago confirmado.
8. Verificar que el registro pagado se active solo si el pago existe.
9. Generar print/screenshot del checkout real.
10. Generar print/screenshot del pago registrado en JobVisto.

## Estado actual del codigo

- El webhook ya diferencia pagos aprobados de intentos no pagados.
- El sistema ya evita activar planes pagados si no encuentra pago confirmado.
- La prueba simulada segura ya paso.
- Falta la prueba real de Stripe en modo test con llaves reales de test.

