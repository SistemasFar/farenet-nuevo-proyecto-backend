const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { validarCorrelativoDisponible } = require('../services/faregas-nubefact-correlativo-guard.service');
const facturacionService = require('../services/faregas-facturacion.service');

const documento = {
    tipoComprobante: 'FACTURA',
    serie: 'FFF1',
    numero: 44,
    credentials: { apiUrl: 'https://demo.invalid', token: 'test-token' }
};

describe('Guardia de correlativos NubeFact', () => {
    it('permite emitir solo cuando la consulta confirma que el comprobante no existe', async () => {
        let solicitud;
        const provider = {
            consultarComprobante: async (payload, options) => {
                solicitud = { payload, options };
                return { status: 'REJECTED', data: { errors: 'El comprobante no existe' } };
            }
        };

        const result = await validarCorrelativoDisponible(provider, documento);

        assert.equal(result.disponible, true);
        assert.deepEqual(solicitud.payload, { tipoDeComprobante: 1, serie: 'FFF1', numero: 44 });
        assert.equal(solicitud.options.credentials, documento.credentials);
    });

    it('bloquea un documento que ya existe aunque esté rechazado', async () => {
        const provider = {
            consultarComprobante: async () => ({
                status: 'REJECTED',
                data: { errors: 'Este documento ya existe en NubeFact' }
            })
        };

        await assert.rejects(
            validarCorrelativoDisponible(provider, documento),
            error => error.code === 'NUBEFACT_CORRELATIVO_OCUPADO' && error.statusCode === 409
        );
    });

    it('bloquea los documentos aceptados o pendientes', async () => {
        for (const status of ['ACCEPTED', 'PENDING_SUNAT']) {
            const provider = { consultarComprobante: async () => ({ status, data: {} }) };
            await assert.rejects(
                validarCorrelativoDisponible(provider, documento),
                error => error.code === 'NUBEFACT_CORRELATIVO_OCUPADO'
            );
        }
    });

    it('considera ocupado un documento existente rechazado aunque la consulta no diga “duplicado”', async () => {
        const provider = {
            consultarComprobante: async () => ({
                status: 'REJECTED',
                data: { serie: 'FFF1', numero: 44, sunat_responsecode: '1083' }
            })
        };
        await assert.rejects(
            validarCorrelativoDisponible(provider, documento),
            error => error.code === 'NUBEFACT_CORRELATIVO_OCUPADO'
        );
    });

    it('falla cerrado si no puede determinar disponibilidad', async () => {
        const casos = [
            null,
            { status: 'ERROR', reason: 'NETWORK_ERROR' },
            { status: 'REJECTED', data: { errors: 'Credenciales inválidas' } }
        ];
        for (const respuesta of casos) {
            const provider = { consultarComprobante: async () => respuesta };
            await assert.rejects(
                validarCorrelativoDisponible(provider, documento),
                error => error.code === 'NUBEFACT_VALIDACION_CORRELATIVO_NO_DISPONIBLE'
                    && error.statusCode === 503
            );
        }
        await assert.rejects(
            validarCorrelativoDisponible({}, documento),
            error => error.code === 'NUBEFACT_VALIDACION_CORRELATIVO_NO_DISPONIBLE'
        );
    });

    it('recupera por consulta un documento registrado cuando el POST tuvo respuesta incierta', async () => {
        let consultas = 0;
        const consultado = { status: 'ACCEPTED', data: { codigo_hash: 'HASH_DE_PRUEBA' } };
        const provider = {
            consultarComprobante: async (payload, options) => {
                consultas += 1;
                assert.deepEqual(payload, { tipoDeComprobante: 1, serie: 'FFF1', numero: 44 });
                assert.equal(options.credentials, documento.credentials);
                return consultado;
            }
        };

        const recuperacion = await facturacionService._private.consultarEmisionIncierta(
            provider,
            { facturacion: { tipo_comprobante: 'FACTURA', serie: 'FFF1', numero: 44 }, credentials: documento.credentials },
            { status: 'ERROR', reason: 'TIMEOUT' }
        );

        assert.equal(consultas, 1);
        assert.equal(recuperacion.resultado, consultado);
        assert.equal(recuperacion.consulta, consultado);
    });

    it('recupera también el rechazo fiscal consultado, pero conserva el timeout si el documento no existe', async () => {
        const reserva = {
            facturacion: { tipo_comprobante: 'FACTURA', serie: 'FFF1', numero: 44 },
            credentials: documento.credentials
        };
        const rechazadoEncontrado = {
            status: 'REJECTED',
            data: { serie: 'FFF1', numero: 44, sunat_responsecode: '1083', enlace_del_pdf: 'demo.pdf' }
        };
        const providerEncontrado = { consultarComprobante: async () => rechazadoEncontrado };
        const resultadoRechazado = await facturacionService._private.consultarEmisionIncierta(
            providerEncontrado, reserva, { status: 'ERROR', reason: 'TIMEOUT' }
        );
        assert.equal(resultadoRechazado.resultado, rechazadoEncontrado);

        const timeoutOriginal = { status: 'ERROR', reason: 'TIMEOUT' };
        const providerSinDocumento = {
            consultarComprobante: async () => ({ status: 'REJECTED', data: { errors: 'El comprobante no existe' } })
        };
        const resultadoAusente = await facturacionService._private.consultarEmisionIncierta(
            providerSinDocumento, reserva, timeoutOriginal
        );
        assert.equal(resultadoAusente.resultado, timeoutOriginal);
    });
});
