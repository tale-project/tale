---
title: Fehlerbehebung
description: Lösungen für häufige Probleme und wo du Hilfe findest.
---

## Häufige Probleme

### "Docker Engine not found" unter Windows

Das bedeutet, dass Docker Desktop nicht läuft. Öffne Docker Desktop aus dem Startmenü oder der Taskleiste, warte, bis die Engine grün ist, und führe das Kommando erneut aus.

### Browser zeigt Zertifikats-Warnung

Tale nutzt für lokale Entwicklung ein selbstsigniertes Zertifikat. Du kannst die Warnung wegklicken oder sie dauerhaft loswerden mit:

```bash
docker exec tale-proxy caddy trust
```

Danach Browser neu starten.

### Platform lädt nicht nach `docker compose up`

Warte in den Logs auf die Ready-Meldung der Platform. Das kann bis zu zwei Minuten dauern. Die `200 OK`-Health-Check-Meldungen davor bedeuten noch nicht, dass die UI bereit ist.

### KI-Antworten sind langsam oder schlagen fehl

Prüfe deinen Anbieter-API-Schlüssel unter Einstellungen > Anbieter. Typische Ursachen:

- Abgelaufener oder widerrufener API-Schlüssel. Regeneriere ihn auf openrouter.ai und aktualisiere ihn unter Einstellungen > Anbieter.
- Zu wenig Guthaben auf deinem OpenRouter-Konto.
- Das im Anbieter-File konfigurierte Modell ist auf deinem Tier nicht verfügbar.
- Netzwerk-Problem zwischen Tale-Server und OpenRouter-API.

### Dokumente sind nach Upload nicht durchsuchbar

Die Indizierung läuft im Hintergrund. Nach dem Upload extrahiert der RAG-Dienst Text, zerlegt ihn in Chunks, erzeugt Embeddings und schreibt in die DB. Große Dateien wie mehrere-hundertseitige PDFs können mehrere Minuten dauern. Der Status-Indikator unter Wissen > Dokumente zeigt den aktuellen Stand.

### Website-Crawling zeigt keine Seiten

Nach dem Hinzufügen einer Website macht der Crawler einen ersten Durchlauf der Startseite und der gefundenen Links. Das dauert je nach Größe einige Minuten. Bleibt die Seitenzahl bei 0, prüfe `docker compose logs crawler` auf Fehler. Typische Ursachen sind TLS-Probleme auf der Ziel-Site oder Blockaden per `robots.txt`.

### Dienst schlägt fehl mit "DB_PASSWORD must be set"

Alle Dienste, die an die Datenbank angeschlossen sind, brauchen `DB_PASSWORD` in der `.env`. Wenn du eine dieser Meldungen siehst:

- `ERROR: DB_PASSWORD or POSTGRES_PASSWORD must be set` (Datenbank)
- `ERROR: DB_PASSWORD or POSTGRES_URL must be set` (Platform)
- `ERROR: DB_PASSWORD or RAG_DATABASE_URL must be set` (RAG)

öffne deine `.env` und stelle sicher, dass `DB_PASSWORD` auf einen nicht-leeren Wert gesetzt ist. Bei der Ersteinrichtung wählst du ein beliebiges Passwort. Hast du vorher auf den Default vertraut, setze ihn jetzt explizit.

### Admin-Passwort vergessen

Wenn du aus deinem Admin-Konto ausgesperrt bist, kann ein anderer Admin dein Passwort unter Einstellungen > Organisation > Members-Zeile > Bearbeiten > Passwort setzen zurücksetzen. Gibt es keinen anderen Admin, kann jemand mit Docker-Zugriff den Nutzer-Datensatz im Convex-Dashboard direkt anpassen.

## Docker-Build- und Container-Probleme

### Docker-Build schlägt mit "parent snapshot does not exist" fehl

Das ist ein Cache-Problem in Docker BuildKit. Fix: Build-Cache aufräumen.

```bash
docker builder prune -f
```

Danach Build erneut starten.

### Port bereits in Benutzung

Wenn `docker compose up` scheitert, weil Ports (5432, 8001, 8002, 80, 443) bereits von anderen Diensten auf deiner Maschine verwendet werden, nutze den Test-Compose-Override, der auf nicht-konflikthafte Ports mappt:

```bash
docker compose -f compose.yml -f compose.test.yml --env-file .env.test -p tale-test up -d --build
```

Der nutzt die Ports 15432, 18001, 18002, 10080 und 10443.

### Image unerwartet groß nach Änderungen

Wenn ein Docker-Image nach deinen Änderungen deutlich wächst:

1. Prüfe, dass neue Abhängigkeiten mit `--no-install-recommends` (apt) oder `--no-cache-dir` (pip/uv) installiert werden.
2. Stelle sicher, dass Build-Zeit-Dependencies in der Builder-Stage bleiben (nicht nach Runtime kopiert).
3. Lass den Image-Size-Budget-Checker laufen:

```bash
bun run docker:test:image
```

4. Nutze `dive`, um zu sehen, welche Layer am größten sind:

```bash
dive <image>
```

Siehe [Contributing Docker guide](/de/develop/contributing-docker) für Techniken zur Image-Reduktion.

### DB zeigt Duplicate-Key-Fehler beim Start

Beim ersten Start kann die DB Meldungen wie `ERROR: duplicate key value violates unique constraint` zeigen. Die sind harmlos. Sie treten auf, wenn das `uuid-ossp`-Extension-Init-Skript idempotent läuft. Die Extension ist im ParadeDB-Basis-Image bereits installiert, und das Init-Skript kommt elegant mit dem Konflikt klar.

### Container-Health-Check scheitert dauerhaft

Bleibt ein Dienst im Status `starting` oder `unhealthy`:

1. Logs prüfen:

```bash
docker compose logs <service> --tail=50
```

2. Verifizieren, dass `.env` alle benötigten Variablen enthält (insbesondere `DB_PASSWORD`, `OPENAI_API_KEY`).
3. Prüfen, dass abhängige Dienste gesund sind (z. B. Platform hängt an db, rag, crawler).
4. Für die Platform: bis zu 5 Minuten Zeit lassen, damit das Convex-Framework beim Kaltstart Functions kompiliert und deployt.

## Hilfe bekommen

- Logs: `docker compose logs -f` ist immer die erste Anlaufstelle.
- Container-Tests: `bun run docker:test` validiert den ganzen Stack.
- GitHub Issues: https://github.com/tale-project/tale/issues.
- Convex-Dashboard: nützlich, um rohe Daten und Function-Logs beim Debuggen von Backend-Problemen einzusehen.
