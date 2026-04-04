import re

with open(r'C:\Users\Usuário\Downloads\download (12)\studio\app\admin\radares\page.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# remover o bloco mal feito
pattern_remove = r"    // Listener de clique para escolher centro da imagem.*?map\.setOptions\(\{ draggableCursor: '' \}\);\s*\}\s*"
content = re.sub(pattern_remove, "", content, flags=re.DOTALL)

# Inserir um useEffect separado para o pickingImageCenter
new_effect = """
  // useEffect separado para o clique de escolha de centro da imagem
  useEffect(() => {
    if (!mapInstanceRef.current || !mapReady) return;
    const map = mapInstanceRef.current;
    
    if (pickingImageCenter) {
      map.setOptions({ draggableCursor: 'crosshair' });
    } else {
      map.setOptions({ draggableCursor: '' });
    }

    const clickListener = map.addListener('click', (e: any) => {
      if (pickingImageCenter && e.latLng) {
        setImageCenterLat(e.latLng.lat());
        setImageCenterLng(e.latLng.lng());
        setPickingImageCenter(false);
      }
    });

    return () => {
      google.maps.event.removeListener(clickListener);
    };
  }, [mapReady, pickingImageCenter]);
"""

pattern_insert = r"(  useEffect\(\(\) => \{\s*if \(\!mapInstanceRef\.current \|\| \!mapReady\) return;\s*const map = mapInstanceRef\.current;\s*if \(baseMapId === 'dark'\))"
content = re.sub(pattern_insert, new_effect + r"\n\1", content)

with open(r'C:\Users\Usuário\Downloads\download (12)\studio\app\admin\radares\page.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
