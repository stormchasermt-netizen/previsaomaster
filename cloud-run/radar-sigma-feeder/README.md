# radar-ao-vivo2-feeder

Microserviço Node.js (Express + TypeScript) para **Cloud Run** + **Cloud Scheduler**.

- **`POST /sync`** — Para cada radar **CPTEC**, monta URLs no padrão do CDN (`R{id}_{YYYYMMDDHHmm}.png` em `YYYY/MM/`, ver RadarFullv3): **PPI** (`ppi/ppicz` + ID reflectividade) e, por defeito, **Doppler** (`ppi/ppivr` + ID velocidade, distinto do PPI). Tenta ainda **vários hosts** (`s1`…`s3`, `s0`) se o do catálogo falhar. Grava `slug/{ts12}.png` (PPI) e `slug/{ts12}-ppivr.png` (Doppler). Desliga Doppler com `CPTEC_FETCH_DOPPLER=false`. **IPMet** / **Climatempo** continuam com uma imagem por execução.
- **`POST /cleanup`** — Lista objetos `slug/YYYYMMDDHHmm.png` e **apaga** os em que o timestamp do radar (UTC) no nome é **mais antigo** que `RETENTION_MINUTES` (por defeito 60).

A app Next.js lê o mesmo bucket em `/api/radar-ao-vivo2`.

## Variáveis de ambiente

| Variável | Default | Descrição |
|----------|---------|-----------|
| `GCS_BUCKET` | `radar_ao_vivo_2` | Bucket de destino |
| `CRON_SECRET` | — | Protege `/sync` e `/cleanup` |
| `SYNC_WINDOW_MINUTES` | `60` | Janela de busca CPTEC (minutos para trás) |
| `SYNC_STEP_MINUTES` | `5` | Passo ao percorrer a janela |
| `RETENTION_MINUTES` | `60` | Idade máxima do timestamp no nome do ficheiro antes de apagar |
| `SYNC_SLUGS` | ver `DEFAULT_SYNC_SLUGS` em `src/radarFetch.ts` | CSV opcional de slugs (substitui a lista por defeito) |

## Slugs suportados

A lista por defeito (`DEFAULT_SYNC_SLUGS`) cobre as pastas do bucket `radar_ao_vivo_2` alinhadas a `lib/cptecRadarStations.ts` (DECEA, SIPAM, FUNCEME, INEA, CEMADEN, REDEMET, etc.).

- **Fontes especiais** (não CDN CPTEC): `ipmet-bauru` (Cloud Function), `climatempo-poa` (URL estática).
- **Sem feed CPTEC neste serviço** (`SLUGS_WITHOUT_CDN_SYNC`): `almeirim`, `picos`, `usp-itaituba` — o **sync** ignora; o **cleanup** continua a apagar ficheiros antigos nesses prefixos se existirem.
- **Pasta GCS ≠ URL CDN**: `riobranco` grava em `riobranco/` mas descarrega do CDN em `rio-branco`.
- **REDEMET (DECEA)**: pastas `redemet-be`, `redemet-sg`, … — imagens via `plota_radar.php` + maxcappi (ver `downloadRedemetImagesInWindow` em `src/radarFetch.ts`). **No consola GCS não existe pasta vazia**: o prefixo `redemet-xx/` só aparece depois do **primeiro** `YYYYMMDDHHmm.png` gravado com sucesso.

### Não vejo `redemet-*` no bucket

1. **Deploy** — O serviço Cloud Run em produção tem de correr uma **imagem com este código** (com bloco `redemet-*` em `DEFAULT_SYNC_SLUGS` e ramo `slug.startsWith('redemet-')` em `index.ts`). Sem redeploy, o job antigo nunca grava REDEMET.
2. **`SYNC_SLUGS`** — Se definiste esta variável à mão (lista antiga), pode **não incluir** `redemet-be`, … Remove a variável ou acrescenta todos os `redemet-*` necessários.
3. **Testar um só radar** — `POST /sync?slug=redemet-sg` (com `x-cron-secret`) processa só essa pasta e é útil para validar credenciais + API DECEA.
4. **Erros** — `GET /health` → `lastAutoError` se o ciclo automático falhar (timeout, 403 no bucket, etc.).

## Execução automática (sem comandos manuais)

Com o servidor **a correr** (`npm run dev` ou Cloud Run), por defeito **`ENABLE_AUTO_JOBS=true`**:

1. Após `AUTO_JOB_START_DELAY_MS` (8 s), corre o **1.º ciclo**: `sync` (última 1 h, PPI + Doppler) + `cleanup` (apaga ficheiros com hora do radar com mais de 1 h).
2. Repete a cada **`AUTO_JOB_INTERVAL_MS`** (5 min por defeito).

Para desligar só para testes manuais: `ENABLE_AUTO_JOBS=false`.

`GET /health` devolve `autoJobs`, `lastSyncAt`, `lastCleanupAt`, `lastAutoError`.

Em **Cloud Run**, para o serviço não adormecer (min instances 0), o timer pode parar entre instâncias — para 24/7 fiável, use **min instances ≥ 1** ou mantenha **Cloud Scheduler** a bater em `/sync` como backup.

## Local

```bash
cd cloud-run/radar-ao-vivo2-feeder
npm install
cp .env.example .env
# CRON_SECRET, gcloud auth application-default login no projeto certo
npm run dev
```

Com jobs automáticos ativos, não precisas de `Invoke-WebRequest` — opcional para forçar:

```powershell
Invoke-WebRequest -Method Post -Uri "http://localhost:8080/sync" -Headers @{"x-cron-secret"="SEU_TOKEN"} -UseBasicParsing
```

## Deploy (Cloud Run)

A service account precisa de **criar** objetos no bucket (`Storage Object Creator` ou `Admin`) e **apagar** no `/cleanup` (`Object Admin` ou papel com `storage.objects.delete`).

```bash
npm run build
gcloud run deploy radar-ao-vivo2-feeder --source . --region us-central1 \
  --service-account SA@PROJ.iam.gserviceaccount.com \
  --set-env-vars GCS_BUCKET=radar_ao_vivo_2,CRON_SECRET=...,SYNC_WINDOW_MINUTES=60,RETENTION_MINUTES=60
```

## Cloud Scheduler (dois jobs)

1. **`/sync`** — ex.: a cada 5–10 min (preencre janela + novos frames).
2. **`/cleanup`** — ex.: a cada 10–15 min (remove ficheiros com radar time &gt; 1 h).

A app Next.js (App Hosting) continua só com **Storage Object Viewer** no bucket.

## Porta 8080 ocupada

Outro processo já usa a porta. Para o feeder: `set PORT=8081` e chama `http://localhost:8081/sync`.
