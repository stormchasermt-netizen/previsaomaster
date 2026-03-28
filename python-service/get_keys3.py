import os, re
d = r'C:\Users\Usuário\AppData\Local\Programs\Python\Python311\Lib\site-packages\sharppy\viz'
out = set()
for f in os.listdir(d):
    if not f.endswith('.py'): continue
    with open(os.path.join(d,f), 'r', encoding='utf-8') as fobj:
        c = fobj.read()
        for m in re.finditer(r"kwargs\['([^']+)'\]", c): out.add(m.group(1))
        for m in re.finditer(r'kwargs\.get\([\"]([^\"]+)[\"]', c): out.add(m.group(1))
        for m in re.finditer(r"kwargs\.get\([']([^']+)[']", c): out.add(m.group(1))

print("\n--- INI PREFERENCES ---")
for key in sorted(out):
    if key not in ['update_gui', 'parent']:
        print(f"{key} = True")
