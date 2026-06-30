const soap = require('soap');
const pool = require('./config/database');

const WSDL_URL = 'https://wscitv.mtc.gob.pe/WSInterOperabilidadCITV.svc?wsdl';

async function testAuth() {
  try {
    const client = await soap.createClientAsync(WSDL_URL);
    const args = {
      entLocalLogin: {
        CodEntidad: 'EC000146',
        CodLocal: 'L000231',
        CodIV: '9$NQ6I4I842VAGU5GM6%'
      }
    };
    
    console.log("Enviando...", args);
    const [result] = await client.AutentificaInicioOperacionAsync(args);
    console.log("Resultado Auth:", result);
    
    if (result && result.AutentificaInicioOperacionResult && result.AutentificaInicioOperacionResult.RetVal) {
      const token = result.AutentificaInicioOperacionResult.RetVal;
      console.log("TOKEN OBTENIDO:", token);
      
      const argsConsulta = {
        entVehiculoInspeccion: {
          CodEntidadCert: 'EC000146',
          CodLocal: 'L000231',
          NroPlaca: 'Z3D150',
          Token: token,
          catVeh: 0,
          codAmbito: 0,
          codModRevision: 0,
          codTipoCert: 0,
          FecHoraInspeccion: new Date().toISOString(),
          IdInspeccion: "TEST-" + Math.floor(Math.random()*1000)
        }
      };
      
      console.log("Consultando vehiculo...", argsConsulta);
      const [resVeh] = await client.valVehiculoPolizaAsync(argsConsulta);
      console.log("Resultado Vehiculo:", resVeh);
    }
  } catch(e) {
    console.error("Fallo:", e);
  }
}
testAuth().then(() => process.exit());
