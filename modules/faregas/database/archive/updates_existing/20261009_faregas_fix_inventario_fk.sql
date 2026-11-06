-- Fix para la FK de fg_inventario_cantidad_movimiento_usuario_fkey que apuntaba a la tabla usuario (legacy)
-- en lugar de fg_usuario.

ALTER TABLE fg_inventario_cantidad_movimiento 
  DROP CONSTRAINT IF EXISTS fg_inventario_cantidad_movimiento_usuario_fkey;

ALTER TABLE fg_inventario_cantidad_movimiento 
  ADD CONSTRAINT fg_inventario_cantidad_movimiento_usuario_fkey 
  FOREIGN KEY (usuario) REFERENCES fg_usuario(username) 
  ON UPDATE CASCADE ON DELETE RESTRICT;
