/**
 * Tipos e dados para a página Rastros de Tornados no Brasil.
 * Escala F (Fujita): F0 a F5. Cada evento é um conjunto de polígonos aninhados:
 * polígono de maior intensidade (ex.: F2) obrigatoriamente dentro de um de menor (ex.: F1),
 * que por sua vez dentro de F0. Ordem de desenho: F0 (maior área) → F1 → … → F5 (menor área).
 */

/** Escala Fujita (F), não EF. */
export type FScale = 'F0' | 'F1' | 'F2' | 'F3' | 'F4' | 'F5';

/** Um polígono por nível de intensidade. coordinates = [ anelExterior ] no formato GeoJSON. */
export type TornadoDamagePolygon = {
  intensity: FScale;
  /** GeoJSON: [ [ [lng, lat], ... ] ] — um anel fechado (primeiro ponto = último). */
  coordinates: number[][][];
};

export interface TornadoTrack {
  id: string;
  date: string;
  /** Polígonos do evento, do menor para maior intensidade (F0 envolve F1, F1 envolve F2, etc.). */
  polygons: TornadoDamagePolygon[];
  state: string;
  locality?: string;
  description?: string;
  source?: string;
  beforeImage?: string;
  afterImage?: string;
}

/** Ordem da escala F (do menor ao maior número = do exterior ao interior). */
export const F_SCALE_ORDER: FScale[] = ['F0', 'F1', 'F2', 'F3', 'F4', 'F5'];

/** Intensidade “anterior” na hierarquia (F1 → F0, F2 → F1, …). F0 não tem anterior. */
export function previousFScale(f: FScale): FScale | null {
  const i = F_SCALE_ORDER.indexOf(f);
  return i <= 0 ? null : F_SCALE_ORDER[i - 1];
}

/** Cores por intensidade (F) para o mapa. */
export const TORNADO_TRACK_COLORS: Record<FScale, string> = {
  F0: '#90EE90',
  F1: '#00FF00',
  F2: '#FFA500',
  F3: '#FF4500',
  F4: '#DC143C',
  F5: '#8B0000',
};

/** Verifica se o ponto [lng, lat] está dentro do polígono (anel exterior = coordinates[0]). */
export function pointInPolygonRing(point: number[], ring: number[][]): boolean {
  const [x, y] = point;
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Retorna true se o polígono inner está totalmente dentro do polígono outer (anel exterior). */
export function isPolygonWithinRing(innerRing: number[][], outerRing: number[][]): boolean {
  for (const pt of innerRing) {
    if (!pointInPolygonRing(pt, outerRing)) return false;
  }
  return true;
}

/** Dados de exemplo em formato polígonos (F0 e F1 aninhados). */
export const TORNADO_TRACKS_DEMO: TornadoTrack[] = [
  {
    id: '1',
    date: '2024-09-24',
    polygons: [
      {
        intensity: 'F0',
        coordinates: [[[-51.24, -29.96], [-51.08, -29.96], [-51.08, -29.84], [-51.24, -29.84], [-51.24, -29.96]]],
      },
      {
        intensity: 'F1',
        coordinates: [[[-51.22, -29.94], [-51.12, -29.94], [-51.12, -29.88], [-51.22, -29.88], [-51.22, -29.94]]],
      },
    ],
    state: 'RS',
    locality: 'Independência / São Luiz',
    description: 'Tornado com danos em lavouras e estruturas.',
    source: 'ELAT/INPE',
  },
  {
    id: '2',
    date: '2023-06-30',
    polygons: [
      {
        intensity: 'F0',
        coordinates: [[[-50.62, -29.70], [-50.38, -29.70], [-50.38, -29.56], [-50.62, -29.56], [-50.62, -29.70]]],
      },
    ],
    state: 'RS',
    locality: 'Muitos Capões',
    description: 'Tornado fraco, danos leves.',
  },
];

export function getTracksYears(tracks: TornadoTrack[]): number[] {
  const set = new Set(tracks.map((t) => parseInt(t.date.slice(0, 4), 10)));
  return Array.from(set).sort((a, b) => b - a);
}

/** Intensidades F presentes nos dados (para filtro). */
export function getTracksIntensities(tracks: TornadoTrack[]): FScale[] {
  const set = new Set<FScale>();
  tracks.forEach((t) => t.polygons.forEach((p) => set.add(p.intensity)));
  return F_SCALE_ORDER.filter((i) => set.has(i));
}
