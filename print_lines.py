path = r'c:\Users\Usuário\Downloads\download (12)\studio\app\ao-vivo-2\AoVivo2Content.tsx'

with open(path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

for i in range(1450, 1490):
    print(f"{i+1}: {lines[i].rstrip()}")
