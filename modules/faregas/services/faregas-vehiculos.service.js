const db = require('../../../config/database');
const farenetReadAdapter = require('../integrations/farenet-read.adapter');
const vehicleLookupDebug = require('../utils/vehiculo-lookup-debug');

const CAMPOS_VEHICULO = Object.freeze([
    'placa', 'categoria', 'clase', 'marca', 'modelo', 'version',
    'anioFabricacion', 'anioModelo', 'vin', 'serieChasis', 'numeroMotor',
    'combustible', 'color', 'carroceria', 'numeroCilindros', 'cilindrada',
    'numeroEjes', 'numeroRuedas', 'numeroAsientos', 'numeroPasajeros',
    'longitud', 'ancho', 'alto', 'pesoNeto', 'pesoBruto', 'cargaUtil',
    'potencia', 'formulaRodante'
]);

const tieneValor = (valor) => valor !== null
    && valor !== undefined
    && String(valor).trim() !== '';

const normalizarPlaca = (placa) => String(placa || '').trim().toUpperCase();

const mapVehiculoFaregas = (row) => row ? ({
    placa: row.placa,
    categoria: row.categoria,
    clase: row.clase,
    marca: row.marca,
    modelo: row.modelo,
    version: row.version,
    anioFabricacion: row.anio_fabricacion,
    anioModelo: row.anio_modelo,
    vin: row.vin,
    serieChasis: row.serie_chasis,
    numeroMotor: row.numero_motor,
    combustible: row.combustible,
    color: row.color,
    carroceria: row.carroceria,
    numeroCilindros: row.numero_cilindros,
    cilindrada: row.cilindrada,
    numeroEjes: row.numero_ejes,
    numeroRuedas: row.numero_ruedas,
    numeroAsientos: row.numero_asientos,
    numeroPasajeros: row.numero_pasajeros,
    longitud: row.longitud,
    ancho: row.ancho,
    alto: row.alto,
    pesoNeto: row.peso_neto,
    pesoBruto: row.peso_bruto,
    cargaUtil: row.carga_util,
    potencia: row.potencia,
    formulaRodante: row.formula_rodante
}) : null;

const buscarMaestroPorPlaca = async (placa, executor = db) => {
    const placaNormalizada = normalizarPlaca(placa);
    if (!placaNormalizada) return null;

    const resultado = await executor.query(`
        SELECT *
        FROM fg_vehiculo
        WHERE placa_normalizada = $1
        LIMIT 1
    `, [placaNormalizada]);
    return resultado.rows[0] || null;
};

const buscarSnapshotLegacyPorPlaca = async (placa, excludeCertificadoId, executor = db) => {
    const placaNormalizada = normalizarPlaca(placa);
    if (!placaNormalizada) return null;

    const resultado = await executor.query(`
        WITH candidatos AS (
            SELECT
                v.*,
                c.estado,
                c.fecha_emision,
                c.fecha_creacion,
                (
                    CASE WHEN NULLIF(BTRIM(v.marca), '') IS NOT NULL THEN 1 ELSE 0 END +
                    CASE WHEN NULLIF(BTRIM(v.modelo), '') IS NOT NULL THEN 1 ELSE 0 END +
                    CASE WHEN NULLIF(BTRIM(v.anio_fabricacion), '') IS NOT NULL THEN 1 ELSE 0 END +
                    CASE WHEN NULLIF(BTRIM(v.numero_motor), '') IS NOT NULL THEN 1 ELSE 0 END +
                    CASE WHEN NULLIF(BTRIM(v.combustible), '') IS NOT NULL THEN 1 ELSE 0 END +
                    CASE WHEN NULLIF(BTRIM(v.vin), '') IS NOT NULL
                              OR NULLIF(BTRIM(v.serie_chasis), '') IS NOT NULL THEN 1 ELSE 0 END +
                    CASE WHEN NULLIF(BTRIM(v.clase), '') IS NOT NULL THEN 1 ELSE 0 END +
                    CASE WHEN NULLIF(BTRIM(v.carroceria), '') IS NOT NULL THEN 1 ELSE 0 END +
                    CASE WHEN v.numero_ejes IS NOT NULL THEN 1 ELSE 0 END +
                    CASE WHEN v.numero_ruedas IS NOT NULL THEN 1 ELSE 0 END
                ) AS completitud
            FROM fg_certificado_vehiculo v
            JOIN fg_certificado c ON c.id = v.certificado_id
            WHERE UPPER(BTRIM(v.placa)) = $1
              AND ($2::BIGINT IS NULL OR v.certificado_id <> $2::BIGINT)
        )
        SELECT *
        FROM candidatos
        WHERE completitud >= 5
        ORDER BY
            CASE WHEN estado = 'EMITIDO' THEN 0 ELSE 1 END,
            CASE WHEN estado = 'EMITIDO' THEN fecha_emision END DESC NULLS LAST,
            fecha_creacion DESC,
            completitud DESC
        LIMIT 1
    `, [placaNormalizada, excludeCertificadoId || null]);
    return resultado.rows[0] || null;
};

const buscarCertificadoCompatiblePorPlaca = async (placa, tipoCertificado, excludeCertificadoId, executor = db) => {
    const placaNormalizada = normalizarPlaca(placa);
    if (!placaNormalizada || !tipoCertificado) return null;

    const resultado = await executor.query(`
        SELECT
            c.id,
            c.estado,
            c.fecha_emision,
            c.fecha_creacion
        FROM fg_certificado_vehiculo v
        JOIN fg_certificado c ON c.id = v.certificado_id
        WHERE UPPER(BTRIM(v.placa)) = $1
          AND c.tipo_certificado_clave = $2
          AND ($3::BIGINT IS NULL OR c.id <> $3::BIGINT)
          AND (
              c.estado = 'EMITIDO' OR (
                  ($2 = 'CONFORMIDAD' AND EXISTS(
                      SELECT 1 FROM fg_certificado_conformidad 
                      WHERE certificado_id = c.id
                        AND NULLIF(BTRIM(tipo_conformidad), '') IS NOT NULL
                        AND NULLIF(BTRIM(tipo_tramite), '') IS NOT NULL
                        AND NULLIF(BTRIM(caracteristica_registrable), '') IS NOT NULL
                        AND NULLIF(BTRIM(motivo), '') IS NOT NULL
                        AND NULLIF(BTRIM(descripcion), '') IS NOT NULL
                  )) OR
                  ($2 LIKE 'GLP%' AND EXISTS(
                      SELECT 1 FROM fg_certificado_glp 
                      WHERE certificado_id = c.id
                        AND taller_autorizado_id IS NOT NULL
                        AND vigencia_hasta IS NOT NULL
                        AND NULLIF(BTRIM(expediente_tecnico), '') IS NOT NULL
                  )) OR
                  ($2 LIKE 'GNV%' AND EXISTS(
                      SELECT 1 FROM fg_certificado_gnv 
                      WHERE certificado_id = c.id
                        AND taller_autorizado_id IS NOT NULL
                        AND vigencia_hasta IS NOT NULL
                  )) OR
                  ($2 NOT LIKE 'GLP%' AND $2 NOT LIKE 'GNV%' AND $2 <> 'CONFORMIDAD')
              )
          )
        ORDER BY
            CASE WHEN c.estado = 'EMITIDO' THEN 0 ELSE 1 END,
            CASE WHEN c.estado = 'EMITIDO' THEN c.fecha_emision END DESC NULLS LAST,
            c.fecha_creacion DESC
        LIMIT 1
    `, [placaNormalizada, tipoCertificado, excludeCertificadoId || null]);
    return resultado.rows[0]?.id || null;
};


const combinarVehiculos = (vehiculoFaregas, vehiculoFarenet) => {
    if (!vehiculoFaregas && !vehiculoFarenet) {
        return { vehiculo: null, origen: null, completadoDesdeFarenet: false };
    }
    if (!vehiculoFaregas) {
        return { vehiculo: vehiculoFarenet, origen: 'FARENET', completadoDesdeFarenet: false };
    }

    const combinado = {};
    let completadoDesdeFarenet = false;
    for (const campo of CAMPOS_VEHICULO) {
        if (tieneValor(vehiculoFaregas[campo])) {
            combinado[campo] = vehiculoFaregas[campo];
        } else if (tieneValor(vehiculoFarenet?.[campo])) {
            combinado[campo] = vehiculoFarenet[campo];
            completadoDesdeFarenet = true;
        } else {
            combinado[campo] = vehiculoFaregas[campo] ?? vehiculoFarenet?.[campo] ?? null;
        }
    }

    return {
        vehiculo: combinado,
        origen: completadoDesdeFarenet ? 'MIXTO' : 'FAREGAS',
        completadoDesdeFarenet
    };
};

const resolverVehiculoPorPlaca = async (placa, { excludeCertificadoId = null } = {}) => {
    vehicleLookupDebug.log('FG_VEHICULO_START');
    vehicleLookupDebug.log('SNAPSHOT_START');
    const [maestro, snapshotLegacy] = await Promise.all([
        buscarMaestroPorPlaca(placa).then((value) => {
            vehicleLookupDebug.log('FG_VEHICULO_RESULT', { found: Boolean(value) });
            return value;
        }, (error) => {
            vehicleLookupDebug.logError('FG_VEHICULO_ERROR', error);
            throw error;
        }),
        buscarSnapshotLegacyPorPlaca(placa, excludeCertificadoId).then((value) => {
            vehicleLookupDebug.log('SNAPSHOT_RESULT', { found: Boolean(value) });
            return value;
        }, (error) => {
            vehicleLookupDebug.logError('SNAPSHOT_ERROR', error);
            throw error;
        })
    ]);

    let vehiculoFarenet = null;
    let errorFarenet = null;
    try {
        vehicleLookupDebug.log('FARENET_START');
        vehiculoFarenet = await farenetReadAdapter.buscarVehiculoPorPlaca(placa);
        vehicleLookupDebug.log('FARENET_RESULT', { found: Boolean(vehiculoFarenet) });
    } catch (error) {
        errorFarenet = error;
        vehicleLookupDebug.logError('FARENET_ERROR', error);
    }

    const filaFaregas = maestro || snapshotLegacy;
    const combinado = combinarVehiculos(mapVehiculoFaregas(filaFaregas), vehiculoFarenet);
    if (!combinado.vehiculo && errorFarenet) throw errorFarenet;

    return {
        ...combinado,
        maestroEncontrado: Boolean(maestro),
        snapshotLegacyId: snapshotLegacy?.certificado_id || null,
        errorFarenet
    };
};

const sincronizarMaestroDesdeSnapshot = async (
    client,
    certificadoId,
    username,
    fuenteUltima = 'MANUAL'
) => {
    const resultado = await client.query(`
        INSERT INTO fg_vehiculo (
            placa, categoria, clase, marca, modelo, version, anio_fabricacion,
            anio_modelo, vin, serie_chasis, numero_motor, combustible, color,
            carroceria, numero_cilindros, cilindrada, numero_ejes, numero_ruedas,
            numero_asientos, numero_pasajeros, longitud, ancho, alto, peso_neto,
            peso_bruto, carga_util, potencia, formula_rodante, fuente_ultima,
            certificado_origen_id, confirmado, usuario_creacion, usuario_modificacion,
            fecha_modificacion
        )
        SELECT
            placa, categoria, clase, marca, modelo, version, anio_fabricacion,
            anio_modelo, vin, serie_chasis, numero_motor, combustible, color,
            carroceria, numero_cilindros, cilindrada, numero_ejes, numero_ruedas,
            numero_asientos, numero_pasajeros, longitud, ancho, alto, peso_neto,
            peso_bruto, carga_util, potencia, formula_rodante, $2,
            certificado_id, TRUE, $3, $3, CURRENT_TIMESTAMP
        FROM fg_certificado_vehiculo
        WHERE certificado_id = $1
          AND NULLIF(BTRIM(placa), '') IS NOT NULL
          AND NULLIF(BTRIM(marca), '') IS NOT NULL
          AND NULLIF(BTRIM(modelo), '') IS NOT NULL
          AND NULLIF(BTRIM(anio_fabricacion), '') IS NOT NULL
          AND NULLIF(BTRIM(numero_motor), '') IS NOT NULL
          AND NULLIF(BTRIM(combustible), '') IS NOT NULL
          AND (NULLIF(BTRIM(vin), '') IS NOT NULL OR NULLIF(BTRIM(serie_chasis), '') IS NOT NULL)
          AND numero_ejes IS NOT NULL
          AND numero_ruedas IS NOT NULL
          AND numero_asientos IS NOT NULL
          AND numero_pasajeros IS NOT NULL
          AND longitud IS NOT NULL
          AND ancho IS NOT NULL
          AND alto IS NOT NULL
          AND peso_neto IS NOT NULL
          AND peso_bruto IS NOT NULL
        ON CONFLICT (placa_normalizada) DO UPDATE SET
            placa = EXCLUDED.placa,
            categoria = COALESCE(NULLIF(BTRIM(EXCLUDED.categoria), ''), fg_vehiculo.categoria),
            clase = COALESCE(NULLIF(BTRIM(EXCLUDED.clase), ''), fg_vehiculo.clase),
            marca = COALESCE(NULLIF(BTRIM(EXCLUDED.marca), ''), fg_vehiculo.marca),
            modelo = COALESCE(NULLIF(BTRIM(EXCLUDED.modelo), ''), fg_vehiculo.modelo),
            version = COALESCE(NULLIF(BTRIM(EXCLUDED.version), ''), fg_vehiculo.version),
            anio_fabricacion = COALESCE(NULLIF(BTRIM(EXCLUDED.anio_fabricacion), ''), fg_vehiculo.anio_fabricacion),
            anio_modelo = COALESCE(NULLIF(BTRIM(EXCLUDED.anio_modelo), ''), fg_vehiculo.anio_modelo),
            vin = COALESCE(NULLIF(BTRIM(EXCLUDED.vin), ''), fg_vehiculo.vin),
            serie_chasis = COALESCE(NULLIF(BTRIM(EXCLUDED.serie_chasis), ''), fg_vehiculo.serie_chasis),
            numero_motor = COALESCE(NULLIF(BTRIM(EXCLUDED.numero_motor), ''), fg_vehiculo.numero_motor),
            combustible = COALESCE(NULLIF(BTRIM(EXCLUDED.combustible), ''), fg_vehiculo.combustible),
            color = COALESCE(NULLIF(BTRIM(EXCLUDED.color), ''), fg_vehiculo.color),
            carroceria = COALESCE(NULLIF(BTRIM(EXCLUDED.carroceria), ''), fg_vehiculo.carroceria),
            numero_cilindros = COALESCE(EXCLUDED.numero_cilindros, fg_vehiculo.numero_cilindros),
            cilindrada = COALESCE(EXCLUDED.cilindrada, fg_vehiculo.cilindrada),
            numero_ejes = COALESCE(EXCLUDED.numero_ejes, fg_vehiculo.numero_ejes),
            numero_ruedas = COALESCE(EXCLUDED.numero_ruedas, fg_vehiculo.numero_ruedas),
            numero_asientos = COALESCE(EXCLUDED.numero_asientos, fg_vehiculo.numero_asientos),
            numero_pasajeros = COALESCE(EXCLUDED.numero_pasajeros, fg_vehiculo.numero_pasajeros),
            longitud = COALESCE(EXCLUDED.longitud, fg_vehiculo.longitud),
            ancho = COALESCE(EXCLUDED.ancho, fg_vehiculo.ancho),
            alto = COALESCE(EXCLUDED.alto, fg_vehiculo.alto),
            peso_neto = COALESCE(EXCLUDED.peso_neto, fg_vehiculo.peso_neto),
            peso_bruto = COALESCE(EXCLUDED.peso_bruto, fg_vehiculo.peso_bruto),
            carga_util = COALESCE(EXCLUDED.carga_util, fg_vehiculo.carga_util),
            potencia = COALESCE(NULLIF(BTRIM(EXCLUDED.potencia), ''), fg_vehiculo.potencia),
            formula_rodante = COALESCE(NULLIF(BTRIM(EXCLUDED.formula_rodante), ''), fg_vehiculo.formula_rodante),
            fuente_ultima = EXCLUDED.fuente_ultima,
            certificado_origen_id = EXCLUDED.certificado_origen_id,
            confirmado = TRUE,
            usuario_modificacion = EXCLUDED.usuario_modificacion,
            fecha_modificacion = CURRENT_TIMESTAMP
        RETURNING id, placa, placa_normalizada, certificado_origen_id, confirmado
    `, [certificadoId, fuenteUltima, username]);

    if (resultado.rowCount === 0) throw new Error('VEHICULO_MAESTRO_INCOMPLETO');
    return resultado.rows[0];
};

module.exports = {
    CAMPOS_VEHICULO,
    normalizarPlaca,
    mapVehiculoFaregas,
    buscarMaestroPorPlaca,
    buscarSnapshotLegacyPorPlaca,
    buscarCertificadoCompatiblePorPlaca,
    combinarVehiculos,
    resolverVehiculoPorPlaca,
    sincronizarMaestroDesdeSnapshot
};
