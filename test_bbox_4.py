from PIL import Image

def find_right_margin(img_path, left_margin):
    img = Image.open(img_path).convert('L')
    data = img.load()
    w, h = img.size
    # Scan from right to left across the middle
    for x in range(w-1, -1, -1):
        if data[x, h//2] < 250:
            # this is the colorbar edge, not the map edge
            pass
            
    # The map has a black border. We can find the border.
    # Scan from left margin + 100 towards the right. Find where the black border ends.
    # The black border is near 0.
    for x in range(left_margin + 100, w):
        if data[x, h//2] == 0 or data[x, h//2] < 50: # border
            # keep going to find the last black pixel
            pass
            
def get_map_box(img_path):
    img = Image.open(img_path).convert('L')
    data = img.load()
    w, h = img.size
    # find left border
    left = -1
    for x in range(w//2):
        if data[x, h//2] < 50:
            left = x
            break
            
    right = -1
    for x in range(w-1, w//2, -1):
        # need to avoid colorbar. colorbar is usually right of the map
        pass
        
    return left

print(get_map_box('T2m_new.jpg'))
