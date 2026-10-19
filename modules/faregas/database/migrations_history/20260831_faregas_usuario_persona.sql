-- ==============================================================================
-- Migración: 20260831_faregas_usuario_persona.sql
-- Propósito: Establecer relación formal entre fg_usuario y la tabla compartida persona
-- ==============================================================================

DO 
BEGIN
    -- 1. Crear un índice parcial para optimizar búsquedas (si no existe)
    IF NOT EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname = 'idx_fg_usuario_persona_nrodocumento'
    ) THEN
        CREATE INDEX idx_fg_usuario_persona_nrodocumento 
        ON fg_usuario (persona_nrodocumentoidentidad) 
        WHERE persona_nrodocumentoidentidad IS NOT NULL;
    END IF;

    -- 2. Agregar llave foránea (si no existe)
    -- NOTA: La tabla "persona" es una tabla compartida con FARENET.
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE c.conname = 'fk_fg_usuario_persona'
    ) THEN
        ALTER TABLE fg_usuario
        ADD CONSTRAINT fk_fg_usuario_persona
        FOREIGN KEY (persona_nrodocumentoidentidad)
        REFERENCES persona (nrodocumentoidentidad)
        ON UPDATE CASCADE
        ON DELETE SET NULL;
    END IF;
END ;
