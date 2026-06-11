---
title: Upgrades
description: Wie `tale upgrade` und `tale deploy` eine Tale-Instanz vorwärtsbewegen — das Rolling-Restart-Pattern, was vor einem Upgrade zu tun ist und die Versions-Kompatibilitäts-Story.
---

Upgrades auf einer self-hosted Tale-Instanz laufen durch das `tale`-CLI in zwei Schritten: `tale upgrade`, um das Binary selbst auf die neue Version zu bewegen, dann `tale deploy`, um die Plattform-Container passend zu rollen. Der Deploy nutzt ein Blue-Green-Pattern — die neue Farbe startet neben der alten, Healthchecks bestehen, der Traffic kippt, die alte Farbe drainet. Zero-Downtime ist der Default; macht ein Patch-Release Ärger, bringt `tale rollback` den vorherigen Patch in einem Kommando zurück, und alles Größere recovert aus dem Pre-Upgrade-Snapshot.

Die CLI-Installation lebt in [Tale-CLI installieren](/de/self-hosted/install/cli-install). Diese Seite deckt ab, was jedes Subkommando tut und in welcher Reihenfolge sie zu laufen sind.

## Bevor du upgradest

Zwei Dinge sind es wert, zuerst zu bestätigen:

- Deine Off-Host-Kopie des `backups`-Volumes ist aktuell — siehe [Backups und Restore](/de/self-hosted/operate/backups-and-restore). `tale deploy` snapshotet die Daten-Volumes automatisch vor jedem Schritt, der Daten migrieren kann, aber der Snapshot lebt auf demselben Host; die Off-Host-Kopie ist das, was eine tote Platte überlebt.
- Die Release-Notes für die Zielversion nennen keinen breaking Change. Die Notes sind von der GitHub-Release-Seite verlinkt; breaking Changes sind oben als solche markiert.

Überschreitet das Upgrade eine Major-Version (1.x → 2.x), lies die Migrations-Notes End-to-End, bevor du anfängst. Major-Versionen sind, wo Schema-Migrationen und Config-Datei-Format-Änderungen landen.

## Die zwei Kommandos

`tale upgrade` aktualisiert das CLI-Binary selbst. Die deployte Plattform-Version stimmt mit der Version des CLI überein — diese Kopplung ist Absicht, damit das CLI, das du ausführst, nicht eine Version deployen kann, die es nicht kennt.

```bash
# Bewege das CLI auf das letzte Release
tale upgrade

# Dann rolle die Plattform passend
tale deploy
```

`tale deploy` macht den eigentlichen Rolling-Restart: Es zieht neue Images, startet die neue Blue- oder Green-Farbe neben der laufenden, wartet auf Healthchecks, kippt den Proxy, drainet und entfernt die alte Farbe. Der Default zielt auf die rotierbaren Services (`platform`, `rag`, `crawler`); stateful Services (`db`, `proxy`) brauchen `--all`, um in-place aktualisiert zu werden.

```bash
# Schliess die stateful Services ein
tale deploy --all

# Rolle nur bestimmte Services
tale deploy --services platform,rag

# Vorschau ohne Änderungen
tale deploy --dry-run
```

`--dry-run` ist es wert, vor jedem Produktions-Upgrade zu laufen — es bringt fehlende Images, fehlende Migrationen und Dependency-Mismatches zum Vorschein, ohne die laufenden Container zu berühren.

## Das Blue-Green-Pattern

Eine laufende Instanz ist zu jeder Zeit eine der zwei Farben (Blue oder Green). `tale deploy` bringt die andere Farbe hoch, wartet, bis sie Healthchecks besteht, und kippt dann Caddys Upstream auf die neue Farbe. Die alte Farbe drainet ihre in-flight-Anfragen (Default 30 s), dann beendet sie sich.

Drei Garantien, die das Pattern dir gibt:

- **Kein Fenster, in dem beide Farben Traffic servieren.** Ein Datenbank-Constraint setzt single-active durch — Caddy routet zur gesunden.
- **Patch-Rollback ist ein Kommando.** `tale rollback` deployt das vorherige Patch-Release auf der inaktiven Farbe neu und kippt den Traffic zurück. Minor- und Major-Downgrades verweigert es — die können die Datenbank vor dem Binary zurücklassen, und ihr Recovery-Pfad ist ein Snapshot-Restore.
- **Gescheiterte Healthchecks blockieren den Kipp.** Besteht die neue Farbe nicht innerhalb des Timeouts, bricht der Deploy ab und die alte Farbe serviert weiter.

Die vollständige Deploy-Prozedur inklusive der Cleanup-Phase lebt in `tale --help`; das operatorseitige Rezept ist `tale deploy && tale status` und visuelle Bestätigung im Browser.

## Zurückrollen

```bash
# Zurück zur vorherigen Patch-Version
tale rollback
```

`tale rollback` ist auf Patch-Schritte begrenzt: Es zielt nur auf die aufgezeichnete vorherige Version und verweigert, wenn diese Version nicht `major.minor` mit der laufenden Plattform teilt. Patch-Releases tragen nie Migrationen, also ist das Redeploy des vorherigen Patches immer sicher. Alles Größere kann Daten vorwärts migriert haben — ein älteres Binary auf migrierten Daten zu deployen korrumpiert die Instanz, statt sie zu retten. Für diese Fälle ist der Recovery-Pfad, den Pre-Upgrade-Snapshot wiederherzustellen und die passende Version neu zu deployen; die Verweigerungs-Meldung druckt die exakten Kommandos, und der volle Walk lebt in [Backups und Restore](/de/self-hosted/operate/backups-and-restore).

## Versions-Kompatibilität

Tale-Versionen sind semver. Die Kompatibilitäts-Regeln:

- Patch (`0.9.0 → 0.9.1`) — keine Migrationen, keine Config-Änderungen, `tale rollback` ist immer sicher.
- Minor (`0.9.x → 0.10.x`) — kann forward-only Migrationen enthalten; `tale rollback` verweigert, Recovery ist Snapshot-Restore plus Redeploy.
- Major (`0.x → 1.x`) — lies die Migrations-Notes, plan das Wartungsfenster, erwarte Überraschungen.

Minor-Versionen zu überspringen (von 0.9 auf 0.11 zu gehen) ist unterstützt, solange die Zwischen-Migrationen noch im Binary sind; die Release-Notes nennen es, wenn das nicht der Fall ist.

## Wo das hingehört

Der Upgrade-Flow knüpft jede andere Operate-Seite an — Backups sind das, was ein gescheitertes Upgrade wiederherstellbar macht, Observability ist das, was dir sagt, dass die neue Farbe healthy ist, Hardening ist das, was du nach einer Major-Version neu durchgehst. Setzt du das CLI zum ersten Mal auf, deckt [Tale-CLI installieren](/de/self-hosted/install/cli-install) das workstationseitige Setup ab; nimmst du den Pager mitten im Rollout auf, nennt [Troubleshooting](/de/self-hosted/operate/observability/troubleshooting) die Symptome.
