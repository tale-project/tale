---
title: Compose selbst fahren
description: Der Produktions-Compose-Vertrag — Netze, Aliase, Probes, Volumes — damit du den Stack ohne CLI selbst schreibst.
---

Diese Seite ist, was ein Stack reproduzieren muss, wenn du Compose oder Kubernetes selbst schreibst statt `tale deploy` zu laufen: welche Services Zustand halten, die DNS-Namen, die Probes, die Volumes. Der CLI-Weg bleibt in [Quickstart](/de/self-hosted/install/quickstart) und [Upgrades](/de/self-hosted/operate/upgrades).

## Wann dieser Weg der richtige ist

Nimm die CLI, wenn du sie fahren kannst. Nimm diese Seite, wenn du Compose schreibst, oder wenn du denselben Vertrag auf Kubernetes abbildest.

| Diese Seite, wenn | Die CLI, wenn |
| ----------------- | ------------- |
| Du Produktions-Compose schreibst oder ein Cluster-Mapping — Air-Gap, bestehende Automation, keine CLI auf dem Host | [Quickstart](/de/self-hosted/install/quickstart) plus `tale deploy`, wenn du Blue-Green, `tale backup` und `tale rollback` willst |

Es gibt kein offizielles Helm-Chart.

## Mit Zustand und ohne

Zehn Services, zwei Arten. Wer Zustand hält, trägt Platten und feste Identität — erzeugst du sie neu, verlierst du Daten oder bricht DNS. Zustandslose Services sind austauschbare Replicas eines Images; die erzeugst du beim Upgrade in place neu. Eine Compose-Datei ist der Default. Getrennte Dateien oder Kubernetes gehören dir, solange die DNS-Namen, das isolierte Sandbox-Netz und die Boot-Reihenfolge bleiben.

```mermaid
flowchart TB
  subgraph stateful [Mit Zustand]
    proxy[proxy]
    db[db]
    store[object-store]
    sandbox[sandbox]
    egress[sandbox-egress]
    gw[sandbox-llm-gateway]
    bg[bgutil-provider]
  end
  subgraph stateless [Ohne Zustand]
    platform[platform]
    api[backend-api]
    worker[backend-worker]
  end
  proxy --> platform
  proxy --> api
  api --> db
  api --> store
  api --> sandbox
  api --> gw
  worker --> db
  worker --> bg
  sandbox --> egress
  sandbox --> gw
```

`sandbox-llm-gateway` ist der Harness-Pfad: die API provisioniert ihn, und ein Session-Container erreicht ihn als `llm-gateway`. `bgutil-provider` ist der YouTube-PO-Token-Sidecar des Workers und best-effort — Video-Link-Ingest fällt ohne ihn zurück.

Die drei zustandslosen Services teilen sich ein Image (`ghcr.io/tale-project/tale/tale-platform:<version>`). `TALE_ROLE` wählt beim Boot `api` oder `worker`; der Web-Tier ist dasselbe Image ohne diese Rolle. Pinne jedes `tale-*`-Image auf denselben Release-Tag, damit die Wire-Contracts nicht auseinanderlaufen.

| Art | Services |
| --- | -------- |
| Mit Zustand | `proxy`, `db`, `object-store`, `sandbox`, `sandbox-egress`, `sandbox-llm-gateway`, `bgutil-provider` |
| Ohne Zustand | `platform`, `backend-api`, `backend-worker` |

## Die Images

Jedes `tale-*`-Image liegt in der GitHub Container Registry unter demselben Release-Tag, eine Versionsnummer pinnt also den ganzen Stack. Zwei Services fahren Upstream-Images mit eigenen Versionen.

| Service | Image |
| ------- | ----- |
| `platform`, `backend-api`, `backend-worker` | `ghcr.io/tale-project/tale/tale-platform:<version>` |
| `proxy` | `ghcr.io/tale-project/tale/tale-proxy:<version>` |
| `db` | `ghcr.io/tale-project/tale/tale-db:<version>` |
| `sandbox` | `ghcr.io/tale-project/tale/tale-sandbox:<version>` |
| `sandbox-egress` | `ghcr.io/tale-project/tale/tale-sandbox-egress:<version>` |
| `sandbox-llm-gateway` | `ghcr.io/tale-project/tale/tale-sandbox-llm-gateway:<version>` |
| `object-store` | `quay.io/minio/minio:RELEASE.2025-04-22T22-12-26Z` |
| `bgutil-provider` | `brainicism/bgutil-ytdlp-pot-provider:1.3.1` |

Ein Image ist kein Compose-Service: Der Spawner erzeugt jeden Session-Container aus `ghcr.io/tale-project/tale/tale-sandbox-runtime:<version>`, und sein eingebauter Default ist der lokale Tag, den der Entwicklungs-Stack baut — ein Host, der ihn nie gebaut hat, nennt das Registry-Image in `SANDBOX_RUNTIME_IMAGE`, sonst scheitern `Run code`, Web-Rendering und Dokumentgenerierung an einem fehlenden Image. Zieh dieses Image selbst, bevor du das erste Mal hochfährst. Der Spawner wärmt es beim Boot vor und antwortet auf `:8003` erst, wenn der Pull durch ist — auf einem kalten Host steht die Sandbox also so lange auf `starting`, wie mehrere Gigabyte brauchen; `tale deploy` zieht es genau deshalb vor dem Stack.

Jedes Beispiel unten liest seinen Tag aus einer Variablen, damit in einem Stack nie eine 0.5.11-API neben einem 0.5.9-Proxy steht:

```bash
# .env — the one line that pins all seven tale-* images
VERSION=0.5.11
```

`0.5.11` ist der Release, gegen den diese Seite geschrieben wurde, keine Empfehlung. Installier den aktuellen: seine Nummer steht auf der Seite [latest release](https://github.com/tale-project/tale/releases/latest), und genau die gehört in `VERSION`. Compose setzt sie aus der `.env` im Projektverzeichnis ein — derselben Datei, die deine Secrets trägt.

## Die zustandslosen Services

Unten stehen die drei zustandslosen Rollen — Aliase, `/ping` als Liveness, `TALE_ROLE`, `NET_ADMIN`. Leg die Services mit Zustand in dieselbe Datei oder woanders hin; die Tabellen auf dieser Seite sagen, was sie trotzdem tun müssen. Pinne den Image-Tag und füll `.env` aus der [Umgebungsreferenz](/de/self-hosted/configuration/environment-reference).

```yaml
# Stateless app tier. No container_name: --scale needs free names.
# Add db, proxy, sandbox, … in this file or another — your call. In one file,
# add depends_on: { db: { condition: service_healthy }, … } as well.
services:
  platform:
    image: ghcr.io/tale-project/tale/tale-platform:${VERSION}
    env_file: [.env]
    volumes: ['config-data:/app/data:ro']
    restart: unless-stopped
    stop_grace_period: 45s
    healthcheck:
      test:
        [
          'CMD-SHELL',
          'curl -sf http://localhost:3000/api/health && [ -f /tmp/platform-ready ]',
        ]
      interval: 5s
      timeout: 3s
      retries: 3
      start_period: 180s
    networks:
      internal:
        aliases: [platform]
  backend-api:
    image: ghcr.io/tale-project/tale/tale-platform:${VERSION}
    environment:
      TALE_ROLE: api
      PORT: '3005'
      TALE_CONFIG_DIR: /app/data
      DATABASE_URL: postgresql://tale:${DB_PASSWORD}@db:5432/tale_app
      SANDBOX_URL: http://sandbox:8003
      SANDBOX_HTTP_API_BASE_URL: http://backend-api:3005
      OBJECT_STORE_ENDPOINT: http://object-store:9000
    env_file: [.env]
    volumes: ['config-data:/app/data']
    cap_add: [NET_ADMIN]
    restart: unless-stopped
    healthcheck:
      test: ['CMD-SHELL', 'curl -sf http://localhost:3005/ping']
      interval: 10s
      timeout: 3s
      retries: 3
      start_period: 30s
    networks:
      internal:
        aliases: [backend-api]
      sandbox:
        aliases: [backend-api]
  backend-worker:
    image: ghcr.io/tale-project/tale/tale-platform:${VERSION}
    environment:
      TALE_ROLE: worker
      TALE_CONFIG_DIR: /app/data
      DATABASE_URL: postgresql://tale:${DB_PASSWORD}@db:5432/tale_app
      SANDBOX_URL: http://sandbox:8003
      SANDBOX_HTTP_API_BASE_URL: http://backend-api:3005
      OBJECT_STORE_ENDPOINT: http://object-store:9000
    env_file: [.env]
    volumes: ['config-data:/app/data']
    cap_add: [NET_ADMIN]
    restart: unless-stopped
    healthcheck: { disable: true }
    networks: [internal]
volumes:
  config-data:
networks:
  internal:
  sandbox:
    name: tale-sandbox-net
    internal: true
    enable_ipv6: false
```

Es gibt kein eingechecktes Produktions-Compose zum Kopieren. Die CLI erzeugt ein geteiltes Dateipaar und löscht es nach `up`. Deine Datei muss nicht so aussehen.

## Secrets, die du vor dem ersten Boot erzeugst

`tale init` erzeugt jedes Secret und schreibt die `.env`; ohne die CLI ist das dein Job. Die [Umgebungsreferenz](/de/self-hosted/configuration/environment-reference) sagt, was jede Variable tut — die fünf unten sind die, die ein selbst gebauter Stack am häufigsten vergisst, weil die Beispieldatei sie auskommentiert lässt, damit die CLI sie füllt.

| Variable | Wert | Was ohne sie bricht |
| -------- | ---- | ------------------- |
| `SANDBOX_TOKEN` | `openssl rand -hex 32` | Der Spawner beendet sich beim Start. Er hält den Docker-Socket des Hosts und antwortet jedem Session-Container, also gibt es keinen unsignierten Modus; das Backend signiert jeden Spawner-Aufruf mit demselben Wert. |
| `OBJECT_STORE_ACCESS_KEY` | `tale` oder ein eigener Name | Das Backend loggt beim Boot `object store (skipped)` und verweigert jeden Upload. Einen Image-Default dafür gibt es nicht — der Root-User des Stores trägt denselben Wert. |
| `OBJECT_STORE_SECRET_KEY` | `openssl rand -hex 32` | Dasselbe Überspringen, dieselbe Stille. Rotierst du ihn später, verwaisen alle Blobs, die unter dem alten Credential geschrieben wurden. |
| `OBJECT_STORE_PUBLIC_ENDPOINT` | deine `SITE_URL` | Uploads scheitern im Browser mit einem Netzwerkfehler: Die presignte URL, die das Backend ausgibt, zeigt auf das interne `http://object-store:9000`, das kein Browser erreicht. |
| `SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD` | `openssl rand -hex 32` | Jeder Agent-Run scheitert mit „the agent run could not start". Die Management-API des Gateways hängt mit im Sandbox-Netz, deshalb ruft das Backend sie nie anonym auf — und ohne Management-Aufruf gibt es keinen Session-Virtual-Key, also startet kein Harness-Turn. Der Username ist per Default `admin` (`SANDBOX_LLM_GATEWAY_ADMIN_USERNAME`). |

Den Public-Endpoint bringst du vor dem Start in Ordnung, nicht danach. Das Backend seedet die Deployment-Default-Blob-Verbindung beim ersten Boot ins Config-Volume (`default/object-storage/connection.json`) und überschreibt einen bereits vorhandenen Default nie — die Variable auf einer schon gebooteten Instanz zu setzen, ändert also nichts. Zum Reparieren trägst du `"publicEndpoint": "<deine SITE_URL>"` in diese Datei ein und startest das Backend neu.

Das Gateway-Passwort ist das andere, das beim ersten Mal sitzen muss. Das Gateway hasht es bei der ersten Nutzung in sein eigenes `llm-gateway-data`-Volume und prüft von da an dagegen — ein später geänderter Wert lässt das Backend mit einem 401 stehen, aus dem es nicht mehr herausredet. Der Weg zurück ist, dieses Volume zu löschen, und damit auch jeden Virtual Key darin.

## Netze und DNS-Namen

Zwei Docker-Netze tragen jeden Hop. Ein gewöhnliches Compose-Netz reicht für die interne Ebene. Die Sandbox-Bridge muss `tale-sandbox-net` heißen und `internal` sein, damit der Spawner `docker run --network tale-sandbox-net` kann und ein Session-Container das Internet nicht ohne `sandbox-egress` erreicht. Eine Bridge ohne `internal` ist ein offener Weg nach draußen.

| Name, den der Prozess auflöst | Wer antwortet | Netze |
| ----------------------------- | ------------- | ----- |
| `backend-api` | Jede gesunde API-Replica, die noch hängt | `internal`, `sandbox` |
| `platform` | Jede gesunde Web-Tier-Replica, die noch hängt | `internal` |
| `knowledge-db` | Der `db`-Service (Produktion faltet den Korpus in dasselbe Postgres) | `internal` |
| `object-store` | MinIO | `internal` |
| `sandbox` | Der Sandbox-Spawner | `internal`, `sandbox` |
| `sandbox-egress` | Der Egress-Proxy | `internal`, `sandbox` |
| `llm-gateway` | `sandbox-llm-gateway` | `internal`, `sandbox` |
| `bgutil-provider` | Der YouTube-PO-Token-Sidecar des Workers, den er standardmäßig unter `http://bgutil-provider:4416` erreicht | `internal` |
| `HOST` (dein öffentlicher Hostname) | `proxy`, damit ein Container zur öffentlichen URL hairpinnen kann | `internal` |

Worker haben keinen geteilten Alias. Nichts adressiert einen Worker per Name; sie holen Jobs nur aus der Queue. Farb-suffigierte Aliase (`backend-api-blue`, `platform-green`) sind nur für ein Blue-Green, während zwei Versionen gleichzeitig oben sind.

Der Proxy schickt App-API-Lanes an `backend-api:3005` (`BACKEND_UPSTREAM`). `/api/health` und die SPA gehen an `platform:3000`, und er prüft `platform` auf `/api/health`. Fällt diese Probe auf einer drainenden Web-Replica aus, markiert Caddy die ganze Site als down.

## Volumes

Nenn diese logischen Volumes in deinem Compose. Eine Datei kann Compose sie anlegen lassen. Markier sie nur als external, wenn etwas außerhalb dieser Datei dieselben Disks mounten muss.

| Volume | Wer mountet | Was drauf liegt |
| ------ | ----------- | --------------- |
| `config-data` | Backend lesen/schreiben, Platform nur lesen, Sandbox nur lesen unter `/app/platform-config` | Org-Config: Agents, Skills, Anbieter, Governance, SSO, Branding |
| `db-data` | `db` unter `/var/lib/postgresql/data` | `tale_app` und `tale_knowledge` |
| `db-backup` | `db` unter `/var/lib/postgresql/backup` | Postgres-Backup-Ziel im Container |
| `object-store-data` | `object-store` unter `/data` | Blobs |
| `caddy-data`, `caddy-config` | `proxy` unter `/data` und `/config` | Zertifikate und Caddy-Zustand |
| `llm-gateway-data` | `sandbox-llm-gateway` unter `/app/data` | Virtuelle Keys pro Session |

Instanzen, die vor 0.5.11 upgraded wurden, haben neben `config-data` oft noch ein `convex-data`-Volume. Die CLI kopiert den Store einmal rüber und löscht das alte Volume nie. Ein handgeschriebenes First-Boot auf einem frischen Host braucht `convex-data` nicht.

## Health-Probes

Liveness und Readiness sind verschiedene Fragen. Wer sie vertauscht, schneidet eine drainende Replica aus dem DNS, bevor In-flight-Arbeit fertig ist — oder lässt eine unfertige Replica im Pool.

Die Kommando-Spalte ist das, was der ausgelieferte Stack ausführt — jedes Kommando nutzt einen Client, den es in diesem Image auch gibt.

| Service | Probe | Was sie bedeutet |
| ------- | ----- | ---------------- |
| `backend-api` | `curl -sf http://localhost:3005/ping` | Liveness. Bleibt 200, während die Replica drainet. Docker und Caddy nutzen das. |
| `backend-api` | `GET /ready` auf `:3005` | Readiness. 503, sobald diese Replica drainet. Der Deploy fragt das; Docker und Caddy nicht. |
| `platform` | `curl -sf http://localhost:3000/api/health && [ -f /tmp/platform-ready ]` | Bereit, die SPA zu servieren. Halt das auf 200, solange die Replica den `platform`-Alias noch hält. |
| `backend-worker` | Keine | Der Worker exponiert kein HTTP. Schalt den eingebackenen Web-Healthcheck des Images aus, sonst gilt die Replica dauerhaft als unhealthy. |
| `proxy` | `curl -sf http://127.0.0.1:2020/health` | Caddy-Admin-Health. |
| `db` | `pg_isready -U tale && [ -f /tmp/.db_ready ]` | Postgres nimmt Verbindungen an und Init ist fertig (Wissensdatenbank und Extensions). `start_period` 120s. Stopp den Container mit `SIGINT`, nicht `SIGTERM`. |
| `object-store` | `mc ready local` | MinIO nimmt Writes an. |
| `sandbox` | `curl -fsS http://127.0.0.1:8003/health` | Spawner ist oben. `start_period` 15s, sobald das Runtime-Image auf dem Host liegt — lang genug für den Pull, wenn nicht. Veröffentliche diesen Port nicht auf einem öffentlichen Host. |
| `sandbox-egress` | `nc -z 127.0.0.1 3128` | tinyproxy lauscht. Probe kein externes Host. |
| `sandbox-llm-gateway` | `wget -q -O /dev/null http://127.0.0.1:8080/health` | Gateway ist oben. Das Image bringt busybox-`wget` mit und kein `curl`. |

Zwei davon bestrafen die naheliegende Vermutung, und beide scheitern so, dass der Fehler auf den falschen Container zeigt. Eine `curl`-Probe auf dem Gateway endet mit 127 (`/bin/sh: curl: not found`), und der Container verlässt `starting` nie — obwohl er die ganze Zeit bedient; weil `sandbox` und `backend-api` mit `condition: service_healthy` auf ihn warten, bricht `docker compose up` mit `dependency failed to start` ab, an einem Stack, an dem nichts kaputt ist. Die Sandbox hat dieselbe Form aus einem anderen Grund: Solange sie das Runtime-Image vorwärmt, schweigt sie auf `:8003` — eine `start_period`, die für einen warmen Host passt, markiert sie beim ersten Boot eines kalten als unhealthy.

## Env, die Compose setzen muss

Die [Umgebungsreferenz](/de/self-hosted/configuration/environment-reference) ist jede Variable, die der Prozess aus `.env` liest. Die Zeilen darunter muss die Compose-Datei selbst setzen — Image-Defaults zeigen den Prozess auf den falschen Host.

| Name | Wert auf einem Produktions-Stack |
| ---- | -------------------------------- |
| `TALE_ROLE` | `api` auf `backend-api`, `worker` auf `backend-worker`. Unset auf `platform`. |
| `PORT` | `3005` auf der API. Der Proxy-Default für `BACKEND_UPSTREAM` ist `backend-api:3005`. |
| `TALE_CONFIG_DIR` | `/app/data` |
| `DATABASE_URL` | `postgresql://tale:${DB_PASSWORD}@db:5432/tale_app` — oder ein Postgres von dir, siehe [Speicher, die du schon hast](#speicher-die-du-schon-hast). |
| `SANDBOX_URL` | `http://sandbox:8003` |
| `SANDBOX_HTTP_API_BASE_URL` | `http://backend-api:3005` |
| `OBJECT_STORE_ENDPOINT` | `http://object-store:9000` — oder dein eigener S3-Endpoint; für AWS S3 selbst lässt du ihn leer. |
| `SANDBOX_EGRESS_NETWORK` | `tale-sandbox-net` |
| `SANDBOX_EGRESS_PROXY` | `http://sandbox-egress:3128` |
| `SANDBOX_TOKEN` | Überall derselbe Wert. `sandbox` startet ohne ihn nicht; das Backend signiert seine Spawner-Aufrufe damit. |
| `SANDBOX_RUNTIME_IMAGE` | `ghcr.io/tale-project/tale/tale-sandbox-runtime:<version>` auf `sandbox`. Der Default ist ein lokaler Build-Tag, den ein Produktions-Host nicht hat. |
| `BACKEND_UPSTREAM` | `backend-api:3005` auf `proxy`. |
| `OBJECT_STORE_UPSTREAM` | `object-store:9000` auf `proxy`, damit presignte URLs unter `/<bucket>/*` weitergereicht werden. |
| `OBJECT_STORE_BUCKET` | Standardmäßig `tale-blobs`. Benennst du ihn um, muss derselbe Name `proxy` und beide Backend-Rollen erreichen. |
| `OBJECT_STORE_ACCESS_KEY`, `OBJECT_STORE_SECRET_KEY` | Kein Image-Default. Fehlt einer von beiden, konfiguriert das Backend gar keinen Blob-Store und lehnt jeden Upload ab. |
| `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD` | Auf `object-store`: Der Store liest seine eigenen Namen, also mappst du `OBJECT_STORE_ACCESS_KEY` und `OBJECT_STORE_SECRET_KEY` darauf. |
| `TALE_DB_ROLE` | Unset auf der gefalteten `db`. Die Default-Rolle legt `tale_knowledge` an und wendet die Korpus-Migrationen an; `platform` überspringt sie und lässt den Korpus ohne Tabellen. |

## Speicher, die du schon hast

Compose selbst zu schreiben ist auch der Weg, Tale gegen eine Datenbank und einen Object-Store zu
fahren, die du längst betreibst. Drei Variablen entscheiden das, alle bei jedem Start gelesen — jede
davon ist also eine `.env`-Änderung plus ein Neustart von `backend-api` und `backend-worker`, nie
ein Rebuild.

| Speicher | Variable | Service streichen? |
| -------- | -------- | ------------------ |
| Anwendungsdatenbank | `DATABASE_URL` | Ja — `db` fällt weg, mit ihm `db-data` und `db-backup`. |
| Wissens-Korpus | `KNOWLEDGE_DATABASE_URL` | Nur zusammen mit der Anwendungsdatenbank: im Einzelhost-Stack liegen beide im selben `db`-Service. |
| Blobs | `OBJECT_STORE_*` | Ja — `object-store` und `object-store-data` fallen weg, und `proxy` braucht `OBJECT_STORE_UPSTREAM` nicht mehr. |

Streichst du einen Service, streich auch die `depends_on`-Einträge, die auf ihn zeigen — sonst
weigert sich Compose, die Schicht zu starten, die auf einen Container wartet, den es nicht mehr gibt.

<Steps>

<Step title="Die Datenbanken vorbereiten">

Die Anwendungsdatenbank braucht keine Extensions und keinen Superuser — eine Datenbank und eine
Rolle, die Schemata anlegen darf, genügt; das Backend migriert sie beim Start. Der Wissens-Korpus
braucht ein bereits installiertes `pgvector`, denn Tale legt Schemata und Tabellen an, nie
Extensions:

```sql
CREATE DATABASE tale_app;
CREATE DATABASE tale_knowledge;
\c tale_knowledge
CREATE EXTENSION IF NOT EXISTS vector;
-- Optional. Ohne die Extension fällt die hybride Suche auf reine Vektorsuche zurück, statt zu scheitern.
CREATE EXTENSION IF NOT EXISTS pg_search;
```

Richte Tale auf den eigenen Port der Datenbank, nie auf einen Pooler im Transaction-Modus — die
Job-Queue hält `LISTEN`-Verbindungen, der Boot-Migrator einen Session-weiten Advisory-Lock, und
Queries nutzen Prepared Statements.

</Step>

<Step title="Den Bucket vorbereiten">

Leg den Bucket an, oder überlass es Tale: Es prüft zuerst mit `HeadBucket` und legt nur an, was
fehlt — ein Schlüssel, der auf einem von dir bereitgestellten Bucket nur `s3:GetObject`,
`s3:PutObject` und `s3:DeleteObject` darf, reicht also.

Presignte Up- und Downloads laufen im Browser, der Bucket braucht deshalb eine CORS-Policy, die
deinen `SITE_URL`-Origin mit `GET`, `PUT` und `HEAD` zulässt.

</Step>

<Step title="Das Backend darauf richten">

```bash .env
DATABASE_URL=postgresql://tale:...@postgres.internal:5432/tale_app?sslmode=verify-full
KNOWLEDGE_DATABASE_URL=postgresql://tale:...@postgres.internal:5432/tale_knowledge?sslmode=verify-full
POSTGRES_CA_FILE=/run/secrets/postgres-ca.pem

# Für AWS S3 selbst lässt du OBJECT_STORE_ENDPOINT leer.
OBJECT_STORE_ENDPOINT=https://minio.internal
OBJECT_STORE_BUCKET=tale-blobs
OBJECT_STORE_ACCESS_KEY=...
OBJECT_STORE_SECRET_KEY=...
OBJECT_STORE_PUBLIC_ENDPOINT=https://minio.example.com
```

`OBJECT_STORE_PUBLIC_ENDPOINT` ist, wo der *Browser* den Bucket erreicht. Setz es, wenn sich das
vom Endpoint des Backends unterscheidet; erreicht der Browser den Bucket ohnehin, lässt du es leer
und streichst die `/<bucket>/*`-Weiterleitung im Proxy gleich mit.

Mounte das CA-Bundle in beide Backend-Services, wenn du `sslmode=verify-ca` oder `verify-full`
verlangst — verwaltete Anbieter signieren meist mit Roots, die Node nicht mitliefert, und ohne das
Bundle lehnt das Backend die Verbindung beim Start ab, statt still herabzustufen.

</Step>

<Step title="Prüfen, dass es gegriffen hat">

Das Boot-Log sagt, was die Object-Store-Variablen bewirkt haben — `seeded` auf einem frischen
Config-Volume, `reconciled` nach einer Änderung, `skipped`, wenn kein Schlüsselpaar gesetzt ist:

```bash
docker compose logs backend-api | grep 'object store'
```

Danach liest du die Erreichbarkeits-Gauge, die nur dann `1` pro Speicher zeigt, wenn das Backend
wirklich mit ihm sprechen kann:

```bash
curl -s http://backend-api:3005/metrics | grep tale_backend_store_up
```

</Step>

</Steps>

<Warning>

`tale backup` sichert Docker-Volumes. Blobs in einem externen Bucket meldet es und überspringt das
Volume — für eine externe **Datenbank** hat es kein Gegenstück: Zeigt `DATABASE_URL` oder
`KNOWLEDGE_DATABASE_URL` vom Host weg, sieht ein Snapshot vollständig aus und enthält nichts davon.
Sichere diese Datenbanken mit dem Werkzeug deines Anbieters — siehe
[Backups und Restore](/de/self-hosted/operate/backups-and-restore).

</Warning>

## Capabilities und Mounts, die ohne sie brechen

Die sehen optional aus und gehen geschlossen kaputt, wenn sie fehlen.

| Service | Muss haben | Was ohne sie bricht |
| ------- | ---------- | ------------------- |
| `backend-api`, `backend-worker` | `cap_add: [NET_ADMIN]` | Der Entrypoint kann den SSRF-iptables-Zaun nicht setzen (IMDS, Link-Local, RFC1918). |
| `sandbox-egress` | `cap_drop: [ALL]`, dann `NET_ADMIN`, `DAC_OVERRIDE`, `CHOWN`, `SETUID`, `SETGID`, `NET_BIND_SERVICE` | Kein IMDS/RFC1918-Zaun; tinyproxy kann nicht binden oder Privilegien abgeben. |
| `sandbox` | `/var/run/docker.sock` und `/var/lib/tale-sandbox` 1:1 bind-gemountet | Der Spawner kann keine Session-Container anlegen; Workspace-Pfade, die der Daemon mountet, passen nicht. |
| `db` | `stop_signal: SIGINT`, `stop_grace_period: 60s`, `shm_size: 256mb` | Ein `SIGTERM`-Warten-auf-Clients endet in `SIGKILL` und kann den BM25-Index mit einer genullten Page hinterlassen. |
| `platform` | `stop_grace_period: 45s` | Dockers Default-Grace von 10s `SIGKILL`t den Web-Tier mitten im Drain und kappt In-flight-HTTP/SSE. |
| `object-store` | `command: server /data` | Der Entrypoint des Images gibt seine Verwendung aus und endet, der Container serviert also nie und `mc ready local` wird nie grün. |
| `object-store` | Keine veröffentlichten Ports | Presigned URLs laufen durch den Proxy. MinIO zu veröffentlichen ist eine zusätzliche öffentliche Fläche. |

Veröffentliche nur `80` und `443` auf `proxy`. Alles andere bleibt im internen Netz.

## Boot-Reihenfolge

Fahr die Stores zuerst hoch, dann die Sandbox-Ebene, dann den App-Tier. Eine API, die startet, bevor `db` und `object-store` healthy sind, crash-loopt auf `ENOTFOUND` und auf einer fehlenden Datenbank. In einer Datei reicht `depends_on` mit `service_healthy`.

```bash
# The pull is not a compose command, so it needs the tag .env pins in this
# shell too.
VERSION=$(sed -n 's/^VERSION=//p' .env)

# Not a compose service, and the spawner blocks on it at boot — pull it first so
# the sandbox probe is not waiting on several gigabytes.
docker pull "ghcr.io/tale-project/tale/tale-sandbox-runtime:$VERSION"

docker compose up -d
# Wait until db, object-store, proxy, sandbox, sandbox-egress, sandbox-llm-gateway
# report healthy. bgutil-provider is best-effort — YouTube ingest degrades without it.
```

Gib jedem Service eine Restart-Policy (`restart: unless-stopped`). Nichts sonst holt einen Container nach einem Host-Reboot oder einem OOM-Kill zurück, und ein Stack, der einmal bootet und danach nie wieder, ist der Fehler, den Operatoren Wochen später finden.

Schema-Migrationen laufen im Backend beim Boot, unter einem Advisory-Lock. Es gibt keinen eigenen Migrate-Schritt. Eine Replica, die eine Migration nicht anwenden kann, startet nicht; lass die vorherige API laufen, bis die neue healthy ist.

## Kubernetes

Es gibt kein Helm-Chart und kein offizielles Manifest. Map den Docker-Vertrag; erfinde keine zweite Architektur.

| Docker | Cluster |
| ------ | ------- |
| Zustandslos `platform`, `backend-api`, `backend-worker` | Deployments. Dasselbe Image; `TALE_ROLE` wählt den Prozess. Die skalierst du. |
| Mit Zustand `db`, `object-store`, `proxy`, Sandbox-Ebene | StatefulSets (oder gleichwertig) plus die Volumes auf dieser Seite. Lass nicht zwei Schreiber auf eine Disk. |
| Compose-DNS-Namen (`backend-api`, `platform`, `knowledge-db`, `sandbox`, `llm-gateway`, …) | Services mit diesen Namen. Proxy und Sandbox lösen sie auf. |
| `tale-sandbox-net` als `internal` | Eine NetworkPolicy (oder isoliertes CNI), die einem Session-Pod den Weg ins Internet außer durch `sandbox-egress` sperrt. |
| `GET /ping` auf der API | Liveness. Bleibt 200, während die Replica drainet. |
| `GET /ready` auf der API | Die Readiness-Frage deines Rollouts. Zeig den Service nicht auf `/ready`, wenn du drainst. |
| Sandbox-`docker.sock` und `/var/lib/tale-sandbox` 1:1 bind-gemountet | Der harte Teil. Der Spawner legt Session-Container an; der Workspace-Pfad, den der Daemon mountet, muss zum Pfad im Spawner passen. Ein Cluster ohne Docker-Socket (oder ein Äquivalent) kann die Sandbox-Ebene nicht fahren. |
| `cap_add: [NET_ADMIN]` auf dem Backend | Der SSRF-iptables-Zaun. Ohne ihn kann der Entrypoint IMDS und RFC1918 nicht sperren. |

Veröffentliche nur 80 und 443. Lass Postgres, MinIO und den Sandbox-Port von der öffentlichen Service-Liste.

Ein In-place-Recreate der zustandslosen Deployments ist der Default. Zero-Downtime ist ein Rolling Update, den du selbst baust.

## Was du ohne die CLI aufgibst

`tale deploy` ist kein Compose-Up. Die Kommandos darunter haben kein Äquivalent in einer Datei, die du pflegst.

| CLI-Verhalten | Was du stattdessen tust |
| ------------- | ----------------------- |
| Blue-Green-Kipp: inaktive Farbe starten, auf jede Replica warten, alte API drainen, dann `docker network disconnect` | In-place neu erzeugen, oder den Kipp selbst bauen. Disconnect kappt lebende Verbindungen — zuerst drainen. |
| `tale backup` / `tale rollback` | Eigene Volume-Snapshots. Rollback eines Minor oder Major ist ein Snapshot-Restore, keine Down-Migration. |
| Flip-pending-Resume nach einem gekillten Deploy | Dein eigener Satz, welche Farbe live ist. |
| Config-Volume-Kopie von `convex-data` auf einem Host vor 0.5.11 | Den Store selbst kopieren, oder frisch starten. |
| Sandbox-`/v1/drain` vor einem In-place-Spawner-Roll | `SIGTERM` plus 30s Stop-Grace ist die Hintertür; laufende Runs sterben trotzdem, wenn du ohne Drain neu erzeugst. |

Ein In-place-Recreate der zustandslosen Services ist der Default. Zero-Downtime ist der Teil, den du selbst nachbaust.

## Was Produktion nicht tun darf

Die sehen lokal aus und zerlegen eine öffentliche Instanz.

| Nicht | Warum |
| ----- | ----- |
| `5432`, `8003` oder MinIO veröffentlichen | Zusätzliche öffentliche Fläche. Presigned URLs laufen durch den Proxy. |
| Ein zweites Postgres für den Korpus | Produktion faltet `tale_knowledge` in `db` und aliasiert diesen Service `knowledge-db`. |
| Namen auf dem App-Tier pinnen | Replicas können sich keinen Container-Namen teilen. |
| Auf einem öffentlichen Host aus dem Quellcode bauen | Pinne `ghcr.io/tale-project/tale/<image>:<tag>`. |
| Platzhalter-Secrets ausliefern | Generier sie vor dem ersten Up. |
| Session-Containern einen Weg ins Internet geben | Das Sandbox-Netz (oder seine NetworkPolicy) muss isoliert sein. |

## Wo das hingehört

Du hast jetzt den Vertrag: welche Services Zustand halten, zwei Netze, die DNS-Namen, die Proxy und Sandbox auflösen, die Probes, die du nicht tauschen darfst, und was Kubernetes trotzdem tun muss. Die [Umgebungsreferenz](/de/self-hosted/configuration/environment-reference) ist jede Variable, die die Container lesen. [Container-Architektur](/de/self-hosted/operate/container-architecture) ist, was jeder Container besitzt, wenn einer stirbt. Die meisten Teams wollen weiter den [Quickstart](/de/self-hosted/install/quickstart) und `tale deploy` — diese Seite ist der Weg, wenn genau dieser Wrapper das ist, was du nicht fahren kannst.
