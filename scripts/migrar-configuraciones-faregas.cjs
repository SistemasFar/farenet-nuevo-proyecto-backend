#!/usr/bin/env node
/**
 * ============================================================================
 * HERRAMIENTA DE MIGRACIÓN SELECTIVA DE CONFIGURACIONES FAREGAS -> AMAZON RDS
 * ============================================================================
 * Objetivo:
 *   Trasladar íntegramente las configuraciones maestras, sedes, productos,
 *   precios editados, tarifas, series, correlativos de certificados, stock
 *   de chips, papel valorado y usuarios reales desde la base de origen a RDS,
 *   EXCLUYENDO totalmente las operaciones comerciales y certificados de prueba.
 *
 * Características:
 *   - DRY-RUN por defecto (solo lectura y reporte sin escribir).
 *   - Requiere explícitamente el flag --ejecutar-autorizado para escribir.
 *   - Validación estricta: Origen y Destino NO pueden ser la misma base de datos.
 *   - Transaccional: BEGIN / COMMIT con ROLLBACK ante cualquier error.
 *   - Idempotente: Inserta preservando llaves con ON CONFLICT DO NOTHING/UPDATE.
 *   - Cero exposición de secretos en consola ni logs.
 *   - NO escribe ni modifica tablas de FARENET ni FARECOM.
 * ============================================================================
 */

const { Pool } = require('pg');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

// Carga configuración de origen (.env por defecto)
const envFile = process.env.APP_ENV_FILE || '.env';
const envPath = path.resolve(__dirname, '..', envFile);
const origenConfig = fs.existsSync(envPath) ? dotenv.parse(fs.readFileSync(envPath, 'utf8')) : {};

// Configuración de destino (vía variables DEST_DB_* o argumentos)
const destHost = process.env.DEST_DB_HOST || process.argv.find(a => a.startsWith('--dest-host='))?.split('=')[1];
const destPort = Number(process.env.DEST_DB_PORT || process.argv.find(a => a.startsWith('--dest-port='))?.split('=')[1] || 5432);
const destName = process.env.DEST_DB_NAME || process.argv.find(a => a.startsWith('--dest-name='))?.split('=')[1];
const destUser = process.env.DEST_DB_USER || process.argv.find(a => a.startsWith('--dest-user='))?.split('=')[1];
const destPass = process.env.DEST_DB_PASSWORD || process.argv.find(a => a.startsWith('--dest-password='))?.split('=')[1];

const esEjecucionAutorizada = process.argv.includes('--ejecutar-autorizado');
const esDryRun = !esEjecucionAutorizada;

console.log('================================================================================');
console.log('   MIGRADOR SELECTIVO DE CONFIGURACIONES FAREGAS A AMAZON RDS POSTGRESQL');
console.log(`   MODO: ${esDryRun ? '🔍 DRY-RUN (SIMULACIÓN DE SOLO LECTURA)' : '🚀 EJECUCIÓN AUTORIZADA REAL'}`);
console.log('================================================================================');

async function main() {
    const srcHost = origenConfig.DB_HOST || '192.168.14.19';
    const srcPort = Number(origenConfig.DB_PORT || 5432);
    const srcName = origenConfig.DB_NAME || 'inspeccion';
    const srcUser = origenConfig.DB_USER || 'postgres';
    const srcPass = origenConfig.DB_PASSWORD;

    console.log(`\n[ORIGEN]  Host: ${srcHost}:${srcPort} | DB: ${srcName} | Usuario: ${srcUser}`);
    console.log(`[DESTINO] Host: ${destHost || '(Simulado en memoria si dry-run)'}:${destPort} | DB: ${destName || '(Simulado)'} | Usuario: ${destUser || '(Simulado)'}`);

    // Si estamos en ejecución autorizada, validar parámetros de destino obligatorios
    if (esEjecucionAutorizada) {
        if (!destHost || !destName || !destUser || !destPass) {
            console.error('\n❌ ERROR: Faltan credenciales de destino para la ejecución autorizada.');
            console.error('Proporcione DEST_DB_HOST, DEST_DB_PORT, DEST_DB_NAME, DEST_DB_USER, DEST_DB_PASSWORD como variables de entorno o argumentos.');
            process.exit(1);
        }

        // Regla de seguridad vital: Impedir que origen y destino sean la misma instancia
        if (srcHost === destHost && srcPort === destPort && srcName === destName) {
            console.error('\n❌ ERROR DE SEGURIDAD CRÍTICO: El host y base de datos de origen y destino son IDENTICOS.');
            console.error('El migrador no puede ejecutarse sobre la misma base de datos original.');
            process.exit(1);
        }
    }

    const srcPool = new Pool({
        host: srcHost,
        port: srcPort,
        database: srcName,
        user: srcUser,
        password: srcPass,
        connectionTimeoutMillis: 10000
    });

    let destPool = null;
    if (esEjecucionAutorizada) {
        destPool = new Pool({
            host: destHost,
            port: destPort,
            database: destName,
            user: destUser,
            password: destPass,
            connectionTimeoutMillis: 15000
        });
    }

    let srcClient = null;
    let destClient = null;

    try {
        srcClient = await srcPool.connect();
        await srcClient.query('BEGIN TRANSACTION READ ONLY');
        console.log('✅ Conexión establecida con la base de datos de ORIGEN (modo READ ONLY).');

        if (esEjecucionAutorizada) {
            destClient = await destPool.connect();
            await destClient.query('BEGIN');
            console.log('✅ Conexión establecida con la base de datos de DESTINO (transacción abierta).');
        }

        // ====================================================================
        // MATRIZ DE TABLAS A MIGRAR EN ORDEN ESTRICTO DE INTEGRIDAD REFERENCIAL
        // ====================================================================
        const planMigracion = [
            {
                tabla: 'fg_perfil',
                descripcion: 'Perfiles de usuario y roles RBAC',
                query: 'SELECT clave, nombre, visible FROM fg_perfil ORDER BY clave',
                pkey: ['clave']
            },
            {
                tabla: 'fg_permiso',
                descripcion: 'Catálogo de 50 permisos del sistema',
                query: 'SELECT clave, nombre, modulo, descripcion, activo FROM fg_permiso ORDER BY clave',
                pkey: ['clave']
            },
            {
                tabla: 'fg_perfil_permiso',
                descripcion: 'Asignaciones de permisos por perfil',
                query: 'SELECT perfil_clave, permiso_clave, created_at FROM fg_perfil_permiso ORDER BY perfil_clave, permiso_clave',
                pkey: ['perfil_clave', 'permiso_clave']
            },
            {
                tabla: 'fg_empresa',
                descripcion: '14 empresas del grupo y datos fiscales (RUC, cuenta BN)',
                query: 'SELECT key, nombre, ruc, direccion, telefono, cuenta_banco_nacion, activo, fecha_creacion, fecha_modificacion FROM fg_empresa ORDER BY key',
                pkey: ['key']
            },
            {
                tabla: 'fg_empresa_facturador',
                descripcion: '28 configuraciones de facturador electrónico',
                query: 'SELECT id, empresa_key, proveedor, entorno, credencial_clave, activo, fecha_creacion, fecha_modificacion FROM fg_empresa_facturador ORDER BY id',
                pkey: ['id']
            },
            {
                tabla: 'fg_planta',
                descripcion: '31 sedes de inspección (14 activas y 17 históricas)',
                query: 'SELECT key, nombre, direccion, telefono, activo, empresa_key, correo FROM fg_planta ORDER BY empresa_key, key',
                pkey: ['key']
            },
            {
                tabla: 'fg_perfil_planta',
                descripcion: 'Permisos de perfiles asignados por sede',
                query: 'SELECT perfil_clave, planta_key FROM fg_perfil_planta ORDER BY perfil_clave, planta_key',
                pkey: ['perfil_clave', 'planta_key']
            },
            {
                tabla: 'fg_usuario',
                descripcion: '33 cuentas reales de usuarios (hashes y estados)',
                query: 'SELECT username, user_type, contrasenha, perfil_id, persona_nrodocumentoidentidad, estado, foto FROM fg_usuario ORDER BY username',
                pkey: ['username']
            },
            {
                tabla: 'fg_usuario_credencial',
                descripcion: '33 credenciales de acceso seguro y políticas',
                query: 'SELECT id, username, estado_credencial, tipo_operacion, fecha_modificacion, responsable, cambiada_posteriormente, necesita_restablecimiento, observaciones FROM fg_usuario_credencial ORDER BY id',
                pkey: ['id']
            },
            {
                tabla: 'fg_usuario_perfil',
                descripcion: '32 perfiles de identidad y datos de operadores',
                query: 'SELECT usuario_username, tipo_documento_key, nro_documento, nombres, apellidos, nombre_razon_social, pais_key, departamento_key, provincia_key, distrito_key, direccion, email, telefono, persona_contacto, fecha_creacion, fecha_actualizacion FROM fg_usuario_perfil ORDER BY usuario_username',
                pkey: ['usuario_username']
            },
            {
                tabla: 'fg_usuario_planta',
                descripcion: '425 asignaciones de usuarios a sus sedes de trabajo',
                query: 'SELECT usuario_username, plantas_key FROM fg_usuario_planta ORDER BY usuario_username, plantas_key',
                pkey: ['usuario_username', 'plantas_key']
            },
            {
                tabla: 'fg_credencial_custodia',
                descripcion: 'Custodia de credenciales del sistema',
                query: 'SELECT id, username, ciphertext, iv, tag, algoritmo, version_clave, origen, creado_por, fecha_creacion, fecha_actualizacion FROM fg_credencial_custodia ORDER BY id',
                pkey: ['username']
            },
            {
                tabla: 'fg_categoria_servicio',
                descripcion: '4 categorías de servicio (GLP, GNV, CONFORMIDAD, COMPLEMENTARIOS)',
                query: 'SELECT id, codigo, nombre, descripcion, activo, orden, fecha_creacion, fecha_modificacion FROM fg_categoria_servicio ORDER BY id',
                pkey: ['id']
            },
            {
                tabla: 'fg_servicio',
                descripcion: '96 servicios y flujos operativos',
                query: 'SELECT id, codigo, nombre, familia, tipo_certificado_clave, modalidad, requiere_certificado, requiere_vehiculo, activo, orden, categoria_id, tipo_flujo, formato_id, sujeto_detraccion, detraccion_codigo, detraccion_porcentaje FROM fg_servicio ORDER BY id',
                pkey: ['id']
            },
            {
                tabla: 'fg_producto_facturacion',
                descripcion: '275 productos con precios de referencia y SKU editados',
                query: 'SELECT id, codigo_sku, descripcion, tipo_producto, categoria_dms, cuenta_por_cobrar, unidad, precio_unitario, precio_referencia, valor_referencial_unitario, codigo_clasificacion_sunat, tipo_afectacion_igv, porcentaje_isc, disponible_pos, es_para_venta, es_para_compra, tiene_icbper, activo, fecha_creacion, fecha_modificacion, categoria_id, requiere_chip, producto_chip_id, precio_chip, codigo_barras, codigo_afectacion_isc, imagen_url, sujeto_detraccion, detraccion_codigo, detraccion_porcentaje, naturaleza_spot FROM fg_producto_facturacion ORDER BY id',
                pkey: ['id']
            },
            {
                tabla: 'fg_producto_inventariable',
                descripcion: '3 productos físicos inventariables (CHIP, HOJA_GLP, HOJA_CONFORMIDAD)',
                query: 'SELECT id, codigo, nombre, producto_facturacion_id, control_stock, activo, fecha_creacion, fecha_modificacion, tipo FROM fg_producto_inventariable ORDER BY id',
                pkey: ['id']
            },
            {
                tabla: 'fg_producto_inventariable_sede',
                descripcion: '20 asignaciones y habilitaciones de venta inventariable por sede',
                query: 'SELECT id, producto_inventariable_id, planta_key, precio, activo, fecha_creacion, fecha_modificacion, stock_permitido, venta_habilitada, producto_facturacion_id FROM fg_producto_inventariable_sede ORDER BY id',
                pkey: ['id']
            },
            {
                tabla: 'fg_tarifa',
                descripcion: '175 tarifas configuradas por sede y servicio',
                query: 'SELECT id, planta_key, codigo, familia, nombre, tipo_certificado_clave, modalidad, precio, activo, orden, servicio_id, producto_facturacion_id FROM fg_tarifa ORDER BY id',
                pkey: ['id']
            },
            {
                tabla: 'fg_descuento',
                descripcion: 'Reglas de descuento comercial (CORTESIA_FAREGAS al 100%)',
                query: 'SELECT id, codigo, nombre, tipo, empresa_aliada_ruc, empresa_aliada_nombre, tipo_calculo, valor, fecha_inicio, fecha_fin, planta_key, activo, usuario_creacion, fecha_creacion, usuario_modificacion, fecha_modificacion, ejecutivo, ejecutivo_id FROM fg_descuento ORDER BY id',
                pkey: ['id']
            },
            {
                tabla: 'fg_serie_comprobante',
                descripcion: '288 series (conservando ultimo_numero fiscal exacto por sede)',
                query: 'SELECT id, planta_key, tipo_comprobante, serie, ultimo_numero, es_predeterminada, autogenerada, contingencia, activo, fecha_creacion, fecha_modificacion, tipo_documento_referencia, serie_pos, empresa_key, proveedor_emision, entorno_emision, confirmada_produccion, numero_inicial_confirmado, sistema_origen, fecha_corte, usuario_confirmacion, fecha_confirmacion, nombre_dms, codigo_local_dms, nombre_local_dms, telefono_local_dms, correo_local_dms, direccion_comercial_dms FROM fg_serie_comprobante ORDER BY id',
                pkey: ['id']
            },
            {
                tabla: 'fg_tipo_certificado',
                descripcion: '5 tipos oficiales de certificado (39, 41, 22, T1, T2)',
                query: 'SELECT clave, nombre, descripcion, activo, entidad_certificadora_nombre, resolucion_directoral, domicilio_fiscal, telefono, lugar_emision, codigo, ancho_correlativo FROM fg_tipo_certificado ORDER BY clave',
                pkey: ['clave']
            },
            {
                tabla: 'fg_correlativo_certificado',
                descripcion: '66 correlativos configurados por planta y modalidad',
                query: 'SELECT id, tipo_certificado_clave, nro_actual, activo, fecha_modificacion, planta_key, nro_inicio, nro_maximo, fecha_asignacion, fecha_cierre, modalidad FROM fg_correlativo_certificado ORDER BY id',
                pkey: ['id']
            },
            {
                tabla: 'fg_correlativo_certificado_sede',
                descripcion: '74 rangos físicos de papel (64 agotados y 10 activos con saldos)',
                query: 'SELECT id, planta_key, rango_inicio, rango_fin, numero_actual, estado, fecha_asignacion, fecha_cierre, observacion, fecha_creacion, fecha_modificacion FROM fg_correlativo_certificado_sede ORDER BY id',
                pkey: ['id']
            },
            {
                tabla: 'fg_certificado_formato',
                descripcion: '14 formatos aprobados de certificados y plantillas',
                query: 'SELECT id, codigo, nombre, motor, es_protegido, activo, creado_en, actualizado_en, formato_padre_id FROM fg_certificado_formato ORDER BY id',
                pkey: ['id']
            },
            {
                tabla: 'fg_certificado_formato_version',
                descripcion: '20 versiones de plantillas y layouts de impresión',
                query: 'SELECT id, formato_id, version, archivo_ruta, configuracion, estado, vigente_desde, creado_por, creado_en, motor FROM fg_certificado_formato_version ORDER BY id',
                pkey: ['id']
            },
            {
                tabla: 'fg_taller_autorizado',
                descripcion: '5 talleres autorizados GNV / GLP',
                query: 'SELECT id, ruc, razon_social, nombre_comercial, sede, direccion, codigo_autorizacion, estado, fecha_creacion, fecha_modificacion, planta_key FROM fg_taller_autorizado ORDER BY id',
                pkey: ['id']
            },
            {
                tabla: 'fg_ejecutivo',
                descripcion: '2 ejecutivos comerciales',
                query: 'SELECT id, username, nombre, activo, usuario_creacion, fecha_creacion, usuario_modificacion, fecha_modificacion FROM fg_ejecutivo ORDER BY id',
                pkey: ['id']
            },
            {
                tabla: 'fg_chip',
                descripcion: '38 chips físicos (3 DISPONIBLES en sede 160, 35 VENDIDOS desvinculados de pruebas)',
                // Nota: operacion_reserva_id se establece en NULL para no depender de transacciones de prueba
                query: `SELECT id, producto_inventariable_id, numero_chip, planta_actual_key, estado, 
                               NULL::bigint as operacion_reserva_id, NULL::timestamp as reservado_en,
                               creado_por, creado_en, actualizado_por, actualizado_en 
                        FROM fg_chip ORDER BY id`,
                pkey: ['id']
            },
            {
                tabla: 'fg_chip_movimiento',
                descripcion: '77 movimientos históricos de trazabilidad de chips (desvinculados de transacciones de prueba)',
                query: `SELECT id, chip_id, tipo_movimiento, planta_origen_key, planta_destino_key, usuario, fecha, referencia, 
                               NULL::bigint as certificado_id, NULL::bigint as operacion_comercial_id, detalles 
                        FROM fg_chip_movimiento ORDER BY id`,
                pkey: ['id']
            },
            {
                tabla: 'fg_inventario_cantidad_movimiento',
                descripcion: 'Movimientos de ingreso inicial de papel valorado en sedes',
                query: `SELECT id, producto_inventariable_id, planta_key, tipo_movimiento, sentido, cantidad, 
                               NULL::bigint as operacion_detalle_id, usuario, referencia, detalles, fecha_creacion 
                        FROM fg_inventario_cantidad_movimiento 
                        WHERE tipo_movimiento = 'INGRESO'
                        ORDER BY id`,
                pkey: ['id']
            }
        ];

        console.log('\n--- INICIO DE PROCESAMIENTO POR TABLAS ---');
        const resumenResultados = [];

        for (const item of planMigracion) {
            const filasRes = await srcClient.query(item.query);
            const filas = filasRes.rows;
            const cantidad = filas.length;

            if (esDryRun) {
                console.log(`[DRY-RUN] ${item.tabla.padEnd(35)} : ${String(cantidad).padStart(5)} filas leídas (${item.descripcion})`);
                resumenResultados.push({ tabla: item.tabla, filas: cantidad, estado: 'SIMULADO OK' });
            } else {
                let insertados = 0;
                if (cantidad > 0) {
                    const columnas = Object.keys(filas[0]);
                    const colsList = columnas.map(c => `"${c}"`).join(', ');
                    const pkeysList = item.pkey.map(c => `"${c}"`).join(', ');
                    const updateCols = columnas
                        .filter(c => !item.pkey.includes(c))
                        .map(c => `"${c}" = EXCLUDED."${c}"`)
                        .join(', ');

                    const onConflictClause = updateCols.length > 0
                        ? `ON CONFLICT (${pkeysList}) DO UPDATE SET ${updateCols}`
                        : `ON CONFLICT (${pkeysList}) DO NOTHING`;

                    for (const fila of filas) {
                        const vals = columnas.map(c => fila[c]);
                        const paramsList = columnas.map((_, idx) => `$${idx + 1}`).join(', ');
                        const sqlInsert = `INSERT INTO "${item.tabla}" (${colsList}) VALUES (${paramsList}) ${onConflictClause};`;
                        await destClient.query(sqlInsert, vals);
                        insertados++;
                    }
                }
                console.log(`[APLICADO] ${item.tabla.padEnd(35)} : ${String(insertados).padStart(5)} filas insertadas/actualizadas`);
                resumenResultados.push({ tabla: item.tabla, filas: insertados, estado: 'MIGRADO REAL' });
            }
        }

        // ====================================================================
        // ACTUALIZACIÓN DE SECUENCIAS POST-INSERCIÓN EN DESTINO
        // ====================================================================
        if (!esDryRun && destClient) {
            console.log('\n--- AJUSTANDO SECUENCIAS AUTO-INCREMENTALES EN DESTINO ---');
            const secuenciasRes = await destClient.query(`
                SELECT sequence_name, table_name, column_name
                FROM information_schema.columns
                WHERE table_schema = 'public' 
                  AND table_name LIKE 'fg_%' 
                  AND column_default LIKE 'nextval%'
            `);

            for (const seq of secuenciasRes.rows) {
                const seqName = seq.sequence_name;
                const tblName = seq.table_name;
                const colName = seq.column_name;
                await destClient.query(`
                    SELECT setval('${seqName}', COALESCE((SELECT MAX("${colName}") FROM "${tblName}"), 1), true)
                `);
                console.log(`  -> Secuencia ${seqName} ajustada al máximo de ${tblName}.${colName}`);
            }

            await destClient.query('COMMIT');
            console.log('\n✅ TRANSACCIÓN DE DESTINO CONFIRMADA (COMMIT).');
        }

        await srcClient.query('ROLLBACK'); // Cierra transacción de solo lectura de origen
        console.log('\n================================================================================');
        console.log('   RESUMEN FINAL DE LA MIGRACIÓN SELECTIVA DE CONFIGURACIONES FAREGAS');
        console.log('================================================================================');
        console.table(resumenResultados);

        console.log('\n📋 GARANTÍA DE EXCLUSIÓN TRANSACCIONAL:');
        console.log('  - fg_operacion_comercial (Ventas de prueba): NO MIGRADA (0 registros).');
        console.log('  - fg_facturacion (Comprobantes de prueba):   NO MIGRADA (0 registros).');
        console.log('  - fg_certificado (Certificados de prueba):   NO MIGRADA (0 registros).');
        console.log('  - fg_pago y fg_orden_pago (Cobros prueba):   NO MIGRADA (0 registros).');
        console.log('  - Las tablas originales de FARENET permanecieron 100% INTOCABLES.');

    } catch (error) {
        console.error('\n❌ ERROR DURANTE LA MIGRACIÓN:', error.message);
        if (destClient) {
            await destClient.query('ROLLBACK');
            console.error('⚠️ Transacción de destino cancelada (ROLLBACK aplicado con éxito).');
        }
        process.exitCode = 1;
    } finally {
        if (srcClient) srcClient.release();
        if (destClient) destClient.release();
        await srcPool.end();
        if (destPool) await destPool.end();
    }
}

main();
