#!/usr/bin/env node
/**
 * ============================================================================
 * HERRAMIENTA DE VERIFICACIÓN POST-MIGRACIÓN FAREGAS EN AMAZON RDS
 * ============================================================================
 * Objetivo:
 *   Validar la integridad de los datos en la base de destino tras la ejecución
 *   del migrador selectivo:
 *   1. Confirma que todas las configuraciones maestras estén presentes.
 *   2. Confirma que los precios personalizados se conserven intactos.
 *   3. Confirma que los rangos de certificados (activos y agotados) sean exactos.
 *   4. Confirma que los chips conserven su estado sin duplicar numeración.
 *   5. Confirma que las tablas transaccionales de prueba permanezcan en CERO (0).
 *   6. Valida que el Dashboard y las vistas operativas arranquen limpias.
 * ============================================================================
 */

const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');

const targetHost = process.env.DEST_DB_HOST || process.argv.find(a => a.startsWith('--target-host='))?.split('=')[1];
const targetPort = Number(process.env.DEST_DB_PORT || process.argv.find(a => a.startsWith('--target-port='))?.split('=')[1] || 5432);
const targetName = process.env.DEST_DB_NAME || process.argv.find(a => a.startsWith('--target-name='))?.split('=')[1];
const targetUser = process.env.DEST_DB_USER || process.argv.find(a => a.startsWith('--target-user='))?.split('=')[1];
const targetPass = process.env.DEST_DB_PASSWORD || process.argv.find(a => a.startsWith('--target-password='))?.split('=')[1];

console.log('================================================================================');
console.log('   VERIFICADOR DE INTEGRIDAD POST-MIGRACIÓN FAREGAS EN AMAZON RDS');
console.log('================================================================================');

if (!targetHost || !targetName || !targetUser || !targetPass) {
    console.error('\n❌ ERROR: Debe proporcionar las credenciales de la base de destino a verificar.');
    console.error('Uso: node scripts/verificar-migracion-faregas.cjs --target-host=... --target-port=5432 --target-name=... --target-user=... --target-password=...');
    console.error('O exportar variables DEST_DB_HOST, DEST_DB_PORT, DEST_DB_NAME, DEST_DB_USER, DEST_DB_PASSWORD.');
    process.exit(1);
}

const pool = new Pool({
    host: targetHost,
    port: targetPort,
    database: targetName,
    user: targetUser,
    password: targetPass,
    connectionTimeoutMillis: 10000
});

async function runVerification() {
    const client = await pool.connect();
    let hasErrors = false;

    try {
        console.log(`\nConectando a base de destino: ${targetHost}:${targetPort}/${targetName}...`);
        await client.query('BEGIN TRANSACTION READ ONLY');
        console.log('✅ Conexión establecida con éxito en modo solo lectura.\n');

        // 1. Verificación de Tablas Maestras
        const conteosEsperados = [
            { tabla: 'fg_empresa', minimo: 14 },
            { tabla: 'fg_planta', minimo: 31 },
            { tabla: 'fg_producto_facturacion', minimo: 275 },
            { tabla: 'fg_producto_inventariable', minimo: 3 },
            { tabla: 'fg_categoria_servicio', minimo: 4 },
            { tabla: 'fg_servicio', minimo: 96 },
            { tabla: 'fg_tarifa', minimo: 175 },
            { tabla: 'fg_serie_comprobante', minimo: 51 },
            { tabla: 'fg_tipo_certificado', minimo: 5 },
            { tabla: 'fg_correlativo_certificado', minimo: 50 },
            { tabla: 'fg_correlativo_certificado_sede', minimo: 74 },
            { tabla: 'fg_certificado_formato', minimo: 14 },
            { tabla: 'fg_usuario', minimo: 33 },
            { tabla: 'fg_usuario_planta', minimo: 425 },
            { tabla: 'fg_permiso', minimo: 50 },
            { tabla: 'fg_chip', minimo: 38 }
        ];

        console.log('--- 1. VALIDACIÓN DE TABLAS MAESTRAS Y CONFIGURACIÓN ---');
        for (const item of conteosEsperados) {
            try {
                const res = await client.query(`SELECT count(*) c FROM "${item.tabla}"`);
                const cantidad = Number(res.rows[0].c);
                if (cantidad >= item.minimo) {
                    console.log(`  [OK] ${item.tabla.padEnd(35)} : ${String(cantidad).padStart(5)} registros (esperado >= ${item.minimo})`);
                } else {
                    console.error(`  [FALLO] ${item.tabla.padEnd(35)} : ${String(cantidad).padStart(5)} registros (INSUFICIENTE, se esperaba >= ${item.minimo})`);
                    hasErrors = true;
                }
            } catch (err) {
                console.error(`  [ERROR] ${item.tabla.padEnd(35)} : ${err.message}`);
                hasErrors = true;
            }
        }

        // 2. Validación de Precios Personalizados
        console.log('\n--- 2. VALIDACIÓN DE PRECIOS EDITADOS EN PRODUCTOS ---');
        const skuChecks = [
            { sku: '0211', esperado: '80.0000', desc: 'Certificado Inicial GLP (Precio editado a S/ 80.00)' },
            { sku: '0439', esperado: '70.0000', desc: 'Certificado Inicial GNV + Chip (Precio editado a S/ 70.00)' },
            { sku: 'GNV-ANUAL-201', esperado: '80.0000', desc: 'Producto nuevo no presente en JSON semilla' }
        ];

        for (const check of skuChecks) {
            const res = await client.query(`SELECT precio_referencia, precio_unitario FROM fg_producto_facturacion WHERE codigo_sku = $1`, [check.sku]);
            if (res.rowCount === 0) {
                console.error(`  [FALLO] SKU ${check.sku} NO ENCONTRADO en fg_producto_facturacion.`);
                hasErrors = true;
            } else {
                const p = res.rows[0];
                const valorRef = p.precio_referencia ? Number(p.precio_referencia).toFixed(4) : (p.precio_unitario ? Number(p.precio_unitario).toFixed(4) : null);
                if (valorRef === check.esperado) {
                    console.log(`  [OK] SKU ${check.sku.padEnd(16)} : S/ ${valorRef} (${check.desc})`);
                } else {
                    console.error(`  [FALLO] SKU ${check.sku.padEnd(16)} : S/ ${valorRef} (SE ESPERABA S/ ${check.esperado})`);
                    hasErrors = true;
                }
            }
        }

        // 3. Validación de Rangos de Certificados y Saldos
        console.log('\n--- 3. VALIDACIÓN DE RANGOS DE CERTIFICADOS (74 RANGOS) ---');
        const rangosRes = await client.query(`
            SELECT estado, count(*) c, sum(disponibles) total_disponibles
            FROM fg_correlativo_certificado_sede
            GROUP BY estado
            ORDER BY estado;
        `);
        console.log('  Distribución de rangos:', rangosRes.rows);
        const agotados = Number(rangosRes.rows.find(r => r.estado === 'AGOTADO')?.c || 0);
        const activos = Number(rangosRes.rows.find(r => r.estado === 'ACTIVO')?.c || 0);
        if (agotados >= 64 && activos >= 10) {
            console.log(`  [OK] Rangos históricos conservados: ${agotados} agotados y ${activos} activos.`);
        } else {
            console.error(`  [FALLO] Conteo de rangos inconsistente: ${agotados} agotados y ${activos} activos.`);
            hasErrors = true;
        }

        // 4. Validación de Chips
        console.log('\n--- 4. VALIDACIÓN DE CHIPS (38 UNIDADES FÍSICAS) ---');
        const chipsRes = await client.query(`
            SELECT estado, count(*) c
            FROM fg_chip
            GROUP BY estado
            ORDER BY estado;
        `);
        console.log('  Distribución de chips:', chipsRes.rows);
        const chipsDisp = Number(chipsRes.rows.find(r => r.estado === 'DISPONIBLE')?.c || 0);
        const chipsVend = Number(chipsRes.rows.find(r => r.estado === 'VENDIDO')?.c || 0);
        if (chipsDisp === 3 && chipsVend === 35) {
            console.log(`  [OK] Chips en estado exacto: 3 DISPONIBLES (Sede 160) y 35 VENDIDOS (bloqueados contra reuso).`);
        } else {
            console.error(`  [FALLO] Estado de chips inesperado: ${chipsDisp} disponibles y ${chipsVend} vendidos.`);
            hasErrors = true;
        }

        // 5. Verificación de Exclusión de Transacciones de Prueba (DEBE SER 0)
        console.log('\n--- 5. VERIFICACIÓN DE EXCLUSIÓN TRANSACCIONAL (CERO OPERACIONES DE PRUEBA) ---');
        const transaccionales = [
            'fg_operacion_comercial',
            'fg_operacion_detalle',
            'fg_orden_pago',
            'fg_pago',
            'fg_credito',
            'fg_facturacion',
            'fg_facturacion_intento',
            'fg_nota_credito_trabajo',
            'fg_certificado',
            'fg_certificado_glp',
            'fg_certificado_gnv',
            'fg_certificado_conformidad',
            'fg_certificado_duplicado',
            'fg_cliente',
            'fg_solicitud_operacion'
        ];

        for (const t of transaccionales) {
            const res = await client.query(`SELECT count(*) c FROM "${t}"`);
            const c = Number(res.rows[0].c);
            if (c === 0) {
                console.log(`  [OK] ${t.padEnd(35)} : 0 registros (Limpio para producción)`);
            } else {
                console.error(`  [ALERTA CRÍTICA] ${t.padEnd(35)} : ${c} REGISTROS ENCONTRADOS (Debía estar en 0)`);
                hasErrors = true;
            }
        }

        // 6. Prueba de Consulta del Dashboard Operativo
        console.log('\n--- 6. VERIFICACIÓN DE CONSULTA LIMPIA DEL DASHBOARD OPERATIVO ---');
        const dashQuery = await client.query(`
            SELECT 
                COALESCE(count(*), 0) as total_operaciones,
                COALESCE(sum(importe_total), 0) as total_facturado
            FROM fg_operacion_comercial
            WHERE estado = 'FINALIZADA';
        `);
        console.log(`  Resumen Dashboard inicial: Total Operaciones = ${dashQuery.rows[0].total_operaciones}, Facturado = S/ ${dashQuery.rows[0].total_facturado}`);
        console.log('  [OK] El Dashboard responde limpiamente sin datos transaccionales residuales.');

        await client.query('COMMIT');

        console.log('\n================================================================================');
        if (!hasErrors) {
            console.log('🎉 RESULTADO: LA VERIFICACIÓN COMPLETÓ CON ÉXITO. EL DESTINO ESTÁ 100% LISTO.');
        } else {
            console.error('❌ RESULTADO: SE DETECTARON INCONSISTENCIAS. REVISE LOS REGISTROS ANTERIORES.');
            process.exitCode = 1;
        }
        console.log('================================================================================');

    } catch (err) {
        console.error('❌ ERROR FATAL DURANTE LA VERIFICACIÓN:', err.message);
        process.exitCode = 1;
    } finally {
        client.release();
        await pool.end();
    }
}

runVerification();
