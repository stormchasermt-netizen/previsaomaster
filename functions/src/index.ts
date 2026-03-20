/**
 * Cloud Functions - exporta syncLatest, syncHistorical e funções HTTP existentes.
 */

import { onRequest } from 'firebase-functions/v2/https';
import { syncLatestRadarImages } from './syncLatest';
import { syncHistoricalRadarImages, syncHistoricalRadarImagesManual } from './syncHistorical';

export { syncLatestRadarImages, syncHistoricalRadarImages, syncHistoricalRadarImagesManual };

/** getRadarIPMet - proxy WMS IPMet (mantido do index.js original) */
export const getRadarIPMet = onRequest(
  { region: 'us-central1' },
  async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    const url =
      'https://www.ipmetradar.com.br/cgi-bin/mapserv.cgi?map=/home/webadm/alerta/dados/ppi/last.map&SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&FORMAT=image/png&TRANSPARENT=true&LAYERS=merged&STYLES=&TILED=true&MAP_RESOLUTION=112.5&WIDTH=924&HEIGHT=1000&CRS=EPSG%3A4326&BBOX=-26.5,-54.0,-18.5,-46.0';
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Referer: 'https://www.ipmetradar.com.br/2cappiGis/dist/2cappiGis.html',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
        },
      });
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('image')) {
        const errorText = await response.text();
        res.status(500).send(`Erro do IPMet: ${errorText}`);
        return;
      }
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      res.set('Content-Type', 'image/png');
      res.set('Cache-Control', 'public, max-age=300, s-maxage=300');
      res.status(200).send(buffer);
    } catch (error: unknown) {
      res.status(500).send(`Erro na função: ${(error as Error).message}`);
    }
  }
);

/** getRadarUSP - proxy pelletron 36km (mantido do index.js original) */
export const getRadarUSP = onRequest(
  { region: 'us-central1' },
  async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    const url =
      'https://www.starnet.iag.usp.br/img_starnet/Radar_USP/pelletron_36km/last/pelletron_cz_36km_05deg_last.png';
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Referer: 'https://chuvaonline.iag.usp.br/',
          'User-Agent': 'Mozilla/5.0 (compatible; tornado-tracks-radar/1.0)',
        },
      });
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('image')) {
        const errorText = await response.text();
        res.status(500).send(`Erro ao buscar radar USP: ${errorText}`);
        return;
      }
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      res.set('Content-Type', 'image/png');
      res.set('Cache-Control', 'public, max-age=300, s-maxage=300');
      res.status(200).send(buffer);
    } catch (error: unknown) {
      res.status(500).send(`Erro ao buscar radar USP: ${(error as Error).message}`);
    }
  }
);
