---
title: Compose selbst betreiben
description: Stelle Images, Speicher, Netzwerke, Geheimnisse und Zustandsprüfungen zusammen, wenn dein Team die Orchestrierung übernimmt.
---

Nutze diese Referenz, wenn dein Team Bereitstellungsdateien und Rollout selbst pflegt. Der [CLI-Schnellstart](/de/self-hosted/install/quickstart) ist der kürzere Weg, wenn Tale Dateien erzeugen und Upgrades koordinieren soll. Tale liefert kein offizielles Helm-Chart. Der Sandbox-Spawner unterstützt Docker und Kubernetes; wähle die dazu passende Laufzeit- und Netzwerkkonfiguration.

Dies ist eine Beschreibung des Bereitstellungsvertrags mit Beispiel für die Anwendungsebene, keine vollständige startfertige Compose-Datei. Ergänze und prüfe Speicher-, Proxy- und Sandbox-Dienste vor dem Einsatz des Beispiels.

## Dienstaufteilung wählen

| Gruppe | Dienste | Lebenszyklus |
| --- | --- | --- |
| Replizierbare Anwendung | `platform`, `backend-api`, `backend-worker` | Gleiches Image und Release; Schnittstellen während des Austauschs kompatibel halten. |
| Dauerhafte Speicher und Zugang | `db`, `object-store`, `proxy` | Volumes, Zugangsdaten, Zertifikate und stabile Netzwerknamen beim Austausch erhalten. |
| Gemeinsame Ausführungsdienste | `sandbox`, `sandbox-egress` | Aktive Sitzungen vor dem Austausch berücksichtigen; der Spawner braucht Docker-Daemon und passende Workspace-Pfade. |
| Optionale Video-Unterstützung | `bgutil-provider` | Token-Anbieter ohne Startgarantie; sein Ausfall kann Videoabrufe beeinträchtigen. Das Backend fragt ihn nur mit `VIDEO_INGEST_POT_PROVIDER=true`, was der Referenz-Stack für seine eigenen Dienste setzt. |

Im mitgelieferten Aufbau liegen `tale_app` und `tale_knowledge` in einem Postgres-Dienst mit Alias `knowledge-db`. Separate oder verwaltete Datenbanken sind ebenfalls möglich. Konfiguriere ihre Verbindungen und Sicherungen ausdrücklich. Ein neuer Container zerstört vorhandene Daten nicht automatisch; ein entferntes oder ersetztes Volume kann es tun.

## Kompatible Images festlegen

Setze `VERSION` in der Compose-`.env` auf das geprüfte und getestete Tale-Release. Exportiere denselben Wert in deiner Shell für den separaten Image-Download weiter unten. Verwende für Tale-Images eine gemeinsame Version. Die beiden Dienste mit Upstream-Images haben eigene feste Versionen. Die Schichten der Tale-Images sind mit zstd komprimiert; der Docker-Host braucht deshalb Docker Engine 24.0 oder neuer.

| Dienst | Image |
| --- | --- |
| `platform`, `backend-api`, `backend-worker` | `ghcr.io/tale-project/tale/tale-platform:<version>` |
| `proxy` | `ghcr.io/tale-project/tale/tale-proxy:<version>` |
| `db` | `ghcr.io/tale-project/tale/tale-db:<version>` |
| `sandbox` | `ghcr.io/tale-project/tale/tale-sandbox:<version>` |
| `sandbox-egress` | `ghcr.io/tale-project/tale/tale-sandbox-egress:<version>` |
| `object-store` | `ghcr.io/versity/versitygw:v1.11.0` |
| `bgutil-provider` | `brainicism/bgutil-ytdlp-pot-provider:1.3.1` |

Lege versitygw wie `tale deploy` über seinen Digest fest: `ghcr.io/versity/versitygw:v1.11.0@sha256:8319a530d08d537426e2f855bae5280709795dc73a3f0c347973ef915d6343c5`, mit Images für `linux/amd64` und `linux/arm64`. Ein Stack, der seine Dateien in MinIO hält, nutzt bis zu ihrem [Umzug](#blob-store) `ghcr.io/tale-project/ops/minio:RELEASE.2025-04-22T22-12-26Z`, nur für `linux/amd64`.

Sitzungscontainer nutzen zusätzlich `ghcr.io/tale-project/tale/tale-sandbox-runtime:<version>`. Setze `SANDBOX_RUNTIME_IMAGE` am Spawner und lade es vor dem Start. Sein lokaler Entwicklungstag reicht auf einem Host ohne vorherigen Build nicht aus. Bei Docker-in-Container oder gemeinsamem Build-Cache brauchst du außerdem die kompatiblen Laufzeit- und Cache-Images aus der [Umgebungsreferenz](/de/self-hosted/configuration/environment-reference).

## Geheimnisse und öffentliche Adressen vorbereiten

Erzeuge vor dem ersten Start eigene Werte und bewahre sie in deiner Geheimnisverwaltung auf. Übernimm keine Beispielzugangsdaten einer Entwicklungsumgebung in die Produktion.

| Wert | Anforderung |
| --- | --- |
| `BETTER_AUTH_SECRET` | Stabiles Authentifizierungsgeheimnis mit hoher Entropie. |
| `ENCRYPTION_SECRET_HEX` | 32 Bytes als Hexwert, etwa mit `openssl rand -hex 32` erzeugt; für vorhandene verschlüsselte Datenbankwerte erhalten. |
| `DB_PASSWORD` oder externe Datenbankzugangsdaten | Müssen zur tatsächlich verwendeten Datenbankrolle passen. |
| `SANDBOX_TOKEN` | Dasselbe zufällige Token in Backend und Spawner. |
| `OBJECT_STORE_ACCESS_KEY`, `OBJECT_STORE_SECRET_KEY` | Gültige Speicherzugangsdaten. Das mitgelieferte versitygw erhält sie als `ROOT_ACCESS_KEY` und `ROOT_SECRET_KEY`, dazu `OBJECT_STORE_REGION` als `VGW_REGION`: Eine Anfrage, die für eine andere Region signiert ist, lehnt es ab. MinIO erhält sie als `MINIO_ROOT_USER` und `MINIO_ROOT_PASSWORD`. |
| `OBJECT_STORE_PUBLIC_ENDPOINT` | Vom Browser erreichbarer Endpunkt, meist `SITE_URL`, wenn Tales Proxy den mitgelieferten Speicher weiterleitet. |
| SOPS-age-Identität | Zum Entschlüsseln deiner verschlüsselten Konfigurationsdateien; siehe [Geheimnisse mit SOPS](/de/self-hosted/configuration/secrets-with-sops). |

Das Backend gleicht eine umgebungsverwaltete Standard-Objektspeicherverbindung beim Start ab. Eine Datei mit `managedBy: operator` bleibt bewusst unverändert. Geänderte Speicherzugangsdaten verschieben oder verwaisen Dateien nicht automatisch, müssen aber zwischen Backend und Speicher übereinstimmen.

Setze `HOST`, `SITE_URL` und `TLS_MODE` für den öffentlichen Zugang. [TLS und Domains](/de/self-hosted/configuration/tls-and-domains) erklärt Zertifikate, weitere Ursprünge und Unterpfade.

## Anwendungsebene zusammenstellen

Die drei Rollen teilen sich ein Image. `TALE_ROLE=api` und `TALE_ROLE=worker` wählen Backend-Rollen; beim Webdienst bleibt die Variable ungesetzt. Ein Workspace, den du mit `tale deploy` bereitstellst, führt stattdessen alle drei in einem `platform`-Prozess aus (`TALE_ROLE=all`); diese Seite bleibt bei drei Diensten, die jede Version unterstützt. Vergib kein festes `container_name` für Rollen, die du skalieren willst.

```yaml
# Application-tier fragment; add the stores, proxy, and sandbox services.
# No container_name on replicated services.
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
      DATABASE_URL: ${DATABASE_URL:-postgresql://tale:${DB_PASSWORD:?required}@db:5432/tale_app}
      SANDBOX_URL: http://sandbox:8003
      SANDBOX_HTTP_API_BASE_URL: http://backend-api:3005
      OBJECT_STORE_ENDPOINT: ${OBJECT_STORE_ENDPOINT-http://object-store:9000}
    env_file: [.env]
    volumes: ['config-data:/app/data']
    cap_add: [NET_ADMIN]
    restart: unless-stopped
    stop_grace_period: 30s
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
      DATABASE_URL: ${DATABASE_URL:-postgresql://tale:${DB_PASSWORD:?required}@db:5432/tale_app}
      SANDBOX_URL: http://sandbox:8003
      SANDBOX_HTTP_API_BASE_URL: http://backend-api:3005
      OBJECT_STORE_ENDPOINT: ${OBJECT_STORE_ENDPOINT-http://object-store:9000}
    env_file: [.env]
    volumes: ['config-data:/app/data']
    cap_add: [NET_ADMIN]
    restart: unless-stopped
    stop_grace_period: 120s
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

Einträge unter `environment` haben Vorrang vor `env_file`. Das Beispiel erhält deshalb externe Datenbank- und Objektspeicherwerte, statt interne Adressen zu erzwingen. Nutze in einem Compose-Projekt gesundheitsabhängige Startbedingungen. Bei mehreren Projekten muss dein Orchestrator die Reihenfolge sichern.

## Netzwerknamen und Isolation erhalten

| Adresse | Ziel und Netzwerkanforderung |
| --- | --- |
| `platform` | Webreplikate im internen Anwendungsnetz. Sie erreichen das Backend unter `TALE_BACKEND_URL`, ohne eigene Angabe `http://backend-api:3005`. |
| `backend-api` | API-Replikate in Anwendungs- und Sandbox-Netz, erreichbar auf Port 3005. Sandbox-Sitzungen rufen auf Port 8080 das [Modell-Relay](/de/self-hosted/configuration/environment-reference#model-relay) derselben Replikate auf. |
| `knowledge-db` | Wissens-Postgres oder ein Ziel über `KNOWLEDGE_DATABASE_URL`. |
| `object-store` | Mitgeliefertes versitygw oder MinIO, bis dessen Dateien umgezogen sind, im Anwendungsnetz. |
| `sandbox` | Für das Backend erreichbarer Spawner auf Port 8003. |
| `sandbox-egress` | Für Sandbox-Sitzungen erreichbarer Egress-Proxy auf Port 3128. |
| `bgutil-provider` | Vom Backend erreichbarer Token-Sidecar auf Port 4416. Die Sandbox-Sitzung eines Videos fragt ihn über den Port des Modell-Relays von `backend-api`. |

Das Sandbox-Netz darf keinen direkten Ausgang erlauben. Der erzeugte Stack nennt es `tale-sandbox-net`. Bei einem anderen Namen müssen `SANDBOX_EGRESS_NETWORK` und das tatsächliche Netz übereinstimmen. Ausgehender Verkehr muss weiterhin über `sandbox-egress` laufen.

Sitzungen erreichen das Modell-Relay über dieses Netz unter `http://backend-api:8080`. Ohne weitere Einstellung lauscht das Relay wie die API in jedem Netz des Containers. Damit es nur im Sandbox-Netz lauscht, wie es `tale deploy` einrichtet, setze `SANDBOX_NETWORK_SUBNET` in der `.env` auf das Subnetz dieses Netzes, das `docker network inspect tale-sandbox-net --format '{{range .IPAM.Config}}{{.Subnet}} {{end}}'` ausgibt, sobald das Netz besteht. Lies es erneut aus, wenn das Netz neu erstellt wird: Ein Backend ohne Adresse in diesem Subnetz startet nicht.

Setze am Proxy `BACKEND_UPSTREAM=backend-api:3005`. Für den mitgelieferten Dateispeicher setzt du `OBJECT_STORE_UPSTREAM=object-store:9000` und denselben `OBJECT_STORE_BUCKET` in Proxy und Backend. Veröffentliche die Proxy-Ports 80/443. Datenbanken, Speicherverwaltung, Modell-Relay und Sandbox-APIs bleiben privat. Erhalte eine vertrauenswürdige Client-Weiterleitung bei einem zusätzlichen vorgeschalteten Proxy.

## Dauerhafte Daten und erforderliche Rechte einbinden

| Ressource | Mounts oder Einstellungen |
| --- | --- |
| Organisationskonfiguration | `config-data:/app/data` schreibbar für Backend-Rollen, nur lesbar für `platform`; am Spawner nur lesbar unter `/app/platform-config`. |
| Anwendung und mitgelieferte Wissensdaten | `db-data:/var/lib/postgresql/data`; ein separater Wissensdienst braucht ein eigenes dauerhaftes Volume. |
| Mitgelieferter Objektspeicher | `blob-data:/data` und für versitygw `command: --port :9000 --health /_health --quiet posix --fsync /data`; damit liegt ein Upload auf der Platte, bevor versitygw ihn bestätigt. Das Dateisystem des Volumes muss erweiterte Attribute bewahren: Darin legt versitygw Inhaltstyp und ETag jedes Objekts ab. Ein Stack, der noch MinIO betreibt, behält `object-store-data:/data` und `command: server /data`. |
| Zertifikate und Proxy-Zustand | `caddy-data:/data`, `caddy-config:/config`. |
| Spawner | `/var/run/docker.sock` und `/var/lib/tale-sandbox` unter gleichen Host-/Containerpfaden. Docker-Socket-Zugriff erlaubt Kontrolle über den Host-Daemon. |
| Backend-Rollen | `cap_add: [NET_ADMIN]` für den Netzwerkschutz des mitgelieferten Entrypoints. |
| Egress-Dienst | Nach Entfernen aller anderen Rechte der begrenzte Satz `NET_ADMIN`, `DAC_OVERRIDE`, `CHOWN`, `SETUID`, `SETGID`, `NET_BIND_SERVICE` und `KILL`. Ohne `KILL` kann der Root-Supervisor tinyproxy nach dem Wechsel zu `nobody` kein Signal mehr schicken; ein Stopp wartet dann die Karenzzeit ab und endet mit Exit 137, statt sauber auszulaufen. |
| Egress-IPv6 | `sysctls` mit `net.ipv6.conf.all.disable_ipv6: '1'` und `net.ipv6.conf.default.disable_ipv6: '1'`, wie im mitgelieferten Stack. Die Egress-Firewall arbeitet fail-closed: Sie braucht eine funktionierende IPv6-Firewall oder deaktiviertes IPv6 für den Standardwert und jede Schnittstelle, und ein Container kann diese Sysctls über ein schreibgeschütztes `/proc/sys` nicht selbst setzen. Ohne sie startet der Proxy auf einem Kernel ohne das Modul `ip6_tables` nicht; siehe [Sandbox-Infrastruktur](/de/self-hosted/configuration/environment-reference#sandbox-infrastructure). |
| Postgres-Stopp | `stop_signal: SIGINT`, `stop_grace_period: 60s`, `shm_size: 256mb` im Referenzaufbau. |
| Web-, Backend- und Spawner-Stopp | Stop-Wartezeit von 45 Sekunden für Web, 30 für `backend-api`, 120 für `backend-worker` und 30 für den Spawner. Ein Worker gibt seine Automatisierungsläufe in dieser Zeit weiter (`SHUTDOWN_DRAIN_MS`); übrige laufende Arbeit vor dem Stopp koordinieren. |
| Speicherreservierungen | `mem_reservation` (cgroup v2 `memory.low`) im mitgelieferten Stack, je Container der Anteil des Dienstes am Speicherbudget des Hosts: `db` `120m`, `platform` `64m`, `backend-api` `128m`, `backend-worker` `64m`, `object-store` `35m`, `proxy` `35m`, `sandbox` `20m` und `sandbox-egress` `10m`. Jeden Wert überschreibt eine eigene Variable, wie die [Umgebungsreferenz](/de/self-hosted/configuration/environment-reference#memory-reservations) sie auflistet; `0` reserviert nichts. versitygw und der Edge erhalten außerdem `GOMEMLIMIT: 28MiB` und `mem_limit: 140m`, 80 % und das Vierfache ihrer Reservierung: Ändere beide mit ihr. Solange Agent-Sessions den Host-Speicher knapp machen, lässt die Speicherrückgewinnung jedem Dienst so viel. Das greift nur, wenn auch die übergeordnete cgroup von Docker mindestens ihre Summe zugesichert bekommt, was standardmäßig nicht der Fall ist: Mit dem systemd-cgroup-Treiber führst du `systemctl set-property system.slice MemoryLow=476M` aus (die Summe der Standardwerte). Auf einem Host mit cgroup v1 macht Docker aus einer Reservierung ein weiches Limit, das einem Dienst darüber zuerst Speicher entzieht: Setze die acht dort in einer eigenen Compose-Datei auf `0`. `tale deploy` fragt Docker nach seiner cgroup-Version und lässt die Reservierungen bei cgroup v1, und wo Docker keine meldet, von selbst weg, mit einer Warnung. Gib dem Spawner ihre Summe als [`SANDBOX_RESERVED_MEMORY`](/de/self-hosted/configuration/environment-reference#sandbox-infrastructure); `tale deploy` tut das selbst. |

Behalte `db-backup`, wenn deine Datenbankwerkzeuge nach `/var/lib/postgresql/backup` schreiben. Ein Mount allein plant keine Sicherungen. Ältere Konfigurationsvolumes `convex-data` brauchen eine kontrollierte Übertragung nach `config-data`, keine Löschung. Bewahre die alte Kopie bis zur Prüfung auf.

## Passende Zustandsprüfungen verwenden

| Dienst | Prüfung | Aussage |
| --- | --- | --- |
| `backend-api` | `curl -sf http://localhost:3005/ping` | Prozess lebt; bleibt beim Entleeren erreichbar. |
| `backend-api` | `GET /ready` auf Port 3005 | Backend nimmt neue Arbeit an; getrennt vom Zustand externer Speicher. |
| `platform` | `curl -sf http://localhost:3000/api/health && [ -f /tmp/platform-ready ]` | Webdienst hat den Start abgeschlossen. |
| `backend-worker` | Web-Healthcheck des Images deaktivieren. | Kein HTTP-Server; Jobs und Fortschritt gesondert überwachen. |
| `proxy` | `curl -sf http://127.0.0.1:2020/health` | Proxy-Prozess antwortet. |
| `db` | `pg_isready -U tale && [ -f /tmp/.db_ready ]` | Postgres und Initialisierung bereit; Benutzer anpassen. |
| `object-store` | `wget -q -O /dev/null http://127.0.0.1:9000/_health` | versitygw antwortet auf seinem Health-Endpunkt. Für MinIO lautet die Prüfung `mc ready local`. |
| `sandbox` | `curl -fsS http://127.0.0.1:8003/health` | Spawner nach Vorbereitung des Laufzeit-Images bereit. |
| `sandbox-egress` | `curl -sS -o /dev/null --max-time 3 --noproxy '*' http://127.0.0.1:3128/ && nslookup -type=a -timeout=1 sandbox-egress-health.invalid 127.0.0.1` | Der Proxy beantwortet eine Nicht-Proxy-Anfrage selbst (400-Seite); das belegt, dass er ausliefert, ohne externe Webseiten zu erreichen. Danach beantwortet dnsmasq einen Namen aus seiner eigenen Konfiguration; das belegt, dass der DNS-Forwarder für verschachtelte Container und Builds antwortet, ohne einen vorgelagerten Resolver zu fragen. Den Port nicht mit einer reinen TCP-Verbindung prüfen: tinyproxy protokolliert jedes Verbinden-und-Schließen als Fehler, eine Zeile pro Intervall. |

Plane genug Zeit für Kaltstarts. Der Download der Sandbox-Laufzeit kann ein für warme Hosts passendes Zeitlimit überschreiten. Eine erfolgreiche Bereitschaftsprüfung belegt weder Dateizugriff noch Modellzugangsdaten oder einen vollständigen Nutzerablauf. Prüfe diese separat.

## Externe Speicher verbinden

Externe Anwendungsdatenbanken verwenden `DATABASE_URL`, externe Wissensdatenbanken `KNOWLEDGE_DATABASE_URL`. Für Letztere brauchst du pgvector und für volle Hybridsuche pg_search. Stelle eine sitzungskompatible Verbindung und bei Bedarf `POSTGRES_CA_FILE` bereit. Verlasse dich nicht darauf, dass ein Transaction-Pooler Tales Sitzungsverhalten erhält.

Setze für externe S3-kompatible Speicher `OBJECT_STORE_*` und den Browserendpunkt ausdrücklich. AWS S3 kann einen leeren benutzerdefinierten Endpunkt nutzen; andere Speicher brauchen gegebenenfalls Path-Style. Richte Objektrechte und Browser-CORS ein und teste Upload und Download. Entferne nur nicht mehr benötigte mitgelieferte Dienste samt `depends_on`-Referenzen. Erhalte alte Volumes bis zur bestätigten Migration.

Andere URLs verschieben keine vorhandenen Zeilen oder Dateien. [Datenresidenz](/de/self-hosted/configuration/data-residency) erklärt Organisations- und Bereitstellungsoptionen. Externe Speicher brauchen eigene abgestimmte Backups außerhalb der Volume-Archive von `tale backup`.

## Installation starten und abnehmen

Starte Speicher vor abhängigen Diensten und nutze Neustartregeln wie `unless-stopped`. Bereite `VERSION` wie oben beschrieben in der Shell vor und prüfe die vollständige Compose-Datei:

```bash
docker compose config --quiet
docker pull "ghcr.io/tale-project/tale/tale-sandbox-runtime:$VERSION"
docker compose up -d
docker compose ps
docker compose logs --tail=100 backend-api backend-worker
```

Prüfe gesunde Dienste, erfolgreiche Backend-Migrationen und Worker-Fortschritt. Öffne die öffentliche URL, folge [Erster Administrator](/de/self-hosted/install/first-admin), konfiguriere Anbieter und Embedding-Modell und teste kontrolliert Chat, Upload/Download und Wissenssuche. Werden Agent-Laufzeiten benötigt, prüfe auch eine Sandbox-Sitzung.

Datenbankmigrationen laufen beim Backend-Start. Dein Bereitstellungsablauf muss dabei kompatible Versionen verfügbar halten, bei Migrationsfehlern stoppen, aktive Arbeit vor Austausch entleeren und den Wiederherstellungszustand festhalten. Blue-Green-Koordination, Wiederaufnahme ausstehender Wechsel, automatische Snapshots und Rollback-Prüfungen entstehen nicht allein durch Kopieren der Dienstaufteilung.

## Den Vertrag auf Kubernetes übertragen

[Auf Kubernetes bereitstellen](/de/self-hosted/install/kubernetes) überträgt diesen Vertrag in Deployments, Services, StatefulSets und NetworkPolicies, stellt den Sandbox-Spawner auf `SANDBOX_BACKEND=kubernetes` um und nennt die Prüfungen, die ein Cluster bestehen muss, bevor du Nutzer zulässt. Diese Seite bleibt die Referenz für die Dienstnamen, Volumes, Prüfungen und Umgebungsvariablen, die die Kubernetes-Objekte nachbilden müssen.

## Die Blobs von MinIO zu versitygw umziehen {#blob-store}

versitygw kann das Volume von MinIO nicht lesen: MinIO legt Objekte in einem eigenen Format ab, versitygw dagegen jedes Objekt als Datei. Ein Stack, der MinIO betreibt, läuft mit MinIO weiter. Für den Umzug kopierst du jeden Bucket über S3 in ein versitygw auf einem neuen Volume, wie es `tale deploy --stop` bei einem Workspace-Deployment tut. Während der ersten Kopie arbeitet die Anwendung weiter, für die letzte steht sie still.

Prüfe zuerst das Dateisystem des neuen Volumes. Es braucht Platz für das Volume von MinIO und eine Reserve, denn beide Volumes bleiben auf der Platte, bis du das von MinIO entfernst. Außerdem muss es erweiterte Attribute bewahren: Ohne sie würde versitygw jede Datei ohne Inhaltstyp und ETag ausliefern.

1. Füge versitygw als zweiten Dienst auf einem eigenen Volume hinzu, mit Schlüssel und Region des Speichers, und starte ihn:

   ```yaml
   services:
     object-store-next:
       image: ghcr.io/versity/versitygw:v1.11.0@sha256:8319a530d08d537426e2f855bae5280709795dc73a3f0c347973ef915d6343c5
       command: --port :9000 --health /_health --quiet posix --fsync /data
       environment:
         ROOT_ACCESS_KEY: ${OBJECT_STORE_ACCESS_KEY}
         ROOT_SECRET_KEY: ${OBJECT_STORE_SECRET_KEY}
         VGW_REGION: ${OBJECT_STORE_REGION:-us-east-1}
       volumes:
         - blob-data:/data
       networks: [internal]
   volumes:
     blob-data:
   ```

   ```bash
   docker compose up -d object-store-next
   ```

2. Kopiere jeden Bucket, während die Anwendung weiterarbeitet. Das Image von MinIO bringt den Client `mc` mit, sein Container den Schlüssel. Notiere die Zeit, die der Befehl als `began=` ausgibt:

   ```bash
   docker compose exec object-store bash -c '
     mc alias set src http://127.0.0.1:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" &&
     mc alias set dst http://object-store-next:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" &&
     echo "began=$(date +%s)" &&
     mc mirror --retry src dst'
   ```

3. Halte den Proxy und die Anwendung an, damit nichts mehr in den Speicher schreibt:

   ```bash
   docker compose stop proxy platform backend-api backend-worker
   ```

4. Kopiere, was seit Beginn der ersten Kopie geschrieben wurde, entferne, was gelöscht wurde, und liste beide Seiten auf. Ersetze `<time>` durch die Zeit aus Schritt 2:

   ```bash
   docker compose exec object-store bash -c '
     began=<time> &&
     mc alias set src http://127.0.0.1:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" &&
     mc alias set dst http://object-store-next:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" &&
     mc mirror --retry --overwrite --remove --newer-than "$(( $(date +%s) - began + 60 ))s" src dst &&
     mc du --depth 2 src && mc du --depth 2 dst'
   ```

   Beide Listen müssen dieselben Buckets zeigen, jeden mit derselben Anzahl an Objekten und derselben Größe. `--newer-than` beschränkt die Kopie auf das, was sich seit Beginn der ersten Kopie geändert hat, plus eine Minute. Ohne die Option kopiert `mc` jedes Objekt erneut, weil versitygw die Angaben, die `mc` vergleicht, nicht auflistet.

5. Entferne den zweiten Dienst und stelle dann `object-store` auf versitygw um: Image, Befehl, Umgebung, Volume und Zustandsprüfung wie in den Tabellen oben. Lösche `object-store-next` aus der Compose-Datei und starte den Stack:

   ```bash
   docker compose rm -s -f object-store-next
   docker compose up -d
   ```

6. Lade einige bekannte Dateien herunter und öffne sie. Behalte das Volume von MinIO, bis dein nächstes Backup `blob-data` enthält, und entferne es dann mit `docker volume rm`.

Auf Kubernetes sind die Schritte dieselben. Betreibe versitygw als zweites Deployment mit eigenem Service, beide `object-store-next` genannt, auf einem neuen Claim, `blob-data`. Führe die Kopien mit `kubectl -n tale exec deploy/object-store -- bash -c '…'` aus und halte `proxy`, `platform`, `backend-api` und `backend-worker` mit `kubectl -n tale scale --replicas=0` an. Stelle danach auf den Objektspeicher aus [Die Speicher betreiben](/de/self-hosted/install/kubernetes#run-the-stores) um.
