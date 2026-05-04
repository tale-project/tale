---
title: Produktions-Deployment
description: Tale auf einen Produktionsserver mit der Tale-CLI und Zero-Downtime-Blue-Green-Deployment bringen.
---

## Voraussetzungen

- Ein Linux-Server mit Docker Engine 24.0+.
- Mindestens 8 GB RAM (12 GB empfohlen für Zero-Downtime-Deployments).
- Die Ports 80 und 443 in der Firewall geöffnet.
- Eine Domain, die auf deinen Server zeigt.

## Image-Größen

Tale lädt vorgebaute Images aus der GitHub Container Registry. Aktuelle Image-Größen:

| Dienst   | Image                                     | Größe   |
| -------- | ----------------------------------------- | ------- |
| Platform | `ghcr.io/tale-project/tale/tale-platform` | ~320 MB |
| Convex   | `ghcr.io/tale-project/tale/tale-convex`   | ~485 MB |
| Crawler  | `ghcr.io/tale-project/tale/tale-crawler`  | ~1.9 GB |
| RAG      | `ghcr.io/tale-project/tale/tale-rag`      | ~515 MB |
| DB       | `ghcr.io/tale-project/tale/tale-db`       | ~1.1 GB |
| Proxy    | `ghcr.io/tale-project/tale/tale-proxy`    | ~88 MB  |

> **Tipp:** Der erste Pull lädt ca. 4,4 GB (komprimiert). Folgende Updates laden nur geänderte Layer.

## Die Tale-CLI installieren

Die Tale-CLI ist der empfohlene Weg, Produktions-Deployments zu verwalten. Installation:

```bash
curl -fsSL https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh | bash
```

Oder lade die Binary direkt von [GitHub Releases](https://github.com/tale-project/tale/releases):

```bash
curl -fsSL https://github.com/tale-project/tale/releases/latest/download/tale_linux \
  -o /usr/local/bin/tale
chmod +x /usr/local/bin/tale
```

### Bestimmte Version festlegen

Um eine bestimmte CLI-Version statt des neuesten Releases zu installieren, setze die Umgebungsvariable `VERSION`:

```bash
VERSION=0.9.0 curl -fsSL https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh | bash
```

Oder lade die Binary direkt mit dem Version-Tag in der URL:

```bash
curl -fsSL https://github.com/tale-project/tale/releases/download/v0.9.0/tale_linux \
  -o /usr/local/bin/tale
chmod +x /usr/local/bin/tale
```

Verfügbare Versionen listet die [GitHub-Releases-Seite](https://github.com/tale-project/tale/releases).

## Erste Einrichtung

### Schritt 1: Deployment-Verzeichnis anlegen

```bash
mkdir ~/tale && cd ~/tale
tale init
```

Dies legt deine `.env`-Datei mit sicher generierten Secrets an.

### Schritt 2: Environment konfigurieren

Öffne `.env` und setze die erforderlichen Werte:

```dotenv
HOST=yourdomain.com
SITE_URL=https://yourdomain.com
TLS_MODE=letsencrypt
TLS_EMAIL=admin@yourdomain.com
DB_PASSWORD=a-strong-database-password
```

Alle verfügbaren Optionen in der [Environment-Referenz](/de/self-hosted/configuration/environment-reference).

### Schritt 3: Deployen

```bash
tale deploy
```

Die CLI lädt vorgebaute Images, startet alle Dienste, wartet auf Health-Checks und meldet, wenn die Plattform bereit ist. Beim ersten Deploy werden auch Datenbank und Proxy gestartet.

## Deployments verwalten

### Auf eine neue Version upgraden

`tale deploy` deployt immer die Version der laufenden CLI-Binary, ein Upgrade besteht also aus zwei Schritten:

```bash
tale upgrade            # 1. CLI auf das neueste Release aktualisieren
tale deploy             # 2. Neue Version ausrollen
```

#### Auf eine bestimmte Version migrieren oder downgraden

```bash
tale upgrade --version 0.9.0       # CLI auf v0.9.0 wechseln (up oder down)
tale deploy                        # Diese Version ausrollen
```

`--version` akzeptiert `0.9.0` oder `v0.9.0`. Downgrades sind erlaubt, aber **forward-only Schema-Änderungen gelten weiterhin** — siehe [Schema-Kompatibilität und Rollback](#schema-kompatibilität-und-rollback). Verfügbare Versionen listet die [GitHub-Releases-Seite](https://github.com/tale-project/tale/releases).

#### Vor dem Upgrade

- Lies die [Release Notes](https://github.com/tale-project/tale/releases) auf Breaking Changes und Migrationshinweise.
- Sichere die Datenbank — das Postgres-Volume enthält alle Plattformdaten und hochgeladenen Dateien.
- Wenn die Instanz produktionskritisch ist, teste das Upgrade vorher auf einer Staging-Instanz. `tale init` in einem separaten Verzeichnis auf einem anderen Host gibt dir einen isolierten Stack.

### Deploy

```bash
tale deploy             # Aktuelle CLI-Version deployen
tale deploy --dry-run   # Änderungen ohne Deploy anzeigen
tale deploy --all       # Infrastruktur-Dienste (DB, Proxy) mitaktualisieren
```

### Status prüfen

```bash
tale status
```

Zeigt die aktive Deployment-Farbe (Blue oder Green), laufende Container und Gesundheit.

### Logs ansehen

```bash
tale logs platform
tale logs platform --follow
tale logs db --tail 100
```

### Rollback

```bash
tale rollback                       # Zur vorherigen Version zurück
tale rollback --version 0.9.0       # Zu einer bestimmten Version zurück
```

> **Nur Vorwärts-Schema-Änderungen.** `tale rollback` tauscht nur Container-Images, **nicht** Convex-Daten oder Indexes. Siehe [Schema-Kompatibilität und Rollback](#schema-kompatibilität-und-rollback) für Details.

### Cleanup

```bash
tale cleanup            # Inaktive Container entfernen
tale reset --force      # ALLE Container entfernen (Bestätigung nötig)
```

## Zero-Downtime-Deployment

Die CLI nutzt eine Blue-Green-Deployment-Strategie. Beim Deploy einer neuen Version:

1. starten neue Container neben den alten;
2. bestätigen Health-Checks, dass die neue Version bereit ist;
3. wird der Traffic auf die neue Version umgeschaltet;
4. werden alte Container gedraint und entfernt.

Dafür sind mindestens **12 GB RAM** nötig, weil beide Versionen während der Umschaltung gleichzeitig laufen. Datenbank und Proxy sind geteilt und werden nicht dupliziert.

## TLS-Konfiguration

### Let's Encrypt (empfohlen)

```dotenv
TLS_MODE=letsencrypt
TLS_EMAIL=admin@yourdomain.com
```

Caddy stellt automatisch vertrauenswürdige TLS-Zertifikate aus und erneuert sie. Die Ports 80 und 443 müssen öffentlich erreichbar sein.

### Selbstsigniert (Entwicklung)

```dotenv
TLS_MODE=selfsigned
```

Erzeugt ein selbstsigniertes Zertifikat. Browser zeigen eine Sicherheitswarnung. Um es auf dem Host zu vertrauen:

```bash
docker exec tale-proxy caddy trust
```

### Externes TLS (hinter einem Reverse-Proxy)

```dotenv
TLS_MODE=external
```

Caddy lauscht nur auf HTTP (Port 80). Dein Reverse-Proxy übernimmt die TLS-Terminierung.

## Hinter einem Reverse-Proxy

Wenn Tale hinter einem TLS-terminierenden Reverse-Proxy läuft (z. B. nginx, Traefik, Cloudflare Tunnel):

```dotenv
HOST=yourdomain.com
SITE_URL=https://yourdomain.com
TLS_MODE=external
```

`SITE_URL` muss der URL entsprechen, die Nutzer im Browser aufrufen. Bei einem nicht-standardmäßigen Port diesen mit angeben (z. B. `SITE_URL=https://yourdomain.com:8443`).

Caddy lauscht dann nur auf HTTP (Port 80). Dein Reverse-Proxy muss:

- TLS terminieren und den gesamten Traffic (inkl. WebSocket) an Tale auf Port 80 weiterleiten;
- die Header `X-Forwarded-Proto` und `X-Forwarded-For` setzen.

Beispiel-Konfiguration für nginx:

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 443 ssl;
    server_name yourdomain.com;

    # ... deine TLS-Zertifikatskonfiguration ...

    location / {
        proxy_pass http://tale-server:80;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket-Unterstützung
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;

        # Lange Timeouts für Convex-WebSocket-Sync-Verbindungen
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;

        proxy_buffering off;
    }
}
```

## Subpath-Deployment

Wenn dein Reverse-Proxy Tale unter einem Unterpfad bedient (z. B. `https://yourdomain.com/tale/`), setze die Environment-Variable `BASE_PATH`:

```dotenv
HOST=yourdomain.com
SITE_URL=https://yourdomain.com
TLS_MODE=external
BASE_PATH=/tale
```

Caddy entfernt das Subpath-Präfix intern — dein Reverse-Proxy muss es **nicht** strippen. Leite einfach den gesamten Traffic unter dem Subpath unverändert weiter (Hinweis: kein Trailing-Slash bei `proxy_pass`):

```nginx
location /tale/ {
    proxy_pass http://tale-server:80;
    # ... dieselben Header und WebSocket-Config wie oben ...
}
```

**Bekannte Einschränkungen:**

- Das Convex Dashboard (`/convex-dashboard`) ist unter Subpath-Deployments nicht erreichbar.

## Externe Datenbank nutzen

Tale liefert einen ParadeDB-Container (PostgreSQL 16 + pgvector + pg_search) mit, aber die Architektur unterstützt auch die Anbindung an eine externe PostgreSQL-Instanz. Nützlich, wenn deine Organisation eine Managed Database verlangt, Datenresidenz-Vorgaben einhält oder einen bestehenden PostgreSQL-Cluster nutzen will.

### Anforderungen

Deine externe PostgreSQL-Instanz muss erfüllen:

| Anforderung                    | Details                                                                       |
| ------------------------------ | ----------------------------------------------------------------------------- |
| PostgreSQL-Version             | 16+                                                                           |
| pgvector-Extension             | Pflicht für Vektor-/Semantik-Suche.                                           |
| pg_search-Extension (ParadeDB) | Optional — BM25-Volltextsuche wird elegant deaktiviert, wenn nicht verfügbar. |
| Datenbanken                    | `tale` (Platform-Daten) und `tale_knowledge` (RAG + Crawler-Daten).           |
| Schemas in `tale_knowledge`    | `public_web` (Crawler) und `private_knowledge` (RAG).                         |

### Konfiguration

Setze `POSTGRES_URL` in deiner `.env`, damit alle Dienste die externe DB nutzen:

```dotenv
POSTGRES_URL=postgresql://tale:your-password@your-db-host:5432
```

Du kannst einzelne Service-Verbindungen überschreiben, falls nötig:

| Variable               | Dienst  | Beschreibung                                                             |
| ---------------------- | ------- | ------------------------------------------------------------------------ |
| `POSTGRES_URL`         | alle    | Basis-Connection-URL (ohne DB-Namen).                                    |
| `RAG_DATABASE_URL`     | RAG     | vollständige URL inkl. DB-Name, überschreibt `POSTGRES_URL` für RAG.     |
| `CRAWLER_DATABASE_URL` | Crawler | vollständige URL inkl. DB-Name, überschreibt `POSTGRES_URL` für Crawler. |

Bei Service-spezifischen URLs den DB-Namen angeben:

```dotenv
RAG_DATABASE_URL=postgresql://tale:your-password@your-db-host:5432/tale_knowledge
CRAWLER_DATABASE_URL=postgresql://tale:your-password@your-db-host:5432/tale_knowledge
```

### Datenbank-Initialisierung

Der mitgelieferte DB-Container führt Init-Skripte beim ersten Start automatisch aus. Mit externer DB musst du sie manuell laufen lassen. Die Skripte liegen in `services/db/init-scripts/` und sind nummeriert:

```bash
for f in services/db/init-scripts/*.sql; do
  psql -h your-db-host -U postgres -f "$f"
done
```

Dann offene Migrationen anwenden. Installiere [dbmate](https://github.com/amacneil/dbmate) lokal (`brew install dbmate` auf macOS; für Linux/Windows siehe README des Repositories), oder nutze Docker, wenn du nichts lokal installieren willst:

```bash
# Mit lokal installiertem dbmate:
dbmate -u "postgresql://tale:your-password@your-db-host:5432/tale_knowledge" -d services/db/migrations/db/migrations up

# Oder per Docker (keine lokale Installation nötig):
docker run --rm -v "$PWD/services/db/migrations/db/migrations:/db/migrations" \
  amacneil/dbmate \
  -u "postgresql://tale:your-password@your-db-host:5432/tale_knowledge" up
```

### Den mitgelieferten DB-Container abschalten

Nach der Konfiguration einer externen Datenbank kannst du verhindern, dass der eingebaute `db`-Container startet. Lege eine `compose.override.yml` im Deployment-Verzeichnis an:

```yaml
services:
  db:
    profiles: ['disabled']
```

So bleibt die Service-Definition bestehen (damit `depends_on`-Referenzen nicht brechen), startet aber nur, wenn du das Profil `disabled` explizit anforderst.

## Schema-Kompatibilität und Rollback

Tale-Deployments sind nicht automatisch rollback-sicher, wenn deine Code-Änderung das Convex-Schema ändert. Convex-Daten bleiben unabhängig vom Anwendungscode bestehen, und `tale rollback` tauscht nur Container-Images — nicht den DB-Zustand.

### Sichere Änderungen (rollback-freundlich)

- Neue **optionale** Felder zu bestehenden Tabellen.
- Neue Tabellen.
- Neue Indexes.
- Neue Queries/Mutations/Actions.
- Entfernen von Feldern, die der alte Code bereits als optional tolerierte.

### Riskante Änderungen (nur vorwärts)

- **Pflicht**feld zu einer bestehenden Tabelle hinzufügen.
- Ein Feld umbenennen.
- Den Typ eines Feldes ändern.
- Ein Pflichtfeld entfernen, auf das der neue Code angewiesen ist.
- Denormalisierte Dokumente restrukturieren.

### Empfohlenes Muster: Expand-Contract

Für jede "riskante" Änderung in **zwei Versionen** releasen:

1. **Expand** — neue Form neben der alten einführen. Code schreiben, der beide Formen verarbeitet. Bestehende Daten in die neue Form migrieren (einmaliger Backfill). Rollback ist sicher, weil beide Formen funktionieren.
2. **Contract** — sobald der Expand-Release lange genug stabil in Produktion war, folgt ein Release, der die alte Form entfernt. Dieser ist nur-vorwärts, aber zu diesem Zeitpunkt sind die Daten garantiert in der neuen Form.

### Blue-Green-Übergangsfenster

Weil `convex deploy` die Function-Menge atomar ersetzt, gibt es beim Blue-Green-Cutover ein kurzes (~10–30 s) Fenster, in dem Nutzer der alten Platform-Farbe die neuen Function-Signaturen rufen könnten:

1. `green`-Platform startet und pusht Functions V2 an Convex.
2. Convex serviert V2 an alle — einschließlich offener Sessions auf `blue`.
3. Caddys Health-Check erkennt `green` als gesund und schwenkt Traffic; `blue` drained.
4. Browser-Clients reconnecten und holen den neuen Platform-Code.

Wenn V2 Functions entfernt oder umbenennt, sehen `blue`-Nutzer während des Fensters Fehler — behandle "Function entfernen/umbenennen" also als riskante Änderung und folge dem Expand-Contract-Muster.

## Vulnerability-Scanning

Alle Tale-Images werden im CI/CD-Release-Prozess mit [Trivy](https://trivy.dev/) auf Schwachstellen geprüft. Scan-Ergebnisse werden pro Release in den GitHub-Security-Tab hochgeladen.

Lokalen Vulnerability-Scan ausführen:

```bash
bun run docker:test:vulnerability
```

Berichte landen im Verzeichnis `trivy-reports/`. Siehe [Container-Architektur](/de/self-hosted/operate/container-architecture) für Image-Details.

## Image-Versionierung

Images werden in der GitHub Container Registry mit zwei Tags publiziert:

- **Versions-Tag** (z. B. `1.2.0`) — unveränderlich, zeigt auf einen bestimmten Build.
- **`latest`** — veränderlich, zeigt immer auf das neueste Release.

Beide Tags beinhalten Multi-Architecture-Manifests (amd64 + arm64).

```bash
# Eine bestimmte Version pullen
docker pull ghcr.io/tale-project/tale/tale-platform:1.2.0

# Das neueste Release pullen
docker pull ghcr.io/tale-project/tale/tale-platform:latest
```

### Eine bestimmte Image-Version festschreiben

`tale deploy` wählt Images anhand der CLI-Version. Um einzelne Service-Images unabhängig zu pinnen — zum Beispiel um ein einzelnes neues Image zu testen, ohne den ganzen Stack zu upgraden — lege eine `compose.override.yml` neben deine `.env`:

```yaml
services:
  platform:
    image: ghcr.io/tale-project/tale/tale-platform:1.2.0
```

`tale deploy` führt das Override automatisch zusammen.

## Zugriff aufs Convex-Dashboard

Tale enthält ein eingebettetes Convex-Backend. Das Convex-Dashboard erlaubt dir, die Datenbank zu inspizieren, Function-Logs zu sehen und Hintergrundjobs zu verwalten.

1. Einen Admin-Schlüssel erzeugen:

```bash
./scripts/get-admin-key.sh
```

2. Den Schlüssel aus der Ausgabe kopieren.
3. `https://yourdomain.com/convex-dashboard` im Browser öffnen.
4. Den Admin-Schlüssel auf Nachfrage einfügen.

> **Hinweis:** Das Convex-Dashboard gibt direkten Lese- und Schreibzugriff auf alle Daten. Teile Admin-Schlüssel nur mit vertrauenswürdigen Teammitgliedern.
