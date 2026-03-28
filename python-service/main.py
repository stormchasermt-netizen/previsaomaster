"""
Sounding Designer v9.0 — Flask API (Native Headless SHARPpy)
"""
import os
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from sounding_logic import process_csv_content

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
STUDIO_DIR = os.path.dirname(SCRIPT_DIR)

app = Flask(__name__, static_folder=SCRIPT_DIR)
CORS(app)


@app.route('/')
def index():
    return send_from_directory(SCRIPT_DIR, 'preview.html')


@app.route('/sedenova.csv')
def sedenova():
    return send_from_directory(STUDIO_DIR, 'sedenova.csv')


@app.route('/process', methods=['POST'])
def process():
    data = request.json
    csv_text = data.get('csv', '')
    title = data.get('title', 'Sounding')
    generate_image = data.get('generate_image', True)
    layout_config = data.get('layout_config', None)

    # Nota: A v9.0 agora usa o motor nativo PyQt5
    result = process_csv_content(
        csv_text,
        image_title=title,
        generate_image=generate_image,
        layout_config=layout_config
    )

    return jsonify(result)


@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok', 'version': 'v9.0-sharppy-native'})


if __name__ == '__main__':
    # Porta 9090 para o serviço Python
    app.run(host='0.0.0.0', port=9090, debug=False)
