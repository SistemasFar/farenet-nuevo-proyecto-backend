const fs = require('fs');

const path = 'c:/Users/Sistemas2/Desktop/farenet nuevo proyecto/farenetFrontend/src/modules/faregas/views/NuevoCertificado/NuevoCertificadoView.tsx';
let code = fs.readFileSync(path, 'utf8');

// 1. Add states if missing
if (!code.includes('const [titulares, setTitulares]')) {
    code = code.replace(
        'const [currentStepIndex, setCurrentStepIndex] = useState(0);',
        `const [currentStepIndex, setCurrentStepIndex] = useState(0);\n  const [titulares, setTitulares] = useState<any[]>([]);\n  const [catalogoVerificaciones, setCatalogoVerificaciones] = useState<any[]>([]);\n  const [talleres, setTalleres] = useState<any[]>([]);`
    );
}

if (!code.includes('const [isEmitido')) {
    code = code.replace(
        'const [isCreatingDraft, setIsCreatingDraft] = useState(false);',
        'const [isCreatingDraft, setIsCreatingDraft] = useState(false);\n  const [isEmitido, setIsEmitido] = useState(false);'
    );
}

// 2. Add saving logic for step 2
// The git diff had:
/*
+          placa: formCaja.placa,
+          categoria: formCaja.categoria,
...
+        });
+
+        // Guardar titulares secuencialmente
...
+        // Si todo ok, avanzamos
+        if (currentStepIndex < STEPS.length - 1) {
+          setCurrentStepIndex(currentStepIndex + 1);
+        }
+
+      } catch (err: any) {
+        Swal.fire('Error', err.message || 'Error guardando datos', 'error');
+      } finally {
+        setIsSavingStep2(false);
+      }
+    } else if (currentStepIndex < STEPS.length - 1) {
       setCurrentStepIndex(currentStepIndex + 1);
     }
*/
const blockToReplace = `          placa: formCaja.placa,
          categoria: formCaja.categoria
        });
        
        if (currentStepIndex < STEPS.length - 1) {
          setCurrentStepIndex(currentStepIndex + 1);
        }
      } catch (err: any) {
        Swal.fire('Error', err.message || 'Error guardando datos', 'error');
      } finally {
        setIsSavingStep2(false);
      }
    } else if (currentStepIndex < STEPS.length - 1) {
      setCurrentStepIndex(currentStepIndex + 1);
    }`;

const replacementBlock = `          placa: formCaja.placa,
          categoria: formCaja.categoria,
          clase: formVehiculo.clase,
          marca: formVehiculo.marca,
          modelo: formVehiculo.modelo,
          version: formVehiculo.version,
          anioFabricacion: formVehiculo.anioFabricacion,
          anioModelo: formVehiculo.anioModelo,
          vin: formVehiculo.vin,
          serieChasis: formVehiculo.serieChasis,
          numeroMotor: formVehiculo.numeroMotor,
          combustible: formVehiculo.combustible,
          color: formVehiculo.color,
          carroceria: formVehiculo.carroceria,
          numeroCilindros: formVehiculo.numeroCilindros,
          cilindrada: formVehiculo.cilindrada,
          numeroEjes: formVehiculo.numeroEjes,
          numeroRuedas: formVehiculo.numeroRuedas,
          numeroAsientos: formVehiculo.numeroAsientos,
          numeroPasajeros: formVehiculo.numeroPasajeros,
          longitud: formVehiculo.longitud,
          ancho: formVehiculo.ancho,
          alto: formVehiculo.alto,
          pesoNeto: formVehiculo.pesoNeto,
          pesoBruto: formVehiculo.pesoBruto,
          cargaUtil: formVehiculo.cargaUtil,
          potencia: formVehiculo.potencia,
          formulaRodante: formVehiculo.formulaRodante
        });

        // Guardar titulares secuencialmente
        for (let i = 0; i < titulares.length; i++) {
          const t = titulares[i];
          const payloadTitular = {
            orden: t.orden,
            clienteId: t.clienteId,
            tipoDocumento: t.tipoDocumento,
            nroDocumento: t.nroDocumento,
            nombreRazonSocial: t.nombreRazonSocial,
            direccion: t.direccion
          };

          if (t.titularId) {
            await faregasCertificadosApi.actualizarTitular(certificadoId, t.titularId, payloadTitular);
          } else {
            const resTitular = await faregasCertificadosApi.crearTitular(certificadoId, payloadTitular);
            if (resTitular.ok && resTitular.data?.id) {
              setTitulares(prev => prev.map(pt => pt._uuid === t._uuid ? { ...pt, titularId: resTitular.data.id } : pt));
            }
          }
        }

        // Guardar datos especificos segun tipo de certificado
        if (formCaja.tipoCertificado === 'GNV_ANUAL') {
          await faregasCertificadosApi.guardarGnv(certificadoId, {
            tallerAutorizadoId: formGnv.tallerAutorizadoId,
            vigenciaHasta: formGnv.fechaVigencia
          });
          if (formGnv.verificaciones && formGnv.verificaciones.length > 0) {
            await faregasCertificadosApi.guardarVerificacionesGnv(certificadoId, {
              verificaciones: formGnv.verificaciones
            });
          }
        } else if (formCaja.tipoCertificado === 'GLP_ANUAL') {
          await faregasCertificadosApi.guardarGlp(certificadoId, {
            tallerAutorizadoId: formGlp.tallerAutorizadoId,
            expedienteTecnico: formGlp.expedienteTecnico,
            vigenciaHasta: formGlp.fechaVigencia
          });
          if (formGlp.componentes && formGlp.componentes.length > 0) {
            await faregasCertificadosApi.guardarComponentesGlp(certificadoId, {
              componentes: formGlp.componentes
            });
          }
          if (formGlp.verificaciones && formGlp.verificaciones.length > 0) {
            await faregasCertificadosApi.guardarVerificacionesGlp(certificadoId, {
              verificaciones: formGlp.verificaciones
            });
          }
        } else if (formCaja.tipoCertificado === 'CONFORMIDAD') {
          await faregasCertificadosApi.guardarConformidad(certificadoId, {
            tipoConformidad: formConformidad.tipoConformidad,
            tipoTramite: formConformidad.tipoTramite,
            caracteristicaRegistrable: formConformidad.caracteristicaRegistrable,
            motivo: formConformidad.motivo,
            descripcion: formConformidad.descripcion,
            usoOriginalVehiculo: formConformidad.usoOriginalVehiculo
          });
        }

        if (currentStepIndex < STEPS.length - 1) {
          setCurrentStepIndex(currentStepIndex + 1);
        }
      } catch (err: any) {
        Swal.fire('Error', err.message || 'Error guardando datos', 'error');
      } finally {
        setIsSavingStep2(false);
      }
    } else if (currentStepIndex < STEPS.length - 1) {
      setCurrentStepIndex(currentStepIndex + 1);
    }`;

code = code.replace(blockToReplace, replacementBlock);

// 3. Update VehiculoStep props
const vehiculoStepBlock = `<VehiculoStep
            tipoCertificado={formCaja.tipoCertificado as TipoCertificadoFaregas}
            formVehiculo={formVehiculo}
            setFormVehiculo={setFormVehiculo}
            formPropietario={formPropietario}
            setFormPropietario={setFormPropietario}
            formGlp={formGlp}
            setFormGlp={setFormGlp}
            formGnv={formGnv}
            setFormGnv={setFormGnv}
            formConformidad={formConformidad}
            setFormConformidad={setFormConformidad}
          />`;
const newVehiculoStepBlock = `<VehiculoStep
            tipoCertificado={formCaja.tipoCertificado as TipoCertificadoFaregas}
            formVehiculo={formVehiculo}
            setFormVehiculo={setFormVehiculo}
            formPropietario={formPropietario}
            setFormPropietario={setFormPropietario}
            formGlp={formGlp}
            setFormGlp={setFormGlp}
            formGnv={formGnv}
            setFormGnv={setFormGnv}
            formConformidad={formConformidad}
            setFormConformidad={setFormConformidad}
            titulares={titulares}
            setTitulares={setTitulares}
            catalogoVerificaciones={catalogoVerificaciones}
            talleres={talleres}
          />`;

code = code.replace(vehiculoStepBlock, newVehiculoStepBlock);

// 4. Update VerificacionStep props
const verificacionStepBlock = `<VerificacionStep
            tipoCertificado={formCaja.tipoCertificado as TipoCertificadoFaregas}
            formCaja={formCaja}
            formVehiculo={formVehiculo}
            formPropietario={formPropietario}
            formGlp={formGlp}
            formGnv={formGnv}
            formConformidad={formConformidad}
            pagosAgregados={pagosAgregados}
            formFacturacion={formFacturacion}
          />`;
const newVerificacionStepBlock = `<VerificacionStep
            certificadoId={certificadoId || (id ? parseInt(id) : undefined)}
            onEmisionExitosa={() => setIsEmitido(true)}
            tipoCertificado={formCaja.tipoCertificado as TipoCertificadoFaregas}
            formCaja={formCaja}
            formVehiculo={formVehiculo}
            formPropietario={formPropietario}
            formGlp={formGlp}
            formGnv={formGnv}
            formConformidad={formConformidad}
            pagosAgregados={pagosAgregados}
            formFacturacion={formFacturacion}
          />`;

code = code.replace(verificacionStepBlock, newVerificacionStepBlock);

// 5. Update footer again manually since we reverted
const footerRegex = /\{\/\* FOOTER ACTIONS \*\/\}.*?(?=\n    <\/div>\n  \);\n\})/s;
const newFooter = \`{/* FOOTER ACTIONS */}
      <div className="bg-slate-50 border-t border-slate-200 p-4 flex justify-between items-center">
        {currentStepIndex > 0 ? (
          <button
            type="button"
            onClick={() => { if(!isEmitido) { if (currentStepIndex > 0) setCurrentStepIndex(currentStepIndex - 1); } }}
            className={\\\`rounded-lg border px-5 py-2 text-xs font-bold transition \${isEmitido ? "border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}\\\`}
            disabled={isEmitido}
          >
            Atrás
          </button>
        ) : <div></div>}

        <div className="flex flex-col items-end gap-1.5">
          {currentStepIndex === STEPS.length - 1 ? (
            <div className="flex gap-3">
              {isEmitido ? (
                <button type="button" onClick={() => navigate('/faregas/inicio')} className="bg-green-600 text-white rounded-lg px-6 py-2.5 text-xs font-black transition shadow-sm hover:bg-green-700">VOLVER A INICIO</button>
              ) : (
                <button type="button" onClick={irSiguientePaso} className="bg-gold-3d hover:-translate-y-0.5 rounded-lg px-6 py-2.5 text-xs font-black transition shadow-sm">FINALIZAR</button>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={irSiguientePaso}
              disabled={isCreatingDraft || isSavingStep2 || (currentStepIndex === 0 && (!formCaja.tipoCertificado || !formCaja.placa || (!formCaja.categoria && !vehiculoEncontrado)))}
              className={\\\`flex items-center gap-2 rounded-lg px-6 py-2.5 text-xs font-black transition shadow-sm
                \${(isCreatingDraft || isSavingStep2 || (currentStepIndex === 0 && (!formCaja.tipoCertificado || !formCaja.placa || (!formCaja.categoria && !vehiculoEncontrado))))
                  ? 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none'
                  : 'bg-gold-3d hover:-translate-y-0.5'
                }\\\`}
            >
              {isCreatingDraft || isSavingStep2 ? 'Procesando...' : 'Siguiente Paso'}
            </button>
          )}
        </div>
      </div>\`;

code = code.replace(footerRegex, newFooter);

fs.writeFileSync(path, code);
console.log('Restored and patched');
