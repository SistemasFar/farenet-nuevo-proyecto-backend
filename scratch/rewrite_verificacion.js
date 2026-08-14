const fs = require('fs');

const path = 'c:/Users/Sistemas2/Desktop/farenet nuevo proyecto/farenetFrontend/src/modules/faregas/views/NuevoCertificado/components/NuevoCertificado/VerificacionStep.tsx';

const content = `
import React, { useState, useEffect } from 'react';
import { CheckCircle2, AlertCircle, Loader2, XCircle, FileCheck2 } from 'lucide-react';
import type { TipoCertificadoFaregas } from '@/types/faregas';
import { faregasCertificadosApi } from '@/services/faregas/faregas-certificados.api';
import Swal from 'sweetalert2';

interface VerificacionStepProps {
  certificadoId?: number;
  onEmisionExitosa?: () => void;
  tipoCertificado: TipoCertificadoFaregas;
  formCaja: any;
  formVehiculo: any;
  formPropietario: any;
  formGlp: any;
  formGnv: any;
  formConformidad: any;
  pagosAgregados: any[];
  formFacturacion: any;
}

export function VerificacionStep({
  certificadoId,
  onEmisionExitosa,
  tipoCertificado,
  formCaja,
  formVehiculo,
  formPropietario,
  formGlp,
  formGnv,
  formConformidad,
  pagosAgregados,
  formFacturacion
}: VerificacionStepProps) {

  const totalPagado = pagosAgregados.reduce((sum, p) => sum + parseFloat(p.importe), 0);

  const [isValidating, setIsValidating] = useState(false);
  const [validacionResult, setValidacionResult] = useState<{ valido: boolean; errores: any[] } | null>(null);
  const [isEmitting, setIsEmitting] = useState(false);
  const [emisionResult, setEmisionResult] = useState<{ numero_certificado: string; fecha_emision: string; estado: string } | null>(null);

  const validar = async () => {
    if (!certificadoId) return;
    setIsValidating(true);
    try {
      const response = await faregasCertificadosApi.validarEmision(certificadoId);
      setValidacionResult(response.data);
    } catch (e: any) {
      console.error(e);
      Swal.fire('Error', 'No se pudo validar el certificado: ' + e.message, 'error');
    } finally {
      setIsValidating(false);
    }
  };

  useEffect(() => {
    if (certificadoId && !emisionResult) {
      validar();
    }
  }, [certificadoId, emisionResult]);

  const handleEmitir = () => {
    if (!certificadoId || !validacionResult?.valido || isEmitting) return;

    Swal.fire({
      title: '¿Confirmas la emisión del certificado?',
      text: 'Esta acción asignará el número correlativo definitivo y no debe ejecutarse por error.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#16a34a',
      cancelButtonColor: '#64748b',
      confirmButtonText: 'EMITIR',
      cancelButtonText: 'CANCELAR'
    }).then(async (result) => {
      if (result.isConfirmed) {
        setIsEmitting(true);
        try {
          const response = await faregasCertificadosApi.emitirCertificado(certificadoId);
          setEmisionResult({
            numero_certificado: response.data.numero_certificado,
            fecha_emision: new Date().toISOString(),
            estado: 'EMITIDO'
          });
          Swal.fire('¡Éxito!', 'Certificado emitido correctamente', 'success');
          if (onEmisionExitosa) onEmisionExitosa();
        } catch (e: any) {
          console.error(e);
          let msg = 'Ocurrió un error inesperado.';
          if (e.message === 'NO_VALIDO_PARA_EMISION') {
            msg = 'El borrador ya no es válido para emisión. Los datos podrían haber cambiado.';
            validar();
          } else if (e.message === 'NO_EXISTE_RANGO_ACTIVO') {
            msg = 'No existe un rango de correlativos activo para esta sede y tipo de certificado.';
          } else if (e.message === 'RANGO_AGOTADO') {
            msg = 'El rango de correlativos asignado se encuentra agotado.';
          } else if (e.message === 'ESTADO_INVALIDO' || e.message === 'CERTIFICADO_NOT_FOUND') {
            msg = 'El certificado ya no se encuentra en estado BORRADOR o no existe.';
          } else if (e.status === 403) {
            msg = 'Acceso denegado a esta sede/certificado.';
          }
          Swal.fire('Error de Emisión', msg, 'error');
        } finally {
          setIsEmitting(false);
        }
      }
    });
  };

  if (!certificadoId) {
    return (
      <div className="p-8 text-center text-red-500 font-bold bg-red-50 rounded-xl border border-red-200">
        Error: No se ha detectado el ID del borrador. No se puede validar la emisión.
      </div>
    );
  }

  // Agrupar errores por sección
  const erroresPorSeccion = validacionResult?.errores.reduce((acc: any, err: any) => {
    const sec = err.seccion || 'general';
    if (!acc[sec]) acc[sec] = [];
    acc[sec].push(err);
    return acc;
  }, {});

  if (emisionResult) {
    return (
      <div className="space-y-6 animate-in zoom-in duration-500">
        <div className="bg-gradient-to-r from-green-50 to-emerald-50 border-2 border-green-200 rounded-2xl p-10 text-center shadow-lg">
          <div className="w-20 h-20 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-6 shadow-xl shadow-green-200">
            <FileCheck2 className="w-10 h-10 text-white" />
          </div>
          <h2 className="text-3xl font-black text-green-800 uppercase tracking-tight mb-2">
            Certificado Emitido
          </h2>
          <p className="text-green-600 font-medium mb-8">
            La emisión se completó de manera exitosa y el correlativo fue asignado.
          </p>

          <div className="bg-white rounded-xl border border-green-100 p-6 inline-block min-w-[300px] shadow-sm">
            <div className="space-y-4 text-left">
              <div>
                <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Número de Certificado</div>
                <div className="text-2xl font-black text-[#052a79]">{emisionResult.numero_certificado}</div>
              </div>
              <div className="grid grid-cols-2 gap-6 pt-4 border-t border-slate-100">
                <div>
                  <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Estado</div>
                  <div className="text-sm font-bold text-green-600 bg-green-50 px-2 py-1 rounded inline-block">{emisionResult.estado}</div>
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Fecha Emisión</div>
                  <div className="text-sm font-bold text-slate-700">{new Date(emisionResult.fecha_emision).toLocaleDateString()}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      
      {/* HEADER DINÁMICO */}
      <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-slate-200 pb-4 gap-4">
        <div className="flex items-center gap-3">
          <div className="bg-blue-100 p-2.5 rounded-xl">
            <CheckCircle2 className="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-slate-800">Verificación y Emisión</h3>
            <p className="text-sm text-slate-500">
              Revise que todos los datos sean correctos antes de emitir.
            </p>
          </div>
        </div>
        
        {isValidating ? (
           <div className="flex items-center gap-2 text-blue-600 bg-blue-50 px-4 py-2 rounded-lg border border-blue-200 font-medium">
             <Loader2 className="w-5 h-5 animate-spin" />
             Validando información del certificado...
           </div>
        ) : validacionResult?.valido ? (
          <button 
            onClick={handleEmitir}
            disabled={isEmitting}
            className={\`\${isEmitting ? 'bg-green-400 cursor-not-allowed' : 'bg-green-600 hover:bg-green-700 shadow-lg'} text-white px-6 py-3 rounded-xl font-bold transition flex items-center gap-2 uppercase tracking-wide\`}
          >
            {isEmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
            {isEmitting ? 'EMITIENDO...' : 'EMITIR CERTIFICADO'}
          </button>
        ) : (
          <button 
            onClick={validar}
            className="bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 px-4 py-2 rounded-lg font-bold transition flex items-center gap-2 text-sm"
          >
            <AlertCircle className="w-4 h-4" /> Volver a Validar
          </button>
        )}
      </div>

      {/* ERRORES DE VALIDACIÓN */}
      {!isValidating && validacionResult && !validacionResult.valido && (
        <div className="bg-red-50 border-l-4 border-red-500 p-6 rounded-r-xl shadow-sm">
          <div className="flex items-start gap-3 mb-4">
            <XCircle className="w-6 h-6 text-red-500 mt-0.5" />
            <div>
              <h4 className="text-lg font-bold text-red-800">Borrador Incompleto</h4>
              <p className="text-sm text-red-600">El certificado tiene datos faltantes o incorrectos y no puede emitirse.</p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            {Object.keys(erroresPorSeccion).map(sec => (
              <div key={sec} className="bg-white p-4 rounded-lg border border-red-100 shadow-sm">
                <h5 className="font-bold text-red-700 uppercase tracking-wide text-xs mb-3 border-b border-red-50 pb-2">{sec}</h5>
                <ul className="space-y-2">
                  {erroresPorSeccion[sec].map((err: any, idx: number) => (
                    <li key={idx} className="flex items-start gap-2 text-sm text-slate-700">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-400 mt-1.5 flex-shrink-0"></span>
                      <span>{err.mensaje}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ESTADO LISTO */}
      {!isValidating && validacionResult?.valido && (
        <div className="bg-green-50 border border-green-200 p-4 rounded-xl flex items-center gap-3 text-green-700">
          <CheckCircle2 className="w-6 h-6 flex-shrink-0 text-green-500" />
          <span className="font-bold">CERTIFICADO LISTO PARA EMITIR. Todo está en orden.</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 opacity-80 pointer-events-none">
        
        {/* RESUMEN GENERAL Y VEHÍCULO */}
        <div className="space-y-6">
          <div className="bg-white border-2 border-slate-200 rounded-2xl p-6">
            <h4 className="text-sm font-bold text-slate-700 uppercase tracking-wider mb-4 pb-2 border-b">1. Resumen General</h4>
            <div className="grid grid-cols-2 gap-y-3 text-sm">
              <div className="text-slate-500 font-semibold">Tipo:</div>
              <div className="font-bold text-slate-800 uppercase">{tipoCertificado}</div>
              <div className="text-slate-500 font-semibold">Placa:</div>
              <div className="font-bold text-[#052a79] text-lg uppercase">{formCaja.placa}</div>
              <div className="text-slate-500 font-semibold">Categoría:</div>
              <div className="font-bold text-slate-800 uppercase">{formCaja.categoria}</div>
              <div className="text-slate-500 font-semibold">Estado:</div>
              <div className="font-bold text-slate-500 uppercase bg-slate-100 px-2 py-0.5 rounded inline-block w-max">BORRADOR</div>
            </div>
          </div>

          <div className="bg-white border-2 border-slate-200 rounded-2xl p-6">
            <h4 className="text-sm font-bold text-slate-700 uppercase tracking-wider mb-4 pb-2 border-b">2. Datos Básicos del Vehículo</h4>
            <div className="grid grid-cols-2 gap-y-3 text-sm">
              <div className="text-slate-500 font-semibold">Marca:</div>
              <div className="font-bold text-slate-800 uppercase">{formVehiculo.marca || '-'}</div>
              <div className="text-slate-500 font-semibold">Modelo:</div>
              <div className="font-bold text-slate-800 uppercase">{formVehiculo.modelo || '-'}</div>
              <div className="text-slate-500 font-semibold">VIN:</div>
              <div className="font-bold text-slate-800 uppercase">{formVehiculo.nroSerie || '-'}</div>
              <div className="text-slate-500 font-semibold">N° Motor:</div>
              <div className="font-bold text-slate-800 uppercase">{formVehiculo.nroMotor || '-'}</div>
              <div className="text-slate-500 font-semibold">Combustible:</div>
              <div className="font-bold text-slate-800 uppercase">{formVehiculo.combustible || '-'}</div>
            </div>
          </div>

          {/* DATOS ESPECÍFICOS SEGÚN TIPO */}
          <div className="bg-blue-50 border-2 border-blue-100 rounded-2xl p-6">
            <h4 className="text-sm font-bold text-[#052a79] uppercase tracking-wider mb-4 pb-2 border-b border-blue-200">
              3. Especificaciones {tipoCertificado}
            </h4>
            
            {tipoCertificado === 'GLP' && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-y-3 text-sm">
                  <div className="text-slate-500 font-semibold">Propietario:</div>
                  <div className="font-bold text-slate-800 uppercase">{formPropietario.nombre || '-'}</div>
                  <div className="text-slate-500 font-semibold">Vigencia Hasta:</div>
                  <div className="font-bold text-slate-800 uppercase">{formGlp.fechaVigencia || '-'}</div>
                </div>
                <div className="text-xs bg-white p-3 rounded border border-blue-100">
                  <div className="font-bold text-slate-700 mb-1">Componentes:</div>
                  <div className="text-slate-600">CILINDRO: {formGlp.cilindroMarca || '-'} | SERIE: {formGlp.cilindroSerie || '-'}</div>
                  <div className="text-slate-600">REGULADOR: {formGlp.reguladorMarca || '-'} | SERIE: {formGlp.reguladorSerie || '-'}</div>
                </div>
              </div>
            )}

            {tipoCertificado === 'GNV' && (
              <div className="grid grid-cols-2 gap-y-3 text-sm">
                <div className="text-slate-500 font-semibold">Vigencia Hasta:</div>
                <div className="font-bold text-slate-800 uppercase">{formGnv.fechaVigencia || '-'}</div>
                <div className="text-slate-500 font-semibold">Observaciones:</div>
                <div className="font-bold text-slate-800 uppercase">{formGnv.observaciones || 'NINGUNA'}</div>
              </div>
            )}

            {tipoCertificado === 'CONFORMIDAD' && (
              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-y-3">
                  <div className="text-slate-500 font-semibold">Razón Social:</div>
                  <div className="font-bold text-slate-800 uppercase">{formConformidad.razonSocial || '-'}</div>
                  <div className="text-slate-500 font-semibold">Tipo:</div>
                  <div className="font-bold text-slate-800 uppercase">{formConformidad.tipoConformidad || '-'}</div>
                </div>
                <div className="text-xs bg-white p-3 rounded border border-blue-100">
                  <div className="font-bold text-slate-700 mb-1">Motivo:</div>
                  <div className="text-slate-600 uppercase">{formConformidad.motivo || '-'}</div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* FACTURACIÓN Y PAGOS */}
        <div className="space-y-6">
          <div className="bg-white border-2 border-slate-200 rounded-2xl p-6">
            <h4 className="text-sm font-bold text-slate-700 uppercase tracking-wider mb-4 pb-2 border-b">4. Facturación</h4>
            <div className="grid grid-cols-2 gap-y-3 text-sm">
              <div className="text-slate-500 font-semibold">Comprobante:</div>
              <div className="font-bold text-slate-800 uppercase">{formFacturacion.tipoDocFac || '-'}</div>
              <div className="text-slate-500 font-semibold">DNI/RUC:</div>
              <div className="font-bold text-slate-800 uppercase">{formFacturacion.nroDocFac || '-'}</div>
              <div className="text-slate-500 font-semibold">Cliente:</div>
              <div className="font-bold text-slate-800 uppercase col-span-2">{formFacturacion.razonSocialFac || '-'}</div>
              <div className="text-slate-500 font-semibold">Dirección:</div>
              <div className="font-bold text-slate-800 uppercase col-span-2">{formFacturacion.direccionFac || '-'}</div>
            </div>
          </div>

          <div className="bg-white border-2 border-slate-200 rounded-2xl p-6">
            <h4 className="text-sm font-bold text-slate-700 uppercase tracking-wider mb-4 pb-2 border-b">5. Pago Registrado</h4>
            {pagosAgregados.length === 0 ? (
              <div className="flex items-center gap-2 text-amber-600 bg-amber-50 p-3 rounded-lg border border-amber-200">
                <AlertCircle className="w-5 h-5" />
                <span className="text-sm font-bold">Aviso: No hay pagos registrados.</span>
              </div>
            ) : (
              <div className="space-y-4 text-sm">
                <div className="space-y-2">
                  {pagosAgregados.map((p, i) => (
                    <div key={i} className="flex justify-between items-center bg-slate-50 p-2 rounded">
                      <span className="font-semibold text-slate-600">{p.tipo} {p.tarjetaKey}</span>
                      <span className="font-bold text-slate-800">S/ {parseFloat(p.importe).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
                <div className="flex justify-between items-center pt-2 border-t">
                  <span className="font-bold text-slate-700 uppercase">Total Pagado:</span>
                  <span className="font-black text-[#052a79] text-lg">S/ {totalPagado.toFixed(2)}</span>
                </div>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
`;

fs.writeFileSync(path, content);
console.log('VerificacionStep updated');
