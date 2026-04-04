from PIL import Image, ImageDraw

def draw_bbox(image_path, out_path, x_frac=(0.18142419, 0.745), y_frac=(0.11, 0.88)):
    img = Image.open(image_path)
    draw = ImageDraw.Draw(img)
    w, h = img.size
    
    x_min = w * x_frac[0]
    x_max = w * x_frac[1]
    
    y_top = h * (1 - y_frac[1])
    y_bottom = h * (1 - y_frac[0])
    
    draw.rectangle([x_min, y_top, x_max, y_bottom], outline="red", width=5)
    img.save(out_path)

draw_bbox('T2m_new.jpg', 'T2m_test.jpg')
draw_bbox('mdbz_parana_new.jpg', 'mdbz_parana_test.jpg')