const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';

const db = require('../../../config/database');
const descuentos = require('../services/faregas-descuentos.service');

// ---------------------------------------------------------------------------
// Simulador en memoria de las tablas PostgreSQL involucradas en el ciclo de
// edición de descuentos. Reproduce la semántica real:
//   - fg_descuentodetalle tiene un índice único parcial
//     uq_fg_descuentodetalle_descuento_sede_servicio
//     ON (descuento_id, planta_key, servicio_id) WHERE descuento_cliente_id IS NULL
//   - guardarReglasCampana hace UPDATE activo=FALSE + INSERT ... ON CONFLICT DO UPDATE
//   - obtenerDetalleAdministracion filtra descuento_cliente_id IS NULL AND activo=TRUE
//     y hace JOIN con fg_planta.
// ---------------------------------------------------------------------------

const FLUJOS_DESCONTABLES = ['CERTIFICACION', 'TALLER_INSPECCION'];

const crearEstado = () => ({
    descuentos: [],
    plantas: [],
    servicios: [],
    categorias: [],
    productos: [],
    tarifas: [],
    codigosCliente: [],
    reglas: [],
    siguienteId: 1,
});

let estado = crearEstado();

const semillaCatalogo = () => {
    estado.plantas.push(
        { key: '13', nombre: 'Planta 13', activo: true },
        { key: '98', nombre: 'Planta 98', activo: true },
        { key: '160', nombre: 'Planta 160', activo: true },
    );
    estado.categorias.push(
        { id: 1, nombre: 'GNV', activo: true },
        { id: 2, nombre: 'GLP', activo: true },
    );
    estado.servicios.push(
        { id: 328, codigo: '0438', nombre: 'CERTIFICADO ANUAL DE INSPECCIÓN DE TALLER GNV', activo: true, categoria_id: 1, tipo_flujo: 'CERTIFICACION' },
        { id: 329, codigo: '0437', nombre: 'CERTIFICADO ANUAL DE INSPECCIÓN DE TALLER GLP', activo: true, categoria_id: 2, tipo_flujo: 'TALLER_INSPECCION' },
        { id: 331, codigo: '0423', nombre: 'CERTIFICADO ANUAL DE INSPECCIÓN DE TALLER GNV', activo: true, categoria_id: 1, tipo_flujo: 'TALLER_INSPECCION' },
        { id: 406, codigo: '0422', nombre: 'CERTIFICADO ANUAL DE INSPECCIÓN DE TALLER GLP', activo: true, categoria_id: 2, tipo_flujo: 'TALLER_INSPECCION' },
        { id: 414, codigo: '0428', nombre: 'CERTIFICADO ANUAL DE INSPECCIÓN DE TALLER GNV', activo: true, categoria_id: 1, tipo_flujo: 'TALLER_INSPECCION' },
        { id: 415, codigo: '0427', nombre: 'CERTIFICADO ANUAL DE INSPECCIÓN DE TALLER GLP', activo: true, categoria_id: 2, tipo_flujo: 'TALLER_INSPECCION' },
    );
    estado.productos.push({ id: 46, precio_referencia: 350, precio_unitario: 296.61 });
    for (const [planta, servicio] of [['13', 328], ['13', 329], ['98', 331], ['98', 406], ['160', 414], ['160', 415]]) {
        estado.tarifas.push({ planta_key: planta, servicio_id: servicio, activo: true, producto_facturacion_id: 46, precio: 350 });
    }
};

const semillaDescuento23Editable = () => {
    estado.descuentos.push({
        id: 23, codigo: 'CAMP-TALLER-23', nombre: 'DESCUENTO TALLER', tipo: 'CAMPANA',
        activo: true, fecha_inicio: '2026-01-01', fecha_fin: '2027-12-31',
    });
    // Seis reglas activas de campaña (descuento_cliente_id IS NULL), PORCENTAJE 100.
    for (const [planta, servicio] of [['13', 328], ['13', 329], ['98', 331], ['98', 406], ['160', 414], ['160', 415]]) {
        estado.reglas.push({
            id: estado.siguienteId++, descuento_id: 23, descuento_cliente_id: null,
            planta_key: planta, servicio_id: servicio, tipo_calculo: 'PORCENTAJE',
            valor: 100, valor_contado: null, valor_credito: null, activo: true,
            usuario_creacion: 'seed', usuario_modificacion: null,
        });
    }
};

const semillaDescuentoProtegido = () => {
    estado.descuentos.push({
        id: 24, codigo: 'CONV-TALLER', nombre: 'DESCUENTO TALLER', tipo: 'CONVENIO',
        activo: true, fecha_inicio: '2026-01-01', fecha_fin: '2027-12-31',
    });
    estado.codigosCliente.push({ id: 900, descuento_id: 24, codigo: 'DESCUENTO_TALLER', activo: true });
    for (const [planta, servicio] of [['13', 328], ['13', 329]]) {
        estado.reglas.push({
            id: estado.siguienteId++, descuento_id: 24, descuento_cliente_id: null,
            planta_key: planta, servicio_id: servicio, tipo_calculo: 'PORCENTAJE',
            valor: 100, valor_contado: null, valor_credito: null, activo: true,
            usuario_creacion: 'seed', usuario_modificacion: null,
        });
    }
};

// ---------------------------------------------------------------------------
// Enrutador SQL que interpreta las consultas exactas del servicio.
// ---------------------------------------------------------------------------

const ejecutar = (sql, params = []) => {
    const texto = String(sql);

    if (texto === 'BEGIN' || texto === 'COMMIT' || texto === 'ROLLBACK') {
        return { rowCount: 0, rows: [] };
    }

    // Protección de convenio fiscal (consultarConvenioProtegido)
    if (texto.includes('UPPER(BTRIM(dc.codigo))')) {
        const descuentoId = Number(params[0]);
        const filas = estado.codigosCliente
            .filter(c => c.descuento_id === descuentoId && String(c.codigo).trim().toUpperCase() === 'DESCUENTO_TALLER')
            .map(c => ({ id: c.id, codigo_autorizacion: c.codigo }));
        return { rowCount: filas.length, rows: filas };
    }

    // Detalle del descuento (obtenerDetalleAdministracion)
    if (texto.includes('SELECT * FROM fg_descuento')) {
        const fila = estado.descuentos.find(d => d.id === Number(params[0]));
        return { rowCount: fila ? 1 : 0, rows: fila ? [fila] : [] };
    }

    // Reglas del detalle con JOIN a fg_planta y filtro de activo
    if (texto.includes('FROM fg_descuentodetalle dd')) {
        const filas = estado.reglas
            .filter(r => r.descuento_id === Number(params[0]) && r.descuento_cliente_id === null && r.activo === true)
            .filter(r => estado.plantas.some(p => p.key === String(r.planta_key)))
            .sort((a, b) => {
                const pa = estado.plantas.find(p => p.key === String(a.planta_key));
                const pb = estado.plantas.find(p => p.key === String(b.planta_key));
                if (pa.nombre !== pb.nombre) return pa.nombre.localeCompare(pb.nombre);
                return Number(a.servicio_id) - Number(b.servicio_id);
            })
            .map(r => ({
                plantaKey: String(r.planta_key),
                servicioId: Number(r.servicio_id),
                tipoCalculo: r.tipo_calculo,
                valor: r.valor,
                valorContado: r.valor_contado,
                valorCredito: r.valor_credito,
            }));
        return { rowCount: filas.length, rows: filas };
    }

    // Bloqueo del descuento dentro de la transacción de guardado
    if (texto.includes('FROM fg_descuento WHERE id=$1 FOR UPDATE')) {
        const fila = estado.descuentos.find(d => d.id === Number(params[0]));
        return { rowCount: fila ? 1 : 0, rows: fila ? [fila] : [] };
    }

    // Desactivación masiva de reglas de campaña
    if (texto.includes('UPDATE fg_descuentodetalle')) {
        for (const r of estado.reglas) {
            if (r.descuento_id === Number(params[0]) && r.descuento_cliente_id === null) {
                r.activo = false;
                r.usuario_modificacion = params[1];
            }
        }
        return { rowCount: 1, rows: [] };
    }

    // Validación de referencia tarifa/servicio/planta/categoría
    if (texto.includes('FROM fg_tarifa t')) {
        const plantaKey = String(params[0]);
        const servicioId = Number(params[1]);
        const flujos = params[2];
        const tarifa = estado.tarifas.find(t => String(t.planta_key) === plantaKey && Number(t.servicio_id) === servicioId && t.activo === true);
        if (!tarifa) return { rowCount: 0, rows: [] };
        const servicio = estado.servicios.find(s => s.id === servicioId && s.activo === true);
        if (!servicio || !flujos.includes(servicio.tipo_flujo)) return { rowCount: 0, rows: [] };
        const categoria = estado.categorias.find(c => c.id === servicio.categoria_id && c.activo === true);
        if (!categoria) return { rowCount: 0, rows: [] };
        const planta = estado.plantas.find(p => p.key === plantaKey && p.activo === true);
        if (!planta) return { rowCount: 0, rows: [] };
        const producto = estado.productos.find(p => p.id === tarifa.producto_facturacion_id);
        return {
            rowCount: 1,
            rows: [{
                producto_facturacion_id: tarifa.producto_facturacion_id,
                producto_precio_referencia: producto ? producto.precio_referencia : null,
                producto_precio_unitario: producto ? producto.precio_unitario : null,
            }],
        };
    }

    // Upsert de regla de campaña (INSERT ... ON CONFLICT ... DO UPDATE)
    if (texto.includes('INSERT INTO fg_descuentodetalle')) {
        const descuentoId = Number(params[0]);
        const plantaKey = String(params[1]);
        const servicioId = Number(params[2]);
        const tipoCalculo = params[3];
        const valor = params[4];
        const valorContado = params[5];
        const valorCredito = params[6];
        const username = params[7];
        const existente = estado.reglas.find(r => (
            r.descuento_id === descuentoId
            && r.descuento_cliente_id === null
            && String(r.planta_key) === plantaKey
            && Number(r.servicio_id) === servicioId
        ));
        if (existente) {
            existente.tipo_calculo = tipoCalculo;
            existente.valor = valor;
            existente.valor_contado = valorContado;
            existente.valor_credito = valorCredito;
            existente.activo = true;
            existente.usuario_modificacion = username;
        } else {
            estado.reglas.push({
                id: estado.siguienteId++, descuento_id: descuentoId, descuento_cliente_id: null,
                planta_key: plantaKey, servicio_id: servicioId, tipo_calculo: tipoCalculo,
                valor, valor_contado: valorContado, valor_credito: valorCredito, activo: true,
                usuario_creacion: username, usuario_modificacion: null,
            });
        }
        return { rowCount: 1, rows: [] };
    }

    throw new Error(`Consulta no implementada en el simulador: ${texto.slice(0, 120)}`);
};

const instalarMocks = () => {
    db.query = async (sql, params) => ejecutar(sql, params);
    db.connect = async () => ({
        query: async (sql, params) => ejecutar(sql, params),
        release: () => undefined,
    });
};

const restaurarMocks = () => {
    // El pool real no es utilizable en el entorno de prueba; se mantiene el mock
    // sólo durante la vida del test.
};

// Construye el payload exacto que envía el frontend tras un cambio de beneficio
// general (aplicarBeneficioGeneral sobre todas las reglas sin excepciones).
const payloadConBeneficio = (reglasDetalle, tipoCalculo, valor) => ({
    reglas: reglasDetalle.map(r => ({
        plantaKey: String(r.plantaKey),
        servicioId: Number(r.servicioId),
        tipoCalculo,
        valor: tipoCalculo === 'FLAT' ? '' : String(valor),
        valorContado: tipoCalculo === 'FLAT' ? String(valor) : '',
        valorCredito: '',
    })),
});

test('el descuento 23 es una campaña editable (no es convenio fiscal protegido)', async () => {
    estado = crearEstado();
    semillaCatalogo();
    semillaDescuento23Editable();
    instalarMocks();
    try {
        const protegido = await descuentos.consultarConvenioProtegidoAdmin(23);
        assert.equal(protegido, null, 'El descuento 23 no debe detectarse como convenio protegido');
    } finally {
        restaurarMocks();
    }
});

test('ciclo completo: cambiar el beneficio general de 100 a 20 persiste y sobrevive a la reapertura', async () => {
    estado = crearEstado();
    semillaCatalogo();
    semillaDescuento23Editable();
    instalarMocks();
    try {
        // 1. Apertura: el frontend normaliza las reglas del detalle.
        const apertura = await descuentos.obtenerDetalleAdministracion(23);
        assert.equal(apertura.reglas.length, 6, 'debe tener seis reglas activas');
        assert.ok(apertura.reglas.every(r => Number(r.valor) === 100), 'valores iniciales 100');

        // 2. Edición: el usuario cambia el beneficio general a PORCENTAJE 20.
        const payload = payloadConBeneficio(apertura.reglas, 'PORCENTAJE', 20);

        // 3. Guardado: PUT /descuentos/23/reglas.
        const resultado = await descuentos.guardarReglasDescuento(23, payload, { username: 'tester' });
        assert.deepEqual(resultado, { success: true });

        // 4. Reapertura: el frontend vuelve a consultar el detalle.
        const reapertura = await descuentos.obtenerDetalleAdministracion(23);
        assert.equal(reapertura.reglas.length, 6, 'debe conservar las seis reglas');
        const valores = reapertura.reglas.map(r => Number(r.valor));
        assert.deepEqual(valores, [20, 20, 20, 20, 20, 20], 'los valores deben reflejar el cambio a 20');
    } finally {
        restaurarMocks();
    }
});

test('ciclo completo: quitar una sede persiste el alcance reducido', async () => {
    estado = crearEstado();
    semillaCatalogo();
    semillaDescuento23Editable();
    instalarMocks();
    try {
        const apertura = await descuentos.obtenerDetalleAdministracion(23);
        assert.equal(apertura.reglas.length, 6);

        // El usuario desmarca la sede 98: el frontend reconstruye las reglas
        // conservando sólo las sedes 13 y 160.
        const payload = {
            reglas: apertura.reglas
                .filter(r => String(r.plantaKey) !== '98')
                .map(r => ({
                    plantaKey: String(r.plantaKey), servicioId: Number(r.servicioId),
                    tipoCalculo: r.tipoCalculo, valor: String(r.valor),
                    valorContado: r.valorContado == null ? '' : String(r.valorContado),
                    valorCredito: r.valorCredito == null ? '' : String(r.valorCredito),
                })),
        };
        await descuentos.guardarReglasDescuento(23, payload, { username: 'tester' });

        const reapertura = await descuentos.obtenerDetalleAdministracion(23);
        const sedes = [...new Set(reapertura.reglas.map(r => String(r.plantaKey)))].sort();
        assert.deepEqual(sedes, ['13', '160'], 'la sede 98 debe desaparecer del alcance');
        assert.equal(reapertura.reglas.length, 4);
    } finally {
        restaurarMocks();
    }
});

test('ciclo completo: quitar un servicio persiste el alcance reducido', async () => {
    estado = crearEstado();
    semillaCatalogo();
    semillaDescuento23Editable();
    instalarMocks();
    try {
        const apertura = await descuentos.obtenerDetalleAdministracion(23);

        // El usuario desmarca el servicio lógico GLP (ids 329, 406, 415).
        const payload = {
            reglas: apertura.reglas
                .filter(r => ![329, 406, 415].includes(Number(r.servicioId)))
                .map(r => ({
                    plantaKey: String(r.plantaKey), servicioId: Number(r.servicioId),
                    tipoCalculo: r.tipoCalculo, valor: String(r.valor),
                    valorContado: '', valorCredito: '',
                })),
        };
        await descuentos.guardarReglasDescuento(23, payload, { username: 'tester' });

        const reapertura = await descuentos.obtenerDetalleAdministracion(23);
        const servicios = reapertura.reglas.map(r => Number(r.servicioId)).sort((a, b) => a - b);
        assert.deepEqual(servicios, [328, 331, 414], 'sólo deben quedar los servicios GNV');
    } finally {
        restaurarMocks();
    }
});

test('el convenio fiscal protegido rechaza el guardado de reglas y no pierde sus valores', async () => {
    estado = crearEstado();
    semillaCatalogo();
    semillaDescuentoProtegido();
    instalarMocks();
    try {
        const payload = payloadConBeneficio([
            { plantaKey: '13', servicioId: 328, tipoCalculo: 'PORCENTAJE', valor: '100' },
        ], 'PORCENTAJE', 50);

        await assert.rejects(
            descuentos.guardarReglasDescuento(24, payload, { username: 'tester' }),
            error => error.message === 'CONVENIO_GRATUIDAD_PROTEGIDO' && error.statusCode === 409,
        );

        // La protección no debe alterar las reglas del convenio.
        const reapertura = await descuentos.obtenerDetalleAdministracion(24);
        assert.equal(reapertura.reglas.length, 2);
        assert.ok(reapertura.reglas.every(r => Number(r.valor) === 100), 'las reglas del convenio permanecen intactas');
    } finally {
        restaurarMocks();
    }
});
