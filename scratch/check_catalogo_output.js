const tarifasService = require('../modules/faregas/services/faregas-tarifas.service');

async function test() {
  try {
    const catalogo = await tarifasService.obtenerCatalogoPorPlanta('98');
    for (const cat of catalogo.categorias) {
      console.log(`\n=== CATEGORIA: ${cat.nombre} (${cat.codigo}) ===`);
      for (const s of cat.servicios) {
        console.log({
          id: s.id,
          nombre: s.nombre,
          codigo: s.codigo,
          tipo_certificado_clave: s.tipo_certificado_clave,
          modalidad: s.modalidad,
          tarifa_codigo: s.tarifa.codigo,
          precio: s.tarifa.precio,
          productoFacturacionId: s.tarifa.productoFacturacionId
        });
      }
    }
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

test();
