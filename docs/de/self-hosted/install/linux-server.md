---
title: Produktions-Deployment
description: Tale auf einem Produktionsserver deployen mit der Tale-CLI und Blue-Green-Deployments ohne Ausfallzeit.
---

Das Produktions-Deployment ist der kanonische Weg, um selbst gehostetes Tale einem Team vorzulegen — ein Linux-Server mit echter Domain, echten TLS-Zertifikaten und der Blue-Green-Topologie, die Upgrades ohne Wartungsfenster übersteht. Die `tale`-CLI macht die schwere Arbeit: sie zieht die richtigen Images, fährt Migrationen aus, startet die neuen Container neben den alten und schwenkt den Traffic erst um, nachdem die neue Version ihre Health-Checks besteht. Ein fehlgeschlagenes Deploy lässt die vorherige Version weiter ausliefern und nichts Sichtbares bricht.

Diese Anleitung nimmt an, dass du Tale bereits auf einem Laptop evaluiert hast. Falls nicht, läuft der [Lokale Quickstart](/de/self-hosted/install/quickstart) in Minuten und nutzt dieselbe CLI; komm hierher zurück, wenn die Instanz außerhalb deines Rechners erreichbar sein soll.

## Bevor du beginnst

- Ein Linux-Server mit Docker Engine 24.0 oder neuer.
- Mindestens 8 GB RAM, 12 GB empfohlen, damit das Blue-Green-Deploy Luft hat, beide Farben parallel zu fahren.
- Ports 80 und 443 auf der Firewall offen; die ACME-Validierung braucht beide, und so auch der Produktions-Proxy.
- Ein Domainname mit einem A-Record (oder AAAA-Record), der auf den Server zeigt.
- Ein API-Schlüssel von einem KI-Anbieter — OpenRouter ist die empfohlene Voreinstellung; jeder OpenAI-kompatible Endpunkt funktioniert.

Wenn deine Umgebung einen verwalteten Postgres statt der gebündelten Datenbank verlangt, überfliege [Externe Datenbank verwenden](#using-an-external-database) unten, bevor du startest — er ändert ein paar `.env`-Werte und fügt einen manuellen Init-Schritt hinzu.

## Image-Größen

Tale zieht Multi-Architektur-Images (amd64 + arm64) vom GitHub Container Registry. Der erste Pull beläuft sich auf rund 4,4 GB komprimiert insgesamt; spätere Updates laden nur geänderte Layer.

| Dienst     | Image                                     | Komprimierte Größe |
| ---------- | ----------------------------------------- | ------------------ |
| `proxy`    | `ghcr.io/tale-project/tale/tale-proxy`    | ~88 MB             |
| `platform` | `ghcr.io/tale-project/tale/tale-platform` | ~320 MB            |
| `convex`   | `ghcr.io/tale-project/tale/tale-convex`   | ~485 MB            |
| `rag`      | `ghcr.io/tale-project/tale/tale-rag`      | ~515 MB            |
| `crawler`  | `ghcr.io/tale-project/tale/tale-crawler`  | ~1,9 GB            |
| `db`       | `ghcr.io/tale-project/tale/tale-db`       | ~1,1 GB            |

## Die CLI installieren

Die `tale`-CLI ist eine einzige Binärdatei, die jeden Schritt in dieser Anleitung treibt. Das Installationsskript schreibt nach `/usr/local/bin/tale`:

```bash
curl -fsSL https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh | bash
```

Um eine bestimmte Version statt des neuesten Releases anzuheften, setze die Umgebungsvariable `VERSION` auf das Installationsskript:

```bash
VERSION=0.9.0 curl -fsSL https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh | bash
```

Oder lade die Binärdatei direkt von einem Release-Tag herunter — dieselbe Multi-Architektur-Binärdatei wird für jedes Release veröffentlicht:

```bash
curl -fsSL https://github.com/tale-project/tale/releases/download/v0.9.0/tale_linux \
  -o /usr/local/bin/tale
chmod +x /usr/local/bin/tale
```

Die vollständige Liste der Releases steht auf der Seite [GitHub Releases](https://github.com/tale-project/tale/releases).

## Schritt 1 — Deployment-Verzeichnis initialisieren

Wähle ein Verzeichnis auf dem Server, das die `.env`-Datei und lokale Konfiguration hält. Das übliche Muster ist `~/tale`:

```bash
mkdir ~/tale && cd ~/tale
tale init
```

`tale init` schreibt eine `.env`-Datei mit automatisch erzeugten Secrets — `BETTER_AUTH_SECRET`, `ENCRYPTION_SECRET_HEX`, `INSTANCE_SECRET` und einen `SOPS_AGE_KEY` für den SOPS-verschlüsselten Anbieter-Secret-Modus. Es legt auch die Beispiel-Anbieter-Konfigurationen unter `examples/providers/` ab und gerüstet `TALE_CONFIG_DIR`. Das Verzeichnis ist die Wahrheitsquelle für diese Instanz; alles, was `tale deploy` liest, lebt hier oder in `.env`.

## Schritt 2 — Die Umgebung konfigurieren

Öffne `.env` und setze die erforderlichen Werte. Der minimale Produktions-Satz sind fünf Variablen:

```dotenv
HOST=yourdomain.com
SITE_URL=https://yourdomain.com
TLS_MODE=letsencrypt
TLS_EMAIL=admin@yourdomain.com
DB_PASSWORD=a-strong-database-password
```

`SITE_URL` muss der URL entsprechen, die Nutzer tatsächlich im Browser erreichen. Wenn dein Reverse-Proxy oder Load Balancer TLS auf einem nicht standardmäßigen Port terminiert, nimm ihn auf (`https://yourdomain.com:8443`). Die [Umgebungsreferenz](/de/self-hosted/configuration/environment-reference) katalogisiert jede Variable, die Tale liest — Domain, TLS, Secrets, Datenbank, Monitoring, SSO, vertrauenswürdige HTTP-Kopfzeilen — mit Voreinstellungen aus `.env.example`.

## Schritt 3 — Deployen

```bash
tale deploy
```

Das erste Deploy zieht jedes Image, startet die Datenbank und den Proxy und bringt die Platform hoch, sobald die Abhängigkeiten gesund sind. Spätere Deploys verwenden die laufende Datenbank und den laufenden Proxy weiter und rollen nur die Anwendungsdienste. Die CLI meldet, wenn jeder Container seinen Health-Check besteht und wenn die Platform `/api/health` aus dem internen Netz beantwortet.

Hänge `--dry-run` an, um vor dem Anwenden eine Vorschau zu bekommen; hänge `--all` an, um auch die Infrastruktur-Dienste (`db`, `proxy`) zu aktualisieren, die die CLI sonst nach der ersten Installation in Ruhe lässt.

## Tagesbetrieb

`tale deploy` ist die Zugmaschine, aber ein paar andere Befehle gehören zum Dauerrhythmus dazu.

```bash
tale status                      # Aktive Farbe (blau oder grün), laufende Container, Gesundheit
tale logs platform               # Logs für einen Dienst nachverfolgen
tale logs platform --follow      # Dasselbe als Stream
tale logs db --tail 100          # Letzte 100 Zeilen der Datenbank
tale cleanup                     # Inaktive Container der vorherigen Farbe entfernen
tale reset --force               # Jeden Container entfernen (Bestätigung nötig)
```

### Upgrades

Ein Versionssprung ist zwei Befehle: die CLI-Binärdatei aktualisieren, dann redeployen.

```bash
tale upgrade                     # Das neueste CLI-Release ziehen
tale deploy                      # Die neue Version ausrollen
```

Um eine bestimmte Version anzuheften (hoch oder runter), übergib `--version`:

```bash
tale upgrade --version 0.9.0
tale deploy
```

Lies die Release-Notes vor dem Upgrade. Breaking-Changes und Migrationshinweise stehen auf der Seite [GitHub Releases](https://github.com/tale-project/tale/releases), formatiert nach [Release-Notes-Format](/de/self-hosted/operate/release-notes/format). Für produktionskritische Instanzen lass dasselbe `tale upgrade` plus `tale deploy`-Paar zuerst auf einer Staging-Instanz laufen; `tale init` in einem separaten Verzeichnis auf einem anderen Host gibt dir einen isolierten Stack.

### Rollback

```bash
tale rollback                    # Auf die vorherige Version zurück
tale rollback --version 0.9.0    # Auf eine bestimmte Version zurück
```

`tale rollback` tauscht Container-Images. Es rollt das Convex-Schema oder die Daten nicht zurück. Siehe [Schema-Kompatibilität und Rollback](#schema-compatibility-and-rollback) für die Fälle, in denen das zählt.

## Zero-Downtime-Upgrades

Die CLI deployt Blue-Green: die neue Farbe startet neben der laufenden Farbe, der Proxy wartet, bis sie ihre Health-Checks besteht, dann schwenkt er den Traffic um und lässt die alte Farbe ausbluten. Deshalb springt die RAM-Empfehlung von 8 GB auf 12 GB — `platform`, `rag` und `crawler` existieren während des Umschaltens zweifach. Die Dienste `db` und `proxy` sind geteilt und werden nie verdoppelt.

```text
1. green startet.
2. greens Container bestehen ihre Health-Checks.
3. proxy schwenkt den Traffic von blue auf green.
4. blue blutet aus und stoppt.
```

Falls green nie gesund meldet, routet der Proxy weiter zu blue und `tale deploy` schlägt mit angehängten Container-Logs fehl. Nichts Sichtbares bricht.

## TLS

`TLS_MODE` ist der einzige Schalter, der wählt, wie Zertifikate ausgestellt werden. Drei Werte; nimm den passenden.

### Let's Encrypt (für Produktion empfohlen)

```dotenv
TLS_MODE=letsencrypt
TLS_EMAIL=admin@yourdomain.com
```

Caddy stellt automatisch vertrauenswürdige Zertifikate aus und erneuert sie. Ports 80 und 443 müssen vom öffentlichen Internet erreichbar sein — die HTTP-01-Challenge von ACME läuft über Port 80, und HTTPS-Verkehr antwortet auf 443.

### Selbstsigniert (Entwicklung und Demos)

```dotenv
TLS_MODE=selfsigned
```

Caddy erzeugt ein lokales Zertifikat. Browser zeigen eine "Verbindung ist nicht privat"-Warnung, bis du dem Zertifikat vertraust. Auf dem Host vertrauen:

```bash
docker exec tale-proxy caddy trust
```

### Extern (hinter einem vorgelagerten Reverse-Proxy)

```dotenv
TLS_MODE=external
```

Caddy lauscht nur auf HTTP. Dein Reverse-Proxy (nginx, Traefik, HAProxy, Cloudflare Tunnel) terminiert TLS und leitet auf Port 80 an Tale weiter. Der Reverse-Proxy muss auch WebSocket-Upgrades weiterleiten, weil der Realtime-Kanal von Convex über WS läuft.

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 443 ssl;
    server_name yourdomain.com;

    # ... TLS-Zertifikat-Konfiguration ...

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

        # Langer Timeout für Convex-WebSocket-Sync-Verbindungen
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;

        proxy_buffering off;
    }
}
```

## Subpath-Deployment

Wenn dein Reverse-Proxy Tale unter einem Pfadpräfix ausliefert (`https://yourdomain.com/tale/`), setze `BASE_PATH`, damit die SPA die richtigen Asset-URLs ausgibt:

```dotenv
HOST=yourdomain.com
SITE_URL=https://yourdomain.com
TLS_MODE=external
BASE_PATH=/tale
```

Caddy entfernt das Präfix intern — dein vorgelagerter Proxy leitet den vollen Pfad unverändert weiter. Kein abschließender Schrägstrich auf `proxy_pass`:

```nginx
location /tale/ {
    proxy_pass http://tale-server:80;
    # ... gleiche Kopfzeilen und WebSocket-Konfiguration wie oben ...
}
```

Das Convex Dashboard unter `/convex-dashboard` ist aktuell unter einem Subpath-Deployment nicht erreichbar.

## Externe Datenbank verwenden

Der gebündelte `db`-Container liefert ParadeDB (Postgres 16 + pgvector + pg_search) und funktioniert von Haus aus. Wenn du eine verwaltete Datenbank brauchst, Datenresidenz in einem bestimmten Cluster oder einen bestehenden Postgres-Pool, können sich die vier Datenbank-Dienste stattdessen mit jeder externen Postgres-Instanz verbinden.

Die externe Instanz muss ein paar Anforderungen erfüllen:

| Anforderung                 | Detail                                                   |
| --------------------------- | -------------------------------------------------------- |
| Postgres-Version            | 16 oder neuer                                            |
| `pgvector`-Erweiterung      | Erforderlich für Vektor- und semantische Suche           |
| `pg_search`-Erweiterung     | Optional — BM25-Volltextsuche degradiert ohne sie sauber |
| Datenbanken                 | `tale` (Platform) und `tale_knowledge` (RAG und Crawler) |
| Schemas in `tale_knowledge` | `public_web` (Crawler) und `private_knowledge` (RAG)     |

Tale aus `.env` auf die externe Instanz ausrichten:

```dotenv
POSTGRES_URL=postgresql://tale:your-password@your-db-host:5432
```

`POSTGRES_URL` ist die Basis-URL ohne Datenbanknamen. Convex hängt `tale` an, und die Python-Dienste leiten `tale_knowledge` von derselben Basis ab. Wenn ein Dienst einen anderen Host braucht (der RAG-Dienst auf einer Read-Replika zum Beispiel), überschreibe pro Dienst:

```dotenv
RAG_DATABASE_URL=postgresql://tale:your-password@rag-replica:5432/tale_knowledge
CRAWLER_DATABASE_URL=postgresql://tale:your-password@your-db-host:5432/tale_knowledge
```

Der gebündelte `db`-Container fährt seine Init-Skripte beim ersten Boot; eine externe Instanz sieht sie nie, also musst du sie vor dem ersten `tale deploy` manuell anwenden:

```bash
for f in services/db/init-scripts/*.sql; do
  psql -h your-db-host -U postgres -f "$f"
done
```

Dann die dbmate-Migrationen gegen `tale_knowledge` fahren:

```bash
# Mit dbmate lokal installiert (brew install dbmate auf macOS):
dbmate -u "postgresql://tale:your-password@your-db-host:5432/tale_knowledge" \
  -d services/db/migrations/db/migrations up

# Oder einmalig per Docker:
docker run --rm -v "$PWD/services/db/migrations/db/migrations:/db/migrations" \
  amacneil/dbmate \
  -u "postgresql://tale:your-password@your-db-host:5432/tale_knowledge" up
```

Zum Schluss verhindere, dass der gebündelte `db`-Container startet, indem du ein `compose.override.yml` neben deine `.env` legst:

```yaml
services:
  db:
    profiles: ['disabled']
```

Das Override behält die Service-Definition (damit `depends_on`-Referenzen weiter auflösen), startet den Container aber nie.

## Schema-Kompatibilität und Rollback

Tale-Deployments sind nicht automatisch rollback-sicher, wenn deine Code-Änderung das Convex-Schema verändert. Convex-Daten bleiben unabhängig vom Anwendungs-Image bestehen, und `tale rollback` tauscht nur Container — nie die Daten.

### Sichere Änderungen

- Optionale Felder zu bestehenden Tabellen hinzufügen.
- Neue Tabellen hinzufügen.
- Neue Indizes hinzufügen.
- Neue Queries, Mutationen oder Aktionen hinzufügen.
- Felder entfernen, die der alte Code bereits als optional duldete.

### Riskante Änderungen

- Ein erforderliches Feld zu einer bestehenden Tabelle hinzufügen.
- Ein Feld umbenennen.
- Den Typ eines Feldes ändern.
- Ein erforderliches Feld entfernen, auf das der neue Code angewiesen ist.
- Denormalisierte Dokumente umstrukturieren.

### Expand-Contract

Für jede riskante Änderung liefere zwei Releases.

Das erste Release **expandiert**: es fügt die neue Form neben der alten hinzu, schreibt Code, der beide bedient, und migriert bestehende Daten über eine einmalige Backfill-Mutation auf die neue Form. Beide Formen funktionieren, also ist das Release sicher rollback-fähig. Das zweite Release **kontrahiert**: sobald die Produktion auf dem expandierten Release lange genug gelaufen ist, um Stabilität zu bestätigen, entfernt das Folge-Release die alte Form. Bis dahin ist garantiert, dass die Daten in der neuen Form vorliegen, also kann das Contract-Release reine Vorwärtsbewegung sein.

### Blue-Green-Übergangsfenster

Der Deploy-Schritt schiebt die neue Convex-Funktionsmenge atomar. Für ein kurzes Fenster — rund 10 bis 30 Sekunden — können offene Sessions auf der alten Farbe Funktionssignaturen aufrufen, die zur neuen Form passen:

```text
1. green platform startet, fährt `bunx convex deploy` gegen den convex-Dienst aus.
2. Convex liefert jetzt V2-Funktionen an jeden Client, einschließlich offener blue-Sessions.
3. Der Proxy bemerkt, dass green gesund ist, und schwenkt den Traffic.
4. Browser-Clients verbinden neu und ziehen den neuen Platform-Code.
```

Wenn V2 Funktionen entfernt oder umbenennt, sehen die verbundenen Clients von blue Fehler während des Fensters. Behandle "Funktion entfernen oder umbenennen" als riskante Änderung und folge Expand-Contract.

## Schwachstellenscans

Jedes Tale-Image wird mit [Trivy](https://trivy.dev/) in der CI-Release-Pipeline gescannt; Ergebnisse werden gegen das Release-Tag in die GitHub-Security-Registerkarte hochgeladen. Den Scan lokal gegen die Images auf deinem Host laufen lassen:

```bash
bun run docker:test:vulnerability
```

Berichte landen in `trivy-reports/`. Die Image-Ebene-Prüfungen (OCI-Labels, Nicht-Root-Nutzer, Größenbudgets, keine Secrets in Layern) sind durch `bun run docker:test:image` abgedeckt. Die [Contributing-Docker-Anleitung](/de/develop/contributing-docker) listet jede Prüfung auf, die die CI fährt.

## Image-Versionierung

Images werden mit zwei Tags veröffentlicht. Versions-Tags (`1.2.0`) sind unveränderlich und zeigen auf einen bestimmten Build; `latest` ist veränderlich und folgt dem neuesten Release. Beide tragen Multi-Architektur-Manifeste für amd64 und arm64.

```bash
docker pull ghcr.io/tale-project/tale/tale-platform:1.2.0
docker pull ghcr.io/tale-project/tale/tale-platform:latest
```

Um einen Dienst auf eine bestimmte Version anzuheften, ohne den Rest des Stacks zu upgraden — etwa zum Testen eines einzelnen Images oder um nur den Crawler vorwärtszurollen — leg ein `compose.override.yml` neben `.env`:

```yaml
services:
  platform:
    image: ghcr.io/tale-project/tale/tale-platform:1.2.0
```

`tale deploy` mergt das Override automatisch.

## Convex Dashboard

Das gebündelte Convex-Backend liefert ein Dashboard zum Inspizieren der Datenbank, zum Ansehen von Funktionslogs und zum Verwalten von Hintergrundjobs. Es lauscht hinter dem Proxy auf `/convex-dashboard` und verlangt für jede Sitzung einen Admin-Schlüssel.

Den Admin-Schlüssel erzeugen:

```bash
tale convex admin
```

Den Schlüssel ins Dashboard einfügen, wenn danach gefragt wird. Das Dashboard gibt direkten Lese- und Schreibzugriff auf jede Sammlung in Convex, also teile Admin-Schlüssel nur mit vertrauenswürdigen Operatoren.

## Wo das einsetzt

Das Produktions-Deployment ist der kanonische Weg für selbst gehostetes Tale. Sobald die Instanz erreichbar ist, katalogisiert die [Umgebungsreferenz](/de/self-hosted/configuration/environment-reference) jeden hier berührten Knopf und jeden, den die Anleitung in der Voreinstellung gelassen hat; [Authentifizierung](/de/self-hosted/admin/authentication) bindet die Instanz an deinen Identitäts-Anbieter; [Betrieb](/de/self-hosted/operate/observability/operations) deckt ab, was zu scrapen, zu loggen und zu alarmieren ist, sobald Traffic fließt. Für alles, was Endnutzer nach dem Login tun, liest sich [Platform](/de/platform) in Cloud und Selbsthosting identisch.
