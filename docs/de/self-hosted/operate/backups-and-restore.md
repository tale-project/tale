---
title: Backups und Wiederherstellung
description: Stelle die vollständige Sicherung zusammen, kopiere CLI-Snapshots und stelle Daten mit der passenden Tale-Version wieder her.
---

Für eine wiederherstellbare Tale-Instanz reicht ein Datenbankarchiv nicht aus. Bewahre Dateien, Organisationskonfiguration, Bereitstellungsordner und Entschlüsselungsschlüssel zusammen mit der Information auf, welche Version die Daten geschrieben hat. Lege zuerst fest, wie viel Datenverlust und welche Wiederherstellungsdauer du akzeptieren kannst. Prüfe dann, ob Sicherungsplan und Wiederherstellung diese Ziele erfüllen.

Diese Anleitung beschreibt Docker-Volume-Snapshots der Workspace-CLI. Wenn du Compose selbst verwaltest, muss dein Sicherungsverfahren dieselben Speicher abdecken. Externe Datenbanken und Buckets brauchen eigene, zeitlich abgestimmte Backups.

## Einen leeren Wiederherstellungshost vorbereiten

Hole den ursprünglichen Workspace zurück und prüfe, ob deine Docker-Verbindung auf den Wiederherstellungshost zeigt. Lass den Stack gestoppt. Ersetze unten `your-project-id` durch die ursprüngliche ID aus `tale.json`. Für einen Entwicklungssnapshot verwende stattdessen `TALE_RESTORE_PREFIX="${TALE_RESTORE_PROJECT}-dev_"`. Produktiv- und Entwicklungsdaten haben getrennte Namensräume. Sind beide vorhanden, wählt die CLI zuerst den produktiven.

```bash
TALE_RESTORE_PROJECT=your-project-id
TALE_RESTORE_PREFIX="${TALE_RESTORE_PROJECT}_"
docker volume create --label "project=$TALE_RESTORE_PROJECT" "${TALE_RESTORE_PREFIX}config-data"
docker volume create --label "project=$TALE_RESTORE_PROJECT" "${TALE_RESTORE_PREFIX}backups"
docker volume inspect "${TALE_RESTORE_PREFIX}backups"
```

Damit entstehen Konfigurations- und Backup-Volume, ohne ein Backend zu starten oder Migrationen auszuführen. Spiele mit deinem Sicherungssystem den vollständigen gesicherten Inhalt von `backups` in dieses Volume ein. Der angezeigte Einhängepunkt gehört zum Docker-Host, der auch entfernt sein kann. Behalte Verzeichnisstruktur und Manifeste der Snapshots bei. `tale restore` muss anschließend den erwarteten Snapshot auflisten. Bei der eigentlichen Wiederherstellung erstellt die CLI nach der Snapshot-Prüfung weitere fehlende Ziel-Volumes.

## Umfang des Snapshots prüfen

`tale backup` erfasst vorhandene Projekt-Volumes aus dieser Liste:

| Volume | Enthaltene Daten |
| --- | --- |
| `db-data` | Anwendungsdaten und beim mitgelieferten Ein-Host-Stack auch die Wissensdatenbank. |
| `knowledge-db-data` | Die separate Wissensdatenbank, wenn dieses Volume vorhanden ist, etwa bei Compose aus dem Quellcode. |
| `config-data` | Organisationskonfiguration, unterstützte Geheimnis-Begleitdateien und Branding. In Postgres gespeicherte Anbieterzugangsdaten gehören zur Datenbanksicherung. |
| `object-store-data` | Hochgeladene Dateien und erzeugte Medien, wenn der Bereitstellungsstandard den mitgelieferten Speicher verwendet. |
| `caddy-data`, `caddy-config` | Zertifikate und Proxy-Zustand. |

Für jedes erfasste Volume enthält der Snapshot ein Archiv und eine SHA-256-Prüfsummendatei. `manifest.json` wird zuletzt geschrieben und hält die Plattformversion fest, sofern sie ermittelt werden kann. Ein Verzeichnis ohne Manifest ist unvollständig: Es erscheint nicht in der Wiederherstellungsliste und kann bei der Rotation entfernt werden, sobald ein neuerer vollständiger Snapshot vorliegt.

Bewahre zusätzlich den Ordner mit `tale.json`, seine `.env` und separat eingebundene Schlüsseldateien auf. Dazu gehören insbesondere `ENCRYPTION_SECRET_HEX` und die age-Identität für SOPS-Dateien. `llm-gateway-data` und Sandbox-Arbeitsverzeichnisse sind nicht Teil dieser Snapshot-Liste. Nimm sie bei Bedarf in deinen eigenen Sicherungsplan auf.

<Warning>

Externe Postgres-Daten werden nicht erfasst, auch wenn ein ungenutztes lokales Datenbank-Volume im Snapshot auftaucht. Die CLI warnt nicht vor dieser Datenbankkonfiguration. Externe Buckets liegen ebenfalls außerhalb des Snapshots; die CLI meldet einen umgeleiteten Standard-Bucket oder gefundene organisationsspezifische Buckets. Prüfe die Speicherverbindungen jeder Organisation, bevor du die Sicherung als vollständig bewertest.

</Warning>

## Snapshot erstellen und prüfen

Führe diese Befehle im vorgesehenen Bereitstellungsordner aus:

```bash
tale status
tale backup
tale restore
```

`backup` zeigt das Ergebnis an. `restore` ohne ID listet nur vorhandene Snapshots auf, einschließlich der erfassten Version und eines Hinweises auf fehlende Dateien. Halte die Snapshot-ID zusammen mit den IDs externer Backups fest.

Während ein Volume archiviert wird, pausiert der Sicherungsprozess die Container, die es verwenden. Uploads, Downloads und Datenbankarbeit können während der jeweiligen Pause warten müssen. Die Dauer hängt von Datenmenge und Durchsatz ab. Docker meldet einen pausierten Container bis zu seiner nächsten erfolgreichen Zustandsprüfung als `unhealthy`. Nach jedem Archiv wartet der Sicherungsprozess deshalb, bis jeder Container, der vor der Pause gesund war, wieder `healthy` meldet; das dauert meist ein Intervall der Zustandsprüfung. Erholt sich ein Container nicht innerhalb der Wiederholungen, die seine Zustandsprüfung zulässt, schlägt die Sicherung fehl. Die Archive bilden einen absturzähnlichen Zustand je Volume ab, keine atomare Transaktion über alle Speicher. Für einen abgestimmten Wiederherstellungspunkt halte Schreibzugriffe und geplante Arbeit an oder nutze ein Wartungsfenster, das auch externe Speicher umfasst.

Ein `tale deploy` mit Versionswechsel oder einer Überschreibung der Host-Konfiguration erstellt vor Änderungen einen Snapshot. Schlägt die Sicherung fehl, bricht die Bereitstellung ab. `--skip-backup` umgeht diesen Schutz. Verwende die Option nur, wenn dein Wiederherstellungsplan die erforderliche Sicherung bereits bereitstellt.

## Eine Kopie außerhalb des Hosts aufbewahren

Snapshots liegen im Docker-Volume `backups` des Projekts. Ein Host- oder Plattenausfall kann laufende Daten und lokale Snapshots zugleich zerstören. Übertrage vollständige Snapshots, Workspace-Konfiguration und Schlüssel in dein geschütztes externes Sicherungssystem. Tale übernimmt diesen Upload nicht.

Ermittle das Volume mit der Projekt-ID aus `tale.json`:

```bash
docker volume inspect <project-id>_backups
```

Der Mount-Pfad gehört zum Docker-Host, der auch eine VM oder ein entfernter Rechner sein kann. Richte deinen Backup-Agenten dort ein; der Pfad muss nicht auf deinem Arbeitsplatzrechner existieren. Prüfe, ob die externe Kopie `manifest.json`, alle darin genannten Archive und deren Prüfsummendateien enthält.

Die lokale Rotation behält die neuesten fünf Snapshots **und** alle Snapshots der letzten 14 Tage. Gelöscht wird nur, was außerhalb beider Grenzen liegt. `BACKUP_KEEP_COUNT` und `BACKUP_KEEP_DAYS` in `.env` ändern diese Grenzen. Die Aufbewahrung außerhalb des Hosts konfigurierst du separat.

## Daten und passende Version wiederherstellen

<Warning>

Die Wiederherstellung ersetzt den Inhalt der enthaltenen Daten-Volumes. Sichere den aktuellen Zustand, falls du ihn noch brauchen könntest, und prüfe den Ziel-Workspace. Halte Nutzer und geplante Integrationen von der Wiederherstellungsumgebung fern, bis sie abgenommen ist.

</Warning>

1. Hole den vollständigen Snapshot, Bereitstellungsordner, passende Schlüssel und Backups externer Speicher zurück. Bereite einen neuen Host zuerst wie oben beschrieben vor.
2. Wähle mit `tale restore` eine ID und lies die Plattformversion ab. Ist sie unbekannt, ermittle sie vor dem Anwendungsstart aus deinen Bereitstellungsunterlagen.
3. Stelle bei angehaltenem Stack wieder her. `--stop` hält laufende Projektcontainer an. Danach prüft die CLI die Archiv-Prüfsummen und fragt vor dem Ersetzen der Daten nach Bestätigung.

```bash
tale restore <snapshot-id> --stop
```

4. Stelle externe Datenbanken und Buckets bei weiterhin gesperrtem Zugriff auf den abgestimmten Zeitpunkt zurück. Ein als `without blobs` markierter Snapshot lässt das vorhandene lokale Datei-Volume unangetastet.
5. Wähle die im Snapshot vermerkte Version und stelle sie einschließlich der zustandsbehafteten Dienste bereit:

```bash
tale update --version <snapshot-platform-version>
tale deploy --stop
tale status
```

Die Version ist entscheidend: Ein neueres Backend kann direkt beim Start Migrationen anwenden. Eine Datenwiederherstellung mit einem beliebigen aktuellen Image stellt daher nicht den dokumentierten Zustand wieder her. Ältere Konfigurationsarchive namens `convex-data` spielt die CLI in das heutige Volume `config-data` ein.

## Wiederherstellung vor der Freigabe nachweisen

Melde dich in einer isolierten Übung an, öffne einen bekannten Chat, lade eine ältere Datei herunter, prüfe die Organisationskonfiguration und führe eine kontrollierte Wissenssuche aus. Prüfe den Zugriff auf Anbieterzugangsdaten und externe Speicher, ohne produktive Benachrichtigungen oder Automatisierungen auszulösen. Halte den Zeitraum verlorener Daten, die Wiederherstellungsdauer und alle manuellen Schritte fest.

Wiederhole die Übung nach wesentlichen Speicher-, Schlüssel- oder Bereitstellungsänderungen und in dem Abstand, den deine Wiederherstellungsziele erfordern. [Upgrades](/de/self-hosted/operate/upgrades) erklärt die Versionswahl. [Fehlerbehebung](/de/self-hosted/operate/observability/troubleshooting) hilft, wenn ein wiederhergestellter Dienst nicht betriebsbereit wird.
