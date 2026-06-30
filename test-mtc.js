const mtcService = require('./services/mtc.service');

async function run() {
  console.log("Probando MTC con placa Z3D150...");
  try {
    const res = await mtcService.obtenerVehiculo(
      'Z3D150', // placa
      '201', // plantaKey (Independencia)
      '2', // autorizacion
      '1', // tipo inspeccion
      '1', // tipo certificado
      '1' // categoria
    );
    console.log("Respuesta MTC:", res);
  } catch (e) {
    console.error("Fallo general:", e);
  }
}

run().then(() => process.exit());
