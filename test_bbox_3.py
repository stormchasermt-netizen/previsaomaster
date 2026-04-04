from PIL import Image

def find_left_margin(img_path):
    img = Image.open(img_path).convert('L')
    data = img.load()
    w, h = img.size
    # Scan horizontally across the middle to find the first non-white pixel
    for x in range(w):
        if data[x, h//2] < 250:
            return x
    return -1

def find_top_margin(img_path):
    img = Image.open(img_path).convert('L')
    data = img.load()
    w, h = img.size
    for y in range(h):
        if data[w//2, y] < 250:
            return y
    return -1

print("T2m_new:", find_left_margin('T2m_new.jpg'), find_top_margin('T2m_new.jpg'))
print("mdbz_parana:", find_left_margin('mdbz_parana_new.jpg'), find_top_margin('mdbz_parana_new.jpg'))
