const fs = require('fs');
const schema = JSON.parse(fs.readFileSync('schema_dump.json'));

const tables = Object.keys(schema);
const getTable = name => schema[name];

let md = "# AUDITORÍA COMPLETA READ-ONLY DE BD PARA FAREGAS\n\n";
md += "## A. INVENTARIO GENERAL DE BD\n";

const fgTables = tables.filter(t => t.startsWith('fg_'));
const operationalTables = tables.filter(t => !t.startsWith('fg_') && !t.endsWith('_aud'));
const audTables = tables.filter(t => t.endsWith('_aud'));

md += `**Total de Tablas:** ${tables.length}\n`;
md += `**Tablas FAREGAS (fg_*):** ${fgTables.length}\n`;
md += `**Tablas Operativas FARENET:** ${operationalTables.length}\n`;
md += `**Tablas de Auditoría/Log FARENET:** ${audTables.length}\n\n`;

md += "## B. TABLAS RELACIONADAS CON VEHÍCULOS\n";
const vehicleTables = tables.filter(t => 
    t.includes('vehiculo') || t.includes('placa') || t.includes('marca') || 
    t.includes('modelo') || t.includes('categoria') || t.includes('clase') ||
    t.includes('carroceria') || t.includes('color') || t.includes('combustible')
);
md += "Las siguientes tablas contienen nombres relacionados a vehículos:\n";
vehicleTables.forEach(t => md += `- ${t} (Rows: ${schema[t].rowCount})\n`);
md += "\n";

md += "## C. TABLA PRINCIPAL DE VEHÍCULO Y SU ESTRUCTURA\n";
if (schema['vehiculo']) {
    md += "### vehiculo\n";
    md += "Representa el registro principal de vehículos en el sistema. Identifica al vehículo principalmente por placa/VIN.\n";
    md += "| Columna | Tipo | Nulo |\n|---|---|---|\n";
    schema['vehiculo'].columns.forEach(c => {
        md += `| ${c.column_name} | ${c.data_type} | ${c.is_nullable} |\n`;
    });
    md += "\n**Constraints/Relaciones:**\n";
    schema['vehiculo'].constraints.forEach(c => {
        md += `- ${c.constraint_type}: ${c.column_name} ${c.foreign_table_name ? `-> ${c.foreign_table_name}(${c.foreign_column_name})` : ''}\n`;
    });
} else {
    md += "No se encontró tabla 'vehiculo'.\n";
}
md += "\n";

md += "## D. CATÁLOGOS VEHICULARES\n";
const catalogos = ['marca', 'modelo', 'categoria', 'color', 'combustible', 'carroceria', 'vehiculoclase'];
catalogos.forEach(c => {
    if (schema[c]) {
        md += `- **${c}**: (Rows: ${schema[c].rowCount}) POTENCIALMENTE COMPARTIBLE.\n`;
    }
});
md += "\n";

md += "## E. PERSONAS / PROPIETARIOS / CLIENTES\n";
const personTables = tables.filter(t => t.includes('persona') || t.includes('cliente') || t.includes('empresa'));
personTables.forEach(t => md += `- **${t}**: (Rows: ${schema[t].rowCount})\n`);
md += "\nNOTA: LOS CLIENTES DE FAREGAS SON DISTINTOS DE LOS CLIENTES DE FARENET. La tabla 'persona' es genérica y puede ser POTENCIALMENTE COMPARTIBLE como maestro de DNI/RUC, pero la relación comercial (clientes) podría requerir separación.\n\n";

md += "## F. TALLERES AUTORIZADOS\n";
const tallerTables = tables.filter(t => t.includes('taller') || t.includes('t_conversiones'));
if (tallerTables.length > 0) {
    tallerTables.forEach(t => md += `- **${t}**: (Rows: ${schema[t].rowCount})\n`);
} else {
    md += "No se encontró estructura clara denominada 'taller' o 'taller_autorizado' (Existe fg_planta para sedes, pero no necesariamente talleres externos).\n";
}
md += "\n";

md += "## G. INFORMACIÓN GLP EXISTENTE\n";
const glpTables = tables.filter(t => t.toLowerCase().includes('glp') || t.toLowerCase().includes('cilindro') || t.toLowerCase().includes('componente') || t.toLowerCase().includes('regulador'));
if (glpTables.length > 0) {
    glpTables.forEach(t => md += `- ${t}\n`);
} else {
    md += "NO ENCONTRADO.\n";
}
md += "\n";

md += "## H. INFORMACIÓN GNV EXISTENTE\n";
const gnvTables = tables.filter(t => t.toLowerCase().includes('gnv') || t.toLowerCase().includes('pec') || t.toLowerCase().includes('kit'));
if (gnvTables.length > 0) {
    gnvTables.forEach(t => md += `- ${t}\n`);
} else {
    md += "NO ENCONTRADO.\n";
}
md += "\n";

md += "## I. INFORMACIÓN CONFORMIDAD EXISTENTE\n";
const confTables = tables.filter(t => t.toLowerCase().includes('conformidad') || t.toLowerCase().includes('montaje') || t.toLowerCase().includes('modificacion'));
if (confTables.length > 0) {
    confTables.forEach(t => md += `- ${t}\n`);
} else {
    md += "NO ENCONTRADO.\n";
}
md += "\n";

md += "## J. PAGOS\n";
const pagoTables = tables.filter(t => t.includes('pago'));
pagoTables.forEach(t => md += `- **${t}**: (Rows: ${schema[t].rowCount})\n`);
md += "\n";

md += "## K. COMPROBANTES / FACTURACIÓN\n";
const compTables = tables.filter(t => t.includes('comprobante') || t.includes('factura') || t.includes('boleta'));
compTables.forEach(t => md += `- **${t}**: (Rows: ${schema[t].rowCount})\n`);
md += "\n";

md += "## L. CORRELATIVOS / CERTIFICADOS\n";
const certTables = tables.filter(t => t.includes('certificado') || t.includes('correlativo') || t.includes('serie'));
certTables.forEach(t => md += `- **${t}**: (Rows: ${schema[t].rowCount})\n`);
md += "\n";

md += "## M. TABLAS FAREGAS YA EXISTENTES\n";
fgTables.forEach(t => md += `- **${t}**: (Rows: ${schema[t].rowCount}) - FAREGAS EXISTENTE.\n`);
md += "\n";

md += "## N. MAPA DE RELACIONES\n";
md += "```text\n";
md += "vehiculo\n";
md += "   +-- marca_id -> marca\n";
md += "   +-- modelo_id -> modelo\n";
md += "   +-- categoria_id -> categoria\n";
md += "   +-- color_id -> color\n";
md += "   +-- combustible_id -> combustible\n";
md += "```\n\n";

md += "## O. MATRIZ COMPLETA: CAMPO CERTIFICADO → TABLA/COLUMNA ACTUAL\n";
const vCols = schema['vehiculo'] ? schema['vehiculo'].columns.map(c => c.column_name) : [];
const checkField = (name, keyword) => {
    const found = vCols.find(c => c.includes(keyword));
    return `| ${name} | vehiculo | ${found || '-'} | ${found ? 'SI' : 'NO'} | ${found ? 'Potencialmente compartible' : 'Falta'} |\n`;
};

md += "| CAMPO | TABLA ACTUAL | COLUMNA ACTUAL | EXISTE | OBSERVACIÓN |\n";
md += "|---|---|---|---|---|\n";
md += checkField("Placa", "placa");
md += checkField("Categoría", "categoria");
md += checkField("Clase", "clase");
md += checkField("Marca", "marca");
md += checkField("Modelo", "modelo");
md += checkField("Versión", "version");
md += checkField("Año Fabricación", "anio");
md += checkField("Año Modelo", "modelo");
md += checkField("VIN / Serie / Chasis", "vin");
md += checkField("Motor", "motor");
md += checkField("Combustible", "combustible");
md += checkField("Color", "color");
md += checkField("Carrocería", "carroceria");
md += checkField("Cilindros", "cilindro");
md += checkField("Cilindrada", "cilindrada");
md += checkField("Ejes", "eje");
md += checkField("Ruedas", "rueda");
md += checkField("Asientos", "asiento");
md += checkField("Pasajeros", "pasajero");
md += checkField("Largo", "largo");
md += checkField("Ancho", "ancho");
md += checkField("Alto", "alto");
md += checkField("Peso Neto", "peso");
md += checkField("Peso Bruto", "peso");
md += checkField("Carga Útil", "carga");
md += checkField("Potencia", "potencia");
md += checkField("Fórmula Rodante", "formula");
md += "\n";

md += "## P. TABLAS POTENCIALMENTE COMPARTIBLES\n";
md += "- vehiculo\n- marca\n- modelo\n- categoria\n- vehiculoclase\n- color\n- combustible\n- carroceria\n- persona (sólo como maestro de RUC/DNI)\n\n";

md += "## Q. TABLAS FARENET QUE NO DEBEN TOCARSE\n";
md += "- inspeccion\n- inspeccionestado\n- ordentrabajo\n- certificado (es específico de FARENET)\n- comprobante\n- pago\n\n";

md += "## R. DATOS QUE NO EXISTEN Y QUE FAREGAS NECESITARÁ\n";
md += "- Talleres de conversión (y autorizados).\n";
md += "- Componentes GLP (cilindro, regulador, marca, serie).\n";
md += "- Componentes GNV (kit, cilindro, PEC).\n";
md += "- Modificaciones para Conformidad (motivo, montaje, uso original).\n";
md += "- Certificados específicos GNV, GLP, Conformidad.\n\n";

md += "## S. DUDAS/DECISIONES QUE NECESITAN MI APROBACIÓN\n";
md += "1. ¿Deseas que creemos una tabla separada `fg_vehiculo` o reutilizamos la tabla `vehiculo` agregándole las columnas faltantes (si existieran)? (Recomendado: Compartir maestro de vehículos).\n";
md += "2. ¿Deseas que los Clientes de FAREGAS usen la tabla `persona` genérica para guardar nombres/RUC, y creemos una tabla `fg_cliente` para la relación comercial?\n";
md += "3. Los correlativos de certificados GLP/GNV/Conformidad deberán crearse en nuevas tablas (ej. `fg_certificado_glp`, `fg_certificado_gnv`). ¿Apruebas el diseño de estas nuevas entidades basándonos en los datos faltantes?\n\n";

md += "## T. BD MODIFICADA\nNO\n\n";
md += "## U. CÓDIGO MODIFICADO\nNO\n";

fs.writeFileSync('reporte.md', md);
