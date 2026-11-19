'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
    claveServicioCanonica,
    esDescuentoEspecialCortesia,
    esDescuentoLegadoFarenet,
    resolverReglaPorConcepto,
    evaluarReglaPrecio,
    tieneMaximoDosDecimales,
    normalizarValorRegla
} = require('../services/faregas-descuentos-reglas');

describe('Reglas comerciales de descuentos FAREGAS', () => {
    it('agrupa SKUs/tarifas distintos si comparten el concepto canónico', () => {
        const base = {
            tipo_certificado_clave: 'GLP',
            modalidad: 'INICIAL',
            tipo_flujo: 'CERTIFICACION',
            familia: 'VEHICULAR',
            formato_codigo_canonico: 'GLP-INI'
        };
        assert.equal(
            claveServicioCanonica({ ...base, id: 12, codigo: 'LIM-01', tarifa_codigo: 'GLP-I-LIMA', producto_sku: 'SKU-A' }),
            claveServicioCanonica({ ...base, id: 98, codigo: 'SUR-44', tarifa_codigo: 'GLP-I-SUR', producto_sku: 'SKU-B' })
        );
    });

    it('mantiene separados los conceptos cuando cambia el combustible, modalidad, flujo, familia o formato', () => {
        const base = {
            tipo_certificado_clave: 'GLP', modalidad: 'INICIAL', tipo_flujo: 'CERTIFICACION',
            familia: 'VEHICULAR', formato_codigo_canonico: 'GLP-INI'
        };
        for (const cambio of [
            { tipo_certificado_clave: 'GNV' },
            { modalidad: 'ANUAL' },
            { tipo_flujo: 'TALLER_INSPECCION' },
            { familia: 'CONFORMIDAD' },
            { formato_codigo_canonico: 'GLP-ANUAL' }
        ]) {
            assert.notEqual(claveServicioCanonica(base), claveServicioCanonica({ ...base, ...cambio }));
        }
    });

    it('usa el ID global si faltan campos de identidad y no infiere equivalencia por nombre o SKU', () => {
        assert.equal(claveServicioCanonica({ id: 7, nombre: 'GLP Inicial', codigo: 'A' }), 'SERVICIO_ID::7');
        assert.notEqual(
            claveServicioCanonica({ id: 7, nombre: 'GLP Inicial', codigo: 'A' }),
            claveServicioCanonica({ id: 8, nombre: 'GLP Inicial', codigo: 'A' })
        );
    });

    it('resuelve en backend el SKU distinto de otra sede mediante la identidad canónica', () => {
        const concepto = {
            tipo_certificado_clave: 'GLP_INICIAL', modalidad: 'INICIAL', tipo_flujo: 'CERTIFICACION',
            familia: 'VEHICULAR', formato_codigo_canonico: 'GLP-INICIAL'
        };
        const servicioSurco = { ...concepto, id: 41, servicio_id: 41, codigo: 'SKU-SURCO' };
        const servicioSanMiguel = { ...concepto, id: 92, servicio_id: 92, codigo: 'SKU-SAN-MIGUEL' };
        const regla = { ...concepto, servicio_id: 41, tipo_calculo: 'MONTO', valor: '20.00' };
        assert.equal(resolverReglaPorConcepto([regla], servicioSanMiguel).regla, regla);
        assert.equal(resolverReglaPorConcepto([regla], { ...servicioSanMiguel, formato_codigo_canonico: 'GLP-ANUAL' }).regla, null);
    });

    it('rechaza reglas canónicas ambiguas y clasifica las cortesías fuera de descuentos ordinarios', () => {
        const concepto = {
            id: 8, tipo_certificado_clave: 'GLP_INICIAL', modalidad: 'INICIAL', tipo_flujo: 'CERTIFICACION',
            familia: 'VEHICULAR', formato_codigo_canonico: 'GLP-INICIAL'
        };
        const equivalentes = [
            { ...concepto, servicio_id: 9 },
            { ...concepto, servicio_id: 10 },
        ];
        assert.equal(resolverReglaPorConcepto(equivalentes, { ...concepto, id: 11 }).ambiguo, true);
        assert.equal(esDescuentoEspecialCortesia({ id: 17, nombre: 'DESCUENTO CERTIFICADO TALLER' }), true);
        assert.equal(esDescuentoEspecialCortesia({ codigo: 'D_CONVENIO_a88137bb742f4157' }), true);
        assert.equal(esDescuentoEspecialCortesia({ id: 88, nombre: 'Campaña comercial' }), false);
        assert.equal(esDescuentoLegadoFarenet({ empresa_aliada_nombre: 'FARENET S.A.C.' }), true);
        assert.equal(esDescuentoLegadoFarenet({ empresa_aliada_nombre: 'FAREGAS' }), false);
    });

    it('permite un descuento MONTO menor al precio y rechaza uno igual o superior', () => {
        assert.deepEqual(evaluarReglaPrecio('MONTO', 89.99, 90), {
            valido: true, precioVenta: 90, importeDescuento: 89.99, importeFinal: 0.01
        });
        assert.equal(evaluarReglaPrecio('MONTO', 90, 90).valido, false);
        assert.equal(evaluarReglaPrecio('MONTO', 91, 90).valido, false);
    });

    it('vuelve a rechazar un descuento cuando una tarifa baja después de guardar la regla', () => {
        assert.equal(evaluarReglaPrecio('MONTO', '20.00', 90).valido, true);
        assert.equal(evaluarReglaPrecio('MONTO', '20.00', 20).valido, false);
        assert.equal(evaluarReglaPrecio('MONTO', '20.00', 19.99).valido, false);
    });

    it('conserva montos PEN en centavos y calcula S/ 90 menos S/ 20 como S/ 70', () => {
        const calculo = evaluarReglaPrecio('MONTO', '20', 90);
        assert.equal(calculo.valido, true);
        assert.equal(calculo.importeDescuento, 20);
        assert.equal(calculo.importeFinal, 70);
        assert.equal(normalizarValorRegla('20'), '20');
        assert.equal(normalizarValorRegla('20.5'), '20.5');
        assert.equal(normalizarValorRegla('20.50'), '20.50');
        assert.equal(normalizarValorRegla('20.75'), '20.75');
    });

    it('rechaza más de dos decimales sin redondear antes de persistir', () => {
        assert.equal(tieneMaximoDosDecimales('20.555'), false);
        assert.equal(evaluarReglaPrecio('MONTO', '20.555', 90).valido, false);
        assert.equal(normalizarValorRegla('20.555'), null);
    });

    it('permite porcentaje menor al 100 y rechaza 100 o si el redondeo deja saldo cero', () => {
        assert.deepEqual(evaluarReglaPrecio('PORCENTAJE', 99, 90), {
            valido: true, precioVenta: 90, importeDescuento: 89.1, importeFinal: 0.9
        });
        assert.equal(evaluarReglaPrecio('PORCENTAJE', 100, 90).valido, false);
        assert.equal(evaluarReglaPrecio('PORCENTAJE', 99.99, 0.01).valido, false);
    });

    it('acepta tarifa plana positiva menor al precio y rechaza importe final cero o superior', () => {
        assert.equal(evaluarReglaPrecio('FLAT', 25, 90).importeDescuento, 65);
        assert.equal(evaluarReglaPrecio('FLAT', 0, 90).valido, false);
        assert.equal(evaluarReglaPrecio('FLAT', 90, 90).valido, false);
        assert.equal(evaluarReglaPrecio('FLAT', 91, 90).valido, false);
    });
});
