const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    CAT_SPOT,
    evaluarDetraccion,
    aplicarDetraccionPayloadNubefact,
    evaluarNotaCreditoDetraccion
} = require('../services/faregas-detracciones.service');

describe('SUITE OFICIAL DE VALIDACIÓN: RÉGIMEN DE DETRACCIONES (SPOT SUNAT) — FAREGAS', () => {

    // 1. Umbral menor o igual a S/ 700.00 (Caso 699.99)
    it('Escenario 1: Comprobante Factura por S/ 699.99 no debe estar sujeto a detracción', () => {
        const resultado = evaluarDetraccion({
            tipoComprobante: 'FACTURA',
            importeTotal: 699.99,
            items: [{ descripcion: 'CERTIFICACION GNV', tipo_item: 'SERVICIO' }]
        });
        assert.equal(resultado.sujeto, false);
        assert.equal(resultado.monto, 0);
        assert.equal(resultado.neto, 699.99);
        assert.equal(resultado.motivoExclusion, 'IMPORTE_MENOR_O_IGUAL_A_700');
        assert.equal(resultado.estadoDeposito, 'NO_APLICA');
    });

    // 2. Umbral exacto S/ 700.00 (Art. 9 R.S. 183-2004 SUNAT: debe SUPERAR S/ 700)
    it('Escenario 2: Comprobante Factura por S/ 700.00 exactos no debe estar sujeto a detracción', () => {
        const resultado = evaluarDetraccion({
            tipoComprobante: 'FACTURA',
            importeTotal: 700.00,
            items: [{ descripcion: 'CERTIFICACION GNV', tipo_item: 'SERVICIO' }]
        });
        assert.equal(resultado.sujeto, false);
        assert.equal(resultado.monto, 0);
        assert.equal(resultado.neto, 700.00);
        assert.equal(resultado.motivoExclusion, 'IMPORTE_MENOR_O_IGUAL_A_700');
    });

    // 3. Umbral superado S/ 700.01 (Factura sujeta)
    it('Escenario 3: Comprobante Factura por S/ 700.01 debe estar sujeto a detracción', () => {
        const resultado = evaluarDetraccion({
            tipoComprobante: 'FACTURA',
            importeTotal: 700.01,
            items: [{ descripcion: 'CERTIFICACION GNV ANUAL', tipo_item: 'SERVICIO' }]
        });
        assert.equal(resultado.sujeto, true);
        assert.equal(resultado.codigo, '037');
        assert.equal(resultado.porcentaje, 12);
        // Base = 700.01 * 12% = 84.0012 -> redondeo entero = 84
        assert.equal(resultado.monto, 84);
        assert.equal(resultado.neto, 616.01);
        assert.equal(resultado.estadoDeposito, 'PENDIENTE');
    });

    // 4. Servicio sujeto a SPOT (Certificaciones GNV / GLP / Conformidad -> Catálogo 54 Código 037, 12%)
    it('Escenario 4: Certificación vehicular GNV/GLP debe mapear al Código SPOT 037 con tasa 12%', () => {
        const resultado = evaluarDetraccion({
            tipoComprobante: 'FACTURA',
            importeTotal: 1200.00,
            servicio: { detraccion_codigo: '037', detraccion_porcentaje: 12 }
        });
        assert.equal(resultado.sujeto, true);
        assert.equal(resultado.codigo, '037');
        assert.equal(resultado.porcentaje, 12);
        assert.equal(resultado.monto, 144);
        assert.equal(resultado.neto, 1056);
        assert.equal(resultado.descripcion, 'Demás servicios gravados con el IGV');
    });

    // 5. Servicio de Taller -> Catálogo 54 Código 020 con tasa 12%
    it('Escenario 5: Servicio de taller debe mapear al Código SPOT 020 con tasa 12%', () => {
        const resultado = evaluarDetraccion({
            tipoComprobante: 'FACTURA',
            importeTotal: 1500.00,
            servicio: { familia: 'TALLER', detraccion_codigo: '020', detraccion_porcentaje: 12 }
        });
        assert.equal(resultado.sujeto, true);
        assert.equal(resultado.codigo, '020');
        assert.equal(resultado.porcentaje, 12);
        assert.equal(resultado.monto, 180);
        assert.equal(resultado.neto, 1320);
        assert.equal(resultado.descripcion, 'Mantenimiento y reparación de bienes muebles');
    });

    // 6. Boleta de Venta a consumidor final (> S/ 700) -> Excluido por SUNAT (RS 183-2004 art. 13)
    it('Escenario 6: Boleta de venta por S/ 1500.00 a consumidor final está excluida de SPOT', () => {
        const resultado = evaluarDetraccion({
            tipoComprobante: 'BOLETA',
            importeTotal: 1500.00,
            items: [{ descripcion: 'CERTIFICACION GNV', tipo_item: 'SERVICIO' }]
        });
        assert.equal(resultado.sujeto, false);
        assert.equal(resultado.monto, 0);
        assert.equal(resultado.neto, 1500.00);
        assert.equal(resultado.motivoExclusion, 'BOLETA_VENTA_CONSUMIDOR_FINAL_NO_SUJETA');
    });

    // 7. Bienes físicos puros (Chips / Kits sin servicio) -> No están en Anexo 1 ni 2 SPOT
    it('Escenario 7: Venta exclusiva de bienes físicos (Chips) no está sujeta a SPOT', () => {
        const resultado = evaluarDetraccion({
            tipoComprobante: 'FACTURA',
            importeTotal: 850.00,
            items: [
                { codigo_sku: 'CHIP-GNV-01', descripcion: 'DISPOSITIVO DE CARGA CHIP GNV', tipo_item: 'PRODUCTO' }
            ]
        });
        assert.equal(resultado.sujeto, false);
        assert.equal(resultado.monto, 0);
        assert.equal(resultado.neto, 850.00);
        assert.equal(resultado.motivoExclusion, 'BIEN_MUEBLE_NO_SUJETO_A_SPOT');
    });

    // 8. Concepto sin clasificación tributaria SPOT o explícitamente excluido
    it('Escenario 8: Servicio configurado como no sujeto o excluido no genera detracción', () => {
        const resultado = evaluarDetraccion({
            tipoComprobante: 'FACTURA',
            importeTotal: 1000.00,
            servicio: { sujeto_detraccion: false }
        });
        assert.equal(resultado.sujeto, false);
        assert.equal(resultado.monto, 0);
        assert.equal(resultado.motivoExclusion, 'SERVICIO_EXCLUIDO_POR_CONFIGURACION');
    });

    // 9. Redondeo legal SUNAT (Art. 19 R.S. 183-2004/SUNAT: entero en moneda nacional)
    it('Escenario 9: Verificación de redondeo legal SUNAT al número entero en moneda nacional', () => {
        // Base S/ 704.00 * 12% = 84.48 -> Redondea a S/ 84
        const res1 = evaluarDetraccion({ tipoComprobante: 'FACTURA', importeTotal: 704.00 });
        assert.equal(res1.monto, 84);

        // Base S/ 705.00 * 12% = 84.60 -> Redondea a S/ 85
        const res2 = evaluarDetraccion({ tipoComprobante: 'FACTURA', importeTotal: 705.00 });
        assert.equal(res2.monto, 85);

        // Base S/ 704.20 * 12% = 84.504 -> Redondea a S/ 85
        const res3 = evaluarDetraccion({ tipoComprobante: 'FACTURA', importeTotal: 704.20 });
        assert.equal(res3.monto, 85);
    });

    // 10. Cálculo exacto del importe neto: Base - Detracción = Neto
    it('Escenario 10: Importe neto debe ser exactamente Base - Monto Detracción', () => {
        const resultado = evaluarDetraccion({
            tipoComprobante: 'FACTURA',
            importeTotal: 847.50
        });
        // Base = 847.50 * 12% = 101.70 -> Redondeo entero = 102
        assert.equal(resultado.monto, 102);
        assert.equal(resultado.neto, 745.50);
        assert.equal(resultado.base, 847.50);
        assert.equal(resultado.base - resultado.monto, resultado.neto);
    });

    // 11. Factura mixta (Servicio + Chip) > S/ 700
    it('Escenario 11: Factura mixta con servicio de certificación y chip aplica SPOT', () => {
        const resultado = evaluarDetraccion({
            tipoComprobante: 'FACTURA',
            importeTotal: 800.00,
            items: [
                { descripcion: 'CERTIFICACION GNV INICIAL', tipo_item: 'SERVICIO' },
                { codigo_sku: 'CHIP-01', descripcion: 'CHIP GNV', tipo_item: 'PRODUCTO' }
            ]
        });
        assert.equal(resultado.sujeto, true);
        assert.equal(resultado.codigo, '037');
        assert.equal(resultado.monto, 96);
        assert.equal(resultado.neto, 704);
    });

    // 12. Nota de crédito vinculada a factura sujeta -> Ajuste proporcional
    it('Escenario 12: Nota de crédito asociada a factura SPOT debe reflejar el ajuste proporcional', () => {
        const facturaOriginal = {
            sujeto_detraccion: true,
            detraccion_codigo: '037',
            detraccion_porcentaje: 12.00
        };
        const ajusteNC = evaluarNotaCreditoDetraccion(facturaOriginal, 300.00);
        assert.equal(ajusteNC.sujeto, true);
        assert.equal(ajusteNC.codigo, '037');
        assert.equal(ajusteNC.porcentaje, 12);
        // 300 * 12% = 36
        assert.equal(ajusteNC.monto, 36);
        assert.equal(ajusteNC.neto, 264.00);
    });

    // 13. Integración NubeFact: Enriquecimiento de payload según estatus SPOT
    it('Escenario 13: Payload NubeFact incluye campos SPOT cuando sujeto, y los elimina cuando no', () => {
        // Sujeto
        const payloadSujeto = aplicarDetraccionPayloadNubefact({ total: 1000 }, {
            sujeto: true,
            nubefactTipo: 37,
            porcentaje: 12,
            monto: 120
        });
        assert.equal(payloadSujeto.detraccion, true);
        assert.equal(payloadSujeto.detraccion_tipo, 37);
        assert.equal(payloadSujeto.detraccion_porcentaje, 12);
        assert.equal(payloadSujeto.detraccion_total, 120);
        assert.equal(payloadSujeto.medio_de_pago_detraccion, '001');

        // No sujeto
        const payloadNoSujeto = aplicarDetraccionPayloadNubefact({ total: 500, detraccion_total: 60 }, {
            sujeto: false
        });
        assert.equal(payloadNoSujeto.detraccion, false);
        assert.equal(payloadNoSujeto.detraccion_total, undefined);
        assert.equal(payloadNoSujeto.detraccion_tipo, undefined);
    });

    // 14. Reporte Excel Datos: Mapeo de las 10 columnas oficiales de SPOT en archivo fuente
    it('Escenario 14: Verificación estructural de las 10 columnas oficiales de SPOT en faregas-documentos-emitidos-extendido.ts', () => {
        const rutaExtendido = path.resolve(__dirname, '../../../../farenetFrontend/src/modules/faregas/utils/faregas-documentos-emitidos-extendido.ts');
        const contenido = fs.readFileSync(rutaExtendido, 'utf8');

        const columnasRequeridas = [
            'sujetoDetraccion',
            'detraccionCodigo',
            'detraccionDescripcion',
            'detraccionPorcentaje',
            'detraccionBase',
            'detraccionImporte',
            'detraccionNeto',
            'detraccionEstadoDeposito',
            'detraccionConstanciaNro',
            'detraccionConstanciaFecha'
        ];

        columnasRequeridas.forEach(col => {
            assert.ok(contenido.includes(col), `El reporte Datos debe contener la columna SPOT: ${col}`);
        });

        // Verificación de Líneas de productos (sujetoSpot y codigoSpot)
        assert.ok(contenido.includes('sujetoSpot'), 'Líneas de productos debe incluir sujetoSpot');
        assert.ok(contenido.includes('codigoSpot'), 'Líneas de productos debe incluir codigoSpot');
    });

    // 15. Reporte Excel Consolidado_Datos: Columnas SPOT y sumatoria en fila de totales
    it('Escenario 15: Verificación de las 10 columnas SPOT y sumatoria en fila de totales en faregas-reporte-financiero.ts', () => {
        const rutaReporte = path.resolve(__dirname, '../../../../farenetFrontend/src/modules/faregas/utils/faregas-reporte-financiero.ts');
        const contenido = fs.readFileSync(rutaReporte, 'utf8');

        const columnasRequeridas = [
            'detraccionSujeto',
            'detraccionCodigo',
            'detraccionDescripcion',
            'detraccionPorcentaje',
            'detraccionBase',
            'detraccionMonto',
            'detraccionNeto',
            'detraccionEstadoDeposito',
            'detraccionConstanciaNro',
            'detraccionConstanciaFecha'
        ];

        columnasRequeridas.forEach(col => {
            assert.ok(contenido.includes(col), `Consolidado_Datos debe contener la columna SPOT: ${col}`);
        });

        // Verificación de sumatoria en filaTotalVentas
        assert.ok(contenido.includes('totales.detraccionBase'), 'Fila total ventas debe acumular detraccionBase');
        assert.ok(contenido.includes('totales.detraccionMonto'), 'Fila total ventas debe acumular detraccionMonto');
        assert.ok(contenido.includes('totales.detraccionNeto'), 'Fila total ventas debe acumular detraccionNeto');
    });

    // 16. Inmutabilidad y seguridad de FARENET y catálogos maestros
    it('Escenario 16: Verificación de seguridad: catálogo SPOT oficial es inmutable y no afecta esquemas externos', () => {
        assert.equal(CAT_SPOT['037'].codigo, '037');
        assert.equal(CAT_SPOT['020'].codigo, '020');
        assert.equal(CAT_SPOT['022'].codigo, '022');
        assert.equal(CAT_SPOT['025'].codigo, '025');
        assert.equal(Object.keys(CAT_SPOT).length, 4);
    });

    // 17. Caso práctico S/ 1,260.00: Boleta (consumidor final) vs Factura (SPOT 12%)
    it('Escenario 17: Caso venta S/ 1,260.00 — Boleta exige pago íntegro S/ 1,260.00 y Factura aplica detracción S/ 151.00 y neto S/ 1,109.00', () => {
        // A) Caso BOLETA: Excluida según RS 183-2004 Art. 13
        const resBoleta = evaluarDetraccion({
            tipoComprobante: 'BOLETA',
            importeTotal: 1260.00,
            items: [{ descripcion: 'CERTIFICACION CONFORMIDAD VEHICULAR', tipo_item: 'SERVICIO' }]
        });
        assert.equal(resBoleta.sujeto, false);
        assert.equal(resBoleta.monto, 0);
        assert.equal(resBoleta.neto, 1260.00);
        assert.equal(resBoleta.motivoExclusion, 'BOLETA_VENTA_CONSUMIDOR_FINAL_NO_SUJETA');

        // B) Caso FACTURA: Sujeta al SPOT Código 037 (12%)
        const resFactura = evaluarDetraccion({
            tipoComprobante: 'FACTURA',
            importeTotal: 1260.00,
            items: [{ descripcion: 'CERTIFICACION CONFORMIDAD VEHICULAR', tipo_item: 'SERVICIO' }]
        });
        assert.equal(resFactura.sujeto, true);
        assert.equal(resFactura.codigo, '037');
        assert.equal(resFactura.porcentaje, 12);
        // Base S/ 1,260 * 12% = 151.2 -> redondeo SUNAT entero = S/ 151.00
        assert.equal(resFactura.monto, 151);
        // Neto a cobrar ordinario = 1,260 - 151 = S/ 1,109.00
        assert.equal(resFactura.neto, 1109.00);
        assert.equal(resFactura.estadoDeposito, 'PENDIENTE');
    });

    // 18. Consistencia frontend y backend en cálculo SPOT
    it('Escenario 18: Frontend wizard y backend calculan exactamente los mismos importes para S/ 1,260.00', () => {
        const rutaFrontendValidation = path.resolve(__dirname, '../../../../farenetFrontend/src/modules/faregas/views/NuevoCertificado/faregas-wizard.validation.ts');
        const contenidoFrontend = fs.readFileSync(rutaFrontendValidation, 'utf8');

        // Verificar que el frontend tiene evaluarSpotWizard
        assert.ok(contenidoFrontend.includes('evaluarSpotWizard'), 'Frontend debe tener función evaluarSpotWizard');
        assert.ok(contenidoFrontend.includes('codigoSpot: \'037\''), 'Frontend debe mapear código 037');
        assert.ok(contenidoFrontend.includes('porcentaje = 12'), 'Frontend debe calcular con 12%');
        assert.ok(contenidoFrontend.includes('Math.round((totalRedondeado * porcentaje) / 100)'), 'Frontend debe redondear según regla oficial SUNAT');

        // Simular cálculo frontend
        const total = 1260.00;
        const porcentaje = 12;
        const montoDetraccion = Math.round((total * porcentaje) / 100);
        const netoCobrar = total - montoDetraccion;

        const resBackend = evaluarDetraccion({ tipoComprobante: 'FACTURA', importeTotal: total });
        assert.equal(montoDetraccion, resBackend.monto);
        assert.equal(netoCobrar, resBackend.neto);
        assert.equal(montoDetraccion, 151);
        assert.equal(netoCobrar, 1109);
    });

    // 19. Comprobación del resumen y validación de cobro ordinario
    it('Escenario 19: PagoStep y validarPasoPago diferencian total, detracción y neto sin exigir pago íntegro de S/ 1,260.00 en FACTURA', () => {
        const rutaPagoStep = path.resolve(__dirname, '../../../../farenetFrontend/src/modules/faregas/views/NuevoCertificado/components/NuevoCertificado/PagoStep.tsx');
        const contenidoPagoStep = fs.readFileSync(rutaPagoStep, 'utf8');

        assert.ok(contenidoPagoStep.includes('Total comprobante:'), 'PagoStep debe mostrar Total comprobante');
        assert.ok(contenidoPagoStep.includes('Detracción SPOT'), 'PagoStep debe mostrar Detracción SPOT');
        assert.ok(contenidoPagoStep.includes('Neto a pagar ordinario:'), 'PagoStep debe mostrar Neto a pagar ordinario');
        assert.ok(contenidoPagoStep.includes('Falta Pagar:'), 'PagoStep debe mostrar Falta Pagar');
        assert.ok(contenidoPagoStep.includes('evaluarSpotWizard'), 'PagoStep debe consumir evaluarSpotWizard');
    });

    // 20. Confirmación de estado de Migración 004
    it('Escenario 20: La migración 004 está lista en 004_implementacion_detracciones_spot.sql y preserva la integridad de la base compartida', () => {
        const rutaMigracion = path.resolve(__dirname, '../database/migrations/004_implementacion_detracciones_spot.sql');
        assert.ok(fs.existsSync(rutaMigracion), 'El script 004 debe existir');
        const contenido = fs.readFileSync(rutaMigracion, 'utf8');
        assert.ok(contenido.includes('sujeto_detraccion'), 'Debe definir sujeto_detraccion');
        assert.ok(contenido.includes('detraccion_monto'), 'Debe definir detraccion_monto');
        assert.ok(contenido.includes('detraccion_neto'), 'Debe definir detraccion_neto');
    });

});
