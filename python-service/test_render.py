"""Test script for Sounding Designer v9.0 — SHARPpy Native"""
import os
import sys

# Add python-service to path
sys.path.insert(0, os.path.dirname(__file__))

from sounding_logic import render_to_file

# Use sedenova.csv
csv_path = os.path.join(os.path.dirname(__file__), '..', 'sedenova.csv')
output_path = os.path.join(os.path.dirname(__file__), '..', 'preview_sharppy_native.png')

if not os.path.exists(csv_path):
    # Fallback to minimal
    csv_path = os.path.join(os.path.dirname(__file__), 'examples', 'minimal_sounding.csv')

csv_path = os.path.abspath(csv_path)
output_path = os.path.abspath(output_path)

print(f"Processando: {csv_path}")
print(f"Output: {output_path}")

with open(csv_path, 'r') as f:
    csv_text = f.read()

success = render_to_file(csv_text, output_path, title="SHARPpy Native Panel")

if success:
    print(f"✅ Preview gerado com sucesso: {output_path}")
else:
    print("❌ Erro ao gerar preview")
    # Tentativa de pegar o erro do sounding_logic se disparado
    from sounding_logic import render_to_base64
    res = render_to_base64(csv_text, "Error Debug")
    if 'error' in res:
        print(f"Traceback: {res.get('trace')}")
        print(f"Error Msg: {res.get('error')}")
