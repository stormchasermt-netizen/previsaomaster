from PIL import Image
import glob
import os

files = glob.glob(r"C:\Users\Usuário\.gemini\antigravity\brain\92cd4643-0f3b-4f83-b793-4bcca74abbc2\*.jpg")
files = sorted(files, key=os.path.getmtime)
img = Image.open(files[-1])
print("Image generated, size:", img.size)
# The user's screenshot has dBZ scale at the top left
# Coordinates estimating the dbZ scale in the first map...
w, h = img.size
# Top left dbz color bar: left ~ 20px, top ~ 125px maybe
img = img.crop((0, 0, w//2, 200))

colors = []
for x in range(20, 300, 5):
    for y in range(120, 150):
        try:
            r,g,b = img.getpixel((x,y))
            if r > 0 or g > 0 or b > 0:
                hhex = f"#{r:02x}{g:02x}{b:02x}"
                if len(colors) == 0 or hhex != colors[-1]:
                    colors.append(hhex)
        except:
            pass
from collections import Counter
print([k for k,v in Counter(colors).most_common(20)])
