FROM python:3.9-slim

WORKDIR /app

COPY requirements.txt .

RUN apt-get update && apt-get install -y gcc r-base libcairo2-dev libpango1.0-dev xdg-utils && \
    pip install --no-cache-dir -r requirements.txt && \
    Rscript -e "install.packages('thundeR', repos='http://cran.rstudio.com/')" && \
    apt-get purge -y build-essential && apt-get autoremove -y

COPY . .

EXPOSE 8080

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
