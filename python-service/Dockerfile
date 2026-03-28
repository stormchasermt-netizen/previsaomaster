FROM python:3.9-slim-bookworm

WORKDIR /app

COPY requirements.txt .

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    wget curl libsm6 libxext6 libxrender-dev libgl1-mesa-glx \
    libfontconfig1 libx11-6 libxcb1 libxkbcommon-x11-0 libdbus-1-3 \
    libnss3 libasound2 libxtst6 libxss1 libxrandr2 \
    && rm -rf /var/lib/apt/lists/*
    
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Sobrescrever skew.py nativo do SHARPpy com nossa versão customizada local
RUN SITE_PACKAGES=$(python -c "import site; print(site.getsitepackages()[0])") && \
    cp custom_skew.py $SITE_PACKAGES/sharppy/viz/skew.py


ENV QT_API=pyqt5
ENV QT_QPA_PLATFORM=offscreen
ENV XDG_RUNTIME_DIR=/tmp/runtime-root

EXPOSE 8080

CMD ["gunicorn", "--bind", "0.0.0.0:8080", "--timeout", "120", "--workers", "1", "--threads", "8", "main:app"]
