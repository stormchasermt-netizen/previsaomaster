import React from 'react';
import { PythonSoundingData } from './SkewTChart';

export function StatsCharts({ dataList }: { dataList: PythonSoundingData[] }) {
  if (!dataList || dataList.length === 0) return null;

  // Extract metrics
  const paramKeys = ['mlCAPE', 'CAPE03ml', 'mlLCL', 'srh_0_1km', 'srh_0_3km', 'EFFshear', 'Shr_0_500m', 'STP_0_1km', 'STP_0_500m'];
  
  const paramNames: Record<string, string> = {
    mlCAPE: 'ML CAPE (J/kg)',
    CAPE03ml: 'CAPE 0-3km ML (J/kg)',
    mlLCL: 'ML LCL (m)',
    srh_0_1km: 'SRH 1km (m²/s² LM)',
    srh_0_3km: 'SRH 3km (m²/s² LM)',
    EFFshear: 'Eff Shear (kts)',
    Shr_0_500m: 'Shear 500m (kts)',
    STP_0_1km: 'STP 1km (LM)',
    STP_0_500m: 'STP 500m (LM)'
  };

  const getMetrics = (key: keyof PythonSoundingData['indices']) => {
    const vals = dataList.map(d => d.indices?.[key] || 0).filter(v => !isNaN(v));
    if (vals.length === 0) return { min: 0, max: 0, q1: 0, med: 0, q3: 0, vals: [] };
    
    vals.sort((a,b) => a-b);
    const min = vals[0];
    const max = vals[vals.length-1];
    const med = vals[Math.floor(vals.length/2)];
    return { min, max, med, vals };
  };

  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
      {paramKeys.map((key) => {
        const stats = getMetrics(key as keyof PythonSoundingData['indices']);
        
        return (
          <div key={key} className="bg-slate-800/40 p-3 rounded-lg border border-slate-700 relative overflow-hidden flex flex-col justify-between group">
            <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider mb-2 z-10">{paramNames[key]}</p>
            <div className="flex items-end justify-between z-10">
              <span className="text-xl font-bold text-white tracking-tight">
                {stats.med.toFixed(1)} <span className="text-xs font-normal text-slate-500">med</span>
              </span>
              <div className="text-[10px] text-slate-500 text-right">
                <p>Max: <span className="text-amber-500/80 font-bold">{stats.max.toFixed(1)}</span></p>
                <p>Min: <span className="text-cyan-500/80 font-bold">{stats.min.toFixed(1)}</span></p>
              </div>
            </div>

            {/* Micro Scatter / Dist plot background */}
            <div className="absolute inset-x-0 bottom-0 h-8 opacity-20 flex items-end px-2 pb-1 gap-[2px]">
              {stats.vals.map((v, i) => {
                const heightPct = stats.max === stats.min ? 50 : ((v - stats.min) / (stats.max - stats.min)) * 100;
                return (
                  <div key={i} className="flex-1 bg-amber-500 rounded-t-sm" style={{ height: `${Math.max(5, heightPct)}%` }}></div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
