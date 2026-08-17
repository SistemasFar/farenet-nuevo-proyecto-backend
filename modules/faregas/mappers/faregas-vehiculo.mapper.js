const normalizarTexto = (valor) => {
    if (valor === null || valor === undefined) return null;
    const texto = String(valor).trim();
    return texto || null;
};

const primerValor = (...valores) => {
    for (const valor of valores) {
        if (valor !== null && valor !== undefined && String(valor).trim() !== '') return valor;
    }
    return null;
};

const esVinValido = (valor) => /^[A-HJ-NPR-Z0-9]{17}$/i.test(valor || '');

// Contrato canónico de solo lectura entre el modelo legacy de Farenet y Faregas.
exports.desdeFilaFarenet = (row) => {
    const identificadorVehicular = normalizarTexto(row.nroserie);

    return {
        placa: normalizarTexto(row.placa),
        categoria: normalizarTexto(primerValor(row.categoria_key, row.categoria_nombre)),
        categoriaKey: normalizarTexto(row.categoria_key),
        categoriaNombre: normalizarTexto(row.categoria_nombre),
        clase: normalizarTexto(primerValor(row.vehiculoclase_nombre, row.vehiculoclase_key)),
        marca: normalizarTexto(primerValor(row.marca_nombre, row.marca_key)),
        modelo: normalizarTexto(primerValor(row.modelo_nombre, row.modelo_key)),
        version: null,
        anioFabricacion: row.aniofabricacion ?? null,
        anioModelo: null,
        // Farenet conserva un único campo "VIN / N° Serie". Solo se replica como VIN
        // cuando satisface el formato internacional de 17 caracteres.
        vin: esVinValido(identificadorVehicular) ? identificadorVehicular : null,
        serieChasis: identificadorVehicular,
        numeroMotor: normalizarTexto(row.nromotor),
        combustible: normalizarTexto(primerValor(row.combustible_nombre, row.combustible_key)),
        color: normalizarTexto(primerValor(row.color_nombre, row.color_key)),
        carroceria: normalizarTexto(primerValor(row.carroceria_nombre, row.carroceria_key)),
        marcaCarroceria: normalizarTexto(row.marcacarroceria),
        numeroCilindros: row.nrocilindros ?? null,
        cilindrada: null,
        numeroEjes: row.nroejes ?? null,
        numeroRuedas: row.nroruedas ?? null,
        numeroAsientos: row.nroasientos ?? null,
        numeroPasajeros: row.nropasajeros ?? null,
        longitud: row.longitud ?? null,
        ancho: row.ancho ?? null,
        alto: row.alto ?? null,
        pesoNeto: row.pesoseco ?? null,
        pesoBruto: row.pesobruto ?? null,
        cargaUtil: row.cargautil ?? null,
        potencia: null,
        formulaRodante: null,
        kilometraje: row.kilometraje ?? null,
        nroPuertas: row.nropuertas ?? null,
        nroPisos: row.nropisos ?? null,
        salidasEmergencia: row.nrosalidaemergencia ?? null
    };
};

// Adapta el snapshot persistido de Faregas al contrato histórico de las plantillas.
exports.paraPlantilla = (snapshot = {}) => ({
    ...snapshot,
    placa: snapshot.placa,
    ano_fabricacion: snapshot.anio_fabricacion,
    ano_modelo: snapshot.anio_modelo,
    serie: snapshot.serie_chasis,
    motor: snapshot.numero_motor,
    cilindros: snapshot.numero_cilindros,
    ejes: snapshot.numero_ejes,
    ruedas: snapshot.numero_ruedas,
    asientos: snapshot.numero_asientos,
    pasajeros: snapshot.numero_pasajeros,
    altura: snapshot.alto,
    peso_seco: snapshot.peso_neto
});
