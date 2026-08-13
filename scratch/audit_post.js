const db = require('../config/database');
const fs = require('fs');

async function run() {
    const client = await db.connect();
    
    try {
        const targetTables = [
            'fg_cliente', 'fg_tipo_certificado', 'fg_correlativo_certificado',
            'fg_certificado', 'fg_certificado_vehiculo', 'fg_certificado_titular',
            'fg_taller_autorizado', 'fg_certificado_gnv', 'fg_certificado_gnv_verificacion',
            'fg_certificado_glp', 'fg_certificado_glp_componente', 'fg_certificado_glp_verificacion',
            'fg_certificado_conformidad'
        ];
        
        let report = "# AUDITORÍA FINAL READ-ONLY DE 13 TABLAS FAREGAS\n\n";
        
        // A. Foreign Keys
        const fksQuery = `
            SELECT 
                tc.table_name,
                kcu.column_name, 
                ccu.table_name AS foreign_table_name,
                ccu.column_name AS foreign_column_name,
                rc.update_rule,
                rc.delete_rule,
                tc.constraint_name
            FROM information_schema.table_constraints tc 
            JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name 
            JOIN information_schema.referential_constraints rc ON tc.constraint_name = rc.constraint_name
            JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
            WHERE tc.table_name = ANY($1)
            ORDER BY tc.table_name, kcu.column_name;
        `;
        const fks = await client.query(fksQuery, [targetTables]);
        
        report += "## A. Lista completa de FK y acciones ON DELETE / ON UPDATE\n";
        report += "| Tabla Origen | Columna Origen | Tabla Destino | Columna Destino | ON UPDATE | ON DELETE |\n";
        report += "|---|---|---|---|---|---|\n";
        fks.rows.forEach(fk => {
            report += `| ${fk.table_name} | ${fk.column_name} | ${fk.foreign_table_name} | ${fk.foreign_column_name} | ${fk.update_rule} | ${fk.delete_rule} |\n`;
        });
        report += "\n";
        
        // B. Cascade Deletes
        report += "## B. FK que usan ON DELETE CASCADE\n";
        const cascadeFks = fks.rows.filter(fk => fk.delete_rule === 'CASCADE');
        cascadeFks.forEach(fk => {
            report += `- ${fk.table_name}.${fk.column_name} -> ${fk.foreign_table_name}.${fk.foreign_column_name}\n`;
        });
        report += "\n";
        
        // C. Consecuencia de eliminar fg_certificado
        report += "## C. Consecuencia de eliminar un fg_certificado\n";
        report += "Si se ejecuta `DELETE FROM fg_certificado WHERE id = X`, ocurriría lo siguiente:\n";
        const dependants = fks.rows.filter(fk => fk.foreign_table_name === 'fg_certificado');
        
        let cascadeTables = dependants.filter(fk => fk.delete_rule === 'CASCADE').map(fk => fk.table_name);
        let blockTables = dependants.filter(fk => fk.delete_rule !== 'CASCADE').map(fk => fk.table_name);
        
        if (blockTables.length > 0) {
            report += "**Bloquearían la operación (RESTRICT / NO ACTION):**\n";
            blockTables.forEach(t => report += `- ${t}\n`);
            report += "\n*Resultado: El DELETE fallará si existen registros en estas tablas.*\n";
        } else {
            report += "**Se eliminarían automáticamente en cascada:**\n";
            cascadeTables.forEach(t => report += `- ${t}\n`);
            report += "\n*Resultado: El DELETE eliminaría la cabecera del certificado y todos sus registros en estas tablas hijas automáticamente.*\n";
        }
        report += "\n";
        
        // D. Indices redundantes
        report += "## D. Índices Redundantes Encontrados\n";
        const idxQuery = `
            SELECT
                t.relname as table_name,
                i.relname as index_name,
                a.attname as column_name,
                ix.indisunique,
                ix.indisprimary
            FROM
                pg_class t,
                pg_class i,
                pg_index ix,
                pg_attribute a
            WHERE
                t.oid = ix.indrelid
                and i.oid = ix.indexrelid
                and a.attrelid = t.oid
                and a.attnum = ANY(ix.indkey)
                and t.relkind = 'r'
                and t.relname = ANY($1)
            ORDER BY t.relname, a.attname;
        `;
        const idxs = await client.query(idxQuery, [targetTables]);
        
        const colIndices = {};
        idxs.rows.forEach(idx => {
            const key = `${idx.table_name}.${idx.column_name}`;
            if (!colIndices[key]) colIndices[key] = [];
            colIndices[key].push(idx);
        });
        
        let foundRedundant = false;
        Object.keys(colIndices).forEach(key => {
            const indices = colIndices[key];
            if (indices.length > 1) {
                const isUniqueOrPK = indices.find(i => i.indisunique || i.indisprimary);
                const isManual = indices.find(i => !i.indisunique && !i.indisprimary);
                
                if (isUniqueOrPK && isManual) {
                    foundRedundant = true;
                    report += `- Redundancia en **${key}**:\n`;
                    report += `  - Índice principal/único: ${isUniqueOrPK.index_name}\n`;
                    report += `  - Índice manual redundante: ${isManual.index_name}\n`;
                }
            }
        });
        
        if (!foundRedundant) {
            report += "No se encontraron índices manuales que sean redundantes con PK o UNIQUE.\n";
        }
        report += "\n";

        fs.writeFileSync('scratch/audit_post.md', report);
        console.log("Auditoría generada en scratch/audit_post.md");
    } catch(e) { console.error(e); } finally { client.release(); }
    process.exit(0);
}
run();
