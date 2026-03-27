@echo off
echo ==========================================
echo FAZENDO DEPLOY DO MOTOR PARA O CLOUD RUN
echo ==========================================
echo.
gcloud run deploy sounding-engine --source . --project studio-4398873450-7cc8f --region us-central1 --allow-unauthenticated --port 8080 --memory 1Gi --cpu 1
echo.
echo ==========================================
echo DEPLOY CONCLUIDO! PEGUE A URL ACIMA E 
echo COLOQUE NA VERCEL COMO PYTHON_ENGINE_URL
echo ==========================================
pause
