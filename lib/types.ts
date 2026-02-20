

export type UserType = 'user' | 'admin' | 'superadmin';

export interface AppUser {
  uid: string;
  displayName: string;
  photoURL?: string;
  type: UserType;
  email: string;
}

export type PrevisaoDifficulty = 'iniciante' | 'intermediario' | 'especialista' | 'mestre';

export interface MapBounds {
  south: number;
  north: number;
  west: number;
  east: number;
}

export interface PrevisaoLayer {
  id: string;
  name: string;
  category?: string;
  time?: string;
  imageUrl: string;
  validDifficulties: PrevisaoDifficulty[];
  order: number;
}

export interface StormReport {
  lat: number;
  lng: number;
  type: 'tornado' | 'vento' | 'granizo';
  rating?: string;
  track?: { lat: number; lng: number }[]; // Array of points defining the tornado path
}

export interface RiskPolygon {
  id: string;
  points: { lat: number; lng: number }[];
  type: 'geral' | 'tornado' | 'vento' | 'granizo';
  level: 1 | 2 | 3 | 4; // 1: Marginal, 2: Ligera, 3: Moderada, 4: Alta
}

export interface PrevisaoEvent {
  id: string;
  eventDate: string; // ISO String
  displayDate: string;
  monthHint?: string;
  region: 'america_do_sul';
  layers: PrevisaoLayer[];
  stormReports: StormReport[];
  riskPolygons?: RiskPolygon[]; // New: Prevots Polygons
  reportMapUrl?: string; // New: Reference Image URL
  bounds: MapBounds;
  active: boolean;
  createdAt: number;
  adminId: string;
}

export interface PrevisaoScore {
  id: string;
  userId: string;
  displayName: string;
  photoURL?: string;
  eventId: string;
  difficulty: PrevisaoDifficulty;
  forecastLat: number;
  forecastLng: number;
  distanceKm: number;
  basePoints: number;
  difficultyMultiplier: number;
  streakBonus: number;
  finalScore: number;
  streakCount: number;
  createdAt: number;
}

// MULTIPLAYER TYPES

export type LobbyStatus = 'waiting' | 'loading' | 'playing' | 'round_results' | 'finished';

export interface LobbyPlayer {
  uid: string;
  displayName: string;
  photoURL?: string;
  isHost: boolean;
  hasSubmitted: boolean;
  totalScore: number;
  lastRoundScore: number;
  lastRoundDistance: number;
  streakCount: number;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: number;
  isSystem?: boolean;
}

export interface Lobby {
  code: string;
  hostId: string;
  status: LobbyStatus;
  players: LobbyPlayer[];
  currentEventId: string | null;
  difficulty: PrevisaoDifficulty;
  loadingStartTime?: any; // Can be a server timestamp
  roundEndTime: number | null; // Timestamp for forced finish
  roundsPlayed: number;
  createdAt: number;
}

// BSWC Previsão & Sondagens (modo paralelo)

export type BswcHazard = 'granizo' | 'vento' | 'tornado';
export type BswcSeverity = 'NOR' | 'SS';

export interface BswcForecastFeature {
  type: 'Feature';
  geometry: { type: 'Polygon'; coordinates: number[][][] };
  properties: { dia: string; type: BswcHazard; level: number };
}

export interface BswcForecast {
  id?: string;
  userId: string;
  displayName: string;
  dateISO: string;
  dayType: string;
  geojson: { type: 'FeatureCollection'; features: BswcForecastFeature[] };
  submitTime: string;
  createdAt: number;
}

export interface BswcReport {
  id?: string;
  dateISO: string;
  hazard: BswcHazard;
  sev: BswcSeverity;
  lat: number;
  lon: number;
  hora: string;
  autor?: string;
  createdAt: number;
}

export interface BswcScoreStats {
  hit: number;
  miss: number;
  pct: number;
  pts: number;
}

export interface BswcScoreboard {
  granizo: BswcScoreStats;
  vento: BswcScoreStats;
  tornado: BswcScoreStats;
  totalPts: number;
}

export interface BswcRankingRow {
  pos: number;
  playerName: string;
  userId: string;
  daysCount: number;
  hailPoints: number;
  windPoints: number;
  tornadoPoints: number;
  totalPoints: number;
}
