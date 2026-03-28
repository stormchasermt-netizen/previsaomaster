FROM python:3.11-bookworm

WORKDIR /app

# Instalar TODAS as bibliotecas de sistema necessárias para o PyQt5 Headless
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    wget \
    curl \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgl1-mesa-glx \
    fontconfig \
    fonts-liberation \
    fonts-dejavu \
    libfontconfig1 \
    libfontconfig1-dev \
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
    libxcb-xinerama0 \
    libxcb-icccm4 \
    libxcb-image0 \
    libxcb-keysyms1 \
    libxcb-render-util0 \
    libxcb-shape0 \
    libxcb-util1 \
    libxcb-xkb1 \
    && rm -rf /var/lib/apt/lists/*


COPY requirements.txt .

# Adicionar PyQt5 explicitamente para o PIP
RUN pip install --no-cache-dir PyQt5==5.15.10 qtpy requests flask flask-cors pandas numpy gunicorn Pillow metpy matplotlib
RUN pip install --no-cache-dir git+https://github.com/sharppy/sharppy.git

COPY . .

# Sobrescrever skew.py nativo do SHARPpy com nossa versão customizada local
RUN SITE_PACKAGES=$(python -c "import site; print(site.getsitepackages()[0])") && \
    cp custom_skew.py $SITE_PACKAGES/sharppy/viz/skew.py

# Configurações de ambiente Headless
ENV QT_API=pyqt5
ENV QT_QPA_PLATFORM=offscreen
ENV PYQTGRAPH_QT_LIB=PyQt5
ENV XDG_RUNTIME_DIR=/tmp/runtime-root
ENV PANGOCAIRO_BACKEND=fontconfig


EXPOSE 8080

CMD ["gunicorn", "--bind", "0.0.0.0:8080", "--timeout", "300", "--workers", "1", "--threads", "1", "--worker-class", "sync", "main:app"]
