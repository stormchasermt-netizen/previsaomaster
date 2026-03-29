/**
 * Referências para validação do catálogo (CPTEC, WebMET Argentina).
 * Imagens REDEMET no app: CDN estático + `plota_radar.php` em `/api/radar-redemet-find` — ver `docs/radaresv2.txt`.
 */

/** CPTEC Nowcasting — lista de imagens recentes por radar (evita adivinhar timestamp). */
export const CPTEC_RADAR_IMAGES_API = (radarId: number, nomeRadar: string, quantidade = 50) =>
  `https://nowcasting.cptec.inpe.br/api/camadas/radar/${radarId}/imagens?quantidade=${quantidade}&nome=${encodeURIComponent(nomeRadar)}`;

/** WebMET / OHMC — Argentina: inventário de radares (centro, raio, retângulo da imagem). */
export const ARGENTINA_WEBMET_RADARES_JSON =
  'https://webmet.ohmc.ar/api_radares/radares/?format=json';

/** WebMET — metadados de imagens (uso limitado no site público; ver doc). */
export const ARGENTINA_WEBMET_IMAGES_JSON =
  'https://webmet.ohmc.ar/api_radares/images_radares/?format=json';
