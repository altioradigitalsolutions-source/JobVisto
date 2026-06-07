# Payment Proof Module

## Nombre funcional

Comprobante de pago recibido.

## Importante

Este modulo no mueve dinero. Solo registra que la empresa pago por fuera del sistema y que el cleaner firmo que recibio.

## Usuario

Solo modo empresa.

No aplica al cleaner independiente, porque el independiente cobra a sus propios clientes por fuera y no necesita registrar pagos a empleados.

## Flujo

1. La empresa abre el panel de pagos.
2. Ve cuanto se debe a cada cleaner por periodo.
3. Selecciona un cleaner.
4. Presiona "Registrar pago".
5. Ingresa:
   - monto pagado,
   - metodo de pago,
   - fecha,
   - periodo cubierto,
   - nota opcional.
6. El cleaner firma digitalmente.
7. El cleaner escribe su nombre.
8. El sistema guarda comprobante.
9. El estado cambia a "Pagado".

## Metodos de pago permitidos

- Efectivo.
- Transferencia.
- PayPal.
- Zelle.
- Tarjeta.
- Cheque.
- Otro.

## Datos guardados

- ID del cleaner.
- ID de empresa.
- Monto.
- Moneda.
- Metodo.
- Fecha de pago.
- Periodo.
- Firma digital.
- Nombre escrito por quien firma.
- Usuario admin que registro el pago.
- Fecha/hora de registro.

## Valor comercial

Este modulo protege a la empresa y reduce discusiones:
- "No me pagaron."
- "Si te pagamos."
- "Cuanto era?"
- "Fue efectivo?"

El sistema deja constancia interna.

## Pricing

Debe estar en plan empresa pago, idealmente Pro. No regalarlo en el plan mas bajo porque tiene alto valor operativo.

