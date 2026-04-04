from PIL import Image
from collections import Counter
import json

img = Image.open('sample_cascavel.jpeg').convert('RGB')
colors = img.getcolors(maxcolors=1000000)
colors.sort(key=lambda x: x[0], reverse=True)
print("Top 20 colors:")
for count, color in colors[:20]:
    print(f"{color}: {count}")
