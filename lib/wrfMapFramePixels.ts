/**
 * Quadro do mapa (retângulo LCC / dados) dentro do JPG gerado por plot_wrf2.py na VM.
 * Medido em pixels nas imagens atuais do bucket (bbox_inches='tight' → tamanho total do JPG varia;
 * o retângulo do mapa em si é constante; só mudam top/bottom/right com título, colorbar e barbs).
 *
 * plot_background: figsize (16, 12), dpi 200, ax.set_extent([lons.min()+1., lons.max()-2, lats.min(), lats.max()], crs=PlateCarree)
 *
 * Centro-Sul: mapa ≈ 2038×1850 px, left = 19 px (fixo).
 * Paraná (domínio separado no bucket): mapa ≈ 2202×1196 px, left = 19 px (fixo).
 */

/** Distância do topo do JPG até o topo do retângulo preto do mapa (varia com título/superscript). */
export const WRF_CENTRO_SUL_TOP_PX: Record<string, number> = {
  mdbz: 100,
  T2m: 104,
  Td_2m: 104,
  Thetae_2m: 104,
  hrt01km: 109,
  hrt03km: 109,
  mucape: 100,
  mlcape: 100,
  sblcl: 100,
  mllr: 103,
  scp: 100,
  stp: 100,
};

export const WRF_PARANA_TOP_PX: Record<string, number> = {
  mdbz: 345,
  T2m: 346,
  Td_2m: 346,
  Thetae_2m: 346,
  hrt01km: 356,
  hrt03km: 356,
  mucape: 345,
  mlcape: 345,
  sblcl: 345,
  mllr: 345,
  scp: 345,
  stp: 345,
};

/**
 * Largura/altura do retângulo do mapa em pixels (altura e left fixos; a largura útil em X vem de
 * naturalWidth − left − rightMarginPx(variable) — ver medições por produto).
 */
export const WRF_CENTRO_SUL_MAP_PX = { width: 2038, height: 1850, left: 19 } as const;
export const WRF_PARANA_MAP_PX = { width: 2202, height: 1196, left: 19 } as const;

/**
 * Pixels reservados à direita do eixo (colorbar + rótulos). Medições em JPG do bucket; variam por produto.
 * dataWidthPx = naturalWidth − left − rightMarginPx (não usar largura fixa + trim pequeno).
 */
export const WRF_CENTRO_SUL_RIGHT_MARGIN_PX: Record<string, number> = {
  mdbz: 82,
  T2m: 106,
  Td_2m: 106,
  Thetae_2m: 101,
  hrt01km: 128,
  hrt03km: 128,
  mucape: 122,
  mlcape: 122,
  sblcl: 122,
  mllr: 92,
  scp: 106,
  stp: 106,
};

export const WRF_PARANA_RIGHT_MARGIN_PX: Record<string, number> = {
  mdbz: 90,
  T2m: 112,
  Td_2m: 112,
  Thetae_2m: 108,
  hrt01km: 132,
  hrt03km: 132,
  mucape: 128,
  mlcape: 128,
  sblcl: 128,
  mllr: 100,
  scp: 112,
  stp: 112,
};

const DEFAULT_RIGHT_MARGIN_CENTRO_SUL = 122;
const DEFAULT_RIGHT_MARGIN_PARANA = 128;

export function rightMarginPxCentroSul(variable: string): number {
  const key = variable || 'mdbz';
  return WRF_CENTRO_SUL_RIGHT_MARGIN_PX[key] ?? DEFAULT_RIGHT_MARGIN_CENTRO_SUL;
}

export function rightMarginPxParana(variable: string): number {
  const key = variable || 'mdbz';
  return WRF_PARANA_RIGHT_MARGIN_PX[key] ?? DEFAULT_RIGHT_MARGIN_PARANA;
}

export function topPxForVariable(
  domain: 'centro-sul' | 'parana',
  variable: string
): number {
  const key = variable || 'mdbz';
  if (domain === 'parana') {
    return WRF_PARANA_TOP_PX[key] ?? 345;
  }
  return WRF_CENTRO_SUL_TOP_PX[key] ?? 100;
}
