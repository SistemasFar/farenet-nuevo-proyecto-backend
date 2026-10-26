/**
 * Utilidades puras de rectificación de certificados FAREGAS.
 *
 * La rectificación trabaja sobre el snapshot técnico del certificado y sus
 * tablas satélite (vehículo, titulares, GNV, GLP, conformidad, componentes y
 * verificaciones). Nunca toca la facturación, los pagos, los correlativos, la
 * fecha de emisión original ni el número DG.
 */

const CAMPOS_VEHICULO = Object.freeze([
    'placa', 'categoria', 'clase', 'marca', 'modelo', 'version',
    'anio_fabricacion', 'anio_modelo', 'vin', 'serie_chasis', 'numero_motor',
    'combustible', 'color', 'carroceria', 'numero_cilindros', 'cilindrada',
    'numero_ejes', 'numero_ruedas', 'numero_asientos', 'numero_pasajeros',
    'longitud', 'ancho', 'alto', 'peso_neto', 'peso_bruto', 'carga_util',
    'potencia', 'formula_rodante'
]);

const CAMPOS_TITULAR = Object.freeze([
    'tipo_documento', 'nro_documento', 'nombre_razon_social', 'direccion'
]);

const CAMPOS_ESPECIFICOS = Object.freeze({
    GNV: Object.freeze([
        'taller_razon_social', 'taller_sede', 'taller_direccion',
        'taller_codigo_autorizacion', 'vigencia_hasta', 'modalidad',
        'numero_chip', 'combustible_posterior', 'peso_neto_posterior',
        'observaciones'
    ]),
    GLP: Object.freeze([
        'taller_razon_social', 'taller_sede', 'taller_direccion',
        'taller_codigo_autorizacion', 'expediente_tecnico', 'vigencia_hasta',
        'modalidad', 'combustible_posterior', 'peso_neto_posterior',
        'carga_util_posterior'
    ]),
    CONFORMIDAD: Object.freeze([
        'tipo_conformidad', 'tipo_tramite', 'caracteristica_registrable',
        'motivo', 'descripcion', 'uso_original_vehiculo', 'marca_modificacion',
        'marca_montaje', 'marca_fabricacion'
    ])
});

const CAMPOS_ARRAY = Object.freeze(['componentes', 'verificaciones']);

const CAMPOS_EXTERNOS = Object.freeze({
    placa: 'La placa también puede estar registrada en SUNARP/MTC. La corrección local no actualiza esos registros externos.',
    vin: 'El VIN suele estar vinculado al registro vehicular externo (SUNARP/MTC). Verifique si corresponde una comunicación oficial.',
    serie_chasis: 'La serie/chasis puede estar vinculada al registro vehicular externo (SUNARP/MTC).',
    numero_motor: 'El número de motor puede estar vinculado al registro vehicular externo (SUNARP/MTC).',
    categoria: 'La categoría vehicular puede estar vinculada a la tarjeta de identificación vehicular y al MTC.',
    clase: 'La clase vehicular puede estar vinculada a la tarjeta de identificación vehicular y al MTC.',
    marca: 'La marca/modelo puede estar vinculada a la tarjeta de identificación vehicular y al MTC.',
    modelo: 'La marca/modelo puede estar vinculada a la tarjeta de identificación vehicular y al MTC.',
    tipo_documento: 'La identidad del titular puede requerir actualización en registros externos; el certificado local no modifica SUNARP/MTC.',
    nro_documento: 'La identidad del titular puede requerir actualización en registros externos; el certificado local no modifica SUNARP/MTC.',
    nombre_razon_social: 'La identidad del titular puede requerir actualización en registros externos; el certificado local no modifica SUNARP/MTC.'
});

const esObjeto = (valor) => Boolean(valor) && typeof valor === 'object' && !Array.isArray(valor);

const textoONull = (valor) => {
    if (valor === undefined || valor === null) return null;
    const limpio = String(valor).trim();
    return limpio ? limpio : null;
};

const copiaProfunda = (valor) => JSON.parse(JSON.stringify(valor));

const setValorAnidado = (objeto, ruta, valor) => {
    const partes = String(ruta || '').split('.').filter(Boolean);
    if (partes.length === 0) return;
    let actual = objeto;
    partes.slice(0, -1).forEach((parte) => {
        if (!esObjeto(actual[parte])) actual[parte] = {};
        actual = actual[parte];
    });
    actual[partes[partes.length - 1]] = valor;
};

const obtenerValorAnidado = (objeto, ruta) => {
    const partes = String(ruta || '').split('.').filter(Boolean);
    let actual = objeto;
    for (const parte of partes) {
        if (!esObjeto(actual) || !(parte in actual)) return null;
        actual = actual[parte];
    }
    return actual === undefined ? null : actual;
};

const normalizarComponente = (componente = {}) => ({
    orden: Number(componente.orden ?? componente.ordenComponente ?? 0) || null,
    componente: textoONull(componente.componente ?? componente.nombre),
    marca: textoONull(componente.marca),
    modelo: textoONull(componente.modelo),
    capacidad_litros: textoONull(componente.capacidad_litros ?? componente.capacidadLitros),
    mes_fabricacion: componente.mes_fabricacion ?? componente.mesFabricacion ?? null,
    anio_fabricacion: componente.anio_fabricacion ?? componente.anioFabricacion ?? null,
    numero_serie: textoONull(componente.numero_serie ?? componente.numeroSerie)
});

const normalizarVerificacion = (verificacion = {}) => ({
    codigo: textoONull(verificacion.codigo),
    orden: Number(verificacion.orden ?? 0) || null,
    descripcion: textoONull(verificacion.descripcion),
    cumple: verificacion.cumple === null || verificacion.cumple === undefined
        ? null
        : Boolean(verificacion.cumple),
    observacion: textoONull(verificacion.observacion)
});

const normalizarComponentes = (componentes) => (
    Array.isArray(componentes)
        ? componentes.map(normalizarComponente).sort((a, b) => Number(a.orden || 0) - Number(b.orden || 0))
        : null
);

const normalizarVerificaciones = (verificaciones) => (
    Array.isArray(verificaciones)
        ? verificaciones.map(normalizarVerificacion).sort((a, b) => Number(a.orden || 0) - Number(b.orden || 0))
        : null
);

const tipoEspecifico = (tipoCertificado) => {
    const tipo = String(tipoCertificado || '').toUpperCase();
    if (tipo.includes('GNV')) return 'GNV';
    if (tipo.includes('GLP')) return 'GLP';
    if (tipo === 'CONFORMIDAD') return 'CONFORMIDAD';
    return null;
};

/**
 * Aplica los datos propuestos sobre una copia del borrador/snapshot técnico.
 * No escribe en base de datos.
 */
const aplicarPropuestaABorrador = (borradorOriginal = {}, datosPropuestos = {}) => {
    const borrador = copiaProfunda(borradorOriginal);
    const tipo = tipoEspecifico(borrador?.tipo?.clave || borrador?.tipoCertificado);
    const especifico = esObjeto(borrador.especifico) ? { ...borrador.especifico } : {};
    const especificoBase = esObjeto(borrador.especificoBase) ? { ...borrador.especificoBase } : especifico;
    const datos = esObjeto(datosPropuestos) ? datosPropuestos : {};
    const aplicados = new Set();

    if (!esObjeto(borrador.vehiculo)) borrador.vehiculo = {};
    if (!Array.isArray(borrador.titulares)) borrador.titulares = [];
    if (!esObjeto(borrador.formatoDatosSnapshot)) borrador.formatoDatosSnapshot = {};

    Object.entries(datos).forEach(([campo, valor]) => {
        if (campo === 'datosFormato') {
            if (esObjeto(valor)) {
                Object.entries(valor).forEach(([ruta, contenido]) => {
                    setValorAnidado(borrador.formatoDatosSnapshot, ruta, contenido);
                    aplicados.add(`datosFormato.${ruta}`);
                });
            }
            return;
        }

        if (campo === 'componentes') {
            borrador.componentes = normalizarComponentes(valor);
            aplicados.add(campo);
            return;
        }

        if (campo === 'verificaciones') {
            borrador.verificaciones = normalizarVerificaciones(valor);
            aplicados.add(campo);
            return;
        }

        if (CAMPOS_VEHICULO.includes(campo)) {
            borrador.vehiculo[campo] = valor === undefined ? null : valor;
            aplicados.add(campo);
            return;
        }

        if (campo === 'observaciones') {
            borrador.observaciones = valor === undefined ? null : valor;
            // En GNV las observaciones del certificado y del formulario GNV
            // comparten el mismo texto visible.
            if (tipo === 'GNV') especifico.observaciones = valor === undefined ? null : valor;
            aplicados.add(campo);
            return;
        }

        if (campo === 'titular_nombre') {
            if (borrador.titulares.length === 0) borrador.titulares.push({ orden: 1 });
            borrador.titulares[0].nombre_razon_social = valor === undefined ? null : valor;
            aplicados.add('nombre_razon_social');
            return;
        }

        if (CAMPOS_TITULAR.includes(campo)) {
            if (borrador.titulares.length === 0) borrador.titulares.push({ orden: 1 });
            borrador.titulares[0][campo] = valor === undefined ? null : valor;
            aplicados.add(campo);
            return;
        }

        if (tipo && CAMPOS_ESPECIFICOS[tipo]?.includes(campo)) {
            especifico[campo] = valor === undefined ? null : valor;
            // El nombre del taller también alimenta el snapshot de formatos
            // dinámicos que imprimen taller.nombre.
            if (campo === 'taller_razon_social') {
                setValorAnidado(borrador.formatoDatosSnapshot, 'taller.nombre', valor === undefined ? '' : valor);
            }
            aplicados.add(campo);
        }
    });

    if (tipo) {
        borrador.especifico = especifico;
        // Conservar el snapshot original sin mutar para calcular diferencias.
        if (!borrador.especificoOriginal) borrador.especificoOriginal = copiaProfunda(especificoBase);
    }

    return { borrador, aplicados: [...aplicados] };
};

const construirSnapshotVersion = ({ borrador, versionBase = 1, usuario = null }) => {
    const tipo = tipoEspecifico(borrador?.tipo?.clave || borrador?.tipoCertificado);
    return {
        esquema: 2,
        certificadoId: Number(borrador.id || borrador.certificadoId),
        numeroCertificado: borrador.numeroCertificado || borrador.numero_certificado || null,
        tipoCertificado: borrador.tipo?.clave || borrador.tipoCertificado || null,
        empresaKey: borrador.empresaKey || null,
        plantaKey: borrador.planta?.key || borrador.plantaKey || null,
        fechaEmisionOriginal: borrador.fechaEmision || borrador.fechaEmisionOriginal || null,
        estado: borrador.estado || 'EMITIDO',
        versionBase: Number(versionBase) || 1,
        observaciones: borrador.observaciones ?? null,
        entidadCertificadoraNombre: borrador.entidadCertificadoraNombre || null,
        resolucionDirectoral: borrador.resolucionDirectoral || null,
        domicilioFiscal: borrador.domicilioFiscal || null,
        telefonoCertificadora: borrador.telefonoCertificadora || null,
        lugarEmision: borrador.lugarEmision || null,
        tarifaCodigo: borrador.tarifaCodigo || null,
        formatoVersionId: borrador.formatoVersionId || null,
        formatoVersionAsignadaId: borrador.formatoVersionAsignadaId || null,
        formatoDatosSnapshot: copiaProfunda(borrador.formatoDatosSnapshot || {}),
        cliente: borrador.cliente ? copiaProfunda(borrador.cliente) : null,
        chip: borrador.chipSeleccion ? copiaProfunda(borrador.chipSeleccion) : null,
        vehiculo: copiaProfunda(borrador.vehiculo || {}),
        titulares: copiaProfunda(borrador.titulares || []),
        especifico: tipo ? copiaProfunda(borrador.especifico || {}) : null,
        componentes: tipo === 'GNV' || tipo === 'GLP'
            ? normalizarComponentes(borrador.componentes || [])
            : null,
        verificaciones: tipo === 'GNV' || tipo === 'GLP'
            ? normalizarVerificaciones(borrador.verificaciones || [])
            : null,
        usuarioRectificacion: usuario || null,
        fechaSnapshot: new Date().toISOString()
    };
};

const obtenerOriginalParaCampo = (snapshot, campo) => {
    if (!snapshot) return null;
    if (CAMPOS_VEHICULO.includes(campo)) return snapshot.vehiculo?.[campo] ?? null;
    if (campo === 'observaciones') return snapshot.observaciones ?? null;
    if (campo === 'titular_nombre' || campo === 'nombre_razon_social') {
        return snapshot.titulares?.[0]?.nombre_razon_social ?? null;
    }
    if (CAMPOS_TITULAR.includes(campo)) return snapshot.titulares?.[0]?.[campo] ?? null;
    if (snapshot.especifico && campo in snapshot.especifico) return snapshot.especifico[campo];
    if (String(campo).startsWith('datosFormato.')) {
        return obtenerValorAnidado(snapshot.formatoDatosSnapshot, campo.slice('datosFormato.'.length));
    }
    return null;
};

const valorComparable = (valor) => {
    if (valor === null || valor === undefined) return '';
    if (typeof valor === 'object') return JSON.stringify(valor);
    const texto = String(valor).trim();
    // PostgreSQL entrega las columnas date como timestamp ISO al serializar el
    // snapshot. La UI trabaja con YYYY-MM-DD; sin esta normalización cualquier
    // rectificación detectaría un cambio ficticio en la vigencia.
    if (/^\d{4}-\d{2}-\d{2}T/.test(texto)) return texto.slice(0, 10);
    return texto;
};

const calcularDiferenciasRectificacion = (snapshot, datosPropuestos = {}) => {
    const diferencias = [];
    const datos = esObjeto(datosPropuestos) ? datosPropuestos : {};

    const agregar = (campo, anterior, nuevo) => {
        if (valorComparable(anterior) === valorComparable(nuevo)) return;
        diferencias.push({
            campo,
            valorOriginal: anterior ?? null,
            valorPropuesto: nuevo ?? null
        });
    };

    Object.entries(datos).forEach(([campo, valor]) => {
        if (campo === 'datosFormato') {
            if (!esObjeto(valor)) return;
            Object.entries(valor).forEach(([ruta, contenido]) => {
                const anterior = obtenerValorAnidado(snapshot?.formatoDatosSnapshot, ruta);
                agregar(`datosFormato.${ruta}`, anterior, contenido);
            });
            return;
        }
        if (campo === 'componentes') {
            const normalizado = normalizarComponentes(valor) || [];
            const anterior = normalizarComponentes(snapshot?.componentes) || [];
            if (JSON.stringify(anterior) !== JSON.stringify(normalizado)) {
                diferencias.push({ campo, valorOriginal: anterior, valorPropuesto: normalizado });
            }
            return;
        }
        if (campo === 'verificaciones') {
            const normalizado = normalizarVerificaciones(valor) || [];
            const anterior = normalizarVerificaciones(snapshot?.verificaciones) || [];
            if (JSON.stringify(anterior) !== JSON.stringify(normalizado)) {
                diferencias.push({ campo, valorOriginal: anterior, valorPropuesto: normalizado });
            }
            return;
        }
        agregar(campo, obtenerOriginalParaCampo(snapshot, campo), valor);
    });

    return diferencias;
};

const advertenciasGestionExterna = (diferencias = []) => {
    const advertencias = [];
    diferencias.forEach((diferencia) => {
        const mensaje = CAMPOS_EXTERNOS[diferencia.campo];
        if (mensaje && !advertencias.includes(mensaje)) advertencias.push(mensaje);
    });
    return advertencias;
};

const esCampoExterno = (campo) => Object.hasOwn(CAMPOS_EXTERNOS, campo);

module.exports = {
    CAMPOS_VEHICULO,
    CAMPOS_TITULAR,
    CAMPOS_ESPECIFICOS,
    CAMPOS_ARRAY,
    CAMPOS_EXTERNOS,
    tipoEspecifico,
    esObjeto,
    textoONull,
    copiaProfunda,
    setValorAnidado,
    obtenerValorAnidado,
    normalizarComponente,
    normalizarVerificacion,
    normalizarComponentes,
    normalizarVerificaciones,
    aplicarPropuestaABorrador,
    construirSnapshotVersion,
    calcularDiferenciasRectificacion,
    advertenciasGestionExterna,
    esCampoExterno
};
