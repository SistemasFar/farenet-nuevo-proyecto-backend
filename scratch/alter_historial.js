const db = require('../config/database');

async function run() {
    const client = await db.connect();
    try {
        console.log("=== FASE 0: PRE-VALIDACIÓN ===");
        
        // Count rows
        const countRes = await client.query("SELECT COUNT(*) FROM fg_correlativo_certificado");
        const count = parseInt(countRes.rows[0].count);
        console.log("A. Cantidad de filas antes:", count);

        if (count > 0) {
            console.log("❌ SE ENCONTRARON REGISTROS. ABORTANDO OPERACIÓN.");
            client.release();
            process.exit(1);
        }

        // Get constraint name for UNIQUE(planta_key, tipo_certificado_clave)
        const consRes = await client.query(`
            SELECT conname
            FROM pg_constraint
            WHERE conrelid = 'fg_correlativo_certificado'::regclass
            AND contype = 'u'
        `);
        const oldUniqueName = consRes.rows.find(r => r.conname.includes('planta_tipo_key'))?.conname || (consRes.rows.length > 0 ? consRes.rows[0].conname : 'NO ENCONTRADA');
        console.log("B. Constraint UNIQUE anterior identificada para eliminar:", oldUniqueName);

        // FASE 1: ALTER (dentro de transacción)
        console.log("=== FASE 1: EJECUTANDO ALTER ===");
        await client.query('BEGIN');

        let alterCmds = "";
        if (oldUniqueName !== 'NO ENCONTRADA') {
            alterCmds += 'ALTER TABLE fg_correlativo_certificado DROP CONSTRAINT "' + oldUniqueName + '"; ';
        }
        
        alterCmds += "ALTER TABLE fg_correlativo_certificado ADD COLUMN fecha_asignacion TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP; ";
        alterCmds += "ALTER TABLE fg_correlativo_certificado ADD COLUMN fecha_cierre TIMESTAMP WITHOUT TIME ZONE NULL; ";
        
        alterCmds += "ALTER TABLE fg_correlativo_certificado ADD CONSTRAINT fg_correlativo_certificado_hist_key UNIQUE (planta_key, tipo_certificado_clave, nro_inicio, nro_maximo); ";
        alterCmds += "ALTER TABLE fg_correlativo_certificado ADD CONSTRAINT chk_cierre CHECK (activo = false OR fecha_cierre IS NULL); ";
        
        await client.query(alterCmds);
        
        const createIndexCmd = "CREATE UNIQUE INDEX fg_correlativo_certificado_activo_idx ON fg_correlativo_certificado (planta_key, tipo_certificado_clave) WHERE activo = true;";
        await client.query(createIndexCmd);
        
        await client.query('COMMIT');
        
        console.log("C. DDL exacto ejecutado con éxito.");

        // FASE 2: VALIDACIÓN
        console.log("=== FASE 2: VALIDACIÓN POSTERIOR ===");
        
        // Final structure
        const finalCols = await client.query(`
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns 
            WHERE table_name = 'fg_correlativo_certificado'
        `);
        console.log("D. Estructura final completa:");
        finalCols.rows.forEach(c => console.log("  " + c.column_name + ": " + c.data_type + " NULL:" + c.is_nullable + " DEF:" + (c.column_default||'-')));

        // Constraints & FKs
        const finalFks = await client.query(`
            SELECT 
                tc.constraint_name, tc.constraint_type, 
                kcu.column_name, rc.update_rule, rc.delete_rule,
                cc.check_clause
            FROM information_schema.table_constraints tc 
            JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name 
            LEFT JOIN information_schema.referential_constraints rc ON tc.constraint_name = rc.constraint_name
            LEFT JOIN information_schema.check_constraints cc ON tc.constraint_name = cc.constraint_name
            WHERE tc.table_name = 'fg_correlativo_certificado'
        `);
        console.log("\\nConstraints finales (E, G, H):");
        const uniqueConstraints = new Set();
        finalFks.rows.forEach(c => {
            if (!uniqueConstraints.has(c.constraint_name + c.column_name)) {
                uniqueConstraints.add(c.constraint_name + c.column_name);
                console.log("  - " + c.constraint_name + " [" + c.constraint_type + "] en " + c.column_name + ". CHECK: " + (c.check_clause||'-'));
            }
        });

        // Indexes
        const idxRes = await client.query(`
            SELECT indexname, indexdef
            FROM pg_indexes
            WHERE tablename = 'fg_correlativo_certificado'
            AND indexname = 'fg_correlativo_certificado_activo_idx'
        `);
        console.log("\\nF. Índice UNIQUE parcial creado:");
        idxRes.rows.forEach(i => console.log("  " + i.indexname + ": " + i.indexdef));

        const countAfterRes = await client.query("SELECT COUNT(*) FROM fg_correlativo_certificado");
        console.log("\\nI. Cantidad de filas después:", countAfterRes.rows[0].count);

    } catch (e) {
        await client.query('ROLLBACK');
        console.error("❌ ERROR. ROLLBACK EJECUTADO.", e);
    } finally {
        client.release();
    }
    process.exit(0);
}
run();
