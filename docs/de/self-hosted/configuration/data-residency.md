---
title: Datenspeicher wählen und umziehen
description: Unterscheide Bereitstellungsstandards und Organisationsspeicher, richte Verbindungen ein und plane den Umzug vorhandener Daten.
---

Wähle Speicher für drei Datenarten: Anwendungsdatensätze, durchsuchbares Wissen und Originaldateien. Der Umzug einer Art verschiebt die anderen nicht. Speicherorte bestimmen auch nicht, wo ein Modellanbieter oder Konnektor Anfragen verarbeitet. Beziehe diese Ziele in deine Prüfung der Datenresidenz ein.

## Umfang der Änderung wählen

| Speicher | Bereitstellungsweite Einstellung | Organisationsspezifische Einstellung |
| --- | --- | --- |
| Anwendungsdatenbank: Nutzer, Chats, Läufe und Audit-Daten | `DATABASE_URL` | Auf dieser Seite keine eigene Anwendungsdatenbank pro Organisation. |
| Wissensdatenbank: extrahierter Text, Embeddings, Suchindizes und Webinhalte | `KNOWLEDGE_DATABASE_URL` | **Einstellungen > Datenresidenz > Wissensdatenbank** |
| Originaldateien: Dokumente, Anhänge, Audio und erzeugte Medien | `OBJECT_STORE_*` | **Einstellungen > Datenresidenz > Objektspeicher** |

Der mitgelieferte Stack betreibt `tale_app` und `tale_knowledge` als getrennte Datenbanken in einem Postgres-Dienst. Andere Aufbauten können eigene Dienste verwenden. Die vom Deployment erzeugten Umgebungswerte wählen die Standards. Ein allein gestarteter Anwendungsprozess erfindet keine funktionierenden Objektspeicher-Zugangsdaten.

Organisationsänderungen brauchen Admin- oder Owner-Rechte. Ohne eigene Verbindung nutzt Tale den Bereitstellungsstandard und trennt Daten nach Organisation. Eine ungültige konfigurierte Wissensverbindung verursacht einen Fehler, statt unbemerkt eine andere Datenbank zu verwenden.

## Externe Datenbank vorbereiten

Stelle Datenbank und Zugangsdaten vor der Tale-Änderung bereit. Die Anwendungsdatenbank braucht eine Rolle, die ihre Schema-Migrationen anwenden darf. Für Wissen muss `vector` installiert sein; `pg_search` ergänzt den BM25-Teil der Hybridsuche. Mit pgvector allein erhältst du Vektorsuche ohne diesen Stichwortanteil. Tale legt Wissensschemata und Tabellen an, installiert aber keine Erweiterungen auf deiner Datenbank.

Nutze eine direkte oder sitzungskompatible Postgres-Verbindung. Transaction-Pooling verträgt sich nicht mit den verwendeten Sitzungssperren, `LISTEN` und vorbereiteten Anweisungen. Für `sslmode=verify-ca` oder `verify-full` stellst du die nötigen PEM-Stammzertifikate über `POSTGRES_CA_FILE` bereit und mountest die Datei in beiden Backend-Rollen. Prüfe Verbindung und Rechte aus dem Bereitstellungsnetz.

Lege vor der Umschaltung fest, wie vorhandene Anwendungs- oder Wissensdaten ans Ziel kommen, und erstelle abgestimmte Backups. Das Speichern einer Verbindung ändert nur das Ziel nachfolgender Operationen. Alte Zeilen werden nicht kopiert und Dokumente nicht automatisch neu indexiert.

## Bereitstellungsstandards ändern

Ändere `.env` und stelle die betroffenen Backend-Dienste neu bereit oder erstelle sie neu. `docker compose restart` behält die bisherige Umgebung. Ziehen beide Datenbanken aus dem mitgelieferten Dienst aus, bewahre dessen altes Volume bis zur Abnahme der neuen Speicher und des Wiederherstellungsplans auf.

Beim Standard-Objektspeicher gleicht das Backend `default/object-storage/connection.json` und die Geheimnisdatei beim Start mit der Umgebung ab. Das Ergebnis unterscheidet `seeded`, `reconciled`, `skipped` bei fehlenden Zugangsdaten und `ignored` bei einer vom Betreiber verwalteten Datei. Mit `"managedBy": "operator"` übernimmst du die Dateiverwaltung selbst.

Ein anderer Standard-Bucket oder Endpunkt kopiert keine vorhandenen Dateien. Übertrage sie mit Speicherwerkzeugen unter Erhalt von Schlüsseln und benötigten Metadaten. Koordiniere die Umschaltung, bevor du den alten Speicher entfernst. Externe Datenbanken und Buckets liegen außerhalb der Datensicherung durch CLI-Volume-Snapshots. Aktualisiere dabei die Verfahren für [Backups und Wiederherstellung](/de/self-hosted/operate/backups-and-restore).

## Wissensdatenbank einer Organisation verbinden

1. Öffne **Einstellungen > Datenresidenz** in der Zielorganisation und trage unter **Wissensdatenbank** Host, Port, Datenbank, Benutzer, SSL-Modus und Passwort ein.
2. Wähle **Verbindung testen**. Prüfe Erreichbarkeit und Erweiterungen. Ein erfolgreicher Verbindungstest belegt keinen abgeschlossenen Korpusumzug.
3. Speichere erst, wenn Ziel und Plan für vorhandene Daten bereit sind. Folgende Anfragen nutzen die gewählte Verbindung ohne Container-Neustart.
4. Indexiere ein Testdokument, suche nach einer bekannten Formulierung und prüfe, ob benötigte ältere Inhalte weiter verfügbar sind.

Die Dateien liegen unter `$TALE_CONFIG_DIR/<orgSlug>/knowledge/`: `connection.json`, `connection.secrets.json` und `embedding.json`. Bei konfiguriertem age-Schlüssel nutzt die Geheimnisdatei SOPS. Das Entfernen der Verbindung leitet wieder auf den Standard um. Externe Daten bleiben bestehen, sind über die entfernte Verbindung aber nicht mehr zugänglich.

### Embedding-Modell auf den Korpus abstimmen {#das-embedding-modell-der-organisation}

Wähle unter **Embedding-Modell** Anbieter und gespeicherte Zugangsdaten. Gib den genauen Modell-Tag und die Vektorbreite an. Eine optionale Basis-URL wählt einen OpenAI-kompatiblen Endpunkt. Ohne konfiguriertes Embedding-Modell können Wissensindexierung und Suche nicht regulär arbeiten.

Die Vektorbreite wird bei erster Verwendung pro Datenbank festgelegt. Organisationen auf derselben Datenbank müssen diese Breite verwenden. Eine andere Breite braucht eine separate kompatible Datenbank. Auch ein Modellwechsel bei gleicher Breite kann vorhandene Vektoren inkompatibel machen. Plane eine Neuindexierung mit dem gewählten Modell, statt Embeddings ungeprüft zu mischen.

`embedding.json` kann `minSimilarity` als Untergrenze für den Vektoranteil der Assistentensuche setzen; der Standard ist `0.45`. Das Einstellungsformular erhält diesen Dateiwert, bietet aber kein Feld dafür. Stimme ihn anhand repräsentativer Suchanfragen ab. Die REST-Wissenssuche verwendet eine Grenze nur, wenn die Anfrage sie angibt. Es ist kein allgemeiner Schwellenwert für alle Suchen.

## Bucket einer Organisation verbinden

1. Stelle einen S3-kompatiblen Bucket mit den benötigten Objektrechten bereit. Konfiguriere CORS für die tatsächlichen Browser-Ursprünge und benötigten Methoden `GET`, `PUT` und `HEAD`.
2. Trage unter **Objektspeicher** Region, bei Bedarf Endpunkt, Bucket, optionales Schlüsselpräfix und Zugangsdaten ein. Nutze Path-Style, wenn dein Speicher es verlangt.
3. Wähle **Verbindung testen** und speichere danach. Der Servertest schreibt, liest und löscht ein Testobjekt; Browser-CORS prüft er nicht.
4. Lade im Browser eine Testdatei hoch und wieder herunter, bevor du dich auf die Verbindung verlässt.

Neue Uploads verwenden den Organisations-Bucket. Ältere Dateien im Standardspeicher können über gemischte Referenzen lesbar bleiben. Die Verbindung allein erfüllt daher keine Pflicht, auch den bisherigen Bestand umzuziehen. Die Konfiguration liegt unter `$TALE_CONFIG_DIR/<orgSlug>/object-storage/connection.json` und `connection.secrets.json`.

Entfernst du die Verbindung, gehen neue Uploads an den Standardspeicher. Vorhandene Objekte bleiben im Organisations-Bucket. Tale kann sie erst nach Wiederherstellen der Verbindung wieder lesen.

### Vorhandene Dateien gezielt verschieben

Nutze nach dem Speichern des Buckets **Bestehende Dateien verschieben** im selben Abschnitt. Prüfe eine angebotene Vorschau, bestätige den Umzug und verfolge den Fortschritt. Halte die Verbindung bis zum Abschluss stabil.

Der Nachzug durchläuft referenzierte Dokumente samt Verlauf, hochgeladene Dateien, erzeugtes Audio und Videotranskripte dieser Organisation. Er kopiert jedes Objekt mit Inhaltstyp, prüft die Zielgröße und löscht danach die Quelle. Objektschlüssel bleiben erhalten. Bereits verifizierte Kopien lassen sich nach einer Unterbrechung abschließen. Das ist ein Umzug, kein zusätzliches Backup oder kryptografischer Inhaltsnachweis.

Das Ziel muss sich vom Standardspeicher unterscheiden. Prüfe bei einem Fehlschlag letzten Fehler und Fortschritt vor einem neuen Lauf. Bewahre beide Speicher auf, bis Ergebnis und Downloads beispielhafter alter Dateien bestätigt sind. [Geheimnisse mit SOPS](/de/self-hosted/configuration/secrets-with-sops) erklärt den Schutz der Verbindungsdateien.
