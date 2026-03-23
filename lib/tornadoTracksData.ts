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

/** Polígono Prevots — tempestades nível 0–4 (estilo Prevots). 0 = tempestades gerais. Ordem: 0 (maior) por baixo, 4 por cima. */
export type PrevotsLevel = 0 | 1 | 2 | 3 | 4;

export type PrevotsPolygon = {
  level: PrevotsLevel;
  /** GeoJSON: [ [ [lng, lat], ... ] ] — um anel fechado por polígono. */
  coordinates: number[][][];
};

/** Cores Prevots — paleta oficial: Tempestades (0) verde claro, 1 amarelo, 2 laranja, 3 vermelho, 4 magenta. */
export const PREVOTS_LEVEL_COLORS: Record<PrevotsLevel, string> = {
  0: '#86efac',  // Tempestades — verde claro
  1: '#facc15',  // Nível 1 — amarelo brilhante
  2: '#fb923c',  // Nível 2 — laranja
  3: '#ef4444',  // Nível 3 — vermelho
  4: '#d946ef',  // Nível 4 — magenta
};

/** Ordem de desenho: nível 0 primeiro (por baixo), depois 1, 2, 3, 4. */
export const PREVOTS_LEVEL_ORDER: PrevotsLevel[] = [0, 1, 2, 3, 4];

export interface TrackImageBounds {
  ne: { lat: number; lng: number };
  sw: { lat: number; lng: number };
}

export interface SecondaryImage {
  id: string; // unique ID to track in state
  url: string;
  bounds: TrackImageBounds;
  description?: string;
  opacity?: number;
  rotation?: number;
}

export interface NumericalModelImage {
  id: string;
  url: string;
  round: string; // e.g. '00Z', '06Z', '12Z', '18Z', '20Z'
  forecastHour: number; // e.g. 1, 2, 3 (for +1, +2, +3)
  bounds: TrackImageBounds;
  opacity?: number;
  rotation?: number;
  chromaKey?: number;
  cropTop?: number;
  cropBottom?: number;
  cropLeft?: number;
  cropRight?: number;
}

export interface TornadoTrack {
  id: string;
  date: string;
  /** Horário aproximado do evento em UTC (HH:MM). Ex.: "14:30". Necessário para buscar imagens GOES-16. */
  time?: string;
  /** Polígonos do evento, do menor para maior intensidade (F0 envolve F1, F1 envolve F2, etc.). */
  polygons: TornadoDamagePolygon[];
  /** Polígonos Prevots (tempestades níveis 1–4). Opcional. */
  prevotsPolygons?: PrevotsPolygon[];
  country?: string;
  state: string;
  locality?: string;
  description?: string;
  source?: string;
  views?: number;
  /** URL WMS completa (GetMap) capturada do CPTEC/SIGMA para gerar overlay de radar. */
  radarWmsUrl?: string;
  /** Slug do radar pré-selecionado (quando há mais de um no raio de 300 km) */
  radarStationId?: string;
  beforeImage?: string;
  afterImage?: string;
  /** Bounds da imagem "antes" (para overlay no mapa). */
  beforeImageBounds?: TrackImageBounds;
  /** Bounds da imagem "depois" (para overlay no mapa). */
  afterImageBounds?: TrackImageBounds;
  /** URL da imagem do rastro (foto/GeoTIFF exportada). Se tiver trackImageBounds, pode ser sobreposta no mapa. */
  trackImage?: string;
  /** Bounds geográficos da imagem (para sobrepor exatamente no mapa). */
  trackImageBounds?: TrackImageBounds;
  /** Lista de imagens secundárias de "depois" (ex: zooms, drones). */
  secondaryAfterImages?: SecondaryImage[];
  /** Modelos Numéricos (GTS) aplicados ao rastro. */
  numericalModels?: NumericalModelImage[];
  /** Timestamp de criação (ms) quando disponível no Firestore. */
  createdAtMs?: number;
  /** Timestamp de atualização (ms) quando disponível no Firestore. */
  updatedAtMs?: number;

  // Overrides legados mantidos para refatoração
  radarLat?: number;
  radarLng?: number;
  radarRangeKm?: number;
  radarRotation?: number;
  radarOpacity?: number;
  radarChromaKey?: number;
  radarCropTop?: number;
  radarCropBottom?: number;
  radarCropLeft?: number;
  radarCropRight?: number;
  radarCustomBounds?: { north: number; south: number; east: number; west: number };

  /** Overrides de radar específicos, indexados pelo id (ex: 'santiago') ou WMS Url */
  radarOverrides?: Record<string, RadarOverride>;
}

export interface RadarOverride {
  lat?: number;
  lng?: number;
  rangeKm?: number;
  rotation?: number;
  opacity?: number;
  chromaKey?: number;
  cropTop?: number;
  cropBottom?: number;
  cropLeft?: number;
  cropRight?: number;
  customBounds?: { north: number; south: number; east: number; west: number } | null;
}

/** Ordem da escala F (do menor ao maior número = do exterior ao interior). */
export const F_SCALE_ORDER: FScale[] = ['F0', 'F1', 'F2', 'F3', 'F4', 'F5'];

/** Intensidade “anterior” na hierarquia (F1 → F0, F2 → F1, …). F0 não tem anterior. */
export function previousFScale(f: FScale): FScale | null {
  const i = F_SCALE_ORDER.indexOf(f);
  return i <= 0 ? null : F_SCALE_ORDER[i - 1];
}

/** Cores por intensidade (F) para o mapa — estilo NOAA: camada externa (F0) ciano/teal, depois verde, laranja, núcleo vermelho. */
export const TORNADO_TRACK_COLORS: Record<FScale, string> = {
  F0: '#2DD4BF',  // Ciano/teal — área mais externa do rastro
  F1: '#22C55E',  // Verde
  F2: '#84CC16',  // Verde-amarelo
  F3: '#EAB308',  // Amarelo / amarelo-laranja
  F4: '#F97316',  // Laranja
  F5: '#B91C1C',  // Vermelho escuro — núcleo de maior intensidade
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
    country: 'Brasil',
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
    country: 'Brasil',
    state: 'RS',
    locality: 'Muitos Capões',
    description: 'Tornado fraco, danos leves.',
  },
];

const BR_STATES = new Set([
  'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT',
  'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO',
]);

/** Inferência de país para registros antigos sem o campo explícito de country. */
export function inferCountryFromTrack(track: Pick<TornadoTrack, 'country' | 'state' | 'locality' | 'description' | 'source'>): string {
  const explicit = track.country?.trim();
  if (explicit) return explicit;

  const stateUpper = (track.state || '').trim().toUpperCase();
  if (BR_STATES.has(stateUpper)) return 'Brasil';

  const haystack = `${track.state || ''} ${track.locality || ''} ${track.description || ''} ${track.source || ''}`.toLowerCase();
  if (haystack.includes('paraguai') || haystack.includes('paraguay')) return 'Paraguai';
  if (haystack.includes('argentina')) return 'Argentina';
  if (haystack.includes('uruguai') || haystack.includes('uruguay')) return 'Uruguai';
  if (haystack.includes('bolívia') || haystack.includes('bolivia')) return 'Bolívia';
  if (haystack.includes('chile')) return 'Chile';
  if (haystack.includes('peru') || haystack.includes('perú')) return 'Peru';
  return 'Outro';
}

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

/** Retorna a categoria máxima (maior F) do rastro. Ex.: se tiver F0, F1, F2, F4 → retorna F4. */
export function getMaxIntensity(track: TornadoTrack): FScale | undefined {
  if (!track.polygons?.length) return undefined;
  return track.polygons.reduce<FScale>((max, p) =>
    F_SCALE_ORDER.indexOf(p.intensity) > F_SCALE_ORDER.indexOf(max) ? p.intensity : max
  , track.polygons[0].intensity);
}

/** Retorna true se o rastro atinge pelo menos a intensidade mínima. Ex.: F2+ inclui F2, F3, F4, F5. */
export function meetsMinIntensity(track: TornadoTrack, minF: FScale): boolean {
  const max = getMaxIntensity(track);
  if (!max) return false;
  return F_SCALE_ORDER.indexOf(max) >= F_SCALE_ORDER.indexOf(minF);
}

/** Mês 1–12 a partir de date (YYYY-MM-DD). */
export function getMonthFromDate(date: string): number {
  const m = date.slice(5, 7);
  return m ? parseInt(m, 10) : 0;
}

/** Estação (hemisfério sul): Verão=12,1,2 | Outono=3,4,5 | Inverno=6,7,8 | Primavera=9,10,11 */
export type Season = 'Verão' | 'Outono' | 'Inverno' | 'Primavera';

export function getSeasonFromDate(date: string): Season | null {
  const month = getMonthFromDate(date);
  if (month <= 0) return null;
  if (month === 12 || month <= 2) return 'Verão';
  if (month <= 5) return 'Outono';
  if (month <= 8) return 'Inverno';
  return 'Primavera';
}

/** Retorna pontos para heatmap: centroide do primeiro anel de cada polígono F0 (ou primeiro polígono) de cada rastro. */
export function getTrackHeatmapPoints(track: TornadoTrack): { lat: number; lng: number }[] {
  const points: { lat: number; lng: number }[] = [];
  const poly = track.polygons?.[0];
  if (!poly?.coordinates?.[0]?.length) return points;
  const ring = poly.coordinates[0];
  let sumLat = 0, sumLng = 0, n = 0;
  for (const [lng, lat] of ring) {
    sumLat += lat;
    sumLng += lng;
    n++;
  }
  if (n > 0) points.push({ lat: sumLat / n, lng: sumLng / n });
  return points;
}
