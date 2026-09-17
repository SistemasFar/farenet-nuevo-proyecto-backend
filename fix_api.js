const fs = require('fs');

const content = `const BASE_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:3000/api';

export interface ProductoFacturacion {
  id: number;
  codigo_sku: string;
  descripcion: string;
  tipo_producto?: string | null;
  categoria_dms?: string | null;
  categoria_id?: number | null;
  categoria_codigo?: string | null;
  categoria_nombre?: string | null;
  cuenta_por_cobrar?: string | null;
  unidad?: string | null;
  precio_unitario?: number | null;
  precio_referencia?: number | null;
  valor_referencial_unitario?: number | null;
  codigo_clasificacion_sunat?: string | null;
  tipo_afectacion_igv?: string | null;
  porcentaje_isc?: number | null;
  disponible_pos: boolean;
  es_para_venta: boolean;
  es_para_compra: boolean;
  tiene_icbper: boolean;
  activo: boolean;
  requiere_chip?: boolean;
  producto_chip_id?: number | null;
  precio_chip?: number | null;
}

const request = async (path: string, options: RequestInit = {}) => {
  const token = sessionStorage.getItem('faregasAccessToken')?.trim();
  const response = await fetch(\`\${BASE_URL}/faregas/config\${path}\`, {
    ...options,
    headers: {
      ...(token ? { Authorization: \`Bearer \${token}\` } : {}),
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || 'Error al procesar productos.');
  return data;
};

export const faregasProductosApi = {
  listar: async (): Promise<ProductoFacturacion[]> => {
    const response = await request('/productos');
    return response.productos || [];
  },
  crear: async (producto: Partial<ProductoFacturacion>): Promise<void> => {
    await request('/productos', { method: 'POST', body: JSON.stringify(producto) });
  },
  editar: async (id: number, producto: Partial<ProductoFacturacion>): Promise<void> => {
    await request(\`/productos/\${id}\`, { method: 'PUT', body: JSON.stringify(producto) });
  },
  cambiarEstado: async (id: number, activo: boolean): Promise<void> => {
    await request(\`/productos/\${id}/estado\`, { method: 'PUT', body: JSON.stringify({ activo }) });
  },
  eliminar: async (id: number): Promise<void> => {
    await request(\`/productos/\${id}\`, { method: 'DELETE' });
  }
};
`;

const apiFile = 'C:\\Users\\Sistemas2\\Desktop\\farenet nuevo proyecto\\farenetFrontend\\src\\modules\\faregas\\services\\faregas-productos.api.ts';
fs.writeFileSync(apiFile, content);
console.log('File fully restored and fixed');
