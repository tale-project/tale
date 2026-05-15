---
title: Fehlerbehebung
description: Symptom-zuerst-Karte der Probleme, die Betreiber auf einer laufenden Tale-Instanz tatsächlich treffen, mit den Fixes, die in der Praxis funktionieren.
---

Diese Seite ordnet die Probleme, die Betreiber auf einer laufenden Tale-Instanz tatsächlich getroffen haben, den Fixes zu, die funktioniert haben. Die Liste ist bewusst kurz — umfassende Fehlermodi-Kataloge verleiten dazu, am eigentlichen Symptom vorbeizuscrollen. Lies die Unter-Überschriften, bis eine zu dem passt, was du siehst, und lies dann die Prosa darunter. Was hier nicht aufgeführt ist, kommt selten genug vor, dass der Diagnose-Pfad in jedem Fall derselbe ist: Logs lesen, dann ein Issue eröffnen.

Für jedes Symptom, das unten nicht erscheint, legen das `--verbose`-Flag der `tale`-CLI plus die Container-Logs (siehe [Operations — Logs](/de-CH/self-hosted/operate/observability/operations#viewing-logs)) fast immer die Ursache frei. Wenn das nicht reicht, öffne ein Issue auf [GitHub Issues](https://github.com/tale-project/tale/issues) und hänge die Verbose-Ausgabe an.

## Platform meldet nie ready

Ein frischer Container braucht bis zu drei Minuten, bevor `/tmp/platform-ready` landet, weil das Entrypoint wartet, bis die Env-Sync fertig ist und `bunx convex deploy` das Function-Set hochgeschoben hat, bevor es gesund signalisiert. Die `200 OK`-Zeilen der Proxy-Health-Probe kommen lange davor an — sie bedeuten **nicht**, dass die UI erreichbar ist.

Beobachte `docker compose logs -f platform` und warte auf die Zeile `Tale Dev v0.x.x  Ready.`. Bleibt sie aus, sind drei Ursachen typisch: ein nicht erreichbarer `convex`-Service (der Platform-Deploy-Schritt braucht ihn oben), ein verkorkstes Secret in `.env`, das die Env-Sync ablehnt (suche `[env-sync] rejecting key` in den Convex-Logs), oder zu wenig RAM auf dem Host, sodass der grüne Deploy neben dem blauen nicht starten kann. Die Blue-Green-Topologie setzt 12 GB voraus; auf 8-GB-Hosts wird der grüne Container abgewürgt, bevor er deployt.

## "DB_PASSWORD must be set" auf jedem Dienst

`DB_PASSWORD` blockiert vier Dienste und meldet sich aus jedem mit leicht unterschiedlichem Wortlaut:

- `ERROR: DB_PASSWORD or POSTGRES_PASSWORD must be set` vom Datenbank-Container.
- `ERROR: DB_PASSWORD or POSTGRES_URL must be set` von der Platform.
- `ERROR: DB_PASSWORD or RAG_DATABASE_URL must be set` vom RAG-Dienst.
- `ERROR: DB_PASSWORD or CRAWLER_DATABASE_URL must be set` vom Crawler.

Öffne `.env` und setze `DB_PASSWORD` auf einen nicht-leeren Wert. Starte `tale start` (oder `docker compose up`) neu — die Variable wird beim Container-Start gelesen, ein laufender Stack zieht den neuen Wert erst, wenn du ihn runterfährst und wieder hochfährst. Wenn du an ein externes Postgres anschliesst, setze stattdessen `POSTGRES_URL` und lass `DB_PASSWORD` leer; die vier Dienste lesen dann die URL direkt. Das vollständige Muster steht in [Linux-Server-Installation — Externe Datenbank nutzen](/de-CH/self-hosted/install/linux-server#externe-datenbank-nutzen).

## Anbieter-Schlüssel-Änderungen wirken nicht

Anbieter-Konfiguration (`$TALE_CONFIG_DIR/providers/<name>.json` und die `.secrets.json`-Schwester) wird vom Convex-Container überwacht — Speichern unter **Einstellungen > Anbieter** oder direktes Bearbeiten der Datei lösen denselben Reload aus. Zwei Fälle brechen das:

- **Die Secrets-Datei ist SOPS-verschlüsselt, aber `SOPS_AGE_KEY` ist nicht mehr gesetzt.** Das Dateiformat ist selbst-beschreibend, also weigert sich der Loader, verschlüsselten Inhalt mit Klartext zu überschreiben, um Datenverlust zu vermeiden. Stelle den Age-Schlüssel wieder her oder lösche die verschlüsselte Datei, bevor du neu speicherst. Der vollständige Ablauf steht in [Anbieter — Modi wechseln](/de-CH/self-hosted/configuration/providers#modi-wechseln).
- **Du hast die Datei im schreibbaren Container-Mount bearbeitet.** Tales Compose mountet `convex-data:/app/data` für den Convex-Dienst schreibbar und denselben Volume nur-lesbar für Platform/RAG/Crawler. Bearbeite die Dateien vom Host aus (`$TALE_CONFIG_DIR` auf dem Host wird in `/app/data/platform-config` im Convex-Container abgebildet) oder nutze die UI; in-Container-`vi` gegen den nur-lesbaren Mount versagt für die Geschwister-Dienste still.

## Dokumente bleiben für immer "indiziert"

Die Dokumenten-Indizierung ist eine mehrstufige Pipeline: Der RAG-Dienst extrahiert Text, zerlegt ihn in Chunks, erzeugt Embeddings und schreibt sie mit Vektor-Einträgen nach ParadeDB. Ein hundertseitiges PDF dauert Minuten; ein tausendseitiger Export kann eine halbe Stunde brauchen. Den Fortschritt zeigt **Wissen > Dokumente** pro Datei.

Wenn die Indizierung dauerhaft hängt, dominieren zwei Ursachen: Der mit `embedding` getaggte Anbieter ist falsch konfiguriert oder rate-limitiert (prüfe `docker compose logs rag` auf `provider error`-Zeilen), oder pgvector fehlt auf dem externen Postgres, an das du Tale angeschlossen hast. Der zweite Fall taucht in den RAG-Logs als `extension "vector" is not available` auf; installiere pgvector auf der externen Instanz wie in [Linux-Server-Installation — Externe Datenbank nutzen](/de-CH/self-hosted/install/linux-server#externe-datenbank-nutzen) beschrieben.

## Wo du Hilfe findest

Logs sind die erste Anlaufstelle — `docker compose logs -f` für einen Live-Stream, `tale logs <service> --tail 200`, wenn eine Instanz schon unter `tale deploy` läuft. Der Container-Smoke-Test (`bun run docker:test`) validiert den vollen Stack aus einem sauberen Zustand und fängt Port-Konflikte und Dependency-Drift auf einem Entwickler-Host.

Für Probleme, die ein Log-Lesen überleben, eröffne auf [GitHub Issues](https://github.com/tale-project/tale/issues) ein Issue mit der Verbose-CLI-Ausgabe und dem `compose.yml`-Snippet, das du fährst. Sicherheits-relevante Funde gehen stattdessen durch [Sicherheitshinweise](/de-CH/self-hosted/operate/security/advisories), wo ein privater Entwurf der öffentlichen Bekanntmachung vorausgeht, bis ein Patch verfügbar ist.
