/**
 * Pastas de run no GCS (ex.: wrf-3km-imagens-diarias):
 * - Centro-Sul: `YYYYMMDD_HHMMSS` (sem segmento de domínio)
 * - Outro domínio: `YYYYMMDD_<slug>_HHMMSS` (ex.: `20251107_parana_000000`)
 *
 * Os 6 dígitos finais = hora/minuto/segundo UTC de referência da rodada (como no WPS).
 */

export type ParsedWrfRun = {
  raw: string;
  dateYmd: string;
  /** `centro-sul` quando não há slug entre data e o sufixo de 6 dígitos */
  domain: 'centro-sul' | string;
  runFolderSuffix: string;
};

export function parseWrfRunFolder(raw: string): ParsedWrfRun | null {
  const simple = raw.match(/^(\d{8})_(\d{6})$/);
  if (simple) {
    return { raw, dateYmd: simple[1], domain: 'centro-sul', runFolderSuffix: simple[2] };
  }
  const withDomain = raw.match(/^(\d{8})_([a-z0-9]+)_(\d{6})$/i);
  if (withDomain) {
    return {
      raw,
      dateYmd: withDomain[1],
      domain: withDomain[2].toLowerCase(),
      runFolderSuffix: withDomain[3],
    };
  }
  return null;
}

export function domainLabel(domain: string): string {
  if (domain === 'centro-sul') return 'Centro-Sul';
  if (domain === 'parana') return 'Paraná';
  return domain.charAt(0).toUpperCase() + domain.slice(1);
}

/** Início da rodada (UTC) a partir do sufixo HHMMSS na pasta. */
export function getRunInitUtcMs(run: string): number {
  const p = parseWrfRunFolder(run);
  if (!p) return NaN;
  const y = +p.dateYmd.slice(0, 4);
  const m = +p.dateYmd.slice(4, 6) - 1;
  const d = +p.dateYmd.slice(6, 8);
  const s = p.runFolderSuffix;
  return Date.UTC(y, m, d, +s.slice(0, 2), +s.slice(2, 4), +s.slice(4, 6));
}

export function getImageValidUtcMs(imageFileName: string): number {
  const m = imageFileName.match(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})\./);
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

export function getForecastHourFromRun(run: string, imageFileName: string, idx: number): number {
  const a = getRunInitUtcMs(run);
  const b = getImageValidUtcMs(imageFileName);
  if (!Number.isNaN(a) && !Number.isNaN(b)) {
    return Math.round((b - a) / 3600000);
  }
  return idx;
}

/** Ex.: `00z (00:00 UTC)` — dois primeiros dígitos = rodada (00z/12z); resto = hora do sufixo. */
export function formatRodadaDropdownLabel(run: string): string {
  const p = parseWrfRunFolder(run);
  if (!p) return run;
  const s = p.runFolderSuffix;
  const hr = s.slice(0, 2);
  const zLabel = `${hr}z`;
  return `${zLabel} (${s.slice(2, 4)}:${s.slice(4, 6)} UTC)`;
}

/** Texto curto para metadados (init). */
export function formatRunInitDisplay(run: string): string {
  const p = parseWrfRunFolder(run);
  if (!p) return run;
  const d = p.dateYmd;
  const s = p.runFolderSuffix;
  return `${d.slice(6, 8)}/${d.slice(4, 6)}/${d.slice(0, 4)} ${s.slice(0, 2)}:${s.slice(2, 4)}:${s.slice(4, 6)} UTC`;
}
