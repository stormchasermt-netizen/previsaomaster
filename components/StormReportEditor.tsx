import React, { useEffect, useRef, useState } from 'react';
import { StormReport, RiskPolygon } from '@/lib/types';
import { MapPin, Trash2, Save, X, PenTool, Eraser, Maximize2, Minimize2, ChevronLeft, PlusCircle, Globe, Layers, Minus, Hexagon, Scissors } from 'lucide-react';
import clsx from 'clsx';
import { MAP_STYLE_DARK } from '@/lib/constants';

// Declare google & turf for TS
declare const google: any;
declare const turf: any;

interface StormReportEditorProps {
    reports: StormReport[];
    onUpdate: (reports: StormReport[]) => void;
    riskPolygons: RiskPolygon[];
    onUpdatePolygons: (polys: RiskPolygon[]) => void;
}

// Map Types
const MAP_TYPE_SATELLITE = 'hybrid';
const MAP_TYPE_DARK = 'roadmap';

// Risk Colors
const RISK_LEVELS = [
    { level: 1, label: 'Nível 1 (Marginal)', color: '#facc15' },
    { level: 2, label: 'Nível 2 (Ligera)', color: '#fb923c' },
    { level: 3, label: 'Nível 3 (Moderada)', color: '#ef4444' },
    { level: 4, label: 'Nível 4 (Alta)', color: '#d946ef' },
];

export function StormReportEditor({ reports, onUpdate, riskPolygons, onUpdatePolygons }: StormReportEditorProps) {
    const mapContainerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<any>(null);
    const drawingManagerRef = useRef<any>(null);
    
    // Map State References
    const markersRef = useRef<any[]>([]);
    const polylinesRef = useRef<any[]>([]);
    const polygonsRef = useRef<any[]>([]); // Visual polygons on map
    const tempTrackRef = useRef<any>(null);

    // Brazil GeoJSON cache
    const brazilFeatureRef = useRef<any>(null);

    // UI State
    const [mapReady, setMapReady] = useState(false); // New state to track initialization
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isMinimized, setIsMinimized] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [mapMode, setMapMode] = useState<'hybrid' | 'dark'>('hybrid');
    
    const [editingIndex, setEditingIndex] = useState<number | null>(null);
    const [tempReport, setTempReport] = useState<Partial<StormReport>>({ type: 'tornado' });
    const [isDrawingTrack, setIsDrawingTrack] = useState(false);

    // Polygon Drawing State
    const [activeTool, setActiveTool] = useState<'marker' | 'polygon'>('marker');
    const [currentRiskLevel, setCurrentRiskLevel] = useState<1|2|3|4>(1);

    // REFS FOR EVENT LISTENERS (Fix Stale Closures)
    const isDrawingTrackRef = useRef(isDrawingTrack);
    const activeToolRef = useRef(activeTool);
    const isModalOpenRef = useRef(isModalOpen);
    const riskPolygonsRef = useRef(riskPolygons);
    const currentRiskLevelRef = useRef(currentRiskLevel);

    // Sync Refs
    useEffect(() => { isDrawingTrackRef.current = isDrawingTrack; }, [isDrawingTrack]);
    useEffect(() => { activeToolRef.current = activeTool; }, [activeTool]);
    useEffect(() => { isModalOpenRef.current = isModalOpen; }, [isModalOpen]);
    useEffect(() => { riskPolygonsRef.current = riskPolygons; }, [riskPolygons]);
    useEffect(() => { currentRiskLevelRef.current = currentRiskLevel; }, [currentRiskLevel]);

    // Fetch Brazil GeoJSON for clipping
    useEffect(() => {
        fetch('https://raw.githubusercontent.com/codeforamerica/click_that_hood/master/public/data/brazil-states.geojson')
            .then(r => r.json())
            .then(data => {
                // Combine all states into one huge polygon/multipolygon for Brazil
                try {
                    const combined = turf.combine(data);
                    brazilFeatureRef.current = combined.features[0]; // Store the Brazil feature
                } catch(e) {
                    console.error("Failed to process Brazil GeoJSON", e);
                }
            })
            .catch(e => console.error("Could not fetch Brazil boundaries", e));
    }, []);

    // Initialize Map & Drawing Manager
    useEffect(() => {
        let isMounted = true;

        const initMap = async () => {
            if (!mapContainerRef.current) return;

            try {
                const { Map } = await google.maps.importLibrary("maps");
                await google.maps.importLibrary("marker");
                const { DrawingManager } = await google.maps.importLibrary("drawing");

                if (!isMounted) return;

                const map = new Map(mapContainerRef.current, {
                    center: { lat: -25, lng: -55 },
                    zoom: 4,
                    mapTypeId: MAP_TYPE_SATELLITE,
                    disableDefaultUI: true,
                    zoomControl: true,
                    styles: mapMode === 'dark' ? MAP_STYLE_DARK : [],
                    tilt: 0
                });

                // Initialize Drawing Manager
                const drawingManager = new DrawingManager({
                    drawingMode: null,
                    drawingControl: false,
                    polygonOptions: {
                        fillColor: RISK_LEVELS[0].color,
                        fillOpacity: 0.4,
                        strokeWeight: 2,
                        clickable: true,
                        editable: true,
                        zIndex: 10 // Default base zIndex
                    }
                });
                drawingManager.setMap(map);
                drawingManagerRef.current = drawingManager;

                // Handle Polygon Completion
                google.maps.event.addListener(drawingManager, 'polygoncomplete', async (poly: any) => {
                    // 1. Convert Google Polygon to Turf Polygon
                    const path = poly.getPath().getArray().map((p: any) => [p.lng(), p.lat()]);
                    path.push(path[0]); // Close ring
                    const turfPoly = turf.polygon([path]);

                    // 2. Clip with Brazil if available
                    let finalPoly = turfPoly;
                    if (brazilFeatureRef.current) {
                        try {
                             const clipped = turf.intersect(turfPoly, brazilFeatureRef.current);
                             if (clipped) {
                                 finalPoly = clipped;
                             }
                        } catch(e) {
                            console.warn("Clipping failed, using original.", e);
                        }
                    }

                    // 3. Convert back to Google format & Save
                    const coords = turf.getCoords(finalPoly);
                    const type = turf.getType(finalPoly);
                    
                    const newPolygons: RiskPolygon[] = [];
                    const currentLevel = currentRiskLevelRef.current; // Use Ref
                    
                    if (type === 'Polygon') {
                         const points = coords[0].map((p: any) => ({ lat: p[1], lng: p[0] }));
                         newPolygons.push({
                             id: Math.random().toString(36).substr(2, 9),
                             type: 'geral',
                             level: currentLevel as any,
                             points
                         });
                    } else if (type === 'MultiPolygon') {
                        coords.forEach((polyCoords: any) => {
                            const points = polyCoords[0].map((p: any) => ({ lat: p[1], lng: p[0] }));
                            newPolygons.push({
                                id: Math.random().toString(36).substr(2, 9),
                                type: 'geral',
                                level: currentLevel as any,
                                points
                            });
                        });
                    }

                    // Use Ref to get current list so we don't overwrite previous adds in this session
                    onUpdatePolygons([...riskPolygonsRef.current, ...newPolygons]);
                    
                    // Remove the drawing draft from map (we will re-render clean from state)
                    poly.setMap(null);
                    
                    // Exit drawing mode
                    drawingManager.setDrawingMode(null);
                    setActiveTool('marker');
                });

                // Standard Click Handler for Reports
                map.addListener('click', (e: any) => {
                    // Always check current refs
                    if (drawingManager.getDrawingMode() !== null) return; 

                    if (!e.latLng) return;
                    const lat = e.latLng.lat();
                    const lng = e.latLng.lng();

                    if (isDrawingTrackRef.current) {
                        setTempReport(prev => {
                            const currentTrack = prev.track || [];
                            // Connect to origin point if it's the first track point
                            const startPoint = (currentTrack.length === 0 && prev.lat && prev.lng)
                                ? [{ lat: prev.lat, lng: prev.lng }]
                                : currentTrack;
                            return { ...prev, track: [...startPoint, { lat, lng }] };
                        });
                    } else {
                        if (!isModalOpenRef.current && activeToolRef.current === 'marker') {
                            setEditingIndex(null);
                            setTempReport({ lat, lng, type: 'tornado', rating: 'F0', track: [] });
                            setIsModalOpen(true);
                            setIsMinimized(false);
                        }
                    }
                });

                mapRef.current = map;
                setMapReady(true); // Signal that map is ready for rendering
            } catch (error) {
                console.error("Error loading Google Maps:", error);
            }
        };

        initMap();

        return () => { isMounted = false; };
    }, []); // Run once

    // Update Drawing Manager Options when Risk Level Changes
    useEffect(() => {
        if (drawingManagerRef.current) {
            const color = RISK_LEVELS.find(r => r.level === currentRiskLevel)?.color;
            drawingManagerRef.current.setOptions({
                polygonOptions: {
                    fillColor: color,
                    fillOpacity: 0.4,
                    strokeColor: color,
                    strokeWeight: 2,
                    clickable: false,
                    editable: false,
                    zIndex: currentRiskLevel * 10 // Apply correct zIndex while drawing
                }
            });
        }
    }, [currentRiskLevel]);

    // Toggle Drawing Mode
    useEffect(() => {
        if (drawingManagerRef.current) {
            drawingManagerRef.current.setDrawingMode(activeTool === 'polygon' ? google.maps.drawing.OverlayType.POLYGON : null);
        }
    }, [activeTool]);

    // Sync Map Mode changes
    useEffect(() => {
        if (!mapRef.current) return;
        mapRef.current.setMapTypeId(mapMode === 'dark' ? 'roadmap' : 'hybrid');
        mapRef.current.setOptions({ styles: mapMode === 'dark' ? MAP_STYLE_DARK : [] });
    }, [mapMode]);

    // Render Polygons from State
    useEffect(() => {
        if (!mapRef.current || !mapReady) return; // Wait for mapReady
        
        polygonsRef.current.forEach(p => p.setMap(null));
        polygonsRef.current = [];

        // Sort just in case to ensure draw order matches z-index logic conceptually
        const sortedPolygons = [...riskPolygons].sort((a, b) => a.level - b.level);

        sortedPolygons.forEach(polyData => {
            const color = RISK_LEVELS.find(r => r.level === polyData.level)?.color || '#fff';
            
            // Higher level = Higher Z-Index to overlay correctly
            const zIndex = polyData.level * 10;

            const polygon = new google.maps.Polygon({
                paths: polyData.points,
                strokeColor: color,
                strokeOpacity: 0.8,
                strokeWeight: 2,
                fillColor: color,
                fillOpacity: 0.35,
                map: mapRef.current,
                zIndex: zIndex
            });
            
            // Polygon click handler
            polygon.addListener('click', (e: any) => {
                // IMPORTANT: If tool is MARKER, behave like adding a report, NOT deleting
                if (activeToolRef.current === 'marker') {
                    if (!e.latLng) return;
                    const lat = e.latLng.lat();
                    const lng = e.latLng.lng();

                    if (isDrawingTrackRef.current) {
                        setTempReport(prev => {
                            const currentTrack = prev.track || [];
                            const startPoint = (currentTrack.length === 0 && prev.lat && prev.lng)
                                ? [{ lat: prev.lat, lng: prev.lng }]
                                : currentTrack;
                            return { ...prev, track: [...startPoint, { lat, lng }] };
                        });
                    } else {
                        if (!isModalOpenRef.current) {
                            setEditingIndex(null);
                            setTempReport({ lat, lng, type: 'tornado', rating: 'F0', track: [] });
                            setIsModalOpen(true);
                            setIsMinimized(false);
                        }
                    }
                    return; // Stop execution, do not delete
                }

                // If tool is NOT marker (implies Polygon editing or selection), allow deleting
                if (confirm('Deletar este polígono?')) {
                    onUpdatePolygons(riskPolygonsRef.current.filter(p => p.id !== polyData.id));
                }
            });

            polygonsRef.current.push(polygon);
        });
    }, [riskPolygons, onUpdatePolygons, mapReady]); // Added mapReady dependency

    // Render Markers & Tracks (Existing Reports)
    useEffect(() => {
        if (!mapRef.current || !mapReady) return; // Wait for mapReady

        markersRef.current.forEach(m => m.setMap(null));
        polylinesRef.current.forEach(p => p.setMap(null));
        markersRef.current = [];
        polylinesRef.current = [];

        reports.forEach((r, index) => {
            let color = '#ef4444';
            let path: any = google.maps.SymbolPath.FORWARD_CLOSED_ARROW;
            let scale = 5;

            if (r.type === 'tornado') {
                path = 'M 0 0 L 6 -12 L -6 -12 Z';
                color = '#ef4444';
            } else if (r.type === 'vento') {
                path = 'M -5,-5 5,-5 5,5 -5,5 z';
                color = '#3b82f6';
                scale = 1;
            } else if (r.type === 'granizo') {
                path = google.maps.SymbolPath.CIRCLE;
                color = '#22c55e';
            }

            if (r.track && r.track.length > 1) {
                const line = new google.maps.Polyline({
                    path: r.track,
                    geodesic: true,
                    strokeColor: color,
                    strokeOpacity: 0.8,
                    strokeWeight: 4,
                    map: mapRef.current
                });
                polylinesRef.current.push(line);
            }

            const marker = new google.maps.Marker({
                position: { lat: r.lat, lng: r.lng },
                map: mapRef.current,
                draggable: true,
                icon: {
                    path: path as any,
                    fillColor: color,
                    fillOpacity: 1,
                    strokeColor: 'white',
                    strokeWeight: 1,
                    scale: scale
                },
                zIndex: 100
            });

            marker.addListener('dragend', (e: any) => {
                const newLat = e.latLng.lat();
                const newLng = e.latLng.lng();
                const updated = [...reports];
                let newTrack = updated[index].track || [];
                if (newTrack.length > 0) {
                     newTrack = [{ lat: newLat, lng: newLng }, ...newTrack.slice(1)];
                }
                updated[index] = { ...updated[index], lat: newLat, lng: newLng, track: newTrack };
                onUpdate(updated);
            });

            marker.addListener('click', () => {
                // Use Ref for tool check
                if (activeToolRef.current === 'marker') {
                    setEditingIndex(index);
                    setTempReport({ ...r });
                    setIsDrawingTrack(false);
                    setIsModalOpen(true);
                    setIsMinimized(false);
                }
            });

            markersRef.current.push(marker);
        });

    }, [reports, onUpdate, mapReady]); // Added mapReady dependency

    // Live Render of Temp Track
    useEffect(() => {
        if (!mapRef.current || !mapReady) return;
        if (tempTrackRef.current) { tempTrackRef.current.setMap(null); tempTrackRef.current = null; }

        if (tempReport.track && tempReport.track.length > 0) {
             const line = new google.maps.Polyline({
                path: tempReport.track,
                geodesic: true,
                strokeColor: '#fbbf24',
                strokeOpacity: 1.0,
                strokeWeight: 4,
                icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, scale: 4 }, offset: '0', repeat: '20px' }],
                map: mapRef.current,
                zIndex: 200
            });
            tempTrackRef.current = line;
        }
    }, [tempReport.track, mapReady]); // Added mapReady dependency

    // Helpers
    const handleManualAdd = () => {
        const center = mapRef.current?.getCenter();
        const lat = center?.lat() || -25;
        const lng = center?.lng() || -55;
        setEditingIndex(null);
        setTempReport({ lat, lng, type: 'tornado', rating: 'F0', track: [] });
        setIsModalOpen(true);
        setIsMinimized(false);
        setIsDrawingTrack(false);
    };

    const handleSave = () => {
        if (!tempReport.lat || !tempReport.lng || !tempReport.type) return;
        const newReport = tempReport as StormReport;
        if (editingIndex !== null) {
            const updated = [...reports];
            updated[editingIndex] = newReport;
            onUpdate(updated);
        } else {
            onUpdate([...reports, newReport]);
        }
        setIsModalOpen(false);
        setIsDrawingTrack(false);
        setIsMinimized(false);
    };

    const handleDelete = () => {
        if (editingIndex !== null) {
            const updated = reports.filter((_, i) => i !== editingIndex);
            onUpdate(updated);
            setIsModalOpen(false);
            setIsMinimized(false);
        }
    };

    return (
         <div className={clsx("relative border border-white/10 rounded-lg overflow-hidden transition-all duration-300", isFullscreen ? "fixed inset-0 z-[9999] bg-black" : "relative z-0")}>
            <div ref={mapContainerRef} className={clsx("w-full bg-slate-900 z-0", isFullscreen ? "h-full" : "h-[450px]")} />
            
            {/* TOOLBAR */}
            <div className="absolute top-2 left-2 z-[400] flex flex-col gap-2">
                <div className="bg-slate-900/90 backdrop-blur border border-white/20 p-2 rounded-lg flex flex-col gap-2 shadow-xl">
                    <div className="text-[10px] uppercase font-bold text-slate-400 text-center">Ferramentas</div>
                    <button 
                        onClick={() => setActiveTool('marker')}
                        className={clsx("p-2 rounded transition-colors flex items-center gap-2", activeTool === 'marker' ? "bg-cyan-600 text-white" : "bg-slate-800 text-slate-400 hover:text-white")}
                        title="Adicionar Relatos"
                    >
                        <MapPin className="w-5 h-5" />
                    </button>
                    <button 
                        onClick={() => setActiveTool('polygon')}
                        className={clsx("p-2 rounded transition-colors flex items-center gap-2", activeTool === 'polygon' ? "bg-emerald-600 text-white" : "bg-slate-800 text-slate-400 hover:text-white")}
                        title="Desenhar Polígonos (Recorte Brasil)"
                    >
                        <Hexagon className="w-5 h-5" />
                    </button>
                </div>

                {activeTool === 'polygon' && (
                    <div className="bg-slate-900/90 backdrop-blur border border-white/20 p-2 rounded-lg flex flex-col gap-2 shadow-xl animate-in slide-in-from-left">
                        <div className="text-[10px] uppercase font-bold text-slate-400 text-center">Nível de Risco</div>
                        {RISK_LEVELS.map(r => (
                            <button
                                key={r.level}
                                onClick={() => setCurrentRiskLevel(r.level as any)}
                                className={clsx(
                                    "w-8 h-8 rounded-full border-2 transition-transform",
                                    currentRiskLevel === r.level ? "scale-110 border-white" : "border-transparent opacity-50 hover:opacity-100"
                                )}
                                style={{ backgroundColor: r.color }}
                                title={r.label}
                            />
                        ))}
                         <div className="text-[9px] text-center text-white font-bold mt-1">
                             {RISK_LEVELS.find(r => r.level === currentRiskLevel)?.label}
                         </div>
                    </div>
                )}
            </div>

            {/* Top Right Controls */}
            <div className="absolute top-2 right-2 z-[400] flex items-center gap-2">
                <button onClick={handleManualAdd} className="bg-emerald-600 hover:bg-emerald-500 text-white p-2 rounded border border-white/20 shadow-lg text-xs font-bold flex items-center gap-2">
                    <PlusCircle className="w-4 h-4" /> <span className="hidden sm:inline">Adicionar Manual</span>
                </button>
                <button onClick={() => setMapMode(prev => prev === 'dark' ? 'hybrid' : 'dark')} className="bg-black/70 hover:bg-black text-white p-2 rounded border border-white/20 shadow-lg">
                    {mapMode === 'dark' ? <Globe className="w-5 h-5 text-blue-400" /> : <Layers className="w-5 h-5 text-slate-300" />}
                </button>
                <button onClick={() => setIsFullscreen(!isFullscreen)} className="bg-black/70 hover:bg-black text-white p-2 rounded border border-white/20 shadow-lg">
                    {isFullscreen ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
                </button>
            </div>

            {/* Modal Dialog (Popup) */}
            {isModalOpen && (
                <>
                    {isMinimized ? (
                        <div className="absolute right-0 top-1/2 -translate-y-1/2 z-[500] cursor-pointer" onClick={() => setIsMinimized(false)}>
                            <div className="bg-cyan-600 hover:bg-cyan-500 text-white p-3 rounded-l-xl shadow-2xl border-y border-l border-white/20 flex items-center gap-2">
                                <ChevronLeft className="w-5 h-5" />
                            </div>
                        </div>
                    ) : (
                        <div className={clsx("absolute z-[500] flex justify-end p-4 pointer-events-none", isFullscreen ? "bottom-4 right-4" : "inset-0 items-center justify-center bg-black/60")}>
                            <div className="bg-slate-900 border border-white/20 rounded-xl w-full max-w-xs shadow-2xl animate-in zoom-in-95 pointer-events-auto flex flex-col overflow-hidden">
                                <div className="bg-slate-950 px-4 py-3 border-b border-white/10 flex justify-between items-center handle cursor-grab">
                                    <h3 className="text-white font-bold flex items-center gap-2"><MapPin className="w-4 h-4 text-cyan-400" /> {editingIndex !== null ? 'Editar Relato' : 'Novo Relato'}</h3>
                                    <div className="flex items-center gap-1">
                                        <button onClick={() => setIsMinimized(true)} className="p-1 hover:bg-white/10 rounded text-slate-400 hover:text-white"><Minus className="w-4 h-4" /></button>
                                        <button onClick={() => { setIsModalOpen(false); setIsDrawingTrack(false); }} className="p-1 hover:bg-red-500/20 rounded text-slate-400 hover:text-red-400"><X className="w-4 h-4" /></button>
                                    </div>
                                </div>
                                <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto custom-scrollbar">
                                    <div className="grid grid-cols-2 gap-2">
                                        <div><label className="block text-xs text-slate-400 mb-1">Lat</label><input type="number" step="0.0001" className="w-full bg-slate-800 border border-white/10 rounded p-1.5 text-white text-xs" value={tempReport.lat} onChange={e => setTempReport({...tempReport, lat: parseFloat(e.target.value)})} /></div>
                                        <div><label className="block text-xs text-slate-400 mb-1">Lng</label><input type="number" step="0.0001" className="w-full bg-slate-800 border border-white/10 rounded p-1.5 text-white text-xs" value={tempReport.lng} onChange={e => setTempReport({...tempReport, lng: parseFloat(e.target.value)})} /></div>
                                    </div>
                                    <div>
                                        <label className="block text-xs text-slate-400 mb-1 uppercase">Tipo</label>
                                        <select className="w-full bg-slate-800 border border-white/10 rounded p-2 text-white text-sm outline-none" value={tempReport.type} onChange={e => setTempReport({ ...tempReport, type: e.target.value as any })}>
                                            <option value="tornado">Tornado</option>
                                            <option value="vento">Vento</option>
                                            <option value="granizo">Granizo</option>
                                        </select>
                                    </div>
                                    {tempReport.type === 'tornado' && (
                                        <div className="space-y-3">
                                            <div>
                                                <label className="block text-xs text-slate-400 mb-1 uppercase">Intensidade</label>
                                                <select className="w-full bg-slate-800 border border-white/10 rounded p-2 text-white text-sm outline-none" value={tempReport.rating || 'F0'} onChange={e => setTempReport({ ...tempReport, rating: e.target.value })}>
                                                    <option value="F0">EF0 / F0</option>
                                                    <option value="F1">EF1 / F1</option>
                                                    <option value="F2">EF2 / F2</option>
                                                    <option value="F3">EF3 / F3</option>
                                                    <option value="F4">EF4 / F4</option>
                                                    <option value="F5">EF5 / F5</option>
                                                </select>
                                            </div>
                                            <button onClick={() => { setIsDrawingTrack(!isDrawingTrack); setIsMinimized(true); }} className={clsx("w-full py-1.5 px-2 rounded text-xs font-bold flex items-center justify-center gap-1 border transition-colors", isDrawingTrack ? "bg-amber-500 text-black border-amber-400 animate-pulse" : "bg-slate-800 text-slate-300 border-white/10")}>
                                                <PenTool className="w-3 h-3" /> {isDrawingTrack ? 'Parar Desenho' : 'Traçar Trilha'}
                                            </button>
                                        </div>
                                    )}
                                    <div className="flex gap-2 pt-2 border-t border-white/5">
                                        <button onClick={handleSave} className="flex-1 bg-cyan-600 hover:bg-cyan-500 text-white py-2 rounded text-sm font-bold flex justify-center gap-2"><Save className="w-4 h-4" /> Salvar</button>
                                        {editingIndex !== null && <button onClick={handleDelete} className="bg-red-500/20 text-red-400 px-3 rounded"><Trash2 className="w-4 h-4" /></button>}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}