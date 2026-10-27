const { test } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../../config/database');
const farenetReadAdapter = require('../integrations/farenet-read.adapter');
const vehiculosService = require('../services/faregas-vehiculos.service');
const clientesService = require('../services/faregas-clientes.service');

test('la búsqueda compatible excluye sólo el borrador y prioriza la modalidad solicitada', async () => {
    const queryOriginal = db.query;
    try {
        db.query = async (sql, params) => {
            assert.match(sql, /tipo_certificado_clave LIKE 'GLP%'/);
            assert.match(sql, /UPPER\(COALESCE\(glp\.modalidad, gnv\.modalidad/);
            assert.match(sql, /c\.id <> \$3::BIGINT/);
            assert.deepEqual(params, ['ABC123', 'GLP_ANUAL', 683, 'INICIAL']);
            return { rows: [{ id: 680 }] };
        };

        const id = await vehiculosService.buscarCertificadoCompatiblePorPlaca(
            'abc123',
            'GLP_ANUAL',
            683,
            'INICIAL'
        );
        assert.equal(id, 680);
    } finally {
        db.query = queryOriginal;
    }
});

test('un tipo de la misma familia GLP no descarta un antecedente válido', async () => {
    const queryOriginal = db.query;
    try {
        db.query = async (_sql, params) => {
            assert.equal(params[1], 'GLP_INICIAL');
            return { rows: [{ id: 680 }] };
        };
        const id = await vehiculosService.buscarCertificadoCompatiblePorPlaca(
            'ABC123',
            'GLP_INICIAL',
            null,
            'INICIAL'
        );
        assert.equal(id, 680);
    } finally {
        db.query = queryOriginal;
    }
});

test('resolverVehiculoPorPlaca usa el snapshot compatible antes que el maestro post-conversión', async () => {
    const queryOriginal = db.query;
    const buscarFarenetOriginal = farenetReadAdapter.buscarVehiculoPorPlaca;
    try {
        db.query = async (sql) => {
            if (/FROM fg_vehiculo\s+WHERE placa_normalizada/.test(sql)) {
                return { rows: [{ placa: 'ABC123', marca: 'TOYOTA', combustible: 'BI-COMBUSTIBLE GLP' }] };
            }
            if (/WITH candidatos AS/.test(sql)) {
                return { rows: [{ certificado_id: 682, placa: 'ABC123', marca: 'TOYOTA', combustible: 'BI-COMBUSTIBLE GLP' }] };
            }
            if (/SELECT\s+c\.id/.test(sql)) return { rows: [{ id: 680 }] };
            if (/FROM fg_certificado_vehiculo\s+WHERE certificado_id/.test(sql)) {
                return { rows: [{ certificado_id: 680, placa: 'ABC123', marca: 'TOYOTA', modelo: 'TITI', combustible: 'GASOLINA' }] };
            }
            throw new Error(`SQL no esperado: ${sql}`);
        };
        farenetReadAdapter.buscarVehiculoPorPlaca = async () => null;

        const resultado = await vehiculosService.resolverVehiculoPorPlaca('ABC123', {
            excludeCertificadoId: 683,
            tipoCertificado: 'GLP_ANUAL',
            modalidad: 'INICIAL'
        });
        assert.equal(resultado.vehiculo.modelo, 'TITI');
        assert.equal(resultado.vehiculo.combustible, 'GASOLINA');
        assert.equal(resultado.snapshotLegacyId, 680);
        assert.equal(resultado.certificadoCompatibleId, 680);
    } finally {
        db.query = queryOriginal;
        farenetReadAdapter.buscarVehiculoPorPlaca = buscarFarenetOriginal;
    }
});

test('titulares y componentes se recuperan del mismo certificado fuente', async () => {
    const resolverOriginal = vehiculosService.resolverVehiculoPorPlaca;
    const queryOriginal = db.query;
    const idsConsultados = [];
    try {
        vehiculosService.resolverVehiculoPorPlaca = async () => ({
            vehiculo: { placa: 'ABC123', marca: 'TOYOTA' },
            origen: 'FAREGAS',
            completadoDesdeFarenet: false,
            certificadoCompatibleId: 680,
            snapshotLegacyId: 682,
        });
        db.query = async (sql, params) => {
            idsConsultados.push(Number(params[0]));
            if (/fg_certificado_titular/.test(sql)) return { rowCount: 1, rows: [{ certificado_id: 680, orden: 1 }] };
            if (/fg_certificado_glp_componente/.test(sql)) return { rows: [{ certificado_id: 680, orden: 1 }] };
            if (/fg_certificado_glp_verificacion/.test(sql)) return { rows: [] };
            if (/fg_certificado_glp /.test(sql)) return { rowCount: 1, rows: [{ certificado_id: 680 }] };
            if (/fg_certificado_gnv /.test(sql) || /fg_certificado_conformidad/.test(sql)) return { rowCount: 0, rows: [] };
            if (/fg_certificado_gnv_componente/.test(sql) || /fg_certificado_gnv_verificacion/.test(sql)) return { rows: [] };
            throw new Error(`SQL no esperado: ${sql}`);
        };

        const resultado = await clientesService.buscarVehiculoPorPlaca('ABC123', {
            tipoCertificado: 'GLP_ANUAL',
            modalidad: 'INICIAL',
            excludeCertificadoId: 683,
        });
        assert.ok(idsConsultados.length > 0);
        assert.deepEqual([...new Set(idsConsultados)], [680]);
        assert.equal(resultado.titularesFaregas.length, 1);
        assert.equal(resultado.glpFaregas.componentes.length, 1);
    } finally {
        vehiculosService.resolverVehiculoPorPlaca = resolverOriginal;
        db.query = queryOriginal;
    }
});
