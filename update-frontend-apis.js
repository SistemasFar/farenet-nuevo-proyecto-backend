const fs = require('fs');

const path2 = 'C:\\Users\\Sistemas2\\Desktop\\farenet nuevo proyecto\\farenetFrontend\\src\\modules\\faregas\\services\\faregas-config.api.ts';
let content2 = fs.readFileSync(path2, 'utf8');

const repl2 = `  cambiarEstadoServicio: async (id: number, activo: boolean): Promise<void> => {
    const response = await api.put(\`/api/faregas/config/servicios/\${id}/estado\`, { activo });
    return response;
  },

  asignarFormato: async (id: number, formatoId: number): Promise<void> => {
    return api.put(\`/api/faregas/config/servicios/\${id}/formato\`, { formato_id: formatoId });
  },

  crearVarianteFormato: async (id: number): Promise<{ formato: any }> => {
    const res = await api.post(\`/api/faregas/config/servicios/\${id}/formato/variante\`);
    return res.data || res;
  },`;

const newContent = content2.replace(/cambiarEstadoServicio: async \(id: number, activo: boolean\): Promise<void> => {[\s\S]*?return response;\s*},/, repl2);

if (newContent !== content2) {
    fs.writeFileSync(path2, newContent);
    console.log('Updated faregas-config.api.ts');
} else {
    console.log('Target not found in faregas-config.api.ts');
}
