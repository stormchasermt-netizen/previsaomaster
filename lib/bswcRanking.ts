import {
    collection,
    getDocs,
    query,
    where,
    orderBy,
  } from 'firebase/firestore';
  import { db } from '@/lib/firebase';
  import { getReportTimeWindow, addDaysISO } from '@/lib/bswcStore';
  import { computeScoreboard } from '@/lib/bswcScoring';
  import type { BswcRankingRow } from '@/lib/types';
  
  export async function getRanking(
    fromDate: string,
    toDate: string
  ): Promise<BswcRankingRow[]> {
    if (!db) return [];
  
    const forecastsCol = collection(db, 'bswc_forecasts');
    const reportsCol = collection(db, 'bswc_reports');
  
    const q = query(
      forecastsCol,
      where('dateISO', '>=', fromDate),
      where('dateISO', '<=', toDate)
    );
    const snap = await getDocs(q);
  
    const forecastsByUser: Record<
      string,
      Array<{ dateISO: string; displayName: string; geojson: any }>
    > = {};
  
    snap.forEach((docSnap) => {
      const d = docSnap.data();
      const uid = d.userId;
      if (!forecastsByUser[uid]) {
        forecastsByUser[uid] = [];
      }
      forecastsByUser[uid].push({
        dateISO: d.dateISO,
        displayName: d.displayName || 'Jogador',
        geojson: d.geojson,
      });
    });
  
    const userScores: Record<
      string,
      { displayName: string; days: Set<string>; hail: number; wind: number; tornado: number }
    > = {};
  
    for (const [uid, forecasts] of Object.entries(forecastsByUser)) {
      userScores[uid] = {
        displayName: forecasts[0]?.displayName || 'Jogador',
        days: new Set(),
        hail: 0,
        wind: 0,
        tornado: 0,
      };
  
      for (const fc of forecasts) {
        const polys = (fc.geojson?.features || []).filter(
          (f: any) => f.geometry?.type === 'Polygon'
        );
        if (!polys.length) continue;
  
        const { startISO, endISO } = getReportTimeWindow(fc.dateISO);
  
        const reportsSnap = await getDocs(
          query(
            reportsCol,
            where('dateISO', '>=', startISO.slice(0, 10)),
            where('dateISO', '<=', endISO.slice(0, 10))
          )
        );
  
        const reports: Array<{ lat: number; lng: number; hazard: string; sev: string }> = [];
        reportsSnap.forEach((docSnap) => {
          const r = docSnap.data();
          let hora = String(r.hora || '00:00:00').trim();
          if (hora.length === 5) hora += ':00';
          const reportISO = `${r.dateISO}T${hora}Z`;
          if (reportISO >= startISO && reportISO < endISO) {
            reports.push({
              lat: r.lat,
              lng: r.lon,
              hazard: r.hazard || 'vento',
              sev: (r.sev || 'NOR').trim().toUpperCase(),
            });
          }
        });
  
        const polysForScore = polys.map((f: any) => ({
          type: 'Feature',
          geometry: f.geometry,
          properties: { level: f.properties?.level, type: f.properties?.type },
        }));
  
        const sb = computeScoreboard(polysForScore, reports);
        userScores[uid].days.add(fc.dateISO);
        userScores[uid].hail += sb.granizo.pts;
        userScores[uid].wind += sb.vento.pts;
        userScores[uid].tornado += sb.tornado.pts;
      }
    }
  
    const rows: BswcRankingRow[] = Object.entries(userScores).map(
      ([uid, data], i) => ({
        pos: 0,
        playerName: data.displayName,
        userId: uid,
        daysCount: data.days.size,
        hailPoints: data.hail,
        windPoints: data.wind,
        tornadoPoints: data.tornado,
        totalPoints: data.hail + data.wind + data.tornado,
      })
    );
  
    rows.sort((a, b) => b.totalPoints - a.totalPoints);
    rows.forEach((r, i) => (r.pos = i + 1));
  
    return rows;
  }
  