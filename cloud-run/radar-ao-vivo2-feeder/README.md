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
| `SYNC_SLUGS` | lista fixa | CSV opcional de slugs |

## Slugs suportados

- CPTEC: `cangucu`, `chapeco`, `gama`, `lontras`, `morroigreja`, `picocouto`, `santiago`, `saoroque`
- Fonte única (sem histórico na API): `ipmet-bauru`, `climatempo-poa`

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
