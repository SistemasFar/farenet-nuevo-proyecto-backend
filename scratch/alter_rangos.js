const db = require('../config/database');

async function run() {
    const client = await db.connect();
    try {
        console.log("=== FASE 0: PRE-VALIDACIÓN ===");
        
        // Check fg_tipo_certificado count
        const tcCountRes = await client.query("SELECT COUNT(*) FROM fg_tipo_certificado");
        const tcCount = parseInt(tcCountRes.rows[0].count);
        console.log("A. Cantidad de registros en fg_tipo_certificado:", tcCount);

        // Check fg_correlativo_certificado count
        const countRes = await client.query("SELECT COUNT(*) FROM fg_correlativo_certificado");
        const count = parseInt(countRes.rows[0].count);
        console.log("J. Cantidad de correlativos antes:", count);

        if (count > 0 || tcCount !== 3) {
            console.log("❌ CONDICIÓN DE SEGURIDAD FALLIDA. ABORTANDO.");
            client.release();
            process.exit(1);
        }

        // Get constraint name to drop
        const consRes = await client.query(`
            SELECT conname
            FROM pg_constraint
            WHERE conrelid = 'fg_correlativo_certificado'::regclass
            AND contype = 'u'
        `);
        const oldUniqueName = consRes.rows.length > 0 ? consRes.rows[0].conname : 'NO ENCONTRADA';
        console.log("F. Constraint UNIQUE identificada para eliminar:", oldUniqueName);

        // FASE 1: ALTER (dentro de transacción)
        console.log("=== FASE 1: EJECUTANDO ALTER Y UPDATE ===");
        await client.query('BEGIN');

        // Cambio 1
        await client.query("ALTER TABLE fg_tipo_certificado ADD COLUMN codigo VARCHAR(2);");
        await client.query("UPDATE fg_tipo_certificado SET codigo = '22' WHERE clave = 'GNV_ANUAL';");
        await client.query("UPDATE fg_tipo_certificado SET codigo = '41' WHERE clave = 'GLP_ANUAL';");
        await client.query("UPDATE fg_tipo_certificado SET codigo = '39' WHERE clave = 'CONFORMIDAD';");
        await client.query("ALTER TABLE fg_tipo_certificado ALTER COLUMN codigo SET NOT NULL;");
        await client.query("ALTER TABLE fg_tipo_certificado ADD CONSTRAINT fg_tipo_certificado_codigo_key UNIQUE(codigo);");

        // Cambio 2
        let alterCmds = "";
        if (oldUniqueName !== 'NO ENCONTRADA') {
            alterCmds += 'ALTER TABLE fg_correlativo_certificado DROP CONSTRAINT "' + oldUniqueName + '"; ';
        }
        alterCmds += "ALTER TABLE fg_correlativo_certificado DROP COLUMN serie; ";
        alterCmds += "ALTER TABLE fg_correlativo_certificado RENAME COLUMN ultimo_numero TO nro_actual; ";
        alterCmds += "ALTER TABLE fg_correlativo_certificado ADD COLUMN nro_inicio BIGINT NOT NULL; ";
        alterCmds += "ALTER TABLE fg_correlativo_certificado ADD COLUMN nro_maximo BIGINT NOT NULL; ";
        
        alterCmds += "ALTER TABLE fg_correlativo_certificado ADD CONSTRAINT fg_correlativo_certificado_planta_tipo_key UNIQUE (planta_key, tipo_certificado_clave); ";
        
        alterCmds += "ALTER TABLE fg_correlativo_certificado ADD CONSTRAINT chk_nro_inicio CHECK (nro_inicio > 0); ";
        alterCmds += "ALTER TABLE fg_correlativo_certificado ADD CONSTRAINT chk_nro_maximo CHECK (nro_maximo >= nro_inicio); ";
        alterCmds += "ALTER TABLE fg_correlativo_certificado ADD CONSTRAINT chk_nro_actual_min CHECK (nro_actual >= (nro_inicio - 1)); ";
        alterCmds += "ALTER TABLE fg_correlativo_certificado ADD CONSTRAINT chk_nro_actual_max CHECK (nro_actual <= nro_maximo); ";
        
        await client.query(alterCmds);
        await client.query('COMMIT');
        
        console.log("B. DDL/DML exacto ejecutado con éxito.");

        // FASE 2: VALIDACIÓN
        console.log("=== FASE 2: VALIDACIÓN POSTERIOR ===");
        
        // Final structure fg_tipo_certificado
        const finalColsTc = await client.query(`
            SELECT column_name, data_type, is_nullable, character_maximum_length
            FROM information_schema.columns 
            WHERE table_name = 'fg_tipo_certificado'
        `);
        console.log("C. Estructura final fg_tipo_certificado:");
        finalColsTc.rows.forEach(c => console.log("  " + c.column_name + ": " + c.data_type + "(" + (c.character_maximum_length || '') + ") NULL:" + c.is_nullable));

        // Final structure fg_correlativo_certificado
        const finalCols = await client.query(`
            SELECT column_name, data_type, is_nullable, character_maximum_length
            FROM information_schema.columns 
            WHERE table_name = 'fg_correlativo_certificado'
        `);
        console.log("D. Estructura final fg_correlativo_certificado:");
        finalCols.rows.forEach(c => console.log("  " + c.column_name + ": " + c.data_type + "(" + (c.character_maximum_length || '') + ") NULL:" + c.is_nullable));

        const valoresFinales = await client.query("SELECT clave, codigo FROM fg_tipo_certificado");
        console.log("E. Valores finales:");
        valoresFinales.rows.forEach(r => console.log("  " + r.clave + " -> " + r.codigo));

        // Constraints & FKs fg_correlativo_certificado
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
        console.log("\\nConstraints finales en fg_correlativo_certificado (G, H, I):");
        const uniqueConstraints = new Set();
        finalFks.rows.forEach(c => {
            if (!uniqueConstraints.has(c.constraint_name + c.column_name)) {
                uniqueConstraints.add(c.constraint_name + c.column_name);
                console.log("  - " + c.constraint_name + " [" + c.constraint_type + "] en " + c.column_name + ". ON UP:" + (c.update_rule||'-') + ", ON DEL:" + (c.delete_rule||'-') + ", CHECK:" + (c.check_clause||'-'));
            }
        });

        const countAfterRes = await client.query("SELECT COUNT(*) FROM fg_correlativo_certificado");
        console.log("K. Cantidad de correlativos después:", countAfterRes.rows[0].count);

    } catch (e) {
        await client.query('ROLLBACK');
        console.error("❌ ERROR. ROLLBACK EJECUTADO.", e);
    } finally {
        client.release();
    }
    process.exit(0);
}
run();
