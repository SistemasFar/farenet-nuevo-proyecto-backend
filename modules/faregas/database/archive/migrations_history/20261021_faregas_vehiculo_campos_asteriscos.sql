BEGIN;

-- Permite almacenar valores no especificados (como asteriscos *****) en campos técnicos del vehículo
ALTER TABLE fg_certificado_vehiculo ALTER COLUMN numero_cilindros TYPE character varying(50) USING numero_cilindros::text;
ALTER TABLE fg_certificado_vehiculo ALTER COLUMN cilindrada TYPE character varying(50) USING cilindrada::text;
ALTER TABLE fg_certificado_vehiculo ALTER COLUMN numero_ejes TYPE character varying(50) USING numero_ejes::text;
ALTER TABLE fg_certificado_vehiculo ALTER COLUMN numero_ruedas TYPE character varying(50) USING numero_ruedas::text;
ALTER TABLE fg_certificado_vehiculo ALTER COLUMN numero_asientos TYPE character varying(50) USING numero_asientos::text;
ALTER TABLE fg_certificado_vehiculo ALTER COLUMN numero_pasajeros TYPE character varying(50) USING numero_pasajeros::text;
ALTER TABLE fg_certificado_vehiculo ALTER COLUMN longitud TYPE character varying(50) USING longitud::text;
ALTER TABLE fg_certificado_vehiculo ALTER COLUMN ancho TYPE character varying(50) USING ancho::text;
ALTER TABLE fg_certificado_vehiculo ALTER COLUMN alto TYPE character varying(50) USING alto::text;
ALTER TABLE fg_certificado_vehiculo ALTER COLUMN peso_neto TYPE character varying(50) USING peso_neto::text;
ALTER TABLE fg_certificado_vehiculo ALTER COLUMN peso_bruto TYPE character varying(50) USING peso_bruto::text;
ALTER TABLE fg_certificado_vehiculo ALTER COLUMN carga_util TYPE character varying(50) USING carga_util::text;

ALTER TABLE fg_vehiculo ALTER COLUMN numero_cilindros TYPE character varying(50) USING numero_cilindros::text;
ALTER TABLE fg_vehiculo ALTER COLUMN cilindrada TYPE character varying(50) USING cilindrada::text;
ALTER TABLE fg_vehiculo ALTER COLUMN numero_ejes TYPE character varying(50) USING numero_ejes::text;
ALTER TABLE fg_vehiculo ALTER COLUMN numero_ruedas TYPE character varying(50) USING numero_ruedas::text;
ALTER TABLE fg_vehiculo ALTER COLUMN numero_asientos TYPE character varying(50) USING numero_asientos::text;
ALTER TABLE fg_vehiculo ALTER COLUMN numero_pasajeros TYPE character varying(50) USING numero_pasajeros::text;
ALTER TABLE fg_vehiculo ALTER COLUMN longitud TYPE character varying(50) USING longitud::text;
ALTER TABLE fg_vehiculo ALTER COLUMN ancho TYPE character varying(50) USING ancho::text;
ALTER TABLE fg_vehiculo ALTER COLUMN alto TYPE character varying(50) USING alto::text;
ALTER TABLE fg_vehiculo ALTER COLUMN peso_neto TYPE character varying(50) USING peso_neto::text;
ALTER TABLE fg_vehiculo ALTER COLUMN peso_bruto TYPE character varying(50) USING peso_bruto::text;
ALTER TABLE fg_vehiculo ALTER COLUMN carga_util TYPE character varying(50) USING carga_util::text;

COMMIT;
