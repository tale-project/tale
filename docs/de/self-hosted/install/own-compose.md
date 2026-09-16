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
| Gemeinsame Ausführungsdienste | `sandbox`, `sandbox-egress`, `sandbox-llm-gateway` | Aktive Sitzungen vor dem Austausch berücksichtigen; der Spawner braucht Docker-Daemon und passende Workspace-Pfade. |
| Optionale Video-Unterstützung | `bgutil-provider` | Token-Anbieter ohne Startgarantie; sein Ausfall kann Videoabrufe beeinträchtigen. |

Im mitgelieferten Aufbau liegen `tale_app` und `tale_knowledge` in einem Postgres-Dienst mit Alias `knowledge-db`. Separate oder verwaltete Datenbanken sind ebenfalls möglich. Konfiguriere ihre Verbindungen und Sicherungen ausdrücklich. Ein neuer Container zerstört vorhandene Daten nicht automatisch; ein entferntes oder ersetztes Volume kann es tun.

## Kompatible Images festlegen

Setze `VERSION` in der Compose-`.env` auf das geprüfte und getestete Tale-Release. Exportiere denselben Wert in deiner Shell für den separaten Image-Download weiter unten. Verwende für Tale-Images eine gemeinsame Version. Die beiden Dienste mit Upstream-Images haben eigene feste Versionen.

| Dienst | Image |
| --- | --- |
| `platform`, `backend-api`, `backend-worker` | `ghcr.io/tale-project/tale/tale-platform:<version>` |
| `proxy` | `ghcr.io/tale-project/tale/tale-proxy:<version>` |
| `db` | `ghcr.io/tale-project/tale/tale-db:<version>` |
| `sandbox` | `ghcr.io/tale-project/tale/tale-sandbox:<version>` |
| `sandbox-egress` | `ghcr.io/tale-project/tale/tale-sandbox-egress:<version>` |
| `sandbox-llm-gateway` | `ghcr.io/tale-project/tale/tale-sandbox-llm-gateway:<version>` |
| `object-store` | `quay.io/minio/minio:RELEASE.2025-04-22T22-12-26Z` |
| `bgutil-provider` | `brainicism/bgutil-ytdlp-pot-provider:1.3.1` |

Sitzungscontainer nutzen zusätzlich `ghcr.io/tale-project/tale/tale-sandbox-runtime:<version>`. Setze `SANDBOX_RUNTIME_IMAGE` am Spawner und lade es vor dem Start. Sein lokaler Entwicklungstag reicht auf einem Host ohne vorherigen Build nicht aus. Bei Docker-in-Container oder gemeinsamem Build-Cache brauchst du außerdem die kompatiblen Laufzeit- und Cache-Images aus der [Umgebungsreferenz](/de/self-hosted/configuration/environment-reference).

## Geheimnisse und öffentliche Adressen vorbereiten

Erzeuge vor dem ersten Start eigene Werte und bewahre sie in deiner Geheimnisverwaltung auf. Übernimm keine Beispielzugangsdaten einer Entwicklungsumgebung in die Produktion.

| Wert | Anforderung |
| --- | --- |
| `BETTER_AUTH_SECRET` | Stabiles Authentifizierungsgeheimnis mit hoher Entropie. |
| `ENCRYPTION_SECRET_HEX` | 32 Bytes als Hexwert, etwa mit `openssl rand -hex 32` erzeugt; für vorhandene verschlüsselte Datenbankwerte erhalten. |
| `DB_PASSWORD` oder externe Datenbankzugangsdaten | Müssen zur tatsächlich verwendeten Datenbankrolle passen. |
| `SANDBOX_TOKEN` | Dasselbe zufällige Token in Backend und Spawner. |
| `SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD` | Stabile Gateway-Verwaltungszugangsdaten für das Backend; der Benutzername ist standardmäßig `admin`. |
| `OBJECT_STORE_ACCESS_KEY`, `OBJECT_STORE_SECRET_KEY` | Gültige Speicherzugangsdaten; bei MinIO auf `MINIO_ROOT_USER` und `MINIO_ROOT_PASSWORD` abbilden. |
| `OBJECT_STORE_PUBLIC_ENDPOINT` | Vom Browser erreichbarer Endpunkt, meist `SITE_URL`, wenn Tales Proxy den mitgelieferten Speicher weiterleitet. |
| SOPS-age-Identität | Zum Entschlüsseln deiner verschlüsselten Konfigurationsdateien; siehe [Geheimnisse mit SOPS](/de/self-hosted/configuration/secrets-with-sops). |

Das Backend gleicht eine umgebungsverwaltete Standard-Objektspeicherverbindung beim Start ab. Eine Datei mit `managedBy: operator` bleibt bewusst unverändert. Geänderte Speicherzugangsdaten verschieben oder verwaisen Dateien nicht automatisch, müssen aber zwischen Backend und Speicher übereinstimmen. Das Gateway behält seinen gespeicherten Passwort-Hash. Stelle das passende Geheimnis wieder her oder nutze dessen Passwortwechselverfahren, statt zur Fehlersuche das Volume zu löschen.

Setze `HOST`, `SITE_URL` und `TLS_MODE` für den öffentlichen Zugang. [TLS und Domains](/de/self-hosted/configuration/tls-and-domains) erklärt Zertifikate, weitere Ursprünge und Unterpfade.

## Anwendungsebene zusammenstellen

Die drei Rollen teilen sich ein Image. `TALE_ROLE=api` und `TALE_ROLE=worker` wählen Backend-Rollen; beim Webdienst bleibt die Variable ungesetzt. Vergib kein festes `container_name` für Rollen, die du skalieren willst.

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
| `backend-api` | API-Replikate in Anwendungs- und Sandbox-Netz, erreichbar auf Port 3005. |
| `knowledge-db` | Wissens-Postgres oder ein Ziel über `KNOWLEDGE_DATABASE_URL`. |
| `object-store` | Mitgeliefertes MinIO im Anwendungsnetz. |
| `sandbox` | Für das Backend erreichbarer Spawner auf Port 8003. |
| `sandbox-egress` | Für Sandbox-Sitzungen erreichbarer Egress-Proxy auf Port 3128. |
| `sandbox-llm-gateway` / `llm-gateway` | Gateway für Backend und Sandbox-Sitzungen auf Port 8080. |
| `bgutil-provider` | Vom Worker erreichbarer Token-Sidecar auf Port 4416. |

Das Sandbox-Netz darf keinen direkten Ausgang erlauben. Der erzeugte Stack nennt es `tale-sandbox-net`. Bei einem anderen Namen müssen `SANDBOX_EGRESS_NETWORK` und das tatsächliche Netz übereinstimmen. Ausgehender Verkehr muss weiterhin über `sandbox-egress` laufen.

Setze am Proxy `BACKEND_UPSTREAM=backend-api:3005`. Für den mitgelieferten Dateispeicher setzt du `OBJECT_STORE_UPSTREAM=object-store:9000` und denselben `OBJECT_STORE_BUCKET` in Proxy und Backend. Veröffentliche die Proxy-Ports 80/443. Datenbanken, Speicherverwaltung, Gateway und Sandbox-APIs bleiben privat. Erhalte eine vertrauenswürdige Client-Weiterleitung bei einem zusätzlichen vorgeschalteten Proxy.

## Dauerhafte Daten und erforderliche Rechte einbinden

| Ressource | Mounts oder Einstellungen |
| --- | --- |
| Organisationskonfiguration | `config-data:/app/data` schreibbar für Backend-Rollen, nur lesbar für `platform`; am Spawner nur lesbar unter `/app/platform-config`. |
| Anwendung und mitgelieferte Wissensdaten | `db-data:/var/lib/postgresql/data`; ein separater Wissensdienst braucht ein eigenes dauerhaftes Volume. |
| Mitgelieferter Objektspeicher | `object-store-data:/data` und MinIO `command: server /data`. |
| Zertifikate und Proxy-Zustand | `caddy-data:/data`, `caddy-config:/config`. |
| Gateway-Zustand | `llm-gateway-data:/app/data`. |
| Spawner | `/var/run/docker.sock` und `/var/lib/tale-sandbox` unter gleichen Host-/Containerpfaden. Docker-Socket-Zugriff erlaubt Kontrolle über den Host-Daemon. |
| Backend-Rollen | `cap_add: [NET_ADMIN]` für den Netzwerkschutz des mitgelieferten Entrypoints. |
| Egress-Dienst | Nach Entfernen anderer Rechte der begrenzte Satz `NET_ADMIN`, `DAC_OVERRIDE`, `CHOWN`, `SETUID`, `SETGID`, `NET_BIND_SERVICE`. |
| Postgres-Stopp | `stop_signal: SIGINT`, `stop_grace_period: 60s`, `shm_size: 256mb` im Referenzaufbau. |
| Web- und Spawner-Stopp | 45 Sekunden Stop-Wartezeit für Web, 30 für den Spawner; laufende Arbeit vor dem Stopp koordinieren. |

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
| `object-store` | `mc ready local` | Bereitschaft des mitgelieferten MinIO. |
| `sandbox` | `curl -fsS http://127.0.0.1:8003/health` | Spawner nach Vorbereitung des Laufzeit-Images bereit. |
| `sandbox-egress` | `nc -z 127.0.0.1 3128` | Lokaler Proxy-Port, unabhängig von externen Webseiten. |
| `sandbox-llm-gateway` | `wget -q -O /dev/null http://127.0.0.1:8080/health` | Verwendet den vorhandenen Client; das Image enthält kein `curl`. |

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

Prüfe gesunde Dienste, erfolgreiche Backend-Migrationen und Worker-Fortschritt. Öffne die öffentliche URL, folge [Erster Administrator](/de/self-hosted/install/first-admin), konfiguriere Anbieter und Embedding-Modell und teste kontrolliert Chat, Upload/Download und Wissenssuche. Werden Harnesses benötigt, prüfe auch eine Sandbox-Sitzung.

Datenbankmigrationen laufen beim Backend-Start. Dein Bereitstellungsablauf muss dabei kompatible Versionen verfügbar halten, bei Migrationsfehlern stoppen, aktive Arbeit vor Austausch entleeren und den Wiederherstellungszustand festhalten. Blue-Green-Koordination, Wiederaufnahme ausstehender Wechsel, automatische Snapshots und Rollback-Prüfungen entstehen nicht allein durch Kopieren der Dienstaufteilung.

## Den Vertrag auf Kubernetes übertragen

Verwende Deployments und stabile Services für die Anwendungsrollen. Das gemeinsame Konfigurations-Volume muss die erforderlichen Schreibzugriffe und Sperren unterstützen. Nutze dauerhafte Volumes oder externe Dienste für die Speicher. Mit `SANDBOX_BACKEND=kubernetes` erstellt der Spawner Sitzungs-Pods und Workspace-PVCs über die Kubernetes-API statt über den Docker-Socket des Hosts.

### Den Sandbox-Namespace vorbereiten

Halte Sitzungs-Pods, Egress-Proxy und Modell-Gateway im vorgesehenen Sandbox-Namespace. Die StorageClass muss Workspace-Volumes erhalten und am Ort eines fortgesetzten Pods wieder einbinden können.

| Einstellung | Anforderung |
| --- | --- |
| `SANDBOX_BACKEND` | `kubernetes`. Docker-Hostpfade und Bridge-Namen konfigurieren dieses Backend nicht. |
| `SANDBOX_K8S_NAMESPACE` | Namespace der Sitzungen; Standard `tale-sandbox`. |
| `SANDBOX_RUNTIME_IMAGE` | Passendes Tale-Sandbox-Runtime-Image, für die Cluster-Nodes verfügbar. |
| `NODE_EXTRA_CA_CERTS` | CA-Datei des Clusters, im Spawner normalerweise `/var/run/secrets/kubernetes.io/serviceaccount/ca.crt`. Behalte die TLS-Prüfung bei. |
| `SANDBOX_K8S_WORKSPACE_SIZE_LIMIT` | Workspace-PVC-Größe, Standard `4Gi`; begrenzt bei aktiviertem innerem Docker auch dessen temporären Speicher. |
| `SANDBOX_K8S_CACHE_STORAGECLASS` | StorageClass der Workspaces; ohne Wert gilt der Cluster-Standard. |
| `SANDBOX_RUNTIME` / `SANDBOX_RUNTIME_CLASS` | Unterstützte Laufzeitstufe und gegebenenfalls der Name der installierten RuntimeClass. |
| `SANDBOX_EGRESS_PROXY` | Erreichbarer Egress-Dienst, Standard `http://sandbox-egress:3128`. |

Der ServiceAccount des Spawners braucht im Namespace diese Rechte:

| Ressource | Verben |
| --- | --- |
| `pods` | `create`, `get`, `list`, `delete`, `patch` |
| `secrets` | `create`, `delete`, `list` |
| `persistentvolumeclaims` | `get`, `create`, `delete` |
| `networkpolicies` in `networking.k8s.io` | `create`, `update` |

Sitzungsaktionen erreichen runnerd per HTTP auf der Pod-IP an Port 8200. Dafür ist kein `pods/exec` nötig; Sitzungs-Pods erhalten kein ServiceAccount-Token. Erlaube in deinen Richtlinien die erforderlichen Verbindungen des Spawners zu Kubernetes und runnerd. Der [Kubernetes-Vertrag der Sandbox](https://github.com/tale-project/tale/blob/main/services/sandbox/docs/kubernetes.md) enthält die Role und Laufzeitdetails.

### Isolation und Lebenszyklus prüfen

Der Spawner setzt eine Egress-NetworkPolicy für Sitzungs-Pods, die DNS und den Sandbox-Namespace erlaubt. Dein CNI muss NetworkPolicy durchsetzen. Scheitert das Anlegen der Richtlinie, wird der Fehler protokolliert; der Spawner startet trotzdem. Prüfe vor der Freigabe von Arbeit, ob die wirksame Richtlinie vorhanden ist und ein unerlaubtes Ziel tatsächlich blockiert. Proxy-Umgebungsvariablen allein erzwingen keine Isolation.

Prüfe den IPv6-Schutz des Egress-Proxys und die [Netzwerkvoraussetzungen für inneres Docker](/de/self-hosted/configuration/environment-reference#sandbox-infrastructure). Wähle für verschachteltes Docker einen ausdrücklichen `SANDBOX_DIND_INNER_POOL` außerhalb der Pod-, Service- und VPC-Netze des Clusters. Ein Pod kann nicht alle Cluster-Netze selbst erkennen.

Eine gestoppte Sitzung behält ihr Workspace-PVC für die Fortsetzung; ausdrückliches Zerstören entfernt es. `SANDBOX_MAX_SESSIONS` zählt Sitzungen im Namespace, ist bei gleichzeitiger Aufnahme durch mehrere Replikate aber keine harte Grenze. Nutze ResourceQuota und anhand echter Last gewählte CPU- und Speicherlimits.

Teste Erstellung, Ausführung, Runner-Neustart, Leerlaufstopp, Fortsetzung mit erhaltenen Dateien und ausdrückliches Zerstören. Prüfe bei mehreren Spawner-Replikaten auch den Zugriff über ein anderes Replikat. Bilde Bereitschaft und geordnetes Beenden der Anwendung bewusst ab und beobachte laufende Anfragen beim Update. Die Docker-Bereitstellungssteuerung der CLI verwaltet kein Kubernetes-Deployment.
