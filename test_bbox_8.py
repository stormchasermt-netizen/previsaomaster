import sys
from PIL import Image

img = Image.open('mdbz_parana_new.jpg').convert('L')
data = img.load()
w, h = img.size

for x in range(w-1, w//2, -1):
    if data[x, h//2] < 50:
        if data[x, h//2 - 50] < 50 and data[x, h//2 + 50] < 50:
            print(f"Parana Right border at x={x}")
            break

for y in range(h-1, h//2, -1):
    if data[w//2, y] < 50:
        if data[w//2 - 50, y] < 50 and data[w//2 + 50, y] < 50:
            print(f"Parana Bottom border at y={y}")
            break
