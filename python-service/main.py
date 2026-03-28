import os
import sys

# Forçar Qt Headless e Bindings ANTES de qualquer outro import
os.environ["QT_API"] = "pyqt5"
os.environ["QT_QPA_PLATFORM"] = "offscreen"
os.environ["PYQTGRAPH_QT_LIB"] = "PyQt5"
os.environ["XDG_RUNTIME_DIR"] = "/tmp/runtime-root"

# Inicializar QApplication ANTES de qualquer import do SHARPpy
# O Qt exige que QApp exista na thread principal antes de criar widgets
from PyQt5.QtWidgets import QApplication
_qapp = QApplication.instance() or QApplication(sys.argv)

import requests
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from sounding_logic import process_csv_content

app = Flask(__name__)
CORS(app)


def get_csv_text(data):
    """Extrai o texto do CSV seja via 'csv' (texto direto) ou 'csvUrl' (download)."""
    csv_text = data.get('csv', '')
    csv_url = data.get('csvUrl', '')
    
    if not csv_text and csv_url:
        try:
            resp = requests.get(csv_url, timeout=10)
            if resp.ok:
                csv_text = resp.text
        except Exception as e:
            print(f"Erro ao baixar CSV da URL: {e}")
            
    return csv_text

@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok', 'version': 'v9.1-cloud-hub'})

@app.route('/process', methods=['POST'])
@app.route('/api/process-sounding', methods=['POST'])
def process():
    data = request.json
    if not data:
        return jsonify({'success': False, 'error': 'No data provided'}), 400

    csv_text = get_csv_text(data)
    if not csv_text:
        return jsonify({'success': False, 'error': 'Nenhum conteúdo CSV encontrado (texto ou URL).'}), 400

    # Dashboard usa CamelCase, motor v9.0 usa snake_case em alguns campos
    title = data.get('imageTitle') or data.get('title') or 'Sounding'
    generate_image = data.get('generateImage') if 'generateImage' in data else data.get('generate_image', True)
    layout_config = data.get('layout_config')
    latitude = data.get('latitude')

    result = process_csv_content(
        csv_text,
        image_title=title,
        generate_image=generate_image,
        layout_config=layout_config,
        latitude=latitude
    )
    
    return jsonify(result)

@app.route('/api/process-average-sounding', methods=['POST'])
def process_average():
    """Processa uma lista de CSVs e retorna os dados brutos de cada um para o Frontend fazer a média."""
    data = request.json
    csv_urls = data.get('csvUrls', [])
    
    if not csv_urls:
        return jsonify({'success': False, 'error': 'Nenhuma lista de URLs fornecida.'}), 400

    processed_list = []
    for url in csv_urls:
        try:
            resp = requests.get(url, timeout=5)
            if resp.ok:
                # Processa apenas os dados (sem imagem para média rápida)
                res = process_csv_content(resp.text, generate_image=False)
                if res.get('success'):
                    processed_list.append(res.get('data'))
        except:
            continue

    return jsonify({'success': True, 'data': processed_list})

if __name__ == '__main__':
    # Porta padrão para execução local (Next.js route as vezes aponta para 9090)
    app.run(host='0.0.0.0', port=9090, debug=False)
