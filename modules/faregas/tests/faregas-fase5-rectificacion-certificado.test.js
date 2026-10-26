const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.NODE_ENV = 'test';

const {
    aplicarPropuestaABorrador,
    construirSnapshotVersion,
    calcularDiferenciasRectificacion,
    advertenciasGestionExterna,
    tipoEspecifico
} = require('../services/faregas-rectificacion-datos');
const {
    _private,
    TIPO_RECTIFICACION
} = require('../services/faregas-rectificaciones.service');

const NUMERO_DG = 'DG-41-0000316';
const FECHA_EMISION = '2026-04-09';

const snapshotBase = (tipo = 'GNV_ANUAL') => ({
    esquema: 2,
    certificadoId: 316,
    numeroCertificado: NUMERO_DG,
    tipoCertificado: tipo,
    empresaKey: 'FAREGAS',
    plantaKey: 'SURCO',
    fechaEmisionOriginal: FECHA_EMISION,
    estado: 'EMITIDO',
    versionBase: 1,
    observaciones: 'OBSERVACION ORIGINAL',
    formatoDatosSnapshot: { taller: { nombre: 'TALLER ORIGINAL' } },
    vehiculo: {
        placa: 'ABC123',
        categoria: 'M1',
        clase: 'CAMIONETA',
        marca: 'TOYOTA',
        modelo: 'HILUX',
        version: '4X4',
        anio_fabricacion: 2020,
        anio_modelo: 2021,
        vin: 'VINORIGINAL123456',
        serie_chasis: 'CHASISORIGINAL',
        numero_motor: 'MOTORORIGINAL',
        combustible: 'GASOLINA',
        color: 'BLANCO',
        carroceria: 'PICK UP',
        numero_cilindros: '4',
        cilindrada: '2400',
        numero_ejes: '2',
        numero_ruedas: '4',
        numero_asientos: '5',
        numero_pasajeros: '5',
        longitud: '5.20',
        ancho: '1.80',
        alto: '1.75',
        peso_neto: '1500',
        peso_bruto: '2500',
        carga_util: '1000',
        potencia: '150',
        formula_rodante: '4X4'
    },
    titulares: [{
        id: 77,
        orden: 1,
        tipo_documento: 'DNI',
        nro_documento: '12345678',
        nombre_razon_social: 'JUAN PEREZ',
        direccion: 'AV. ORIGINAL 123'
    }],
    especifico: {
        taller_razon_social: 'TALLER AUTORIZADO ORIGINAL',
        taller_sede: 'SURQUILLO',
        taller_direccion: 'AV. TALLER 456',
        taller_codigo_autorizacion: 'COD-001',
        vigencia_hasta: '2026-04-09T00:00:00.000Z',
        modalidad: 'ANUAL',
        numero_chip: 'CHIP-001',
        combustible_posterior: 'BI - COMBUSTIBLE GNV',
        peso_neto_posterior: '1200',
        observaciones: 'OBSERVACION ORIGINAL',
        expediente_tecnico: 'EXP-001',
        carga_util_posterior: '800',
        tipo_conformidad: 'MODIFICACION',
        tipo_tramite: 'ORDINARIO',
        caracteristica_registrable: 'SISTEMA GNV',
        motivo: 'CONVERSION',
        descripcion: 'DESCRIPCION ORIGINAL',
        uso_original_vehiculo: 'MERCANCIAS',
        marca_modificacion: true,
        marca_montaje: false,
        marca_fabricacion: true
    },
    componentes: [{
        orden: 1,
        componente: 'CILINDRO',
        marca: 'FABER',
        modelo: 'F-1',
        capacidad_litros: '60',
        mes_fabricacion: 1,
        anio_fabricacion: 2020,
        numero_serie: 'SERIE-CIL-1'
    }],
    verificaciones: [{
        codigo: '01',
        orden: 1,
        descripcion: 'VERIFICACION ORIGINAL',
        cumple: true,
        observacion: 'CONFORME'
    }]
});

const borradorParaFusion = (snapshot, tipo) => ({
    ...snapshot,
    tipo: { clave: snapshot.tipoCertificado },
    especifico: snapshot.especifico,
    especificoBase: snapshot.especifico,
    formatoDatosSnapshot: snapshot.formatoDatosSnapshot,
    vehiculo: snapshot.vehiculo,
    titulares: snapshot.titulares,
    componentes: snapshot.componentes,
    verificaciones: snapshot.verificaciones,
    tipoCertificado: tipo || snapshot.tipoCertificado
});

const crearClienteFalso = (respuestas = {}) => {
    const consultas = [];
    return {
        consultas,
        async query(sql, params = []) {
            const normal = String(sql).replace(/\s+/g, ' ').trim();
            consultas.push({ sql: normal, params });
            for (const [fragmento, respuesta] of Object.entries(respuestas)) {
                if (normal.includes(fragmento)) {
                    return typeof respuesta === 'function' ? respuesta(params, normal) : respuesta;
                }
            }
            return { rows: [], rowCount: 0 };
        }
    };
};

test('GNV conserva número DG, fecha original y recupera todos los datos técnicos', () => {
    const original = snapshotBase('GNV_ANUAL');
    const { borrador } = aplicarPropuestaABorrador(borradorParaFusion(original, 'GNV'), {
        placa: 'XYZ987',
        vin: 'VINRECTIFICADO999',
        numero_motor: 'MOTORRECTIFICADO',
        vigencia_hasta: '2027-12-31',
        observaciones: 'OBSERVACION RECTIFICADA',
        componentes: [{
            orden: 1,
            componente: 'CILINDRO',
            marca: 'NUEVA MARCA',
            modelo: 'NUEVO MODELO',
            capacidad_litros: '80',
            mes_fabricacion: 2,
            anio_fabricacion: 2024,
            numero_serie: 'SERIE-NUEVA'
        }],
        verificaciones: [{
            codigo: '01',
            orden: 1,
            descripcion: 'VERIFICACION RECTIFICADA',
            cumple: false,
            observacion: 'OBSERVADA'
        }]
    });

    assert.equal(borrador.numeroCertificado, NUMERO_DG);
    assert.equal(borrador.fechaEmisionOriginal, FECHA_EMISION);
    assert.equal(borrador.tipo.clave, 'GNV_ANUAL');
    assert.equal(borrador.empresaKey, 'FAREGAS');
    assert.equal(borrador.plantaKey, 'SURCO');

    assert.equal(borrador.vehiculo.placa, 'XYZ987');
    assert.equal(borrador.vehiculo.vin, 'VINRECTIFICADO999');
    assert.equal(borrador.vehiculo.numero_motor, 'MOTORRECTIFICADO');
    assert.equal(borrador.vehiculo.marca, 'TOYOTA');
    assert.equal(borrador.vehiculo.modelo, 'HILUX');
    assert.equal(borrador.vehiculo.categoria, 'M1');

    assert.equal(borrador.titulares[0].nombre_razon_social, 'JUAN PEREZ');
    assert.equal(borrador.titulares[0].nro_documento, '12345678');
    assert.equal(borrador.especifico.taller_razon_social, 'TALLER AUTORIZADO ORIGINAL');
    assert.equal(borrador.especifico.taller_codigo_autorizacion, 'COD-001');
    assert.equal(borrador.especifico.numero_chip, 'CHIP-001');
    assert.equal(borrador.especifico.vigencia_hasta, '2027-12-31');
    assert.equal(borrador.especifico.observaciones, 'OBSERVACION RECTIFICADA');
    assert.equal(borrador.componentes[0].marca, 'NUEVA MARCA');
    assert.equal(borrador.componentes[0].numero_serie, 'SERIE-NUEVA');
    assert.equal(borrador.verificaciones[0].descripcion, 'VERIFICACION RECTIFICADA');
    assert.equal(borrador.verificaciones[0].cumple, false);
});

test('GLP conserva expediente, taller, componentes y verificaciones no editados', () => {
    const original = snapshotBase('GLP_ANUAL');
    const { borrador } = aplicarPropuestaABorrador(borradorParaFusion(original, 'GLP'), {
        placa: 'GLP999',
        expediente_tecnico: 'EXP-RECTIFICADO',
        vigencia_hasta: '2027-01-15',
        componentes: [{
            orden: 1,
            componente: 'TANQUE',
            marca: 'MARCA GLP',
            modelo: 'MODELO GLP',
            capacidad_litros: '100',
            mes_fabricacion: 3,
            anio_fabricacion: 2023,
            numero_serie: 'TANQUE-001'
        }]
    });

    assert.equal(borrador.numeroCertificado, NUMERO_DG);
    assert.equal(borrador.fechaEmisionOriginal, FECHA_EMISION);
    assert.equal(borrador.especifico.taller_razon_social, 'TALLER AUTORIZADO ORIGINAL');
    assert.equal(borrador.especifico.taller_sede, 'SURQUILLO');
    assert.equal(borrador.especifico.taller_direccion, 'AV. TALLER 456');
    assert.equal(borrador.especifico.expediente_tecnico, 'EXP-RECTIFICADO');
    assert.equal(borrador.especifico.carga_util_posterior, '800');
    assert.equal(borrador.vehiculo.marca, 'TOYOTA');
    assert.equal(borrador.componentes[0].componente, 'TANQUE');
    assert.equal(borrador.verificaciones[0].descripcion, 'VERIFICACION ORIGINAL');
});

test('Conformidad recupera y conserva todos los campos técnicos y marcas', () => {
    const original = snapshotBase('CONFORMIDAD');
    const { borrador } = aplicarPropuestaABorrador(borradorParaFusion(original, 'CONFORMIDAD'), {
        marca: 'NUEVA MARCA',
        tipo_conformidad: 'MONTAJE',
        tipo_tramite: 'RECTIFICACION',
        caracteristica_registrable: 'CARACTERISTICA CORREGIDA',
        motivo: 'MOTIVO CORREGIDO',
        descripcion: 'DESCRIPCION CORREGIDA',
        uso_original_vehiculo: 'MERCANCIAS'
    });

    assert.equal(borrador.numeroCertificado, NUMERO_DG);
    assert.equal(borrador.fechaEmisionOriginal, FECHA_EMISION);
    assert.equal(borrador.especifico.tipo_conformidad, 'MONTAJE');
    assert.equal(borrador.especifico.tipo_tramite, 'RECTIFICACION');
    assert.equal(borrador.especifico.caracteristica_registrable, 'CARACTERISTICA CORREGIDA');
    assert.equal(borrador.especifico.motivo, 'MOTIVO CORREGIDO');
    assert.equal(borrador.especifico.descripcion, 'DESCRIPCION CORREGIDA');
    assert.equal(borrador.especifico.marca_modificacion, true);
    assert.equal(borrador.especifico.marca_montaje, false);
    assert.equal(borrador.especifico.marca_fabricacion, true);
    assert.equal(borrador.titulares[0].nombre_razon_social, 'JUAN PEREZ');
});

test('el diff no inventa cambios de vigencia por timestamps de PostgreSQL', () => {
    const original = snapshotBase('GNV_ANUAL');
    const diferencias = calcularDiferenciasRectificacion(original, {
        placa: 'ABC124',
        vigencia_hasta: '2026-04-09',
        observaciones: 'OBSERVACION ORIGINAL'
    });

    assert.deepEqual(diferencias.map((d) => d.campo), ['placa']);
    assert.equal(diferencias[0].valorOriginal, 'ABC123');
    assert.equal(diferencias[0].valorPropuesto, 'ABC124');
});

test('el snapshot de versión conserva la fecha original y separa la fecha de auditoría', () => {
    const original = snapshotBase('GNV_ANUAL');
    const snapshot = construirSnapshotVersion({
        borrador: {
            ...original,
            id: original.certificadoId,
            tipo: { clave: original.tipoCertificado },
            fechaEmision: FECHA_EMISION
        },
        versionBase: 7,
        usuario: 'sistemas'
    });

    assert.equal(snapshot.numeroCertificado, NUMERO_DG);
    assert.equal(snapshot.fechaEmisionOriginal, FECHA_EMISION);
    assert.notEqual(snapshot.fechaSnapshot, FECHA_EMISION);
    assert.match(snapshot.fechaSnapshot, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(snapshot.versionBase, 7);
    assert.equal(snapshot.usuarioRectificacion, 'sistemas');
    assert.equal(snapshot.especifico.taller_razon_social, 'TALLER AUTORIZADO ORIGINAL');
    assert.equal(snapshot.componentes[0].numero_serie, 'SERIE-CIL-1');
    assert.equal(snapshot.verificaciones[0].codigo, '01');
});

test('la propuesta rechaza campos fiscales, comerciales y protegidos', () => {
    const prohibidos = [
        'numero_certificado',
        'fecha_emision',
        'empresa_key',
        'planta_key',
        'estado',
        'id',
        'facturacion_id',
        'comprobante_id',
        'pago_id',
        'correlativo',
        'precio',
        'importe',
        'moneda',
        'igv',
        'cliente_id'
    ];

    for (const campo of prohibidos) {
        assert.throws(
            () => _private.validarPropuestaParaTipo({ [campo]: 'X' }, 'GNV'),
            (error) => error.code === 'DATO_PROPUESTO_PROHIBIDO' || error.code === 'CAMPO_NO_RECTIFICABLE',
            `El campo ${campo} debe rechazarse`
        );
    }

    assert.throws(
        () => _private.validarPropuestaParaTipo({ campo_inventado: 'X' }, 'GNV'),
        (error) => error.code === 'CAMPO_NO_RECTIFICABLE'
    );
    assert.throws(
        () => _private.validarPropuestaParaTipo({ expediente_tecnico: 'EXP' }, 'GNV'),
        (error) => error.code === 'CAMPO_NO_RECTIFICABLE'
    );
    assert.doesNotThrow(() => _private.validarPropuestaParaTipo({ expediente_tecnico: 'EXP' }, 'GLP'));
    assert.doesNotThrow(() => _private.validarPropuestaParaTipo({ marca_modificacion: true }, 'CONFORMIDAD'));
});

test('la propuesta valida arrays, tamaño y tipo específico', () => {
    assert.throws(
        () => _private.validarPropuestaParaTipo({}, 'GNV'),
        (error) => error.code === 'DATOS_PROPUESTOS_REQUERIDOS'
    );
    assert.throws(
        () => _private.validarPropuestaParaTipo({ componentes: 'NO-ARRAY' }, 'GNV'),
        (error) => error.code === 'COMPONENTES_INVALIDOS'
    );
    assert.throws(
        () => _private.validarPropuestaParaTipo({ verificaciones: {} }, 'GLP'),
        (error) => error.code === 'VERIFICACIONES_INVALIDAS'
    );
    assert.throws(
        () => _private.validarPropuestaParaTipo({ datosFormato: [] }, 'GNV'),
        (error) => error.code === 'DATOS_FORMATO_INVALIDOS'
    );
    assert.throws(
        () => _private.validarPropuestaParaTipo({ observaciones: 'X'.repeat(60001) }, 'GNV'),
        (error) => error.code === 'DATOS_PROPUESTOS_DEMASIADO_GRANDES'
    );
    assert.equal(tipoEspecifico('GNV_ANUAL'), 'GNV');
    assert.equal(tipoEspecifico('GLP_ANUAL'), 'GLP');
    assert.equal(tipoEspecifico('CONFORMIDAD'), 'CONFORMIDAD');
    assert.equal(tipoEspecifico('INSPECCION_TALLER'), null);
});

test('bloquea anulados, no emitidos, anulación activa y rectificación activa', () => {
    const activas = [
        { id: 1, tipo_operacion: TIPO_RECTIFICACION, estado: 'APROBADA' },
        { id: 2, tipo_operacion: 'ANULAR_AMBOS', estado: 'PENDIENTE_APROBACION' }
    ];

    assert.deepEqual(
        _private.motivosBloqueoRectificacion({ estado: 'EMITIDO', fecha_anulacion: null }, []),
        []
    );

    const anulado = _private.motivosBloqueoRectificacion({ estado: 'ANULADO', fecha_anulacion: '2026-01-01' }, []);
    assert.ok(anulado.includes('CERTIFICADO_ANULADO'));

    const borrador = _private.motivosBloqueoRectificacion({ estado: 'BORRADOR', fecha_anulacion: null }, []);
    assert.ok(borrador.includes('CERTIFICADO_NO_EMITIDO_O_NO_RECTIFICABLE'));

    const conAnulacion = _private.motivosBloqueoRectificacion({ estado: 'EMITIDO', fecha_anulacion: null }, activas);
    assert.ok(conAnulacion.includes('ANULACION_EN_CURSO'));
    assert.ok(conAnulacion.includes('RECTIFICACION_EN_CURSO'));

    assert.deepEqual(_private.motivosBloqueoRectificacion(null, []), ['CERTIFICADO_NO_ENCONTRADO']);
});

test('aplicarSnapshotTecnico escribe sólo tablas técnicas y jamás número, fecha ni fiscalidad', async () => {
    const client = crearClienteFalso();
    const snapshot = snapshotBase('GNV_ANUAL');

    await _private.aplicarSnapshotTecnico(client, snapshot.certificadoId, snapshot, 'sistemas');

    const sql = client.consultas.map((q) => q.sql);
    assert.ok(sql.some((q) => q.startsWith('UPDATE fg_certificado SET')));
    assert.ok(sql.some((q) => q.startsWith('INSERT INTO fg_certificado_vehiculo')));
    assert.ok(sql.some((q) => q.startsWith('UPDATE fg_certificado_titular')));
    assert.ok(sql.some((q) => q.startsWith('INSERT INTO fg_certificado_gnv (')));
    assert.ok(sql.some((q) => q.startsWith('DELETE FROM fg_certificado_gnv_componente')));
    assert.ok(sql.some((q) => q.startsWith('DELETE FROM fg_certificado_gnv_verificacion')));

    const actualizacionCertificado = sql.find((q) => q.startsWith('UPDATE fg_certificado SET'));
    assert.ok(actualizacionCertificado);
    assert.doesNotMatch(actualizacionCertificado, /numero_certificado/i);
    assert.doesNotMatch(actualizacionCertificado, /fecha_emision/i);
    assert.doesNotMatch(actualizacionCertificado, /facturacion/i);
    assert.doesNotMatch(actualizacionCertificado, /correlativo/i);

    assert.ok(!sql.some((q) => /fg_facturacion/i.test(q)));
    assert.ok(!sql.some((q) => /fg_pago/i.test(q)));
    assert.ok(!sql.some((q) => /fg_correlativo/i.test(q)));
    assert.ok(!sql.some((q) => /fg_cliente/i.test(q)));
    assert.ok(!sql.some((q) => /nubefact/i.test(q)));

    const insertGnv = client.consultas.find((q) => q.sql.startsWith('INSERT INTO fg_certificado_gnv ('));
    assert.equal(insertGnv.params[0], snapshot.certificadoId);
    assert.equal(insertGnv.params[1], null);
    assert.equal(insertGnv.params[2], FECHA_EMISION);
    assert.equal(insertGnv.params[3], 'TALLER AUTORIZADO ORIGINAL');
    assert.equal(insertGnv.params[8], 'CHIP-001');
    assert.equal(insertGnv.params[12], null);

    const insertComponente = client.consultas.find((q) => q.sql.startsWith('INSERT INTO fg_certificado_gnv_componente'));
    assert.equal(insertComponente.params[3], 'FABER');
    assert.equal(insertComponente.params[8], 'SERIE-CIL-1');
});

test('la versión original existente y su PDF no se sobrescriben', async () => {
    const existente = {
        id: 1,
        certificado_id: 316,
        numero_version: 1,
        estado_version: 'ORIGINAL',
        enlace_pdf_original: 'uploads/faregas/certificados-versiones/316/v1.pdf'
    };
    const client = crearClienteFalso({
        'FROM fg_certificado_version': { rows: [existente], rowCount: 1 }
    });
    const snapshot = snapshotBase('GNV_ANUAL');

    const version = await _private.asegurarVersionOriginal(
        client,
        { id: 316, fecha_emision: FECHA_EMISION, usuario_creacion: 'operador' },
        snapshot,
        'sistemas',
        { enlace: 'NO-DEBE-USARSE.pdf' }
    );

    assert.equal(version, existente);
    assert.equal(client.consultas.length, 1);
    assert.match(client.consultas[0].sql, /^SELECT/);
    assert.equal(version.enlace_pdf_original, existente.enlace_pdf_original);
});

test('si la versión original no tenía PDF se enlaza el generado sin cambiar su snapshot', async () => {
    const existente = {
        id: 1,
        certificado_id: 316,
        numero_version: 1,
        estado_version: 'ORIGINAL',
        enlace_pdf_original: null,
        snapshot_datos: { original: true }
    };
    const client = crearClienteFalso({
        'FROM fg_certificado_version': { rows: [existente], rowCount: 1 },
        'UPDATE fg_certificado_version': (params) => ({
            rows: [{ ...existente, enlace_pdf_original: params[1] }],
            rowCount: 1
        })
    });
    const snapshot = snapshotBase('GNV_ANUAL');

    const version = await _private.asegurarVersionOriginal(
        client,
        { id: 316, fecha_emision: FECHA_EMISION, usuario_creacion: 'operador' },
        snapshot,
        'sistemas',
        { enlace: 'uploads/faregas/certificados-versiones/316/v1.pdf' }
    );

    assert.equal(version.enlace_pdf_original, 'uploads/faregas/certificados-versiones/316/v1.pdf');
    assert.equal(client.consultas.length, 2);
    assert.match(client.consultas[1].sql, /^UPDATE fg_certificado_version/);
    assert.deepEqual(existente.snapshot_datos, { original: true });
});

test('la primera rectificación crea la versión ORIGINAL inmutable con la fecha de emisión original', async () => {
    const client = crearClienteFalso({
        'FROM fg_certificado_version': { rows: [], rowCount: 0 },
        'INSERT INTO fg_certificado_version': (params) => ({
            rows: [{
                id: 1,
                certificado_id: params[0],
                numero_version: 1,
                estado_version: 'ORIGINAL',
                fecha_emision_original: params[1],
                enlace_pdf_original: params[5]
            }],
            rowCount: 1
        })
    });
    const snapshot = snapshotBase('GNV_ANUAL');

    const version = await _private.asegurarVersionOriginal(
        client,
        { id: 316, fecha_emision: FECHA_EMISION, usuario_creacion: 'operador' },
        snapshot,
        'sistemas',
        { enlace: 'uploads/faregas/certificados-versiones/316/v1.pdf' }
    );

    assert.equal(version.fecha_emision_original, FECHA_EMISION);
    assert.equal(version.enlace_pdf_original, 'uploads/faregas/certificados-versiones/316/v1.pdf');
    const insert = client.consultas.find((q) => q.sql.startsWith('INSERT INTO fg_certificado_version'));
    assert.equal(insert.params[0], 316);
    assert.equal(insert.params[1], FECHA_EMISION);
    assert.equal(insert.params[2], 'operador');
    assert.match(insert.params[3], /Versión original/);
    assert.equal(JSON.parse(insert.params[4]).fechaEmisionOriginal, FECHA_EMISION);
    assert.doesNotMatch(insert.sql, /fecha_aplicacion_oficial/);
});

test('advertencias externas no bloquean la corrección local pero sí la informan', () => {
    const advertencias = advertenciasGestionExterna([
        { campo: 'placa' },
        { campo: 'vin' },
        { campo: 'modelo' }
    ]);

    assert.equal(advertencias.length, 3);
    assert.match(advertencias.join(' '), /SUNARP|MTC/);
    assert.deepEqual(advertenciasGestionExterna([{ campo: 'color' }]), []);
});

test('el servicio de rectificación mantiene bloqueo, versionado e idempotencia sin motor fiscal', () => {
    const rutaServicio = path.join(__dirname, '..', 'services', 'faregas-rectificaciones.service.js');
    const rutaPdf = path.join(__dirname, '..', 'services', 'faregas-rectificacion-pdf.service.js');
    const rutaControlador = path.join(__dirname, '..', 'controllers', 'faregas-rectificaciones.controller.js');
    const servicio = fs.readFileSync(rutaServicio, 'utf8');
    const pdf = fs.readFileSync(rutaPdf, 'utf8');
    const controlador = fs.readFileSync(rutaControlador, 'utf8');
    const todo = `${servicio}\n${pdf}\n${controlador}`
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');

    assert.match(servicio, /FOR UPDATE OF s/);
    assert.match(servicio, /FOR UPDATE OF c/);
    assert.match(servicio, /tienePdfOriginal/);
    assert.match(servicio, /RECTIFICACION_EJECUTADA/);
    assert.match(servicio, /CERTIFICADO_MODIFICADO_DESDE_SOLICITUD/);
    assert.match(servicio, /idempotencia_ejecucion/);
    assert.match(servicio, /SIN_CAMBIOS_PARA_RECTIFICAR/);
    assert.match(servicio, /ESTADOS_RECTIFICABLES/);
    assert.doesNotMatch(todo, /nubefact/i);
    assert.doesNotMatch(todo, /UPDATE\s+fg_facturacion/i);
    assert.doesNotMatch(todo, /INSERT\s+INTO\s+fg_facturacion/i);
    assert.doesNotMatch(todo, /UPDATE\s+fg_pago/i);
    assert.doesNotMatch(todo, /fg_correlativo/i);
    assert.doesNotMatch(todo, /CURRENT_DATE/i);
    assert.doesNotMatch(todo, /\bNOW\(\)/i);
    assert.match(pdf, /certificados-versiones/);
    assert.match(controlador, /descargarPdfVersion/);
});

test('el esquema garantiza una sola versión vigente por certificado', () => {
    const schema = fs.readFileSync(
        path.join(__dirname, '..', 'database', 'migrations', '0001_faregas_schema.sql'),
        'utf8'
    );

    assert.match(schema, /CREATE UNIQUE INDEX uq_fg_cert_ver_unica_vigente/);
    assert.match(schema, /WHERE es_vigente = TRUE/);
    assert.match(schema, /CONSTRAINT uq_fg_certificado_version_num UNIQUE \(certificado_id, numero_version\)/);
    assert.match(schema, /FAREGAS_CERTIFICADO_RECTIFICAR_EJECUTAR/);
});

test('la rectificación directa exige el permiso técnico explícito', () => {
    assert.doesNotThrow(() => _private.exigirPermisoExplicito(
        new Set(['FAREGAS_CERTIFICADO_RECTIFICAR_EJECUTAR']),
        'FAREGAS_CERTIFICADO_RECTIFICAR_EJECUTAR'
    ));
    assert.throws(
        () => _private.exigirPermisoExplicito(
            new Set(['FAREGAS_SOLICITUD_ADMINISTRAR']),
            'FAREGAS_CERTIFICADO_RECTIFICAR_EJECUTAR'
        ),
        (error) => error.code === 'SOLICITUD_PERMISO_DENEGADO' && error.statusCode === 403
    );
});

test('el endpoint directo omite aprobación externa y reutiliza la ejecución idempotente', () => {
    const backendRoot = path.resolve(__dirname, '..');
    const servicio = fs.readFileSync(path.join(backendRoot, 'services', 'faregas-rectificaciones.service.js'), 'utf8');
    const rutas = fs.readFileSync(path.join(backendRoot, 'routes', 'faregas-certificados.routes.js'), 'utf8');
    const controlador = fs.readFileSync(path.join(backendRoot, 'controllers', 'faregas-rectificaciones.controller.js'), 'utf8');
    const inicio = servicio.indexOf('const ejecutarRectificacionDirecta');
    const fin = servicio.indexOf('\nconst upsertVehiculo', inicio);
    const flujoDirecto = servicio.slice(inicio, fin);

    assert.ok(inicio >= 0 && fin > inicio);
    assert.match(flujoDirecto, /directa: true/);
    assert.match(flujoDirecto, /ejecutarRectificacionSolicitud/);
    assert.doesNotMatch(flujoDirecto, /SOLICITUD_APROBAR|NubeFact|fg_pago|fg_facturacion|fg_correlativo/i);
    assert.match(rutas, /rectificacion\/directa/);
    assert.match(controlador, /RECTIFICACION_DIRECTA_EJECUTADA/);
});

test('el registro directo nace aprobado y nunca pendiente de aprobación', () => {
    const servicio = fs.readFileSync(
        path.join(__dirname, '..', 'services', 'faregas-rectificaciones.service.js'),
        'utf8'
    );
    assert.match(servicio, /rectificacionDirecta \? 'APROBADA' : 'PENDIENTE_APROBACION'/);
    assert.match(servicio, /Rectificación directa iniciada sin cambios fiscales ni aprobación externa/);
});
