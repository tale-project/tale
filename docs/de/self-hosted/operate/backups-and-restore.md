---
title: Backups und Restore
description: Volume-Snapshots über `tale backup`, der automatische Pre-Migrations-Snapshot, Retention, die Off-Host-Kopie und der `tale restore`-Drill.
---

Tales Backup-Einheit ist der Volume-Snapshot: ein pausiertes, checksummengesichertes Tar der Kern-Daten-Volumes der Instanz, geschrieben in ein dediziertes `backups`-Volume, das neben den Daten lebt, die es schützt. Das CLI nimmt automatisch einen vor jedem Deploy-Schritt, der Daten migrieren kann, und `tale backup` nimmt einen auf Zuruf. Recovery ist `tale restore <snapshot-id>` plus ein Redeploy der passenden Version — dieses Paar ist die Antwort auf ein gescheitertes Upgrade und der Grund, warum `tale rollback` sich alles jenseits eines Patch-Schritts verweigern kann.

Der Architektur-Kontext lebt in [Container-Architektur](/de/self-hosted/operate/container-architecture); diese Seite deckt ab, was ein Snapshot enthält, wann einer genommen wird, wie die Kopie vom Host runterkommt und den Restore-Walk.

## Was ein Snapshot enthält

| Volume                       | Enthält                                                                                                                                |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `db-data`                    | Postgres — der Anwendungsspeicher (Agents, Runs, das Audit-Log) und der Wissens-Korpus (Dokument-Chunks, Embeddings, gecrawlte Seiten) |
| `convex-data`                | Org-Config, Anbieter-Secrets, hochgeladenes Branding                                                                                   |
| `caddy-data`, `caddy-config` | TLS-Zertifikate und Proxy-State                                                                                                        |

Jeder Snapshot ist ein Verzeichnis mit einem Namen wie `20260611-142530-deploy` im `backups`-Volume des Projekts: ein `.tar.gz` pro Volume, je ein `.sha256`-Sidecar und ein zuletzt geschriebenes `manifest.json`. Ein Verzeichnis ohne Manifest ist ein unvollständiger Snapshot — er taucht nie in Listings auf und lässt sich nie wiederherstellen. Der Snapshot lässt `object-store-data` bewusst aus — den Blob-Store mit hochgeladenen Dateien und generierten Medien —, sodass diese Blobs ihre eigene Off-Host-Erfassung brauchen, neben den zwei Dingen, die ganz außerhalb der Volumes leben: dem Projekt-Workspace (das Verzeichnis mit `tale.json`) und `.env`.

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

Die Snapshots leben auf demselben Host wie die Daten, die sie schützen — eine tote Platte nimmt beides mit. Richte dein bestehendes Backup-Tooling (Restic, Borg, Velero, Cloud-Provider-Snapshots) auf das `backups`-Volume und erfasse den Projekt-Workspace und `.env` im selben Job. Tale bringt keinen Upload-Schritt mit — die Off-Host-Kopie unter deinem bestehenden Backup-Vertrag zu halten ist Absicht.

```bash
# crontab auf dem Host — stündliche Restic-Kopie des backups-Volumes nach S3
0 * * * * restic -r s3:s3.amazonaws.com/bucket/tale backup \
  /var/lib/docker/volumes/<project-id>_backups/_data
```

Den Host-Pfad des Volumes findest du mit `docker volume inspect <project-id>_backups`; die Projekt-ID steht in `tale.json`.

## Einen Snapshot wiederherstellen

`tale restore` ohne Argumente listet, was verfügbar ist; mit einer ID verifiziert es die Checksummen, leert die Daten-Volumes und entpackt den Snapshot. Es verweigert, solange irgendein Projekt-Container läuft — `--stop` stoppt sie — und fragt nach Bestätigung, bevor es irgendetwas anfasst.

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

Lauf den Drill vierteljährlich auf einem Nicht-Produktions-Host. Der Drill ist nicht „existiert ein Snapshot" — er ist „kann ein frischer Host aus der Off-Host-Kopie des `backups`-Volumes, dem Projekt-Workspace und `.env` in unter einer Stunde wiederaufgebaut werden". Die Fehler-Modi, die der Drill fängt: ein Off-Host-Job, der den Workspace nie erfasst hat, und eine veraltete `.env`, die nicht mehr zu den Anforderungen des aktuellen Binarys passt.

## Wo das hingehört

Snapshots sind der billige Teil; der Restore-Drill ist das, was beweist, dass sie funktionieren, und die Redeploy-der-passenden-Version-Regel ist das eine, was du dir merken solltest — Recovery ist nie „das Binary zurückrollen", sondern „die Daten wiederherstellen und die Version deployen, zu der sie gehören". Der Upgrade-Flow, den diese Snapshots schützen, lebt in [Upgrades](/de/self-hosted/operate/upgrades); die Hardening-Checkliste, die Backups als Zeile nennt, ist in [Hardening](/de/self-hosted/operate/security/hardening).
