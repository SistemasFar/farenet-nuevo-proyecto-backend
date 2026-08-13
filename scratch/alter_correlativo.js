const db = require('../config/database');

async function run() {
    const client = await db.connect();
    try {
        console.log("=== FASE 0: PRE-VALIDACIÓN ===");
        
        // 1 & 2. Get fg_planta.key data type
        const colRes = await client.query(`
            SELECT data_type, character_maximum_length 
            FROM information_schema.columns 
            WHERE table_name = 'fg_planta' AND column_name = 'key'
        `);
        const plantaKeyType = colRes.rows[0].data_type === 'character varying' 
            ? "VARCHAR(" + colRes.rows[0].character_maximum_length + ")" 
            : colRes.rows[0].data_type;
        console.log("fg_planta.key type:", plantaKeyType);

        // 3. Count rows
        const countRes = await client.query("SELECT COUNT(*) FROM fg_correlativo_certificado");
        const count = parseInt(countRes.rows[0].count);
        console.log("A. Cantidad de registros antes del cambio:", count);

        if (count > 0) {
            console.log("❌ SE ENCONTRARON REGISTROS. DETENIENDO EJECUCIÓN COMO FUE SOLICITADO.");
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
        console.log("C. Constraint UNIQUE identificada para eliminar:", oldUniqueName);

        // FASE 1: ALTER (dentro de transacción)
        console.log("=== FASE 1: EJECUTANDO ALTER ===");
        await client.query('BEGIN');

        let alterCmds = "ALTER TABLE fg_correlativo_certificado ADD COLUMN planta_key " + plantaKeyType + " NOT NULL;";
        alterCmds += "ALTER TABLE fg_correlativo_certificado ADD CONSTRAINT fk_correlativo_planta FOREIGN KEY (planta_key) REFERENCES fg_planta(key) ON UPDATE CASCADE ON DELETE NO ACTION;";
        if (oldUniqueName !== 'NO ENCONTRADA') {
            alterCmds += 'ALTER TABLE fg_correlativo_certificado DROP CONSTRAINT "' + oldUniqueName + '";';
        }
        alterCmds += "ALTER TABLE fg_correlativo_certificado ADD CONSTRAINT fg_correlativo_certificado_planta_tipo_serie_key UNIQUE (planta_key, tipo_certificado_clave, serie);";
        
        await client.query(alterCmds);
        await client.query('COMMIT');
        
        console.log("B. ALTER exacto ejecutado con éxito.");

        // FASE 2: VALIDACIÓN
        console.log("=== FASE 2: VALIDACIÓN POSTERIOR ===");
        
        // Final structure
        const finalCols = await client.query(`
            SELECT column_name, data_type, is_nullable, character_maximum_length
            FROM information_schema.columns 
            WHERE table_name = 'fg_correlativo_certificado'
        `);
        console.log("F. Estructura final:");
        finalCols.rows.forEach(c => console.log("  " + c.column_name + ": " + c.data_type + "(" + (c.character_maximum_length || '') + ") NULL:" + c.is_nullable));

        // Constraints & FKs
        const finalFks = await client.query(`
            SELECT 
                tc.constraint_name, tc.constraint_type, 
                kcu.column_name, rc.update_rule, rc.delete_rule
            FROM information_schema.table_constraints tc 
            JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name 
            LEFT JOIN information_schema.referential_constraints rc ON tc.constraint_name = rc.constraint_name
            WHERE tc.table_name = 'fg_correlativo_certificado'
        `);
        console.log("\\nConstraints finales (D, E, G):");
        finalFks.rows.forEach(c => {
            console.log("  - " + c.constraint_name + " [" + c.constraint_type + "] en " + c.column_name + ". ON UP:" + (c.update_rule||'-') + ", ON DEL:" + (c.delete_rule||'-'));
        });

        const countAfterRes = await client.query("SELECT COUNT(*) FROM fg_correlativo_certificado");
        console.log("\\nH. Cantidad de registros después:", countAfterRes.rows[0].count);

    } catch (e) {
        await client.query('ROLLBACK');
        console.error("❌ ERROR. ROLLBACK EJECUTADO.", e);
    } finally {
        client.release();
    }
    process.exit(0);
}
run();
