import React from 'react';

export interface PythonSoundingData {
  profile: { pressure: number, height: number, temp: number, dwpt: number, u: number, v: number }[];
  parcel: { pressure: number, temp: number }[];
  indices: {
    mlCAPE: number;
    mlLCL: number;
    CAPE03ml: number;
    EFFshear: number;
    Shr_0_500m: number;
    srh_0_1km: number;
    srh_0_3km: number;
    STP_0_1km: number;
    STP_0_500m: number;
  };
}

export function SkewTChart({ data, meanData }: { data?: PythonSoundingData, meanData?: any }) {
  const size = 500;
  const padding = 30;
  const w = size - 2 * padding;
  const h = size - 2 * padding;

  // Skew-T transformation
  // y = pressure (log scale, top=100mb, bottom=1050mb)
  const pBottom = 1050;
  const pTop = 100;
  
  const getY = (p: number) => {
    if (p <= 0 || isNaN(p)) return padding;
    const maxL = Math.log(pBottom);
    const minL = Math.log(pTop);
    const currL = Math.log(p);
    return padding + h * ((maxL - currL) / (maxL - minL));
  };

  // x = temp + skew
  // skew temp to the right as altitude increases
  const minT = -40; // at bottom
  const maxT = 40;  // at bottom
  
  const getX = (t: number, p: number) => {
    const yVal = getY(p);
    const baseOffset = (t - minT) / (maxT - minT) * w;
    const skewOffset = (h - (yVal - padding)) * 0.8; // Skew factor
    return padding + baseOffset + skewOffset;
  };

  const drawProfile = (profData: any[], type: 'temp' | 'dwpt', isMean: boolean) => {
    return profData
      .filter(d => d && d.pressure >= pTop && d.pressure <= pBottom && d[type] !== null && d[type] !== undefined)
      .map((d, i, arr) => {
        if (i === 0) return `M ${getX(d[type], d.pressure)} ${getY(d.pressure)}`;
        return `L ${getX(d[type], d.pressure)} ${getY(d.pressure)}`;
      }).join(' ');
  };

  const renderData = meanData || data;

  if (!renderData || !renderData.profile || renderData.profile.length === 0) {
    return <div className="w-full h-full flex items-center justify-center text-slate-500 text-sm italic">Dados insuficientes para Skew-T</div>;
  }

  // Draw background isobars and isotherms
  const isobars = [1000, 850, 700, 500, 300, 200, 100];
  const isotherms = [-40, -30, -20, -10, 0, 10, 20, 30, 40];

  return (
    <div className="w-full aspect-square bg-slate-50 rounded-xl relative overflow-hidden pointer-events-none">
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-full font-sans">
        {/* Background Grid */}
        <rect x={padding} y={padding} width={w} height={h} fill="none" stroke="#cbd5e1" strokeWidth="1" />
        
        {/* Isobars */}
        {isobars.map(p => {
          const y = getY(p);
          if (y < padding || y > size - padding) return null;
          return (
            <g key={`p-${p}`}>
              <line x1={padding} y1={y} x2={size-padding} y2={y} stroke="#e2e8f0" strokeWidth="1" />
              <text x={2} y={y + 3} className="fill-slate-500 text-[9px]">{p}</text>
            </g>
          );
        })}

        {/* Isotherms */}
        {isotherms.map(t => {
          const xBot = getX(t, pBottom);
          const xTop = getX(t, pTop);
          return (
            <g key={`t-${t}`}>
              <line x1={xBot} y1={padding+h} x2={xTop} y2={padding} stroke={t === 0 ? "#94a3b8" : "#f1f5f9"} strokeWidth={t === 0 ? "1.5" : "1"} />
              {xBot >= padding && xBot <= size-padding && (
                <text x={xBot - 4} y={size - 15} className="fill-slate-400 text-[10px]">{t}</text>
              )}
            </g>
          );
        })}

        {/* Profiles */}
        <path d={drawProfile(renderData.profile, 'temp', !!meanData)} fill="none" stroke={meanData ? "#cf0af0" : "#ef4444"} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d={drawProfile(renderData.profile, 'dwpt', !!meanData)} fill="none" stroke={meanData ? "#0ea5e9" : "#22c55e"} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

        {/* Parcel Trace */}
        {renderData.parcel && renderData.parcel.length > 0 && (
          <path d={drawProfile(renderData.parcel, 'temp', false)} fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="4 4" />
        )}

      </svg>
      <div className="absolute top-2 right-2 flex flex-col gap-1 text-[10px] bg-white/80 p-1.5 rounded border border-slate-200 shadow-sm">
        <div className="flex items-center gap-1"><div className="w-2 h-0.5 bg-red-500 rounded"></div> Temp</div>
        <div className="flex items-center gap-1"><div className="w-2 h-0.5 bg-green-500 rounded"></div> Dewpt</div>
        <div className="flex items-center gap-1"><div className="w-2 h-0.5 bg-slate-400 border border-slate-400 border-dashed rounded"></div> Parcel</div>
      </div>
    </div>
  );
}
