---
title: Backups und Wiederherstellung
description: Stelle die vollständige Sicherung zusammen, kopiere CLI-Snapshots und stelle Daten mit der passenden Tale-Version wieder her.
# The CLI's deployment workspace (`tale init`) keeps its English name in German,
# and terminology-ui-label cannot tell it from the app's Arbeitsbereich.
i18nLintExclude:
  - terminology-ui-label
---

Für eine wiederherstellbare Tale-Instanz reicht ein Datenbankarchiv nicht aus. Bewahre Dateien, Organisationskonfiguration, Bereitstellungsordner und Entschlüsselungsschlüssel zusammen mit der Information auf, welche Version die Daten geschrieben hat. Lege zuerst fest, wie viel Datenverlust und welche Wiederherstellungsdauer du akzeptieren kannst. Prüfe dann, ob Sicherungsplan und Wiederherstellung diese Ziele erfüllen.

Diese Anleitung beschreibt die Snapshots der Workspace-CLI von Docker-Volumes und, ab [Snapshots auf Incus](#incus), die eines Workspace auf der experimentellen Incus-Laufzeit. Wenn du Compose selbst verwaltest, muss dein Sicherungsverfahren dieselben Speicher abdecken. Externe Datenbanken und Buckets brauchen eigene, zeitlich abgestimmte Backups.

## Einen leeren Wiederherstellungshost vorbereiten

Hole den ursprünglichen Workspace zurück und prüfe, ob deine Docker-Verbindung auf den Wiederherstellungshost zeigt. Lass den Stack gestoppt. Ersetze unten `your-project-id` durch die ursprüngliche ID aus `tale.json`. Für einen Entwicklungssnapshot verwende stattdessen `TALE_RESTORE_PREFIX="${TALE_RESTORE_PROJECT}-dev_"`. Produktiv- und Entwicklungsdaten haben getrennte Namensräume. Sind beide vorhanden, wählt die CLI zuerst den produktiven.

```bash
TALE_RESTORE_PROJECT=your-project-id
TALE_RESTORE_PREFIX="${TALE_RESTORE_PROJECT}_"
docker volume create --label "project=$TALE_RESTORE_PROJECT" "${TALE_RESTORE_PREFIX}config-data"
docker volume create --label "project=$TALE_RESTORE_PROJECT" "${TALE_RESTORE_PREFIX}backups"
docker volume inspect "${TALE_RESTORE_PREFIX}backups"
```

Damit entstehen Konfigurations- und Backup-Volume, ohne ein Backend zu starten oder Migrationen auszuführen. Willst du einen Snapshot stattdessen als eine Datei mitnehmen oder auf einen Workspace auf Incus bringen, nutze [Export und Import](#export-import). Spiele mit deinem Sicherungssystem den vollständigen gesicherten Inhalt von `backups` in dieses Volume ein. Der angezeigte Einhängepunkt gehört zum Docker-Host, der auch entfernt sein kann. Behalte Verzeichnisstruktur und Manifeste der Snapshots bei. `tale restore` muss anschließend den erwarteten Snapshot auflisten. Bei der eigentlichen Wiederherstellung erstellt die CLI nach der Snapshot-Prüfung weitere fehlende Ziel-Volumes.

## Umfang des Snapshots prüfen

`tale backup` erfasst vorhandene Projekt-Volumes aus dieser Liste:

| Volume | Enthaltene Daten |
| --- | --- |
| `db-data` | Anwendungsdaten und beim mitgelieferten Ein-Host-Stack auch die Wissensdatenbank. |
| `knowledge-db-data` | Die separate Wissensdatenbank, wenn dieses Volume vorhanden ist, etwa bei Compose aus dem Quellcode. |
| `config-data` | Organisationskonfiguration, unterstützte Geheimnis-Begleitdateien und Branding. In Postgres gespeicherte Anbieterzugangsdaten gehören zur Datenbanksicherung. |
| `object-store-data` | Hochgeladene Dateien und erzeugte Medien, wenn der Bereitstellungsstandard den mitgelieferten Speicher verwendet. |
| `caddy-data`, `caddy-config` | Zertifikate und Proxy-Zustand. |
| `llm-gateway-data` | Der Speicher des Modell-Gateways: Admin-Konto, Anbieterschlüssel, Sitzungsschlüssel mit ihren Budgets und Ausgaben sowie das Anfrageprotokoll. |

Für jedes erfasste Volume enthält der Snapshot ein Archiv und eine SHA-256-Prüfsummendatei. `manifest.json` wird zuletzt geschrieben und hält die Plattformversion fest, sofern sie ermittelt werden kann. Ein Verzeichnis ohne Manifest ist unvollständig: Es erscheint nicht in der Wiederherstellungsliste und kann bei der Rotation entfernt werden, sobald ein neuerer vollständiger Snapshot vorliegt. Snapshots, die entstanden sind, bevor die CLI den Speicher des Gateways erfasste, enthalten kein Archiv von `llm-gateway-data`.

Bewahre zusätzlich den Ordner mit `tale.json`, seine `.env` und separat eingebundene Schlüsseldateien auf. Dazu gehören insbesondere `ENCRYPTION_SECRET_HEX` und die age-Identität für SOPS-Dateien. Sandbox-Arbeitsverzeichnisse sind nicht Teil dieser Snapshot-Liste. Nimm sie bei Bedarf in deinen eigenen Sicherungsplan auf.

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

`backup` zeigt das Ergebnis an. `restore` ohne ID listet nur vorhandene Snapshots auf, einschließlich der erfassten Version und eines Hinweises, wenn Dateien oder der Speicher des Gateways fehlen. Halte die Snapshot-ID zusammen mit den IDs externer Backups fest.

Während ein Volume archiviert wird, pausiert der Sicherungsprozess die Container, die es verwenden. Uploads, Downloads, Datenbankarbeit und Modellaufrufe über das Gateway können während der jeweiligen Pause warten müssen. Die Dauer hängt von Datenmenge und Durchsatz ab. Docker meldet einen pausierten Container bis zu seiner nächsten erfolgreichen Zustandsprüfung als `unhealthy`. Nach jedem Archiv wartet der Sicherungsprozess deshalb, bis jeder Container, der vor der Pause gesund war, wieder `healthy` meldet; das dauert meist ein Intervall der Zustandsprüfung. Erholt sich ein Container nicht innerhalb der Wiederholungen, die seine Zustandsprüfung zulässt, schlägt die Sicherung fehl. Die Archive bilden einen absturzähnlichen Zustand je Volume ab, keine atomare Transaktion über alle Speicher. Für einen abgestimmten Wiederherstellungspunkt halte Schreibzugriffe und geplante Arbeit an oder nutze ein Wartungsfenster, das auch externe Speicher umfasst.

Ein `tale deploy` mit Versionswechsel oder einer Überschreibung der Host-Konfiguration erstellt vor Änderungen einen Snapshot. Schlägt die Sicherung fehl, bricht die Bereitstellung ab. `--skip-backup` umgeht diesen Schutz. Verwende die Option nur, wenn dein Wiederherstellungsplan die erforderliche Sicherung bereits bereitstellt.

## Eine Kopie außerhalb des Hosts aufbewahren

Snapshots liegen im Docker-Volume `backups` des Projekts. Ein Host- oder Plattenausfall kann laufende Daten und lokale Snapshots zugleich zerstören. Übertrage vollständige Snapshots, Workspace-Konfiguration und Schlüssel in dein geschütztes externes Sicherungssystem. Tale übernimmt diesen Upload nicht.

Ermittle das Volume mit der Projekt-ID aus `tale.json`:

```bash
docker volume inspect <project-id>_backups
```

Der Mount-Pfad gehört zum Docker-Host, der auch eine VM oder ein entfernter Rechner sein kann. Richte deinen Backup-Agenten dort ein; der Pfad muss nicht auf deinem Arbeitsplatzrechner existieren. Prüfe, ob die externe Kopie `manifest.json`, alle darin genannten Archive und deren Prüfsummendateien enthält. Auf beiden Laufzeiten schreibt `tale backup export` einen Snapshot außerdem als eine einzige Datei, die du vom Host kopieren kannst, wie unter [Einen Snapshot auf einen anderen Host oder eine andere Laufzeit bringen](#export-import) beschrieben.

Die lokale Rotation behält die neuesten fünf Snapshots **und** alle Snapshots der letzten 14 Tage. Gelöscht wird nur, was außerhalb beider Grenzen liegt. `BACKUP_KEEP_COUNT` und `BACKUP_KEEP_DAYS` in `.env` ändern diese Grenzen. Die Aufbewahrung außerhalb des Hosts konfigurierst du separat.

## Daten und passende Version wiederherstellen

<Warning>

Die Wiederherstellung ersetzt den Inhalt der enthaltenen Daten-Volumes. Sichere den aktuellen Zustand, falls du ihn noch brauchen könntest, und prüfe den Ziel-Workspace. Halte Nutzer und geplante Integrationen von der Wiederherstellungsumgebung fern, bis sie abgenommen ist.

</Warning>

1. Hole den vollständigen Snapshot, Bereitstellungsordner, passende Schlüssel und Backups externer Speicher zurück. Bereite einen neuen Host zuerst wie oben beschrieben vor.
2. Wähle mit `tale restore` eine ID und lies die Plattformversion ab. Ist sie unbekannt, ermittle sie vor dem Anwendungsstart aus deinen Bereitstellungsunterlagen.
3. Stelle bei angehaltenem Stack wieder her. `--stop` hält die Projektcontainer an, die laufen, gerade neu gestartet werden oder pausiert sind. Danach prüft die CLI die Archiv-Prüfsummen und fragt vor dem Ersetzen der Daten nach Bestätigung. Nutze dafür deine aktuelle CLI, bevor Schritt 5 sie wechselt: Eine CLI aus der Zeit vor der Erfassung des Gateway-Speichers überspringt dessen Archiv.

```bash
tale restore <snapshot-id> --stop
```

4. Stelle externe Datenbanken und Buckets bei weiterhin gesperrtem Zugriff auf den abgestimmten Zeitpunkt zurück. Ein als `without blobs` markierter Snapshot lässt das vorhandene lokale Datei-Volume unangetastet. Einer mit der Markierung `without gateway` lässt `llm-gateway-data` unangetastet und kann das Gateway nicht auf seinen Speicher von vor einem Gateway-Upgrade zurückbringen; die CLI warnt davor, bevor sie nach der Bestätigung fragt. Wurde das Gateway nach diesem Snapshot aktualisiert, spiele vor dem nächsten Schritt deine eigene Kopie des Volumes zurück, wie unter [Upgrades](/de/self-hosted/operate/upgrades) beschrieben.
5. Wähle die im Snapshot vermerkte Version und stelle sie einschließlich der zustandsbehafteten Dienste bereit:

```bash
tale update --version <snapshot-platform-version>
tale deploy --stop
tale status
```

Die Version ist entscheidend: Ein neueres Backend kann direkt beim Start Migrationen anwenden. Eine Datenwiederherstellung mit einem beliebigen aktuellen Image stellt daher nicht den dokumentierten Zustand wieder her. Ältere Konfigurationsarchive namens `convex-data` spielt die CLI in das heutige Volume `config-data` ein.

## Snapshots auf Incus {#incus}

In einem Workspace, der auf Incus läuft, nutzen `tale backup`, `tale restore` und der Snapshot vor einem versionswechselnden `tale deploy` die eigenen Volume-Snapshots von Incus. Befehle, Liste und Aufbewahrungseinstellungen bleiben gleich; was ein Snapshot ist, wie eine Wiederherstellung abläuft und was sie braucht, unterscheidet sich.

### Was ein nativer Satz enthält {#incus-sets}

Ein Snapshot auf Incus ist ein Satz: je ein nativer Snapshot jedes Daten-Volumes des Stacks, darunter die aus der Übersicht oben, alle aufgenommen, während die laufenden Dienste, die diese Volumes nutzen, eingefroren sind. Das Einfrieren dauert deutlich unter einer Sekunde, nicht so lange wie ein Archiv; danach wartet der Snapshot, bis jeder Dienst, der gesund war, wieder gesund ist. Ein Manifest im Volume `backups` benennt den Satz. Die Volumes, die die CLI selbst schreibt (die Einträge der Resolver, die Upstream-Listen des Traffic-Switch und die Zugangsdaten des Sandbox-Spawners), gehören nie zu einem Satz, weil die CLI sie aus der Festlegung neu schreibt.

Ein nativer Snapshot liegt auf seinem Volume, im selben Storage-Pool, und übersteht daher den Verlust des Pools oder des Hosts nicht. `tale backup --archive` schreibt zusätzlich ein `tar.gz`-Archiv jedes Volumes mit seiner SHA-256 nach `backups`, im selben Format wie unter Docker. `tale restore` markiert jeden aufgelisteten Snapshot als `native` oder `native + archive`. Snapshots, die Incus nach seinem eigenen Zeitplan anlegt (`snapshots.schedule` in `runtime.incus.volumes`), sind keine Sätze: `tale restore` listet und rotiert sie nicht, und Incus lässt sie nach `snapshots.expiry` ablaufen.

Die Rotation behält dieselben Fenster wie unter Docker (`BACKUP_KEEP_COUNT`, `BACKUP_KEEP_DAYS`). Sie löscht die nativen Snapshots und Archive eines abgelaufenen Satzes zusammen, und ein von einer Wiederherstellung beiseitegestelltes Volume, sobald kein behaltener Snapshot mehr darauf liegt.

### Auf Incus wiederherstellen {#incus-restore}

Eine Wiederherstellung auf Incus setzt ein Volume nie an Ort und Stelle zurück, deshalb bleiben die Snapshots verfügbar, die neuer sind als der wiederhergestellte. Für jedes Volume stoppt `tale restore <snapshot-id> --stop` die Dienste, die es nutzen, jeden innerhalb seiner Schonfrist, und hängt das Volume von ihnen ab. Es stellt das Volume unter dem Namen `<volume>.pre-restore-<zeitstempel>` beiseite, der seine Snapshot-Historie mitnimmt, und kopiert den Snapshot (oder entpackt sein Archiv) in ein frisches Volume mit dem ursprünglichen Namen. Dann hängt es das Volume wieder ein und startet die Dienste. Ohne `--stop` bricht die Wiederherstellung ab, solange ein Dienst eines der Volumes nutzt.

Das beiseitegestellte Volume behält die vollständigen bisherigen Daten, deshalb braucht eine Wiederherstellung etwa den doppelten Platz des Volumes. Bevor sie etwas ändert, prüft die Wiederherstellung, ob der freie Platz im Pool und der Rest jedes Speicherkontingents, das das Projekt setzt (`limits.disk.pool.<pool>`, `limits.disk`), die Größe der Kopien plus 10 % übersteigen, und bricht sonst ab.

Jeder Schritt wird als ausstehende Wiederherstellung im Journal festgehalten. Bleibt eine Wiederherstellung auf halbem Weg stehen, nach einem Absturz, einer verlorenen Verbindung oder einem vollen Pool, lehnen `tale deploy`, `tale start`, `tale rollback`, `tale runtime migrate` und ein neuer Snapshot ab, und `tale status` nennt den Schritt jedes Volumes. Ein fehlendes Daten-Volume wird in der Zwischenzeit nie leer neu angelegt. Schließe die Wiederherstellung ab, oder mache sie rückgängig, sodass jedes Volume wieder ist, wie es war:

```bash
tale restore --resume
tale restore --abort
```

Rolle dann die Version aus, die der Snapshot festgehalten hat, wie Schritt 5 unter [Daten und passende Version wiederherstellen](#daten-und-passende-version-wiederherstellen) beschreibt.

`tale backup prune` listet die Volumes, die Wiederherstellungen beiseitegestellt haben, mit den Snapshots, die noch darauf liegen, und löscht nach Rückfrage die, auf denen kein aufgelisteter Snapshot mehr liegt; `--dry-run` listet sie nur, `--yes` überspringt die Frage. Ein beiseitegestelltes Volume, das noch einen aufgelisteten Snapshot enthält, wird nie gelöscht.

## Einen Snapshot auf einen anderen Host oder eine andere Laufzeit bringen {#export-import}

`tale backup export` schreibt einen Snapshot als eine einzige Datei: ein `tar` aus seinem Manifest und dem `tar.gz`-Archiv jedes Volumes, wobei jedes Archiv beim Hinausschreiben gegen seine SHA-256 geprüft wird. Auf Incus schreibt der Export zuerst die Archive, die einem nativen Satz fehlen, aus Kopien seiner Snapshots; die nativen Snapshots selbst verlassen den Host nie. Der Export überschreibt nie eine Datei.

```bash
tale backup export <snapshot-id> --to tale-snapshot.tar
```

Ohne `--to` heißt die Datei `tale-snapshot-<snapshot-id>.tar` im aktuellen Verzeichnis. Im Ziel-Workspace liest `tale backup import` die Datei nach `backups`, prüft jedes Archiv beim Eintreffen per SHA-256 und schreibt das Manifest zuletzt, sodass ein unterbrochener Import nie aufgelistet wird. Eine Snapshot-ID, die der Workspace schon hat, lehnt es ab. Auf Incus rollst du den Workspace vorher einmal aus, damit sein Volume `backups` existiert. Dann stellst du wie gewohnt wieder her:

```bash
tale backup import tale-snapshot.tar
tale restore <snapshot-id> --stop
```

Das Format ist auf beiden Laufzeiten dasselbe, also lässt sich eine unter Docker exportierte Datei auf Incus wiederherstellen und umgekehrt, mit derselben `.env`, denselben Schlüsseln und derselben Version auf beiden Seiten. [`tale runtime migrate`](/de/self-hosted/install/incus#migrate) geht diese Schritte selbst, wenn es einen Workspace von Docker auf Incus umzieht.

## Wissen, was ein Reset behält {#reset}

`tale reset --all` löscht die Daten-Volumes, und `tale uninstall --purge` baut das ganze Projekt ab. Was übrig bleibt, hängt von der Laufzeit ab:

| Laufzeit | Gelöscht | Behalten |
| --- | --- | --- |
| Docker | Die Daten-Volumes. | Das Volume `<project-id>_backups` mit jedem Snapshot. |
| Incus | Die Daten-Volumes und mit ihnen jeder native Snapshot, der darauf liegt. | Das Volume `backups` mit dem Archiv des neuesten Satzes und jedem Archiv und Manifest, das es schon enthielt, sowie die Volumes, die Wiederherstellungen beiseitegestellt haben. |

Auf Incus archiviert der Reset zuerst den neuesten Satz nach `backups` und prüft das Archiv. Scheitert das, bricht er ab und löscht nichts; `--discard-snapshots` löscht die Volumes trotzdem und verliert ihre nativen Snapshots. Ein älterer Satz ohne Archiv lässt sich nicht mehr wiederherstellen, sobald seine Volumes weg sind, es sei denn, er liegt auf einem Volume, das eine Wiederherstellung beiseitegestellt hat. Archiviere also mit `tale backup --archive`, was du behalten willst, bevor du zurücksetzt. Das nächste `tale deploy` legt leere Daten-Volumes an, und `tale restore` listet den archivierten Snapshot.

## Wiederherstellung vor der Freigabe nachweisen

Melde dich in einer isolierten Übung an, öffne einen bekannten Chat, lade eine ältere Datei herunter, prüfe die Organisationskonfiguration und führe eine kontrollierte Wissenssuche aus. Prüfe den Zugriff auf Anbieterzugangsdaten und externe Speicher, ohne produktive Benachrichtigungen oder Automatisierungen auszulösen. Halte den Zeitraum verlorener Daten, die Wiederherstellungsdauer und alle manuellen Schritte fest.

Wiederhole die Übung nach wesentlichen Speicher-, Schlüssel- oder Bereitstellungsänderungen und in dem Abstand, den deine Wiederherstellungsziele erfordern. [Upgrades](/de/self-hosted/operate/upgrades) erklärt die Versionswahl. [Fehlerbehebung](/de/self-hosted/operate/observability/troubleshooting) hilft, wenn ein wiederhergestellter Dienst nicht betriebsbereit wird.
