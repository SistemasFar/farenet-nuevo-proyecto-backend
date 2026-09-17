const fs = require('fs');
const path = require('path');
const apiPath = path.join('C:\\Users\\Sistemas2\\Desktop\\farenet nuevo proyecto\\farenetFrontend\\src\\modules\\faregas\\services\\faregas-chips.api.ts');
let apiCode = fs.readFileSync(apiPath, 'utf8');

const newTypes = `
export interface ChipVenta {
    id: number;
    creado_en: string;
    cliente_nombre: string;
    cliente_nro_documento: string;
    importe_total: number;
    venta_estado: string;
    facturacion_id?: number;
    nro_comprobante?: string;
    facturacion_estado?: string;
    enlace_pdf?: string;
    enlace_xml?: string;
    chips: { numero_chip: string; producto: string }[];
}
`;

apiCode = apiCode.replace(
    'export interface ChipMovimiento {',
    newTypes + '\nexport interface ChipMovimiento {'
);

apiCode = apiCode.replace(
    'historial: (id: number) => request(`/api/faregas/chips/${id}/historial`),',
    'historial: (id: number) => request(`/api/faregas/chips/${id}/historial`),\n  listarVentas: (): Promise<{ success: boolean; ventas: ChipVenta[] }> => request(`/api/faregas/chips/ventas`),'
);

fs.writeFileSync(apiPath, apiCode);
console.log('API updated.');
