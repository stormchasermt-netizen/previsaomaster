import React, { useRef, useState, useEffect } from 'react';
import ReactCrop, { Crop, PixelCrop, PercentCrop, centerCrop, makeAspectCrop } from 'react-image-crop';
import { Trash2, Save, Crop as CropIcon, Upload, Image as ImageIcon, Bookmark, BookmarkCheck } from 'lucide-react';
import clsx from 'clsx';
const PRESET_STORAGE_KEY = 'crop_preset_default';

// Helper to generate canvas preview and return base64
async function canvasPreview(image: HTMLImageElement, crop: PixelCrop) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2d context');
  
  const scaleX = image.naturalWidth / image.width;
  const scaleY = image.naturalHeight / image.height;
  // Use 1 for pixel ratio to save space, unless on very high DPI screens where we might cap it
  const pixelRatio = 1; 
  
  let targetWidth = Math.floor(crop.width * scaleX * pixelRatio);
  let targetHeight = Math.floor(crop.height * scaleY * pixelRatio);

  // Resize constraints - HD (1920px) for better model visibility
  const MAX_DIMENSION = 1920;
  if (targetWidth > MAX_DIMENSION || targetHeight > MAX_DIMENSION) {
      const ratio = targetWidth / targetHeight;
      if (targetWidth > targetHeight) {
          targetWidth = MAX_DIMENSION;
          targetHeight = Math.floor(MAX_DIMENSION / ratio);
      } else {
          targetHeight = MAX_DIMENSION;
          targetWidth = Math.floor(MAX_DIMENSION * ratio);
      }
  }
  
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  
  ctx.imageSmoothingQuality = 'high'; // HD output for model detail
  
  const cropX = crop.x * scaleX;
  const cropY = crop.y * scaleY;
  const cropW = crop.width * scaleX;
  const cropH = crop.height * scaleY;
  
  ctx.drawImage(
    image,
    cropX, cropY, cropW, cropH,
    0, 0, targetWidth, targetHeight
  );
  
  return new Promise<string>((resolve) => {
    canvas.toBlob((blob) => {
      if (!blob) return;
      const reader = new FileReader();
      reader.readAsDataURL(blob);
      reader.onloadend = () => {
        resolve(reader.result as string);
      };
    }, 'image/jpeg', 0.98); // HD quality for better model visibility
  });
}

// Default crop helper (starts with a centered 80% box, but free aspect)
function centerDefaultCrop(mediaWidth: number, mediaHeight: number) {
  return centerCrop(
    makeAspectCrop(
      { unit: '%', width: 80 },
      mediaWidth / mediaHeight, // Use image's own aspect ratio initially
      mediaWidth,
      mediaHeight
    ),
    mediaWidth,
    mediaHeight
  );
}

type ImageLayerEditorProps = {
  onSave: (imageUrl: string) => void;
  /** Chave para preset (ex: "layerId_timeSlot"). Se não informada, usa preset global. */
  presetKey?: string;
};

function loadPreset(key: string): PercentCrop | null {
  try {
    const stored = localStorage.getItem(key);
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    if (parsed && typeof parsed.x === 'number' && typeof parsed.width === 'number') {
      return { ...parsed, unit: '%' as const };
    }
  } catch {}
  return null;
}

function savePreset(key: string, crop: PercentCrop) {
  try {
    localStorage.setItem(key, JSON.stringify({ x: crop.x, y: crop.y, width: crop.width, height: crop.height }));
  } catch (e) {
    console.error('Erro ao salvar preset:', e);
  }
}

export function ImageLayerEditor({ onSave, presetKey }: ImageLayerEditorProps) {
  const [originalImageSrc, setOriginalImageSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState<Crop>();
  const [completedCrop, setCompletedCrop] = useState<PixelCrop>();
  const imgRef = useRef<HTMLImageElement>(null);
  const [uploading, setUploading] = useState(false);
  const storageKey = presetKey ? `crop_preset_${presetKey}` : PRESET_STORAGE_KEY;
  const [hasPreset, setHasPreset] = useState(false);

  useEffect(() => {
    setHasPreset(!!localStorage.getItem(storageKey));
  }, [storageKey]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const reader = new FileReader();
      reader.addEventListener('load', () => {
        setOriginalImageSrc(reader.result?.toString() || null);
      });
      reader.readAsDataURL(e.target.files[0]);
    }
  };

  const onImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const { width, height } = e.currentTarget;
    const saved = loadPreset(storageKey);
    if (saved) {
      setCrop(saved);
    } else {
      setCrop(centerDefaultCrop(width, height));
    }
  };

  const handleSavePreset = () => {
    if (crop && crop.unit === '%') {
      savePreset(storageKey, crop as PercentCrop);
      setHasPreset(true);
    } else if (completedCrop && imgRef.current) {
      const { width, height } = imgRef.current;
      const percentCrop: PercentCrop = {
        unit: '%',
        x: (completedCrop.x / width) * 100,
        y: (completedCrop.y / height) * 100,
        width: (completedCrop.width / width) * 100,
        height: (completedCrop.height / height) * 100,
      };
      savePreset(storageKey, percentCrop);
      setHasPreset(true);
    }
  };

  const handleApplyPreset = () => {
    const saved = loadPreset(storageKey);
    if (saved) setCrop(saved);
  };

  const handleSaveFinal = async () => {
    if (completedCrop && imgRef.current) {
        setUploading(true);
        try {
            const base64 = await canvasPreview(imgRef.current, completedCrop);
            onSave(base64);
            handleClear();
        } catch (e) {
            console.error(e);
        } finally {
            setUploading(false);
        }
    }
  };

  const handleClear = () => {
    setOriginalImageSrc(null);
    setCrop(undefined);
    setCompletedCrop(undefined);
  };

  return (
    <div className="space-y-6 flex flex-col items-center justify-center min-h-[400px]">
      
      {!originalImageSrc ? (
         <div className="w-full max-w-md border-2 border-dashed border-slate-700 rounded-xl p-12 text-center hover:bg-slate-800/50 transition-colors group">
            <label htmlFor="img-upload" className="cursor-pointer flex flex-col items-center justify-center gap-4">
                <div className="h-16 w-16 bg-slate-800 rounded-full flex items-center justify-center group-hover:bg-cyan-500/20 transition-colors">
                    <Upload className="w-8 h-8 text-slate-400 group-hover:text-cyan-400"/>
                </div>
                <div className="text-slate-300 font-medium">
                    Carregar Modelo (ERA5/GFS)
                </div>
                <div className="text-xs text-slate-500">
                    Clique para selecionar. Recorte livre.
                </div>
                <input id="img-upload" type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
            </label>
         </div>
      ) : (
        <div className="w-full flex flex-col items-center gap-6">
            <div className="bg-slate-950 p-4 rounded-lg border border-white/10 w-full max-w-3xl flex flex-col items-center">
                <div className="flex justify-between items-center w-full mb-4 flex-wrap gap-2">
                    <h3 className="text-white font-medium flex items-center gap-2">
                        <CropIcon size={16} className="text-cyan-400"/> Ajustar Recorte (Livre)
                    </h3>
                    <div className="flex items-center gap-2 flex-wrap">
                        {crop && (
                            <div className="text-xs font-mono text-slate-400 bg-slate-900/80 px-2 py-1 rounded border border-white/5" title="Coordenadas do recorte (percentual da imagem)">
                                {crop.unit === '%' ? (
                                    <>X: {crop.x.toFixed(1)}% · Y: {crop.y.toFixed(1)}% · L: {crop.width.toFixed(1)}% · A: {crop.height.toFixed(1)}%</>
                                ) : (
                                    <>X: {Math.round(crop.x)}px · Y: {Math.round(crop.y)}px · L: {Math.round(crop.width)}px · A: {Math.round(crop.height)}px</>
                                )}
                            </div>
                        )}
                        <button 
                            onClick={handleSavePreset}
                            className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1 border border-cyan-500/30 px-2 py-1 rounded hover:bg-cyan-500/10"
                            title="Salvar posição atual como padrão. Toda nova edição virá com este recorte."
                        >
                            <Bookmark size={12} /> Salvar como padrão
                        </button>
                        <button 
                            onClick={handleApplyPreset}
                            disabled={!hasPreset}
                            className={clsx(
                                "text-xs flex items-center gap-1 border px-2 py-1 rounded",
                                hasPreset 
                                    ? "text-emerald-400 hover:text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/10"
                                    : "text-slate-500 border-slate-600/50 cursor-not-allowed"
                            )}
                            title={hasPreset ? "Aplicar recorte padrão salvo" : "Salve um padrão primeiro com 'Salvar como padrão'"}
                        >
                            <BookmarkCheck size={12} /> Usar padrão
                        </button>
                        <button 
                            onClick={handleClear}
                            className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1"
                        >
                            <Trash2 size={12} /> Descartar
                        </button>
                    </div>
                </div>

                <div className="relative border border-white/5 shadow-2xl bg-black">
                    <ReactCrop
                        crop={crop}
                        onChange={(_, percentCrop) => setCrop(percentCrop)}
                        onComplete={(c) => setCompletedCrop(c)}
                        className="max-h-[60vh]"
                        keepSelection
                        ruleOfThirds
                    >
                        <img
                            ref={imgRef}
                            alt="Crop target"
                            src={originalImageSrc}
                            onLoad={onImageLoad}
                            style={{ maxHeight: '60vh', maxWidth: '100%', objectFit: 'contain' }}
                        />
                    </ReactCrop>
                </div>
                
                <p className="text-xs text-slate-500 mt-2">
                    A área selecionada será exportada em HD (max 1920px) para melhor visualização.
                </p>
            </div>

            <button 
               onClick={handleSaveFinal} 
               disabled={uploading || !completedCrop}
               className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-lg font-bold py-3 px-12 rounded-full shadow-lg shadow-emerald-900/20 flex items-center gap-2 transition-all hover:scale-105"
            >
                {uploading ? 'Processando...' : <><Save className="h-5 w-5" /> Salvar Camada</>}
            </button>
        </div>
      )}
    </div>
  );
}
