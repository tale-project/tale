---
title: Fehlersuche
description: Symptom-zuerst-Karte der Probleme, die Operatoren auf einer laufenden Tale-Instanz tatsächlich treffen, mit den Behebungen, die in der Praxis funktionieren.
---

Diese Seite kartiert die Probleme, die Operatoren auf einer laufenden Tale-Instanz getroffen haben, zu den Behebungen, die funktioniert haben. Die Liste ist absichtlich kurz — ein vollständiger Katalog aller Fehlermodi verleitet dazu, am passenden Symptom vorbeizulesen. Überfliege die Unter-Überschriften, bis eine passt, dann lies die Prosa darunter; alles, was nicht hier steht, ist selten genug, dass der Diagnose-Pfad in jedem Fall derselbe ist: lies die Logs, dann reiche ein Issue ein.

Für jedes Symptom, das nicht unten steht, bringen das `--verbose`-Flag der `tale`-CLI plus die Per-Service-Container-Logs (siehe [Betrieb — Logs](/de/self-hosted/operate/observability/operations#logs)) fast immer die Ursache an die Oberfläche. Wenn das nicht reicht, reiche bei [GitHub Issues](https://github.com/tale-project/tale/issues) mit der ausführlichen CLI-Ausgabe und dem relevanten Log-Auszug ein.

## Die Platform meldet nie bereit

Ein frischer `platform`-Container braucht bis zu drei Minuten, bis `/tmp/platform-ready` landet, weil der Entrypoint wartet, bis die Env-Synchronisation fertig ist und `bunx convex deploy` die Funktionsmenge geschoben hat, bevor er gesund signalisiert. Die `200 OK`-Zeilen von der Proxy-Health-Probe kommen lange davor an — sie bedeuten nicht, dass die UI erreichbar ist.

Beobachte `docker compose logs -f platform` und warte auf die Zeile `Tale Dev v0.x.x  Ready.`. Wenn sie nie kommt, sind drei Ursachen häufig. Die häufigste ist ein nicht erreichbarer `convex`-Dienst — der Deploy-Schritt der Platform braucht Convex hoch, bevor er Funktionen schieben kann, also zieht ein convex-Container, der beim Boot crasht, die Platform mit sich. Die zweite ist ein fehlerhaftes Geheimnis in `.env`, das die Env-Synchronisation ablehnt; achte auf `[env-sync] rejecting key` in den convex-Logs. Die dritte ist Host-RAM: die Blue-Green-Topologie fährt beide Farben während des Wechsels, und auf einem 8-GB-Host wird der green-Container vor dem Deploy gekillt. Den Host auf 12 GB anheben ist die Behebung.

## "DB_PASSWORD must be set" auf jedem Dienst

`DB_PASSWORD` steuert vier Dienste, und jeder zeigt einen leicht anderen Fehler, wenn der Wert fehlt:

- `ERROR: DB_PASSWORD or POSTGRES_PASSWORD must be set` vom Datenbank-Container.
- `ERROR: DB_PASSWORD or POSTGRES_URL must be set` von der Platform.
- `ERROR: DB_PASSWORD or RAG_DATABASE_URL must be set` vom RAG-Dienst.
- `ERROR: DB_PASSWORD or CRAWLER_DATABASE_URL must be set` vom Crawler.

Öffne `.env`, setze `DB_PASSWORD` auf einen nicht leeren Wert und fahre `tale start` (oder `docker compose up`) erneut. Die Variable wird beim Container-Start gelesen, also nimmt ein laufender Stack sie nicht auf, bevor du ihn runterfährst und wieder hoch. Beim Verbinden mit einem externen Postgres setze stattdessen `POSTGRES_URL` und lass `DB_PASSWORD` ungesetzt — die vier Dienste lesen dann die URL direkt. Das vollständige Muster lebt unter [Produktions-Deployment — Externe Datenbank verwenden](/de/self-hosted/install/linux-server#using-an-external-database).

## Anbieter-Schlüssel-Änderungen greifen nicht

Die Anbieter-Konfiguration unter `$TALE_CONFIG_DIR/providers/<name>.json` (und die passende `.secrets.json`) wird vom convex-Container beobachtet — Speichern aus **Einstellungen > Anbieter** oder Bearbeiten der Datei von Hand löst denselben Reload aus. Zwei Fälle brechen das.

Der erste ist die SOPS-verschlüsselte Secrets-Datei, wenn `SOPS_AGE_KEY` nicht mehr gesetzt ist. Das Dateiformat ist selbstbeschreibend, also weigert sich der Loader, verschlüsselten Inhalt mit Klartext zu überschreiben, um Datenverlust zu verhindern — es würde sonst aussehen, als hätte der Operator seine Secrets-Storage still herabgestuft. Stelle den age-Schlüssel wieder her oder lösche die verschlüsselte Datei vor dem erneuten Speichern. Der vollständige Ablauf steht unter [Anbieter — Modi wechseln](/de/self-hosted/configuration/providers#switching-modes).

Der zweite ist, wenn die Datei aus dem falschen Mount bearbeitet wird. Tales Compose mountet `convex-data:/app/data` schreibbar auf dem convex-Dienst und dasselbe Volume schreibgeschützt auf platform, RAG und crawler. Bearbeite die Dateien vom Host (der Host-Pfad, der im convex-Container auf `/app/data/platform-config` gemappt ist) oder nutze die UI; ein In-Container-`vi` gegen den schreibgeschützten Mount scheitert still für Geschwister-Dienste und erreicht den Watcher nie.

## Dokumente bleiben für immer "indizierend"

Die Dokumenten-Indizierung ist eine mehrstufige Pipeline: der RAG-Dienst extrahiert Text, splittet ihn in Chunks, erzeugt Embeddings gegen einen `embedding`-getaggten Anbieter und schreibt die Chunks und Vektor-Einträge in ParadeDB. Ein hundertseitiges PDF braucht Minuten; ein tausendseitiger Export kann eine halbe Stunde dauern. Der Fortschritt ist pro Datei unter **Wissen > Dokumente** sichtbar.

Wenn die Indizierung unbegrenzt stockt, dominieren zwei Ursachen. Der `embedding`-getaggte Anbieter ist entweder fehlkonfiguriert oder ratelimitiert — prüfe `docker compose logs rag` auf `provider error`-Zeilen, die den fehlschlagenden Anbieter und den vom vorgelagerten Dienst zurückgegebenen HTTP-Status benennen. Oder der externe Postgres, auf den du Tale ausgerichtet hast, hat die `vector`-Erweiterung nicht; das Symptom ist `extension "vector" is not available` in den RAG-Logs. Installiere pgvector auf der externen Instanz gemäß [Produktions-Deployment — Externe Datenbank verwenden](/de/self-hosted/install/linux-server#using-an-external-database).

## Wo Hilfe zu finden ist

Logs sind der erste Ort, an dem man nachsieht — `docker compose logs -f` für einen Live-Stream, `tale logs <service> --tail 200`, wenn der Stack unter `tale deploy` läuft. Der Container-Smoke-Test (`bun run docker:test`) validiert den vollen Stack aus einem sauberen Zustand und fängt Port-Konflikte und Abhängigkeits-Drift auf einem Entwicklungs-Host, bevor sie die Produktion erreichen.

Für Probleme, die ein Log-Lesen überleben, reiche bei [GitHub Issues](https://github.com/tale-project/tale/issues) mit der ausführlichen CLI-Ausgabe und dem `compose.yml`-Ausschnitt ein, den du fährst. Sicherheitsrelevante Funde gehen stattdessen über [Sicherheitshinweise](/de/self-hosted/operate/security/advisories), wo ein privater Entwurf der öffentlichen Bekanntgabe zuvorkommt, bis ein Patch verfügbar ist.
