const fs = require('fs');

const apiFile = 'C:\\Users\\Sistemas2\\Desktop\\farenet nuevo proyecto\\farenetFrontend\\src\\modules\\faregas\\services\\faregas-productos.api.ts';
let apiContent = fs.readFileSync(apiFile, 'utf8');

if (!apiContent.includes('eliminar: async')) {
    apiContent = apiContent.replace(
        '};\r\n',
        `,
  eliminar: async (id: number): Promise<void> => {
    await request(\`/productos/\${id}\`, { method: 'DELETE' });
  }
};
`
    );
    // fallback if no \r\n
    if (!apiContent.includes('eliminar: async')) {
        apiContent = apiContent.replace(
            '};\n',
            `,
  eliminar: async (id: number): Promise<void> => {
    await request(\`/productos/\${id}\`, { method: 'DELETE' });
  }
};
`
        );
    }
    fs.writeFileSync(apiFile, apiContent);
    console.log('API fixed successfully');
}
