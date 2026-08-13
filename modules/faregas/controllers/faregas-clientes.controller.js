const clientesService = require('../services/faregas-clientes.service');

exports.obtenerClientePorDocumento = async (req, res) => {
    try {
        const { tipoDocumento, nroDocumento } = req.params;
        const cliente = await clientesService.buscarClientePropio(tipoDocumento, nroDocumento);
        
        if (!cliente) {
            return res.status(404).json({ ok: false, message: 'Cliente FAREGAS no encontrado.' });
        }
        
        res.status(200).json({ ok: true, data: cliente });
    } catch (e) {
        console.error('Error en obtenerClientePorDocumento:', e);
        res.status(500).json({ ok: false, message: 'Error interno del servidor.' });
    }
};

exports.autocompletarPersona = async (req, res) => {
    try {
        const { tipoDocumento, nroDocumento } = req.params;
        
        // 1. Buscar en FAREGAS
        const cliente = await clientesService.buscarClientePropio(tipoDocumento, nroDocumento);
        if (cliente) {
            return res.status(200).json({
                ok: true,
                data: {
                    origen: 'FAREGAS',
                    clienteExistente: true,
                    ...cliente
                }
            });
        }
        
        // 2. Buscar en FARENET
        const persona = await clientesService.buscarPersonaFarenet(tipoDocumento, nroDocumento);
        if (persona) {
            return res.status(200).json({
                ok: true,
                data: {
                    origen: 'FARENET',
                    clienteExistente: false,
                    ...persona
                }
            });
        }
        
        res.status(404).json({ ok: false, message: 'Persona no encontrada.' });
    } catch (e) {
        console.error('Error en autocompletarPersona:', e);
        res.status(500).json({ ok: false, message: 'Error interno del servidor.' });
    }
};

exports.crearCliente = async (req, res) => {
    try {
        const { tipoDocumento, nroDocumento, nombreRazonSocial, direccion, telefono, correo } = req.body;
        
        if (!tipoDocumento || !nroDocumento || !nombreRazonSocial) {
            return res.status(400).json({ ok: false, message: 'Faltan datos obligatorios.' });
        }
        
        const data = {
            tipoDocumento: String(tipoDocumento).trim(),
            nroDocumento: String(nroDocumento).trim(),
            nombreRazonSocial: String(nombreRazonSocial).trim(),
            direccion: direccion ? String(direccion).trim() : null,
            telefono: telefono ? String(telefono).trim() : null,
            correo: correo ? String(correo).trim() : null
        };
        
        if (data.nroDocumento === '' || data.nombreRazonSocial === '') {
            return res.status(400).json({ ok: false, message: 'Documento o nombre no pueden estar vacíos.' });
        }
        
        const id = await clientesService.crearCliente(data);
        res.status(201).json({ ok: true, data: { id } });
    } catch (e) {
        if (e.message === 'CLIENTE_DUPLICADO') {
            return res.status(409).json({ ok: false, message: 'Ya existe un cliente FAREGAS con este tipo y número de documento.' });
        }
        console.error('Error en crearCliente:', e);
        res.status(500).json({ ok: false, message: 'Error interno del servidor.' });
    }
};

exports.actualizarCliente = async (req, res) => {
    try {
        const { id } = req.params;
        const body = req.body;
        
        const data = {};
        if (body.nombreRazonSocial !== undefined) data.nombreRazonSocial = String(body.nombreRazonSocial).trim();
        if (body.direccion !== undefined) data.direccion = body.direccion ? String(body.direccion).trim() : null;
        if (body.telefono !== undefined) data.telefono = body.telefono ? String(body.telefono).trim() : null;
        if (body.correo !== undefined) data.correo = body.correo ? String(body.correo).trim() : null;
        if (body.estado !== undefined) data.estado = Boolean(body.estado);
        
        await clientesService.actualizarCliente(id, data);
        res.status(200).json({ ok: true, message: 'Cliente actualizado correctamente.' });
    } catch (e) {
        if (e.message === 'CLIENTE_NOT_FOUND') {
            return res.status(404).json({ ok: false, message: 'Cliente FAREGAS no encontrado.' });
        }
        console.error('Error en actualizarCliente:', e);
        res.status(500).json({ ok: false, message: 'Error interno del servidor.' });
    }
};

exports.consultarVehiculoPorPlaca = async (req, res) => {
    try {
        const { placa } = req.params;
        if (!placa) {
            return res.status(400).json({ ok: false, message: 'Placa obligatoria.' });
        }
        
        const vehiculo = await clientesService.buscarVehiculoPorPlaca(String(placa).trim());
        if (!vehiculo) {
            return res.status(404).json({ ok: false, message: 'Vehículo no encontrado.' });
        }
        
        res.status(200).json({ ok: true, data: vehiculo });
    } catch (e) {
        console.error('Error en consultarVehiculoPorPlaca:', e);
        res.status(500).json({ ok: false, message: 'Error interno del servidor.' });
    }
};
