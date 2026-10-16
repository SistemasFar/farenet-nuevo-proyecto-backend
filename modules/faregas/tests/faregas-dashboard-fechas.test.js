const test = require('node:test');
const assert = require('node:assert/strict');

const {
    obtenerDiasEnMes,
    calcularFechaMaximaPermitida,
    validarRangoFechasDashboard,
    obtenerFechaHoyLima,
    middlewareValidarRangoFechasDashboard
} = require('../services/faregas-dashboard-fechas.service');

const {
    calcularIntervaloFechas
} = require('../services/faregas-dashboard.service');

test('Dias en mes: maneja meses regulares y febrero bisiesto vs no bisiesto', () => {
    assert.equal(obtenerDiasEnMes(2026, 1), 31);
    assert.equal(obtenerDiasEnMes(2026, 2), 28, 'Febrero 2026 tiene 28 días');
    assert.equal(obtenerDiasEnMes(2028, 2), 29, 'Febrero 2028 es bisiesto y tiene 29 días');
    assert.equal(obtenerDiasEnMes(2026, 4), 30);
    assert.equal(obtenerDiasEnMes(2026, 9), 30);
    assert.equal(obtenerDiasEnMes(2026, 10), 31);
});

test('Ejemplos válidos especificados por el usuario', () => {
    // 01/09/2026 al 30/09/2026
    const res1 = validarRangoFechasDashboard('2026-09-01', '2026-09-30');
    assert.equal(res1.valido, true, '01/09/2026 al 30/09/2026 debe ser válido');
    assert.equal(res1.fechaMaximaPermitida, '2026-09-30');

    // 01/10/2026 al 31/10/2026
    const res2 = validarRangoFechasDashboard('2026-10-01', '2026-10-31');
    assert.equal(res2.valido, true, '01/10/2026 al 31/10/2026 debe ser válido');
    assert.equal(res2.fechaMaximaPermitida, '2026-10-31');

    // 17/09/2026 al 16/10/2026
    const res3 = validarRangoFechasDashboard('2026-09-17', '2026-10-16');
    assert.equal(res3.valido, true, '17/09/2026 al 16/10/2026 debe ser válido');
    assert.equal(res3.fechaMaximaPermitida, '2026-10-16');

    // 01/02/2026 al 28/02/2026 (no bisiesto)
    const res4 = validarRangoFechasDashboard('2026-02-01', '2026-02-28');
    assert.equal(res4.valido, true, '01/02/2026 al 28/02/2026 debe ser válido');
    assert.equal(res4.fechaMaximaPermitida, '2026-02-28');

    // 01/02/2028 al 29/02/2028 (bisiesto)
    const res5 = validarRangoFechasDashboard('2028-02-01', '2028-02-29');
    assert.equal(res5.valido, true, '01/02/2028 al 29/02/2028 debe ser válido');
    assert.equal(res5.fechaMaximaPermitida, '2028-02-29');
});

test('Ejemplos inválidos especificados por el usuario', () => {
    // 01/09/2026 al 01/10/2026 (supera por 1 día)
    const res1 = validarRangoFechasDashboard('2026-09-01', '2026-10-01');
    assert.equal(res1.valido, false);
    assert.equal(res1.codigo, 'RANGO_FECHAS_EXCEDIDO');

    // 01/09/2026 al 16/10/2026 (mes y medio)
    const res2 = validarRangoFechasDashboard('2026-09-01', '2026-10-16');
    assert.equal(res2.valido, false);
    assert.equal(res2.codigo, 'RANGO_FECHAS_EXCEDIDO');

    // 01/01/2026 al 31/12/2026 (año completo)
    const res3 = validarRangoFechasDashboard('2026-01-01', '2026-12-31');
    assert.equal(res3.valido, false);
    assert.equal(res3.codigo, 'RANGO_FECHAS_EXCEDIDO');
});

test('Casos requeridos por sección 6: hoy, ayer, 7 días, 30 días, etc.', () => {
    // Hoy
    const resHoy = validarRangoFechasDashboard('2026-10-16', '2026-10-16');
    assert.equal(resHoy.valido, true);

    // Ayer
    const resAyer = validarRangoFechasDashboard('2026-10-15', '2026-10-15');
    assert.equal(resAyer.valido, true);

    // Últimos 7 días
    const res7d = validarRangoFechasDashboard('2026-10-10', '2026-10-16');
    assert.equal(res7d.valido, true);

    // Rango que atraviesa fin de año
    const resFinAnio = validarRangoFechasDashboard('2026-12-15', '2027-01-14');
    assert.equal(resFinAnio.valido, true);
    assert.equal(resFinAnio.fechaMaximaPermitida, '2027-01-14');

    const resFinAnioExcedido = validarRangoFechasDashboard('2026-12-15', '2027-01-15');
    assert.equal(resFinAnioExcedido.valido, false);
    assert.equal(resFinAnioExcedido.codigo, 'RANGO_FECHAS_EXCEDIDO');
});

test('Validación de errores: fecha final anterior a fecha inicial', () => {
    const res = validarRangoFechasDashboard('2026-10-16', '2026-09-17');
    assert.equal(res.valido, false);
    assert.equal(res.codigo, 'RANGO_FECHAS_INVALIDO');
    assert.match(res.mensaje, /no puede ser anterior/i);
});

test('Validación de formatos y fechas inexistentes', () => {
    assert.equal(validarRangoFechasDashboard('2026-13-01', '2026-13-05').valido, false);
    assert.equal(validarRangoFechasDashboard('2026-02-30', '2026-03-01').valido, false);
    assert.equal(validarRangoFechasDashboard('invalido', '2026-10-16').valido, false);
});

test('Middleware de Express intercepta solicitud y responde HTTP 400 sin ejecutar lógica de negocio', () => {
    let statusEnviado = null;
    let jsonEnviado = null;
    let nextLlamado = false;

    const reqMock = {
        query: {
            desde: '2026-01-01',
            hasta: '2026-12-31'
        }
    };

    const resMock = {
        status: (s) => {
            statusEnviado = s;
            return {
                json: (j) => {
                    jsonEnviado = j;
                }
            };
        }
    };

    middlewareValidarRangoFechasDashboard(reqMock, resMock, () => {
        nextLlamado = true;
    });

    assert.equal(nextLlamado, false, 'Next no debe ser llamado cuando el rango es inválido');
    assert.equal(statusEnviado, 400, 'Debe responder con HTTP 400');
    assert.equal(jsonEnviado.success, false);
    assert.equal(jsonEnviado.codigo, 'RANGO_FECHAS_EXCEDIDO');
    assert.equal(jsonEnviado.message, 'El período máximo permitido es de un mes. Selecciona un rango de fechas más corto.');
});

test('Middleware de Express permite solicitudes con rango válido', () => {
    let nextLlamado = false;

    const reqMock = {
        query: {
            desde: '2026-09-17',
            hasta: '2026-10-16'
        }
    };

    const resMock = {
        status: () => ({ json: () => {} })
    };

    middlewareValidarRangoFechasDashboard(reqMock, resMock, () => {
        nextLlamado = true;
    });

    assert.equal(nextLlamado, true, 'Next debe ser llamado cuando el rango es válido');
});

test('Cálculo de intervalo en dashboardService lanza error controlado cuando rango es inválido', () => {
    assert.throws(
        () => calcularIntervaloFechas('2026-09-01', '2026-10-02'),
        (err) => {
            assert.equal(err.status, 400);
            assert.equal(err.codigo, 'RANGO_FECHAS_EXCEDIDO');
            return true;
        }
    );
});
