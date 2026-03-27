@echo off
echo ==========================================
echo INSTALANDO DEPENDENCIAS DO MOTOR (SHARPpy)
echo ==========================================
echo.
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
echo.
echo ==========================================
echo INICIANDO FASTAPI ENGINE NA PORTA 8080
echo ==========================================
echo.
python -m uvicorn main:app --port 8080 --reload
pause
