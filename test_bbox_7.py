import sys
from PIL import Image

img = Image.open('T2m_new.jpg').convert('L')
data = img.load()
w, h = img.size

# We know the map starts at x=19.
# Let's scan along y=h//2 from right to left.
# The colorbar is on the right. Then there's white space, then the map right border.
for x in range(w-1, w//2, -1):
    if data[x, h//2] < 50: # black pixel
        # is it a vertical line?
        if data[x, h//2 - 50] < 50 and data[x, h//2 + 50] < 50:
            print(f"Right border at x={x}")
            break

# scan from bottom up along x=w//2
for y in range(h-1, h//2, -1):
    if data[w//2, y] < 50:
        if data[w//2 - 50, y] < 50 and data[w//2 + 50, y] < 50:
            print(f"Bottom border at y={y}")
            break
