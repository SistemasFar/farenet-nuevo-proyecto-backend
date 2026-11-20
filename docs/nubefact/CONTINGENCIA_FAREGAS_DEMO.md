# Contingencia de emisión FAREGAS en DEMO

## Alcance y activación

El flujo opera con una base de desarrollo aislada y NubeFact DEMO. Se encuentra desactivado por defecto. El guard impide habilitarlo con la base compartida inspeccion, con el entorno fiscal PRODUCCION o con NODE_ENV=production. El archivo de configuración activo de este workspace apunta a inspeccion. Use un perfil aislado separado.

Prepare una base de desarrollo con el esquema FAREGAS vigente. Revise y aplique la sección aditiva `011_crear_fg_facturacion_contingencia.sql` de [faregas_consolidado.sql](../../modules/faregas/database/faregas_consolidado.sql) únicamente en ese destino, dentro de una transacción. La migración crea fg_facturacion_contingencia. La tabla referencia fg_certificado, fg_facturacion, fg_facturacion_intento, fg_operacion_comercial, sede y empresa. La identidad, el cliente, el correo y el envío original se conservan en el comprobante y el intento que ya existen.

Configure el ambiente y la base verificados antes de activar estos parámetros:

| Variable | Uso |
| --- | --- |
| APP_DATABASE_ENVIRONMENT | DESARROLLO o DEMO según el perfil de backend |
| NUBEFACT_ENVIRONMENT y NUBEFACT_ENABLED | DEMO y true con la cuenta DEMO configurada por empresa |
| NUBEFACT_ENVIAR_CLIENTE | false para dejar el envío bajo control del flujo |
| FAREGAS_CONTINGENCIA_ENABLED | true para activar el flujo en la base aislada |
| FAREGAS_CONTINGENCIA_DB_NAME | Nombre exacto de la base de desarrollo aislada |
| FAREGAS_CONTINGENCIA_TIPOS_DEMO | Lista de claves y modalidades validadas para pruebas, separadas por coma, por ejemplo GLP_ANUAL:ANUAL |
| FAREGAS_CONTINGENCIA_OPERADORES_DEMO | Usuarios de prueba autorizados, separados por coma, con permiso Inicio y acceso a la sede |
| CRON_ENABLED | true para habilitar la programación por hora de este flujo |
| FAREGAS_CONTINGENCIA_CORREO_URL | URL HTTPS del relay de pruebas con idempotencia persistente |
| FAREGAS_CONTINGENCIA_CORREO_TOKEN | Secreto del relay de pruebas, inyectado por el entorno |
| FAREGAS_CONTINGENCIA_CORREO_IDEMPOTENTE | true tras verificar que el relay deduplica por clave |
| FAREGAS_CONTINGENCIA_CORREO_DESTINO_DEMO | Buzón autorizado para las pruebas. Debe coincidir con el correo del comprobante sintético |
| FAREGAS_CONTINGENCIA_CORREO_XML | true para incluir el enlace XML oficial cuando exista |

El relay recibe un POST JSON con para, asunto y texto, Authorization Bearer e Idempotency-Key. Debe conservar el resultado para la misma clave, incluso tras un timeout, y responder JSON con aceptado true y una referencia estable. Use únicamente datos y direcciones de prueba. Si falta configuración o la entrega queda incierta tras el límite, el seguimiento queda pendiente de revisión. El estado ENVIADO indica confirmación de aceptación por el relay.

## Acción de emisión excepcional

El intento original debe haber reservado identidad fiscal y conservado el payload. La respuesta debe ser un fallo recuperable y la consulta posterior debe confirmar explícitamente que el documento está ausente. El expediente debe seguir en borrador, pasar la validación técnica y pertenecer a una sede y modalidad habilitadas. Quedan bloqueados los rechazos de datos, las respuestas inciertas sin resolver, los documentos confirmados y las operaciones bloqueadas.

Si NubeFact falla antes de que FAREGAS pueda reservar una identidad fiscal segura, se muestra el diagnóstico y se conserva la operación para reintentar la preparación. En ese caso la emisión excepcional sigue bloqueada.

La confirmación explícita reutiliza la transacción de emisión normal para numerar el certificado y crear el trabajo. Si hay chip, se registra mediante el servicio habitual de inventario. El comprobante queda PENDIENTE. El asistente ofrece el PDF oficial del certificado técnico mediante su acción de descarga habitual.

## Regularización y seguimiento

El cron nuevo se ejecuta al inicio de cada hora de Lima cuando se activa CRON_ENABLED. El trabajador procesa hasta diez registros. Usa reserva SQL y bloqueo asesor por obligación fiscal. El panel Facturación muestra estado, número de intentos, próximos intentos y entrega.

Cada ciclo consulta primero a NubeFact. Si encuentra la identidad fiscal esperada, reconcilia el documento. Para reenviar necesita una prueba de ausencia, fecha fiscal vigente para la prueba, estado elegible y coincidencia de serie, número, tipo, código único y emisor. La fecha y la numeración se conservan. Los intentos se registran en fg_facturacion_intento.

El reenvío espera también el plazo de reserva del último POST, con un mínimo de dos minutos. El plazo de esta implementación de prueba permite reenviar solamente durante la fecha fiscal original de Lima. Fuera de ese día se puede recuperar una aceptación remota verificable, pero un documento ausente pasa a REVISION. Este límite es un control operativo de DEMO y no representa un plazo normativo. Los casos en REVISION requieren intervención de Sistemas y Contabilidad. Facturación muestra con prioridad las regularizaciones que cruzaron la fecha fiscal.

Al alcanzar ACEPTADO y aceptada_sunat se habilita la entrega. Los errores de correo se reintentan por separado. Sin correo válido se registra SIN_CORREO. La clave de idempotencia del relay se mantiene para todos los reintentos.

## Pruebas y paso a producción

Use documentos sintéticos, un buzón autorizado y una instancia aislada. Inicie el backend con un perfil separado usando APP_ENV_FILE, y verifique el nombre de la base en el perfil antes de levantar la aplicación. El buzón configurado debe coincidir con el correo registrado en la operación sintética.

En Nuevo Certificado, guarde un expediente GLP/GNV de la modalidad autorizada. Simule un fallo temporal después de la reserva y una respuesta verificable de ausencia. Revise el seguimiento y confirme EMITIR SOLO CERTIFICADO. Descargue el PDF técnico. En Facturación, compruebe el trabajo pendiente. Restablezca la respuesta simulada y utilice Reintentar o espere el ciclo horario. Compare la identidad fiscal del intento original con la del comprobante recuperado. Verifique los estados de entrega con un correo válido autorizado, uno ausente y una falla simulada del relay.

En una base preparada para las pruebas automatizadas, configure FAREGAS_CONTINGENCIA_TEST_URL para localhost y ejecute desde farenetBackend:

    node --test modules/faregas/tests/faregas-contingencia.test.js modules/faregas/tests/faregas-contingencia.pg.test.js

 Compruebe emisión ordinaria, fallo de proveedor, autorización de certificado, rechazo definitivo, pérdida de respuesta, concurrencia, recuperación de un trabajo vencido, envío, ausencia de correo y falla de entrega. El archivo faregas-contingencia.pg.test.js limita las escrituras a un PostgreSQL local con nombre dedicado y puerto de pruebas.

Antes de proponer producción confirme por tipo y modalidad los requisitos vigentes de la certificadora, la oportunidad fiscal de emisión, las fechas y numeración aplicables, el tratamiento de incidencias y el mecanismo de alerta. Revalide con NubeFact qué respuestas acreditan inexistencia y aceptación, y con el relay cómo deduplica eventos y devuelve su referencia. La implementación mantiene el bloqueo de producción.

Fuentes normativas:

- Reglamento de Comprobantes de Pago, artículo 5. https://www.sunat.gob.pe/legislacion/comprob/regla/capituloI.pdf
- Procedimiento tributario de contingencia. https://cpe.sunat.gob.pe/informacion_general/procedimiento_contingencia
- Directiva GLP. https://www.gob.pe/institucion/mtc/normas-legales/282157-005-2007-mtc-15
- Directiva GNV. https://www.gob.pe/institucion/mtc/normas-legales/282193-001-2005-mtc-15
