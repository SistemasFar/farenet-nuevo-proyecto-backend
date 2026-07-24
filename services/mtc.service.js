const soap = require('soap');
const pool = require('../config/database'); 

const WSDL_URL = 'https://wscitv.mtc.gob.pe/WSInterOperabilidadCITV.svc?wsdl';

const obtenerVehiculo = async (placa, plantaKey, autorizacionMtc, tipoInspeccionMtc, tipoCertificadoMtc, categoriaMtc) => {
  try {
    // 1. Obtener credenciales de la planta
    const plantaRes = await pool.query(`SELECT codigoentidadcertificadoramtc, codigolocalmtc, iv FROM planta WHERE key = $1`, [plantaKey]);
    if (plantaRes.rows.length === 0) {
      console.warn("MTC: No se encontró la planta para sacar credenciales.");
      return null; // Silent fail para no bloquear
    }
    const planta = plantaRes.rows[0];

    // --- BLOQUE MOCK PARA PRUEBAS (NUEVA1) ---
    if (placa.toUpperCase() === 'NUEVA1') {
      return {
        nromotor: 'MTC-Z3D150',
        nroserie: 'VIN-Z3D150-888',
        aniofabricacion: '2015',
        nrocilindros: '4',
        nroasientos: '5',
        nropasajeros: '4',
        nroejes: '2',
        nroruedas: '4',
        nropuertas: '4',
        pesoseco: '1200',
        pesobruto: '1600',
        cargautil: '400',
        longitud: '4.5',
        ancho: '1.8',
        alto: '1.5'
      };
    }
    // --- FIN BLOQUE MOCK ---
    
    // 2. Conectar al Web Service
    const client = await soap.createClientAsync(WSDL_URL);

    // 3. Preparar los datos
    const args = {
      entVehiculoInspeccion: {
        CodEntidadCert: planta.codigoentidadcertificadoramtc,
        CodLocal: planta.codigolocalmtc,
        NroPlaca: placa.toUpperCase(),
        Token: planta.iv || '', // En producción esto deberia venir de autentificaInicioOperacion
        catVeh: 0, // El MTC espera entero. Como aún no tenemos el diccionario de mapeo, enviamos 0
        codAmbito: 0,
        codModRevision: 0,
        codTipoCert: 0,
        FecHoraInspeccion: new Date().toISOString(),
        IdInspeccion: "TEST-" + Math.floor(Math.random() * 1000)
      }
    };

    // 4. Invocar a valVehiculoPoliza
    const [result] = await client.valVehiculoPolizaAsync(args);

    if (result && result.valVehiculoPolizaResult) {
      const vehiculo = result.valVehiculoPolizaResult;
      
      // Si el MTC nos devuelve mensaje de error (ej MSJ45, Vehiculo no encontrado)
      if (vehiculo.Mensaje && vehiculo.Mensaje !== "" && vehiculo.Mensaje.includes("MSJ")) {
        console.warn("MTC advierte: ", vehiculo.Mensaje);
        return null; // Lo ignoramos tal cual el sistema antiguo
      }

      // 5. Mapear la respuesta del MTC a nuestro formato de Frontend
      // (El MTC devuelve NroMotor, Marca, Modelo, etc. como propiedades del objeto)
      return {
        nromotor: vehiculo.NroMotor || '',
        nroserie: vehiculo.NroChasis || '',
        aniofabricacion: vehiculo.AnoFabricacion || '',
        nrocilindros: vehiculo.NroCilindros || '',
        nroasientos: vehiculo.NroAsientos || '',
        nropasajeros: vehiculo.NroPasajeros || '',
        nroejes: vehiculo.NroEjes || '',
        nroruedas: vehiculo.NroRuedas || '',
        nropuertas: vehiculo.NroPuertas || '',
        pesoseco: vehiculo.PesoNeto || '',
        pesobruto: vehiculo.PesoBruto || '',
        cargautil: vehiculo.CargaUtil || '',
        longitud: vehiculo.Largo || '',
        ancho: vehiculo.Ancho || '',
        alto: vehiculo.Alto || '',
        // Campos que requerirían mapeo de keys maestras si vienen como texto:
        // marca_key: vehiculo.Marca, 
        // modelo_key: vehiculo.Modelo,
      };
    }

    return null;

  } catch (error) {
    console.error("Error al consultar MTC real: ", error.message);
    // Silent fail para que el cajero pueda seguir escribiendo a mano
    return null; 
  }
};

const anularCertificadoMTC = async (placa, nroCertificado, motivoKey, fechaCreacion, plantaKey) => {
  try {
    const plantaRes = await pool.query(`SELECT codigoentidadcertificadoramtc, codigolocalmtc, iv FROM planta WHERE key = $1`, [plantaKey]);
    if (plantaRes.rows.length === 0) return null;
    const planta = plantaRes.rows[0];

    // MOCK para pruebas locales
    if (placa.toUpperCase() === 'NUEVA1' || placa.toUpperCase() === 'ABC123') {
      return { nroCertificadoNuevo: "CERT-" + Math.floor(Math.random() * 10000) };
    }

    const client = await soap.createClientAsync(WSDL_URL);
    
    // Mapear motivo local a motivo MTC (1=Perdida, 2=Robo, 3=Deterioro)
    let motivoMTC = 3; 
    if (motivoKey === 'PERDIDA') motivoMTC = 1;
    if (motivoKey === 'ROBO') motivoMTC = 2;

    const args = {
      anulacionCitv: {
        CodEntidadCert: planta.codigoentidadcertificadoramtc,
        CodLocal: planta.codigolocalmtc,
        NroPlaca: placa.toUpperCase(),
        NroCertificado: nroCertificado,
        Token: planta.iv || '', 
        MotivoAnulacion: motivoMTC,
        FecEmiCertificado: fechaCreacion ? new Date(fechaCreacion).toISOString() : new Date().toISOString(),
        UsuarioAnulacion: 'SISTEMAS'
      }
    };

    const [result] = await client.AnulaCITVAsync(args);

    if (result && result.AnulaCITVResult) {
      if (result.AnulaCITVResult.Mensaje && result.AnulaCITVResult.Mensaje.includes("MSJ")) {
        throw new Error(result.AnulaCITVResult.Mensaje);
      }
      return {
        nroCertificadoNuevo: result.AnulaCITVResult.NroCertificadoNuevo || "PENDIENTE"
      };
    }
    return null;
  } catch (error) {
    console.error("Error al anular en MTC: ", error.message);
    throw new Error("Error de acuerdo al MTC. Hubo un problema al anular el certificado.");
  }
};

module.exports = {
  obtenerVehiculo,
  anularCertificadoMTC
};
