BEGIN;

-- Decisión explícita del operador. Se mantiene nullable para no inferir ni
-- alterar el significado de comprobantes históricos que nunca guardaron esta
-- elección. Los nuevos guardados siempre envían TRUE o FALSE.
ALTER TABLE fg_facturacion
    ADD COLUMN IF NOT EXISTS facturar_al_dueno_principal boolean;

COMMIT;
