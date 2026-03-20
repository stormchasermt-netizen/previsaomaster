const functions = require('firebase-functions');

exports.getRadarIPMet = functions.https.onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*'); 

    // 1. Voltamos para VERSION 1.3.0 e CRS EPSG:4326 (os únicos que o IPMet aceita sem erro)
    // 2. Ajustamos o WIDTH para 924 e HEIGHT para 1000. 
    // Essa pequena diferença de "proporção" vai cancelar o esticamento e deixar a chuva RETA.
    const url = "https://www.ipmetradar.com.br/cgi-bin/mapserv.cgi?map=/home/webadm/alerta/dados/ppi/last.map&SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&FORMAT=image/png&TRANSPARENT=true&LAYERS=merged&STYLES=&TILED=true&MAP_RESOLUTION=112.5&WIDTH=924&HEIGHT=1000&CRS=EPSG%3A4326&BBOX=-26.5,-54.0,-18.5,-46.0";

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                "Referer": "https://www.ipmetradar.com.br/2cappiGis/dist/2cappiGis.html",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36"
            }
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

    } catch (error) {
        res.status(500).send(`Erro na função: ${error.message}`);
    }
});

// --- RADAR USP (CAPITAL E GRANDE SP - Pelletron 36km) ---
exports.getRadarUSP = functions.https.onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');

    const url = "https://www.starnet.iag.usp.br/img_starnet/Radar_USP/pelletron_36km/last/pelletron_cz_36km_05deg_last.png";

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                "Referer": "https://chuvaonline.iag.usp.br/",
                "User-Agent": "Mozilla/5.0 (compatible; tornado-tracks-radar/1.0)"
            }
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
    } catch (error) {
        res.status(500).send(`Erro ao buscar radar USP: ${error.message}`);
    }
});