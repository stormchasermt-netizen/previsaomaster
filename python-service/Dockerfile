FROM python:3.9-slim-bookworm

WORKDIR /app

COPY requirements.txt .

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    wget curl libsm6 libxext6 libxrender-dev libgl1-mesa-glx \
    libfontconfig1 \
    && rm -rf /var/lib/apt/lists/*
    
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Sobrescrever skew.py nativo do SHARPpy com nossa versão customizada local
RUN SITE_PACKAGES=$(python -c "import site; print(site.getsitepackages()[0])") && \
    cp custom_skew.py $SITE_PACKAGES/sharppy/viz/skew.py


EXPOSE 8080

CMD ["gunicorn", "--bind", "0.0.0.0:8080", "--timeout", "120", "--workers", "1", "--threads", "8", "main:app"]
