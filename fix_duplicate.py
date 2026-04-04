import re

path = r'c:\Users\Usuário\Downloads\download (12)\studio\app\ao-vivo-2\AoVivo2Content.tsx'

with open(path, 'r', encoding='utf-8') as f:
    text = f.read()

# We look for the start of the second gallery block which we accidentally left.
# It starts with `<div className="absolute right-3 top-3 flex items-start gap-3 pointer-events-auto sm:right-4 sm:top-4 z-50">`
target = '<div className="absolute right-3 top-3 flex items-start gap-3 pointer-events-auto sm:right-4 sm:top-4 z-50">'

parts = text.split(target)
print("Found", len(parts) - 1, "occurrences")

if len(parts) > 2:
    # We reconstruct the file omitting the last occurrence.
    # The last occurrence ends at `{/* Legenda — centro superior`
    last_part = parts[-1]
    end_index = last_part.find('{/* Legenda — centro superior')
    if end_index != -1:
        new_text = target.join(parts[:-1]) + last_part[end_index:]
        with open(path, 'w', encoding='utf-8') as f:
            f.write(new_text)
        print("Fixed duplicate Base Map block!")
    else:
        print("End of second block not found")
else:
    print("Not duplicate. Searching for generic AnimatePresence duplicates...")
