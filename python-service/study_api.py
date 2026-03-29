import os
import sys
import requests
from flask import request, jsonify
from flask_cors import CORS

# Adicionar caminhos para garantir que main e study_logic sejam encontrados
sys.path.append(os.path.dirname(__file__))

# Importar o app Flask original para estendê-lo
from main import app, get_csv_text
from study_logic import get_study_indices

# Aplicar CORS novamente apenas por segurança
CORS(app)

@app.route('/api/study-indices', methods=['POST'])
def study_indices():
    """
    Endpoint para processamento em lote de índices estatísticos (STP, SCP, SRH) 
    para o menu Estudos.
    """
    data = request.json
    if not data:
        return jsonify({'success': False, 'error': 'Nenhum dado fornecido.'}), 400

    # Suporta processar um único URL ou uma lista
    csv_urls = data.get('csvUrls', [])
    if not csv_urls and data.get('csvUrl'):
        csv_urls = [data.get('csvUrl')]

    if not csv_urls:
        return jsonify({'success': False, 'error': 'Nenhuma URL fornecida.'}), 400

    results = []
    for url in csv_urls:
        try:
            # Reutiliza helper do main.py
            csv_text = get_csv_text({'csvUrl': url})
            if not csv_text:
                results.append({'url': url, 'success': False, 'error': 'Falha no download'})
                continue
            
            res = get_study_indices(csv_text)
            res['url'] = url
            results.append(res)
        except Exception as e:
            results.append({'url': url, 'success': False, 'error': str(e)})

    return jsonify({
        'success': True,
        'results': results
    })

if __name__ == '__main__':
    # Roda na porta 8080 (padrão do Cloud Run)
    # Em ambiente local, se main.py rodar na 9090, este rodará na 8080 ou 9091
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port, debug=False)
