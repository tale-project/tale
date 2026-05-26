---
title: Backups und Restore
description: Postgres-Backups über das `db-backup`-Volume, was sonst zu erfassen ist und der Restore-from-Dump-Drill.
---

Das Postgres-Volume `db-data` ist das einzige stateful Stück in einer Tale-Instanz, das für Backups zählt. Alles andere — Convex-Code, Agent-Definitionen, hochgeladene Dateien, auf die die Datenbank verweist — ist entweder aus dem Quell-Repo ableitbar oder liegt unter `convex-data`, was meist ein Cache ist. Eine funktionierende Backup-Story erfasst Postgres plus das `providers/`-Verzeichnis und die Operator-Config unter `TALE_CONFIG_DIR`. Diese Seite ist der Drill.

Der Architektur-Kontext lebt in [Container-Architektur](/de/self-hosted/operate/container-architecture); diese Seite deckt den tatsächlichen Snapshot, die Off-Host-Kopie und den Restore-Walk ab.

## Was sichern

| Pfad                  | Quelle                      | Warum                                                 |
| --------------------- | --------------------------- | ----------------------------------------------------- |
| `db-data`-Volume      | Postgres-Daten              | Die ganze Datenbank — Agents, Runs, Audit, Files      |
| `db-backup`-Volume    | Postgres-Dumps              | Wo der geplante Dump schreibt                         |
| `providers/`          | Anbieter-Schlüssel + Config | Verschlüsselte Secrets und per-Anbieter-Modell-Listen |
| `${TALE_CONFIG_DIR}/` | Branding, Retention-Grenzen | Operator-gesetzte Config-Dateien                      |
| `.env`                | Alle Env-Vars               | Pflicht, um auf frischem Host neu zu deployen         |

Die zwei Volumes werden von Docker verwaltet; das `providers/`-Verzeichnis und `TALE_CONFIG_DIR` werden in den Plattform-Container von deinem Host-Dateisystem gemountet. Backup-Tooling, das Host-Platten snapshotet, erfasst alle drei auf einmal; Volume-bewusste Tools (`restic`, `velero`) brauchen beides.

## Geplante Postgres-Dumps

Der `tale-db`-Container bringt einen Cron-Job mit, der täglich einen `pg_dump` nach `/var/lib/postgresql/backup` schreibt — gemountet als das `db-backup`-Volume. Die Default-Retention beträgt sieben Tage; ältere Dumps werden gestutzt. Der Zeitplan reicht für die meisten Teams; zieh ihn an, indem du die crontab des Containers editierst oder einen Sidecar betreibst.

```bash
# Inspizieren der Dumps, die der Container erzeugt hat
docker compose exec db ls -lh /var/lib/postgresql/backup
```

Jeder Dump ist eine komprimierte SQL-Datei namens `tale-YYYYMMDD-HHMMSS.sql.gz`. Sie sind absichtlich nicht at-rest verschlüsselt — verschlüssel sie mit deinem bestehenden Backup-Tooling auf dem Weg vom Host weg.

## Off-Host-Kopie

Das unterstützte Pattern ist dein bestehendes Snapshot-Tooling (Restic, Borg, Velero, Cloud-Provider-Snapshots), das auf die Host-Platte oder die benannten Volumes gerichtet ist. Tale bringt keinen Upload-Schritt mit — die Off-Host-Kopie unter deinem bestehenden Backup-Vertrag zu halten ist Absicht.

Ein minimales Restic-Beispiel, das das Dump-Volume stündlich nach S3 schreibt:

```bash
# crontab auf dem Host
0 * * * * restic -r s3:s3.amazonaws.com/bucket/tale backup \
  /var/lib/docker/volumes/tale_db-backup/_data
```

Erfass `providers/`, `${TALE_CONFIG_DIR}` und `.env` im selben Job. Der erste Restore-Drill sagt dir, ob der Snapshot abdeckt, was du brauchtest.

## Aus einem Dump wiederherstellen

Der Restore ersetzt die ganze Datenbank. Bring zuerst die Plattform- und Convex-Container runter, stelle Postgres isoliert wieder her und bring dann alles wieder hoch.

```bash
# 1. Stoppe alles, was in die DB schreibt
docker compose stop tale-platform tale-convex

# 2. Lass die bestehende DB fallen und leg sie leer neu an
docker compose exec db psql -U tale -c "DROP DATABASE tale;"
docker compose exec db psql -U tale -c "CREATE DATABASE tale;"

# 3. Pipe den Dump zurück rein
docker compose exec -T db gunzip -c \
  /var/lib/postgresql/backup/tale-20250126-020000.sql.gz \
  | docker compose exec -T db psql -U tale -d tale

# 4. Bring den Rest wieder hoch
docker compose up -d
```

Die erste Anfrage nach dem Restart wärmt die Caches der Plattform neu auf; erwarte, dass die UI sich für die erste Minute langsam anfühlt. Audit-Log-Einträge sind Teil des Dumps, also hat die wiederhergestellte Instanz die volle Historie.

## Restore-Drill

Lauf den Drill vierteljährlich auf einem Nicht-Produktions-Host. Der Drill ist nicht "existiert der Dump" — er ist "kann ein frischer Host aus dem Snapshot und einem sauberen Checkout in unter einer Stunde wiederaufgebaut werden". Die zwei Fehler-Modi, die der Drill fängt: ein fehlender `providers/`-Snapshot (Anbieter-Schlüssel weg) und eine veraltete `.env`, die nicht mehr zu den Anforderungen des aktuellen Binärs passt.

## Wo das hingehört

Backups sind der billige Teil; der Restore-Drill ist der teure Teil und der einzige, der beweist, dass das Backup funktioniert. Die Hardening-Checkliste, die Backups als Zeile nennt, lebt in [Hardening](/de/self-hosted/operate/security/hardening). Designst du ein Multi-Host-Setup, lebt die Architektur in [Container-Architektur](/de/self-hosted/operate/container-architecture).
