#!/bin/bash
# =============================================================================
# SHARPpy + sharppy.plot.skew (Matplotlib) — Ubuntu 22.04+ / Debian
# Corre isto a partir da pasta python-service do repo (onde está sharppy_renderer.py)
#   cd ~/caminho/do/studio/python-service
#   chmod +x setup_vm.sh && ./setup_vm.sh
# =============================================================================
set -euo pipefail

echo "===== 1/5 Pacotes do sistema (Qt, X virtual, git para pip) ====="
sudo apt-get update
sudo apt-get install -y --no-install-recommends \
  git \
  python3 \
  python3-pip \
  python3-venv \
  xvfb \
  libqt5gui5 \
  libqt5widgets5 \
  libqt5core5a \
  libqt5dbus5 \
  libgl1-mesa-glx \
  libxcb-xinerama0 \
  libxkbcommon-x11-0 \
  libfontconfig1 \
  libdbus-1-3

echo "===== 2/5 venv em ./venv ====="
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
python3 -m venv venv
# shellcheck source=/dev/null
source venv/bin/activate

echo "===== 3/5 pip: base científica + PyQt5 ====="
pip install --upgrade pip wheel setuptools
pip install numpy pandas matplotlib metpy Pillow requests PyQt5

echo "===== 4/5 SHARPpy oficial (GitHub) ====="
pip uninstall -y sharppy 2>/dev/null || true
pip install "git+https://github.com/sharppy/sharppy.git"

echo "===== 5/5 Verificar SHARPpy sharptab + MetPy (renderizador usa estes; skew do SHARPpy é incompatível com MPL 3.10+) ====="
python3 - <<'PY'
import sys
try:
    import sharppy.sharptab.profile  # noqa: F401
    import metpy.plots  # noqa: F401
    print("OK: sharptab + MetPy disponíveis.")
except ImportError as e:
    print("FALHA:", e, file=sys.stderr)
    sys.exit(1)
PY

echo ""
echo "===== Instalação concluída ====="
echo "Ativa o venv sempre que fores testar:"
echo "  cd $SCRIPT_DIR && source venv/bin/activate"
echo ""
echo "Teste rápido (CSV com colunas: pres,hght,temp,dwpt,wdir,wspd):"
echo "  export SOUNDING_LATITUDE=-23.5"
echo "  python3 sharppy_renderer.py examples/minimal_sounding.csv /tmp/teste.png"
echo ""
echo "Integração com o site: aponta PYTHON_ENGINE_URL para o FastAPI (main.py) ou"
echo "define NATIVE_SPC_RENDER=true no serviço que corre sounding_logic.py."
