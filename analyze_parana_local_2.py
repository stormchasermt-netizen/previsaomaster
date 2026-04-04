from PIL import Image
import os
import glob

vars = ['mdbz', 'T2m', 'Td_2m', 'Thetae_2m', 'hrt01km', 'hrt03km', 'mucape', 'mlcape', 'sblcl', 'mllr', 'scp', 'stp']

print('--- PARANA ---')
for v in vars:
    filename = f"./temp_{v}.jpg"
    if not os.path.exists(filename): continue
    
    img = Image.open(filename)
    width, height = img.size
    pixels = img.load()

    black_cols = []
    for x in range(width):
        black_count = sum(1 for y in range(height // 4, 3 * height // 4) if pixels[x, y][0] < 50 and pixels[x, y][1] < 50 and pixels[x, y][2] < 50)
        if black_count > (height // 2) * 0.8:
            black_cols.append(x)

    left_border = min(black_cols) if black_cols else 0
    right_border = max([c for c in black_cols if c < width - 50]) if black_cols else width - 1

    black_rows = []
    for y in range(height):
        black_count = sum(1 for x in range(left_border + 1, right_border) if pixels[x, y][0] < 50 and pixels[x, y][1] < 50 and pixels[x, y][2] < 50)
        if black_count > (right_border - left_border) * 0.8:
            black_rows.append(y)

    top_border = min(black_rows) if black_rows else 0
    bottom_border = max(black_rows) if black_rows else height - 1

    print(f'{v}: topPx={top_border}, bottomPx={height - 1 - bottom_border}, leftPx={left_border}, rightPx={width - 1 - right_border}, natW={width}, natH={height}')

