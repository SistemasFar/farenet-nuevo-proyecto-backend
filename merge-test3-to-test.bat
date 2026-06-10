@echo off
echo =====================================
echo MERGE TEST-3 -> TEST
echo =====================================

git checkout test

git pull origin test

git merge Test-3

git push origin test

pause