/**
 * Constantes de coordenadas V2 extraídas da tabela técnica do CPTEC/INPE (nowcasting).
 * Fonte de referência completa no repositório: `docs/radaresv2.txt` (export da tabela:
 * id, Nome, Raio_km, lon_centro, lat_centro, minLon, minLat, maxLon, maxLat).
 *
 * Conversão para `bounds`: north = maxLat, south = minLat, east = maxLon, west = minLon.
 * Centro no mapa: sempre [lat, lng] como no Leaflet — os valores aqui seguem lat_centro/lon_centro.
 */
export const RADAR_V2_COORDS: Record<string, { lat: number; lng: number; bounds: { north: number; south: number; east: number; west: number } }> = {
  'saofrancisco': {
    lat: -16.017361,
    lng: -44.69525,
    bounds: { north: -13.748636246, south: -18.237812042, east: -42.335361481, west: -47.009944916 }
  },
  'jaraguari': {
    lat: -20.27855,
    lng: -54.47396,
    bounds: { north: -18.014743805, south: -22.503732681, east: -52.047153473, west: -56.837623596 }
  },
  'chapeco': {
    lat: -27.03354,
    lng: -52.598625,
    bounds: { north: -24.7816, south: -29.28548, east: -50.03005, west: -55.1672 }
  },
  'morroigreja': {
    lat: -28.1078451,
    lng: -49.4719928,
    bounds: { north: -25.8599, south: -30.3648, east: -46.8704, west: -52.0632 }
  },
  'portovelho': {
    lat: -8.7075825,
    lng: -63.8892325,
    bounds: { north: -6.46331, south: -10.951855, east: -61.607065, west: -66.1714 }
  },
  'macapa': {
    lat: 0.050085,
    lng: -51.0923775,
    bounds: { north: 2.29129, south: -2.19112, east: -48.849955, west: -53.3348 }
  },
  'santatereza': {
    lat: -19.97280738,
    lng: -40.54523388,
    bounds: { north: -17.725309, south: -22.22030575, east: -38.15125375, west: -42.939214 }
  },
  'tresmarias': {
    lat: -18.207222,
    lng: -45.460556,
    bounds: { north: -15.945045471, south: -20.43413353, east: -43.067661285, west: -47.797908783 }
  },
  'picocouto': {
    lat: -22.4466503,
    lng: -43.2971821,
    bounds: { north: -20.2013, south: -24.701, east: -40.8262, west: -45.7583 }
  },
  'saoroque': {
    lat: -23.598889,
    lng: -47.097778,
    bounds: { north: -21.3348, south: -25.8356, east: -44.6369, west: -49.6153 }
  },
  'santarem': {
    lat: -2.424504,
    lng: -54.7945175,
    bounds: { north: -0.182654, south: -4.666354, east: -52.546435, west: -57.0426 }
  },
  'guaratiba': {
    lat: -22.99324989,
    lng: -43.58794022,
    bounds: { north: -20.74339989, south: -25.24309989, east: -41.12189022, west: -46.05399022 }
  },
  'natal': {
    lat: -5.90448,
    lng: -35.25401,
    bounds: { north: -3.65220499, south: -8.141628265, east: -32.989379883, west: -37.506313324 }
  },
  'quixeramobim': {
    lat: -5.06917,
    lng: -39.2669,
    bounds: { north: -1.47747, south: -8.6533, east: -35.6439, west: -42.8899 }
  },
  'salvador': {
    lat: -12.9025,
    lng: -38.326667,
    bounds: { north: -10.644747734, south: -15.134028435, east: -36.004219055, west: -40.613765717 }
  },
  'maceio': {
    lat: -9.551389,
    lng: -35.770833,
    bounds: { north: -7.296182156, south: -11.785545349, east: -33.480552673, west: -38.036766052 }
  },
  'boavista': {
    lat: 2.8479,
    lng: -60.695705,
    bounds: { north: 5.08991, south: 0.60589, east: -58.44621, west: -62.9452 }
  },
  'tabatinga': {
    lat: -4.2425575,
    lng: -69.93045,
    bounds: { north: -2.00001, south: -6.485105, east: -67.6754, west: -72.1855 }
  },
  'gama': {
    lat: -15.9648935,
    lng: -48.021985,
    bounds: { north: -13.7188, south: -18.2131, east: -45.6527, west: -50.3701 }
  },
  'santiago': {
    lat: -29.2045064,
    lng: -54.9406844,
    bounds: { north: -26.956, south: -31.4619, east: -52.2986, west: -57.5513 }
  },
  'manaus': {
    lat: -3.143476,
    lng: -59.986935,
    bounds: { north: -0.901351, south: -5.385601, east: -57.73637, west: -62.2375 }
  },
  'cruzeirodosul': {
    lat: -7.5884075,
    lng: -72.76509,
    bounds: { north: -5.34457, south: -9.832245, east: -70.49108, west: -75.0391 }
  },
  'cangucu': {
    lat: -31.3821522,
    lng: -52.7126416,
    bounds: { north: -29.1325, south: -33.6406, east: -50.0057, west: -55.3873 }
  },
  'almenara': {
    lat: -16.18919963,
    lng: -40.647541,
    bounds: { north: -13.941618, south: -18.43678125, east: -38.304844, west: -42.990238 }
  },
  'tefe': {
    lat: -3.3672025,
    lng: -64.6886875,
    bounds: { north: -1.12499, south: -5.609415, east: -62.437275, west: -66.9401 }
  },
  'macae': {
    lat: -22.40584946,
    lng: -41.86047745,
    bounds: { north: -20.15599946, south: -24.65569946, east: -39.39442745, west: -44.32652745 }
  },
  'belem': {
    lat: -1.4019665,
    lng: -48.45733,
    bounds: { north: 0.839491, south: -3.643424, east: -46.21216, west: -50.7025 }
  },
  'petrolina': {
    lat: -9.367,
    lng: -40.573,
    bounds: { north: -7.11203622, south: -11.60140419, east: -38.28440094, west: -42.838165283 }
  },
  'fortaleza': {
    lat: -3.7944,
    lng: -38.5575,
    bounds: { north: -0.205189, south: -7.378549, east: -34.94578, west: -42.1691 }
  },
  'saogabriel': {
    lat: -0.139185,
    lng: -67.05253,
    bounds: { north: 2.10202, south: -2.38039, east: -64.80996, west: -69.2951 }
  },
  'lontras': {
    lat: -27.214725,
    lng: -49.4559,
    bounds: { north: -24.9627, south: -29.46675, east: -46.8827, west: -52.029 }
  },
  'saoluiz': {
    lat: -2.595277,
    lng: -44.23476,
    bounds: { north: -0.353362, south: -4.837192, east: -41.98612, west: -46.4834 }
  },
};
