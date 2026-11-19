'use strict';

process.env.NODE_ENV = 'test';
process.env.DB_USER = 'faregas_test';
process.env.DB_HOST = '127.0.0.1';
process.env.DB_NAME = 'faregas_test';
process.env.DB_PASSWORD = 'no-connect';
process.env.DB_PORT = '1';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../../config/database');
const authService = require('../services/faregas-auth.service');
const tarifasService = require('../services/faregas-tarifas.service');
const descuentosService = require('../services/faregas-descuentos.service');

const concepto = {
    tipo_certificado_clave: 'GLP_INICIAL',
    modalidad: 'INICIAL',
    tipo_flujo: 'CERTIFICACION',
    familia: 'VEHICULAR',
    formato_codigo_canonico: 'GLP-INICIAL'
};

const reglaDisponible = (cambios = {}) => ({
    id: 501,
    descuento_id: 501,
    codigo: 'PROMO-FAREGAS',
    nombre: 'Promoción FAREGAS',
    tipo: 'PROMOCION',
    empresa_aliada_nombre: 'FAREGAS',
    fecha_inicio: '2026-01-01T00:00:00Z',
    fecha_fin: '2027-01-01T00:00:00Z',
    tipo_calculo: 'MONTO',
    valor: '20.00',
    valor_contado: null,
    valor_credito: null,
    servicio_id: 202,
    planta_key: 'SURCO',
    ...concepto,
    ...cambios
});

test('el selector del wizard devuelve sólo campañas FAREGAS compatibles y resuelve el SKU canónico', async () => {
    const dbConnectAnterior = db.connect;
    const validarAccesoAnterior = authService.validarAccesoPlanta;
    const obtenerTarifaAnterior = tarifasService.obtenerTarifaOperativaPorCodigo;
    const validarTarifaAnterior = tarifasService.validarTarifaCertificacion;

    const filas = [
        reglaDisponible(),
        reglaDisponible({ id: 700, descuento_id: 700, codigo: 'PROMO-LEGACY', nombre: 'PROMO FARENET', empresa_aliada_nombre: 'FARENET' }),
        reglaDisponible({ id: 17, descuento_id: 17, codigo: 'D_CONVENIO_A88137BB742F4157', nombre: 'DESCUENTO CERTIFICADO TALLER', empresa_aliada_nombre: 'FARENET' }),
    ];
    const queries = [];
    const client = {
        async query(sql) {
            queries.push(sql);
            if (sql.includes('SELECT c.id, c.estado')) {
                return { rowCount: 1, rows: [{ id: 999, estado: 'BORRADOR', planta_key: 'SURCO', planta_nombre: 'Surco', tipo_certificado_clave: 'GLP_INICIAL', tarifa_codigo: 'SKU-SURCO' }] };
            }
            if (sql.includes('SELECT placa FROM fg_certificado_vehiculo')) return { rowCount: 0, rows: [] };
            if (sql.includes('FROM fg_descuento d')) return { rowCount: filas.length, rows: filas };
            throw new Error(`Consulta inesperada en prueba aislada: ${sql.slice(0, 70)}`);
        },
        release() {}
    };

    db.connect = async () => client;
    authService.validarAccesoPlanta = async () => true;
    tarifasService.obtenerTarifaOperativaPorCodigo = async () => ({
        ...concepto,
        servicio_id: 101,
        precio: 90,
        tipo_flujo: 'CERTIFICACION'
    });
    tarifasService.validarTarifaCertificacion = tarifa => tarifa;

    try {
        const disponibles = await descuentosService.listarDescuentosDisponibles(999, {
            username: 'prueba', perfil_id: 'CONTADOR'
        });
        assert.equal(disponibles.length, 1);
        assert.equal(disponibles[0].id, 501);
        assert.equal(disponibles[0].tarifaOriginal, 90);
        assert.equal(disponibles[0].importeDescuento, 20);
        assert.equal(disponibles[0].importeFinal, 70);
        const consultaListado = queries.find(sql => sql.includes('FROM fg_descuento d'));
        assert.match(consultaListado, /d\.activo = TRUE/);
        assert.match(consultaListado, /CURRENT_TIMESTAMP >= d\.fecha_inicio AND CURRENT_TIMESTAMP <= d\.fecha_fin/);
        assert.match(consultaListado, /dd\.planta_key = \$1/);
        assert.match(consultaListado, /dd\.activo = TRUE/);
        assert.match(consultaListado, /pf\.activo = TRUE AND pf\.es_para_venta = TRUE/);
        assert.match(consultaListado, /formato_codigo_canonico|formato_raiz/);
        assert.equal(queries.some(sql => sql.includes('FROM persona') || sql.includes('JOIN persona')), false);
        assert.equal(queries.some(sql => /FROM\s+descuento\b|JOIN\s+descuento\b/i.test(sql)), false);
    } finally {
        db.connect = dbConnectAnterior;
        authService.validarAccesoPlanta = validarAccesoAnterior;
        tarifasService.obtenerTarifaOperativaPorCodigo = obtenerTarifaAnterior;
        tarifasService.validarTarifaCertificacion = validarTarifaAnterior;
    }
});

test('guardar reglas valida el precio actual de cada sede en backend y hace rollback si el monto lo iguala', async () => {
    const dbQueryAnterior = db.query;
    const dbConnectAnterior = db.connect;
    const statements = [];
    const client = {
        async query(sql) {
            statements.push(sql);
            if (sql.includes('SELECT id FROM fg_descuento WHERE id=$1 FOR UPDATE')) {
                return { rowCount: 1, rows: [{ id: 88 }] };
            }
            if (sql.includes('SELECT t.producto_facturacion_id')) {
                return {
                    rowCount: 1,
                    rows: [{
                        producto_facturacion_id: 44,
                        sede: 'San Miguel',
                        tarifa_codigo: 'T-SM-01',
                        tarifa_activa: true,
                        producto_activo: true,
                        producto_para_venta: true,
                        producto_precio_referencia: '40.00',
                        producto_precio_unitario: '40.00',
                        servicio_id: 202,
                        ...concepto
                    }]
                };
            }
            return { rowCount: 1, rows: [] };
        },
        release() {}
    };

    db.query = async () => ({ rowCount: 0, rows: [] });
    db.connect = async () => client;
    try {
        await assert.rejects(
            descuentosService.guardarReglasDescuento(88, {
                reglas: [{ plantaKey: 'SAN_MIGUEL', servicioId: 202, tipoCalculo: 'MONTO', valor: '40.00' }]
            }, { username: 'prueba' }),
            error => error.code === 'IMPORTE_DESCUENTO_INVALIDO'
                && error.detalles?.sede === 'San Miguel'
                && error.detalles?.precioVenta === 40
                && error.detalles?.valorSolicitado === 40
        );
        assert.equal(statements.some(sql => sql.includes('INSERT INTO fg_descuentodetalle')), false);
        assert.equal(statements.at(-1), 'ROLLBACK');
    } finally {
        db.query = dbQueryAnterior;
        db.connect = dbConnectAnterior;
    }
});
