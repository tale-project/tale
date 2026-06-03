---
title: Datenresidenz
description: Richte die Wissensdatenbank, die Anwendungsdatenbank und den Speicher für hochgeladene Dateien einer selbst gehosteten Tale-Installation auf Infrastruktur aus, die du selbst kontrollierst — von Administratoren unter Einstellungen > Datenresidenz konfiguriert und beim Neustart angewendet.
---

Eine selbst gehostete Tale-Installation läuft auf Infrastruktur, die du ohnehin schon kontrollierst, also liegen ihre Daten standardmäßig auf deinen Hosts. **Datenresidenz** ist für den Fall gedacht, dass du einzelne Datenspeicher auf dein eigenes verwaltetes Postgres oder deinen Objektspeicher ausrichten willst statt auf die mitgelieferten Container — etwa um Dokumenttext in einer Datenbank zu halten, die dein Team betreibt, oder hochgeladene Dateien in deinem eigenen S3-Bucket. Administratoren konfigurieren das unter **Einstellungen > Datenresidenz**; die Änderung wird in eine einzige Konfigurationsdatei auf Deployment-Ebene geschrieben und **greift, sobald die betroffenen Container neu starten**.

Diese Seite behandelt, was sich verlagern lässt, die eine Voraussetzung, die zubeißt (ParadeDB), wie die Konfiguration abgelegt und angewendet wird, und wie du sicher neu startest.

## Bearbeitung aktivieren

Die Seite ansehen darf jeder Owner oder Admin einer Organisation, aber **bearbeiten** — einen Datenspeicher umlenken, Secrets speichern, einen Verbindungstest laufen lassen oder einen Neustart auslösen — darf nur eine benannte Allowlist von Operatoren. Trage deren Anmelde-E-Mails (kommagetrennt) in `.env` ein und starte neu:

```bash
TALE_DEPLOYMENT_CONFIG_ADMINS=alice@example.com,bob@example.com
```

Ist die Allowlist leer oder nicht gesetzt, zeigt **Einstellungen > Datenresidenz** Administratoren die aktuelle Konfiguration weiterhin an, aber nur lesend — Speichern, Testen und Anwenden & neu starten verweigern für alle den Dienst. Nur ein angemeldeter Admin, dessen E-Mail auf der Liste steht, bekommt eine bearbeitbare Seite; die Seite nennt dir, welche E-Mail einzutragen ist. Die Entrypoints lesen die Konfigurationsdatei unabhängig von der Allowlist, also kann ein Operator, der die Datei lieber direkt auf der Platte bearbeitet, das tun, ohne UI-Bearbeiter zu benennen.

## Was du verlagern kannst

Drei Speicher, jeder unabhängig und optional. Eine fehlende Einstellung bedeutet „nimm den mitgelieferten Default" — eine frische Installation ohne Konfiguration bleibt also unverändert.

- **Wissensdatenbank** — der RAG-Speicher: Dokumentmetadaten, der extrahierte Chunk-Text, Embeddings, der BM25-Index und der semantische Cache. Das ist der Speicher, um den sich Residenz-Anforderungen am meisten drehen, weil er deinen Dokumentinhalt hält.
- **Dateispeicher** — wo hochgeladene Dateien (die ursprünglichen Blobs) liegen. Standardmäßig sitzen sie auf dem lokalen Convex-Volume; du kannst sie auf einen externen S3-kompatiblen Bucket ausrichten.
- **Anwendungsdatenbank** (erweitert) — die Convex-Metadaten-Datenbank.

> Hinweis: Die Wissensdatenbank zu verlagern verschiebt den extrahierten Text und die Embeddings. Die ursprünglich hochgeladenen Dateien wandern erst mit, wenn du auch den **Dateispeicher** auf S3 ausrichtest.

## Die ParadeDB-Voraussetzung

Die Wissensdatenbank nutzt zwei Postgres-Erweiterungen: `vector` (pgvector) für Embeddings und `pg_search` (ParadeDB) für die Volltext-/BM25-Hybrid-Suche. Ein externes Wissens-Postgres **muss ParadeDB ausführen** (das beide bündelt), damit die Suchqualität voll erhalten bleibt. Richtest du es auf ein schlichtes Postgres aus, das nur `pgvector` hat, funktionieren Indexierung und Vektor-Suche weiter, aber die Hybrid-Suche fällt auf **reine Vektor-Suche** zurück — die BM25-Hälfte wird still übersprungen. Der Knopf **Verbindung testen** meldet die Verfügbarkeit von `pgvector` und `pg_search`, damit du das siehst, bevor du dich festlegst. Die Datenbanken (`tale`, `tale_knowledge`) müssen bereits existieren; der RAG-Dienst führt beim Boot seine Migrationen gegen sie aus.

## Dateispeicher auf S3

Externer Dateispeicher ist alles-oder-nichts über die Speicher-Use-Cases von Convex hinweg, also gibst du **fünf Buckets** an — files, exports, snapshot-imports, modules und search — plus Region und Anmeldedaten. Für S3-kompatible Dienste (MinIO, Cloudflare R2) setzt du den Endpunkt und aktivierst die Path-Style-Adressierung.

> **Nur Greenfield.** Den Dateispeicher von lokal auf S3 umzustellen migriert die bereits auf dem lokalen Volume liegenden Blobs **nicht** — Convex sucht sie im Bucket und findet sie nicht. Setze S3 bei der ersten Installation, oder kopiere den vorhandenen lokalen Speicher vorab in den Bucket, bevor du umstellst.

## Wie die Konfiguration abgelegt wird

Speichern schreibt zwei Dateien im Konfigurations-Root (nicht unter einem Org-Verzeichnis):

- `deployment.json` — die nicht geheime Konfiguration (Hosts, Ports, Buckets, Modi).
- `deployment.secrets.json` — die Datenbank-Passwörter und S3-Schlüssel, SOPS-verschlüsselt (siehe [Secrets mit SOPS](/de/self-hosted/configuration/secrets-with-sops)).

Beim Boot lesen die `rag`- und `convex`-Entrypoints diese und leiten ihre Verbindungen ab, bevor sie starten. Der Vertrag ist **fail-closed**: ein vorhandenes, aber unparsbares `deployment.json`, ein nicht entschlüsselbares Secret oder eine Konfiguration ohne Pflichtfelder **bricht den Start ab**, statt still auf die mitgelieferte Datenbank zurückzufallen — regulierte Daten fehlzuleiten ist schlimmer, als nicht zu starten. Eine fehlende Datei ist der normale Default-Pfad.

## Eine Änderung anwenden: Neustart

Die Konfiguration wird beim Boot gelesen, also greift ein Speichern erst, wenn die **`rag`- und `convex`**-Container neu starten (die Plattform selbst muss nicht neu starten). Zwei Wege:

- **Manuell** — `docker compose restart rag convex`, oder `tale deploy --services rag` für einen Zero-Downtime-Blue-Green-Roll.
- **Ein Klick** — aktiviere den Opt-in-Dienst `controller` (`docker compose --profile controller up -d`). Er ist ein kleiner, nur intern erreichbarer Sidecar, der die beiden erlaubten Dienste auf eine HMAC-signierte Anfrage der App neu startet, damit die browserzugewandte Plattform nie Docker-Socket-Zugriff braucht. Läuft er, erledigt der Knopf **Anwenden & neu starten** den Neustart für dich; setze `CONTROLLER_TOKEN` (geteilt mit der Plattform) und `CONTROLLER_URL` in `.env`. Ohne ihn zeigt der Knopf den manuellen Befehl.

Die relevanten Umgebungsvariablen sind `TALE_DEPLOYMENT_CONFIG_ADMINS` (die kommagetrennte E-Mail-Allowlist der bearbeitungsberechtigten Operatoren) und — nur beim Ein-Klick-`controller` — `CONTROLLER_TOKEN` (das geteilte HMAC-Geheimnis) und `CONTROLLER_URL` (z. B. `http://controller:8004`). Setze sie in `.env`. Siehe auch [Umgebungsvariablen-Referenz](/de/self-hosted/configuration/environment-reference) und [Secrets mit SOPS](/de/self-hosted/configuration/secrets-with-sops).
