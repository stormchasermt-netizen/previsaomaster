/**
 * Fetch de imagens CPTEC / IPMet / Climatempo — alinhado a lib/cptecRadarStations.ts
 */
export const UNIVERSAL_FALLBACK_CONFIGS = [
    { interval: 10, offset: 0 },
    { interval: 7.5, offset: 0 },
    { interval: 6, offset: 0 },
    { interval: 5, offset: 0 },
];
export const IPMET_URL = 'https://getradaripmet-kj7x6j3jsa-uc.a.run.app';
export const CLIMATEMPO_POA_LATEST = 'https://statics.climatempo.com.br/radar_poa/pngs/latest/radar_poa_1.png';
/** Slugs no bucket radar_ao_vivo_2 — mesma ordem que pastas no GCS. */
export const DEFAULT_SYNC_SLUGS = [
    'cangucu',
    'chapeco',
    'climatempo-poa',
    'gama',
    'ipmet-bauru',
    'lontras',
    'morroigreja',
    'picocouto',
    'santiago',
    'saoroque',
];
/** Metadados CPTEC — URL: https://{sN}.cptec.inpe.br/radar/{org}/{slug}/ppi/{ppicz|ppivr}/{YYYY}/{MM}/R{id}_{YYYYMMDDHHmm}.png */
export const CPTEC_STATIONS = {
    santiago: { id: 'R12558322', dopplerId: 'R12558323', slug: 'santiago', org: 'decea', server: 's1' },
    cangucu: { id: 'R12578316', dopplerId: 'R12577538', slug: 'cangucu', org: 'decea', server: 's1' },
    chapeco: { id: 'R12137761', dopplerId: 'R12137762', slug: 'chapeco', org: 'sdcsc', server: 's2' },
    lontras: { id: 'R12227759', dopplerId: 'R12227760', slug: 'lontras', org: 'sdcsc', server: 's1' },
    morroigreja: { id: 'R12544957', dopplerId: 'R12544956', slug: 'morroigreja', org: 'decea', server: 's2' },
    saoroque: { id: 'R12537563', dopplerId: 'R12537536', slug: 'saoroque', org: 'decea', server: 's1' },
    picocouto: { id: 'R12567564', dopplerId: 'R12567537', slug: 'picocouto', org: 'decea', server: 's1' },
    gama: { id: 'R12507565', dopplerId: 'R12507562', slug: 'gama', org: 'decea', server: 's1' },
};
/**
 * Intervalo de atualização típico (minutos) para snap na grelha CPTEC — alinhado a lib/cptecRadarStations / backup.
 */
export const CPTEC_PRIMARY_INTERVAL_MIN = {
    chapeco: 6,
    lontras: 5,
    santiago: 10,
    cangucu: 10,
    morroigreja: 10,
    saoroque: 10,
    picocouto: 10,
    gama: 10,
};
export function getNowTimestamp12UTC() {
    const d = new Date();
    return (d.getUTCFullYear().toString() +
        String(d.getUTCMonth() + 1).padStart(2, '0') +
        String(d.getUTCDate()).padStart(2, '0') +
        String(d.getUTCHours()).padStart(2, '0') +
        String(d.getUTCMinutes()).padStart(2, '0'));
}
export function subtractMinutesFromTs12(ts12, minutes) {
    const d = new Date(Date.UTC(parseInt(ts12.slice(0, 4), 10), parseInt(ts12.slice(4, 6), 10) - 1, parseInt(ts12.slice(6, 8), 10), parseInt(ts12.slice(8, 10), 10), parseInt(ts12.slice(10, 12), 10)));
    d.setUTCMinutes(d.getUTCMinutes() - minutes);
    return (d.getUTCFullYear().toString() +
        String(d.getUTCMonth() + 1).padStart(2, '0') +
        String(d.getUTCDate()).padStart(2, '0') +
        String(d.getUTCHours()).padStart(2, '0') +
        String(d.getUTCMinutes()).padStart(2, '0'));
}
/** Converte YYYYMMDDHHmm (UTC) para epoch ms. */
export function ts12ToUtcMs(ts12) {
    const y = parseInt(ts12.slice(0, 4), 10);
    const mo = parseInt(ts12.slice(4, 6), 10) - 1;
    const d = parseInt(ts12.slice(6, 8), 10);
    const h = parseInt(ts12.slice(8, 10), 10);
    const min = parseInt(ts12.slice(10, 12), 10);
    return Date.UTC(y, mo, d, h, min, 0, 0);
}
function snapToInterval(ts12, interval, offset) {
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
/** CDN CPTEC: pastas YYYY/MM e ficheiro R{identificador}_{YYYYMMDDHHmm}.png — PPI usa ppicz, Doppler ppivr. */
export function buildCptecPngUrl(station, ts12, layer = 'ppi') {
    const y = ts12.slice(0, 4);
    const mo = ts12.slice(4, 6);
    const subtype = layer === 'ppi' ? 'ppicz' : 'ppivr';
    const fileId = layer === 'ppi' ? station.id : station.dopplerId;
    return `https://${station.server}.cptec.inpe.br/radar/${station.org}/${station.slug}/ppi/${subtype}/${y}/${mo}/${fileId}_${ts12}.png`;
}
const CDN_SERVER_FALLBACKS = ['s1', 's2', 's3', 's0'];
function uniqueServers(primary) {
    const out = [];
    const seen = new Set();
    for (const s of [primary, ...CDN_SERVER_FALLBACKS]) {
        if (!seen.has(s)) {
            seen.add(s);
            out.push(s);
        }
    }
    return out;
}
/** Tenta o servidor do catálogo e depois s1/s2/s3/s0 (RadarFullv3 / CDN). */
export async function fetchCptecPngFromCdn(station, ts12, layer) {
    for (const srv of uniqueServers(station.server)) {
        const st = { ...station, server: srv };
        const url = buildCptecPngUrl(st, ts12, layer);
        const buffer = await fetchPngBuffer(url);
        if (buffer && buffer.length > 0)
            return { url, buffer };
    }
    return null;
}
export async function fetchPngBuffer(url) {
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
        if (!res.ok)
            return null;
        const arrayBuffer = await res.arrayBuffer();
        const buf = Buffer.from(arrayBuffer);
        const ct = (res.headers.get('content-type') || '').toLowerCase();
        if (ct.includes('image'))
            return buf;
        if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47)
            return buf;
        return null;
    }
    catch {
        return null;
    }
}
export async function findWorkingCptecUrl(station, nominalTs12) {
    for (const { interval, offset } of UNIVERSAL_FALLBACK_CONFIGS) {
        const ts12 = snapToInterval(nominalTs12, interval, offset);
        const got = await fetchCptecPngFromCdn(station, ts12, 'ppi');
        if (got)
            return { url: got.url, ts12 };
    }
    for (let back = 6; back <= 60; back += 6) {
        const backTs = subtractMinutesFromTs12(nominalTs12, back);
        for (const { interval, offset } of UNIVERSAL_FALLBACK_CONFIGS) {
            const ts12 = snapToInterval(backTs, interval, offset);
            const got = await fetchCptecPngFromCdn(station, ts12, 'ppi');
            if (got)
                return { url: got.url, ts12 };
        }
    }
    return null;
}
/**
 * Gera candidatos ts12 únicos: percorre cada minuto até `windowMinutes` atrás e aplica snap ao intervalo do radar.
 * (Passo 1 minuto evita buracos que o passo 5 min + 4 snaps criavam.)
 */
export function enumerateCptecTs12InWindow(nowTs12, windowMinutes, primaryInterval, offset) {
    const seen = new Set();
    for (let back = 0; back <= windowMinutes; back++) {
        const nominalTs = subtractMinutesFromTs12(nowTs12, back);
        const ts12 = snapToInterval(nominalTs, primaryInterval, offset);
        seen.add(ts12);
    }
    return [...seen].sort((a, b) => b.localeCompare(a));
}
/**
 * Para cada ts12 na janela: descarrega PPI (ppicz) e, se ativo, Doppler (ppivr) com ID próprio.
 * Usa fallback de hosts s1/s2/s3/s0 no CDN.
 */
export async function downloadCptecImagesInWindow(station, slug, nowTs12, windowMinutes, options) {
    const fetchDoppler = options?.fetchDoppler ?? process.env.CPTEC_FETCH_DOPPLER !== 'false';
    const primaryInterval = CPTEC_PRIMARY_INTERVAL_MIN[slug] ?? 6;
    const candidates = enumerateCptecTs12InWindow(nowTs12, windowMinutes, primaryInterval, 0);
    const out = [];
    for (const ts12 of candidates) {
        const ppi = await fetchCptecPngFromCdn(station, ts12, 'ppi');
        if (ppi) {
            out.push({
                ts12,
                layer: 'ppi',
                fileName: `${ts12}.png`,
                url: ppi.url,
                buffer: ppi.buffer,
            });
        }
        if (fetchDoppler && station.dopplerId) {
            const dop = await fetchCptecPngFromCdn(station, ts12, 'doppler');
            if (dop) {
                out.push({
                    ts12,
                    layer: 'doppler',
                    fileName: `${ts12}-ppivr.png`,
                    url: dop.url,
                    buffer: dop.buffer,
                });
            }
        }
    }
    return out;
}
/** @deprecated usar downloadCptecImagesInWindow */
export async function listCptecImagesInWindow(station, nowTs12, windowMinutes, _stepMinutes) {
    const slug = station.slug;
    const rows = await downloadCptecImagesInWindow(station, slug, nowTs12, windowMinutes, {
        fetchDoppler: false,
    });
    return rows.map(({ ts12, url }) => ({ ts12, url }));
}
export async function fetchIpmetImage(nominalTs12) {
    const url = `${IPMET_URL}?t=${encodeURIComponent(nominalTs12)}`;
    const buf = await fetchPngBuffer(url);
    if (!buf)
        return null;
    return { buffer: buf, ts12: nominalTs12 };
}
export async function fetchClimatempoPoa(nominalTs12) {
    const url = `${CLIMATEMPO_POA_LATEST}?nocache=${encodeURIComponent(nominalTs12)}`;
    const buf = await fetchPngBuffer(url);
    if (!buf)
        return null;
    return { buffer: buf, ts12: nominalTs12 };
}
