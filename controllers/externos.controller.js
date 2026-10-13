const clientesService = require('../modules/faregas/services/faregas-clientes.service');

const statusHttpParaResultado = (resultado) => {
  if (resultado.origen === 'NO_ENCONTRADO') return 404;
  if (resultado.origen === 'EXTERNO_TIMEOUT') return 504;
  if (resultado.origen === 'EXTERNO_NO_CONFIGURADO') return 503;
  if (resultado.origen === 'EXTERNO_NO_AUTORIZADO') return 502;
  return 502;
};

const consultar = async (tipoDocumento, numero, res) => {
  const resultado = await clientesService.consultarDocumento(
    tipoDocumento,
    numero,
    { omitirBusquedaLocal: true }
  );

  if (!resultado.encontrado || !resultado.cliente) {
    return res.status(statusHttpParaResultado(resultado)).json({
      status: 'error',
      code: resultado.origen,
      message: resultado.mensaje,
      proveedor: resultado.proveedor || null
    });
  }

  const cliente = resultado.cliente;
  if (tipoDocumento === 'DNI') {
    return res.status(200).json({
      status: 'success',
      data: {
        nombres: cliente.nombres || cliente.nombreRazonSocial,
        apellidos: cliente.apellidos || '',
        numero: resultado.numeroDocumento
      }
    });
  }

  return res.status(200).json({
    status: 'success',
    data: {
      razonSocial: cliente.nombreRazonSocial,
      direccion: cliente.direccion,
      departamento: cliente.departamento || null,
      provincia: cliente.provincia || null,
      distrito: cliente.distrito || null,
      numero: resultado.numeroDocumento
    }
  });
};

const consultarDni = async (req, res) => {
  const numero = String(req.params.numero || '').trim();
  if (!/^\d{8}$/.test(numero)) {
    return res.status(400).json({ status: 'error', message: 'DNI inválido' });
  }

  try {
    return await consultar('DNI', numero, res);
  } catch (error) {
    console.error('Error controlado al consultar DNI:', error.message);
    return res.status(500).json({ status: 'error', message: 'Error al consultar DNI' });
  }
};

const consultarRuc = async (req, res) => {
  const numero = String(req.params.numero || '').trim();
  if (!/^\d{11}$/.test(numero)) {
    return res.status(400).json({ status: 'error', message: 'RUC inválido' });
  }

  try {
    return await consultar('RUC', numero, res);
  } catch (error) {
    console.error('Error controlado al consultar RUC:', error.message);
    return res.status(500).json({ status: 'error', message: 'Error al consultar RUC' });
  }
};

module.exports = {
  consultarDni,
  consultarRuc
};
