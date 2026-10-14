const texto = value => String(value ?? '').trim();

const puntoVenta = facturacion => {
    const sede = texto(facturacion?.sede_nombre_snapshot);
    if (!sede) return '';
    return /^FAREGAS\s*-/i.test(sede) ? sede : `FAREGAS - ${sede}`;
};

/**
 * NubeFact no expone campos nativos separados para marca, modelo, clase,
 * motor, teléfono del cliente o código de campaña en el contrato de venta.
 * Esta representación es adicional; las fuentes estructuradas permanecen en
 * fg_facturacion, fg_certificado_vehiculo y fg_descuentocomprobante.
 */
const construirInformacionAdicional = ({
    facturacion,
    certificado = {},
    vehiculo = {},
    detalles = []
}) => {
    const lineas = [];
    const sede = puntoVenta(facturacion);
    const contactoSede = [
        texto(facturacion?.sede_telefono_snapshot) && `TELÉFONO ${texto(facturacion.sede_telefono_snapshot)}`,
        texto(facturacion?.sede_correo_snapshot) && `CORREO ${texto(facturacion.sede_correo_snapshot)}`
    ].filter(Boolean).join(' · ');
    if (sede) lineas.push(`PUNTO DE VENTA: ${sede}${contactoSede ? ` · ${contactoSede}` : ''}`);

    if (texto(facturacion?.telefono)) {
        lineas.push(`TELÉFONO DEL CLIENTE: ${texto(facturacion.telefono)}`);
    }

    const datosVehiculo = [
        texto(vehiculo.placa) && `PLACA ${texto(vehiculo.placa)}`,
        texto(vehiculo.clase || vehiculo.categoria) && `TIPO ${texto(vehiculo.clase || vehiculo.categoria)}`,
        texto(vehiculo.marca) && `MARCA ${texto(vehiculo.marca)}`,
        texto(vehiculo.modelo) && `MODELO ${texto(vehiculo.modelo)}`,
        texto(vehiculo.numero_motor) && `MOTOR ${texto(vehiculo.numero_motor)}`
    ].filter(Boolean);
    if (datosVehiculo.length > 0) lineas.push(`VEHÍCULO: ${datosVehiculo.join(' · ')}`);

    const detallePrincipal = detalles[0] || {};
    const servicio = [
        texto(detallePrincipal.codigo_sku_snapshot),
        texto(detallePrincipal.descripcion_snapshot)
    ].filter(Boolean).join(' - ');
    if (servicio) lineas.push(`SERVICIO: ${servicio}`);

    if (texto(facturacion?.codigo_descuento_snapshot)) {
        lineas.push(`CÓDIGO DE DESCUENTO: ${texto(facturacion.codigo_descuento_snapshot)}`);
    }

    if (texto(certificado.numero_certificado)) {
        lineas.push(`NÚMERO DE CERTIFICADO: ${texto(certificado.numero_certificado)}`);
    } else if (certificado.id) {
        lineas.push(`REFERENCIA FAREGAS: BORRADOR ${certificado.id}`);
    }

    return {
        texto: lineas.join('\n'),
        lineas,
        puntoVenta: sede || null
    };
};

const MATRIZ_INFORMACION_PDF = Object.freeze({
    cliente: 'NATIVO',
    fechas: 'NATIVO',
    condicionPago: 'NATIVO',
    cuotasCredito: 'NATIVO',
    placa: 'NATIVO',
    items: 'NATIVO',
    totales: 'NATIVO',
    puntoVenta: 'INFORMACION_ADICIONAL',
    telefonoCliente: 'INFORMACION_ADICIONAL',
    marcaVehiculo: 'INFORMACION_ADICIONAL',
    modeloVehiculo: 'INFORMACION_ADICIONAL',
    tipoVehiculo: 'INFORMACION_ADICIONAL',
    motorVehiculo: 'INFORMACION_ADICIONAL',
    codigoDescuento: 'INFORMACION_ADICIONAL',
    ordenTrabajo: 'NO_DISPONIBLE',
    numeroCertificadoAntesDeEmitir: 'NO_DISPONIBLE'
});

module.exports = {
    construirInformacionAdicional,
    MATRIZ_INFORMACION_PDF
};
