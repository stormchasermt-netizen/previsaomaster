/** Bucket GCS dedicado ao teste ao-vivo-2 (leitura via Admin SDK nas rotas API). */
export function getRadarAoVivo2BucketName(): string {
  return process.env.RADAR_AO_VIVO2_GCS_BUCKET || 'radar_ao_vivo_2';
}

const STATION_SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/i;

export function isValidRadarAoVivo2StationSlug(slug: string): boolean {
  return STATION_SLUG_RE.test(slug) && !slug.includes('..') && !slug.includes('/');
}

/** Path permitido: ex `slug/arquivo.ext` ou `historico/slug/arquivo.ext` */
export function isValidRadarAoVivo2ObjectPath(filePath: string): boolean {
  if (!filePath || filePath.includes('..') || filePath.startsWith('/') || filePath.includes('//')) {
    return false;
  }
  const parts = filePath.split('/');
  if (parts.length === 2) {
    const [slug, name] = parts;
    if (!isValidRadarAoVivo2StationSlug(slug)) return false;
    if (!/^[a-zA-Z0-9_.-]+\.(png|jpg|jpeg|gif)$/i.test(name)) return false;
    return true;
  } else if (parts.length === 3 && parts[0] === 'historico') {
    const [, slug, name] = parts;
    if (!isValidRadarAoVivo2StationSlug(slug)) return false;
    if (!/^[a-zA-Z0-9_.-]+\.(png|jpg|jpeg|gif)$/i.test(name)) return false;
    return true;
  } else if (parts.length === 4 && parts[0] === 'historico') {
    const [, slug, date, name] = parts;
    if (!isValidRadarAoVivo2StationSlug(slug)) return false;
    if (!/^\d{8}$/.test(date)) return false;
    if (!/^[a-zA-Z0-9_.-]+\.(png|jpg|jpeg|gif)$/i.test(name)) return false;
    return true;
  }
  return false;
}
