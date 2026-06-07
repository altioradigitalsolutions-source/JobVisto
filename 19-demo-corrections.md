# Demo Corrections

Correcciones detectadas al probar la demo MVP.

## Estado

No implementar nuevas funciones hasta revisar esta lista y decidir orden.

## Idioma de la app operativa

Implementado:
- la aplicacion de administradores, independientes y cleaners queda en ingles por defecto.
- hay selector visible `EN / ES / RU` en acceso y dentro del panel.
- el idioma queda guardado localmente y cambia textos principales: acceso, menu, titulo de seccion, resumen operativo, metricas y acciones rapidas.
- el selector de paises usa el idioma activo para mostrar nombres internacionales.

## Clientes

### Nombre

Actualmente:
- campo unico `Nombre`.

Corregir:
- separar en `Nombre` y `Apellido`, o usar `Nombre completo` de forma clara.

Recomendacion:
- para MVP comercial, usar `Nombre completo`.
- para producto final, considerar `Nombre` y `Apellido` si ayuda a busquedas y reportes.

### Pais y telefono

Actualmente:
- telefono libre.

Corregir:
- el pais se elige al registrar la cuenta/organizacion.
- NO elegir pais dentro de cada cliente.
- mostrar codigo pais separado en cliente segun pais de la cuenta.
- telefono local en campo aparte.

Ejemplo:
- Pais: Israel.
- Codigo: +972.
- Telefono: 50 000 0000.

Debe funcionar globalmente:
- Israel +972.
- Estados Unidos +1.
- Ecuador +593.
- España +34.
- Colombia +57.
- Mexico +52.
- etc.

Decision:
El pais pertenece a la cuenta/organizacion, no al cliente individual, salvo futuro caso avanzado donde una empresa opere en multiples paises.

### Direccion

Actualmente:
- direccion como texto libre.

Mantener por ahora:
- direccion libre,
- notas de acceso.

Futuro:
- pais/ciudad separados,
- Google Maps autocomplete,
- lat/lng opcional.

### Metodo esperado de pago

Actualmente:
- efectivo,
- transferencia,
- PayPal,
- Zelle,
- tarjeta,
- otro.

Mantener.

Recordatorio:
Esto es informativo. JobVisto no procesa el pago.

### Notas

Mantener:
- notas de direccion,
- instrucciones,
- acceso,
- preferencias del cliente.

### Editar cliente

Actualmente:
- se puede crear cliente,
- no se puede editar.

Corregir:
- agregar boton Editar en cada cliente.
- permitir actualizar datos.
- permitir cancelar edicion.
- no duplicar cliente cuando se corrige un error.

Implementado en demo:
- boton "Editar cliente",
- formulario reutiliza el cliente seleccionado,
- boton cambia a "Actualizar cliente",
- se puede cancelar edicion.

## Navegacion y modos

### Boton "Cambiar modo"

Actualmente:
- hay boton para cambiar entre independiente/empresa dentro de la demo.

Problema:
- se siente improvisado.
- no representa el producto real.

Corregir:
- separar claramente acceso independiente y acceso empresa.
- como en Convexa: secciones o rutas separadas.

Opciones:
- `/app-independent.html`
- `/app-company.html`
- o login/onboarding que te lleva a dashboard correcto segun tipo de cuenta.

Para MVP demo:
- quitar o esconder "Cambiar modo".
- mostrar tipo de cuenta arriba como etiqueta, no como boton.

### Vista cleaner

Problema:
- en el menu de empresa/admin aparece "Vista cleaner".
- esto confunde porque parece que el admin puede o debe ver la pantalla del cleaner.

Decision:
- quitar "Vista cleaner" del menu principal.
- esa pantalla solo debe existir como simulador interno/demo o como acceso separado del cleaner.
- el admin debe ver progreso desde Panel, Trabajos y Reportes.

### Link cliente

Problema:
- la demo mostraba directamente la pantalla del cliente dentro del admin.
- eso confunde porque el boton de confirmar servicio pertenece al cliente final.

Decision:
- en admin debe llamarse "Links clientes".
- debe listar clientes con link permanente y clave.
- al crear trabajo se asocia al portal del cliente.
- el portal privado del cliente es otra pantalla/acceso.
- el cliente puede ver historial de trabajos y abrir cada trabajo.
- el boton "Confirmo servicio completado" solo existe en el portal del cliente.

Implementado:
- el link del cliente queda permanente, pero ya no muestra trabajos cerrados como si estuvieran activos.
- la vista del admin separa activos/proximos de trabajos en historial.
- el portal del cliente muestra primero el servicio actual/proximo; si no hay, indica "sin trabajos activos".
- los trabajos realizados quedan en un historial por fecha dentro del portal.

### Contabilidad de trabajos registrados vs hechos

Decision:
- un trabajo registrado o agendado no suma dinero real ni horas reales.
- solo un trabajo hecho/cerrado suma horas realizadas, ganancia real y costo real del cleaner.
- los trabajos futuros quedan visibles como agenda/registrados, pero no inflan reportes.
- los trabajos creados por error deben poder eliminarse desde la lista de trabajos.

Implementado:
- panel y reportes separan trabajos hechos de trabajos registrados.
- las tarjetas de trabajo muestran "registrado" para estimado futuro y "real" cuando ya es hecho/cerrado.
- se agrego boton Eliminar en cada trabajo.

## Reportes

Problema:
- el reporte inicial era solo un consolidado de lineas.
- faltaban graficas, costos, clientes, pagos a cleaners y margen.

Implementado en demo:
- KPIs superiores,
- grafico circular/donut con ganancia bruta, pago a cleaners e IVA estimado,
- barras por cliente,
- reglas de costos,
- reglas particulares por cleaner usando nombres guardados del sistema,
- cada regla particular puede reemplazar la regla general o sumarse encima de la general,
- reglas de pago a cleaners por tipo de servicio: limpieza normal, deep cleaning, oficina, antes de Shabat, urgente y proyecto/primera visita,
- modo especial "cobra igual que el cliente" para cuando el dueno limpia y debe recibir el valor completo cobrado al cliente,
- reglas particulares quedan en tarjetas editables/eliminables,
- consolidado con subtotal, pago a cleaners, ganancia bruta, IVA, total y horas.

Pendiente producto real:
- filtros por periodo,
- filtros por cleaner,
- filtros por cliente,
- export PDF/CSV real,
- reglas de costo editables desde configuracion.

## Pagos

Problema:
- el boton decia "Firmar pago recibido" al registrar pago.
- eso mezclaba dos pasos distintos.
- tampoco se podia editar si habia error.

Decision:
- primero se registra pago externo,
- queda pendiente de firma del cleaner,
- luego se abre pantalla/modal de firma,
- cleaner firma con dedo/mouse,
- comprobante queda como firmado.

Implementado en demo:
- registrar pago externo,
- editar pago,
- estado pendiente de firma,
- modal de firma,
- canvas para firma,
- guardar firma como imagen,
- ver/reemplazar firma.

Pendiente producto real:
- firma desde dispositivo del cleaner o enlace seguro,
- auditoria de quien registro el pago,
- fecha/hora exacta de firma,
- bloqueo de cambios despues de firmado salvo permiso especial.

## Website y login

Problema:
- la demo abria directo la app y parecia que se perdio la website.

Implementado:
- la landing mantiene botones de acceso:
  - Administracion,
  - Cleaner.
- ambos abren la pantalla de login/demo.

### Tipo real de cuenta en login

Problema:
- el mismo correo podia entrar como independiente o empresa segun el boton marcado.
- eso no representa el producto real, porque cada cuenta debe tener un tipo interno.

Decision:
- una cuenta registrada como empresa entra solo como empresa.
- una cuenta registrada como independiente entra solo como independiente.
- si el usuario marca el tipo incorrecto, el sistema debe avisar y no dejar entrar.

Implementado en demo:
- `meir.meiras1@gmail.com` queda como cuenta empresa.
- `maria@jobvisto.demo` queda como cuenta independiente.
- si se intenta entrar con el tipo incorrecto, la app bloquea el login y cambia al tipo correcto.

Pendiente producto real:
- en Supabase, guardar `organization_type` y rol del usuario.
- despues del login, redirigir por el tipo real de organizacion, no por un boton visual.
- si un usuario pertenece a varias organizaciones, mostrar selector de organizacion.

## Pendiente

### Pop-up de eliminar cliente

Pendiente anotado por el usuario:
- el aviso actual de eliminar cliente aparece como pop-up nativo del navegador en la parte superior.
- se ve feo y no coincide con la imagen corporativa de JobVisto.
- reemplazarlo por un modal propio centrado en pantalla.
- el modal debe tener imagen/identidad corporativa, mejor estilo visual y botones claros.
- mantener el mensaje de seguridad antes de eliminar:
  - confirmar eliminacion,
  - cancelar,
  - indicar que el cliente quedara guardado en historial.
- no implementar todavia; solo dejar guardado para hacerlo despues.

### Permiso admin para evidencia historica

Implementado en demo:
- en el portal del cleaner, la carga de fotos para trabajos historicos queda bloqueada por defecto.
- se puede activar con clave admin para corregir evidencia de trabajos cerrados.
- el permiso temporal caduca despues de 1 hora o al cerrar sesion.

Pendiente producto real:
- reemplazar la clave fija de demo por codigo aleatorio temporal tipo OTP.
- generar el codigo desde una cuenta admin autenticada.
- caducidad recomendada: 15 a 60 minutos segun riesgo.
- guardar auditoria: quien autorizo, quien subio fotos, fecha/hora, trabajo afectado y motivo.

### Navegacion fija / boton de seguridad

Implementado en demo:
- optimizar los botones de navegacion para que sean mas seguros y faciles de usar en pantallas tactiles.
- cuando el usuario baja con el dedo, no debe desaparecer el acceso para cambiar de pantalla.
- agregar un boton/menu persistente, tipo label o boton flotante, que al tocarlo abra el menu de secciones.
- ese boton debe permanecer visible al hacer scroll para poder cambiar rapido entre Panel, Clientes, Cleaners, Calendario, Trabajos, Links clientes, Reportes y Ajustes.
- en mobile/tablet la barra lateral actual no debe obligar al usuario a volver arriba para navegar.

### Stripe y activacion de planes

Pendiente producto real:
- reemplazar los botones de planes por Payment Links o Checkout Sessions de Stripe.
- guardar el email, plan comprado, monto, fecha y estado del pago.
- usar webhook `checkout.session.completed` para reconocer automaticamente el pago.
- crear la cuenta en estado pendiente hasta completar datos de empresa/usuario.
- mostrar al admin un panel de pagos con email, plan, referencia Stripe y accion para asignar paquete manualmente si hace falta.
- recomendacion: activar automatico cuando el pago y el email coinciden; dejar revision admin solo para casos dudosos o pagos manuales.
