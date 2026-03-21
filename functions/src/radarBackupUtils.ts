/**
 * Utilitários para backup de imagens de radar.
 * Duplicado do lib/ para uso em Cloud Functions (Node puro).
 */

/** Fallback universal: intervalos a testar [10, 7.5, 6, 5] min (offset 0). */
export const UNIVERSAL_FALLBACK_CONFIGS = [
    { interval: 10, offset: 0 },
    { interval: 7.5, offset: 0 },
    { interval: 6, offset: 0 },
    { interval: 5, offset: 0 },
  ] as const;
  
  export interface CptecStation {
    id: string;
    slug: string;
    org: string;
    server: string;
    product: string;
    subtype: string;
    updateIntervalMinutes?: number;
    updateIntervalOffsetMinutes?: number;
  }
  
  export interface ArgentinaStation {
    id: string;
    updateIntervalMinutes: number;
  }
  
  const OHMC_BASE = 'https://webmet.ohmc.ar/media/radares/images';
  export const IPMET_URL = 'https://getradaripmet-kj7x6j3jsa-uc.a.run.app';
  
  /** Radares CPTEC para backup (exclui ipmet e usp - fontes especiais). */
  export const CPTEC_STATIONS_FOR_BACKUP: CptecStation[] = [
    { id: 'R12558322', slug: 'santiago', org: 'decea', server: 's1', product: 'ppi', subtype: 'ppicz', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0 },
    { id: 'R12137761', slug: 'chapeco', org: 'sdcsc', server: 's2', product: 'ppi', subtype: 'ppicz', updateIntervalMinutes: 6, updateIntervalOffsetMinutes: 0 },
    { id: 'R12227759', slug: 'lontras', org: 'sdcsc', server: 's1', product: 'ppi', subtype: 'ppicz', updateIntervalMinutes: 5, updateIntervalOffsetMinutes: 0 },
    { id: 'R12544957', slug: 'morroigreja', org: 'decea', server: 's2', product: 'ppi', subtype: 'ppicz', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0 },
    { id: 'R12537563', slug: 'saoroque', org: 'decea', server: 's1', product: 'ppi', subtype: 'ppicz', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0 },
    { id: 'R12567564', slug: 'picocouto', org: 'decea', server: 's1', product: 'ppi', subtype: 'ppicz', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0 },
    { id: 'R12504961', slug: 'gama', org: 'decea', server: 's1', product: 'ppi', subtype: 'ppicz', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0 },
    { id: 'R12957397', slug: 'guaratiba', org: 'inea', server: 's1', product: 'ppi', subtype: 'ppicz' },
    { id: 'R12992241', slug: 'macae', org: 'inea', server: 's1', product: 'ppi', subtype: 'ppicz' },
    { id: 'R12977393', slug: 'santatereza', org: 'cemaden', server: 's1', product: 'ppi', subtype: 'ppicz' },
    { id: 'R12894966', slug: 'almenara', org: 'cemaden', server: 's1', product: 'ppi', subtype: 'ppicz' },
    { id: 'R12457387', slug: 'saofrancisco', org: 'cemaden', server: 's1', product: 'ppi', subtype: 'ppicz' },
    { id: 'R12477391', slug: 'tresmarias', org: 'cemaden', server: 's1', product: 'ppi', subtype: 'ppicz' },
    { id: 'R12277383', slug: 'jaraguari', org: 'cemaden', server: 's1', product: 'ppi', subtype: 'ppicz' },
    { id: 'R12247379', slug: 'natal', org: 'cemaden', server: 's1', product: 'ppi', subtype: 'ppicz' },
    { id: 'R12447385', slug: 'maceio', org: 'cemaden', server: 's1', product: 'ppi', subtype: 'ppicz' },
    { id: 'R12467389', slug: 'salvador', org: 'cemaden', server: 's1', product: 'ppi', subtype: 'ppicz' },
    { id: 'R12792141', slug: 'portovelho', org: 'sipam', server: 's1', product: 'ppi', subtype: 'ppicz' },
    { id: 'R12767583', slug: 'cruzeirodosul', org: 'sipam', server: 's1', product: 'ppi', subtype: 'ppicz' },
    { id: 'R12827598', slug: 'tabatinga', org: 'sipam', server: 's1', product: 'ppi', subtype: 'ppicz' },
    { id: 'R12837597', slug: 'tefe', org: 'sipam', server: 's1', product: 'ppi', subtype: 'ppicz' },
    { id: 'R12817594', slug: 'saogabriel', org: 'sipam', server: 's1', product: 'ppi', subtype: 'ppicz' },
    { id: 'R12787587', slug: 'manaus', org: 'sipam', server: 's1', product: 'ppi', subtype: 'ppicz' },
    { id: 'R12757581', slug: 'boavista', org: 'sipam', server: 's1', product: 'ppi', subtype: 'ppicz' },
    { id: 'R12777586', slug: 'macapa', org: 'sipam', server: 's1', product: 'ppi', subtype: 'ppicz' },
    { id: 'R12800000', slug: 'santarem', org: 'sipam', server: 's1', product: 'ppi', subtype: 'ppicz' },
  ];
  
  /** Radares Argentina para backup. */
  export const ARGENTINA_STATIONS_FOR_BACKUP: ArgentinaStation[] = [
    { id: 'AR5', updateIntervalMinutes: 10 },
    { id: 'AR7', updateIntervalMinutes: 10 },
    { id: 'AR8', updateIntervalMinutes: 10 },
    { id: 'RMA00', updateIntervalMinutes: 10 },
    { id: 'RMA1', updateIntervalMinutes: 10 },
    { id: 'RMA2', updateIntervalMinutes: 10 },
    { id: 'RMA3', updateIntervalMinutes: 10 },
    { id: 'RMA4', updateIntervalMinutes: 10 },
    { id: 'RMA5', updateIntervalMinutes: 10 },
    { id: 'RMA6', updateIntervalMinutes: 10 },
    { id: 'RMA7', updateIntervalMinutes: 10 },
    { id: 'RMA8', updateIntervalMinutes: 10 },
    { id: 'RMA9', updateIntervalMinutes: 10 },
    { id: 'RMA10', updateIntervalMinutes: 10 },
    { id: 'RMA11', updateIntervalMinutes: 10 },
    { id: 'RMA12', updateIntervalMinutes: 10 },
    { id: 'RMA13', updateIntervalMinutes: 10 },
    { id: 'RMA14', updateIntervalMinutes: 10 },
    { id: 'RMA15', updateIntervalMinutes: 10 },
    { id: 'RMA16', updateIntervalMinutes: 10 },
    { id: 'RMA17', updateIntervalMinutes: 10 },
    { id: 'RMA18', updateIntervalMinutes: 10 },
  ];
  
  /** Formato YYYYMMDDHHmm em UTC */
  export function getNowTimestamp12UTC(): string {
    const d = new Date();
    return (
      d.getUTCFullYear().toString() +
      String(d.getUTCMonth() + 1).padStart(2, '0') +
      String(d.getUTCDate()).padStart(2, '0') +
      String(d.getUTCHours()).padStart(2, '0') +
      String(d.getUTCMinutes()).padStart(2, '0')
    );
  }
  
  /** Subtrai minutos de timestamp YYYYMMDDHHmm UTC */
  export function subtractMinutesFromTs12(ts12: string, minutes: number): string {
    const d = new Date(
      Date.UTC(
        parseInt(ts12.slice(0, 4), 10),
        parseInt(ts12.slice(4, 6), 10) - 1,
        parseInt(ts12.slice(6, 8), 10),
        parseInt(ts12.slice(8, 10), 10),
        parseInt(ts12.slice(10, 12), 10)
      )
    );
    d.setUTCMinutes(d.getUTCMinutes() - minutes);
    return (
      d.getUTCFullYear().toString() +
      String(d.getUTCMonth() + 1).padStart(2, '0') +
      String(d.getUTCDate()).padStart(2, '0') +
      String(d.getUTCHours()).padStart(2, '0') +
      String(d.getUTCMinutes()).padStart(2, '0')
    );
  }
  
  /** Snapped timestamp para intervalo/offset em min (UTC) */
  function snapToInterval(ts12: string, interval: number, offset: number): string {
    const dateStr = ts12.slice(0, 8);
    const h = parseInt(ts12.slice(8, 10), 10);
    const m = parseInt(ts12.slice(10, 12), 10);
    const totalMin = h * 60 + m;
    const snapped = Math.round((totalMin - offset) / interval) * interval + offset;
    const clamped = Math.max(0, Math.min(23 * 60 + 55, snapped));
    const nh = Math.floor(clamped / 60);
    const nm = clamped % 60;
    return `${dateStr}${String(nh).padStart(2, '0')}${String(nm).padStart(2, '0')}`;
  }
  
  /** Gera URL PNG CPTEC Nowcasting */
  export function buildCptecPngUrl(station: CptecStation, ts12: string): string {
    const y = ts12.slice(0, 4);
    const m = ts12.slice(4, 6);
    return `https://${station.server}.cptec.inpe.br/radar/${station.org}/${station.slug}/${station.product}/${station.subtype}/${y}/${m}/${station.id}_${ts12}.png`;
  }
  
  /** Gera URL PNG Argentina (reflectividade COLMAX) */
  export function buildArgentinaPngUrl(station: ArgentinaStation, tsArgentina: string): string {
    const y = tsArgentina.slice(0, 4);
    const m = tsArgentina.slice(4, 6);
    const d = tsArgentina.slice(6, 8);
    return `${OHMC_BASE}/${station.id}/${y}/${m}/${d}/${station.id}_${tsArgentina}_COLMAX_00.png`;
  }
  
  /** Converte ts12 para formato Argentina YYYYMMDDTHHmm00Z */
  export function ts12ToArgentina(ts12: string): string {
    return (
      ts12.slice(0, 8) +
      'T' +
      ts12.slice(8, 10) +
      ts12.slice(10, 12) +
      '00Z'
    );
  }
  
  /** Tenta encontrar URL que retorna 200. Retorna { url, ts12 } ou null. */
  export async function findWorkingCptecUrl(
    station: CptecStation,
    nominalTs12: string
  ): Promise<{ url: string; ts12: string } | null> {
    for (const { interval, offset } of UNIVERSAL_FALLBACK_CONFIGS) {
      const ts12 = snapToInterval(nominalTs12, interval, offset);
      const url = buildCptecPngUrl(station, ts12);
      const ok = await fetchHeadOk(url);
      if (ok) return { url, ts12 };
    }
    for (let back = 6; back <= 60; back += 6) {
      const backTs = subtractMinutesFromTs12(nominalTs12, back);
      for (const { interval, offset } of UNIVERSAL_FALLBACK_CONFIGS) {
        const ts12 = snapToInterval(backTs, interval, offset);
        const url = buildCptecPngUrl(station, ts12);
        const ok = await fetchHeadOk(url);
        if (ok) return { url, ts12 };
      }
    }
    return null;
  }
  
  /** Tenta encontrar URL Argentina que retorna 200. */
  export async function findWorkingArgentinaUrl(
    station: ArgentinaStation,
    nominalDate: Date
  ): Promise<{ url: string; tsArgentina: string } | null> {
    const interval = station.updateIntervalMinutes;
    const d = new Date(nominalDate);
    for (let back = 0; back <= 30; back += interval) {
      const testDate = new Date(d.getTime() - back * 60 * 1000);
      const totalMin = testDate.getUTCHours() * 60 + testDate.getUTCMinutes();
      const snapped = Math.floor(totalMin / interval) * interval;
      const nh = Math.floor(snapped / 60) % 24;
      const nm = snapped % 60;
      const y = testDate.getUTCFullYear().toString();
      const m = String(testDate.getUTCMonth() + 1).padStart(2, '0');
      const day = String(testDate.getUTCDate()).padStart(2, '0');
      const tsArgentina = `${y}${m}${day}T${String(nh).padStart(2, '0')}${String(nm).padStart(2, '0')}00Z`;
      const url = buildArgentinaPngUrl(station, tsArgentina);
      const ok = await fetchHeadOk(url);
      if (ok) return { url, tsArgentina };
    }
    return null;
  }
  
  /** HEAD request para verificar se URL retorna 200 */
  async function fetchHeadOk(url: string): Promise<boolean> {
    try {
      const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(10000) });
      return res.ok;
    } catch {
      return false;
    }
  }
  
  /** Download de imagem PNG. Retorna Buffer ou null. */
  export async function fetchPngBuffer(url: string): Promise<Buffer | null> {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) return null;
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('image')) return null;
      const arrayBuffer = await res.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch {
      return null;
    }
  }
  
  /** Path Storage: radar_backup/{radarId}/{year}/{month}/{diahhmm}.png (Função 1 - latest) */
  export function getLatestStoragePath(
    radarId: string,
    ts12: string
  ): string {
    const y = ts12.slice(0, 4);
    const m = ts12.slice(4, 6);
    const d = ts12.slice(6, 8);
    const hh = ts12.slice(8, 10);
    const mm = ts12.slice(10, 12);
    return `radar_backup/${radarId}/${y}/${m}/${d}${hh}${mm}.png`;
  }

  /** Path Storage IPMET para ao-vivo: ipmet-bauru/{year}/{month}/{day}/{HHMMSS}.png (evita colisão entre dias) */
  export function getIpmetStoragePathForAoVivo(ts12: string): string {
    const y = ts12.slice(0, 4);
    const m = ts12.slice(4, 6);
    const d = ts12.slice(6, 8);
    const hh = ts12.slice(8, 10);
    const mm = ts12.slice(10, 12);
    return `ipmet-bauru/${y}/${m}/${d}/${hh}${mm}00.png`;
  }
  
  /** Path Storage: radar_backup/{radarId}/{year}/{month}/{day}/{HHmm}.png (Função 2 - histórico) */
  export function getHistoricalStoragePath(
    radarId: string,
    dateStr: string,
    hhmm: string
  ): string {
    const [y, m, d] = dateStr.split('-');
    return `radar_backup/${radarId}/${y}/${m}/${d}/${hhmm}.png`;
  }
  