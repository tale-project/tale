---
title: Datenresidenz
description: Richte die Wissensdatenbank, die Anwendungsdatenbank und den Speicher für hochgeladene Dateien einer selbst gehosteten Tale-Installation auf Infrastruktur aus, die du selbst kontrollierst — von Administratoren unter Einstellungen > Datenresidenz konfiguriert und beim Neustart angewendet.
---

Eine selbst gehostete Tale-Installation läuft auf Infrastruktur, die du ohnehin schon kontrollierst, also liegen ihre Daten standardmäßig auf deinen Hosts. **Datenresidenz** ist für den Fall gedacht, dass du einzelne Datenspeicher auf dein eigenes verwaltetes Postgres oder deinen Objektspeicher ausrichten willst statt auf die mitgelieferten Container — etwa um Dokumenttext in einer Datenbank zu halten, die dein Team betreibt, oder hochgeladene Dateien in deinem eigenen S3-Bucket. Der Wissens-Korpus läuft genau deshalb als eigener Container (`knowledge-db`), damit er sich unabhängig von der operativen Datenbank verlagern oder ersetzen lässt — er ist der Speicher, um den sich die meisten Residenz-Anforderungen drehen. Administratoren konfigurieren das unter **Einstellungen > Datenresidenz**; die Änderung wird in eine einzige Konfigurationsdatei auf Deployment-Ebene geschrieben und **greift, sobald die betroffenen Container neu starten**.

Diese Seite behandelt, was sich verlagern lässt, die eine Voraussetzung, die zubeißt (ParadeDB), wie die Konfiguration abgelegt und angewendet wird, und wie du sicher neu startest.

## Bearbeitung aktivieren

**Einstellungen > Datenresidenz** ist eine einzige Seite mit zwei Arten von Abschnitten: den deployment-weiten Speichern, die sich alle Organisationen teilen, und den Speichern, die eine einzelne Organisation selbst mitbringt. Jeder Abschnitt erscheint lesend oder bearbeitbar, je nachdem, was die lesende Person ändern darf, und die Seite benennt den Zustand. Ansehen darf jeder Owner oder Admin einer Organisation; die **deployment-weiten Speicher bearbeiten** — einen Datenspeicher umlenken, Secrets speichern, einen Verbindungstest laufen lassen oder einen Neustart auslösen — darf nur eine benannte Allowlist von Operatoren. Trage deren Anmelde-E-Mails (kommagetrennt) in `.env` ein und starte neu:

```bash
TALE_DEPLOYMENT_CONFIG_ADMINS=alice@example.com,bob@example.com
```

Ist die Allowlist leer oder nicht gesetzt, zeigen die Deployment-Abschnitte Administratoren die aktuelle Konfiguration weiterhin an, aber nur lesend — Speichern, Testen und Anwenden & neu starten verweigern für alle den Dienst. Nur ein angemeldeter Admin, dessen E-Mail auf der Liste steht, bekommt diese Abschnitte bearbeitbar; die Seite nennt dir, welche E-Mail einzutragen ist. Die Entrypoints lesen die Konfigurationsdatei unabhängig von der Allowlist, also kann ein Operator, der die Datei lieber direkt auf der Platte bearbeitet, das tun, ohne UI-Bearbeiter zu benennen.

## Was du verlagern kannst

Drei Speicher, jeder unabhängig und optional. Eine fehlende Einstellung bedeutet „nimm den mitgelieferten Default" — eine frische Installation ohne Konfiguration bleibt also unverändert.

- **Wissensdatenbank** — der Wissens-Korpus: Dokumentmetadaten, der extrahierte Chunk-Text, Embeddings, der BM25-Index, der semantische Cache und die gecrawlten Webseiten. Sie kommt als mitgelieferter `knowledge-db`-Container (`tale_knowledge`, mit den Schemata `private_knowledge` und `public_web`) und ist der Speicher, um den sich die meisten Residenz-Anforderungen drehen, weil er deinen Dokumentinhalt hält. Richte ihn auf dein eigenes verwaltetes Postgres aus, um den Korpus auf Infrastruktur zu halten, die dein Team betreibt.
- **Dateispeicher** — wo hochgeladene Dateien (die ursprünglichen Blobs) liegen. Standardmäßig sitzen sie auf dem lokalen Convex-Volume; du kannst sie auf einen externen S3-kompatiblen Bucket ausrichten.
- **Anwendungsdatenbank** (erweitert) — die operative Convex-Datenbank (der mitgelieferte `db`-Container). Das Convex-Backend leitet den Namen dieser Datenbank aus `INSTANCE_NAME` (`tale_platform`) ab und verbindet sich nur über Host:Port, daher muss das externe Postgres eine Datenbank mit genau dem Namen `tale_platform` enthalten. Ihr TLS-Modus wird vom Convex-Treiber vorgegeben und ist nicht konfigurierbar.

> Hinweis: Die Wissensdatenbank und die Anwendungsdatenbank sind zwei separate Postgres-Instanzen — die eine zu verschieben rührt die andere nicht an. Die Wissensdatenbank zu verlagern verschiebt den extrahierten Text und die Embeddings; die ursprünglich hochgeladenen Dateien wandern erst mit, wenn du auch den **Dateispeicher** auf S3 ausrichtest.

## Die ParadeDB-Voraussetzung

Die Wissensdatenbank nutzt zwei Postgres-Erweiterungen: `vector` (pgvector) für Embeddings und `pg_search` (ParadeDB) für die Volltext-/BM25-Hybrid-Suche. Ein externes Wissens-Postgres **muss ParadeDB ausführen** (das beide bündelt), damit die Suchqualität voll erhalten bleibt. Richtest du es auf ein schlichtes Postgres aus, das nur `pgvector` hat, funktionieren Indexierung und Vektor-Suche weiter, aber die Hybrid-Suche fällt auf **reine Vektor-Suche** zurück — die BM25-Hälfte wird still übersprungen. Der Knopf **Verbindung testen** meldet die Verfügbarkeit von `pgvector` und `pg_search`, damit du das siehst, bevor du dich festlegst. Die externe Wissensdatenbank muss bereits existieren (sie kann jeden Namen tragen, den du einträgst — `tale_knowledge` per Konvention) mit den Schemata `private_knowledge` und `public_web`; die Baseline-Schema-Migrationen leben in [`services/db/migrations/`](https://github.com/tale-project/tale/tree/main/services/db/migrations) und werden per dbmate angewendet, wenn die Datenbank hochkommt.

## Wissensdatenbanken pro Organisation

Die Speicher oben gelten deployment-weit — jede Organisation teilt sie sich. Eine einzelne Organisation kann stattdessen **ihren eigenen** Wissens-Korpus auf ein Postgres ausrichten, das du für sie bereitstellst, während jede andere Org weiter den mitgelieferten `knowledge-db` nutzt. Greif dazu, wenn der Dokument- und Web-Crawl-Inhalt eines Mandanten auf Infrastruktur liegen muss, die vom Rest isoliert ist — eine strengere Residenz-Anforderung, als der Deployment-Default sie erfüllt.

Der **gesamte** Wissens-Korpus der Org wandert — beide Schemata: `private_knowledge` (Dokumentmetadaten, Chunk-Text, Embeddings und der semantische Cache) und `public_web` (die vom Crawler erfassten Website-Seiten, ihr Chunk-Text und die Embeddings). Nichts in der Wissensdatenbank einer Organisation wird mit einer anderen Organisation geteilt.

Die Verbindung liegt im eigenen Konfigurationsverzeichnis der Organisation, nicht in der Deployment-Datei:

- `$TALE_CONFIG_DIR/<orgSlug>/knowledge/connection.json` — Host, Port, Datenbank, Benutzer und sslmode.
- `$TALE_CONFIG_DIR/<orgSlug>/knowledge/connection.secrets.json` — das Passwort, SOPS-verschlüsselt, sobald ein SOPS-Age-Schlüssel konfiguriert ist (siehe [Secrets mit SOPS](/de/self-hosted/configuration/secrets-with-sops)).

Dieselbe ParadeDB-Voraussetzung gilt. Die Org prüft ihre Kandidaten-Datenbank mit einem organisationsweiten Verbindungstest, der die Verfügbarkeit von `pgvector` und `pg_search` meldet, bevor sie umschaltet; ein Ziel mit nur pgvector lässt die Suche dieser Org auf reine Vektor-Suche zurückfallen. Die Datenbank darf leer starten — Tale legt die Schemata `private_knowledge` und `public_web` beim ersten Zugriff an, du wendest die Baseline-Migrationen also nie von Hand an.

Dieser Weg fällt sicher zurück. Eine Organisation ohne `connection.json` nutzt weiter den Deployment-Default `knowledge-db` genau wie zuvor, das Feature ändert also nichts für Orgs, die sich nicht dafür entscheiden. Zwei Organisationen, die auf dieselbe Datenbank zeigen, teilen sich einen Verbindungs-Pool, und — anders als die deployment-weiten Speicher — braucht eine Änderung pro Org keinen Container-Neustart: die nächste Anfrage dieser Org wird auf ihre eigene Datenbank geleitet.

Ein Inhaber oder Admin der Organisation kann diese Verbindung auch über die UI verwalten: die Organisations-Abschnitte von **Einstellungen > Datenresidenz** lesen und schreiben genau diese Dateien, mit demselben Verbindungstest vor dem Umschalten. Diese Abschnitte bleiben für Inhaber und Admins der Organisation bearbeitbar, ob die Operator-Allowlist sie nennt oder nicht — die Dateien dahinter gehören der Organisation, nicht dem Deployment. Die JSON-Dateien auf der Platte bleiben die Quelle der Wahrheit — ein Operator, der sie lieber von Hand bearbeitet, braucht keinen UI-Schritt.

## Objektspeicher pro Organisation

Dasselbe Pro-Organisation-Muster deckt hochgeladene Dateien ab. Eine einzelne Organisation kann **ihre eigenen** Datei-Blobs — Knowledge-Hub-Dokumente, Chat-Anhänge, Audio und generierte Medien — auf einen S3-kompatiblen Bucket ausrichten, den du für sie bereitstellst (AWS S3, MinIO, Cloudflare R2, …), während jede andere Org weiter den Deployment-Default nutzt. Der Bucket gehört dieser einen Organisation; nichts darin wird mit anderen Organisationen geteilt.

Die Verbindung liegt neben der Wissens-Verbindung im Konfigurationsverzeichnis der Organisation:

- `$TALE_CONFIG_DIR/<orgSlug>/object-storage/connection.json` — Region, optionaler Endpoint (für MinIO/R2), Path-Style-Flag, Bucket und ein optionales Key-Präfix.
- `$TALE_CONFIG_DIR/<orgSlug>/object-storage/connection.secrets.json` — das Schlüsselpaar, SOPS-verschlüsselt, sobald ein SOPS-Age-Schlüssel konfiguriert ist (siehe [Secrets mit SOPS](/de/self-hosted/configuration/secrets-with-sops)).

Anders als der deployment-weite S3-Schalter oben ist dieser Weg **nicht** nur für Neuinstallationen: Sobald die Konfiguration existiert, landen neue Uploads im Bucket der Org, während zuvor gespeicherte Dateien lesbar bleiben, wo sie sind — gemischte Referenzen werden unterstützt, du kannst also jederzeit umschalten. Früher gespeicherte Dateien bleiben im Convex-Speicher, bis du sie mit dem Blob-Backfill unten verlagerst. Entfernst du die Konfiguration, landen neue Uploads wieder im Deployment-Default; bereits in den Bucket geschriebene Dateien bleiben dort, Tale kann sie aber erst wieder lesen, wenn die Verbindung erneut eingerichtet ist. Ein Neustart ist in keine Richtung nötig.

Org-Admins verwalten auch diese Verbindung in denselben Organisations-Abschnitten von **Einstellungen > Datenresidenz**; der dortige Verbindungstest führt einen echten Hochladen-Lesen-Löschen-Durchlauf gegen den Bucket aus, bevor du dich festlegst. Wie bei der Wissens-Verbindung bleiben die JSON-Dateien die Quelle der Wahrheit.

> **Erlaube den Origin der App in der CORS-Policy des Buckets.** Uploads und Downloads laufen über vorsignierte URLs direkt zwischen Browser und Bucket, der Bucket muss Cross-Origin-Anfragen von der URL deines Deployments also akzeptieren — erlaube diesen Origin mit den Methoden `GET`, `PUT` und `HEAD` sowie allen Request-Headern (Cloudflare R2: **Settings > CORS Policy** des Buckets; AWS S3 und MinIO: die CORS-Konfiguration des Buckets). Der Verbindungstest in der App läuft auf dem Server, nicht im Browser — eine fehlende CORS-Policy zeigt sich deshalb erst später, als fehlgeschlagener Upload.

### Vorhandene Dateien in den Bucket verschieben

Den Bucket zu verbinden leitet nur **neue** Uploads um; die Blobs, die vor der Verbindung geschrieben wurden, bleiben in Convex' `_storage` und funktionieren weiter über die gemischten Referenzen oben. Um auch diese Historie auf deine eigene Infrastruktur zu holen — der eigentliche Sinn der Datenresidenz — führe den **Blob-Backfill** aus: eine Operator-Aktion, die jeden vorhandenen Blob in den Bucket der Org kopiert, prüft, dass er Byte für Byte identisch zurückkommt, jede referenzierende Zeile umschreibt und die Convex-Kopie löscht.

Führe ihn aus einer Shell mit Convex-CLI-Zugriff aus und übergib die ID der Organisation. Mach zuerst einen Probelauf, um zu sehen, was verschoben würde, dann den echten Lauf:

```bash
# Probelauf — zählt und sampelt, was verschoben würde, schreibt nichts:
bunx convex run object_storage/backfill_actions:migrateOrgBlobsToObjectStorage '{"organizationId":"<organizationId>","dryRun":true}'

# Der echte Lauf — lass dryRun weg, sobald die Zahlen stimmen:
bunx convex run object_storage/backfill_actions:migrateOrgBlobsToObjectStorage '{"organizationId":"<organizationId>"}'
```

Der Backfill ist **idempotent** und **org-gebunden**: Er verschiebt nur die Blobs dieser Organisation, überspringt alles, was schon im Bucket liegt, und lässt jede Convex-Quelle stehen, bis ihre Kopie verifiziert ist — ein erneuter Lauf nach einer Unterbrechung setzt also sicher fort. Ein echter Lauf braucht die zuvor konfigurierte Bucket-Verbindung; ein Probelauf nicht. Das ist bewusst **keine** versionierte Framework-Migration — er läuft auf Abruf, pro Organisation, wenn du die Historie eines Mandanten verlagern willst, nicht an einer Release-Grenze.

## Dateispeicher auf S3

Externer Dateispeicher ist alles-oder-nichts über die Speicher-Use-Cases von Convex hinweg, also gibst du **fünf Buckets** an — files, exports, snapshot-imports, modules und search — plus Region und Anmeldedaten. Für S3-kompatible Dienste (MinIO, Cloudflare R2) setzt du den Endpunkt und aktivierst die Path-Style-Adressierung.

> **Nur Greenfield.** Den Dateispeicher von lokal auf S3 umzustellen migriert die bereits auf dem lokalen Volume liegenden Blobs **nicht** — Convex sucht sie im Bucket und findet sie nicht. Setze S3 bei der ersten Installation, oder kopiere den vorhandenen lokalen Speicher vorab in den Bucket, bevor du umstellst.

## Wie die Konfiguration abgelegt wird

Speichern schreibt zwei Dateien im Konfigurations-Root (nicht unter einem Org-Verzeichnis):

- `deployment.json` — die nicht geheime Konfiguration (Hosts, Ports, Buckets, Modi).
- `deployment.secrets.json` — die Datenbank-Passwörter und S3-Schlüssel, SOPS-verschlüsselt (siehe [Secrets mit SOPS](/de/self-hosted/configuration/secrets-with-sops)).

Beim Boot liest der `convex`-Entrypoint diese und leitet seine Verbindungen ab, bevor er startet. Wissens-Ingestion und Retrieval laufen im Convex-Backend, also ist es der einzige Container, der die Verbindung zur Wissensdatenbank öffnet — es gibt keinen separaten Retrieval-Dienst zu konfigurieren. Der Vertrag ist **fail-closed**: ein vorhandenes, aber unparsbares `deployment.json`, ein nicht entschlüsselbares Secret oder eine Konfiguration ohne Pflichtfelder **bricht den Start ab**, statt still auf die mitgelieferte Datenbank zurückzufallen — regulierte Daten fehlzuleiten ist schlimmer, als nicht zu starten. Eine fehlende Datei ist der normale Default-Pfad.

## Eine Änderung anwenden: Neustart

Die Konfiguration wird beim Boot gelesen, also greift ein Speichern erst, wenn der **`convex`**-Container neu startet (die Plattform selbst muss nicht neu starten). Zwei Wege:

- **Manuell** — `docker compose restart convex`, oder `tale deploy --services convex` für einen Zero-Downtime-Blue-Green-Roll.
- **Ein Klick** — aktiviere den Opt-in-Dienst `controller` (`docker compose --profile controller up -d`). Er ist ein kleiner, nur intern erreichbarer Sidecar, der den erlaubten `convex`-Dienst auf eine HMAC-signierte Anfrage der App neu startet, damit die browserzugewandte Plattform nie Docker-Socket-Zugriff braucht. Läuft er, erledigt der Knopf **Anwenden & neu starten** den Neustart für dich; setze `CONTROLLER_TOKEN` (geteilt mit der Plattform) und `CONTROLLER_URL` in `.env`. Ohne ihn zeigt der Knopf den manuellen Befehl.

Die relevanten Umgebungsvariablen sind `TALE_DEPLOYMENT_CONFIG_ADMINS` (die kommagetrennte E-Mail-Allowlist der bearbeitungsberechtigten Operatoren) und — nur beim Ein-Klick-`controller` — `CONTROLLER_TOKEN` (das geteilte HMAC-Geheimnis) und `CONTROLLER_URL` (z. B. `http://controller:8004`). Setze sie in `.env`. Siehe auch [Umgebungsvariablen-Referenz](/de/self-hosted/configuration/environment-reference) und [Secrets mit SOPS](/de/self-hosted/configuration/secrets-with-sops).
