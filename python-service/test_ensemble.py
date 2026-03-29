import sys
import os
import json
import base64

# Adicionar o diretório atual ao path para importar sounding_logic
sys.path.append(os.getcwd())

from sounding_logic import render_ensemble_hodograph

# Criar perfis fakes
profile1 = [
    {'height': 0, 'u': 0, 'v': 0},
    {'height': 3000, 'u': 20, 'v': 20},
    {'height': 6000, 'u': 40, 'v': 10},
    {'height': 12000, 'u': 60, 'v': 0},
]
profile2 = [
    {'height': 0, 'u': 5, 'v': -5},
    {'height': 3000, 'u': 15, 'v': 25},
    {'height': 6000, 'u': 35, 'v': 15},
    {'height': 12000, 'u': 55, 'v': 5},
]

profiles = [profile1, profile2]

print("Iniciando teste de render_ensemble_hodograph...")
res = render_ensemble_hodograph(profiles)

if res['status'] == 'success':
    print("Sucesso! Salvando imagem...")
    header, data = res['base64_img'].split(',')
    with open("test_ensemble_output.png", "wb") as fh:
        fh.write(base64.b64decode(data))
    print("Imagem salva em test_ensemble_output.png")
else:
    print("Erro no teste:")
    print(res.get('error'))
    if 'traceback' in res:
        print(res['traceback'])
