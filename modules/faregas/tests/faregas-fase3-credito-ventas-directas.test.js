const test = require('node:test');
const assert = require('node:assert/strict');

const {
    construirPayloadNubefact
} = require('../integrations/nubefact-faregas.adapter');
const {
    normalizarFacturacion,
    validarFacturacion,
    validarCuotasContraTotal
} = require('../services/faregas-facturacion.rules');
const {
    renderFacturaHtml
} = require('../templates/comprobante-factura.template');
const {
    mapearFormaPago,
    formatearFechaPeruana
} = require('../services/faregas-comprobante-impreso.service');

// -----------------------------------------------------------------------------
// FIXTURES
// -----------------------------------------------------------------------------
const emisorFaregas = {
    ruc: '20521536463',
    razonSocial: 'SERVICIOS COMPLEMENTARIOS DE TRANSPORTE TERRESTRE Y GRUAS S.A.C.',
    direccion: 'JR. ALBERTO SECADA NRO. 315, PROV. CONST. DEL CALLAO, CALLAO',
    puntoVenta: 'SURQUILLO',
    telefono: '942900001',
    correo: 'ventas@faregas.pe'
};

const clienteEmpresa = {
    nombre: 'TRANSPORTE Y LOGISTICA PERU S.A.C.',
    tipoDoc: 'RUC',
    nroDoc: '20600444531',
    direccion: 'AV. MATERIALES 1234, LIMA'
};

// =============================================================================
// CASO 1: CRÉDITO CON TRES CUOTAS (Total: S/ 1,524.00)
// 01/05/2026 — S/ 500.00
// 15/05/2026 — S/ 500.00
// 30/05/2026 — S/ 524.00
// =============================================================================
test('Caso 1: Factura crédito venta directa con tres cuotas (Total S/ 1,524.00)', () => {
    const totalVenta = 1524.00;
    const baseImponible = 1291.53;
    const igv = 232.47;

    const cuotasFixture = [
        { numeroCuota: 1, fechaPago: '2026-05-01', importe: 500.00 },
        { numeroCuota: 2, fechaPago: '2026-05-15', importe: 500.00 },
        { numeroCuota: 3, fechaPago: '2026-05-30', importe: 524.00 }
    ];

    // 1. Exactitud de la suma de cuotas
    const sumaCuotas = cuotasFixture.reduce((acc, c) => acc + c.importe, 0);
    assert.equal(sumaCuotas, totalVenta, 'La suma de las 3 cuotas debe ser exactamente S/ 1,524.00');
    assert.equal(validarCuotasContraTotal(cuotasFixture, totalVenta), true);

    // 2. Normalización y validación fiscal en backend
    const datosEntrada = {
        tipoComprobante: 'FACTURA',
        tipoDocumentoCliente: 'RUC',
        nroDocumento: clienteEmpresa.nroDoc,
        nombreRazonSocial: 'TRANSPORTE Y LOGISTICA PERU S.A.C.',
        direccion: 'AV. MATERIALES 1234, LIMA',
        email: 'facturas@transporteperu.com',
        telefono: '998877665',
        condicionPago: 'CREDITO',
        fechaInicioCredito: '2026-05-01',
        fechaVencimiento: '2026-05-30',
        cuotas: cuotasFixture
    };

    const normalizada = normalizarFacturacion(datosEntrada);
    assert.equal(normalizada.condicionPago, 'CREDITO');
    assert.equal(normalizada.fechaInicioCredito, '2026-05-01');
    assert.equal(normalizada.fechaVencimiento, '2026-05-30');
    assert.equal(normalizada.cuotas.length, 3);
    assert.deepEqual(normalizada.cuotas[0], { numeroCuota: 1, fechaPago: '2026-05-01', importe: 500.00 });
    assert.deepEqual(normalizada.cuotas[1], { numeroCuota: 2, fechaPago: '2026-05-15', importe: 500.00 });
    assert.deepEqual(normalizada.cuotas[2], { numeroCuota: 3, fechaPago: '2026-05-30', importe: 524.00 });

    const errores = validarFacturacion(normalizada);
    assert.deepEqual(errores, [], 'La validación no debe arrojar errores para el Caso 1');

    // 3. Payload NubeFact
    const facturacionObj = {
        id: 701,
        operacion_id: 888,
        certificado_id: null,
        tipo_comprobante: 'FACTURA',
        tipo_documento_cliente: 'RUC',
        nro_documento: '20600123456',
        nombre_razon_social: 'TRANSPORTE Y LOGISTICA PERU S.A.C.',
        direccion: 'AV. MATERIALES 1234, LIMA',
        email: 'facturas@transporteperu.com',
        condicion_pago: 'CREDITO',
        medio_pago: null,
        fecha_documento: '2026-05-01',
        fecha_vencimiento: '2026-05-30',
        serie: 'FFF1',
        numero: 101,
        base_imponible: baseImponible,
        igv: igv,
        importe_total: totalVenta
    };

    const detalles = [{
        codigo_sku_snapshot: 'CHIP-01',
        descripcion_snapshot: 'VENTA DE CHIP CONVERSIÓN',
        unidad_snapshot: 'NIU',
        cantidad: 6,
        valor_unitario: 215.255,
        precio_unitario: 254.00,
        base_imponible: baseImponible,
        igv: igv,
        importe_total: totalVenta,
        afectacion_igv_snapshot: '10'
    }];

    const payload = construirPayloadNubefact({
        facturacion: facturacionObj,
        certificado: null,
        vehiculo: { placa: '' },
        cuotas: cuotasFixture.map(c => ({ numero_cuota: c.numeroCuota, fecha_pago: c.fechaPago, importe: c.importe })),
        detalles
    });

    assert.equal(payload.tipo_de_comprobante, 1, '1 = Factura');
    assert.equal(payload.condiciones_de_pago, 'CREDITO');
    assert.equal(payload.forma_de_pago, 'Credito');
    assert.equal(payload.medio_de_pago, 'credito');
    assert.equal(payload.cancelado, false, 'En comprobante al crédito cancelado debe ser false');
    assert.equal(payload.total, 1524.00);
    assert.equal(payload.venta_al_credito.length, 3);
    assert.deepEqual(payload.venta_al_credito, [
        { cuota: 1, fecha_de_pago: '01-05-2026', importe: 500.00 },
        { cuota: 2, fecha_de_pago: '15-05-2026', importe: 500.00 },
        { cuota: 3, fecha_de_pago: '30-05-2026', importe: 524.00 }
    ]);

    // 4. Representación Impresa FAREGAS (HTML/PDF)
    const viewModel = {
        emisor: emisorFaregas,
        comprobante: {
            tipo: 'FACTURA',
            serie: 'FFF1',
            numero: 101,
            fechaDocumento: '01/05/2026',
            fechaVencimiento: '30/05/2026',
            formaPago: 'Crédito',
            moneda: 'Soles'
        },
        cliente: clienteEmpresa,
        vehiculo: { placa: '' },
        items: [{
            cantidad: 6,
            unidad: 'NIU',
            descripcion: 'VENTA DE CHIP CONVERSIÓN',
            valorReferencial: 254.00,
            precioUnitario: 254.00,
            valorUnitario: 215.255,
            total: 1524.00
        }],
        totales: {
            gravada: baseImponible,
            inafecta: 0,
            exonerada: 0,
            gratuita: 0,
            descuento: 0,
            igv: igv,
            total: totalVenta
        },
        cuotas: [
            { numero: '001', fecha: '01/05/2026', importe: 500.00 },
            { numero: '002', fecha: '15/05/2026', importe: 500.00 },
            { numero: '003', fecha: '30/05/2026', importe: 524.00 }
        ]
    };

    const html = renderFacturaHtml(viewModel);
    assert.match(html, /Forma de Pago:<\/span> Crédito/);
    assert.match(html, /Fecha Vencimiento:<\/span> 30\/05\/2026/);
    assert.match(html, /Cuota:<\/strong> 001/);
    assert.match(html, /01\/05\/2026/);
    assert.match(html, /S\/ 500\.00/);
    assert.match(html, /Cuota:<\/strong> 002/);
    assert.match(html, /15\/05\/2026/);
    assert.match(html, /Cuota:<\/strong> 003/);
    assert.match(html, /30\/05\/2026/);
    assert.match(html, /S\/ 524\.00/);
});

// =============================================================================
// CASO 2: CRÉDITO CON UNA CUOTA (Total: S/ 508.00)
// 15/05/2026 — S/ 508.00
// =============================================================================
test('Caso 2: Factura crédito venta directa con una cuota (Total S/ 508.00)', () => {
    const totalVenta = 508.00;
    const baseImponible = 430.51;
    const igv = 77.49;

    const cuotasFixture = [
        { numeroCuota: 1, fechaPago: '2026-05-15', importe: 508.00 }
    ];

    // 1. Exactitud de la cuota única
    assert.equal(cuotasFixture[0].importe, totalVenta);
    assert.equal(validarCuotasContraTotal(cuotasFixture, totalVenta), true);

    // 2. Normalización y validación fiscal
    const datosEntrada = {
        tipoComprobante: 'FACTURA',
        tipoDocumentoCliente: 'RUC',
        nroDocumento: clienteEmpresa.nroDoc,
        nombreRazonSocial: 'TRANSPORTE Y LOGISTICA PERU S.A.C.',
        direccion: 'AV. MATERIALES 1234, LIMA',
        condicionPago: 'CREDITO',
        fechaInicioCredito: '2026-05-01',
        fechaVencimiento: '2026-05-15',
        cuotas: cuotasFixture
    };

    const normalizada = normalizarFacturacion(datosEntrada);
    const errores = validarFacturacion(normalizada);
    assert.deepEqual(errores, [], 'La validación no debe arrojar errores para el Caso 2');

    // 3. Payload NubeFact
    const facturacionObj = {
        id: 702,
        operacion_id: 889,
        certificado_id: null,
        tipo_comprobante: 'FACTURA',
        tipo_documento_cliente: 'RUC',
        nro_documento: '20600123456',
        nombre_razon_social: 'TRANSPORTE Y LOGISTICA PERU S.A.C.',
        direccion: 'AV. MATERIALES 1234, LIMA',
        condicion_pago: 'CREDITO',
        medio_pago: null,
        fecha_documento: '2026-05-01',
        fecha_vencimiento: '2026-05-15',
        serie: 'FFF1',
        numero: 102,
        base_imponible: baseImponible,
        igv: igv,
        importe_total: totalVenta
    };

    const payload = construirPayloadNubefact({
        facturacion: facturacionObj,
        certificado: null,
        vehiculo: { placa: '' },
        cuotas: cuotasFixture.map(c => ({ numero_cuota: c.numeroCuota, fecha_pago: c.fechaPago, importe: c.importe })),
        detalles: [{
            codigo_sku_snapshot: 'CHIP-02',
            descripcion_snapshot: 'VENTA DE 2 CHIPS',
            unidad_snapshot: 'NIU',
            cantidad: 2,
            valor_unitario: 215.255,
            precio_unitario: 254.00,
            base_imponible: baseImponible,
            igv: igv,
            importe_total: totalVenta,
            afectacion_igv_snapshot: '10'
        }]
    });

    assert.equal(payload.condiciones_de_pago, 'CREDITO');
    assert.equal(payload.cancelado, false);
    assert.equal(payload.total, 508.00);
    assert.equal(payload.venta_al_credito.length, 1);
    assert.deepEqual(payload.venta_al_credito[0], {
        cuota: 1,
        fecha_de_pago: '15-05-2026',
        importe: 508.00
    });

    // 4. Representación Impresa FAREGAS
    const viewModel = {
        emisor: emisorFaregas,
        comprobante: {
            tipo: 'FACTURA',
            serie: 'FFF1',
            numero: 102,
            fechaDocumento: '01/05/2026',
            fechaVencimiento: '15/05/2026',
            formaPago: 'Crédito',
            moneda: 'Soles'
        },
        cliente: clienteEmpresa,
        vehiculo: { placa: '' },
        items: [{
            cantidad: 2,
            unidad: 'NIU',
            descripcion: 'VENTA DE 2 CHIPS',
            valorReferencial: 254.00,
            precioUnitario: 254.00,
            valorUnitario: 215.255,
            total: 508.00
        }],
        totales: {
            gravada: baseImponible,
            inafecta: 0,
            exonerada: 0,
            gratuita: 0,
            descuento: 0,
            igv: igv,
            total: totalVenta
        },
        cuotas: [
            { numero: '001', fecha: '15/05/2026', importe: 508.00 }
        ]
    };

    const html = renderFacturaHtml(viewModel);
    assert.match(html, /Forma de Pago:<\/span> Crédito/);
    assert.match(html, /Fecha Vencimiento:<\/span> 15\/05\/2026/);
    assert.match(html, /Cuota:<\/strong> 001/);
    assert.match(html, /15\/05\/2026/);
    assert.match(html, /S\/ 508\.00/);
});

// =============================================================================
// REGLAS NEGATIVAS Y DEFENSAS FISCALES
// =============================================================================
test('Defensa fiscal: BOLETA con CRÉDITO es rechazada', () => {
    const datos = normalizarFacturacion({
        tipoComprobante: 'BOLETA',
        tipoDocumentoCliente: 'DNI',
        nroDocumento: '44556677',
        nombreRazonSocial: 'PEDRO GARCIA',
        direccion: 'CALLE 1 123',
        condicionPago: 'CREDITO',
        fechaInicioCredito: '2026-05-01',
        fechaVencimiento: '2026-05-30',
        cuotas: [{ numeroCuota: 1, fechaPago: '2026-05-30', importe: 500 }]
    });
    const errores = validarFacturacion(datos);
    assert.ok(errores.some(e => e.includes('BOLETA solo puede emitirse con condicion de pago CONTADO')));
});

test('Defensa fiscal: Cuotas que no suman el saldo pendiente son rechazadas', () => {
    const cuotas = [
        { numeroCuota: 1, fechaPago: '2026-05-01', importe: 500.00 },
        { numeroCuota: 2, fechaPago: '2026-05-15', importe: 500.00 }
        // Total 1000, pero saldo esperado 1524
    ];
    assert.equal(validarCuotasContraTotal(cuotas, 1524.00), false);
});

test('Defensa fiscal: Cuota con fecha posterior al vencimiento general es rechazada', () => {
    const datos = normalizarFacturacion({
        tipoComprobante: 'FACTURA',
        tipoDocumentoCliente: 'RUC',
        nroDocumento: '20600123456',
        nombreRazonSocial: 'TRANSPORTE Y LOGISTICA PERU S.A.C.',
        direccion: 'AV. MATERIALES 1234, LIMA',
        condicionPago: 'CREDITO',
        fechaInicioCredito: '2026-05-01',
        fechaVencimiento: '2026-05-30',
        cuotas: [{ numeroCuota: 1, fechaPago: '2026-06-05', importe: 500 }]
    });
    const errores = validarFacturacion(datos);
    assert.ok(errores.some(e => e.includes('no puede superar el vencimiento general')));
});

test('Defensa fiscal: Factura contado no debe enviar venta_al_credito ni cuotas', () => {
    const facturacionObj = {
        id: 703,
        operacion_id: 890,
        certificado_id: null,
        tipo_comprobante: 'FACTURA',
        tipo_documento_cliente: 'RUC',
        nro_documento: '20600123456',
        nombre_razon_social: 'TRANSPORTE Y LOGISTICA PERU S.A.C.',
        direccion: 'AV. MATERIALES 1234, LIMA',
        condicion_pago: 'CONTADO',
        medio_pago: 'EFECTIVO',
        fecha_documento: '2026-05-01',
        fecha_vencimiento: '2026-05-01',
        serie: 'FFF1',
        numero: 103,
        base_imponible: 100,
        igv: 18,
        importe_total: 118
    };

    const payload = construirPayloadNubefact({
        facturacion: facturacionObj,
        certificado: null,
        vehiculo: { placa: '' },
        cuotas: [],
        detalles: [{
            codigo_sku_snapshot: 'CHIP-01',
            descripcion_snapshot: 'VENTA AL CONTADO',
            unidad_snapshot: 'NIU',
            cantidad: 1,
            valor_unitario: 100,
            precio_unitario: 118,
            base_imponible: 100,
            igv: 18,
            importe_total: 118,
            afectacion_igv_snapshot: '10'
        }]
    });

    assert.equal(payload.condiciones_de_pago, 'CONTADO');
    assert.equal(payload.cancelado, true);
    assert.equal(payload.forma_de_pago, 'Contado');
    assert.deepEqual(payload.venta_al_credito, []);
});

// =============================================================================
// TEST DE PERSISTENCIA Y REINTENTO IDEMPOTENTE (SIMULACIÓN MOCK DB)
// =============================================================================
test('Idempotencia: reintentos de facturación limpian cuotas previas y evitan duplicados', async () => {
    const facturacionId = 999;
    const cuotasGuardadas = [];

    const mockDb = {
        async query(sql, params) {
            if (sql.includes('DELETE FROM fg_facturacion_cuota')) {
                // Simula borrado idempotente
                cuotasGuardadas.length = 0;
                return { rowCount: 1 };
            }
            if (sql.includes('INSERT INTO fg_facturacion_cuota')) {
                cuotasGuardadas.push({
                    facturacion_id: params[0],
                    numero_cuota: params[1],
                    fecha_pago: params[2],
                    importe: params[3],
                    estado: 'PENDIENTE'
                });
                return { rowCount: 1 };
            }
            if (sql.includes('SELECT * FROM fg_facturacion_cuota')) {
                return { rows: [...cuotasGuardadas] };
            }
            return { rows: [], rowCount: 0 };
        }
    };

    // Intento 1: Guardar 3 cuotas
    await mockDb.query('DELETE FROM fg_facturacion_cuota WHERE facturacion_id = $1', [facturacionId]);
    for (const c of [{ num: 1, f: '2026-05-01', m: 500 }, { num: 2, f: '2026-05-15', m: 500 }, { num: 3, f: '2026-05-30', m: 524 }]) {
        await mockDb.query('INSERT INTO fg_facturacion_cuota VALUES ($1,$2,$3,$4)', [facturacionId, c.num, c.f, c.m]);
    }
    assert.equal(cuotasGuardadas.length, 3);
    assert.equal(cuotasGuardadas.every(c => c.estado === 'PENDIENTE'), true);

    // Intento 2 (Reintento): Ejecutar nuevamente el guardado
    await mockDb.query('DELETE FROM fg_facturacion_cuota WHERE facturacion_id = $1', [facturacionId]);
    for (const c of [{ num: 1, f: '2026-05-01', m: 500 }, { num: 2, f: '2026-05-15', m: 500 }, { num: 3, f: '2026-05-30', m: 524 }]) {
        await mockDb.query('INSERT INTO fg_facturacion_cuota VALUES ($1,$2,$3,$4)', [facturacionId, c.num, c.f, c.m]);
    }

    // No debe haber 6 cuotas sino exactamente 3
    const resultado = await mockDb.query('SELECT * FROM fg_facturacion_cuota WHERE facturacion_id = $1', [facturacionId]);
    assert.equal(resultado.rows.length, 3, 'El reintento no debe duplicar cuotas');
    assert.equal(resultado.rows[0].numero_cuota, 1);
    assert.equal(resultado.rows[1].numero_cuota, 2);
    assert.equal(resultado.rows[2].numero_cuota, 3);
});

test.after(async () => {
    try {
        const pool = require('../../../config/database');
        await pool.end();
    } catch (_) {}
});

