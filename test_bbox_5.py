from PIL import Image

def find_map_width_height(img_path, left_margin, top_margin):
    img = Image.open(img_path).convert('RGB')
    data = img.load()
    w, h = img.size
    
    # scan right from left_margin + 100 to find the right black border
    # black border is (0,0,0) or close
    right = -1
    for x in range(left_margin + 100, w):
        # average color
        c = data[x, h//2]
        if c[0] < 50 and c[1] < 50 and c[2] < 50:
            right = x
            # might be thick, find the outer edge
            while x < w and data[x, h//2][0] < 50:
                right = x
                x += 1
            break
            
    # scan down from top_margin + 100 to find the bottom black border
    bottom = -1
    for y in range(top_margin + 100, h):
        c = data[w//2, y]
        if c[0] < 50 and c[1] < 50 and c[2] < 50:
            bottom = y
            while y < h and data[w//2, y][0] < 50:
                bottom = y
                y += 1
            break
            
    return (right - left_margin, bottom - top_margin)

print("T2m_new map dims:", find_map_width_height('T2m_new.jpg', 18, 103))
print("mdbz_parana map dims:", find_map_width_height('mdbz_parana_new.jpg', 18, 344))
