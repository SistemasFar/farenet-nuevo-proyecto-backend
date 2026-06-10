@echo off
echo =====================================
echo SUBIENDO CAMBIOS A TEST-3
echo =====================================

git checkout Test-3

echo.
echo Actualizando rama local con origin/Test-3...
git pull origin Test-3

echo.
echo Agregando cambios...
git add .

set /p mensaje=Ingrese mensaje del commit: 

git commit -m "%mensaje%"

echo.
echo Subiendo cambios...
git push origin Test-3

pause