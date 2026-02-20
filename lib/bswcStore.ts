import {
    collection,
    doc,
    addDoc,
    setDoc,
    getDoc,
    getDocs,
    query,
    where,
    orderBy,
    limit,
    serverTimestamp,
    Timestamp,
  } from 'firebase/firestore';
  import { db } from '@/lib/firebase';
  import type { BswcForecast, BswcReport, BswcForecastFeature } from '@/lib/types';
  
  const DEADLINE_UTC = 12; // 12h UTC
  
  export function addDaysISO(iso: string, n: number): string {
    const d = new Date(`${iso}T00:00:00`);
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  }
  
  export function getReportTimeWindow(dateISO: string): { startISO: string; endISO: string } {
    const startISO = `${dateISO}T${String(DEADLINE_UTC).padStart(2, '0')}:00:00Z`;
    const endISO = `${addDaysISO(dateISO, 1)}T${String(DEADLINE_UTC).padStart(2, '0')}:00:00Z`;
    return { startISO, endISO };
  }
  
  /** Salva previsão do usuário */
  export async function saveForecast(params: {
    userId: string;
    displayName: string;
    dateISO: string;
    dayType: string;
    geojson: { type: 'FeatureCollection'; features: BswcForecastFeature[] };
  }): Promise<string> {
    if (!db) throw new Error('Firestore não inicializado');
    const col = collection(db, 'bswc_forecasts');
    const ref = await addDoc(col, {
      userId: params.userId,
      displayName: params.displayName,
      dateISO: params.dateISO,
      dayType: params.dayType,
      geojson: params.geojson,
      submitTime: new Date().toISOString(),
      createdAt: serverTimestamp(),
    });
    return ref.id;
  }
  
  /** Busca a última previsão do usuário para uma data */
  export async function getLatestForecast(
    userId: string,
    dateISO: string
  ): Promise<BswcForecast | null> {
    if (!db) return null;
    const col = collection(db, 'bswc_forecasts');
    const q = query(
      col,
      where('userId', '==', userId),
      where('dateISO', '==', dateISO),
      orderBy('createdAt', 'desc'),
      limit(1)
    );
    const snap = await getDocs(q);
    if (snap.empty) return null;
    const d = snap.docs[0].data();
    return {
      id: snap.docs[0].id,
      userId: d.userId,
      displayName: d.displayName,
      dateISO: d.dateISO,
      dayType: d.dayType,
      geojson: d.geojson,
      submitTime: d.submitTime,
      createdAt: d.createdAt instanceof Timestamp ? d.createdAt.toMillis() : d.createdAt,
    };
  }
  
  /** Busca relatos na janela de tempo (dateISO 12UTC → dateISO+1 12UTC) */
  export async function fetchReportsByTimeWindow(
    startISO: string,
    endISO: string
  ): Promise<Array<{ lat: number; lng: number; hazard: string; sev: string }>> {
    if (!db) return [];
    const startDate = startISO.slice(0, 10);
    const endDate = endISO.slice(0, 10);
    const col = collection(db, 'bswc_reports');
    const q = query(
      col,
      where('dateISO', '>=', startDate),
      where('dateISO', '<=', endDate)
    );
    const snap = await getDocs(q);
    const reports: Array<{ lat: number; lng: number; hazard: string; sev: string }> = [];
    snap.forEach((docSnap) => {
      const d = docSnap.data();
      const dateStr = d.dateISO || '';
      let hora = String(d.hora || '00:00:00').trim();
      if (hora.length === 5) hora += ':00';
      const reportISO = `${dateStr}T${hora}Z`;
      if (reportISO >= startISO && reportISO < endISO) {
        reports.push({
          lat: d.lat,
          lng: d.lon,
          hazard: d.hazard || 'vento',
          sev: (d.sev || 'NOR').trim().toUpperCase(),
        });
      }
    });
    return reports;
  }
  
  /** Busca relatos por data (para exibir no mapa) */
  export async function fetchReports(dateISO: string): Promise<
    Array<{
      type: 'Feature';
      geometry: { type: 'Point'; coordinates: [number, number] };
      properties: { hazard: string; sev: string };
    }>
  > {
    if (!db) return [];
    const col = collection(db, 'bswc_reports');
    const q = query(col, where('dateISO', '==', dateISO));
    const snap = await getDocs(q);
    const features: Array<{
      type: 'Feature';
      geometry: { type: 'Point'; coordinates: [number, number] };
      properties: { hazard: string; sev: string };
    }> = [];
    snap.forEach((docSnap) => {
      const d = docSnap.data();
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [d.lon, d.lat] },
        properties: { hazard: d.hazard || 'vento', sev: (d.sev || 'NOR').trim().toUpperCase() },
      });
    });
    return features;
  }
  
  /** Admin: salva relato */
  export async function saveReport(params: {
    dateISO: string;
    hazard: string;
    sev: string;
    lat: number;
    lon: number;
    hora: string;
    autor?: string;
  }): Promise<string> {
    if (!db) throw new Error('Firestore não inicializado');
    const col = collection(db, 'bswc_reports');
    const ref = await addDoc(col, {
      dateISO: params.dateISO,
      hazard: params.hazard,
      sev: params.sev,
      lat: params.lat,
      lon: params.lon,
      hora: params.hora,
      autor: params.autor || 'admin',
      createdAt: serverTimestamp(),
    });
    return ref.id;
  }
  