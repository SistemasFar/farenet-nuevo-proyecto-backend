const test = require('node:test');
const assert = require('node:assert/strict');
const { desdeFilaFarenet, paraPlantilla } = require('../mappers/faregas-vehiculo.mapper');
const generarGnv = require('../templates/gnv-anual.template');
const generarGlp = require('../templates/glp-anual.template');
const generarConformidad = require('../templates/conformidad.template');

test('mapea la ficha legacy completa al contrato Faregas', () => {
    const vehiculo = desdeFilaFarenet({
        placa: ' X1A393 ', categoria_key: 'M1', categoria_nombre: 'M1',
        vehiculoclase_nombre: 'CAMIONETA RURAL', marca_nombre: 'HYUNDAI', modelo_nombre: 'STAREX',
        aniofabricacion: 2004, nroserie: 'KMHWP81HP4U592660', nromotor: 'D4BH3902021',
        combustible_nombre: 'PETROLEO', color_nombre: 'PLATA GRIS', carroceria_nombre: 'MULTIPROPOSITO',
        nrocilindros: 4, nroejes: 2, nroruedas: 4, nroasientos: 9, nropasajeros: 8,
        longitud: 5.03, ancho: 1.82, alto: 1.97, pesoseco: 1960, pesobruto: 2630, cargautil: 670
    });

    assert.equal(vehiculo.placa, 'X1A393');
    assert.equal(vehiculo.categoriaKey, 'M1');
    assert.equal(vehiculo.vin, 'KMHWP81HP4U592660');
    assert.equal(vehiculo.serieChasis, 'KMHWP81HP4U592660');
    assert.equal(vehiculo.carroceria, 'MULTIPROPOSITO');
    assert.equal(vehiculo.alto, 1.97);
});

test('no presenta una serie corta como VIN', () => {
    const vehiculo = desdeFilaFarenet({ placa: 'ABC123', nroserie: 'SERIE-123' });
    assert.equal(vehiculo.vin, null);
    assert.equal(vehiculo.serieChasis, 'SERIE-123');
});

test('adapta el snapshot persistido a todos los alias usados por las plantillas', () => {
    const vehiculo = paraPlantilla({
        placa: 'X1A393', anio_fabricacion: 2004, anio_modelo: 2005,
        serie_chasis: 'SERIE', numero_motor: 'MOTOR', numero_cilindros: 4,
        numero_ejes: 2, numero_ruedas: 4, numero_asientos: 9, numero_pasajeros: 8,
        alto: 1.97, peso_neto: 1960
    });

    assert.deepEqual({
        placa: vehiculo.placa,
        ano_fabricacion: vehiculo.ano_fabricacion,
        ano_modelo: vehiculo.ano_modelo,
        serie: vehiculo.serie,
        motor: vehiculo.motor,
        cilindros: vehiculo.cilindros,
        ejes: vehiculo.ejes,
        ruedas: vehiculo.ruedas,
        asientos: vehiculo.asientos,
        pasajeros: vehiculo.pasajeros,
        altura: vehiculo.altura,
        peso_seco: vehiculo.peso_seco
    }, {
        placa: 'X1A393', ano_fabricacion: 2004, ano_modelo: 2005,
        serie: 'SERIE', motor: 'MOTOR', cilindros: 4, ejes: 2, ruedas: 4,
        asientos: 9, pasajeros: 8, altura: 1.97, peso_seco: 1960
    });
});

test('las tres plantillas reciben los datos normalizados del snapshot', () => {
    const vehiculo = paraPlantilla({
        placa: 'X1A393', categoria: 'M1', clase: 'CAMIONETA RURAL', marca: 'HYUNDAI',
        modelo: 'STAREX', anio_fabricacion: 2004, vin: 'KMHWP81HP4U592660',
        serie_chasis: 'KMHWP81HP4U592660', numero_motor: 'D4BH3902021',
        numero_cilindros: 4, numero_ejes: 2, numero_ruedas: 4,
        numero_asientos: 9, numero_pasajeros: 8, alto: 1.97, ancho: 1.82,
        longitud: 5.03, peso_neto: 1960, peso_bruto: 2630, carga_util: 670
    });
    const data = { cabecera: {}, vehiculo, gnv: {}, glp: {}, conformidad: {}, verificaciones: [], componentes: [], titulares: [] };

    for (const html of [generarGnv(data), generarGlp(data), generarConformidad(data)]) {
        assert.match(html, /X1A393/);
        assert.match(html, /D4BH3902021/);
        assert.match(html, /KMHWP81HP4U592660/);
    }
});
