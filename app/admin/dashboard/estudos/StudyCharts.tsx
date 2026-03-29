import React from 'react';

interface StudyData {
  normal: number;
  significant: number;
  violent: number;
}

interface MetricChartProps {
  title: string;
  unit: string;
  data: StudyData;
  color: string;
}

export function MetricChart({ title, unit, data, color }: MetricChartProps) {
  const maxValue = Math.max(data.normal, data.significant, data.violent, 1) * 1.2;
  
  const categories = [
    { label: 'Normais (F0-F2)', value: data.normal, bg: 'bg-cyan-500/20', border: 'border-cyan-500/50', bar: 'bg-cyan-500' },
    { label: 'Significativos (F2-F4)', value: data.significant, bg: 'bg-amber-500/20', border: 'border-amber-500/50', bar: 'bg-amber-500' },
    { label: 'Violentos (F4-F5)', value: data.violent, bg: 'bg-red-500/20', border: 'border-red-500/50', bar: 'bg-red-500' },
  ];

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
      <div className="flex justify-between items-center mb-2">
        <h4 className="text-sm font-bold text-slate-400 uppercase tracking-widest">{title}</h4>
        <span className="text-[10px] text-slate-500 font-mono uppercase">{unit}</span>
      </div>
      
      <div className="space-y-6">
        {categories.map((cat, i) => {
          const widthPct = (cat.value / maxValue) * 100;
          return (
            <div key={i} className="space-y-1.5">
              <div className="flex justify-between text-xs font-bold">
                <span className="text-slate-400">{cat.label}</span>
                <span className="text-white">{cat.value.toFixed(2)}</span>
              </div>
              <div className={`h-3 w-full rounded-full ${cat.bg} border ${cat.border} overflow-hidden`}>
                <div 
                  className={`h-full ${cat.bar} shadow-[0_0_10px_rgba(255,255,255,0.2)] transition-all duration-1000 ease-out`}
                  style={{ width: `${widthPct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function StudyCharts({ results }: { results: any[] }) {
  if (!results.length) return null;

  // Helpers de agrupamento baseados na lógica do usuário:
  // Normais: F0-F2 (0, 1, 2)
  // Significativos: F2-F4 (2, 3, 4)
  // Violentos: F4-F5 (4, 5)
  const fOrder = ['F0', 'F1', 'F2', 'F3', 'F4', 'F5'];
  
  const getAverage = (group: any[], key: string) => {
    if (!group.length) return 0;
    const sum = group.reduce((acc, curr) => acc + (curr.indices?.[key] || 0), 0);
    return sum / group.length;
  };

  const normalGroup = results.filter(r => ['F0', 'F1', 'F2'].includes(r.maxIntensity));
  const significantGroup = results.filter(r => ['F2', 'F3', 'F4'].includes(r.maxIntensity));
  const violentGroup = results.filter(r => ['F4', 'F5'].includes(r.maxIntensity));

  const metrics = [
    { key: 'stp', title: 'STP (Significant Tornado Parameter)', unit: 'Índice Adim.' },
    { key: 'scp', title: 'SCP (Supercell Composite Parameter)', unit: 'Índice Adim.' },
    { key: 'srh_0_5', title: 'SRH 0-500m (Helicidade)', unit: 'm²/s²' },
    { key: 'srh_1', title: 'SRH 0-1km (Helicidade)', unit: 'm²/s²' },
    { key: 'srh_3', title: 'SRH 0-3km (Helicidade)', unit: 'm²/s²' },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-in fade-in duration-700">
      {metrics.map(m => (
        <MetricChart 
          key={m.key}
          title={m.title}
          unit={m.unit}
          color="amber"
          data={{
            normal: getAverage(normalGroup, m.key),
            significant: getAverage(significantGroup, m.key),
            violent: getAverage(violentGroup, m.key),
          }}
        />
      ))}
    </div>
  );
}
