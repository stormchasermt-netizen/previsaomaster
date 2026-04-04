import sys
from PIL import Image

img = Image.open('T2m_new.jpg').convert('L')
w, h = img.size
# Top-left corner of map frame is roughly at (19, 103).
# We can find the exact bottom-right corner.
# Let's save a crop of the bottom-right area so we can see it.
crop = img.crop((w-500, h-300, w, h))
crop.save('T2m_new_br.jpg')
