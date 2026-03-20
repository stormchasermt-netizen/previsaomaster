/**
 * Agrupamento de radares por país e estado para o menu ao vivo.
 * Mapeia cada radar (cptec:slug ou argentina:id) para país e estado/província.
 */

export interface RadarLocation {
  country: string;
  state: string;
}

/** Mapeamento: "cptec:slug" ou "argentina:id" → { country, state } */
export const RADAR_LOCATION_MAP: Record<string, RadarLocation> = {
  // Brasil - por estado
  'cptec:santiago': { country: 'Brasil', state: 'Rio Grande do Sul' },
  'cptec:chapeco': { country: 'Brasil', state: 'Santa Catarina' },
  'cptec:lontras': { country: 'Brasil', state: 'Santa Catarina' },
  'cptec:morroigreja': { country: 'Brasil', state: 'Santa Catarina' },
  'cptec:saoroque': { country: 'Brasil', state: 'São Paulo' },
  'cptec:usp-starnet': { country: 'Brasil', state: 'São Paulo' },
  'cptec:ipmet-bauru': { country: 'Brasil', state: 'São Paulo' },
  'cptec:gama': { country: 'Brasil', state: 'Distrito Federal' },
  'cptec:almenara': { country: 'Brasil', state: 'Minas Gerais' },
  'cptec:boavista': { country: 'Brasil', state: 'Roraima' },
  'cptec:cruzeirodosul': { country: 'Brasil', state: 'Acre' },
  'cptec:guaratiba': { country: 'Brasil', state: 'Rio de Janeiro' },
  'cptec:jaraguari': { country: 'Brasil', state: 'Mato Grosso do Sul' },
  'cptec:macapa': { country: 'Brasil', state: 'Amapá' },
  'cptec:macae': { country: 'Brasil', state: 'Rio de Janeiro' },
  'cptec:maceio': { country: 'Brasil', state: 'Alagoas' },
  'cptec:manaus': { country: 'Brasil', state: 'Amazonas' },
  'cptec:natal': { country: 'Brasil', state: 'Rio Grande do Norte' },
  'cptec:picocouto': { country: 'Brasil', state: 'Rio de Janeiro' },
  'cptec:portovelho': { country: 'Brasil', state: 'Rondônia' },
  'cptec:salvador': { country: 'Brasil', state: 'Bahia' },
  'cptec:santatereza': { country: 'Brasil', state: 'Espírito Santo' },
  'cptec:santarem': { country: 'Brasil', state: 'Pará' },
  'cptec:saofrancisco': { country: 'Brasil', state: 'Bahia' },
  'cptec:saogabriel': { country: 'Brasil', state: 'Amazonas' },
  'cptec:tabatinga': { country: 'Brasil', state: 'Amazonas' },
  'cptec:tefe': { country: 'Brasil', state: 'Amazonas' },
  'cptec:tresmarias': { country: 'Brasil', state: 'Minas Gerais' },

  // Argentina - por província
  'argentina:AR5': { country: 'Argentina', state: 'Buenos Aires' },
  'argentina:AR7': { country: 'Argentina', state: 'Entre Ríos' },
  'argentina:AR8': { country: 'Argentina', state: 'La Pampa' },
  'argentina:RMA00': { country: 'Argentina', state: 'Río Negro' },
  'argentina:RMA1': { country: 'Argentina', state: 'Córdoba' },
  'argentina:RMA2': { country: 'Argentina', state: 'Buenos Aires' },
  'argentina:RMA3': { country: 'Argentina', state: 'Formosa' },
  'argentina:RMA4': { country: 'Argentina', state: 'Chaco' },
  'argentina:RMA5': { country: 'Argentina', state: 'Misiones' },
  'argentina:RMA6': { country: 'Argentina', state: 'Buenos Aires' },
  'argentina:RMA7': { country: 'Argentina', state: 'Neuquén' },
  'argentina:RMA8': { country: 'Argentina', state: 'Buenos Aires' },
  'argentina:RMA9': { country: 'Argentina', state: 'Tierra del Fuego' },
  'argentina:RMA10': { country: 'Argentina', state: 'Buenos Aires' },
  'argentina:RMA11': { country: 'Argentina', state: 'Santiago del Estero' },
  'argentina:RMA12': { country: 'Argentina', state: 'Río Negro' },
  'argentina:RMA13': { country: 'Argentina', state: 'Corrientes' },
  'argentina:RMA14': { country: 'Argentina', state: 'Buenos Aires' },
  'argentina:RMA15': { country: 'Argentina', state: 'La Rioja' },
  'argentina:RMA16': { country: 'Argentina', state: 'San Luis' },
  'argentina:RMA17': { country: 'Argentina', state: 'Córdoba' },
  'argentina:RMA18': { country: 'Argentina', state: 'La Pampa' },
};

/** Retorna country e state para um radar (DisplayRadar-like) */
export function getRadarLocation(dr: { type: 'cptec'; station: { slug: string } } | { type: 'argentina'; station: { id: string } }): RadarLocation {
  const key = dr.type === 'cptec' ? `cptec:${dr.station.slug}` : `argentina:${dr.station.id}`;
  return RADAR_LOCATION_MAP[key] ?? { country: dr.type === 'cptec' ? 'Brasil' : 'Argentina', state: 'Outros' };
}

/** Agrupa radares por país e estado: { country, state, radars }[] */
export function groupRadarsByLocation<T extends { type: 'cptec'; station: { slug: string } } | { type: 'argentina'; station: { id: string } }>(
  radars: T[]
): { country: string; state: string; radars: T[] }[] {
  const map = new Map<string, T[]>();
  for (const r of radars) {
    const loc = getRadarLocation(r);
    const key = `${loc.country}\x00${loc.state}`;
    const list = map.get(key) ?? [];
    list.push(r);
    map.set(key, list);
  }
  const result: { country: string; state: string; radars: T[] }[] = [];
  for (const [key, radars] of map.entries()) {
    const [country, state] = key.split('\x00');
    result.push({ country, state, radars });
  }
  result.sort((a, b) => {
    if (a.country !== b.country) return a.country.localeCompare(b.country);
    return a.state.localeCompare(b.state);
  });
  return result;
}
