const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';

const db = require('../../../config/database');
const authService = require('../services/faregas-auth.service');
const certificados = require('../services/faregas-certificados.service');

const crearCliente = ({ onVehiculo, onConformidad }) => ({
    async query(sql, params = []) {
        const texto = String(sql);
        if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(texto)) return { rowCount: 0, rows: [] };
        if (texto.includes('SELECT estado, planta_key FROM fg_certificado WHERE id = $1 FOR UPDATE')) {
            return { rowCount: 1, rows: [{ estado: 'BORRADOR', planta_key: '160' }] };
        }
        if (texto.includes('SELECT estado, planta_key, tipo_certificado_clave FROM fg_certificado')) {
            return {
                rowCount: 1,
                rows: [{ estado: 'BORRADOR', planta_key: '160', tipo_certificado_clave: 'CONFORMIDAD' }]
            };
        }
        if (texto.includes('SELECT 1') && texto.includes('FROM fg_facturacion')) {
            return { rowCount: 0, rows: [] };
        }
        if (texto.includes('SELECT c.tipo_certificado_clave') && texto.includes('glp_modalidad')) {
            return { rowCount: 1, rows: [{ tipo_certificado_clave: 'CONFORMIDAD', glp_modalidad: 'UNICA' }] };
        }
        if (texto.includes('INSERT INTO fg_certificado_vehiculo')) {
            onVehiculo?.(params);
            return { rowCount: 1, rows: [] };
        }
        if (texto.includes('INSERT INTO fg_certificado_conformidad')) {
            onConformidad?.(params);
            return { rowCount: 1, rows: [] };
        }
        return { rowCount: 0, rows: [] };
    },
    release() {}
});

test('Conformidad persiste caracteres técnicos y conserva cilindrada cero', async () => {
    const originalConnect = db.connect;
    const originalValidarPlanta = authService.validarAccesoPlanta;
    let vehiculoParams;

    db.connect = async () => crearCliente({ onVehiculo: (params) => { vehiculoParams = params; } });
    authService.validarAccesoPlanta = async () => true;

    try {
        await certificados.guardarVehiculoBorrador(901, {
            placa: 'ABC123',
            modelo: 'GL-1.6/AT',
            version: 'SPORT-1/2',
            vin: 'KMHCT41BAGU99****',
            numeroMotor: 'ABC-123/456',
            numeroCilindros: '03',
            cilindrada: 0,
            potencia: '75 kW @ 4500 RPM'
        }, { username: 'test', perfil_id: 1 });

        assert.ok(vehiculoParams);
        assert.equal(vehiculoParams[5], 'GL-1.6/AT');
        assert.equal(vehiculoParams[6], 'SPORT-1/2');
        assert.equal(vehiculoParams[9], 'KMHCT41BAGU99****');
        assert.equal(vehiculoParams[11], 'ABC-123/456');
        assert.equal(vehiculoParams[16], 0);
        assert.equal(vehiculoParams[27], '75 kW @ 4500 RPM');
    } finally {
        db.connect = originalConnect;
        authService.validarAccesoPlanta = originalValidarPlanta;
    }
});

test('Conformidad persiste la rectificación como texto libre exacto', async () => {
    const originalConnect = db.connect;
    const originalValidarPlanta = authService.validarAccesoPlanta;
    let conformidadParams;

    db.connect = async () => crearCliente({ onConformidad: (params) => { conformidadParams = params; } });
    authService.validarAccesoPlanta = async () => true;

    try {
        await certificados.guardarConformidad(901, {
            tipoConformidad: 'MODIFICACION',
            caracteristicaRegistrable: 'Rectificación de color / modelo-1',
            usoOriginalVehiculo: 'PERSONAS'
        }, { username: 'test', perfil_id: 1 });

        assert.ok(conformidadParams);
        assert.equal(conformidadParams[3], 'Rectificación de color / modelo-1');
    } finally {
        db.connect = originalConnect;
        authService.validarAccesoPlanta = originalValidarPlanta;
    }
});

test('Conformidad conserva un uso histórico al guardar el borrador sin sustituirlo silenciosamente', async () => {
    const originalConnect = db.connect;
    const originalValidarPlanta = authService.validarAccesoPlanta;
    let conformidadParams;

    db.connect = async () => crearCliente({ onConformidad: (params) => { conformidadParams = params; } });
    authService.validarAccesoPlanta = async () => true;

    try {
        await certificados.guardarConformidad(902, {
            tipoConformidad: 'MODIFICACION',
            caracteristicaRegistrable: 'Cambio de motor / carrocería-1',
            usoOriginalVehiculo: 'MIXTO'
        }, { username: 'test', perfil_id: 1 });

        assert.ok(conformidadParams);
        assert.equal(conformidadParams[3], 'Cambio de motor / carrocería-1');
        assert.equal(conformidadParams[6], 'MIXTO');
    } finally {
        db.connect = originalConnect;
        authService.validarAccesoPlanta = originalValidarPlanta;
    }
});

test('Conformidad bloquea la emisión de un uso histórico hasta elegir PERSONAS o MERCANCÍAS', async () => {
    const originalQuery = db.query;
    const originalValidarPlanta = authService.validarAccesoPlanta;
    const vehiculoCompleto = {
        placa: 'ABC123', vin: 'KMHCT41BAGU99****', clase: 'M1', categoria: 'M1',
        modelo: 'GL-1.6/AT', marca: 'HYUNDAI', numero_motor: 'ABC-123/456', color: 'ROJO',
        carroceria: 'SEDAN', combustible: 'GASOLINA', longitud: '4.3', ancho: '1.7', alto: '1.4',
        peso_bruto: '1600', peso_neto: '1200', carga_util: '400', anio_fabricacion: '2020',
        anio_modelo: '2021', formula_rodante: '4x2', potencia: '41.00@5500', numero_ejes: 2,
        numero_ruedas: 4, numero_asientos: 5, numero_pasajeros: 4, cilindrada: '796.000',
        numero_cilindros: 4, version: 'SPORT-1/2'
    };

    db.query = async (sql) => {
        const texto = String(sql);
        if (texto.includes('FROM fg_certificado c') && texto.includes('JOIN fg_tipo_certificado')) {
            return {
                rowCount: 1,
                rows: [{
                    id: 903, estado: 'BORRADOR', planta_key: '160', tipo_clave: 'CONFORMIDAD',
                    formato_motor: 'SISTEMA', formato_es_protegido: true, producto_chip_id: null
                }]
            };
        }
        if (texto.includes('FROM fg_certificado_vehiculo')) return { rowCount: 1, rows: [vehiculoCompleto] };
        if (texto.includes('FROM fg_certificado_titular')) {
            return { rowCount: 1, rows: [{ tipo_documento: 'DNI', nro_documento: '12345678', nombre_razon_social: 'CLIENTE' }] };
        }
        if (texto.includes('FROM fg_facturacion')) return { rowCount: 0, rows: [] };
        if (texto.includes('FROM fg_orden_pago')) return { rowCount: 0, rows: [] };
        if (texto.includes('FROM fg_certificado_conformidad')) {
            return {
                rowCount: 1,
                rows: [{
                    tipo_conformidad: 'MODIFICACION',
                    caracteristica_registrable: 'CAMBIO DE MOTOR',
                    uso_original_vehiculo: 'MIXTO'
                }]
            };
        }
        return { rowCount: 0, rows: [] };
    };
    authService.validarAccesoPlanta = async () => true;

    try {
        const resultado = await certificados.validarEmision(903, { username: 'test', perfil_id: 1 });
        assert.ok(resultado.errores.some((error) => (
            error.codigo === 'USO_ORIGINAL_INVALIDO'
            && error.campo === 'uso_original_vehiculo'
        )));
    } finally {
        db.query = originalQuery;
        authService.validarAccesoPlanta = originalValidarPlanta;
    }
});

test('Conformidad permite emitir sin tipo_conformidad (selector desvinculado) si cuenta con caracteristica y uso valido', async () => {
    const originalQuery = db.query;
    const originalValidarPlanta = authService.validarAccesoPlanta;
    const vehiculoCompleto = {
        placa: 'ABC123', vin: 'KMHCT41BAGU99****', clase: 'M1', categoria: 'M1',
        modelo: 'GL-1.6/AT', marca: 'HYUNDAI', numero_motor: 'ABC-123/456', color: 'ROJO',
        carroceria: 'SEDAN', combustible: 'GASOLINA', longitud: '4.3', ancho: '1.7', alto: '1.4',
        peso_bruto: '1600', peso_neto: '1200', carga_util: '400', anio_fabricacion: '2020',
        anio_modelo: '2021', formula_rodante: '4x2', potencia: '41.00@5500', numero_ejes: 2,
        numero_ruedas: 4, numero_asientos: 5, numero_pasajeros: 4, cilindrada: '796.000',
        numero_cilindros: 4, version: 'SPORT-1/2'
    };

    db.query = async (sql) => {
        const texto = String(sql);
        if (texto.includes('FROM fg_certificado c') && texto.includes('JOIN fg_tipo_certificado')) {
            return {
                rowCount: 1,
                rows: [{
                    id: 904, estado: 'BORRADOR', planta_key: '160', tipo_clave: 'CONFORMIDAD',
                    formato_motor: 'SISTEMA', formato_es_protegido: true, producto_chip_id: null
                }]
            };
        }
        if (texto.includes('FROM fg_certificado_vehiculo')) return { rowCount: 1, rows: [vehiculoCompleto] };
        if (texto.includes('FROM fg_certificado_titular')) {
            return { rowCount: 1, rows: [{ tipo_documento: 'DNI', nro_documento: '12345678', nombre_razon_social: 'CLIENTE' }] };
        }
        if (texto.includes('FROM fg_facturacion')) return { rowCount: 0, rows: [] };
        if (texto.includes('FROM fg_orden_pago')) return { rowCount: 0, rows: [] };
        if (texto.includes('FROM fg_certificado_conformidad')) {
            return {
                rowCount: 1,
                rows: [{
                    tipo_conformidad: null,
                    caracteristica_registrable: 'RECTIFICACIÓN DE CARACTERÍSTICAS',
                    uso_original_vehiculo: 'PERSONAS'
                }]
            };
        }
        return { rowCount: 0, rows: [] };
    };
    authService.validarAccesoPlanta = async () => true;

    try {
        const resultado = await certificados.validarEmision(904, { username: 'test', perfil_id: 1 });
        const errorTipo = resultado.errores.find((e) => e.campo === 'tipo_conformidad');
        assert.equal(errorTipo, undefined, 'No debe exigir tipo_conformidad para emitir');
    } finally {
        db.query = originalQuery;
        authService.validarAccesoPlanta = originalValidarPlanta;
    }
});

test('Conformidad en PDF conserva la tabla type-box de 3 filas y 2 columnas con MODIFICACION, MONTAJE y FABRICACION sin marcas arbitrarias', () => {
    const generateConformidadHtml = require('../templates/conformidad.template');
    const html = generateConformidadHtml({
        cabecera: { numero_certificado: '001-9999' },
        vehiculo: { placa: 'XYZ-789', clase: 'M1' },
        conformidad: {
            caracteristica_registrable: 'RECTIFICACION DE COLOR',
            uso_original_vehiculo: 'PERSONAS'
        }
    });

    assert.ok(html.includes('<table class="type-box">'), 'El PDF debe conservar la tabla type-box');
    assert.ok(html.includes('MODIFICACION'), 'Debe contener la fila MODIFICACION');
    assert.ok(html.includes('MONTAJE'), 'Debe contener la fila MONTAJE');
    assert.ok(html.includes('FABRICACION'), 'Debe contener la fila FABRICACION');
    assert.equal(html.includes('class="active"'), false, 'Ninguna opción debe marcarse como activa arbitrariamente');

    // Comprobar filas de la tabla
    const tablaMatch = html.match(/<table class="type-box">([\s\S]*?)<\/table>/);
    assert.ok(tablaMatch, 'Debe encontrarse el bloque de la tabla');
    const filas = tablaMatch[1].match(/<tr>/g) || [];
    assert.equal(filas.length, 3, 'La tabla debe tener exactamente 3 filas');
    const columnas = tablaMatch[1].match(/<td/g) || [];
    assert.equal(columnas.length, 6, 'La tabla debe tener exactamente 6 celdas (3 filas x 2 columnas)');
});

