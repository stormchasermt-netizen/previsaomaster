#!/bin/bash
# =============================================================================
# SHARPpy + viz.spc (layout SPC) do zero — Ubuntu 22.04+ / Debian
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

echo "===== 4/5 SHARPpy oficial (inclui sharppy.viz.spc — layout SPC) ====="
pip uninstall -y sharppy 2>/dev/null || true
pip install "git+https://github.com/sharppy/sharppy.git"

echo "===== 5/5 Verificar módulo SPC ====="
python3 - <<'PY'
import sys
try:
    import sharppy.viz.spc as spc
    print("OK: sharppy.viz.spc carregado — SPCWindo disponível.")
except ImportError as e:
    print("FALHA:", e, file=sys.stderr)
    sys.exit(1)
PY

echo ""
echo "===== Instalação concluída ====="
echo "Ativa o venv sempre que fores testar:"
echo "  cd $SCRIPT_DIR && source venv/bin/activate"
echo ""
echo "Teste rápido (precisas de um CSV com colunas: pres,hght,temp,dwpt,wdir,wspd):"
echo "  export SOUNDING_LATITUDE=-23.5"
echo "  xvfb-run -a python3 sharppy_renderer.py teu_ficheiro.csv saida.png"
echo ""
echo "Integração com o site: aponta PYTHON_ENGINE_URL para o FastAPI (main.py) ou"
echo "define NATIVE_SPC_RENDER=true no serviço que corre sounding_logic.py."
