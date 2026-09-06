---
title: Datenresidenz
description: Wo eine selbst gehostete Tale-Installation ihre Daten hält, wie du die Deployment-Defaults beim Deploy setzt und wie eine einzelne Organisation ihren Wissens-Korpus und ihre hochgeladenen Dateien auf eigene Infrastruktur ausrichtet — live, ohne Neustart.
---

Eine selbst gehostete Tale-Installation läuft auf Infrastruktur, die du ohnehin schon kontrollierst, also liegen ihre Daten standardmäßig auf deinen Hosts. **Datenresidenz** ist für den Fall gedacht, dass ein Speicher an einem bestimmten Ort liegen muss — Dokumenttext in einer Datenbank, die dein Team betreibt, hochgeladene Dateien in deinem eigenen S3-Bucket, der Korpus eines Mandanten isoliert von allen anderen. Tale beantwortet das auf zwei Ebenen: mit den **Deployment-Defaults**, die sich jede Organisation teilt und die du beim Deploy per Umgebungsvariablen setzt, und mit den **Verbindungen pro Organisation**, die ein Org-Admin live unter **Einstellungen > Datenresidenz** verwaltet.

Diese Seite behandelt, was wo liegt, wie du die Deployment-Defaults verlagerst, die eine Voraussetzung, die zubeißt (ParadeDB), und die Wissens- und Objektspeicher-Wege pro Organisation — einschließlich des Verschiebens vorhandener Dateien einer Organisation.

## Wo die Daten des Deployments liegen

Drei Speicher, jeder mit eigener Umgebungsvariable. Eine nicht gesetzte Variable heißt „nimm den mitgelieferten Container", eine frische Installation ohne Overrides bleibt also unverändert.

- **Wissensdatenbank** — der Wissens-Korpus: Dokumentmetadaten, der extrahierte Chunk-Text, Embeddings, der BM25-Index, der semantische Cache und die gecrawlten Webseiten. Sie kommt als mitgelieferter Container `knowledge-db` (`tale_knowledge`, mit den Schemata `private_knowledge` und `public_web`) und ist der Speicher, um den sich die meisten Residenz-Anforderungen drehen, weil er deinen Dokumentinhalt hält. `KNOWLEDGE_DATABASE_URL` richtet das Backend stattdessen auf ein verwaltetes Postgres von dir aus; die Datenbank darf leer starten — das Backend legt seine Schemata beim ersten Zugriff an.
- **Dateispeicher** — wo hochgeladene Dateien (die Original-Blobs) liegen. Standardmäßig im mitgelieferten Object-Store (dem Service `object-store`, auf eigenem Volume). Dieser Store wird anders konfiguriert als die beiden Datenbanken: **nur beim ersten Start** schreibt das Backend den Deployment-Default aus den `OBJECT_STORE_*`-Variablen nach `$TALE_CONFIG_DIR/default/object-storage/connection.json` (plus `connection.secrets.json` für die Zugangsschlüssel, SOPS-verschlüsselt, wenn ein Schlüssel konfiguriert ist) — danach liest es nur noch diese Datei, die Variablen nie wieder; eine vorhandene Datei wird nie überschrieben. Setze `OBJECT_STORE_*` also **vor dem ersten Start** auf einen externen S3-kompatiblen Bucket, wenn du dort beginnen willst; den Default eines laufenden Deployments verlegst du, indem du `connection.json` und `connection.secrets.json` von Hand editierst und die Backend-Container rollst. In beiden Fällen ist der Wechsel Greenfield: Blobs, die schon im mitgelieferten Store liegen, werden nicht kopiert — kopiere das Volume vorab außerhalb von Tale in den Bucket, und lies [Backups und Restore](/de/self-hosted/operate/backups-and-restore), denn ein umgebogener Default nimmt die Blobs aus den Snapshots von `tale backup` heraus.
- **Anwendungsdatenbank** — der operative Speicher hinter Agents, Runs und dem Audit-Log (der mitgelieferte Container `db`, die Datenbank `tale_app`). `DATABASE_URL` verlagert sie; der Datenbankname ist standardmäßig `tale_app` (Override mit `APP_DB_NAME`).

Die Variablen stehen in der `.env` des Deployments. `DATABASE_URL` und `KNOWLEDGE_DATABASE_URL` werden bei jedem Start der Backend-Container gelesen — ändere eine und rolle dann mit `tale deploy` (Zero-Downtime, Blue-Green) oder `docker compose restart backend-api backend-worker`; die `OBJECT_STORE_*`-Variablen zählen nur beim ersten Start, wie oben beschrieben. Jede Variable, ihr Default und ihre genaue Form stehen in der [Umgebungsreferenz](/de/self-hosted/configuration/environment-reference). Nichts in der App schreibt diese Werte: Frühere Releases hatten unter Einstellungen > Datenresidenz einen deployment-weiten Speicher-Abschnitt, der einen `dataStores`-Block in `deployment.yml` speicherte — aber kein Boot-Pfad las ihn. Der Abschnitt ist weg; ein übrig gebliebener `dataStores`-Block in einer bestehenden `deployment.yml` wird ignoriert und beim nächsten Speichern der Datei entfernt.

> Hinweis: Die Wissensdatenbank und die Anwendungsdatenbank sind zwei getrennte Postgres-Instanzen — die eine zu verlagern berührt die andere nicht. Verlagerst du die Wissensdatenbank, wandern der extrahierte Text und die Embeddings; die hochgeladenen Originaldateien wandern nur, wenn du auch den **Dateispeicher** verlagerst.

## Die ParadeDB-Voraussetzung

Die Wissensdatenbank nutzt zwei Postgres-Erweiterungen: `vector` (pgvector) für Embeddings und `pg_search` (ParadeDB) für die hybride Volltext-/BM25-Suche. Ein externes Wissens-Postgres — der Deployment-Default oder das eigene einer Organisation — **muss ParadeDB fahren** (das beide bündelt), damit die Suche ihre volle Qualität hat. Zeigst du auf ein einfaches Postgres mit nur `pgvector`, funktionieren Indexierung und Vektorsuche weiter, die hybride Suche fällt aber auf **reine Vektorsuche** zurück: Das BM25-Bein wird stillschweigend übersprungen. Der Button **Verbindung testen** pro Organisation meldet die Verfügbarkeit von `pgvector` und `pg_search`, du siehst das also, bevor du dich festlegst; für den Deployment-Default prüfst du die Erweiterungen auf der Zieldatenbank, bevor du `KNOWLEDGE_DATABASE_URL` änderst.

## Wissensdatenbanken pro Organisation

Den Deployment-Default teilt sich jede Organisation. Eine einzelne Organisation kann stattdessen **ihren eigenen** Wissens-Korpus auf ein Postgres ausrichten, das du für sie bereitstellst, während jede andere Org weiter den mitgelieferten `knowledge-db` nutzt. Greif dazu, wenn der Dokument- und Web-Crawl-Inhalt eines Mandanten auf Infrastruktur liegen muss, die vom Rest isoliert ist — eine strengere Residenz-Anforderung, als der Deployment-Default sie erfüllt.

Der **gesamte** Wissens-Korpus der Org wandert — beide Schemata: `private_knowledge` (Dokumentmetadaten, Chunk-Text, Embeddings und der semantische Cache) und `public_web` (die vom Crawler erfassten Website-Seiten, ihr Chunk-Text und die Embeddings). Nichts in der Wissensdatenbank einer Organisation wird mit einer anderen Organisation geteilt.

Die Verbindung liegt im eigenen Konfigurationsverzeichnis der Organisation:

- `$TALE_CONFIG_DIR/<orgSlug>/knowledge/connection.json` — Host, Port, Datenbank, Benutzer und sslmode.
- `$TALE_CONFIG_DIR/<orgSlug>/knowledge/connection.secrets.json` — das Passwort, SOPS-verschlüsselt, sobald ein SOPS-Age-Schlüssel konfiguriert ist (siehe [Secrets mit SOPS](/de/self-hosted/configuration/secrets-with-sops)).
- `$TALE_CONFIG_DIR/<orgSlug>/knowledge/embedding.json` — das Embedding-Modell der Organisation: Anbieter, optional hinterlegte Zugangsdaten, Modell-Tag, Vektorbreite und eine optionale OpenAI-kompatible Basis-URL.

Dieselbe ParadeDB-Voraussetzung gilt. Die Org prüft ihre Kandidaten-Datenbank mit einem organisationsweiten Verbindungstest, der die Verfügbarkeit von `pgvector` und `pg_search` meldet, bevor sie umschaltet; ein Ziel mit nur pgvector lässt die Suche dieser Org auf reine Vektor-Suche zurückfallen. Die Datenbank darf leer starten — Tale legt die Schemata `private_knowledge` und `public_web` beim ersten Zugriff an, du wendest die Baseline-Migrationen also nie von Hand an.

Dieser Weg fällt sicher zurück. Eine Organisation ohne `connection.json` nutzt weiter den Deployment-Default `knowledge-db` genau wie zuvor, das Feature ändert also nichts für Orgs, die sich nicht dafür entscheiden. Zwei Organisationen, die auf dieselbe Datenbank zeigen, teilen sich einen Verbindungs-Pool, und eine Änderung pro Org braucht keinen Container-Neustart: die nächste Anfrage dieser Org wird auf ihre eigene Datenbank geleitet.

**Einstellungen > Datenresidenz** ist genau diese Oberfläche pro Organisation: Ein Inhaber oder Admin der Organisation liest und schreibt dort exakt diese Dateien, mit demselben Verbindungstest vor dem Umschalten. Die JSON-Dateien auf der Platte bleiben die Quelle der Wahrheit — ein Operator, der sie lieber von Hand bearbeitet, braucht keinen UI-Schritt.

### Das Embedding-Modell der Organisation

Die Wissenssuche braucht eine weitere Einstellung pro Organisation, bevor sie überhaupt laufen kann: das **Embedding-Modell** — welcher Anbieter und welches Modell Dokumente und Suchanfragen in Vektoren umwandeln, und mit exakt welcher Vektorbreite. Ohne diese Angabe verweigern Indexierung und Suche mit einem konkreten Hinweis, statt ein Modell zu raten. Richte es im Abschnitt **Embedding-Modell** von **Einstellungen > Datenresidenz** ein (oder schreib `embedding.json` von Hand): Wähle einen Anbieter, für den Zugangsdaten hinterlegt sind, nenne das Modell-Tag so, wie der Anbieter es schreibt, und gib die Breite an, die das Modell erzeugt — sie wird nie aus dem Modellnamen abgeleitet, weil eine falsche Vermutung Vektoren schreibt, mit denen die Suche stillschweigend nichts anfangen kann.

Die Breite wird **pro Datenbank** festgelegt, sobald der erste Vektor geschrieben ist. Auf der gemeinsamen `knowledge-db` des Deployments müssen sich also alle Organisationen auf eine Breite einigen; eine Organisation, die ein anderes Embedding-Modell mit anderer Breite will, ist genau der Fall für eine eigene Wissensdatenbank oben.

## Objektspeicher pro Organisation

Dasselbe Pro-Organisation-Muster deckt hochgeladene Dateien ab. Eine einzelne Organisation kann **ihre eigenen** Datei-Blobs — Knowledge-Hub-Dokumente, Chat-Anhänge, Audio und generierte Medien — auf einen S3-kompatiblen Bucket ausrichten, den du für sie bereitstellst (AWS S3, MinIO, Cloudflare R2, …), während jede andere Org weiter den Deployment-Default nutzt. Der Bucket gehört dieser einen Organisation; nichts darin wird mit anderen Organisationen geteilt.

Die Verbindung liegt neben der Wissens-Verbindung im Konfigurationsverzeichnis der Organisation:

- `$TALE_CONFIG_DIR/<orgSlug>/object-storage/connection.json` — Region, optionaler Endpoint (für MinIO/R2), Path-Style-Flag, Bucket und ein optionales Key-Präfix.
- `$TALE_CONFIG_DIR/<orgSlug>/object-storage/connection.secrets.json` — das Schlüsselpaar, SOPS-verschlüsselt, sobald ein SOPS-Age-Schlüssel konfiguriert ist (siehe [Secrets mit SOPS](/de/self-hosted/configuration/secrets-with-sops)).

Dieser Weg ist **nicht** nur für Neuinstallationen: Sobald die Konfiguration existiert, landen neue Uploads im Bucket der Org, während zuvor gespeicherte Dateien lesbar bleiben, wo sie sind — gemischte Referenzen werden unterstützt, du kannst also jederzeit umschalten. Früher gespeicherte Dateien bleiben im Object-Store des Deployments, bis du sie mit dem Blob-Backfill unten verlagerst. Entfernst du die Konfiguration, landen neue Uploads wieder im Deployment-Default; bereits in den Bucket geschriebene Dateien bleiben dort, Tale kann sie aber erst wieder lesen, wenn die Verbindung erneut eingerichtet ist. Ein Neustart ist in keine Richtung nötig.

Org-Admins verwalten auch diese Verbindung unter **Einstellungen > Datenresidenz**; der dortige Verbindungstest führt einen echten Hochladen-Lesen-Löschen-Durchlauf gegen den Bucket aus, bevor du dich festlegst. Wie bei der Wissens-Verbindung bleiben die JSON-Dateien die Quelle der Wahrheit.

> **Erlaube den Origin der App in der CORS-Policy des Buckets.** Uploads und Downloads laufen über vorsignierte URLs direkt zwischen Browser und Bucket, der Bucket muss Cross-Origin-Anfragen von der URL deines Deployments also akzeptieren — erlaube diesen Origin mit den Methoden `GET`, `PUT` und `HEAD` sowie allen Request-Headern (Cloudflare R2: **Settings > CORS Policy** des Buckets; AWS S3 und MinIO: die CORS-Konfiguration des Buckets). Der Verbindungstest in der App läuft auf dem Server, nicht im Browser — eine fehlende CORS-Policy zeigt sich deshalb erst später, als fehlgeschlagener Upload.

### Vorhandene Dateien in den Bucket verschieben

Den Bucket zu verbinden leitet nur **neue** Uploads um; die Blobs, die vor der Verbindung geschrieben wurden, bleiben im Standard-Object-Store des Deployments und funktionieren weiter über die gemischten Referenzen oben. Um auch diese Historie auf deine eigene Infrastruktur zu holen — der eigentliche Sinn der Datenresidenz — führe den **Blob-Backfill** aus: Er verschiebt jeden vorhandenen Blob in den Bucket der Org — die Kopie landet mit ihrem gespeicherten Content-Type, wird gegen die Größe der Quelle geprüft, und erst dann fällt die Quell-Kopie weg. Umgeschrieben wird nichts: Ein Blob behält seinen Schlüssel über den Umzug hinweg, und Lesezugriffe finden ihn in dem Store, der ihn gerade hält.

Ein Org-Admin startet ihn in der UI: Ist die Bucket-Verbindung gespeichert, zeigt der Objektspeicher-Abschnitt von **Einstellungen > Datenresidenz** die Schaltfläche **Bestehende Dateien verschieben** — bestätige, und der Umzug läuft im Hintergrund, während Uploads weiter funktionieren; eine Statuszeile im selben Abschnitt meldet Fortschritt und Ausgang des letzten Laufs.

Der Backfill ist **idempotent** und **org-gebunden**: Er verschiebt nur die Blobs dieser Organisation, überspringt alles, was schon im Bucket liegt, und lässt jede Quelle stehen, bis ihre Kopie verifiziert ist — ein erneuter Lauf nach einer Unterbrechung setzt also sicher fort und schließt jeden Umzug ab, der zwischen verifizierter Kopie und dem Löschen der Quelle abgebrochen wurde. Er geht durch jede Tabelle, die Blob-Referenzen hält: Dokumente samt Historie, hochgeladene Dateien, synthetisierte Sprachausgabe und Video-Link-Transkripte. Er braucht die zuvor konfigurierte Bucket-Verbindung und verweigert den Lauf, wenn der Bucket der Org der Store des Deployments selbst ist — dann gäbe es nichts zu verschieben, und ein abgeschlossener Umzug würde die einzige Kopie löschen. Das ist bewusst **keine** versionierte Framework-Migration — er läuft auf Abruf, pro Organisation, wenn du die Historie eines Mandanten verlagern willst, nicht an einer Release-Grenze.

Die Deployment-Defaults und ihre Variablen stehen in der [Umgebungsreferenz](/de/self-hosted/configuration/environment-reference); die Secrets-Sidecars pro Organisation folgen [Secrets mit SOPS](/de/self-hosted/configuration/secrets-with-sops).
