import sys
import json
import pandas as pd
import numpy as np

def calculate_uv(speed, direction):
    """
    Convert wind speed and direction to U and V components.
    Speed is in knots/m/s (unit agnostic here, as long as consistent).
    Direction is in degrees (meteorological convention).
    """
    # Convert direction to radians and flip to mathematical convention
    # direction is where the wind COMES FROM
    rad = np.radians(direction)
    u = -speed * np.sin(rad)
    v = -speed * np.cos(rad)
    return u, v

def process_csv(file_path):
    try:
        # Detect delimiter and headers
        df = pd.read_csv(file_path)
        
        # Normalize column names (lowercase, no spaces)
        df.columns = [c.lower().strip() for c in df.columns]
        
        # Look for required columns
        # Priority: height, speed, direction OR u, v
        height_col = next((c for c in df.columns if 'height' in c or 'hagl' in c or 'alt' in c), None)
        speed_col = next((c for c in df.columns if 'speed' in c or 'wspd' in c or 'vel' in c or 'knots' in c), None)
        dir_col = next((c for c in df.columns if 'dir' in c or 'wdir' in c or 'rumbo' in c), None)
        u_col = next((c for c in df.columns if c == 'u'), None)
        v_col = next((c for c in df.columns if c == 'v'), None)
        
        if not height_col:
            return {"error": "Coluna de altura não encontrada (height, hagl, alt)"}
            
        data_points = []
        
        for _, row in df.iterrows():
            h = float(row[height_col])
            
            if u_col and v_col:
                u = float(row[u_col])
                v = float(row[v_col])
            elif speed_col and dir_col:
                speed = float(row[speed_col])
                direction = float(row[dir_col])
                u, v = calculate_uv(speed, direction)
            else:
                return {"error": "Colunas de vento não encontradas (speed/dir ou u/v)"}
                
            data_points.append({
                "height": h,
                "u": u,
                "v": v
            })
            
        # Optional: Sort by height
        data_points.sort(key=lambda x: x['height'])
        
        return {
            "success": True,
            "data": data_points
        }

    except Exception as e:
        return {"error": str(e)}

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No file path provided"}))
        sys.exit(1)
        
    result = process_csv(sys.argv[1])
    print(json.dumps(result))
