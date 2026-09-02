---
title: Datenresidenz
description: Richte die Wissensdatenbank, die Anwendungsdatenbank und den Speicher für hochgeladene Dateien einer selbst gehosteten Tale-Installation auf Infrastruktur aus, die du selbst kontrollierst — von Administratoren unter Einstellungen > Datenresidenz konfiguriert und beim Neustart angewendet.
---

Eine selbst gehostete Tale-Installation läuft auf Infrastruktur, die du ohnehin schon kontrollierst, also liegen ihre Daten standardmäßig auf deinen Hosts. **Datenresidenz** ist für den Fall gedacht, dass du einzelne Datenspeicher auf dein eigenes verwaltetes Postgres oder deinen Objektspeicher ausrichten willst statt auf die mitgelieferten Container — etwa um Dokumenttext in einer Datenbank zu halten, die dein Team betreibt, oder hochgeladene Dateien in deinem eigenen S3-Bucket. Der Wissens-Korpus ist genau deshalb eine eigene Datenbank mit eigenem Connection-String, damit er sich unabhängig von der operativen Datenbank verlagern oder ersetzen lässt — er ist der Speicher, um den sich die meisten Residenz-Anforderungen drehen.

Dahinter stehen zwei Mechanismen. Einen **deployment-weiten** Speicher lenkst du auf dem Host um, in `.env` und im Config-Baum, und die Änderung greift, sobald die Backend-Container neu starten. Einen **organisationseigenen** Speicher konfiguriert ein Owner oder Admin der Organisation unter **Einstellungen > Datenresidenz**; er landet im Config-Verzeichnis dieser Organisation und greift bei der nächsten Anfrage. Diese Seite behandelt beides, die eine Voraussetzung, die zubeißt (ParadeDB), wie die Konfiguration abgelegt wird, und wie du sicher neu startest.

## Bearbeitung aktivieren

**Einstellungen > Datenresidenz** ist eine einzige Seite mit zwei Arten von Abschnitten: den deployment-weiten Speichern, die sich alle Organisationen teilen, und den Speichern, die eine einzelne Organisation selbst mitbringt. Jeder Abschnitt erscheint lesend oder bearbeitbar, je nachdem, was die lesende Person ändern darf, und die Seite benennt den Zustand. Ansehen darf jeder Owner oder Admin einer Organisation; die **deployment-weiten Speicher bearbeiten** — einen Datenspeicher umlenken, Secrets speichern, einen Verbindungstest laufen lassen — darf nur eine benannte Allowlist von Operatoren. Trage deren Anmelde-E-Mails (kommagetrennt) in `.env` ein und starte neu:

```bash
TALE_DEPLOYMENT_CONFIG_ADMINS=alice@example.com,bob@example.com
```

Ist die Allowlist leer oder nicht gesetzt, zeigen die Deployment-Abschnitte Administratoren die aktuelle Konfiguration weiterhin an, aber nur lesend — die Kopfzeilen-Aktion **Deployment speichern** erscheint nur für Operatoren auf der Allowlist. Nur ein angemeldeter Admin, dessen E-Mail auf der Liste steht, bekommt diese Abschnitte bearbeitbar; die Seite nennt dir, welche E-Mail einzutragen ist. Es gibt keine Neustart-Schaltfläche: Ein Speichern zeigt die zwei Befehle, die die Änderung anwenden, und der Abschnitt weiter unten wiederholt sie. Ein Operator, der lieber auf dem Host arbeitet, überspringt die Allowlist ganz und bearbeitet `.env` und die Config-Dateien direkt.

## Was du verlagern kannst

Drei Speicher, jeder unabhängig und optional. Eine fehlende Einstellung bedeutet „nimm den mitgelieferten Default" — eine frische Installation ohne Konfiguration bleibt also unverändert.

<Warning>

**Die deployment-weiten Abschnitte zu speichern lenkt keinen Speicher um.** Das Backend öffnet die Anwendungsdatenbank aus `DATABASE_URL`, den Wissens-Korpus aus `KNOWLEDGE_DATABASE_URL` und den Blob-Store aus der `object-storage/connection.json` im `default`-Config-Baum. Nichts liest beim Boot den `dataStores`-Block, den diese Abschnitte in `deployment.yml` schreiben. Verlagere einen deployment-weiten Speicher über die Umgebungsvariable oder die Datei, die unten bei ihm steht, und lies die Deployment-Abschnitte als Notiz der beabsichtigten Topologie, nicht als den Schalter, der sie anwendet. Die **organisationseigenen** Abschnitte weiter unten sind ein anderer Mechanismus und greifen tatsächlich.

</Warning>

- **Wissensdatenbank** — der Wissens-Korpus: Dokumentmetadaten, der extrahierte Chunk-Text, Embeddings, der BM25-Index, der semantische Cache und die gecrawlten Webseiten. Er kommt als `tale_knowledge`-Datenbank mit den Schemata `private_knowledge` und `public_web`, erreichbar unter dem Host `knowledge-db`, und ist der Speicher, um den sich die meisten Residenz-Anforderungen drehen, weil er deinen Dokumentinhalt hält. Richte ihn mit `KNOWLEDGE_DATABASE_URL` in `.env` auf dein eigenes verwaltetes Postgres aus, um den Korpus auf Infrastruktur zu halten, die dein Team betreibt.
- **Dateispeicher** — wo hochgeladene Dateien (die ursprünglichen Blobs) liegen. Standardmäßig liegen sie im mitgelieferten Objektspeicher des Stacks (Dienst `object-store`, auf einem eigenen Volume). Richte sie auf einen externen S3-kompatiblen Bucket aus, indem du `$TALE_CONFIG_DIR/default/object-storage/connection.json` und das Sidecar `connection.secrets.json` bearbeitest; das Backend seedet diese Datei beim ersten Boot gegen den mitgelieferten Store und überschreibt eine vorhandene nie.
- **Anwendungsdatenbank** (erweitert) — der operative Speicher: Chats, Aufgaben, Automation-Runs, das Audit-Log, die Job-Warteschlange. Sie kommt als `tale_app`-Datenbank auf dem mitgelieferten `db`-Container, und das Backend erreicht sie über einen Connection-String, `DATABASE_URL`. Richte den auf dein eigenes verwaltetes Postgres aus, um sie zu verlagern; das Backend legt seine Schema-Migrationen beim Boot auf das an, was es dort findet, innerhalb eines Advisory Locks.

> Hinweis: Die Wissensdatenbank und die Anwendungsdatenbank sind zwei separate Datenbanken — die eine zu verschieben rührt die andere nicht an. Auf einem Single-Host-`tale deploy`-Stack teilen sie sich einen Postgres-Container, eine Residenz-Anforderung, die sie trennt, ist also ein Grund, mindestens eine zu verlagern. Die Wissensdatenbank zu verlagern verschiebt den extrahierten Text und die Embeddings; die ursprünglich hochgeladenen Dateien wandern erst mit, wenn du auch den **Dateispeicher** verlagerst.

## Die ParadeDB-Voraussetzung

Die Wissensdatenbank nutzt zwei Postgres-Erweiterungen: `vector` (pgvector) für Embeddings und `pg_search` (ParadeDB) für die Volltext-/BM25-Hybrid-Suche. Ein externes Wissens-Postgres **muss ParadeDB ausführen** (das beide bündelt), damit die Suchqualität voll erhalten bleibt. Richtest du es auf ein schlichtes Postgres aus, das nur `pgvector` hat, funktionieren Indexierung und Vektor-Suche weiter, aber die Hybrid-Suche fällt auf **reine Vektor-Suche** zurück — die BM25-Hälfte wird still übersprungen. Der Knopf **Verbindung testen** meldet die Verfügbarkeit von `pgvector` und `pg_search`, damit du das siehst, bevor du dich festlegst. Die externe Wissensdatenbank muss bereits existieren (sie kann jeden Namen tragen, den du einträgst — `tale_knowledge` per Konvention) mit den Schemata `private_knowledge` und `public_web`; die Baseline-Schema-Migrationen leben in [`services/db/migrations/`](https://github.com/tale-project/tale/tree/main/services/db/migrations) und werden per dbmate angewendet, wenn die Datenbank hochkommt.

## Wissensdatenbanken pro Organisation

Die Speicher oben gelten deployment-weit — jede Organisation teilt sie sich. Eine einzelne Organisation kann stattdessen **ihren eigenen** Wissens-Korpus auf ein Postgres ausrichten, das du für sie bereitstellst, während jede andere Org weiter den mitgelieferten `knowledge-db` nutzt. Greif dazu, wenn der Dokument- und Web-Crawl-Inhalt eines Mandanten auf Infrastruktur liegen muss, die vom Rest isoliert ist — eine strengere Residenz-Anforderung, als der Deployment-Default sie erfüllt.

Der **gesamte** Wissens-Korpus der Org wandert — beide Schemata: `private_knowledge` (Dokumentmetadaten, Chunk-Text, Embeddings und der semantische Cache) und `public_web` (die vom Crawler erfassten Website-Seiten, ihr Chunk-Text und die Embeddings). Nichts in der Wissensdatenbank einer Organisation wird mit einer anderen Organisation geteilt.

Die Verbindung liegt im eigenen Konfigurationsverzeichnis der Organisation, nicht in der Deployment-Datei:

- `$TALE_CONFIG_DIR/<orgSlug>/knowledge/connection.json` — Host, Port, Datenbank, Benutzer und sslmode.
- `$TALE_CONFIG_DIR/<orgSlug>/knowledge/connection.secrets.json` — das Passwort, SOPS-verschlüsselt, sobald ein SOPS-Age-Schlüssel konfiguriert ist (siehe [Secrets mit SOPS](/de/self-hosted/configuration/secrets-with-sops)).
- `$TALE_CONFIG_DIR/<orgSlug>/knowledge/embedding.json` — das Embedding-Modell der Organisation: Anbieter, optional hinterlegte Zugangsdaten, Modell-Tag, Vektorbreite und eine optionale OpenAI-kompatible Basis-URL.

Dieselbe ParadeDB-Voraussetzung gilt. Die Org prüft ihre Kandidaten-Datenbank mit einem organisationsweiten Verbindungstest, der die Verfügbarkeit von `pgvector` und `pg_search` meldet, bevor sie umschaltet; ein Ziel mit nur pgvector lässt die Suche dieser Org auf reine Vektor-Suche zurückfallen. Die Datenbank darf leer starten — Tale legt die Schemata `private_knowledge` und `public_web` beim ersten Zugriff an, du wendest die Baseline-Migrationen also nie von Hand an.

Dieser Weg fällt sicher zurück. Eine Organisation ohne `connection.json` nutzt weiter den Deployment-Default `knowledge-db` genau wie zuvor, das Feature ändert also nichts für Orgs, die sich nicht dafür entscheiden. Zwei Organisationen, die auf dieselbe Datenbank zeigen, teilen sich einen Verbindungs-Pool, und — anders als die deployment-weiten Speicher — braucht eine Änderung pro Org keinen Container-Neustart: die nächste Anfrage dieser Org wird auf ihre eigene Datenbank geleitet.

Ein Inhaber oder Admin der Organisation kann diese Verbindung auch über die UI verwalten: die Organisations-Abschnitte von **Einstellungen > Datenresidenz** lesen und schreiben genau diese Dateien, mit demselben Verbindungstest vor dem Umschalten. Diese Abschnitte bleiben für Inhaber und Admins der Organisation bearbeitbar, ob die Operator-Allowlist sie nennt oder nicht — die Dateien dahinter gehören der Organisation, nicht dem Deployment. Die JSON-Dateien auf der Platte bleiben die Quelle der Wahrheit — ein Operator, der sie lieber von Hand bearbeitet, braucht keinen UI-Schritt.

### Das Embedding-Modell der Organisation

Die Wissenssuche braucht eine weitere Einstellung pro Organisation, bevor sie überhaupt laufen kann: das **Embedding-Modell** — welcher Anbieter und welches Modell Dokumente und Suchanfragen in Vektoren umwandeln, und mit exakt welcher Vektorbreite. Ohne diese Angabe verweigern Indexierung und Suche mit einem konkreten Hinweis, statt ein Modell zu raten. Richte es im Abschnitt **Embedding-Modell** von **Einstellungen > Datenresidenz** ein (oder schreib `embedding.json` von Hand): Wähle einen Anbieter, für den Zugangsdaten hinterlegt sind, nenne das Modell-Tag so, wie der Anbieter es schreibt, und gib die Breite an, die das Modell erzeugt — sie wird nie aus dem Modellnamen abgeleitet, weil eine falsche Vermutung Vektoren schreibt, mit denen die Suche stillschweigend nichts anfangen kann.

Die Breite wird **pro Datenbank** festgelegt, sobald der erste Vektor geschrieben ist. Auf der gemeinsamen `knowledge-db` des Deployments müssen sich also alle Organisationen auf eine Breite einigen; eine Organisation, die ein anderes Embedding-Modell mit anderer Breite will, ist genau der Fall für eine eigene Wissensdatenbank oben.

## Objektspeicher pro Organisation

Dasselbe Pro-Organisation-Muster deckt hochgeladene Dateien ab. Eine einzelne Organisation kann **ihre eigenen** Datei-Blobs — Knowledge-Hub-Dokumente, Chat-Anhänge, Audio und generierte Medien — auf einen S3-kompatiblen Bucket ausrichten, den du für sie bereitstellst (AWS S3, MinIO, Cloudflare R2, …), während jede andere Org weiter den Deployment-Default nutzt. Der Bucket gehört dieser einen Organisation; nichts darin wird mit anderen Organisationen geteilt.

Die Verbindung liegt neben der Wissens-Verbindung im Konfigurationsverzeichnis der Organisation:

- `$TALE_CONFIG_DIR/<orgSlug>/object-storage/connection.json` — Region, optionaler Endpoint (für MinIO/R2), Path-Style-Flag, Bucket und ein optionales Key-Präfix.
- `$TALE_CONFIG_DIR/<orgSlug>/object-storage/connection.secrets.json` — das Schlüsselpaar, SOPS-verschlüsselt, sobald ein SOPS-Age-Schlüssel konfiguriert ist (siehe [Secrets mit SOPS](/de/self-hosted/configuration/secrets-with-sops)).

Dieser Weg ist **nicht** nur für Neuinstallationen: Sobald die Konfiguration existiert, landen neue Uploads im Bucket der Org, während zuvor gespeicherte Dateien im Deployment-Default-Store lesbar bleiben — du kannst also jederzeit umschalten und die älteren Dateien danach mit dem Blob-Backfill unten verlagern. Entfernst du die Konfiguration, landen neue Uploads wieder im Deployment-Default; bereits in den Bucket geschriebene Dateien bleiben dort, Tale kann sie aber erst wieder lesen, wenn die Verbindung erneut eingerichtet ist. Ein Neustart ist in keine Richtung nötig: Der Resolver cacht eine Verbindung fünfzehn Sekunden, eine Änderung ist also praktisch sofort live.

Org-Admins verwalten auch diese Verbindung in denselben Organisations-Abschnitten von **Einstellungen > Datenresidenz**; der dortige Verbindungstest führt einen echten Hochladen-Lesen-Löschen-Durchlauf gegen den Bucket aus, bevor du dich festlegst. Wie bei der Wissens-Verbindung bleiben die JSON-Dateien die Quelle der Wahrheit.

> **Erlaube den Origin der App in der CORS-Policy des Buckets.** Uploads und Downloads laufen über vorsignierte URLs direkt zwischen Browser und Bucket, der Bucket muss Cross-Origin-Anfragen von der URL deines Deployments also akzeptieren — erlaube diesen Origin mit den Methoden `GET`, `PUT` und `HEAD` sowie allen Request-Headern (Cloudflare R2: **Settings > CORS Policy** des Buckets; AWS S3 und MinIO: die CORS-Konfiguration des Buckets). Der Verbindungstest in der App läuft auf dem Server, nicht im Browser — eine fehlende CORS-Policy zeigt sich deshalb erst später, als fehlgeschlagener Upload.

### Vorhandene Dateien in den Bucket verschieben

Den Bucket zu verbinden leitet nur **neue** Uploads um; die Blobs, die vor der Verbindung geschrieben wurden, bleiben im Deployment-Default-Store und funktionieren weiter, denn eine gespeicherte Referenz benennt den Objekt-Key, und der Resolver entscheidet, aus welchem Store er ihn liest. Um auch diese Historie auf deine eigene Infrastruktur zu holen — der eigentliche Sinn der Datenresidenz — führe den **Blob-Backfill** aus: Er geht die Dokumente der Organisation durch (die aktuellen Dateien und jede Version in ihrer Historie) sowie deren Datei-Metadaten und kopiert jedes Objekt unter demselben Key aus dem Deployment-Default-Store in den Bucket der Org.

Ein Org-Admin startet ihn in der UI: Ist die Bucket-Verbindung gespeichert, zeigt der Objektspeicher-Abschnitt von **Einstellungen > Datenresidenz** die Schaltfläche **Bestehende Dateien verschieben** — bestätige, und der Umzug läuft als Hintergrund-Job, während Uploads weiter funktionieren; eine Statuszeile im selben Abschnitt meldet Fortschritt und Ausgang des letzten Laufs.

Zwei Eigenschaften machen einen erneuten Lauf sicher. Keys ändern sich nie, es wird also keine Zeile umgeschrieben und keine Referenz kann mitten im Lauf schal werden: Ein Objekt kippt in dem Moment vom Lesen aus dem Default-Store auf das Lesen aus dem Bucket, in dem seine Kopie landet. Und jedes Objekt, das im Bucket schon liegt, wird übersprungen, ein unterbrochener Lauf setzt also fort statt neu zu kopieren. Der Lauf ist org-gebunden und braucht die zuvor gespeicherte Bucket-Verbindung.

Was er nicht tut, ist löschen. Das Quell-Objekt bleibt im Deployment-Default-Store, ein Backfill verlagert also eine Kopie statt die Bytes zu verschieben — plane einen separaten Aufräum-Durchlauf, wenn die Residenz-Anforderung ist, dass die alte Kopie zu existieren aufhört. Das ist bewusst **keine** versionierte Framework-Migration: Er läuft auf Abruf, pro Organisation, wenn du die Historie eines Mandanten verlagern willst, nicht an einer Release-Grenze.

## Wie die Konfiguration abgelegt wird

Die Deployment-Abschnitte zu speichern schreibt zwei Dateien im Konfigurations-Root (nicht unter einem Org-Verzeichnis):

- `deployment.yml` — die nicht geheime Konfiguration (Hosts, Ports, Buckets, Modi). Ein Deployment, das noch die abgelöste `deployment.json` trägt, wird gelesen wie sie ist und beim nächsten Speichern konvertiert.
- `deployment.secrets.json` — die Datenbank-Passwörter und S3-Schlüssel, SOPS-verschlüsselt (siehe [Secrets mit SOPS](/de/self-hosted/configuration/secrets-with-sops)).

Die organisationseigenen Abschnitte schreiben stattdessen ins Verzeichnis der Organisation, unter die oben aufgeführten Pfade. Das sind die Dateien, aus denen das Backend tatsächlich eine Verbindung auflöst, und der Lesevorgang ist **fail-closed**: Eine Org-Konfiguration, die vorhanden aber unparsbar ist oder deren Secret nicht entschlüsselt, verweigert die Lesezugriffe dieser Organisation, statt still auf den mitgelieferten Speicher zurückzufallen — regulierte Daten fehlzuleiten ist schlimmer, als laut zu scheitern. Eine fehlende Datei ist der normale Default-Pfad.

## Eine Änderung anwenden: Neustart

Eine deployment-weite Verbindung wird beim Boot gelesen, also greift eine Änderung an `.env` oder am `default`-Config-Baum erst, wenn die Backend-Container (`backend-api` und `backend-worker`) neu starten. Führe `docker compose restart backend-api backend-worker` aus, oder `tale deploy` für einen Zero-Downtime-Blue-Green-Roll — die Einstellungsseite zeigt nach dem Speichern dieselben Befehle an. Eine organisationseigene Verbindung braucht keinen Neustart.

Die relevante Umgebungsvariable ist `TALE_DEPLOYMENT_CONFIG_ADMINS` (die kommagetrennte E-Mail-Allowlist der bearbeitungsberechtigten Operatoren). Setze sie in `.env`. Siehe auch [Umgebungsvariablen-Referenz](/de/self-hosted/configuration/environment-reference) und [Secrets mit SOPS](/de/self-hosted/configuration/secrets-with-sops).
