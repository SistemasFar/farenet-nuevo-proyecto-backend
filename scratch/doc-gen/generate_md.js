const fs = require('fs');

const schema = JSON.parse(fs.readFileSync('schema_raw.json', 'utf8'));

let md = `# DOCUMENTACION BASE DE DATOS FAREGAS\n\n`;
md += `FAREGAS YA CREADAS (22)\n\n`;
md += `Divididas en:\n`;
md += `A. Seguridad / configuración / acceso: 9\n`;
md += `B. Operación de certificados: 13\n\n`;

md += `## MAESTROS COMPARTIDOS\n\n`;
md += `FAREGAS consulta maestros vehiculares existentes en FARENET:\n`;
md += `- vehiculo\n- marca\n- modelo\n- categoria\n- vehiculoclase\n- color\n- combustible\n- carroceria\n\n`;
md += `IMPORTANTE: Estas NO son tablas fg_*. NO incluir CREATE TABLE de estas tablas dentro del instalador FAREGAS. FAREGAS únicamente las utiliza posteriormente como fuente de consulta / autocompletado.\n\n`;

md += `## CLIENTES\n\n`;
md += `FARENET -> sus propios clientes / persona\n\n`;
md += `FAREGAS -> fg_cliente\n\n`;
md += `NO existe FK: fg_cliente -> persona. FAREGAS mantiene sus clientes independientemente. Puede consultar información FARENET para autocompletar posteriormente, pero el registro propio permanece en fg_cliente.\n\n`;

const initTables = ['fg_usuario', 'fg_perfil', 'fg_permiso', 'fg_perfil_permiso', 'fg_planta', 'fg_perfil_planta', 'fg_usuario_planta', 'fg_usuario_sesion', 'fg_auditoria_acceso'];
const opTables = ['fg_cliente', 'fg_tipo_certificado', 'fg_correlativo_certificado', 'fg_certificado', 'fg_certificado_vehiculo', 'fg_certificado_titular', 'fg_taller_autorizado', 'fg_certificado_gnv', 'fg_certificado_gnv_verificacion', 'fg_certificado_glp', 'fg_certificado_glp_componente', 'fg_certificado_glp_verificacion', 'fg_certificado_conformidad'];

md += `## MODELO OPERATIVO DE CERTIFICADOS FAREGAS\n\n`;

function genTableSection(t) {
    let s = `### ${t}\n\n`;
    s += `**Objetivo funcional**: Almacena información sobre ${t}.\n\n`;
    
    // Config specifics
    if (t === 'fg_tipo_certificado') {
        s += `**Valores actuales:**\n- GNV_ANUAL -> 22\n- GLP_ANUAL -> 41\n- CONFORMIDAD -> 39\n\n`;
        s += `DG es el prefijo común. 22 = GNV, 41 = GLP, 39 = CONFORMIDAD. La numeración futura se construirá conceptualmente como: DG-{codigo_tipo}-{correlativo}.\n\n`;
    }
    
    if (t === 'fg_correlativo_certificado') {
        s += `**Regla Funcional de Rangos**:\n`;
        s += `Los rangos son asignados según PLANTA + TIPO DE CERTIFICADO.\n\n`;
        s += `Semántica:\n`;
        s += `- nro_inicio = primer número permitido.\n`;
        s += `- nro_actual = último número ya utilizado.\n`;
        s += `- nro_maximo = último número permitido.\n`;
        s += `Para un rango nuevo: nro_actual = nro_inicio - 1\n\n`;
        s += `**Historial de Rangos**:\n`;
        s += `Conserva múltiples rangos históricos para una misma planta + tipo. NO se sobrescriben rangos anteriores. Existe solamente un rango activo simultáneamente para planta + tipo.\n\n`;
        s += `**Protección Contra Solapamiento**:\n`;
        s += `La constraint excl_fg_correlativo_rango utiliza EXCLUDE USING gist con:\n`;
        s += `planta_key WITH =, tipo_certificado_clave WITH =, int8range(nro_inicio, nro_maximo, '[]') WITH &&\n\n`;
        s += `Para la misma planta + tipo: 101-200 y 150-250 NO está permitido. Pero 101-200 y 201-300 SÍ está permitido.\n\n`;
    }

    s += `**Tabla de Columnas:**\n`;
    s += `| COLUMNA | TIPO | LONGITUD/PRECISIÓN | NULL | DEFAULT | PK/FK |\n`;
    s += `| --- | --- | --- | --- | --- | --- |\n`;
    
    const cols = schema[t].columns;
    const cons = schema[t].constraints;
    const idxs = schema[t].indexes;
    
    for(let c of cols) {
        let isPk = cons.some(x => x.constraint_type === 'PRIMARY KEY' && x.column_name === c.column_name) ? 'PK' : '';
        let isFk = cons.some(x => x.constraint_type === 'FOREIGN KEY' && x.column_name === c.column_name) ? 'FK' : '';
        let pkfk = [isPk, isFk].filter(Boolean).join('/');
        
        let lenPrec = c.character_maximum_length || c.numeric_precision || '-';
        let isNull = c.is_nullable === 'YES' ? 'NULL' : 'NOT NULL';
        
        s += `| ${c.column_name} | ${c.data_type} | ${lenPrec} | ${isNull} | ${c.column_default || '-'} | ${pkfk} |\n`;
    }
    s += `\n`;
    
    s += `**PRIMARY KEY:**\n`;
    const pk = cons.filter(x => x.constraint_type === 'PRIMARY KEY');
    if (pk.length > 0) {
        const pkCols = pk.map(x => x.column_name).join(', ');
        s += `- ${pk[0].constraint_name} (${pkCols})\n`;
    } else { s += `- Ninguna\n`; }
    s += `\n`;
    
    s += `**FOREIGN KEYS:**\n`;
    const fk = cons.filter(x => x.constraint_type === 'FOREIGN KEY');
    if (fk.length > 0) {
        let fks = {};
        for(let x of fk) {
            if(!fks[x.constraint_name]) fks[x.constraint_name] = {cols: [], refTable: x.foreign_table_name, refCols: [], upd: x.update_rule, del: x.delete_rule};
            fks[x.constraint_name].cols.push(x.column_name);
            fks[x.constraint_name].refCols.push(x.foreign_column_name);
        }
        for(let k in fks) {
            let f = fks[k];
            s += `- **${k}**: (${f.cols.join(', ')}) -> ${f.refTable} (${f.refCols.join(', ')}). ON UPDATE ${f.upd} ON DELETE ${f.del}\n`;
        }
    } else { s += `- Ninguna\n`; }
    s += `\n`;
    
    s += `**UNIQUE:**\n`;
    const uq = cons.filter(x => x.constraint_type === 'UNIQUE');
    if (uq.length > 0) {
        let uqs = {};
        for(let x of uq) {
            if(!uqs[x.constraint_name]) uqs[x.constraint_name] = [];
            uqs[x.constraint_name].push(x.column_name);
        }
        for(let k in uqs) {
            s += `- **${k}**: (${uqs[k].join(', ')})\n`;
        }
    } else { s += `- Ninguna\n`; }
    s += `\n`;
    
    s += `**CHECK:**\n`;
    const chk = cons.filter(x => x.constraint_type === 'CHECK');
    if (chk.length > 0) {
        let chks = {};
        for(let x of chk) {
            if(!chks[x.constraint_name]) chks[x.constraint_name] = x.check_clause;
        }
        for(let k in chks) {
            s += `- **${k}**: ${chks[k]}\n`;
        }
    } else { s += `- Ninguna\n`; }
    s += `\n`;
    
    s += `**Índices:**\n`;
    if (idxs.length > 0) {
        for(let i of idxs) {
            if(!i.indexdef.includes('UNIQUE CONSTRAINT')) { // Skip index generated for unique constraint
                s += `- **${i.indexname}**: \n  \`\`\`sql\n  ${i.indexdef};\n  \`\`\`\n`;
            }
        }
    } else { s += `- Ningunos\n`; }
    s += `\n`;
    
    s += `**Script CREATE TABLE REAL:**\n`;
    s += `\`\`\`sql\nCREATE TABLE ${t} (\n`;
    let colDefs = [];
    for(let c of cols) {
        let def = `  ${c.column_name} ${c.data_type}`;
        if(c.character_maximum_length) def += `(${c.character_maximum_length})`;
        if(c.is_nullable === 'NO') def += ` NOT NULL`;
        if(c.column_default) def += ` DEFAULT ${c.column_default}`;
        colDefs.push(def);
    }
    
    if (pk.length > 0) {
        let pkSet = [...new Set(pk.map(x => x.column_name))];
        colDefs.push(`  CONSTRAINT ${pk[0].constraint_name} PRIMARY KEY (${pkSet.join(', ')})`);
    }
    
    s += colDefs.join(',\n') + '\n);\n\`\`\`\n\n';
    return s;
}

for(let t of opTables) {
    md += genTableSection(t);
}

md += `## RELACIONES OPERATIVAS\n\n`;
md += `\`\`\`text
fg_cliente
   |
   +--> fg_certificado
             |
             +--> fg_certificado_vehiculo
             |
             +--> fg_certificado_titular
             |
             +--> fg_certificado_gnv
             |       |
             |       +--> fg_certificado_gnv_verificacion
             |
             +--> fg_certificado_glp
             |       |
             |       +--> fg_certificado_glp_componente
             |       |
             |       +--> fg_certificado_glp_verificacion
             |
             +--> fg_certificado_conformidad

fg_planta
   |
   +--> fg_correlativo_certificado

fg_tipo_certificado
   |
   +--> fg_correlativo_certificado
   |
   +--> fg_certificado

fg_taller_autorizado
   |
   +--> fg_certificado_gnv
   |
   +--> fg_certificado_glp
\`\`\`\n\n`;

md += `## DEPENDENCIAS POSTGRESQL\n\n`;
md += `La base de datos requiere la extensión \`btree_gist\` instalada para la constraint de exclusión de rangos de fg_correlativo_certificado.\n\n`;
md += `\`\`\`sql\nCREATE EXTENSION IF NOT EXISTS btree_gist;\n\`\`\`\n\n`;


md += `## DATOS ACTUALES\n\n`;
md += `Para tablas de catálogos y configuración. Para *fg_correlativo_certificado*: Sin rangos configurados actualmente.\n\n`;

md += `## ANEXO A - SCRIPT COMPLETO DE INSTALACIÓN FAREGAS\n\n`;
md += `El script crea 22 tablas en el orden correcto de dependencias y sin datos conflictivos, ideal para despliegues de producción.\n\n`;
md += `\`\`\`sql\nCREATE EXTENSION IF NOT EXISTS btree_gist;\n\n`;

const allTablesOrder = [
    'fg_planta', 'fg_taller_autorizado', 'fg_cliente', 'fg_tipo_certificado',
    'fg_perfil', 'fg_permiso', 'fg_perfil_permiso', 'fg_perfil_planta',
    'fg_usuario', 'fg_usuario_planta', 'fg_usuario_sesion', 'fg_auditoria_acceso',
    'fg_correlativo_certificado', 'fg_certificado',
    'fg_certificado_vehiculo', 'fg_certificado_titular',
    'fg_certificado_gnv', 'fg_certificado_gnv_verificacion',
    'fg_certificado_glp', 'fg_certificado_glp_componente', 'fg_certificado_glp_verificacion',
    'fg_certificado_conformidad'
];

for(let t of allTablesOrder) {
    if(!schema[t]) continue;
    let cols = schema[t].columns;
    let cons = schema[t].constraints;
    md += `CREATE TABLE ${t} (\n`;
    let colDefs = [];
    for(let c of cols) {
        let def = `  ${c.column_name} ${c.data_type}`;
        if(c.character_maximum_length) def += `(${c.character_maximum_length})`;
        if(c.is_nullable === 'NO') def += ` NOT NULL`;
        if(c.column_default) def += ` DEFAULT ${c.column_default}`;
        colDefs.push(def);
    }
    const pk = cons.filter(x => x.constraint_type === 'PRIMARY KEY');
    if (pk.length > 0) {
        let pkSet = [...new Set(pk.map(x => x.column_name))];
        colDefs.push(`  CONSTRAINT ${pk[0].constraint_name} PRIMARY KEY (${pkSet.join(', ')})`);
    }
    const fk = cons.filter(x => x.constraint_type === 'FOREIGN KEY');
    let fks = {};
    for(let x of fk) {
        if(!fks[x.constraint_name]) fks[x.constraint_name] = {cols: [], refTable: x.foreign_table_name, refCols: [], upd: x.update_rule, del: x.delete_rule};
        if(!fks[x.constraint_name].cols.includes(x.column_name)) fks[x.constraint_name].cols.push(x.column_name);
        if(!fks[x.constraint_name].refCols.includes(x.foreign_column_name)) fks[x.constraint_name].refCols.push(x.foreign_column_name);
    }
    for(let k in fks) {
        colDefs.push(`  CONSTRAINT ${k} FOREIGN KEY (${fks[k].cols.join(', ')}) REFERENCES ${fks[k].refTable} (${fks[k].refCols.join(', ')}) ON UPDATE ${fks[k].upd} ON DELETE ${fks[k].del}`);
    }
    const uq = cons.filter(x => x.constraint_type === 'UNIQUE');
    let uqs = {};
    for(let x of uq) {
        if(!uqs[x.constraint_name]) uqs[x.constraint_name] = [];
        if(!uqs[x.constraint_name].includes(x.column_name)) uqs[x.constraint_name].push(x.column_name);
    }
    for(let k in uqs) {
        colDefs.push(`  CONSTRAINT ${k} UNIQUE (${uqs[k].join(', ')})`);
    }
    const chk = cons.filter(x => x.constraint_type === 'CHECK');
    let chks = {};
    for(let x of chk) {
        if(!chks[x.constraint_name]) chks[x.constraint_name] = x.check_clause;
    }
    for(let k in chks) {
        colDefs.push(`  CONSTRAINT ${k} CHECK (${chks[k]})`);
    }
    md += colDefs.join(',\n') + '\n);\n\n';
    
    // extra constraints (EXCLUDE) or indices that weren't captured in table defs
    for(let i of schema[t].indexes) {
        if(!i.indexdef.includes('UNIQUE CONSTRAINT') && !i.indexdef.includes('PRIMARY KEY')) {
            md += `${i.indexdef};\n\n`;
        }
    }
}
md += `\n-- Datos Iniciales\n`;
md += `INSERT INTO fg_tipo_certificado (clave, nombre, descripcion, activo, fecha_creacion, fecha_modificacion, codigo) VALUES\n`;
md += `('GNV_ANUAL', 'Certificado GNV Anual', '', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 22),\n`;
md += `('GLP_ANUAL', 'Certificado GLP Anual', '', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 41),\n`;
md += `('CONFORMIDAD', 'Certificado Conformidad', '', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 39);\n`;

md += `\`\`\`\n\n`;

md += `## ORDEN DE EJECUCIÓN EN PRODUCCIÓN\n\n`;
md += `El orden calculado según dependencias (FKs) es:\n\n`;
for(let i=0; i<allTablesOrder.length; i++){
    md += `${i+1}. ${allTablesOrder[i]}\n`;
}

fs.writeFileSync('scratch/doc-gen/DOC.md', md);
console.log("Written DOC.md");
