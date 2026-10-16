/**
 * Servicio Centralizado de Cálculos Monetarios y Tributarios — FAREGAS / SUNAT / NubeFact
 * 
 * Reglas de precisión y cumplimiento normativo:
 * - Aritmética decimal de alta precisión basada en BigInt para eliminar errores de coma flotante IEEE 754.
 * - Soporte para importes grandes y valores límite de NUMERIC(12,2) (-9,999,999,999.99 a 9,999,999,999.99).
 * - Distinción estricta de las reglas de redondeo fiscal:
 *     1. Redondeo comercial estándar: HALF_UP a N decimales (habitualmente 2).
 *     2. Redondeo de IGV: Base imponible y débito fiscal con cuadre exacto al centavo (Base + IGV === Total).
 *     3. Redondeo SPOT: Según R.S. 183-2004/SUNAT art. 8, la detracción en moneda nacional (PEN) se redondea
 *        al NÚMERO ENTERO de la unidad monetaria (0 decimales HALF_UP).
 * - Catálogo completo de afectación al IGV (Catálogo N° 07 SUNAT) con mapeo exacto a NubeFact (tipo_de_igv 1-17, 21).
 * - Distinción en operaciones gratuitas entre: Total exigible = S/ 0.00, Valor referencial, IGV en comprobante = 0.00,
 *   y débito fiscal que el emisor asume ante SUNAT en transferencias gravadas.
 * - Validación exhaustiva de Detracciones SPOT (Catálogo 54, umbrales específicos no universales, cuenta BN, moneda y TC).
 */

// Límites de PostgreSQL NUMERIC(12,2)
const MAX_NUMERIC_12_2 = 9999999999.99;
const MIN_NUMERIC_12_2 = -9999999999.99;

/**
 * Catálogo N° 07 de SUNAT — Códigos de Tipo de Afectación al IGV
 * Define el régimen de afectación y su equivalencia en NubeFact.
 */
const CATALOGO_AFECTACION_IGV = {
    // Gravadas Onerosas
    '10': { codigo: '10', descripcion: 'Gravado - Operación Onerosa', tipo: 'GRAVADO_ONEROSO', esGratuito: false, generaDebitoEmisor: true, nubeFactTipo: 1 },
    // Gravadas Gratuitas (Retiros afectos que el emisor asume como gasto/débito ante SUNAT)
    '11': { codigo: '11', descripcion: 'Gravado - Retiro por premio', tipo: 'GRAVADO_GRATUITO', esGratuito: true, generaDebitoEmisor: true, nubeFactTipo: 2 },
    '12': { codigo: '12', descripcion: 'Gravado - Retiro por donación', tipo: 'GRAVADO_GRATUITO', esGratuito: true, generaDebitoEmisor: true, nubeFactTipo: 3 },
    '13': { codigo: '13', descripcion: 'Gravado - Retiro', tipo: 'GRAVADO_GRATUITO', esGratuito: true, generaDebitoEmisor: true, nubeFactTipo: 4 },
    '14': { codigo: '14', descripcion: 'Gravado - Retiro por publicidad', tipo: 'GRAVADO_GRATUITO', esGratuito: true, generaDebitoEmisor: true, nubeFactTipo: 5 },
    '15': { codigo: '15', descripcion: 'Gravado - Bonificaciones', tipo: 'GRAVADO_GRATUITO', esGratuito: true, generaDebitoEmisor: true, nubeFactTipo: 6 },
    '16': { codigo: '16', descripcion: 'Gravado - Retiro por entrega a trabajadores', tipo: 'GRAVADO_GRATUITO', esGratuito: true, generaDebitoEmisor: true, nubeFactTipo: 7 },
    '17': { codigo: '17', descripcion: 'Gravado - IVAP (Arroz pilado)', tipo: 'GRAVADO_IVAP', esGratuito: false, generaDebitoEmisor: true, nubeFactTipo: 17 },
    // Exoneradas Onerosas
    '20': { codigo: '20', descripcion: 'Exonerado - Operación Onerosa', tipo: 'EXONERADO_ONEROSO', esGratuito: false, generaDebitoEmisor: false, nubeFactTipo: 8 },
    // Exoneradas Gratuitas
    '21': { codigo: '21', descripcion: 'Exonerado - Transferencia Gratuita', tipo: 'EXONERADO_GRATUITO', esGratuito: true, generaDebitoEmisor: false, nubeFactTipo: 21 },
    // Inafectas Onerosas
    '30': { codigo: '30', descripcion: 'Inafecto - Operación Onerosa', tipo: 'INAFECTO_ONEROSO', esGratuito: false, generaDebitoEmisor: false, nubeFactTipo: 9 },
    // Inafectas Gratuitas (Retiros no gravados)
    '31': { codigo: '31', descripcion: 'Inafecto - Retiro por Bonificación', tipo: 'INAFECTO_GRATUITO', esGratuito: true, generaDebitoEmisor: false, nubeFactTipo: 10 },
    '32': { codigo: '32', descripcion: 'Inafecto - Retiro', tipo: 'INAFECTO_GRATUITO', esGratuito: true, generaDebitoEmisor: false, nubeFactTipo: 11 },
    '33': { codigo: '33', descripcion: 'Inafecto - Retiro por Muestras Médicas', tipo: 'INAFECTO_GRATUITO', esGratuito: true, generaDebitoEmisor: false, nubeFactTipo: 12 },
    '34': { codigo: '34', descripcion: 'Inafecto - Retiro por Convenio Colectivo', tipo: 'INAFECTO_GRATUITO', esGratuito: true, generaDebitoEmisor: false, nubeFactTipo: 13 },
    '35': { codigo: '35', descripcion: 'Inafecto - Retiro por premio', tipo: 'INAFECTO_GRATUITO', esGratuito: true, generaDebitoEmisor: false, nubeFactTipo: 14 },
    '36': { codigo: '36', descripcion: 'Inafecto - Retiro por publicidad', tipo: 'INAFECTO_GRATUITO', esGratuito: true, generaDebitoEmisor: false, nubeFactTipo: 15 },
    // Exportación
    '40': { codigo: '40', descripcion: 'Exportación de Bienes o Servicios', tipo: 'EXPORTACION', esGratuito: false, generaDebitoEmisor: false, nubeFactTipo: 16 }
};

// Aliases comunes para retrocompatibilidad
const AFECTACION_IGV = {
    GRAVADO_OPERACION_ONEROSA: '10',
    GRAVADO_RETIRO_PREMIO: '11',
    GRAVADO_RETIRO_DONACION: '12',
    GRAVADO_RETIRO: '13',
    GRAVADO_RETIRO_PUBLICIDAD: '14',
    GRAVADO_BONIFICACIONES: '15',
    GRAVADO_RETIRO_TRABAJADORES: '16',
    EXONERADO_OPERACION_ONEROSA: '20',
    EXONERADO_TRANSFERENCIA_GRATUITA: '21',
    INAFECTO_OPERACION_ONEROSA: '30',
    INAFECTO_RETIRO_BONIFICACION: '31',
    INAFECTO_RETIRO: '32'
};

/**
 * Catálogo N° 54 de SUNAT — Bienes y Servicios Sujetos al SPOT (Detracciones)
 * Define códigos, descripciones, tasas vigentes y umbrales específicos según norma.
 */
const CATALOGO_DETRACCION_SPOT = {
    '022': { codigo: '022', anexo: 3, descripcion: 'Otros servicios empresariales', porcentaje: 12.00, umbral: 700.00, vigente: true, fechaVigenciaInicio: '2004-09-15' },
    '019': { codigo: '019', anexo: 3, descripcion: 'Arrendamiento de bienes muebles', porcentaje: 10.00, umbral: 700.00, vigente: true, fechaVigenciaInicio: '2004-09-15' },
    '020': { codigo: '020', anexo: 3, descripcion: 'Mantenimiento y reparación de bienes muebles', porcentaje: 12.00, umbral: 700.00, vigente: true, fechaVigenciaInicio: '2004-09-15' },
    '021': { codigo: '021', anexo: 3, descripcion: 'Movimiento de carga', porcentaje: 10.00, umbral: 700.00, vigente: true, fechaVigenciaInicio: '2004-09-15' },
    '024': { codigo: '024', anexo: 3, descripcion: 'Comisión mercantil', porcentaje: 10.00, umbral: 700.00, vigente: true, fechaVigenciaInicio: '2004-09-15' },
    '025': { codigo: '025', anexo: 3, descripcion: 'Fabricación de bienes por encargo', porcentaje: 10.00, umbral: 700.00, vigente: true, fechaVigenciaInicio: '2004-09-15' },
    '027': { codigo: '027', anexo: 3, descripcion: 'Transporte de carga (R.S. 073-2006/SUNAT)', porcentaje: 4.00, umbral: 400.00, vigente: true, fechaVigenciaInicio: '2006-05-01' },
    '037': { codigo: '037', anexo: 3, descripcion: 'Demás servicios gravados con el IGV', porcentaje: 12.00, umbral: 700.00, vigente: true, fechaVigenciaInicio: '2012-04-02' }
};

/**
 * Valida si una cadena o número está dentro del rango seguro NUMERIC(12,2)
 */
function validarRangoNumeric12_2(valor) {
    const num = Number(valor);
    if (Number.isNaN(num)) return false;
    return num >= MIN_NUMERIC_12_2 && num <= MAX_NUMERIC_12_2;
}

/**
 * Convierte un importe cualquiera (número, string, etc.) a BigInt en céntimos enteros,
 * aplicando redondeo HALF_UP en el 3er decimal si existen más de dos decimales.
 * Elimina por completo los errores de coma flotante de JavaScript (0.1 + 0.2 === 0.30).
 */
function aCentavosExacto(val) {
    if (val === null || val === undefined || val === '') return 0n;
    const str = String(val).trim();
    if (!/^-?\d+(\.\d+)?$/.test(str)) {
        const num = Number(val);
        if (Number.isNaN(num)) return 0n;
        return aCentavosExacto(num.toFixed(8));
    }
    const isNeg = str.startsWith('-');
    const clean = isNeg ? str.slice(1) : str;
    const [intPart, decPart = ''] = clean.split('.');
    let cents = BigInt(intPart) * 100n;
    const decPadded = decPart.padEnd(3, '0');
    cents += BigInt(decPadded.slice(0, 2));
    if (parseInt(decPadded[2], 10) >= 5) {
        cents += 1n;
    }
    return isNeg ? -cents : cents;
}

/**
 * Convierte céntimos enteros (BigInt o Number) a número decimal de dos decimales exactos.
 */
function deCentavosExacto(cents) {
    const bCents = BigInt(cents);
    const isNeg = bCents < 0n;
    const abs = isNeg ? -bCents : bCents;
    const intPart = abs / 100n;
    const decPart = (abs % 100n).toString().padStart(2, '0');
    return Number((isNeg ? '-' : '') + intPart.toString() + '.' + decPart);
}

/**
 * Redondeo matemático comercial HALF_UP exacto para cualquier cantidad de decimales.
 * Utiliza aritmética de enteros escalados para evitar fallos de representación flotante.
 */
function redondearComercial(valor, decimales = 2) {
    if (valor === null || valor === undefined || valor === '') return 0;
    const str = String(valor).trim();
    if (!/^-?\d+(\.\d+)?$/.test(str)) {
        const num = Number(valor);
        if (Number.isNaN(num)) return 0;
        return redondearComercial(num.toFixed(Math.max(decimales + 4, 8)), decimales);
    }
    const isNeg = str.startsWith('-');
    const clean = isNeg ? str.slice(1) : str;
    const [intPart, decPart = ''] = clean.split('.');
    const d = BigInt(decimales);
    const factor = 10n ** d;
    let units = BigInt(intPart) * factor;
    const decPadded = decPart.padEnd(decimales + 1, '0');
    if (decimales > 0) {
        units += BigInt(decPadded.slice(0, decimales));
    }
    if (parseInt(decPadded[decimales], 10) >= 5) {
        units += 1n;
    }
    const abs = units;
    const whole = abs / factor;
    const frac = decimales > 0 ? (abs % factor).toString().padStart(decimales, '0') : '';
    const resultStr = (isNeg ? '-' : '') + whole.toString() + (decimales > 0 ? '.' + frac : '');
    return Number(resultStr);
}

/**
 * Redondeo a entero HALF_UP para el SPOT (Detracciones SUNAT en Soles).
 * Según R.S. 183-2004/SUNAT art. 8, el monto de la detracción en moneda nacional se redondea
 * al entero superior si el primer decimal es >= 5, o al entero inferior si es < 5.
 */
function redondearEnteroHalfUp(valor) {
    return redondearComercial(valor, 0);
}

/**
 * Alias retrocompatible para el redondeo comercial a 2 decimales
 */
function redondear(valor, decimales = 2) {
    return redondearComercial(valor, decimales);
}

/**
 * Alias retrocompatible para conversión a centavos
 */
function aCentavos(valor) {
    return Number(aCentavosExacto(valor));
}

/**
 * Alias retrocompatible para conversión de centavos a soles
 */
function deCentavos(centavos) {
    return deCentavosExacto(centavos);
}

/**
 * Determina si un código de afectación al IGV corresponde a transferencia gratuita
 */
function esAfectacionGratuita(afectacion) {
    const cod = String(afectacion || '').trim();
    const meta = CATALOGO_AFECTACION_IGV[cod];
    if (meta) return meta.esGratuito;
    return ['11', '12', '13', '14', '15', '16', '21', '31', '32', '33', '34', '35', '36'].includes(cod);
}

/**
 * Determina si un código de afectación al IGV corresponde a operación onerosa
 */
function esAfectacionOnerosa(afectacion) {
    const cod = String(afectacion || '').trim();
    const meta = CATALOGO_AFECTACION_IGV[cod];
    if (meta) return !meta.esGratuito;
    return cod === '10' || cod === '20' || cod === '30' || cod === '17' || cod === '40';
}

/**
 * Mapea el código de afectación SUNAT al tipo de IGV numérico exigido por NubeFact
 */
function mapearTipoIgvNubefact(afectacion) {
    const cod = String(afectacion ?? '').trim();
    const meta = CATALOGO_AFECTACION_IGV[cod];
    if (meta) return meta.nubeFactTipo;

    const num = Number(cod);
    if (Number.isInteger(num) && num >= 1 && num <= 21) {
        return num;
    }
    return 1;
}

/**
 * Desglose tributario de una línea u operación onerosa gravada (18%)
 * Garantiza que: baseImponible + igv === total (sin descuadre de centavos)
 * Utiliza división exacta en centavos con redondeo HALF_UP.
 */
function calcularDesgloseGravado(totalOneroso, tasaIgv = 18) {
    const totalCents = aCentavosExacto(totalOneroso);
    if (totalCents <= 0n) {
        return { baseImponible: 0.00, igv: 0.00, total: 0.00, tasaIgv };
    }

    // Para IGV general del 18%: base = total / 1.18 = (total * 100) / 118
    // Redondeo HALF_UP al centavo exacto usando residuo entero
    const divisor = 100n + BigInt(tasaIgv);
    const numerador = totalCents * 1000n / divisor;
    const baseCents = (numerador + 5n) / 10n;
    const igvCents = totalCents - baseCents;

    return {
        baseImponible: deCentavosExacto(baseCents),
        igv: deCentavosExacto(igvCents),
        total: deCentavosExacto(totalCents),
        tasaIgv
    };
}

/**
 * Desglose tributario de una línea u operación gratuita (Catálogo 07 SUNAT)
 * 
 * Reglas tributarias:
 * 1. Total exigible al cliente: S/ 0.00 (el cliente no paga nada).
 * 2. Valor referencial: Informa el valor comercial del mercado en el comprobante (total_gratuita en NubeFact).
 * 3. IGV en comprobante: 0.00 (no cobrado al adquirente).
 * 4. Débito fiscal del emisor:
 *    - Si es gravada (códigos 11 a 16): El emisor asume y paga el IGV (18% del valor referencial) ante SUNAT.
 *    - Si es exonerada (21) o inafecta (31 a 36): No genera débito fiscal.
 */
// Supuestos legales válidos para operaciones con detracción por debajo del umbral
const MOTIVOS_EXCEPCION_DETRACCION_VALIDOS = new Set([
    'EXCEPCION_CONTRATO_SUMINISTRO_PERIODICO',
    'EXCEPCION_ACUMULACION_OPERACIONES_MISMO_CLIENTE'
]);

/**
 * Desglose tributario de una línea u operación gratuita (Catálogo 07 SUNAT)
 * 
 * Reglas tributarias:
 * 1. Total exigible al cliente: S/ 0.00 (el cliente no paga nada).
 * 2. Valor referencial: Informa el valor comercial del mercado en el comprobante (total_gratuita en NubeFact).
 * 3. IGV en comprobante: 0.00 (no cobrado al adquirente).
 * 4. Débito fiscal del emisor:
 *    - Se exige validación estricta del supuesto aplicable según Catálogo 07 de SUNAT.
 *    - Si es gravada (códigos 11 a 16): El emisor asume y declara el IGV referencial ante SUNAT,
 *      salvo bonificación comercial habitual vinculada (art. 13 num. 3 Reg. IGV).
 *    - Si es exonerada (21) o inafecta (31 a 36): No genera débito fiscal.
 */
function calcularDesgloseGratuito({
    valorReferencialUnitario,
    cantidad = 1,
    afectacion = '15',
    esBonificacionComercialVinculada = false
}) {
    const cantNum = Number(cantidad || 1);
    const codAfectacion = String(afectacion || '15').trim();
    const meta = CATALOGO_AFECTACION_IGV[codAfectacion];

    if (!meta || !meta.esGratuito) {
        const err = new Error(`SUPUESTO_GRATUITO_INVALIDO: El codigo de afectacion '${codAfectacion}' no corresponde a un supuesto valido de operacion a titulo gratuito en el Catalogo 07 de SUNAT.`);
        err.code = 'SUPUESTO_GRATUITO_INVALIDO';
        throw err;
    }

    const vUnit = redondearComercial(valorReferencialUnitario || 0, 2);
    const vTotal = redondearComercial(vUnit * cantNum, 2);

    // Ajuste de seguridad: No calcular automáticamente obligación tributaria incorrecta.
    // Si es bonificación comercial habitual vinculada a una venta gravada, no genera débito fiscal por retiro.
    const generaDebito = meta.generaDebitoEmisor && !esBonificacionComercialVinculada;
    const igvDebitoEmisor = generaDebito
        ? redondearComercial(vTotal * 0.18, 2)
        : 0.00;

    return {
        esGratuito: true,
        tipoAfectacion: meta.codigo,
        descripcionAfectacion: meta.descripcion,
        tipoIgvNubefact: meta.nubeFactTipo,
        valorReferencialUnitario: vUnit,
        valorReferencialTotal: vTotal,
        totalGratuito: vTotal,
        baseImponible: 0.00,
        igv: 0.00,
        total: 0.00,
        totalExigible: 0.00,
        generaDebitoEmisor: generaDebito,
        igvDebitoEmisor,
        esBonificacionComercialVinculada: Boolean(esBonificacionComercialVinculada),
        leyendaSunat: 'TRANSFERENCIA GRATUITA DE UN BIEN Y/O SERVICIO PRESTADO GRATUITAMENTE'
    };
}

/**
 * Valida el formato de una cuenta de detracciones del Banco de la Nación
 * Formatos habituales: 11 dígitos continuos (ej. '00000000000') o con guiones (ej. '00-000-000000').
 */
function esCuentaBancoNacionValida(cuenta) {
    if (!cuenta) return false;
    const limpia = String(cuenta).replace(/\s+|-/g, '');
    return /^\d{11}$/.test(limpia);
}

/**
 * Cálculo del SPOT (Detracciones) según normativa peruana (R.S. 183-2004/SUNAT y R.S. 073-2006/SUNAT)
 * 
 * Reglas de seguridad y validación:
 * 1. Tipo de comprobante: Solo aplica a FACTURA. Boletas de venta a consumidores finales no están afectas.
 * 2. Catálogo 54 SUNAT: Código SPOT debe ser válido y estar vigente.
 * 3. Umbrales específicos (no universales):
 *    - S/ 700.00 para servicios generales (Anexo 3, ej. 022 'Otros servicios empresariales').
 *    - S/ 400.00 para transporte de carga (Anexo 3, código 027 según R.S. 073-2006/SUNAT).
 * 4. Eliminación de bypass arbitrario: No se permite forzar detracción sin un motivo legal justificado y verificado
 *    (ej. contrato de suministro periódico o acumulación de facturas con el mismo cliente).
 * 5. Transporte de carga (027): Según R.S. 073-2006/SUNAT, la detracción se calcula sobre el mayor entre
 *    el importe de la operación y el valor referencial preliminar del MTC. Si falta información suficiente, se bloquea.
 * 6. Moneda y tipo de cambio: Si se emite en USD, se requiere tipo de cambio venta oficial SUNAT.
 * 7. Redondeo: Según el art. 8 de la R.S. 183-2004/SUNAT, el importe de la detracción en Soles se redondea
 *    al número ENTERO (0 decimales HALF_UP). Ejemplo: S/ 508 al 12% = S/ 60.96 -> S/ 61.00.
 * 8. Cuenta de detracciones: La empresa debe tener configurada su cuenta corriente del Banco de la Nación.
 */
function calcularDetraccion({
    total,
    codigoSpot,
    porcentaje,
    moneda = 'PEN',
    tipoComprobante = 'FACTURA',
    tipoOperacion = '1001',
    tipoCambio = null,
    cuentaBancoNacion = null,
    motivoExcepcion = null,
    valorReferencialMtc = null
}) {
    const totalNum = redondearComercial(total, 2);
    const mon = String(moneda || 'PEN').trim().toUpperCase();
    const tipoCmp = String(tipoComprobante || 'FACTURA').trim().toUpperCase();

    // 1. Exclusión legal: Boletas de venta no admiten detracción SPOT
    if (tipoCmp !== 'FACTURA') {
        return {
            aplica: false,
            motivoNoAplica: 'COMPROBANTE_NO_SUJETO_A_DETRACCION',
            montoDetraccion: 0.00,
            montoNetoPendiente: totalNum
        };
    }

    // 2. Validación de código SPOT SUNAT
    const codSpot = String(codigoSpot || '').trim();
    if (!codSpot) {
        return {
            aplica: false,
            motivoNoAplica: 'CODIGO_SPOT_FALTANTE',
            montoDetraccion: 0.00,
            montoNetoPendiente: totalNum
        };
    }

    const reglaSpot = CATALOGO_DETRACCION_SPOT[codSpot];
    if (!reglaSpot || !reglaSpot.vigente) {
        const err = new Error(`CODIGO_DETRACCION_INVALIDO: El codigo SPOT '${codSpot}' no existe o no esta vigente en el Catalogo 54 de SUNAT.`);
        err.code = 'CODIGO_DETRACCION_INVALIDO';
        throw err;
    }

    // 3. Porcentaje aplicable
    const porcentajeAplicar = (porcentaje !== undefined && porcentaje !== null && porcentaje !== '')
        ? redondearComercial(porcentaje, 2)
        : reglaSpot.porcentaje;

    if (porcentajeAplicar <= 0 || porcentajeAplicar > 100) {
        const err = new Error(`PORCENTAJE_DETRACCION_INVALIDO: El porcentaje de detraccion (${porcentajeAplicar}%) debe ser mayor a 0 y menor o igual a 100.`);
        err.code = 'PORCENTAJE_DETRACCION_INVALIDO';
        throw err;
    }

    // 4. Base de cálculo y moneda (conversión a PEN si es USD)
    let totalEnSoles = totalNum;
    if (mon === 'USD') {
        const tc = Number(tipoCambio);
        if (!tc || tc <= 0) {
            const err = new Error('CONFIGURACION_DETRACCION_FALTANTE: Para facturas en dolares (USD) con detraccion SPOT, se requiere el tipo de cambio oficial venta de SUNAT.');
            err.code = 'CONFIGURACION_DETRACCION_FALTANTE';
            throw err;
        }
        totalEnSoles = redondearComercial(totalNum * tc, 2);
    }

    // 5. Ajuste de seguridad: Transporte de Carga (027) exige comparar con Valor Referencial MTC
    let baseCalculoDetraccionSoles = totalEnSoles;
    if (codSpot === '027') {
        if (valorReferencialMtc !== undefined && valorReferencialMtc !== null && valorReferencialMtc !== '') {
            const valRef = Number(valorReferencialMtc);
            if (Number.isNaN(valRef) || valRef <= 0) {
                const err = new Error('CONFIGURACION_DETRACCION_FALTANTE: El valor referencial del MTC para transporte de carga debe ser un importe numerico positivo.');
                err.code = 'CONFIGURACION_DETRACCION_FALTANTE';
                throw err;
            }
            // Regla R.S. 073-2006: Se toma el mayor entre el importe de la operación y el valor referencial MTC
            baseCalculoDetraccionSoles = Math.max(totalEnSoles, redondearComercial(valRef, 2));
        } else {
            // Si la operación es transporte de carga y no se proporciona valor referencial MTC para contrastar
            const err = new Error('CONFIGURACION_DETRACCION_FALTANTE: Para el servicio de transporte de carga (codigo 027), la normativa de SUNAT (R.S. 073-2006) exige consignar el valor referencial preliminar del MTC para contrastar la base de calculo.');
            err.code = 'CONFIGURACION_DETRACCION_FALTANTE';
            throw err;
        }
    }

    // 6. Verificación de umbral y excepciones justificadas (Eliminación de forzar: true arbitrario)
    const umbral = reglaSpot.umbral;
    const superaUmbral = baseCalculoDetraccionSoles > umbral;
    let aplica = superaUmbral;

    if (!superaUmbral) {
        if (motivoExcepcion) {
            if (!MOTIVOS_EXCEPCION_DETRACCION_VALIDOS.has(motivoExcepcion)) {
                const err = new Error(`EXCEPCION_DETRACCION_NO_JUSTIFICADA: El motivo '${motivoExcepcion}' no constituye una excepcion legal valida para aplicar detraccion por debajo del umbral.`);
                err.code = 'EXCEPCION_DETRACCION_NO_JUSTIFICADA';
                throw err;
            }
            aplica = true; // Excepción legal justificada (ej. contrato de suministro continuo o acumulación de facturas)
        }
    }

    if (!aplica) {
        return {
            aplica: false,
            motivoNoAplica: `IMPORTE_NO_SUPERA_UMBRAL (S/ ${baseCalculoDetraccionSoles.toFixed(2)} <= S/ ${umbral.toFixed(2)})`,
            codigoSpot: codSpot,
            descripcionSpot: reglaSpot.descripcion,
            porcentaje: porcentajeAplicar,
            montoDetraccion: 0.00,
            montoNetoPendiente: totalNum,
            umbral,
            moneda: mon
        };
    }

    // 7. Validación de Cuenta Bancaria del Banco de la Nación
    const ctaBN = String(cuentaBancoNacion || '').trim();
    if (!ctaBN) {
        const err = new Error('CONFIGURACION_DETRACCION_FALTANTE: Falta la cuenta corriente del Banco de la Nacion para el deposito de detraccion SPOT.');
        err.code = 'CONFIGURACION_DETRACCION_FALTANTE';
        throw err;
    }
    if (!esCuentaBancoNacionValida(ctaBN)) {
        const err = new Error(`CUENTA_BANCO_NACION_INVALIDA: La cuenta corriente de detracciones '${ctaBN}' debe tener 11 digitos numericos validos del Banco de la Nacion.`);
        err.code = 'CUENTA_BANCO_NACION_INVALIDA';
        throw err;
    }

    // 8. Cálculo monetario del importe de la detracción:
    // En Soles, se redondea a número ENTERO (0 decimales HALF_UP) según R.S. 183-2004/SUNAT
    const montoCalculadoSoles = (baseCalculoDetraccionSoles * porcentajeAplicar) / 100;
    const montoDetraccionSoles = redondearEnteroHalfUp(montoCalculadoSoles);

    let montoDetraccionComprobante = montoDetraccionSoles;
    let montoNetoPendiente = redondearComercial(totalNum - montoDetraccionComprobante, 2);

    if (mon === 'USD') {
        const tc = Number(tipoCambio);
        montoDetraccionComprobante = redondearComercial(montoDetraccionSoles / tc, 2);
        montoNetoPendiente = redondearComercial(totalNum - montoDetraccionComprobante, 2);
    }

    return {
        aplica: true,
        codigoSpot: codSpot,
        descripcionSpot: reglaSpot.descripcion,
        anexo: reglaSpot.anexo,
        tipoOperacion: tipoOperacion || '1001',
        sunatTransactionNubefact: codSpot === '027' ? 31 : 30,
        porcentaje: porcentajeAplicar,
        totalEnSoles,
        baseCalculoDetraccionSoles,
        umbral,
        moneda: mon,
        montoDetraccionSoles,
        montoDetraccion: montoDetraccionComprobante,
        montoNetoPendiente,
        cuentaBancoNacion: ctaBN,
        medioPagoDetraccion: '001',
        motivoExcepcion: motivoExcepcion || null,
        referenciaLegal: codSpot === '027' ? 'R.S. 073-2006/SUNAT / R.S. 193-2020/SUNAT' : 'R.S. 183-2004/SUNAT / R.S. 193-2020/SUNAT'
    };
}

/**
 * Distribución de cuotas de crédito sin pérdida de centavos
 * Garantiza que la suma de todas las cuotas sea matemáticamente idéntica al monto a financiar.
 * El residuo de centavos se absorbe en la última cuota según estándar comercial y fiscal.
 */
function distribuirCuotasExactas({ montoTotal, numeroCuotas, fechasVencimiento = [] }) {
    const num = Math.max(1, Math.floor(Number(numeroCuotas || 1)));
    const totalCents = aCentavosExacto(montoTotal);

    if (totalCents <= 0n) {
        return [];
    }

    const nBig = BigInt(num);
    const cuotaBaseCents = totalCents / nBig;
    const residuoCents = totalCents % nBig;

    const cuotas = [];
    for (let i = 1; i <= num; i++) {
        // Asignamos el residuo a la última cuota
        const importeCents = (i === num) ? (cuotaBaseCents + residuoCents) : cuotaBaseCents;
        const fecha = fechasVencimiento[i - 1] || null;

        cuotas.push({
            numeroCuota: i,
            fechaPago: fecha,
            importe: deCentavosExacto(importeCents)
        });
    }

    return cuotas;
}

/**
 * Valida la consistencia de las cuotas de crédito contra el monto financiado
 * (considerando detracción si aplica según R.S. 193-2020/SUNAT)
 */
function validarCuotasContraNeto({ cuotas = [], total, detraccion = null }) {
    const totalNum = redondearComercial(total, 2);
    const tieneDetraccion = Boolean(detraccion && detraccion.aplica);
    const montoEsperado = tieneDetraccion
        ? redondearComercial(detraccion.montoNetoPendiente, 2)
        : totalNum;

    if (!Array.isArray(cuotas) || cuotas.length === 0) {
        return {
            valido: false,
            error: 'Una venta al credito requiere al menos una cuota.'
        };
    }

    const sumaCentavos = cuotas.reduce((acc, c) => acc + aCentavosExacto(c.importe), 0n);
    const esperadoCentavos = aCentavosExacto(montoEsperado);
    const diferencia = sumaCentavos - esperadoCentavos;

    if (diferencia !== 0n) {
        return {
            valido: false,
            error: `La suma de las cuotas (S/ ${deCentavosExacto(sumaCentavos).toFixed(2)}) no coincide con el monto pendiente a credito (S/ ${montoEsperado.toFixed(2)}).`,
            sumaCuotas: deCentavosExacto(sumaCentavos),
            montoEsperado
        };
    }

    return {
        valido: true,
        montoEsperado,
        sumaCuotas: deCentavosExacto(sumaCentavos),
        tieneDetraccion
    };
}

module.exports = {
    MAX_NUMERIC_12_2,
    MIN_NUMERIC_12_2,
    CATALOGO_AFECTACION_IGV,
    AFECTACION_IGV,
    CATALOGO_DETRACCION_SPOT,
    validarRangoNumeric12_2,
    aCentavosExacto,
    deCentavosExacto,
    redondearComercial,
    redondearEnteroHalfUp,
    redondear,
    aCentavos,
    deCentavos,
    esAfectacionGratuita,
    esAfectacionOnerosa,
    mapearTipoIgvNubefact,
    calcularDesgloseGravado,
    calcularDesgloseGratuito,
    esCuentaBancoNacionValida,
    calcularDetraccion,
    distribuirCuotasExactas,
    validarCuotasContraNeto
};
