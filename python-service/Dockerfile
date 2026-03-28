FROM debian:bookworm-slim

# Evitar prompts durante a instalação
ENV DEBIAN_FRONTEND=noninteractive

WORKDIR /app

# Instalar Python, Pip e PyQt5 nativos do sistema
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-setuptools \
    python3-pyqt5 \
    git \
    wget \
    curl \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgl1-mesa-glx \
    libfontconfig1 \
    libx11-6 \
    libxcb1 \
    libxkbcommon-x11-0 \
    libdbus-1-3 \
    libnss3 \
    libasound2 \
    libxtst6 \
    libxss1 \
    libxrandr2 \
    libegl1 \
    libopengl0 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

# Instalar dependências via Pip garantindo que usem o Python3 do sistema
RUN pip3 install --no-cache-dir --break-system-packages -r requirements.txt

COPY . .

# Sobrescrever skew.py nativo do SHARPpy com nossa versão customizada local
RUN SITE_PACKAGES=$(python3 -c "import site; print(site.getsitepackages()[0])") && \
    cp custom_skew.py $SITE_PACKAGES/sharppy/viz/skew.py

# Configurações de ambiente para o motor v9.2
ENV QT_API=pyqt5
ENV QT_QPA_PLATFORM=offscreen
ENV PYQTGRAPH_QT_LIB=PyQt5
ENV XDG_RUNTIME_DIR=/tmp/runtime-root

EXPOSE 8080

# Executar usando o Python3 do sistema
CMD ["python3", "-m", "gunicorn", "--bind", "0.0.0.0:8080", "--timeout", "120", "--workers", "1", "--threads", "8", "main:app"]
