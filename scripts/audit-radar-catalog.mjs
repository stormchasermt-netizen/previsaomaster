#!/usr/bin/env node
/**
 * Compara o catálogo local com:
 * - Tabela CPTEC em docs/radaresv2.txt (bounds / centro / raio)
 * - lib/radarV2Coords.ts (deve bater com o doc para radares V2)
 * - lib/cptecRadarStations.ts (lat/lng/range vs doc)
 * - Opcional: GET WebMET radares JSON (centro vs lib/argentinaRadarStations.ts)
 * - Opcional: GET WebMET Argentina (radares JSON)
 *
 * Uso:
 *   node scripts/audit-radar-catalog.mjs
 *   node scripts/audit-radar-catalog.mjs --fetch-remote
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const DOC_PATH = path.join(ROOT, 'docs', 'radaresv2.txt');
const V2_PATH = path.join(ROOT, 'lib', 'radarV2Coords.ts');
const CPTEC_PATH = path.join(ROOT, 'lib', 'cptecRadarStations.ts');
const AR_PATH = path.join(ROOT, 'lib', 'argentinaRadarStations.ts');
const REDEMET_PATH = path.join(ROOT, 'lib', 'redemetRadar.ts');

/**
 * IDs Nowcasting (tabela HTML em radaresv2) → chaves no código.
 * FUNCEME usa slug `funceme-*` em cptecRadarStations, mas RADAR_V2_COORDS segue nome curto.
 */
const DOC_ID_TO_SLUG = {
  8345: 'saofrancisco',
  8344: 'jaraguari',
  2247: 'chapeco',
  4964: 'morroigreja',
  1379: 'portovelho',
  1377: 'macapa',
  2169: 'santatereza',
  5984: 'tresmarias',
  4963: 'picocouto',
  4960: 'saoroque',
  1380: 'santarem',
  2238: 'guaratiba',
  8343: 'natal',
  8346: 'salvador',
  8325: 'maceio',
  1375: 'boavista',
  1382: 'tabatinga',
  1250: 'gama',
  4965: 'santiago',
  1378: 'manaus',
  1376: 'cruzeirodosul',
  4962: 'cangucu',
  4966: 'almenara',
  1383: 'tefe',
  2241: 'macae',
  1374: 'belem',
  8342: 'petrolina',
  1381: 'saogabriel',
  4961: 'lontras',
};

/** id doc → { v2Key, cptecSlug } quando divergem */
const DOC_ID_ALIAS = {
  7011: { v2Key: 'quixeramobim', cptecSlug: 'funceme-quixeramobim' },
  1136: { v2Key: 'fortaleza', cptecSlug: 'funceme-fortaleza' },
  /** radarV2Coords usa saoluiz; slug CPTEC é saoluis */
  1390: { v2Key: 'saoluiz', cptecSlug: 'saoluis' },
};

function docSlugs(id) {
  const al = DOC_ID_ALIAS[id];
  if (al) return al;
  const s = DOC_ID_TO_SLUG[id];
  return s ? { v2Key: s, cptecSlug: s } : null;
}

function parseDocTable(txt) {
  const lines = txt.split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith('id\tNome\t'));
  if (start < 0) throw new Error('Tabela CPTEC não encontrada em radaresv2.txt');
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('===')) break;
    const p = line.split('\t');
    if (p.length < 9) continue;
    const id = parseInt(p[0], 10);
    out.push({
      id,
      name: p[1],
      rangeKm: parseFloat(p[2]),
      lon: parseFloat(p[3]),
      lat: parseFloat(p[4]),
      minLon: parseFloat(p[5]),
      minLat: parseFloat(p[6]),
      maxLon: parseFloat(p[7]),
      maxLat: parseFloat(p[8]),
    });
  }
  return out;
}

function parseRadarV2Coords(tsContent) {
  const rec = {};
  const re =
    /'([^']+)':\s*\{\s*lat:\s*([-\d.]+),\s*lng:\s*([-\d.]+),\s*bounds:\s*\{\s*north:\s*([-\d.]+),\s*south:\s*([-\d.]+),\s*east:\s*([-\d.]+),\s*west:\s*([-\d.]+)\s*\}/g;
  let m;
  while ((m = re.exec(tsContent)) !== null) {
    rec[m[1]] = {
      lat: parseFloat(m[2]),
      lng: parseFloat(m[3]),
      bounds: {
        north: parseFloat(m[4]),
        south: parseFloat(m[5]),
        east: parseFloat(m[6]),
        west: parseFloat(m[7]),
      },
    };
  }
  return rec;
}

function parseCptecStations(tsContent) {
  const stations = [];
  const lineRe = /\{\s*id:\s*'([^']+)',\s*slug:\s*'([^']+)',\s*name:\s*'[^']*',\s*lat:\s*([-\d.]+),\s*lng:\s*([-\d.]+),\s*rangeKm:\s*([\d.]+)/g;
  let m;
  while ((m = lineRe.exec(tsContent)) !== null) {
    stations.push({
      id: m[1],
      slug: m[2],
      lat: parseFloat(m[3]),
      lng: parseFloat(m[4]),
      rangeKm: parseFloat(m[5]),
    });
  }
  return stations;
}

function parseArgentinaStations(tsContent) {
  const stations = [];
  const lineRe = /\{\s*id:\s*'([^']+)',\s*name:\s*'[^']*',\s*lat:\s*([-\d.]+),\s*lng:\s*([-\d.]+),\s*rangeKm:\s*([\d.]+)/g;
  let m;
  while ((m = lineRe.exec(tsContent)) !== null) {
    stations.push({
      id: m[1],
      lat: parseFloat(m[2]),
      lng: parseFloat(m[3]),
      rangeKm: parseFloat(m[4]),
    });
  }
  return stations;
}

function parseRedemetMap(tsContent) {
  const start = tsContent.indexOf('const CPTEC_TO_REDEMET');
  if (start < 0) return {};
  const brace = tsContent.indexOf('{', start);
  let depth = 0;
  let i = brace;
  for (; i < tsContent.length; i++) {
    const c = tsContent[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  const block = tsContent.slice(brace + 1, i);
  const map = {};
  const pair = /([a-z0-9_-]+):\s*'([^']+)'/gi;
  let x;
  while ((x = pair.exec(block)) !== null) map[x[1]] = x[2];
  return map;
}

const EPS = 1e-4;

function near(a, b, label, slug, issues) {
  if (Math.abs(a - b) > EPS) issues.push(`${slug}: ${label} doc=${a} code=${b}`);
}

function main() {
  const fetchRemote = process.argv.includes('--fetch-remote');
  const docTxt = fs.readFileSync(DOC_PATH, 'utf8');
  const v2Txt = fs.readFileSync(V2_PATH, 'utf8');
  const cptecTxt = fs.readFileSync(CPTEC_PATH, 'utf8');
  const arTxt = fs.readFileSync(AR_PATH, 'utf8');
  const redTxt = fs.readFileSync(REDEMET_PATH, 'utf8');

  const docRows = parseDocTable(docTxt);
  const v2 = parseRadarV2Coords(v2Txt);
  const cptec = parseCptecStations(cptecTxt);
  const cptecBySlug = Object.fromEntries(cptec.map((s) => [s.slug, s]));
  const redemetMap = parseRedemetMap(redTxt);

  const issues = [];
  for (const row of docRows) {
    const sl = docSlugs(row.id);
    if (!sl) {
      issues.push(`Doc id ${row.id} (${row.name}) sem mapeamento no script (DOC_ID_TO_SLUG / DOC_ID_ALIAS)`);
      continue;
    }
    const { v2Key, cptecSlug } = sl;
    const label = `${v2Key}/${cptecSlug}`;
    const v = v2[v2Key];
    if (!v) issues.push(`${label} (id ${row.id}) na tabela doc mas ausente em radarV2Coords['${v2Key}']`);

    near(row.lat, v?.lat, 'lat', label, issues);
    near(row.lng, v?.lng, 'lng', label, issues);
    if (v) {
      near(row.maxLat, v.bounds.north, 'bounds.north(maxLat)', label, issues);
      near(row.minLat, v.bounds.south, 'bounds.south(minLat)', label, issues);
      near(row.maxLon, v.bounds.east, 'bounds.east(maxLon)', label, issues);
      near(row.minLon, v.bounds.west, 'bounds.west(minLon)', label, issues);
    }

    const cp = cptecBySlug[cptecSlug];
    if (!cp) {
      issues.push(`${label}: sem entrada cptecRadarStations.slug='${cptecSlug}' (nome doc: ${row.name})`);
    } else {
      near(row.lat, cp.lat, 'cptec.lat', label, issues);
      near(row.lng, cp.lng, 'cptec.lng', label, issues);
      near(row.rangeKm, cp.rangeKm, 'cptec.rangeKm', label, issues);
    }

    const area = redemetMap[cptecSlug];
    if (area === undefined && !['chapeco', 'lontras', 'funceme-quixeramobim', 'funceme-fortaleza'].includes(cptecSlug)) {
      if (!['guaratiba', 'macae'].includes(cptecSlug))
        issues.push(`${label}: sem CPTEC_TO_REDEMET['${cptecSlug}'] (opcional)`);
    }
  }

  console.log('--- Auditoria catálogo radar ---');
  console.log(`Linhas na tabela doc: ${docRows.length}`);
  console.log(`Chaves em RADAR_V2_COORDS: ${Object.keys(v2).length}`);
  console.log(`Estações parseadas cptec: ${cptec.length}`);

  if (issues.length === 0) {
    console.log('OK: doc × radarV2Coords × cptec (tabela CPTEC) alinhados dentro da tolerância.\n');
  } else {
    console.log(`AVISOS/ERROS (${issues.length}):`);
    for (const i of issues) console.log(' -', i);
    console.log('');
  }

  if (fetchRemote) {
    fetchArgentinaRemote(arTxt).catch((e) => console.error('WebMET:', e.message));
  } else {
    console.log('Dica: node scripts/audit-radar-catalog.mjs --fetch-remote  (compara WebMET JSON vs argentinaRadarStations)\n');
  }

  if (issues.some((x) => x.includes('lat') || x.includes('lng') || x.includes('bounds'))) {
    process.exitCode = 1;
  }
}

async function fetchArgentinaRemote(arTxt) {
  const local = parseArgentinaStations(arTxt);
  const localById = Object.fromEntries(local.map((s) => [s.id, s]));
  const res = await fetch('https://webmet.ohmc.ar/api_radares/radares/?format=json');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const list = Array.isArray(data) ? data : data.results || data.data || [];
  console.log('--- WebMET Argentina (remoto) ---');
  let n = 0;
  for (const r of list) {
    const code = r.code || r.codigo;
    if (!code || !localById[code]) continue;
    const loc = localById[code];
    const clat = parseFloat(r.center_lat ?? r.centerLat);
    const clng = parseFloat(r.center_long ?? r.centerLong ?? r.center_lng);
    if (Number.isFinite(clat) && Number.isFinite(clng)) {
      if (Math.abs(clat - loc.lat) > 0.02 || Math.abs(clng - loc.lng) > 0.02) {
        console.log(` - ${code}: local (${loc.lat}, ${loc.lng}) vs API (${clat}, ${clng})`);
        n++;
      }
    }
  }
  if (n === 0) console.log('Centros WebMET batem com argentinaRadarStations (tol 0.02°) ou API em formato inesperado.');
  console.log('');
}

main();
