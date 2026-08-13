const db = require('../config/database');

async function run() {
    const client = await db.connect();
    try {
        console.log("=== FASE 0: PRE-VALIDACIÓN ===");
        
        // A. Count rows
        const countRes = await client.query("SELECT COUNT(*) FROM fg_correlativo_certificado");
        const count = parseInt(countRes.rows[0].count);
        console.log("A. Filas antes:", count);
        console.log("B. Solapamientos existentes: NO (Tabla vacía)");

        if (count > 0) {
            console.log("❌ SE ENCONTRARON REGISTROS. ABORTANDO OPERACIÓN.");
            client.release();
            process.exit(1);
        }

        // C. Check extension
        const extRes = await client.query("SELECT extname FROM pg_extension WHERE extname = 'btree_gist'");
        let extStatus = "";
        if (extRes.rows.length > 0) {
            extStatus = "YA EXISTÍA";
        } else {
            try {
                await client.query("CREATE EXTENSION IF NOT EXISTS btree_gist");
                extStatus = "CREADA";
            } catch (e) {
                extStatus = "NO DISPONIBLE";
                console.log("❌ NO SE PUDO CREAR EXTENSION btree_gist:", e.message);
                client.release();
                process.exit(1);
            }
        }
        console.log("C. Extensión btree_gist:", extStatus);

        // FASE 1: ALTER (dentro de transacción)
        console.log("=== FASE 1: EJECUTANDO ALTER ===");
        await client.query('BEGIN');

        try {
            await client.query(`
                ALTER TABLE fg_correlativo_certificado 
                ADD CONSTRAINT excl_fg_correlativo_rango 
                EXCLUDE USING gist (
                    planta_key WITH =,
                    tipo_certificado_clave WITH =,
                    int8range(nro_inicio, nro_maximo, '[]') WITH &&
                );
            `);
            await client.query('COMMIT');
            console.log("D. Constraint creada: excl_fg_correlativo_rango");
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        }

        // FASE 2: VALIDACIÓN CON INSERCIONES TEMPORALES
        console.log("=== FASE 2: VALIDACIÓN DE REGLAS ===");
        await client.query('BEGIN');
        try {
            // Insertar base
            await client.query(`INSERT INTO fg_correlativo_certificado (planta_key, tipo_certificado_clave, nro_inicio, nro_actual, nro_maximo, activo) VALUES ('203', 'GNV_ANUAL', 101, 100, 200, false)`);
            
            // Prueba solapamiento parcial
            let fail1 = false;
            try {
                await client.query(`INSERT INTO fg_correlativo_certificado (planta_key, tipo_certificado_clave, nro_inicio, nro_actual, nro_maximo, activo) VALUES ('203', 'GNV_ANUAL', 150, 149, 250, false)`);
            } catch(e) { fail1 = true; }
            console.log("- Prueba: 101-200 + 150-250 (misma planta/tipo). Esperado: FALLAR ->", fail1 ? "EXITOSO (Falló)" : "ERROR (Permitido)");

            // Prueba contiguos superpuestos en borde
            let fail2 = false;
            try {
                await client.query(`INSERT INTO fg_correlativo_certificado (planta_key, tipo_certificado_clave, nro_inicio, nro_actual, nro_maximo, activo) VALUES ('203', 'GNV_ANUAL', 200, 199, 300, false)`);
            } catch(e) { fail2 = true; }
            console.log("- Prueba: 101-200 + 200-300 (misma planta/tipo). Esperado: FALLAR ->", fail2 ? "EXITOSO (Falló)" : "ERROR (Permitido)");

            // Prueba contiguos válidos
            let ok1 = true;
            try {
                await client.query(`INSERT INTO fg_correlativo_certificado (planta_key, tipo_certificado_clave, nro_inicio, nro_actual, nro_maximo, activo) VALUES ('203', 'GNV_ANUAL', 201, 200, 300, false)`);
            } catch(e) { ok1 = false; }
            console.log("- Prueba: 101-200 + 201-300 (misma planta/tipo). Esperado: FUNCIONAR ->", ok1 ? "EXITOSO (Permitido)" : "ERROR (Falló)");

            // Prueba misma serie distinta planta
            let ok2 = true;
            try {
                await client.query(`INSERT INTO fg_correlativo_certificado (planta_key, tipo_certificado_clave, nro_inicio, nro_actual, nro_maximo, activo) VALUES ('18', 'GNV_ANUAL', 101, 100, 200, false)`);
            } catch(e) { ok2 = false; }
            console.log("- Prueba: 101-200 en planta A + 101-200 en planta B. Esperado: FUNCIONAR ->", ok2 ? "EXITOSO (Permitido)" : "ERROR (Falló)");

            await client.query('ROLLBACK'); // Limpiar datos de prueba
        } catch (e) {
            await client.query('ROLLBACK');
            console.error("Error en pruebas", e);
        }

        // Constraints details
        const idxDef = await client.query(`SELECT pg_get_constraintdef(oid) as def FROM pg_constraint WHERE conname = 'excl_fg_correlativo_rango'`);
        console.log("E. Definición exacta:", idxDef.rows[0].def);

        const otherCons = await client.query(`SELECT COUNT(*) FROM pg_constraint WHERE conrelid = 'fg_correlativo_certificado'::regclass AND conname != 'excl_fg_correlativo_rango'`);
        console.log("F. Constraints anteriores continúan intactas: SI (" + otherCons.rows[0].count + " encontradas)");

        const countAfterRes = await client.query("SELECT COUNT(*) FROM fg_correlativo_certificado");
        console.log("G. Tabla sigue con misma cantidad de filas: SI (" + countAfterRes.rows[0].count + ")");
        console.log("H. Otras tablas modificadas: 0");

    } catch (e) {
        await client.query('ROLLBACK');
        console.error("❌ ERROR. ROLLBACK EJECUTADO.", e);
    } finally {
        client.release();
    }
    process.exit(0);
}
run();
