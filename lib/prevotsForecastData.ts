/**
 * Tipos para Previsões Prevots — overlays de tempestades por data.
 * Usado no Admin (criação) e no Modo Ao Vivo (reprodução).
 */
import type { PrevotsPolygon } from './tornadoTracksData';

export type { PrevotsPolygon };
export { PREVOTS_LEVEL_COLORS, PREVOTS_LEVEL_ORDER } from './tornadoTracksData';

export interface PrevotsForecast {
  id: string;
  /** Data da previsão (YYYY-MM-DD). */
  date: string;
  /** Polígonos por nível (0–4). Recortados ao Brasil. */
  polygons: PrevotsPolygon[];
  createdAtMs?: number;
  updatedAtMs?: number;
  adminId?: string;
  xUrl?: string;
  instagramUrl?: string;
}
