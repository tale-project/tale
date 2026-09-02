---
title: Backups und Restore
description: Volume-Snapshots über `tale backup`, der automatische Pre-Migrations-Snapshot, Retention, die Off-Host-Kopie und der `tale restore`-Drill.
---

Tales Backup-Einheit ist der Volume-Snapshot: ein pausiertes, checksummengesichertes Tar der Datenbank, des Org-Config-Baums und des Proxy-States, geschrieben in ein dediziertes `backups`-Volume, das neben den Daten lebt, die es schützt. Das CLI nimmt automatisch einen vor jedem Deploy-Schritt, der Daten migrieren kann, und `tale backup` nimmt einen auf Zuruf. Recovery ist `tale restore <snapshot-id>` plus ein Redeploy der passenden Version — dieses Paar ist die Antwort auf ein gescheitertes Upgrade und der Grund, warum `tale rollback` sich alles jenseits eines Patch-Schritts verweigern kann.

Ein Snapshot ist nicht die ganze Instanz. Hochgeladene Datei-Blobs liegen außerhalb, deshalb ist der Off-Host-Job weiter unten das, was einen vollständigen Wiederaufbau überhaupt möglich macht — lies diesen Abschnitt auch dann, wenn du nie manuell snapshotest.

Der Architektur-Kontext lebt in [Container-Architektur](/de/self-hosted/operate/container-architecture); diese Seite deckt ab, was ein Snapshot enthält, was er dir überlässt, wann einer genommen wird, wie die Kopie vom Host runterkommt und den Restore-Walk.

## Was ein Snapshot enthält

| Volume                       | Enthält                                                                                                                                                                    |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `db-data`                    | Postgres — die Anwendungsdatenbank (Chats, Aufgaben, Automation-Runs, das Audit-Log) und, auf einem Single-Host-`tale deploy`-Stack mit einem gemeinsamen Postgres, das Wissens-Korpus |
| `convex-data`                | Der Org-Config-Baum — Agents, Automations, Connectors, Anbieter, Skills, Governance-Policies, SSO-Verbindungen, Branding                                                    |
| `caddy-data`, `caddy-config` | TLS-Zertifikate und Proxy-State                                                                                                                                            |

`convex-data` ist der historische Name des Config-Volumes. Er bleibt bewusst, damit die Abschaltung des Convex-Backends niemanden zwingt, ein Volume nur für eine Umbenennung zu migrieren; Convex läuft darin nichts mehr.

Jeder Snapshot ist ein Verzeichnis mit einem Namen wie `20260611-142530-deploy` im `backups`-Volume des Projekts: ein `.tar.gz` pro Volume, je ein `.sha256`-Sidecar und ein zuletzt geschriebenes `manifest.json`. Ein Verzeichnis ohne Manifest ist ein unvollständiger Snapshot — er taucht nie in Listings auf und lässt sich nie wiederherstellen.

<Warning>

**Hochgeladene Dateien sind nicht im Snapshot.** Dokument-Blobs, Chat-Anhänge, Audio und generierte Medien liegen im Blob-Store auf dem Volume `object-store-data`, und `tale backup` erfasst es nicht. Ein Restore bringt damit Zeilen zurück, die auf Blobs zeigen, die der Store nicht mehr hat — die App rendert die Dokumentliste und scheitert beim Öffnen. Erfasse `object-store-data` im selben Job, der das `backups`-Volume vom Host kopiert, oder richte das Deployment auf einen Object-Store, der seine eigenen Backups mitbringt.

</Warning>

Drei weitere Dinge leben außerhalb der gesnapshotteten Volumes und brauchen separate Erfassung: der Blob-Store oben, der Projekt-Workspace (das Verzeichnis mit `tale.json`) und `.env`.

## Wann Snapshots genommen werden

`tale deploy` snapshotet vor seinem ersten mutierenden Schritt, wann immer der Deploy Daten ändern kann: Die Zielversion weicht von der laufenden ab oder ein Host-Config-Push (`--override` / `--override-all`) ist angefordert. Während jedes Volume getart wird, sind die Container, die es nutzen, für ein paar Sekunden pausiert, damit das Archiv crash-konsistent ist — eine Live-Kopie eines laufenden Postgres-Verzeichnisses ist nicht wiederherstellbar.

Ein gescheiterter Snapshot bricht den Deploy ab. `--skip-backup` übersteuert das auf `tale deploy` — dann sind deine eigenen externen Backups der einzige Recovery-Pfad, und genau deshalb loggt das Flag eine laute Warnung.

```bash
# Jetzt sofort einen Snapshot nehmen
tale backup
```

## Retention

Die Rotation behält die neuesten fünf Snapshots und alles aus den letzten 14 Tagen — je nachdem, was großzügiger ist. Ein Snapshot wird nur gelöscht, wenn er sowohl jenseits des Anzahl-Fensters als auch älter als das Alters-Fenster ist; eine ruhige Instanz behält ihre letzten Snapshots also unbegrenzt. Übersteuere die Fenster mit `BACKUP_KEEP_COUNT` und `BACKUP_KEEP_DAYS` in `.env`.

## Off-Host-Kopie

Die Snapshots leben auf demselben Host wie die Daten, die sie schützen — eine tote Platte nimmt beides mit. Richte dein bestehendes Backup-Tooling (Restic, Borg, Velero, Cloud-Provider-Snapshots) auf das `backups`-Volume **und** auf `object-store-data` und erfasse den Projekt-Workspace und `.env` im selben Job. Tale bringt keinen Upload-Schritt mit — die Off-Host-Kopie unter deinem bestehenden Backup-Vertrag zu halten ist Absicht.

```bash
# crontab auf dem Host — stündliche Restic-Kopie der Snapshots und des Blob-Stores
0 * * * * restic -r s3:s3.amazonaws.com/bucket/tale backup \
  /var/lib/docker/volumes/<project-id>_backups/_data \
  /var/lib/docker/volumes/<project-id>_object-store-data/_data
```

Den Host-Pfad eines Volumes findest du mit `docker volume inspect <project-id>_backups`; die Projekt-ID steht in `tale.json`.

## Einen Snapshot wiederherstellen

`tale restore` ohne Argumente listet, was verfügbar ist; mit einer ID verifiziert es die Checksummen, leert die Volumes, die der Snapshot abdeckt, und entpackt ihn. Es verweigert, solange irgendein Projekt-Container läuft — `--stop` stoppt sie — und fragt nach Bestätigung, bevor es irgendetwas anfasst. Wiederhergestellt werden nur die Volumes aus der Tabelle oben; den Blob-Store spielst du selbst aus der Off-Host-Kopie zurück, bevor du den Stack wieder hochfährst.

```bash
# Sehen, was verfügbar ist
tale restore

# Stack stoppen und wiederherstellen
tale restore 20260611-142530-deploy --stop

# Den Stack auf der Version zurückbringen, die zu den Daten passt
tale update --version 0.9.6
tale deploy --stop
```

Das Redeploy der passenden Version ist Teil des Restores, kein optionales Extra: Der Snapshot hat die Daten exakt so erfasst, wie diese Plattform-Version sie hinterlassen hat, und ein neueres Binary würde sofort wieder seine Migrationen darauf laufen lassen. Die Restore-Ausgabe druckt die exakte Version aus dem Manifest des Snapshots.

## Restore-Drill

Lauf den Drill vierteljährlich auf einem Nicht-Produktions-Host. Der Drill ist nicht „existiert ein Snapshot" — er ist „kann ein frischer Host aus der Off-Host-Kopie des `backups`-Volumes, dem Blob-Store, dem Projekt-Workspace und `.env` in unter einer Stunde wiederaufgebaut werden". Schließe damit ab, ein Dokument zu öffnen, das vor dem Snapshot hochgeladen wurde: Das ist der eine Schritt, der beweist, dass der Blob-Store zusammen mit der Datenbank zurückgekommen ist, und genau den überspringt ein Drill, der nur den Snapshot prüft. Die weiteren Fehler-Modi, die der Drill fängt: ein Off-Host-Job, der den Workspace nie erfasst hat, und eine veraltete `.env`, die nicht mehr zu den Anforderungen des aktuellen Binarys passt.

## Wo das hingehört

Snapshots sind der billige Teil; der Restore-Drill ist das, was beweist, dass sie funktionieren, und die Redeploy-der-passenden-Version-Regel ist das eine, was du dir merken solltest — Recovery ist nie „das Binary zurückrollen", sondern „die Daten wiederherstellen und die Version deployen, zu der sie gehören". Der Upgrade-Flow, den diese Snapshots schützen, lebt in [Upgrades](/de/self-hosted/operate/upgrades); die Hardening-Checkliste, die Backups als Zeile nennt, ist in [Hardening](/de/self-hosted/operate/security/hardening).
