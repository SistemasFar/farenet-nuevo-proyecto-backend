const fs = require('fs');
const apiPath = 'C:\\Users\\Sistemas2\\Desktop\\farenet nuevo proyecto\\farenetFrontend\\src\\modules\\faregas\\services\\faregas-chips.api.ts';
let apiContent = fs.readFileSync(apiPath, 'utf8');

const typeStr = `
export interface VentaDirectaPayload {
  tipoComprobante: string;
  tipoDocumentoCliente: string;
  nroDocumento: string;
  nombreRazonSocial: string;
  direccion?: string;
  email?: string;
  telefono?: string;
  condicionPago: string;
  medioPago: string;
  chips: string[];
}
`;

if (!apiContent.includes('VentaDirectaPayload')) {
    apiContent = apiContent.replace(
        "export interface CrearProductoInventariablePayload",
        typeStr + "\nexport interface CrearProductoInventariablePayload"
    );
}

const methodStr = `ventaDirecta: async (payload: VentaDirectaPayload) => faregasFetch('/chips/venta-directa', { method: 'POST', body: JSON.stringify(payload) }),`;

if (!apiContent.includes('ventaDirecta:')) {
    apiContent = apiContent.replace(
        "baja: async (numeroChip:string,referencia:string) => faregasFetch('/chips/bajas',{method:'POST',body:JSON.stringify({numeroChip,referencia})}),",
        "baja: async (numeroChip:string,referencia:string) => faregasFetch('/chips/bajas',{method:'POST',body:JSON.stringify({numeroChip,referencia})}),\n  " + methodStr
    );
}

fs.writeFileSync(apiPath, apiContent);
console.log('API actualizada');
