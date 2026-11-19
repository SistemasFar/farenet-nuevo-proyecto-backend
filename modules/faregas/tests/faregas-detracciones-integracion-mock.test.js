const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { evaluarDetraccion, aplicarDetraccionPayloadNubefact } = require('../services/faregas-detracciones.service');
const facturacionService = require('../services/faregas-facturacion.service');
const columnaCompat = require('../services/faregas-columna-compat.service');
const pagosRules = require('../services/faregas-pagos.rules');
const ventaDirectaService = require('../services/faregas-venta-directa-canonica.service');
const ventaDirectaValidacionService = require('../services/faregas-venta-directa-validacion.service');
const authService = require('../services/faregas-auth.service');
const db = require('../../../config/database');

const spot037 = { sujeto_detraccion: true, detraccion_codigo: '037', detraccion_porcentaje: 12 };

describe('Integración simulada SPOT FAREGAS (sin PostgreSQL ni NubeFact)', () => {
    beforeEach(() => columnaCompat._limpiarCacheColumnas());

    it('conserva boleta ordinaria de S/ 1,260 sin SPOT y exige pagar el total', () => {
        const resultado = evaluarDetraccion({ tipoComprobante: 'BOLETA', importeTotal: 1260, servicio: spot037 });
        assert.equal(resultado.sujeto, false);
        assert.equal(resultado.neto, 1260);
        assert.equal(resultado.motivoExclusion, 'BOLETA_VENTA_CONSUMIDOR_FINAL_NO_SUJETA');
    });

    it('calcula factura sujeta de S/ 1,260 como detracción S/ 151 y neto S/ 1,109', () => {
        const resultado = evaluarDetraccion({ tipoComprobante: 'FACTURA', importeTotal: 1260, servicio: spot037 });
        assert.deepEqual(
            { sujeto: resultado.sujeto, codigo: resultado.codigo, porcentaje: resultado.porcentaje, monto: resultado.monto, neto: resultado.neto, estado: resultado.estadoDeposito },
            { sujeto: true, codigo: '037', porcentaje: 12, monto: 151, neto: 1109, estado: 'PENDIENTE' }
        );
    });

    it('exige una cuenta de detracciones válida del emisor sólo cuando la factura está sujeta a SPOT', () => {
        const validarCuenta = facturacionService._private.validarCuentaDetraccionEmisor;
        const evaluacionSujeta = { sujeto: true };

        assert.doesNotThrow(() => validarCuenta(evaluacionSujeta, { cuentaBancoNacion: '01234567890' }));
        assert.throws(
            () => validarCuenta(evaluacionSujeta, { cuentaBancoNacion: '' }),
            (error) => error.code === 'CUENTA_BANCO_NACION_DETRACCION_FALTANTE' && error.statusCode === 409
        );
        assert.throws(
            () => validarCuenta(evaluacionSujeta, { cuentaBancoNacion: '0012345678901' }),
            (error) => error.code === 'CUENTA_BANCO_NACION_DETRACCION_INVALIDA' && error.statusCode === 409
        );
        assert.doesNotThrow(() => validarCuenta({ sujeto: false }, { cuentaBancoNacion: '' }));
    });

    it('separa el umbral comercial inclusivo de S/ 700 del umbral legal estricto de servicios', () => {
        const bajo = evaluarDetraccion({ tipoComprobante: 'FACTURA', importeTotal: 699, servicio: spot037 });
        assert.equal(bajo.sujeto, false);
        assert.equal(bajo.estadoEvaluacionSpot, 'BAJO_UMBRAL_COMERCIAL');
        assert.equal(bajo.umbralComercialAlcanzado, false);

        const limite = evaluarDetraccion({ tipoComprobante: 'FACTURA', importeTotal: 700, servicio: spot037 });
        assert.equal(limite.sujeto, false);
        assert.equal(limite.estadoEvaluacionSpot, 'CLASIFICADA_SIN_UMBRAL_LEGAL');
        assert.equal(limite.umbralComercialAlcanzado, true);

        const pendienteEnLimite = evaluarDetraccion({ tipoComprobante: 'FACTURA', importeTotal: 700 });
        assert.equal(pendienteEnLimite.requiereRevision, true);
        assert.equal(pendienteEnLimite.estadoEvaluacionSpot, 'CLASIFICACION_PENDIENTE');

        const sobreLimite = evaluarDetraccion({ tipoComprobante: 'FACTURA', importeTotal: 701, servicio: spot037 });
        assert.equal(sobreLimite.monto, 84);
        assert.equal(evaluarDetraccion({
            tipoComprobante: 'FACTURA', importeTotal: 1260,
            servicio: { sujeto_detraccion: false, detraccion_codigo: null, detraccion_porcentaje: null }
        }).motivoExclusion, 'SERVICIO_EXCLUIDO_POR_CONFIGURACION');
    });

    it('permite configurar el umbral comercial sin suprimir la regla legal de servicios', () => {
        const anterior = process.env.FAREGAS_SPOT_UMBRAL_COMERCIAL;
        try {
            process.env.FAREGAS_SPOT_UMBRAL_COMERCIAL = '1000';
            const sobreUmbralLegal = evaluarDetraccion({ tipoComprobante: 'FACTURA', importeTotal: 800, servicio: spot037 });
            assert.equal(sobreUmbralLegal.sujeto, true);
            assert.equal(sobreUmbralLegal.umbralComercialAlcanzado, false);
            assert.equal(sobreUmbralLegal.monto, 96);

            process.env.FAREGAS_SPOT_UMBRAL_COMERCIAL = '600';
            const bajoUmbralLegal = evaluarDetraccion({ tipoComprobante: 'FACTURA', importeTotal: 650, servicio: spot037 });
            assert.equal(bajoUmbralLegal.sujeto, false);
            assert.equal(bajoUmbralLegal.umbralComercialAlcanzado, true);
            assert.equal(bajoUmbralLegal.estadoEvaluacionSpot, 'CLASIFICADA_SIN_UMBRAL_LEGAL');
        } finally {
            if (anterior === undefined) delete process.env.FAREGAS_SPOT_UMBRAL_COMERCIAL;
            else process.env.FAREGAS_SPOT_UMBRAL_COMERCIAL = anterior;
        }
    });

    it('no aplica detracción a chips no sujetos y bloquea bases mixtas no verificables', () => {
        const productoNoSujeto = { tipo_item: 'PRODUCTO', productoSpot: { sujeto_detraccion: false } };
        const chip = evaluarDetraccion({
            tipoComprobante: 'FACTURA', importeTotal: 1080, items: Array.from({ length: 6 }, () => productoNoSujeto)
        });
        assert.equal(chip.sujeto, false);
        assert.equal(chip.monto, 0);
        assert.equal(chip.neto, 1080);
        assert.equal(chip.motivoExclusion, 'BIEN_MUEBLE_NO_SUJETO_A_SPOT');

        const mixta = evaluarDetraccion({
            tipoComprobante: 'FACTURA', importeTotal: 1260, servicio: spot037,
            items: [{ tipo_item: 'SERVICIO' }, { tipo_item: 'PRODUCTO', productoSpot: { sujeto_detraccion: false } }]
        });
        assert.equal(mixta.requiereRevision, true);
        assert.equal(mixta.motivoExclusion, 'CONCEPTOS_MIXTOS_REQUIEREN_REVISION');
        assert.equal(mixta.sujeto, false);
    });

    it('rechaza servicio sin clasificación comprobada, sin asumir 037/12%', () => {
        const resultado = evaluarDetraccion({ tipoComprobante: 'FACTURA', importeTotal: 1260 });
        assert.equal(resultado.requiereRevision, true);
        assert.equal(resultado.motivoExclusion, 'CLASIFICACION_SPOT_NO_VERIFICADA');
    });

    it('evalúa los productos según fg_producto_facturacion, no como servicios', () => {
        const productos = (sujeto_detraccion, detraccion_codigo = null, detraccion_porcentaje = null) => [{
            tipo_item: 'PRODUCTO',
            productoSpot: { sujeto_detraccion, detraccion_codigo, detraccion_porcentaje }
        }];
        const noSujeto = evaluarDetraccion({
            tipoComprobante: 'FACTURA', importeTotal: 1080, items: productos(false)
        });
        assert.equal(noSujeto.sujeto, false);
        assert.equal(noSujeto.monto, 0);
        assert.equal(noSujeto.neto, 1080);
        assert.equal(noSujeto.requiereRevision, false);

        const pendiente = evaluarDetraccion({
            tipoComprobante: 'FACTURA', importeTotal: 1080, items: productos(null)
        });
        assert.equal(pendiente.requiereRevision, true);
        assert.equal(pendiente.motivoExclusion, 'CLASIFICACION_SPOT_NO_VERIFICADA');

        const bienSujeto = evaluarDetraccion({
            tipoComprobante: 'FACTURA', importeTotal: 1080, items: productos(true, '007', 10)
        });
        assert.equal(bienSujeto.sujeto, true);
        assert.equal(bienSujeto.monto, 108);
        assert.equal(bienSujeto.neto, 972);
        const payloadBien = aplicarDetraccionPayloadNubefact({ total: 1080 }, bienSujeto);
        assert.equal(payloadBien.total, 1080);
        assert.equal(payloadBien.detraccion_tipo, 7);
        assert.equal(payloadBien.detraccion_porcentaje, 10);
        assert.equal(payloadBien.detraccion_total, 108);

        const codigoServicioEnProducto = evaluarDetraccion({
            tipoComprobante: 'FACTURA', importeTotal: 1080, items: productos(true, '037', 12)
        });
        assert.equal(codigoServicioEnProducto.requiereRevision, true);
        assert.equal(codigoServicioEnProducto.sujeto, false);
    });

    it('bloquea factura > S/ 700 si la base no permite verificar ni persistir SPOT, pero no cambia boletas', async () => {
        const fakeClient = { query: async (sql) => {
            if (sql.includes('information_schema.columns')) return { rowCount: 0, rows: [] };
            throw new Error(`No debía ejecutar SQL no compatible con el esquema: ${sql}`);
        } };
        await assert.rejects(
            facturacionService._private.sincronizarDetraccionFacturacion(fakeClient, 45, {
                tipoComprobante: 'FACTURA', importeTotal: 1260
            }),
            (error) => error.code === 'CLASIFICACION_SPOT_NO_VERIFICADA' && error.statusCode === 409
        );
        const boleta = await facturacionService._private.sincronizarDetraccionFacturacion(fakeClient, 46, {
            tipoComprobante: 'BOLETA', importeTotal: 1260
        });
        assert.equal(boleta.sujeto, false);
        assert.equal(boleta.neto, 1260);
    });

    it('guarda el pago completo de un certificado sin depender de operacionId y confirma la transacción', async () => {
        for (const columna of ['sujeto_detraccion', 'detraccion_codigo', 'detraccion_porcentaje']) {
            columnaCompat._forzarColumnaCache('fg_servicio', columna, true);
        }
        columnaCompat._forzarColumnaCache('fg_facturacion', 'sujeto_detraccion', true);

        const originalConnect = db.connect;
        const originalQuery = db.query;
        const eventos = [];
        const facturacion = {
            id: 501, certificado_id: 77, operacion_id: null, tipo_comprobante: 'BOLETA',
            tipo_documento_cliente: 'DNI', nro_documento: '12345678', nombre_razon_social: 'CLIENTE PRUEBA',
            moneda_key: 'PEN', base_imponible: 67.8, igv: 12.2, importe_total: 80,
            condicion_pago: 'CONTADO', estado: 'BORRADOR', usuario_creacion: 'test'
        };
        const client = {
            query: async (sql) => {
                const statement = sql.replace(/\s+/g, ' ').trim().toUpperCase();
                eventos.push(statement.startsWith('UPDATE FG_FACTURACION F SET') ? 'SNAPSHOT' : statement.split(' ')[0]);
                if (statement === 'BEGIN' || statement === 'COMMIT' || statement === 'ROLLBACK') {
                    return { rowCount: 0, rows: [] };
                }
                if (statement.startsWith('SELECT C.*')) {
                    return { rowCount: 1, rows: [{ id: 77, estado: 'BORRADOR', planta_key: 'SURCO' }] };
                }
                if (statement.startsWith('SELECT * FROM FG_ORDEN_PAGO WHERE CERTIFICADO_ID')) {
                    return { rowCount: 1, rows: [{
                        id: 91, estado: 'PAGADO', saldo_pendiente: 0, importe_total: 80,
                        baseimponible: 67.8, igv: 12.2, moneda_key: 'PEN', operacion_id: null
                    }] };
                }
                if (statement.startsWith('SELECT P.TIPOCONTADO_KEY')) return { rowCount: 1, rows: [{ tipocontado_key: 'efectivo', importe: 80 }] };
                if (statement.startsWith('SELECT * FROM FG_FACTURACION WHERE CERTIFICADO_ID')) return { rowCount: 0, rows: [] };
                if (statement.startsWith('INSERT INTO FG_FACTURACION')) return { rowCount: 1, rows: [facturacion] };
                if (statement.includes('FROM FG_FACTURACION F')) {
                    return { rowCount: 1, rows: [{
                        sujeto_detraccion: false, detraccion_codigo: null, detraccion_porcentaje: null
                    }] };
                }
                if (statement.startsWith('UPDATE FG_FACTURACION SET')) return { rowCount: 1, rows: [] };
                if (statement.startsWith('DELETE FROM')) return { rowCount: 0, rows: [] };
                if (statement.startsWith('UPDATE FG_ORDEN_PAGO SET')) return { rowCount: 1, rows: [] };
                if (statement.startsWith('UPDATE FG_DESCUENTOCOMPROBANTE')) return { rowCount: 0, rows: [] };
                if (statement.startsWith('UPDATE FG_FACTURACION F SET')) return { rowCount: 1, rows: [facturacion] };
                if (statement.startsWith('SELECT ID, TIPO_DOCUMENTO')) return { rowCount: 1, rows: [{
                    id: 12, tipo_documento: 'DNI', nro_documento: '12345678',
                    nombre_razon_social: 'CLIENTE PRUEBA'
                }] };
                throw new Error(`Consulta no prevista en el mock transaccional: ${statement}`);
            },
            release: () => eventos.push('RELEASE')
        };

        db.connect = async () => client;
        db.query = async (sql) => {
            const statement = sql.replace(/\s+/g, ' ').trim().toUpperCase();
            if (statement.includes('FG_PERFIL_PERMISO')) return { rows: [] };
            if (statement.includes('FG_USUARIO_PLANTA')) return { rows: [{ key: 'SURCO', nombre: 'SURCO' }] };
            if (statement.startsWith('SELECT * FROM FG_FACTURACION_CUOTA')) return { rows: [] };
            throw new Error(`Consulta de pool no prevista en el mock: ${statement}`);
        };

        try {
            const guardada = await facturacionService.guardarFacturacion(77, {
                tipoComprobante: 'BOLETA', tipoDocumentoCliente: 'DNI', nroDocumento: '12345678',
                nombreRazonSocial: 'Cliente Prueba', condicionPago: 'CONTADO'
            }, { username: 'test', perfil_id: 'TEST' });

            assert.equal(guardada.id, 501);
            assert.equal(guardada.importeTotal, 80);
            assert.equal(eventos.includes('COMMIT'), true);
            assert.equal(eventos.includes('ROLLBACK'), false);
            assert.equal(eventos.includes('RELEASE'), true);
        } finally {
            db.connect = originalConnect;
            db.query = originalQuery;
            columnaCompat._limpiarCacheColumnas();
        }
    });

    it('guarda en facturación la misma evaluación que valida pagos y usa el payload NubeFact mock', async () => {
        const { tieneColumna } = columnaCompat;
        for (const columna of ['sujeto_detraccion', 'detraccion_codigo', 'detraccion_porcentaje']) {
            columnaCompat._forzarColumnaCache('fg_servicio', columna, true);
        }
        for (const columna of ['sujeto_detraccion', 'detraccion_constancia_nro']) {
            columnaCompat._forzarColumnaCache('fg_facturacion', columna, true);
        }
        const llamadasUpdate = [];
        const fakeClient = {
            query: async (sql, params = []) => {
                if (sql.includes('information_schema.columns')) return { rowCount: 1, rows: [{ '?column?': 1 }] };
                if (sql.includes('FROM fg_facturacion f')) return { rowCount: 1, rows: [spot037] };
                if (sql.includes('UPDATE fg_facturacion SET')) {
                    llamadasUpdate.push(params);
                    return { rowCount: 1, rows: [] };
                }
                throw new Error(`Consulta inesperada en mock: ${sql}`);
            }
        };
        const evalGuardada = await facturacionService._private.sincronizarDetraccionFacturacion(fakeClient, 44, {
            tipoComprobante: 'FACTURA', importeTotal: 1260, moneda: 'PEN'
        });
        assert.equal(llamadasUpdate.length, 1);
        assert.deepEqual(llamadasUpdate[0].slice(0, 8), [true, '037', 'Demás servicios gravados con el IGV', 12, 1260, 151, 1109, 'PENDIENTE']);

        const payload = aplicarDetraccionPayloadNubefact({ total: 1260 }, evalGuardada);
        assert.equal(payload.total, 1260);
        assert.equal(payload.detraccion, true);
        assert.equal(payload.detraccion_tipo, 35);
        assert.equal(payload.detraccion_total, 151);
        assert.equal(payload.medio_de_pago_detraccion, '001');

        const pagos = pagosRules.normalizarPagos([
            { tipo: 'efectivo', importe: 500 }, { tipo: 'efectivo', importe: 609 }
        ]);
        assert.deepEqual(pagos, [{ tipo: 'efectivo', importe: 1109 }]);
        assert.equal(Number(evalGuardada.neto), pagos.reduce((sum, p) => sum + p.importe, 0));
        assert.equal(typeof tieneColumna, 'function');
    });

    it('sincroniza una venta directa de chips con la clasificación fiscal del producto real', async () => {
        for (const columna of ['sujeto_detraccion', 'detraccion_codigo', 'detraccion_porcentaje']) {
            columnaCompat._forzarColumnaCache('fg_facturacion', columna, true);
            columnaCompat._forzarColumnaCache('fg_servicio', columna, true);
            columnaCompat._forzarColumnaCache('fg_producto_facturacion', columna, true);
        }
        const updates = [];
        const fakeClient = { query: async (sql, params = []) => {
            if (sql.includes('FROM fg_operacion_detalle od')) return {
                rowCount: 1,
                rows: [{ tipo_item: 'PRODUCTO', sujeto_detraccion: false, detraccion_codigo: null, detraccion_porcentaje: null }]
            };
            if (sql.includes('UPDATE fg_facturacion SET')) { updates.push(params); return { rowCount: 1, rows: [] }; }
            throw new Error(`Consulta inesperada en mock: ${sql}`);
        } };
        const result = await facturacionService._private.sincronizarDetraccionFacturacion(fakeClient, 88, {
            tipoComprobante: 'FACTURA', importeTotal: 1080, operacionId: 7001
        });
        assert.equal(result.sujeto, false);
        assert.equal(result.neto, 1080);
        assert.equal(result.motivoExclusion, 'BIEN_MUEBLE_NO_SUJETO_A_SPOT');
        assert.equal(updates.length, 1);
        assert.deepEqual(updates[0].slice(0, 8), [false, null, null, 0, 1080, 0, 1080, 'NO_APLICA']);
    });

    it('detiene una factura mixta antes de persistir SPOT si las bases no se pueden calcular por separado', async () => {
        for (const columna of ['sujeto_detraccion', 'detraccion_codigo', 'detraccion_porcentaje']) {
            columnaCompat._forzarColumnaCache('fg_facturacion', columna, true);
            columnaCompat._forzarColumnaCache('fg_servicio', columna, true);
            columnaCompat._forzarColumnaCache('fg_producto_facturacion', columna, true);
        }
        const fakeClient = { query: async (sql) => {
            if (sql.includes('FROM fg_operacion_detalle od')) return {
                rowCount: 2,
                rows: [
                    { tipo_item: 'SERVICIO', servicio_sujeto_detraccion: true, servicio_detraccion_codigo: '037', servicio_detraccion_porcentaje: 12 },
                    { tipo_item: 'PRODUCTO', sujeto_detraccion: false, detraccion_codigo: null, detraccion_porcentaje: null }
                ]
            };
            throw new Error(`Consulta inesperada: ${sql}`);
        } };
        await assert.rejects(
            facturacionService._private.sincronizarDetraccionFacturacion(fakeClient, 89, {
                tipoComprobante: 'FACTURA', importeTotal: 1260, operacionId: 7002
            }),
            (error) => error.code === 'CONCEPTOS_MIXTOS_REQUIEREN_REVISION'
                && /combina productos y servicios/.test(error.detalles)
        );
    });

    it('relee SPOT del producto serializado al construir la venta, incluidos NO SUJETO y pendiente', async () => {
        const baseProducto = {
            id: 1, codigo: 'CHIP', nombre: 'Chip y porta chip', tipo: 'CHIP_SERIALIZADO',
            activo: true, sede_activa: true, stock_permitido: true, venta_habilitada: true,
            producto_facturacion_id: 25, codigo_sku: 'CHIP + PORTA CHIP - SURCO',
            descripcion: 'CHIP + PORTA CHIP', unidad: 'NIU', tipo_afectacion_igv: '10',
            codigo_clasificacion_sunat: '26121600', fiscal_activo: true, es_para_venta: true,
            precio_referencia: 180, sujeto_detraccion: false,
            detraccion_codigo: null, detraccion_porcentaje: null
        };
        const sqlSelects = [];
        const fakeClient = { query: async (sql) => {
            sqlSelects.push(sql);
            return { rowCount: 1, rows: [baseProducto] };
        } };
        const configNoSujeto = await ventaDirectaService._private.obtenerConfiguracionProducto(fakeClient, '98', 1);
        const detalleNoSujeto = ventaDirectaService._private.construirDetalleChip({ id: 1, numero_chip: 'CHIP001' }, configNoSujeto);
        const noSujeto = evaluarDetraccion({
            tipoComprobante: 'FACTURA', importeTotal: 1080,
            items: Array.from({ length: 6 }, () => ({ tipo_item: 'PRODUCTO', productoSpot: detalleNoSujeto.productoSpot }))
        });
        assert.match(sqlSelects[0], /pf\.sujeto_detraccion, pf\.detraccion_codigo, pf\.detraccion_porcentaje/);
        assert.equal(configNoSujeto.producto_facturacion_id, 25);
        assert.deepEqual(detalleNoSujeto.productoSpot, {
            sujeto_detraccion: false, detraccion_codigo: null, detraccion_porcentaje: null
        });
        assert.equal(noSujeto.requiereRevision, false);
        assert.equal(noSujeto.sujeto, false);
        assert.equal(noSujeto.neto, 1080);

        const configPendiente = { ...configNoSujeto, sujeto_detraccion: null };
        const detallePendiente = ventaDirectaService._private.construirDetalleChip({ id: 2, numero_chip: 'CHIP002' }, configPendiente);
        const pendiente = evaluarDetraccion({
            tipoComprobante: 'FACTURA', importeTotal: 1080,
            items: [{ tipo_item: 'PRODUCTO', productoSpot: detallePendiente.productoSpot }]
        });
        assert.equal(pendiente.requiereRevision, true);
        assert.equal(pendiente.motivoExclusion, 'CLASIFICACION_SPOT_NO_VERIFICADA');
    });

    it('devuelve la clasificación actual del producto fiscal desde Validar Chips', async () => {
        const validarAccesoOriginal = authService.validarAccesoPlanta;
        authService.validarAccesoPlanta = async () => ({ nombre: 'SURCO' });
        const producto = {
            numero_chip: 'CHIP001', estado: 'DISPONIBLE', planta_actual_key: '98', planta_nombre: 'SURCO',
            producto_inventariable_id: 1, producto_codigo: 'CHIP', producto_nombre: 'Chip y porta chip',
            producto_activo: true, sede_activa: true, precio_legacy: 180, stock_permitido: true,
            venta_habilitada: true, producto_facturacion_id: 25, precio_venta_fiscal: 180,
            codigo_sku: 'CHIP + PORTA CHIP - SURCO', descripcion: 'CHIP + PORTA CHIP', unidad: 'NIU',
            tipo_afectacion_igv: '10', codigo_clasificacion_sunat: '26121600',
            sujeto_detraccion: false, detraccion_codigo: null, detraccion_porcentaje: null,
            fiscal_activo: true, es_para_venta: true
        };
        try {
            const resultado = await ventaDirectaValidacionService.validarVentaDirecta(
                { chips: ['CHIP001'] },
                { username: 'test', perfil_id: 'TEST', planta_key: '98' },
                { query: async () => ({ rowCount: 1, rows: [producto] }) }
            );
            assert.equal(resultado.items[0].productoFacturacionId, 25);
            assert.equal(resultado.items[0].spotSujeto, false);
            assert.equal(resultado.items[0].spotCodigo, null);
            assert.equal(resultado.items[0].spotPorcentaje, null);
            assert.equal(resultado.items[0].validoParaVenta, true);
            assert.equal(resultado.totalEstimado, 180);
        } finally {
            authService.validarAccesoPlanta = validarAccesoOriginal;
        }
    });

    it('confirma en transacción simulada una factura pagada de seis chips NO SUJETOS sin llamar a NubeFact', async () => {
        const validarAccesoOriginal = authService.validarAccesoPlanta;
        const conectarOriginal = db.connect;
        authService.validarAccesoPlanta = async () => ({ nombre: 'SURCO' });
        const llamadas = [];
        let detalleId = 0;
        let chipId = 0;
        const configProducto = {
            id: 1, codigo: 'CHIP', nombre: 'Chip y porta chip', tipo: 'CHIP_SERIALIZADO', activo: true,
            sede_activa: true, stock_permitido: true, venta_habilitada: true, producto_facturacion_id: 25,
            codigo_sku: 'CHIP + PORTA CHIP - SURCO', descripcion: 'CHIP + PORTA CHIP', unidad: 'NIU',
            tipo_afectacion_igv: '10', codigo_clasificacion_sunat: '26121600', fiscal_activo: true,
            es_para_venta: true, precio_referencia: 180, sujeto_detraccion: false,
            detraccion_codigo: null, detraccion_porcentaje: null
        };
        const numeros = Array.from({ length: 6 }, (_, index) => `CHIP00${index + 1}`);
        const client = {
            query: async (sql) => {
                const statement = sql.replace(/\s+/g, ' ').trim().toUpperCase();
                llamadas.push(statement);
                if (statement === 'BEGIN' || statement === 'COMMIT' || statement === 'ROLLBACK') return { rowCount: 0, rows: [] };
                if (statement.includes('FROM FG_CHIP') && statement.includes('FOR UPDATE')) {
                    return { rowCount: numeros.length, rows: numeros.map((numero_chip, index) => ({
                        id: index + 1, numero_chip, estado: 'DISPONIBLE', planta_actual_key: '98', producto_inventariable_id: 1
                    })) };
                }
                if (statement.includes('FROM FG_PRODUCTO_INVENTARIABLE PI')) return { rowCount: 1, rows: [configProducto] };
                if (statement.startsWith('SELECT ID, TIPO_DOCUMENTO')) return { rowCount: 1, rows: [{
                    id: 55, tipo_documento: 'RUC', nro_documento: '20100070970',
                    nombre_razon_social: 'CLIENTE PRUEBA', direccion: 'SURCO', telefono: '987654321', correo: null
                }] };
                if (statement.startsWith('INSERT INTO FG_OPERACION_COMERCIAL')) return { rowCount: 1, rows: [{ id: 700 }] };
                if (statement.startsWith('INSERT INTO FG_OPERACION_DETALLE (')) return { rowCount: 1, rows: [{ id: ++detalleId }] };
                if (statement.startsWith('INSERT INTO FG_OPERACION_DETALLE_CHIP')) return { rowCount: 1, rows: [] };
                if (statement.startsWith('INSERT INTO FG_ORDEN_PAGO')) return { rowCount: 1, rows: [{ id: 800 }] };
                if (statement.startsWith('INSERT INTO FG_PAGO')) return { rowCount: 1, rows: [] };
                if (statement.startsWith('UPDATE FG_CHIP')) return { rowCount: 1, rows: [{ id: ++chipId }] };
                if (statement.startsWith('INSERT INTO FG_CHIP_MOVIMIENTO')) return { rowCount: 1, rows: [] };
                throw new Error(`Consulta no prevista en la venta simulada: ${statement}`);
            },
            release: () => llamadas.push('RELEASE')
        };
        db.connect = async () => client;

        try {
            const resultado = await ventaDirectaService.crearVentaDirecta({
                tipoComprobante: 'FACTURA', tipoDocumentoCliente: 'RUC', nroDocumento: '20100070970',
                nombreRazonSocial: 'Cliente Prueba', direccion: 'Surco', telefono: '987654321',
                condicionPago: 'CONTADO', chips: numeros,
                pagosAgregados: [{ tipo: 'efectivo', importe: 1080 }]
            }, { username: 'test', perfil_id: 'TEST', planta_key: '98' });

            assert.equal(resultado.total, 1080);
            assert.equal(resultado.totalPagado, 1080);
            assert.equal(resultado.detalles.length, 6);
            assert.ok(resultado.detalles.every((detalle) => detalle.productoSpot.sujeto_detraccion === false));
            assert.ok(resultado.detalles.every((detalle) => detalle.productoFacturacionId === 25));
            assert.equal(llamadas.includes('COMMIT'), true);
            assert.equal(llamadas.includes('ROLLBACK'), false);
            assert.equal(llamadas.filter((sql) => sql.startsWith('UPDATE FG_CHIP')).length, 6);
        } finally {
            authService.validarAccesoPlanta = validarAccesoOriginal;
            db.connect = conectarOriginal;
        }
    });

    it('bloquea la factura de seis chips con clasificación pendiente antes de tocar inventario', async () => {
        const validarAccesoOriginal = authService.validarAccesoPlanta;
        const conectarOriginal = db.connect;
        authService.validarAccesoPlanta = async () => ({ nombre: 'SURCO' });
        const llamadas = [];
        const configPendiente = {
            id: 1, codigo: 'CHIP', nombre: 'Chip y porta chip', tipo: 'CHIP_SERIALIZADO', activo: true,
            sede_activa: true, stock_permitido: true, venta_habilitada: true, producto_facturacion_id: 25,
            codigo_sku: 'CHIP + PORTA CHIP - SURCO', descripcion: 'CHIP + PORTA CHIP', unidad: 'NIU',
            tipo_afectacion_igv: '10', codigo_clasificacion_sunat: '26121600', fiscal_activo: true,
            es_para_venta: true, precio_referencia: 180, sujeto_detraccion: null,
            detraccion_codigo: null, detraccion_porcentaje: null
        };
        const numeros = Array.from({ length: 6 }, (_, index) => `PEND00${index + 1}`);
        const client = {
            query: async (sql) => {
                const statement = sql.replace(/\s+/g, ' ').trim().toUpperCase();
                llamadas.push(statement);
                if (statement === 'BEGIN' || statement === 'ROLLBACK') return { rowCount: 0, rows: [] };
                if (statement.includes('FROM FG_CHIP') && statement.includes('FOR UPDATE')) {
                    return { rowCount: numeros.length, rows: numeros.map((numero_chip, index) => ({
                        id: index + 1, numero_chip, estado: 'DISPONIBLE', planta_actual_key: '98', producto_inventariable_id: 1
                    })) };
                }
                if (statement.includes('FROM FG_PRODUCTO_INVENTARIABLE PI')) return { rowCount: 1, rows: [configPendiente] };
                throw new Error(`No debía llegar a una consulta de persistencia: ${statement}`);
            },
            release: () => llamadas.push('RELEASE')
        };
        db.connect = async () => client;

        try {
            await assert.rejects(
                ventaDirectaService.crearVentaDirecta({
                    tipoComprobante: 'FACTURA', tipoDocumentoCliente: 'RUC', nroDocumento: '20100070970',
                    nombreRazonSocial: 'CLIENTE PRUEBA', condicionPago: 'CONTADO', chips: numeros,
                    pagosAgregados: [{ tipo: 'efectivo', importe: 1080 }]
                }, { username: 'test', perfil_id: 'TEST', planta_key: '98' }),
                (error) => error.code === 'CLASIFICACION_SPOT_NO_VERIFICADA'
            );
            assert.equal(llamadas.includes('ROLLBACK'), true);
            assert.equal(llamadas.some((sql) => sql.startsWith('UPDATE FG_CHIP')), false);
            assert.equal(llamadas.some((sql) => sql.startsWith('INSERT INTO FG_ORDEN_PAGO')), false);
        } finally {
            authService.validarAccesoPlanta = validarAccesoOriginal;
            db.connect = conectarOriginal;
        }
    });

    it('valida en backend teléfono opcional, móvil peruano y entradas directas inválidas', async () => {
        const validarTelefono = ventaDirectaService._private.validarTelefonoVentaChips;
        assert.equal(validarTelefono(undefined), null);
        assert.equal(validarTelefono(''), null);
        assert.equal(validarTelefono('987654321'), '987654321');
        for (const telefono of ['9876543210', '123456789', '9a7654321', '+51987654321']) {
            assert.throws(() => validarTelefono(telefono), (error) => error.code === 'TELEFONO_MOVIL_PERU_INVALIDO');
        }
        await assert.rejects(
            ventaDirectaService.crearVentaDirecta({ telefono: '123456789' }, { planta_key: '98' }),
            (error) => error.code === 'TELEFONO_MOVIL_PERU_INVALIDO'
        );
    });

    it('exige S/ 1,080 para seis chips no sujetos y S/ 972 ordinarios si una prueba está sujeta al 10%', () => {
        const calcular = ventaDirectaService._private.calcularResumenPagoVenta;
        const noSujeto = calcular({ importeTotal: 1080, totalPagado: 1080, condicionPago: 'CONTADO' });
        assert.deepEqual(noSujeto, { totalExigible: 1080, saldoPendiente: 0, importeAcreditado: 1080 });
        assert.throws(() => calcular({ importeTotal: 1080, totalPagado: 1079, condicionPago: 'CONTADO' }), /PAGO_INCOMPLETO/);

        const spotPrueba = { sujeto: true, monto: 108, neto: 972 };
        const sujeto = calcular({ importeTotal: 1080, totalPagado: 972, condicionPago: 'CONTADO', evaluacionSpot: spotPrueba });
        assert.deepEqual(sujeto, { totalExigible: 972, saldoPendiente: 0, importeAcreditado: 1080 });
        assert.throws(() => calcular({ importeTotal: 1080, totalPagado: 971, condicionPago: 'CONTADO', evaluacionSpot: spotPrueba }), /PAGO_INCOMPLETO/);
    });
});
