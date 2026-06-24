const axios = require('axios');

const consultarDni = async (req, res) => {
  try {
    const { numero } = req.params;
    if (!numero || numero.length !== 8) {
      return res.status(400).json({ status: 'error', message: 'DNI inválido' });
    }

    const token = process.env.API_DNI_TOKEN;
    if (!token) {
      // Mock mode if no token
      console.log('⚠️ API_DNI_TOKEN no configurado. Retornando datos simulados para DNI:', numero);
      return res.status(200).json({
        status: 'success',
        data: {
          nombres: 'JUAN PEREZ',
          apellidos: 'DE LA CRUZ',
          numero: numero
        }
      });
    }

    // Call real API (e.g. apis.net.pe)
    const response = await axios.get(`https://api.apis.net.pe/v2/reniec/dni?numero=${numero}`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    return res.status(200).json({
      status: 'success',
      data: {
        nombres: response.data.nombres,
        apellidos: `${response.data.apellidoPaterno} ${response.data.apellidoMaterno}`,
        numero: response.data.numeroDocumento
      }
    });
  } catch (error) {
    console.error('Error al consultar DNI:', error.message);
    return res.status(500).json({ status: 'error', message: 'Error al consultar DNI' });
  }
};

const consultarRuc = async (req, res) => {
  try {
    const { numero } = req.params;
    if (!numero || numero.length !== 11) {
      return res.status(400).json({ status: 'error', message: 'RUC inválido' });
    }

    const token = process.env.API_DNI_TOKEN; // usually same token for RUC
    if (!token) {
      // Mock mode
      console.log('⚠️ API_DNI_TOKEN no configurado. Retornando datos simulados para RUC:', numero);
      return res.status(200).json({
        status: 'success',
        data: {
          razonSocial: 'EMPRESA DE PRUEBA S.A.C.',
          direccion: 'AV. LOS INCAS 123',
          departamento: 'LIMA',
          provincia: 'LIMA',
          distrito: 'LIMA',
          numero: numero
        }
      });
    }

    const response = await axios.get(`https://api.apis.net.pe/v2/sunat/ruc?numero=${numero}`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    return res.status(200).json({
      status: 'success',
      data: {
        razonSocial: response.data.razonSocial,
        direccion: response.data.direccion,
        departamento: response.data.departamento,
        provincia: response.data.provincia,
        distrito: response.data.distrito,
        numero: response.data.numeroDocumento
      }
    });
  } catch (error) {
    console.error('Error al consultar RUC:', error.message);
    return res.status(500).json({ status: 'error', message: 'Error al consultar RUC' });
  }
};

module.exports = {
  consultarDni,
  consultarRuc
};
