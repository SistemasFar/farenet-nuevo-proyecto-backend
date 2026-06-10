@echo off
echo =====================================
echo MERGE TEST-2 -> TEST 3
echo =====================================

git checkout Test-3

git pull origin Test-3

git fetch origin

git merge origin/Test-2

pause