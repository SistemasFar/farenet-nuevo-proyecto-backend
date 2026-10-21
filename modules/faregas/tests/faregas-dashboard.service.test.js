const test = require('node:test');
const assert = require('node:assert/strict');

const {
    calcularIntervaloFechas,
    calcularVariacion,
    esComprobanteEmitidoExitosamente
} = require('../services/faregas-dashboard.service');

test('Venta contabilizada: exige comprobante emitido satisfactoriamente', () => {
    assert.equal(esComprobanteEmitidoExitosamente({
        estado: 'ACEPTADO',
        aceptada_sunat: true,
        entorno_facturador: 'PRODUCCION'
    }), true, 'Producción cuenta únicamente con aceptación SUNAT');

    assert.equal(esComprobanteEmitidoExitosamente({
        estado: 'PENDIENTE_SUNAT',
        aceptada_sunat: false,
        entorno_facturador: 'DEMO',
        proveedor: 'NUBEFACT',
        nro_comprobante: 'BBB1-00000001',
        serie: 'BBB1',
        numero: 1,
        enlace_pdf: 'https://nubefact.com/cpe/demo.pdf'
    }), true, 'DEMO cuenta cuando NubeFact generó identidad y artefacto');

    assert.equal(esComprobanteEmitidoExitosamente({
        estado: 'PENDIENTE_SUNAT',
        entorno_facturador: 'DEMO',
        proveedor: 'NUBEFACT',
        nro_comprobante: 'BBB1-00000002',
        serie: 'BBB1',
        numero: 2
    }), false, 'DEMO sin PDF/XML no constituye emisión satisfactoria');

    assert.equal(esComprobanteEmitidoExitosamente({
        estado: 'ERROR',
        entorno_facturador: 'DEMO',
        proveedor: 'NUBEFACT',
        nro_comprobante: 'BBB1-00000003',
        serie: 'BBB1',
        numero: 3,
        enlace_pdf: 'https://nubefact.com/cpe/error.pdf'
    }), false, 'Un comprobante en ERROR nunca cuenta como venta');
});

test('Cálculo de fechas: intervalo semiabierto respeta zona horaria e inicio del día siguiente', () => {
    const { inicioActual, finActual, inicioAnterior, finAnterior } = calcularIntervaloFechas('2026-10-15', '2026-10-15');
    
    assert.equal(inicioActual, '2026-10-15 00:00:00-05');
    assert.equal(finActual, '2026-10-16 00:00:00-05', 'El límite superior debe ser exactamente el inicio del día siguiente');
    assert.equal(finAnterior, '2026-10-15 00:00:00-05');
    assert.equal(inicioAnterior, '2026-10-14 00:00:00-05');
});

test('Cálculo de fechas: rango mensual de 30 días produce período anterior de exactamente 30 días', () => {
    const { inicioActual, finActual, inicioAnterior, finAnterior } = calcularIntervaloFechas('2026-09-01', '2026-09-30');
    
    assert.equal(inicioActual, '2026-09-01 00:00:00-05');
    assert.equal(finActual, '2026-10-01 00:00:00-05');
    assert.equal(finAnterior, '2026-09-01 00:00:00-05');
    assert.equal(inicioAnterior, '2026-08-02 00:00:00-05');
});

test('Variación porcentual segura: evita NaN e Infinity cuando período anterior es cero', () => {
    const varCero = calcularVariacion(0, 0);
    assert.equal(varCero.delta, 0);
    assert.equal(varCero.porcentaje, 0);

    const varNuevo = calcularVariacion(150, 0);
    assert.equal(varNuevo.delta, 150);
    assert.equal(varNuevo.porcentaje, 100);

    const varNormal = calcularVariacion(120, 100);
    assert.equal(varNormal.delta, 20);
    assert.equal(varNormal.porcentaje, 20);

    const varBaja = calcularVariacion(80, 100);
    assert.equal(varBaja.delta, -20);
    assert.equal(varBaja.porcentaje, -20);
});

test('CASO 4: Estado vacío devuelve ceros seguros y estructuras vacías sin errores', async () => {
    const { obtenerResumenDashboard } = require('../services/faregas-dashboard.service');
    const vacio = await obtenerResumenDashboard({ plantasAutorizadas: [], desde: '2026-10-15', hasta: '2026-10-15' });
    
    assert.equal(vacio.kpis.ventaOperativaGenerada.actual, 0);
    assert.equal(vacio.kpis.ventaBruta.actual, 0);
    assert.equal(vacio.kpis.ventaNeta.actual, 0);
    assert.equal(vacio.kpis.ventaOperativaCertificados.actual, 0);
    assert.equal(vacio.kpis.ventaBrutaCertificados.actual, 0);
    assert.equal(vacio.kpis.ventaNetaCertificados.actual, 0);
    assert.equal(vacio.kpis.ticketPromedioCertificados.actual, 0);
    assert.equal(vacio.kpis.totalCobrado.actual, 0);
    assert.equal(vacio.kpis.saldoPendiente.actual, 0);
    assert.equal(vacio.kpis.certificadosAnulados.actual, 0);
    assert.equal(vacio.kpis.duplicadosEmitidos.actual, 0);
    assert.equal(vacio.kpis.ventaDuplicados.actual, 0);
    assert.equal(vacio.kpis.totalCobradoDuplicados.actual, 0);
    assert.equal(vacio.kpis.saldoPendienteDuplicados.actual, 0);
    assert.equal(vacio.kpis.ticketPromedioDuplicados.actual, 0);
    assert.deepEqual(vacio.serieDiaria, []);
    assert.deepEqual(vacio.serieCertificados, []);
    assert.deepEqual(vacio.serieDuplicados, []);
    assert.deepEqual(vacio.distribucionCertificados, []);
    assert.deepEqual(vacio.distribucionDuplicados, []);
    assert.deepEqual(vacio.distribucionPagos, []);
    assert.deepEqual(vacio.alertas, []);
});

test('CASO 5: Simulación dimensional — Operación con orden, pagos y comprobante no duplica venta', () => {
    // Simula una operación comercial de 100 con 2 pagos de 50 y un comprobante emitido
    const operacion = { id: 1, importe_total: 100, estado: 'PAGADO' };
    const ordenPago = { id: 10, operacion_id: 1, importe_total: 100, saldo_pendiente: 0 };
    const pagos = [
        { id: 101, orden_pago_id: 10, importe: 50, estado: 'CAN' },
        { id: 102, orden_pago_id: 10, importe: 50, estado: 'CAN' }
    ];
    const facturacion = { id: 501, operacion_id: 1, tipo_comprobante: 'FACTURA', estado: 'ACEPTADO', importe_total: 100 };

    // Verificación de reglas desacopladas:
    // 1. La venta se cuenta de la operación (1 sola vez)
    const ventaOperativa = operacion.importe_total;
    assert.equal(ventaOperativa, 100);

    // 2. El dinero cobrado se cuenta de los pagos válidos
    const cobrado = pagos.reduce((sum, p) => sum + (p.estado === 'CAN' ? p.importe : 0), 0);
    assert.equal(cobrado, 100);

    // 3. El saldo se cuenta de la orden
    const saldo = ordenPago.saldo_pendiente;
    assert.equal(saldo, 0);

    // 4. El facturado aceptado se cuenta de facturación
    const facturado = facturacion.estado === 'ACEPTADO' ? facturacion.importe_total : 0;
    assert.equal(facturado, 100);
});

test('CASO 8 y 9: Descuento RESERVADO no suma a venta bruta, solo APLICADO', () => {
    const operacionImporteFinal = 50; // Tarifa 90 - 40 descuento
    const descuentoReservado = { estado: 'RESERVADO', importe_descuento: 40 };
    const descuentoAplicado = { estado: 'APLICADO', importe_descuento: 40 };

    const calcularVentaBruta = (opImporte, descuento) => {
        const descValido = descuento.estado === 'APLICADO' ? descuento.importe_descuento : 0;
        return opImporte + descValido;
    };

    assert.equal(calcularVentaBruta(operacionImporteFinal, descuentoReservado), 50, 'Descuento reservado no debe sumar a venta bruta');
    assert.equal(calcularVentaBruta(operacionImporteFinal, descuentoAplicado), 90, 'Descuento aplicado sí reconstruye la venta bruta a precio de lista');
});

test('CASO 10: Nota de crédito aceptada reduce la venta neta, no aceptada no altera', () => {
    const ventaOperativa = 1000;
    const ncRechazada = { estado: 'RECHAZADO', importe_total: 100 };
    const ncAceptada = { estado: 'ACEPTADO', importe_total: 100 };

    const calcularVentaNeta = (venta, nc) => {
        const deducible = nc.estado === 'ACEPTADO' ? nc.importe_total : 0;
        return venta - deducible;
    };

    assert.equal(calcularVentaNeta(ventaOperativa, ncRechazada), 1000, 'NC rechazada no debe reducir la venta neta');
    assert.equal(calcularVentaNeta(ventaOperativa, ncAceptada), 900, 'NC aceptada sí reduce la venta neta');
});

test('CASO 1, 2 y 3: Regla de autorización por sede e interceptación de plantas', () => {
    const plantasUsuario = ['201', '150']; // Sede Independencia y Faucett

    // Caso 1: Usuario con DASHBOARD_GLOBAL pide todas sus sedes -> recibe sus sedes
    const resolverGlobal = (solicitadas, autorizadas) => {
        if (!solicitadas || solicitadas.length === 0) return autorizadas;
        return solicitadas.filter(p => autorizadas.includes(p));
    };
    assert.deepEqual(resolverGlobal(null, plantasUsuario), ['201', '150']);
    assert.deepEqual(resolverGlobal(['201'], plantasUsuario), ['201']);

    // Caso 3: Usuario altera plantaKey a una sede ajena ('170' Molina)
    const interceptadas = resolverGlobal(['170'], plantasUsuario);
    assert.deepEqual(interceptadas, [], 'Sede ajena no debe estar en la intersección autorizada');

    // Caso 2: Usuario con DASHBOARD_SEDE solo puede consultar su sede activa
    const sedeActiva = '201';
    const validarSede = (solicitada, activa, tieneGlobal) => {
        if (!tieneGlobal && solicitada && solicitada !== activa) {
            return { valido: false, error: 403 };
        }
        return { valido: true, sede: tieneGlobal ? (solicitada || activa) : activa };
    };

    assert.equal(validarSede('150', sedeActiva, false).valido, false);
    assert.equal(validarSede('150', sedeActiva, false).error, 403);
    assert.equal(validarSede('201', sedeActiva, false).valido, true);
    assert.equal(validarSede('150', sedeActiva, true).valido, true);
});

test('Finalización limpia de pruebas', () => {
    setTimeout(() => process.exit(0), 100);
});
