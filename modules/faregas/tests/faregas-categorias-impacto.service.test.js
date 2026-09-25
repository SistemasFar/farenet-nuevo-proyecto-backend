const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const db = require('../../../config/database');
const impactoService = require('../services/faregas-categorias-impacto.service');
const productosImpactoService = require('../services/faregas-productos-impacto.service');
const documentoTributarioPolicy = require('../services/faregas-documento-tributario-policy');

const normalizar = (sql) => String(sql).replace(/\s+/g, ' ').trim();
const CATEGORIA = { id: 46, codigo: '87887', nombre: 'CERTIFICADO XD', descripcion: null, activo: true, orden: 10 };

/**
 * Store simulado del grafo de una categoría con servicios. Permite verificar
 * el orden de las escrituras y que jamás se borren productos ni registros ajenos.
 */
class FakeCategoriaImpacto {
    constructor(overrides = {}) {
        this.estado = {
            servicios: overrides.servicios || [{ id: 82, codigo: '434344', nombre: 'CERTIFICADO XD', activo: false, tipo_flujo: 'TALLER_INSPECCION', requiere_vehiculo: true, formato_id: 6 }],
            tarifas: overrides.tarifas || [],
            reglas: overrides.reglas || [],
            operaciones: overrides.operaciones || [],
            detalles: overrides.detalles || [],
            certificados: overrides.certificados || [],
            facturaciones: overrides.facturaciones || [],
            intentos: overrides.intentos || [],
            ordenes: overrides.ordenes || [],
            pagos: overrides.pagos || [],
            productos: overrides.productos || [],
            otrasOperaciones: overrides.otrasOperaciones || [],
            otrosDetalles: overrides.otrosDetalles || []
        };
        this.log = [];
        this.failOn = null;
    }

    async query(sqlCrudo, params = []) {
        const sql = normalizar(sqlCrudo);
        this.log.push({ sql, params: [...params] });
        if (this.failOn && sql.includes(this.failOn)) throw new Error('FALLO_SIMULADO');
        const e = this.estado;
        const lista = (items) => ({ rowCount: items.length, rows: items.map((item) => ({ ...item })) });

        if (/FROM fg_categoria_servicio WHERE id = \$1 FOR UPDATE/.test(sql)) {
            return lista([CATEGORIA]);
        }
        if (/FROM fg_servicio\s+WHERE categoria_id/.test(sql)) {
            return lista(e.servicios);
        }
        if (/FROM fg_tarifa t\s+LEFT JOIN/.test(sql)) {
            return lista(e.tarifas.map((tarifa) => ({
                ...tarifa,
                producto_codigo_sku: tarifa.producto_facturacion_id ? `SKU-${tarifa.producto_facturacion_id}` : null
            })));
        }
        if (/SELECT id, descuento_id, descuento_cliente_id/.test(sql)) return lista(e.reglas);
        if (/WITH target_ops AS/.test(sql)) {
            const ids = [...new Set(e.detalles
                .filter((detalle) => e.servicios.some((s) => Number(s.id) === Number(detalle.servicio_id))
                    || e.tarifas.some((t) => Number(t.id) === Number(detalle.tarifa_id)))
                .map((detalle) => Number(detalle.operacion_id)))].sort((a, b) => a - b);
            return lista(ids.map((id) => {
                const operacion = e.operaciones.find((o) => Number(o.id) === id);
                return {
                    id,
                    estado: operacion ? operacion.estado : 'BORRADOR',
                    planta_key: operacion ? operacion.planta_key : '190',
                    fecha_creacion: '2026-09-01',
                    total_detalles: e.detalles.filter((d) => Number(d.operacion_id) === id).length
                };
            }));
        }
        if (/array_agg\(DISTINCT od\.servicio_id\)/.test(sql)) {
            const objetivo = (params[0] || []).map(Number);
            const objetivoServicios = (params[1] || []).map(Number);
            const ajenos = [...new Set(e.detalles
                .filter((detalle) => objetivo.includes(Number(detalle.operacion_id))
                    && detalle.servicio_id !== null
                    && !objetivoServicios.includes(Number(detalle.servicio_id)))
                .map((detalle) => Number(detalle.servicio_id)))].sort((a, b) => a - b);
            return lista(ajenos.length === 0
                ? []
                : [{ operacion_id: objetivo[0], servicios: ajenos }]);
        }
        if (/FROM fg_operacion_detalle od WHERE od\.operacion_id = ANY/.test(sql)) {
            const objetivo = (params[0] || []).map(Number);
            return lista(e.detalles
                .filter((detalle) => objetivo.includes(Number(detalle.operacion_id)))
                .map((detalle) => ({ ...detalle })));
        }
        if (/SELECT p\.id, p\.codigo_sku, p\.descripcion, p\.categoria_id/.test(sql)) {
            const objetivo = (params[0] || []).map(Number);
            return lista(e.productos
                .filter((producto) => objetivo.includes(Number(producto.id)))
                .map((producto) => ({
                    ...producto,
                    tiene_tarifa_de_otro_servicio: e.tarifas.some((tarifa) => (
                        Number(tarifa.producto_facturacion_id) === Number(producto.id)
                        && !e.servicios.some((s) => Number(s.id) === Number(tarifa.servicio_id))
                    ))
                })));
        }
        if (/FROM fg_certificado\s+WHERE id = ANY/.test(sql)) {
            const objetivo = (params[0] || []).map(Number);
            return lista(e.certificados.filter((c) => objetivo.includes(Number(c.id))));
        }
        if (/FROM fg_certificado c JOIN fg_tarifa t ON/.test(sql)) {
            const objetivo = (params[0] || []).map(Number);
            return lista(e.certificados
                .filter((certificado) => e.tarifas.some((tarifa) => (
                    Number(tarifa.id) === Number(certificado.tarifa_id) && Number(tarifa.id) === Number(certificado.tarifa_id)
                )))
                .filter((certificado) => objetivo.includes(Number(certificado.tarifa_id)))
                .map((certificado) => ({ ...certificado })));
        }
        if (/COUNT\(\*\) FILTER/.test(sql)) {
            const operaciones = (params[0] || []).map(Number);
            const certificados = (params[1] || []).map(Number);
            const filas = [];
            for (const certificado of e.certificados) {
                if (!certificados.includes(Number(certificado.id))) continue;
                const externas = e.detalles.filter((detalle) => (
                    Number(detalle.certificado_id) === Number(certificado.id)
                    && !operaciones.includes(Number(detalle.operacion_id))
                )).length;
                filas.push({ certificado_id: certificado.id, operaciones_externas: externas });
            }
            return lista(filas);
        }
        if (/SELECT id, facturacion_id, numero_intento/.test(sql)) return lista(e.intentos);
        if (/FROM fg_facturacion\b/.test(sql)) return lista(e.facturaciones);
        if (/FROM fg_orden_pago/.test(sql)) return lista(e.ordenes);
        if (/FROM fg_pago/.test(sql)) return lista(e.pagos);
        if (/FROM fg_chip WHERE/.test(sql)) return lista([]);
        if (/FROM fg_chip_movimiento/.test(sql)) return lista([]);
        if (/FROM fg_certificado_formato f/.test(sql)) {
            const objetivo = (params[0] || []).map(Number);
            return lista([{ id: 6, codigo: 'TALLER_INSPECCION', nombre: 'Inspección de Taller', es_protegido: false, activo: true, servicios_que_lo_usan: 4, versiones: 2, certificados: 5 }]
                .filter((formato) => objetivo.includes(Number(formato.id))));
        }
        if (/FROM fg_producto_facturacion\s+WHERE categoria_id/.test(sql)) {
            return lista(e.productos.filter((producto) => Number(producto.categoria_id) === Number(params[0])));
        }
        if (/DELETE FROM fg_descuentodetalle/.test(sql)) {
            const objetivo = (params[0] || []).map(Number);
            const antes = e.reglas.length;
            e.reglas = e.reglas.filter((regla) => !objetivo.includes(Number(regla.servicio_id)));
            return { rowCount: antes - e.reglas.length, rows: [] };
        }
        if (/DELETE FROM fg_tarifa WHERE/.test(sql)) {
            const objetivo = (params[0] || []).map(Number);
            const antes = e.tarifas.length;
            e.tarifas = e.tarifas.filter((tarifa) => !objetivo.includes(Number(tarifa.id)));
            return { rowCount: antes - e.tarifas.length, rows: [] };
        }
        if (/DELETE FROM fg_servicio WHERE/.test(sql)) {
            const objetivo = (params[0] || []).map(Number);
            const antes = e.servicios.length;
            e.servicios = e.servicios.filter((servicio) => !objetivo.includes(Number(servicio.id)));
            return { rowCount: antes - e.servicios.length, rows: [] };
        }
        throw new Error(`Consulta no simulada: ${sql}`);
    }

    release() {}
}

const conLimpiezaSimulada = async (fn) => {
    const original = productosImpactoService.eliminarOperacionesMixtas;
    const llamadas = [];
    productosImpactoService.eliminarOperacionesMixtas = async (client, impacto) => {
        llamadas.push(impacto);
        return {
            operacionesEliminadas: impacto.operacionesMixtas.length,
            detallesEliminados: impacto.operacionesMixtas.reduce((total, o) => total + o.detalles.length, 0),
            facturacionesEliminadas: 0,
            ordenesPagoEliminadas: 0,
            pagosEliminados: 0,
            certificadosEliminados: impacto.certificadosAEliminar.length,
            documentosElectronicosEliminados: 0,
            descuentosAjustados: 0,
            chipsDesvinculados: 0,
            otrosProductosPreservados: impacto.otrosProductos.map((p) => p.id)
        };
    };
    try {
        return { resultado: await fn(), llamadas };
    } finally {
        productosImpactoService.eliminarOperacionesMixtas = original;
    }
};

const escenarioCompleto = () => new FakeCategoriaImpacto({
    servicios: [
        { id: 82, codigo: '434344', nombre: 'CERTIFICADO XD', activo: false, tipo_flujo: 'TALLER_INSPECCION', requiere_vehiculo: true, formato_id: 6 },
        { id: 83, codigo: '434345', nombre: 'CERTIFICADO XD 2', activo: true, tipo_flujo: 'TALLER_INSPECCION', requiere_vehiculo: true, formato_id: 6 }
    ],
    tarifas: [
        { id: 500, servicio_id: 82, planta_key: '190', codigo: '434344', nombre: 'XD 190', precio: 122, activo: true, producto_facturacion_id: 700 },
        { id: 501, servicio_id: 83, planta_key: '190', codigo: '434345', nombre: 'XD2 190', precio: 133, activo: true, producto_facturacion_id: null }
    ],
    reglas: [
        { id: 600, descuento_id: 1, descuento_cliente_id: null, servicio_id: 82, planta_key: '190', tipo_calculo: 'PORCENTAJE', valor: 5, activo: true },
        { id: 601, descuento_id: 1, descuento_cliente_id: null, servicio_id: 83, planta_key: '201', tipo_calculo: 'PORCENTAJE', valor: 7, activo: true }
    ],
    operaciones: [{ id: 135, estado: 'PAGADO', planta_key: '190' }],
    detalles: [
        { id: 65, operacion_id: 135, orden: 1, tipo_item: 'SERVICIO', servicio_id: 82, tarifa_id: 500, producto_facturacion_id: null, certificado_id: 252 },
        { id: 66, operacion_id: 135, orden: 2, tipo_item: 'PRODUCTO', servicio_id: null, tarifa_id: null, producto_facturacion_id: null, certificado_id: null }
    ],
    certificados: [{ id: 252, estado: 'BORRADOR', numero_certificado: null, tarifa_codigo: '434344', planta_key: '190', tarifa_id: 500 }],
    productos: [
        { id: 700, codigo_sku: 'XD-SKU', descripcion: 'CERTIFICADO XD', categoria_id: 46 }
    ]
});

test('3./4./5. el impacto lista servicios, tarifas, reglas y mappings por sede', async () => {
    const store = escenarioCompleto();
    const impacto = await impactoService.calcularImpactoEnTransaccion(store, 46, CATEGORIA);

    assert.equal(impacto.requiereConfirmacion, true);
    assert.equal(impacto.eliminable, true);
    assert.equal(impacto.servicios.length, 2);
    assert.equal(impacto.tarifas.length, 2);
    assert.equal(impacto.reglasConfiguracion.length, 2);
    assert.equal(impacto.mappingsPorSede.tarifas.length, 2);
    assert.equal(impacto.mappingsPorSede.reglas.length, 2);
    assert.deepEqual(impacto.mappingsPorSede.tarifas.map((t) => t.planta_key), ['190', '190']);
    assert.deepEqual(impacto.mappingsPorSede.reglas.map((r) => r.planta_key), ['190', '201']);
});

test('5./6. los productos fiscales se conservan y sólo pierden la categoría', async () => {
    const store = escenarioCompleto();
    const impacto = await impactoService.calcularImpactoEnTransaccion(store, 46, CATEGORIA);

    assert.deepEqual(impacto.productosPreservados, [700]);
    assert.deepEqual(impacto.productosCompartidos, []);
    assert.deepEqual(impacto.certificadosAEliminar, [252]);
    assert.equal(impacto.detalleProductoSnapshot, 1);
});

test('los formatos compartidos se conservan y no se propose su borrado', async () => {
    const store = escenarioCompleto();
    const impacto = await impactoService.calcularImpactoEnTransaccion(store, 46, CATEGORIA);

    assert.equal(impacto.formatos.length, 1);
    assert.equal(impacto.formatos[0].servicios_que_lo_usan, 4);
    assert.equal(impacto.formatosConservados, 1);
});

test('la limpieza borra reglas, tarifas y servicios, y nunca productos', async () => {
    const store = escenarioCompleto();
    const impacto = await impactoService.calcularImpactoEnTransaccion(store, 46, CATEGORIA);
    const { resultado, llamadas } = await conLimpiezaSimulada(
        () => impactoService.eliminarServiciosYDependencias(store, impacto)
    );

    assert.equal(resultado.serviciosEliminados, 2);
    assert.equal(resultado.tarifasEliminadas, 2);
    assert.equal(resultado.reglasEliminadas, 2);
    assert.equal(resultado.operacionesEliminadas, 1);
    assert.equal(resultado.certificadosEliminados, 1);
    assert.equal(store.estado.servicios.length, 0);
    assert.equal(store.estado.tarifas.length, 0);
    assert.equal(store.estado.reglas.length, 0);
    assert.equal(store.estado.productos.length, 1);

    const llamadasSql = store.log.map(({ sql }) => sql);
    const iDetalle = llamadasSql.findIndex((sql) => /DELETE FROM fg_descuentodetalle/.test(sql));
    const iTarifa = llamadasSql.findIndex((sql) => /DELETE FROM fg_tarifa WHERE/.test(sql));
    const iServicio = llamadasSql.findIndex((sql) => /DELETE FROM fg_servicio WHERE/.test(sql));
    assert.ok(iDetalle >= 0 && iTarifa > iDetalle && iServicio > iTarifa);
    assert.ok(!llamadasSql.some((sql) => /DELETE FROM fg_producto_facturacion/.test(sql)));
    assert.deepEqual(llamadas[0].otrosProductos.map((p) => p.id), [700]);
});

test('7. una operación con servicio de otra categoría bloquea sin escribir nada', async () => {
    const store = new FakeCategoriaImpacto({
        servicios: [{ id: 82, codigo: '434344', nombre: 'XD', activo: false, tipo_flujo: 'TALLER_INSPECCION', requiere_vehiculo: true, formato_id: 6 }],
        operaciones: [{ id: 135, estado: 'PAGADO', planta_key: '190' }],
        detalles: [
            { id: 65, operacion_id: 135, orden: 1, tipo_item: 'SERVICIO', servicio_id: 82, tarifa_id: null, producto_facturacion_id: null, certificado_id: null },
            { id: 67, operacion_id: 135, orden: 2, tipo_item: 'SERVICIO', servicio_id: 2, tarifa_id: null, producto_facturacion_id: null, certificado_id: null }
        ]
    });
    const impacto = await impactoService.calcularImpactoEnTransaccion(store, 46, CATEGORIA);

    assert.equal(impacto.eliminable, false);
    assert.deepEqual(impacto.operacionesBloqueadas, [
        { operacion_id: 135, motivo: 'SERVICIO_DE_OTRA_CATEGORIA', referencias: [2] }
    ]);
    await assert.rejects(
        () => impactoService.eliminarServiciosYDependencias(store, impacto),
        (error) => error.message === 'OPERACION_MIXTA_CATEGORIA'
    );
    assert.equal(store.estado.servicios.length, 1);
    assert.ok(!store.log.some(({ sql }) => /DELETE FROM/.test(sql)));
});

test('un producto fiscal de otra categoría en la operación bloquea el borrado', async () => {
    const store = new FakeCategoriaImpacto({
        servicios: [{ id: 82, codigo: '434344', nombre: 'XD', activo: false, tipo_flujo: 'TALLER_INSPECCION', requiere_vehiculo: true, formato_id: 6 }],
        operaciones: [{ id: 135, estado: 'PAGADO', planta_key: '190' }],
        detalles: [
            { id: 65, operacion_id: 135, orden: 1, tipo_item: 'SERVICIO', servicio_id: 82, tarifa_id: null, producto_facturacion_id: null, certificado_id: null },
            { id: 68, operacion_id: 135, orden: 2, tipo_item: 'PRODUCTO', servicio_id: null, tarifa_id: null, producto_facturacion_id: 700, certificado_id: null }
        ],
        productos: [{ id: 700, codigo_sku: 'OTRO', descripcion: 'Producto de otra categoría', categoria_id: 3 }]
    });
    const impacto = await impactoService.calcularImpactoEnTransaccion(store, 46, CATEGORIA);

    assert.equal(impacto.eliminable, false);
    assert.deepEqual(impacto.productosCompartidos.map((p) => p.motivo), ['PERTECE_A_OTRA_CATEGORIA']);
    assert.deepEqual(impacto.operacionesBloqueadas, [
        { operacion_id: 135, motivo: 'PRODUCTO_FISCAL_COMPARTIDO', referencias: [700] }
    ]);
});

test('un certificado emitido se conserva y se reporta como no descartable', async () => {
    const store = new FakeCategoriaImpacto({
        servicios: [{ id: 82, codigo: '434344', nombre: 'XD', activo: false, tipo_flujo: 'TALLER_INSPECCION', requiere_vehiculo: true, formato_id: 6 }],
        tarifas: [{ id: 500, servicio_id: 82, planta_key: '190', codigo: '434344', nombre: 'XD 190', precio: 122, activo: true, producto_facturacion_id: null }],
        certificados: [{ id: 300, estado: 'EMITIDO', numero_certificado: 'F-900', tarifa_codigo: '434344', planta_key: '190', tarifa_id: 500 }]
    });
    const impacto = await impactoService.calcularImpactoEnTransaccion(store, 46, CATEGORIA);

    assert.deepEqual(impacto.certificadosAEliminar, []);
    assert.deepEqual(impacto.certificadosPreservados.map((c) => c.motivo), ['ESTADO_NO_DESCARTABLE']);
    assert.equal(impacto.certificados[0].origen, 'TARIFA');
});

test('el preview es read-only y hace rollback explícito', () => {
    const fuente = fs.readFileSync(require.resolve('../services/faregas-categorias-impacto.service'), 'utf8');
    const inicio = fuente.indexOf('const preview = async');
    const fin = fuente.indexOf('const eliminarServiciosYDependencias', inicio);
    const bloque = fuente.slice(inicio, fin);

    assert.match(bloque, /await client\.query\('ROLLBACK'\)/);
    assert.doesNotMatch(bloque, /DELETE FROM|UPDATE /);
    assert.match(fuente, /FOR UPDATE/);
});

test('una categoría sin servicios no intenta limpiar dependencias', async () => {
    const store = new FakeCategoriaImpacto({ servicios: [] });
    const impacto = await impactoService.calcularImpactoEnTransaccion(store, 46, CATEGORIA);
    const { resultado, llamadas } = await conLimpiezaSimulada(
        () => impactoService.eliminarServiciosYDependencias(store, impacto)
    );

    assert.equal(impacto.requiereConfirmacion, false);
    assert.equal(resultado.serviciosEliminados, 0);
    assert.equal(llamadas.length, 0);
    assert.ok(!store.log.some(({ sql }) => /DELETE FROM/.test(sql)));
});

const escenarioConComprobantes = (extra = {}) => new FakeCategoriaImpacto({
    servicios: [{ id: 82, codigo: '434344', nombre: 'CERTIFICADO XD', activo: false, tipo_flujo: 'TALLER_INSPECCION', requiere_vehiculo: true, formato_id: 6 }],
    tarifas: [{ id: 500, servicio_id: 82, planta_key: '190', codigo: '434344', nombre: 'XD 190', precio: 122, activo: true, producto_facturacion_id: null }],
    operaciones: [{ id: 135, estado: 'PAGADO', planta_key: '190' }],
    detalles: [{ id: 65, operacion_id: 135, orden: 1, tipo_item: 'SERVICIO', servicio_id: 82, tarifa_id: 500, producto_facturacion_id: null, certificado_id: 252 }],
    certificados: [{ id: 252, estado: 'BORRADOR', numero_certificado: null, tarifa_codigo: '434344', planta_key: '190', tarifa_id: 500 }],
    facturaciones: [{
        id: 900,
        operacion_id: 135,
        estado: 'ACEPTADO',
        tipo_comprobante: 'FACTURA',
        serie: 'F001',
        numero: 50,
        nro_comprobante: 'F001-00000050',
        proveedor: 'NUBEFACT',
        entorno_facturador: 'DEMO',
        aceptada_sunat: true,
        intentos: 2
    }],
    intentos: [
        { id: 1, facturacion_id: 900, numero_intento: 1, estado: 'PENDIENTE', http_status: null },
        { id: 2, facturacion_id: 900, numero_intento: 2, estado: 'ACEPTADO', http_status: 200 }
    ],
    ordenes: [{ id: 700, operacion_id: 135, certificado_id: 252, estado: 'PAGADO', importe_total: 180, importe_pagado: 180, saldo_pendiente: 0 }],
    pagos: [{ id: 800, orden_pago_id: 700, importe: 180 }],
    ...extra
});

const conAmbiente = async (ambiente, fn) => {
    const original = documentoTributarioPolicy.permiteLimpiezaLocalDeComprobantes;
    const originalEfectivo = documentoTributarioPolicy.entornoFacturacionEfectivo;
    documentoTributarioPolicy.permiteLimpiezaLocalDeComprobantes = (environment) => (
        ambiente === 'PRODUCCION' ? false : original(environment)
    );
    documentoTributarioPolicy.entornoFacturacionEfectivo = () => ambiente;
    try {
        return await fn();
    } finally {
        documentoTributarioPolicy.permiteLimpiezaLocalDeComprobantes = original;
        documentoTributarioPolicy.entornoFacturacionEfectivo = originalEfectivo;
    }
};

test('DEMO: el preview habilita la limpieza y detalla el conjunto de prueba', async () => {
    const store = escenarioConComprobantes();
    const impacto = await conAmbiente('DEMO', () => impactoService.calcularImpactoEnTransaccion(store, 46, CATEGORIA));

    assert.equal(impacto.ambiente, 'DEMO');
    assert.equal(impacto.limpiezaHabilitada, true);
    assert.equal(impacto.eliminable, true);
    assert.equal(impacto.facturaciones.length, 1);
    assert.equal(impacto.facturacionesProtegidas.length, 1);
    assert.equal(impacto.facturacionesBloqueantes.length, 0);
    assert.equal(impacto.intentosFacturacion.length, 2);
    assert.equal(impacto.ordenesPago.length, 1);
    assert.equal(impacto.pagos.length, 1);
});

test('PRODUCCION: el preview bloquea y expone los comprobantes Responsible', async () => {
    const store = escenarioConComprobantes();
    const impacto = await conAmbiente('PRODUCCION', () => impactoService.calcularImpactoEnTransaccion(store, 46, CATEGORIA));

    assert.equal(impacto.ambiente, 'PRODUCCION');
    assert.equal(impacto.limpiezaHabilitada, false);
    assert.equal(impacto.eliminable, false);
    assert.equal(impacto.facturacionesProtegidas.length, 1);
    assert.deepEqual(impacto.facturacionesBloqueantes.map((f) => f.id), [900]);
});

test('DEMO: la limpieza pide la autorización local y el helper la concede', async () => {
    const store = escenarioConComprobantes();
    const impacto = await conAmbiente('DEMO', () => impactoService.calcularImpactoEnTransaccion(store, 46, CATEGORIA));
    const { resultado, llamadas } = await conLimpiezaSimulada(
        () => impactoService.eliminarServiciosYDependencias(store, impacto)
    );

    assert.equal(resultado.serviciosEliminados, 1);
    assert.equal(resultado.tarifasEliminadas, 1);
    assert.equal(llamadas.length, 1);
    assert.deepEqual(llamadas[0].certificadosAEliminar, [252]);
    assert.equal(llamadas[0].facturaciones.length, 1);
    assert.ok(store.log.some(({ sql }) => /DELETE FROM fg_tarifa WHERE/.test(sql)));
    assert.ok(store.log.some(({ sql }) => /DELETE FROM fg_servicio WHERE/.test(sql)));
    assert.ok(!store.log.some(({ sql }) => /DELETE FROM fg_producto_facturacion/.test(sql)));
});

test('el preview de categoría abre transacción read-only y la revierte', async () => {
    const originalConnect = db.connect;
    const consultas = [];
    const store = escenarioCompleto();
    db.connect = async () => ({
        async query(sql, params = []) {
            consultas.push(normalizar(sql));
            if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rowCount: 0, rows: [] };
            return store.query(sql, params);
        },
        release() {}
    });
    try {
        const impacto = await impactoService.preview(46);
        assert.equal(impacto.categoria.codigo, '87887');
        assert.equal(impacto.servicios.length, 2);
        assert.ok(consultas.includes('ROLLBACK'));
        assert.ok(!consultas.includes('COMMIT'));
        assert.ok(!consultas.some((sql) => sql.startsWith('DELETE FROM') || sql.startsWith('UPDATE ')));
        assert.equal(store.estado.servicios.length, 2);
    } finally {
        db.connect = originalConnect;
    }
});
