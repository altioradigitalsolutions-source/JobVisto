# User Flows

## Flujo 1: Cleaner independiente

### 1. Registro

El cleaner entra a JobVisto y puede:
- Crear cuenta con email y contrasena.
- Entrar con Google.

Si crea cuenta con email:
1. Ingresa nombre, email y contrasena.
2. El sistema envia email de verificacion.
3. El usuario abre el email.
4. Hace clic en confirmar.
5. La cuenta queda activa.
6. Luego puede iniciar sesion con email y contrasena.

Si entra con Google:
1. Presiona "Continuar con Google".
2. Autoriza la cuenta.
3. El sistema crea o abre su cuenta automaticamente.

### 2. Configuracion inicial

Despues del primer ingreso, el cleaner configura:
- idioma,
- pais,
- moneda,
- zona horaria,
- nombre comercial opcional,
- telefono,
- metodo preferido de notificaciones.

No debe ser largo. Debe sentirse rapido.

### 3. Clientes

El cleaner independiente puede crear clientes.

Datos del cliente:
- nombre,
- telefono,
- email,
- direccion,
- notas de acceso,
- idioma preferido,
- metodo de notificacion preferido.

### 4. Crear trabajo

El cleaner crea un trabajo con:
- cliente,
- direccion,
- fecha,
- hora de inicio,
- hora estimada de finalizacion,
- tipo de limpieza,
- tarifa por hora o precio fijo,
- metodo esperado de pago,
- notas,
- checklist,
- si se enviaran notificaciones al cliente.

Metodos de pago informativos:
- efectivo,
- transferencia,
- PayPal,
- Zelle,
- tarjeta,
- otro.

Importante:
El sistema no cobra ni procesa este pago. Solo registra el metodo esperado o acordado.

### 5. Calendario

El independiente debe ver sus trabajos en calendario.

Opciones:
- Calendario propio dentro de JobVisto.
- Sincronizacion futura con Google Calendar.

Recomendacion MVP:
Crear calendario propio primero. Luego agregar integracion con Google Calendar.

Vista del calendario:
- dia,
- semana,
- mes,
- lista de proximos trabajos.

### 6. Recordatorios

Si el plan lo permite, el sistema envia recordatorios.

Al cleaner:
- "Manana tienes 3 trabajos."
- "Primer trabajo: 08:00, Casa Cohen."
- "Segundo trabajo: 13:00, Oficina North."

Al cliente:
- "Manana tienes limpieza con Maria a las 08:00."
- "Tu cleaner llegara a la direccion registrada."

Canales futuros:
- email,
- WhatsApp,
- SMS,
- push notification.

Recomendacion MVP:
Email primero. WhatsApp despues como funcion paga o plan Pro.

### 7. Dia del trabajo

El cleaner abre el trabajo desde telefono.

Ve:
- cliente,
- direccion,
- horario,
- notas,
- checklist,
- boton "Llegue".

Cuando presiona "Llegue":
- se registra hora real,
- se guarda GPS aproximado,
- se notifica al cliente si esta activado.

### 8. Durante el trabajo

El cleaner puede:
- marcar tareas del checklist,
- subir fotos,
- escribir observaciones,
- reportar incidencia.

### 9. Finalizar trabajo

Al terminar:
1. Presiona "Termine".
2. Se registra hora real de salida.
3. Se calculan horas trabajadas.
4. Se calcula monto estimado.
5. Se genera resumen.

### 10. Firma del cliente

El cliente puede firmar en el telefono del cleaner o desde link privado.

Debe incluir:
- nombre de quien firma,
- firma digital,
- fecha y hora,
- resumen del servicio.

Tambien puede existir boton alternativo:
- "Confirmo servicio completado".

### 11. Link privado del cliente

Cada trabajo genera un link privado para el cliente.

El cliente puede ver:
- hora de llegada,
- hora de salida,
- fotos,
- checklist,
- notas,
- firma o confirmacion,
- resumen del trabajo.

No necesita crear cuenta.

### 12. Reportes del independiente

El cleaner ve:
- trabajos de hoy,
- trabajos de manana,
- horas trabajadas,
- ingresos estimados,
- clientes frecuentes,
- historial mensual,
- trabajos pendientes de firma.

## Flujo 2: Empresa

Pendiente de detallar despues.

Debe incluir:
- registro de empresa,
- invitacion de cleaners,
- clientes,
- trabajos,
- calendario,
- reportes,
- firma del cliente,
- pago externo registrado,
- firma del cleaner por pago recibido.

