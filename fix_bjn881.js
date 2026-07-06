const db = require('./config/database');
async function run() {
  const obj = {
    formVehiculo: {
      nroMotor: 'DLCG14430528',
      categoria: 'N1',
      placaNueva: 'BJN881',
      marca_label: 'TOYOTA',
      modelo_label: 'HILUX',
      color_label: 'BLANCO',
      anioFabricacion: '2022',
      kilometraje: '737330',
      nroAsientos: '2',
      pesoBruto: '1860',
      cargaUtil: '646',
      nroCilindros: '4'
    }
  };
  try {
    await db.query(`UPDATE inspeccion SET ui_metadata = $1 WHERE nrodocumentoinspeccion = 'INS-201-000157611'`, [obj]);
    console.log('Done updating ui_metadata');
  } catch (e) {
    console.error(e);
  }
  process.exit(0);
}
run();
