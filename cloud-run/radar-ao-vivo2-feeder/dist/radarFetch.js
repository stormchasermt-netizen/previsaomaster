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
/**
 * Pastas no bucket `radar_ao_vivo_2` (GCS) — alinhado a lib/cptecRadarStations + ao-vivo-2.
 * Ordem alfabética para diffs estáveis.
 */
export const DEFAULT_SYNC_SLUGS = [
    'almeirim',
    'belem',
    'boavista',
    'cangucu',
    'chapeco',
    'climatempo-poa',
    'cruzeirodosul',
    'funceme-ceara',
    'funceme-fortaleza',
    'funceme-quixeramobim',
    'gama',
    'guaratiba',
    'ipmet-bauru',
    'jaraguari',
    'lontras',
    'macae',
    'macapa',
    'maceio',
    'manaus',
    'morroigreja',
    'natal',
    'petrolina',
    'picos',
    'portovelho',
    'riobranco',
    'salvador',
    'santarem',
    'santatereza',
    'santiago',
    'saofrancisco',
    'saogabriel',
    'saoluis',
    'saoroque',
    'tabatinga',
    'tefe',
    'tresmarias',
    'usp-itaituba',
    'vilhena',
];
/**
 * Pastas no GCS sem feed CPTEC neste serviço (IDs placeholder ou fonte externa).
 * O ciclo de sync ignora; o cleanup continua a apagar ficheiros antigos nestes prefixos.
 */
export const SLUGS_WITHOUT_CDN_SYNC = new Set(['almeirim', 'picos', 'usp-itaituba']);
/** Metadados CPTEC — URL: https://{sN}.cptec.inpe.br/radar/{org}/{slug}/ppi/{ppicz|ppivr}/{YYYY}/{MM}/R{id}_{YYYYMMDDHHmm}.png */
export const CPTEC_STATIONS = {
    santiago: { id: 'R12558322', dopplerId: 'R12558323', slug: 'santiago', org: 'decea', server: 's1' },
    cangucu: { id: 'R12578316', dopplerId: 'R12577538', slug: 'cangucu', org: 'decea', server: 's1' },
    chapeco: { id: 'R12137761', dopplerId: 'R12137762', slug: 'chapeco', org: 'sdcsc', server: 's2' },
    lontras: { id: 'R12227759', dopplerId: 'R12227760', slug: 'lontras', org: 'sdcsc', server: 's1' },
    morroigreja: { id: 'R12544957', dopplerId: 'R12544956', slug: 'morroigreja', org: 'decea', server: 's2' },
    saoroque: { id: 'R12537563', dopplerId: 'R12537536', slug: 'saoroque', org: 'decea', server: 's1' },
    gama: { id: 'R12507565', dopplerId: 'R12507562', slug: 'gama', org: 'decea', server: 's1' },
    guaratiba: { id: 'R12957397', dopplerId: 'R12957398', slug: 'guaratiba', org: 'inea', server: 's1' },
    macae: { id: 'R12997399', dopplerId: 'R12997758', slug: 'macae', org: 'inea', server: 's1' },
    santatereza: { id: 'R12977393', dopplerId: 'R12977394', slug: 'santatereza', org: 'cemaden', server: 's1' },
    saofrancisco: { id: 'R12457387', dopplerId: 'R12457388', slug: 'saofrancisco', org: 'cemaden', server: 's1' },
    tresmarias: { id: 'R12477391', dopplerId: 'R12477392', slug: 'tresmarias', org: 'cemaden', server: 's1' },
    jaraguari: { id: 'R12277383', dopplerId: 'R12277384', slug: 'jaraguari', org: 'cemaden', server: 's1' },
    natal: { id: 'R12247379', dopplerId: 'R12247380', slug: 'natal', org: 'cemaden', server: 's1' },
    maceio: { id: 'R12447385', dopplerId: 'R12447386', slug: 'maceio', org: 'cemaden', server: 's1' },
    salvador: { id: 'R12467389', dopplerId: 'R12467390', slug: 'salvador', org: 'cemaden', server: 's1' },
    petrolina: { id: 'R12257381', dopplerId: 'R12257382', slug: 'petrolina', org: 'cemaden', server: 's1' },
    vilhena: { id: 'R102', slug: 'vilhena', org: 'redemet', server: 's1' },
    /** Pasta GCS `riobranco` — segmento de URL no CDN é `rio-branco`. */
    riobranco: { id: 'R104', slug: 'rio-branco', org: 'redemet', server: 's1' },
    portovelho: { id: 'R12797767', dopplerId: 'R12797370', slug: 'portovelho', org: 'sipam', server: 's1' },
    cruzeirodosul: { id: 'R12767583', dopplerId: 'R12767363', slug: 'cruzeirodosul', org: 'sipam', server: 's2' },
    tabatinga: { id: 'R12827598', dopplerId: 'R12827378', slug: 'tabatinga', org: 'sipam', server: 's1' },
    tefe: { id: 'R12837597', dopplerId: 'R12837377', slug: 'tefe', org: 'sipam', server: 's1' },
    saogabriel: { id: 'R12817594', dopplerId: 'R12817374', slug: 'saogabriel', org: 'sipam', server: 's1' },
    manaus: { id: 'R12787587', dopplerId: 'R12787367', slug: 'manaus', org: 'sipam', server: 's1' },
    boavista: { id: 'R12757581', dopplerId: 'R12757361', slug: 'boavista', org: 'sipam', server: 's1' },
    macapa: { id: 'R12777586', dopplerId: 'R12777366', slug: 'macapa', org: 'sipam', server: 's1' },
    santarem: { id: 'R12807592', dopplerId: 'R12807372', slug: 'santarem', org: 'sipam', server: 's1' },
    saoluis: { id: 'R12907765', dopplerId: 'R12907766', slug: 'saoluis', org: 'sipam', server: 's1' },
    belem: { id: 'R12800001', slug: 'belem', org: 'sipam', server: 's1' },
    'funceme-fortaleza': { id: 'R13851142', dopplerId: 'R13851143', slug: 'funceme-fortaleza', org: 'funceme', server: 's1' },
    'funceme-quixeramobim': { id: 'R13967017', dopplerId: 'R13967018', slug: 'funceme-quixeramobim', org: 'funceme', server: 's1' },
    'funceme-ceara': { id: 'RMT0100DS', slug: 'funceme-ceara', org: 'funceme', server: 's1' },
};
/**
 * Intervalo de atualização típico (minutos) para snap na grelha CPTEC — alinhado a lib/cptecRadarStations.
 */
/**
 * IDs do portal Nowcasting (`/api/camadas/radar/{id}/imagens?nome=…`) — ver docs/radaresv2.txt.
 * Permite descarregar os timestamps reais (ex.: 09:11, 09:06) em vez de adivinhar com snap à grelha.
 */
export const NOWCASTING_RADAR_MAP = {
    saofrancisco: { id: 8345, nome: 'São Francisco' },
    jaraguari: { id: 8344, nome: 'Jaraguari' },
    chapeco: { id: 2247, nome: 'Chapecó' },
    morroigreja: { id: 4964, nome: 'Morro da Igreja' },
    portovelho: { id: 1379, nome: 'Porto Velho' },
    macapa: { id: 1377, nome: 'Macapá' },
    santatereza: { id: 2169, nome: 'Santa Tereza' },
    tresmarias: { id: 5984, nome: 'Três Marias' },
    saoroque: { id: 4960, nome: 'São Roque' },
    santarem: { id: 1380, nome: 'Santarém' },
    guaratiba: { id: 2238, nome: 'Guaratiba' },
    natal: { id: 8343, nome: 'Natal' },
    'funceme-quixeramobim': { id: 7011, nome: 'Quixeramobim' },
    salvador: { id: 8346, nome: 'Salvador' },
    maceio: { id: 8325, nome: 'Maceió' },
    boavista: { id: 1375, nome: 'Boa Vista' },
    tabatinga: { id: 1382, nome: 'Tabatinga' },
    gama: { id: 1250, nome: 'Gama' },
    santiago: { id: 4965, nome: 'Santiago' },
    manaus: { id: 1378, nome: 'Manaus' },
    cruzeirodosul: { id: 1376, nome: 'Cruzeiro do Sul' },
    cangucu: { id: 4962, nome: 'Canguçu' },
    tefe: { id: 1383, nome: 'Tefé' },
    macae: { id: 2241, nome: 'Macaé' },
    belem: { id: 1374, nome: 'Belém' },
    petrolina: { id: 8342, nome: 'Petrolina' },
    'funceme-fortaleza': { id: 1136, nome: 'Fortaleza' },
    saogabriel: { id: 1381, nome: 'São Gabriel' },
    lontras: { id: 4961, nome: 'Lontras' },
    saoluis: { id: 1390, nome: 'São Luiz' },
};
export const CPTEC_PRIMARY_INTERVAL_MIN = {
    chapeco: 6,
    lontras: 10,
    santiago: 10,
    cangucu: 10,
    morroigreja: 10,
    saoroque: 10,
    gama: 10,
    guaratiba: 10,
    macae: 10,
    santatereza: 10,
    saofrancisco: 10,
    tresmarias: 10,
    jaraguari: 10,
    natal: 10,
    maceio: 10,
    salvador: 10,
    petrolina: 10,
    vilhena: 10,
    riobranco: 10,
    portovelho: 10,
    cruzeirodosul: 12,
    tabatinga: 10,
    tefe: 10,
    saogabriel: 10,
    manaus: 10,
    boavista: 10,
    macapa: 10,
    santarem: 10,
    saoluis: 10,
    belem: 10,
    'funceme-fortaleza': 10,
    'funceme-quixeramobim': 10,
    'funceme-ceara': 15,
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
    const fileId = layer === 'ppi' ? station.id : (station.dopplerId ?? station.id);
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
export function normalizeCptecImageUrl(url) {
    if (url.startsWith('http://'))
        return `https://${url.slice(7)}`;
    return url;
}
export async function fetchPngBuffer(url) {
    try {
        const res = await fetch(normalizeCptecImageUrl(url), { signal: AbortSignal.timeout(20000) });
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
 * @deprecated Preferir enumerateMinuteTs12InWindow para CDN — o snap falha quando o CPTEC publica fora da grelha.
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
/** Um minuto por passo (UTC), sem snap — alinha com ficheiros reais no CDN quando a API Nowcasting não está mapeada. */
export function enumerateMinuteTs12InWindow(nowTs12, windowMinutes) {
    const out = [];
    for (let back = 0; back <= windowMinutes; back++) {
        out.push(subtractMinutesFromTs12(nowTs12, back));
    }
    return out;
}
function fileDateTimeToTs12(fileDate, fileTime) {
    const d = fileDate.replace(/-/g, '');
    if (d.length !== 8)
        return null;
    const t = fileTime.replace(/:/g, '');
    if (t.length < 4)
        return null;
    return d + t.slice(0, 4);
}
function pickNowcastingImageUrl(img) {
    if (img.urls && img.urls.length > 0) {
        const u = img.urls.find((x) => x.startsWith('https://')) || img.urls[0];
        return normalizeCptecImageUrl(u);
    }
    if (img.url)
        return normalizeCptecImageUrl(img.url);
    return null;
}
/**
 * Lista de imagens a partir da API oficial (mesmos URLs que o site).
 * Filtra por janela temporal e pelos IDs PPI / Doppler do catálogo.
 */
export async function downloadCptecImagesFromNowcastingApi(station, nw, windowMinutes, options) {
    const fetchDoppler = options?.fetchDoppler ?? process.env.CPTEC_FETCH_DOPPLER !== 'false';
    const quantidade = Math.min(200, Math.max(40, windowMinutes + 40));
    const apiUrl = `https://nowcasting.cptec.inpe.br/api/camadas/radar/${nw.id}/imagens?quantidade=${quantidade}&nome=${encodeURIComponent(nw.nome)}`;
    let data;
    try {
        const res = await fetch(apiUrl, { signal: AbortSignal.timeout(25000) });
        if (!res.ok)
            return [];
        const json = (await res.json());
        if (!Array.isArray(json))
            return [];
        data = json;
    }
    catch {
        return [];
    }
    const endMs = Date.now();
    const startMs = endMs - windowMinutes * 60 * 1000;
    const seen = new Set();
    const out = [];
    for (const prod of data) {
        let layer = null;
        if (prod.id === station.id)
            layer = 'ppi';
        else if (fetchDoppler && station.dopplerId && prod.id === station.dopplerId)
            layer = 'doppler';
        else
            continue;
        for (const img of prod.imagens || []) {
            if (!img.fileDate || !img.fileTime)
                continue;
            const ts12 = fileDateTimeToTs12(img.fileDate, img.fileTime);
            if (!ts12 || ts12.length !== 12)
                continue;
            let tms;
            if (typeof img.horario === 'number' && Number.isFinite(img.horario)) {
                tms = img.horario;
            }
            else {
                tms = ts12ToUtcMs(ts12);
            }
            if (tms < startMs || tms > endMs + 120_000)
                continue;
            const key = `${layer}:${ts12}`;
            if (seen.has(key))
                continue;
            seen.add(key);
            const imgUrl = pickNowcastingImageUrl(img);
            if (!imgUrl)
                continue;
            const buffer = await fetchPngBuffer(imgUrl);
            if (!buffer || buffer.length === 0)
                continue;
            out.push({
                ts12,
                layer,
                fileName: layer === 'ppi' ? `${ts12}.png` : `${ts12}-ppivr.png`,
                url: imgUrl,
                buffer,
            });
        }
    }
    return out.sort((a, b) => b.ts12.localeCompare(a.ts12));
}
/**
 * Para cada ts12 na janela: descarrega PPI (ppicz) e, se ativo, Doppler (ppivr) com ID próprio.
 * Usa fallback de hosts s1/s2/s3/s0 no CDN. Candidatos = um minuto por passo (sem snap).
 */
export async function downloadCptecImagesInWindow(station, slug, nowTs12, windowMinutes, options) {
    const fetchDoppler = options?.fetchDoppler ?? process.env.CPTEC_FETCH_DOPPLER !== 'false';
    const nw = NOWCASTING_RADAR_MAP[slug];
    if (nw && process.env.CPTEC_SKIP_NOWCASTING_API !== 'true') {
        const fromApi = await downloadCptecImagesFromNowcastingApi(station, nw, windowMinutes, { fetchDoppler });
        if (fromApi.length > 0)
            return fromApi;
    }
    const candidates = enumerateMinuteTs12InWindow(nowTs12, windowMinutes);
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
