import sys
import os
from study_logic import get_study_indices

# CSV de exemplo (Holanda, MS - 2023 - adaptado para teste)
test_csv = """Pressure,Altitude,Temperature,Dew_point,Wind_direction,Wind_speed
1000,100,20,15,360,10
950,500,18,14,350,15
900,1000,16,13,330,25
850,1500,14,12,310,35
800,2000,12,10,290,45
700,3000,5,0,270,55
500,5600,-15,-25,270,75
"""

def test_sh_indices():
    print("Iniciando teste de índices SH...")
    res = get_study_indices(test_csv)
    if res['success']:
        print("Sucesso!")
        print(f"Indices: {res['indices']}")
        # No SH, com vento girando de 360 -> 270 (horário/veering p/ SH), 
        # o SRH deve ser detectado e retornado como positivo pelo nosso negador.
        srh1 = res['indices']['srh_1']
        print(f"SRH 1km: {srh1}")
        if srh1 > 0:
            print("Verificação: SRH Ciclônico (SH) convertido para escala positiva. [OK]")
        else:
            print("Aviso: SRH 1km não é positivo. Verifique perfil de vento.")
    else:
        print(f"Erro no teste: {res['error']}")
        print(res['trace'])

if __name__ == "__main__":
    test_sh_indices()
