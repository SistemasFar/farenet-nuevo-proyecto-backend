/**
 * Test: Verificación del centrado de Previsualización de Certificados de Conformidad
 */
const assert = require('assert');
const generateConformidadHtml = require('../templates/conformidad.template');

function testConformidadPreview() {
    console.log('--- INICIO DE PRUEBAS DE CENTRADO DE CONFORMIDAD ---');

    const mockDataModificacion = {
        cabecera: {
            numero_certificado: 'DG-41-000424',
            fecha_emision: '2026-11-10',
            cliente_nombre: 'CLIENTE TEST S.A.C.'
        },
        vehiculo: {
            placa: 'ABC-123',
            categoria: 'N1',
            marca: 'TOYOTA',
            modelo: 'HILUX'
        },
        conformidad: {
            tipo_conformidad: 'MODIFICACION',
            marca_modificacion: true,
            marca_montaje: false,
            marca_fabricacion: false,
            caracteristica_registrable: 'CAMBIO DE MOTOR'
        },
        titulares: [{ nombre_razon_social: 'PROPIETARIO TEST' }]
    };

    const mockDataMontaje = {
        ...mockDataModificacion,
        conformidad: {
            tipo_conformidad: 'MONTAJE',
            marca_modificacion: false,
            marca_montaje: true,
            marca_fabricacion: false,
            caracteristica_registrable: 'MONTAJE DE GRÚA'
        }
    };

    const mockDataFabricacion = {
        ...mockDataModificacion,
        conformidad: {
            tipo_conformidad: 'FABRICACION',
            marca_modificacion: false,
            marca_montaje: false,
            marca_fabricacion: true,
            caracteristica_registrable: 'FABRICACIÓN DE REMOLQUE'
        }
    };

    const variantes = [
        { nombre: 'Modificación', data: mockDataModificacion },
        { nombre: 'Montaje', data: mockDataMontaje },
        { nombre: 'Fabricación', data: mockDataFabricacion }
    ];

    for (const { nombre, data } of variantes) {
        const html = generateConformidadHtml(data, { modo: 'PREVIEW' });

        // 1. Validar que contenga la regla de centrado @media screen
        assert(html.includes('@media screen'), `Variante ${nombre}: Debe contener @media screen`);
        assert(/margin-left:\s*auto/i.test(html), `Variante ${nombre}: Debe tener margin-left: auto`);
        assert(/margin-right:\s*auto/i.test(html), `Variante ${nombre}: Debe tener margin-right: auto`);
        assert(/width:\s*100%/i.test(html), `Variante ${nombre}: html debe ocupar width: 100% en screen`);

        // 2. Validar que mantenga el ancho A4 del body
        assert(html.includes('width: 210mm;'), `Variante ${nombre}: El body debe conservar el ancho A4 de 210mm`);
        assert(html.includes('min-height: 297mm;'), `Variante ${nombre}: El body debe conservar min-height: 297mm`);

        // 3. Validar que conserve la regla de impresión @page intacta
        assert(html.includes('@page { size: A4 portrait; margin: 0; }'), `Variante ${nombre}: Regla de impresión intacta`);

        // 4. Validar que el contenido de datos del certificado no se alteró
        assert(html.includes('ABC-123'), `Variante ${nombre}: Debe conservar la placa`);
        assert(html.includes('PROPIETARIO TEST'), `Variante ${nombre}: Debe conservar el titular`);
        assert(html.includes('CAMBIO DE MOTOR') || html.includes('MONTAJE DE GRÚA') || html.includes('FABRICACIÓN DE REMOLQUE'), `Variante ${nombre}: Debe conservar característica`);

        console.log(`  [OK] Variante ${nombre}: Centrado horizontal en pantalla verificado sin alterar datos ni impresión.`);
    }

    // 5. Validar que un snapshot emitido histórico (sin @media screen) se normaliza con asegurarCentradoWeb
    const { asegurarCentradoWeb } = require('../services/faregas-certificados.service');
    const legacySnapshotHtml = `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Certificado de Conformidad - Previsualización</title>
    <style>
        @page { size: A4 portrait; margin: 0; }
        html { width: 210mm; min-height: 297mm; background: #fff; }
        body { font-family: Arial; margin: 0; width: 210mm; min-height: 297mm; }
    </style>
</head>
<body><h1>Certificado Histórico</h1></body>
</html>`;

    const normalizedHtml = asegurarCentradoWeb(legacySnapshotHtml);
    assert(normalizedHtml.includes('@media screen'), 'Snapshot histórico: Debe inyectar regla @media screen');
    assert(/margin-left:\s*auto/i.test(normalizedHtml), 'Snapshot histórico: Debe centrar horizontalmente');
    assert(/width:\s*100%/i.test(normalizedHtml), 'Snapshot histórico: html debe ser 100% en screen');
    assert(normalizedHtml.includes('@page { size: A4 portrait; margin: 0; }'), 'Snapshot histórico: Imprimible @page intacto');
    console.log('  [OK] Snapshot emitido histórico: Normalización de centrado en pantalla validada exitosamente.');

    console.log('--- TODAS LAS PRUEBAS DE CENTRADO DE CONFORMIDAD PASARON EXITOSAMENTE ---');
    process.exit(0);
}

testConformidadPreview();
