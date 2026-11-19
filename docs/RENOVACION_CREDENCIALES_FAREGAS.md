# Renovación controlada de credenciales FAREGAS

Este procedimiento renueva las 32 cuentas inventariadas de FAREGAS y excluye
obligatoriamente a `gibarra`. No cambia usernames, estados, perfiles, sedes ni
permisos. No opera sobre cuentas FARENET.

## Seguridad incorporada

- La clave del XLSX se solicita con `Read-Host -AsSecureString`; no se admite
  como argumento, no se imprime y se elimina del entorno al finalizar.
- La salida se guarda fuera del repositorio, en
  `%LOCALAPPDATA%\FAREGAS\RenovacionCredenciales`, con acceso restringido al
  usuario local, SYSTEM y administradores.
- Se exige encontrar exactamente 33 usuarios FAREGAS, una sola cuenta
  `gibarra` y 32 cuentas objetivo. Cualquier diferencia detiene la ejecución.
- `gibarra` se excluye por una condición independiente de mayúsculas y
  minúsculas tanto en el inventario como en cada `UPDATE`.
- Antes de actualizar, se crea y verifica un respaldo AES-256-GCM de los 32
  hashes anteriores y un XLSX cifrado que contiene las credenciales nuevas.
- Las contraseñas se generan una vez con `crypto.randomBytes`, son únicas y se
  validan con la política oficial de FAREGAS.
- Las actualizaciones y la revocación de sesiones se ejecutan en una sola
  transacción serializable. Un fallo provoca `ROLLBACK`.
- El XLSX final se vuelve a generar y verificar después del `COMMIT`. Si esto
  falla, el XLSX cifrado preparado antes del cambio permanece disponible para
  recuperar las credenciales asignadas.
- El respaldo y el XLSX utilizan la misma clave local introducida por el
  administrador. La clave no se almacena en los archivos ni en los logs.

## 1. Verificación previa de solo lectura

Desde PowerShell, en el backend:

```powershell
cd 'C:\Users\Sistemas2\Desktop\farenet nuevo proyecto\farenetBackend'
.\scripts\faregas-renovar-credenciales.ps1 -Mode Preflight
```

Debe informar 33 usuarios, 32 objetivos, una cuenta excluida `gibarra`, 25
activos, 8 inactivos y cero escrituras.

## 2. Prueba local sin PostgreSQL

```powershell
.\scripts\faregas-renovar-credenciales.ps1 -Mode SelfTest
```

Esta prueba usa usuarios ficticios, valida el generador, crea un XLSX ficticio,
lo cifra con Excel, comprueba que una clave incorrecta sea rechazada, verifica
la clave correcta y elimina los archivos de prueba.

## 3. Ejecución, solo después de autorización final

```powershell
.\scripts\faregas-renovar-credenciales.ps1 -Mode Execute -Administrador '<username-administrador>'
```

El script solicita dos entradas locales:

1. La frase exacta `RENOVAR 32 CUENTAS FAREGAS EXCLUYENDO GIBARRA`.
2. Una clave de apertura de al menos 16 caracteres, ingresada dos veces con
   eco deshabilitado.

No escriba la clave en el comando, el código, un archivo de configuración ni
el chat.

Al terminar, la carpeta privada contendrá:

- `faregas_credenciales_renovadas.xlsx`: inventario cifrado de 33 usuarios.
- `faregas_auth_backup.enc`: respaldo cifrado de los 32 hashes anteriores.
- `resultado_renovacion.json`: metadatos, conteos y SHA-256 sin contraseñas.

La fila de `gibarra` tiene la contraseña vacía y el resultado
`EXCLUIDO — SIN MODIFICACIONES`.

## 4. Verificación posterior

- Confirmar que el XLSX abre únicamente con la clave local.
- Confirmar que contiene 33 filas y 32 contraseñas únicas.
- Confirmar que `gibarra` permanece excluido.
- Revisar `resultado_renovacion.json` y sus SHA-256.
- La comprobación automática compara cada contraseña generada con el hash
  persistido mediante bcrypt. No inicia sesiones en nombre de usuarios reales.
- Una prueba real de login debe realizarla cada titular o requerir autorización
  separada y específica.

## 5. Recuperación

La restauración devuelve únicamente los hashes anteriores de las 32 cuentas.
No reactiva sesiones revocadas y vuelve a excluir a `gibarra`.

```powershell
.\scripts\faregas-renovar-credenciales.ps1 `
  -Mode Restore `
  -Administrador '<username-administrador>' `
  -BackupPath '<ruta-al-faregas_auth_backup.enc>'
```

Exige la frase local `RESTAURAR HASHES FAREGAS EXCLUYENDO GIBARRA` y la misma
clave utilizada para cifrar el respaldo. Esta acción también requiere una
autorización expresa antes de ejecutarse sobre la base compartida.
