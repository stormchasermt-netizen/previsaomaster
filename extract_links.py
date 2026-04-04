import re
content = open(r'C:\Users\Usuário\.cursor\projects\c-Users-Usu-rio-Downloads-download-12-studio\agent-tools\0ef30680-25e9-401e-93f1-c02ac2880297.txt', encoding='utf-8').read()
matches = re.findall(r'<a href="([^"]+)/">', content)
brazil = [m for m in matches if m.startswith('BR')]
print('Total radars:', len(matches))
print('Brazil radars:', brazil)
