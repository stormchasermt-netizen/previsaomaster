path = r'c:\Users\Usuário\Downloads\download (12)\studio\app\ao-vivo-2\AoVivo2Content.tsx'

with open(path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Remove lines 1473 to 1526 (0-indexed 1472 to 1526)
new_lines = lines[:1473] + lines[1527:]

with open(path, 'w', encoding='utf-8') as f:
    f.writelines(new_lines)
