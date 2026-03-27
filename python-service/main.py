from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import requests
import asyncio
import io

from sounding_logic import process_csv_content

app = FastAPI(title="PrevisaoMaster Sounding Engine")

# Permitir CORS para o painel frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ProcessRequest(BaseModel):
    csvUrl: str
    generateImage: bool = False
    imageTitle: str = "Previsao Master - Skew-T Profissional"
    # Latitude do site (graus). <0 = Sul — SHARPpy + MetPy flip_barb. None = inferir do CSV ou -23.5.
    latitude: Optional[float] = None
    # Imagem SHARPpy+MetPy (sharppy_renderer.py: sharptab + SkewT). Sem Qt.
    nativeSpcLayout: bool = False

class AverageProcessRequest(BaseModel):
    csvUrls: List[str]

@app.get("/")
def health_check():
    return {"status": "ok", "service": "sounding-engine"}

@app.post("/api/process-sounding")
async def process_sounding(req: ProcessRequest):
    try:
        res = requests.get(req.csvUrl, timeout=10)
        res.raise_for_status()
        csv_text = res.text
        
        result = process_csv_content(
            csv_text,
            generate_image=req.generateImage,
            image_title=req.imageTitle,
            latitude_override=req.latitude,
            native_spc=req.nativeSpcLayout,
        )
        return {"success": True, "data": result}
    except Exception as e:
        return {"success": False, "error": str(e)}

@app.post("/api/process-average-sounding")
async def process_average_sounding(req: AverageProcessRequest):
    if not req.csvUrls:
        raise HTTPException(status_code=400, detail="No URLs provided")
    
    results = []
    # Process each url sequentially for simplicity, or could use asyncio
    for url in req.csvUrls:
        try:
            res = requests.get(url, timeout=10)
            res.raise_for_status()
            r = process_csv_content(res.text)
            results.append(r)
        except Exception as e:
            print(f"Error processing {url}: {e}")
            continue
            
    if not results:
        raise HTTPException(status_code=500, detail="Failed to process any soundings")
        
    return {"success": True, "count": len(results), "data": results}
