---
title: Upgrades
description: Wie `tale upgrade` und `tale deploy` eine Tale-Instanz vorwärtsbewegen — das Rolling-Restart-Pattern, was vor einem Upgrade zu tun ist und die Versions-Kompatibilitäts-Story.
---

Upgrades auf einer self-hosted Tale-Instanz laufen durch das `tale`-CLI in zwei Schritten: `tale upgrade`, um das Binary selbst auf die neue Version zu bewegen, dann `tale deploy`, um die Plattform-Container passend zu rollen. Der Deploy nutzt ein Blue-Green-Pattern — die neue Farbe startet neben der alten, Healthchecks bestehen, der Traffic kippt, die alte Farbe drainet. Zero-Downtime ist der Default; Rollback zur vorherigen Farbe ist ein einzelnes Kommando, wenn ein Smoke-Check scheitert.

Die CLI-Installation lebt in [Tale-CLI installieren](/de/self-hosted/install/cli-install). Diese Seite deckt ab, was jedes Subkommando tut und in welcher Reihenfolge sie zu laufen sind.

## Bevor du upgradest

Zwei Dinge sind es wert, zuerst zu bestätigen:

- Ein funktionierendes Backup ist in den letzten 24 Stunden gelandet — siehe [Backups und Restore](/de/self-hosted/operate/backups-and-restore). Upgrades, die mitten in der Migration scheitern, sind selten, aber der Recovery-Pfad ist „aus Dump wiederherstellen".
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
- **Rollback ist das Zurücksetzen einer State-Datei.** `tale rollback` kippt den Upstream zurück; die alte Farbe läuft nach einem Deploy noch einige Minuten, falls du zurück musst.
- **Gescheiterte Healthchecks blockieren den Kipp.** Besteht die neue Farbe nicht innerhalb des Timeouts, bricht der Deploy ab und die alte Farbe serviert weiter.

Die vollständige Deploy-Prozedur inklusive der Cleanup-Phase lebt in `tale --help`; das operatorseitige Rezept ist `tale deploy && tale status` und visuelle Bestätigung im Browser.

## Zurückrollen

```bash
# Zurück zur vorherigen Version
tale rollback

# Oder auf eine bestimmte Version pinnen
tale rollback --version 0.9.0
```

Rollback ist schnell (es ist nur das Kippen der Farbe), macht aber Schema-Migrationen nicht rückgängig. Lief das Upgrade eine Migration, die die alte Version nicht versteht, lässt Rollback die Datenbank vor dem Binary — die alte Version weigert sich zu starten. Die Release-Notes nennen, wenn das passiert; für solche Upgrades ist Restore-from-Dump der tatsächliche Rollback-Pfad.

## Versions-Kompatibilität

Tale-Versionen sind semver. Die Kompatibilitäts-Regeln:

- Patch (`0.9.0 → 0.9.1`) — keine Migrationen, keine Config-Änderungen, Rollback ist immer sicher.
- Minor (`0.9.x → 0.10.x`) — kann forward-only Migrationen enthalten; Rollback stellt das Binary wieder her, aber nicht das Schema.
- Major (`0.x → 1.x`) — lies die Migrations-Notes, plan das Wartungsfenster, erwarte Überraschungen.

Minor-Versionen zu überspringen (von 0.9 auf 0.11 zu gehen) ist unterstützt, solange die Zwischen-Migrationen noch im Binary sind; die Release-Notes nennen es, wenn das nicht der Fall ist.

## Wo das hingehört

Der Upgrade-Flow knüpft jede andere Operate-Seite an — Backups sind das, was ein gescheitertes Upgrade wiederherstellbar macht, Observability ist das, was dir sagt, dass die neue Farbe healthy ist, Hardening ist das, was du nach einer Major-Version neu durchgehst. Setzt du das CLI zum ersten Mal auf, deckt [Tale-CLI installieren](/de/self-hosted/install/cli-install) das workstationseitige Setup ab; nimmst du den Pager mitten im Rollout auf, nennt [Troubleshooting](/de/self-hosted/operate/observability/troubleshooting) die Symptome.

## Migration auf das Org-first-Config-Layout

Ältere Tale-Releases haben Config in einem flachen Baum im Workspace-Root abgelegt (`agents/`, `workflows/`, `integrations/`, `branding/`, `providers/`, `skills/`). Aktuelles Tale nutzt ein **Org-first**-Layout, in dem jede Org — auch die kanonische `default` — ihren eigenen Unterbaum besitzt: `<root>/<org>/<domain>/...`. Die Migration ist opt-in und läuft einmal pro Workspace. Die neue Plattform liest die alten Pfade nicht mehr; bis du migrierst, liegen Provider-Secrets und Anpassungen in Verzeichnissen, die das Runtime nicht mehr anschaut.

Die Migration sind drei Kommandos. Für Schritt 1 muss der Convex-Container vom **alten** Image noch laufen — halt die Plattform auf der alten Version online und führe Schritt 1 gegen diesen laufenden Container aus, bevor du upgradest.

```bash
# 1. Provider-Secrets aus dem flachen Layout nach
#    `default/providers/...` kopieren. cp statt mv, damit die alten
#    Pfade für einen möglichen Rollback intakt bleiben. Scope sind
#    ausschließlich Provider-Secrets; alle anderen Domains (agents,
#    workflows, integrations, skills, branding, retention) werden in
#    Schritt 2 server-seitig aus dem Builtin-Katalog re-seedet.
tale migrate config-layout

# 2. Convex-Container gegen das Org-first-Volume-Layout neu erstellen
#    und den server-seitigen Reseed über jede registrierte Org laufen
#    lassen. Impliziert `--all`; `-y` überspringt den destruktiven
#    Bestätigungs-Prompt für CI / Skript-Läufe.
tale deploy --override-all -y

# 3. Wenn du das neue Layout verifiziert hast, alte Pfade entfernen.
#    Verifiziert byte-für-byte, dass die neue Datei der alten
#    entspricht, bevor unlink; bei Mismatch wird das Löschen
#    verweigert.
tale migrate config-layout --cleanup-old
```

Schritt 1 ist safe und reversibel — ein Re-Run ist no-op, sobald Pfade existieren. Schritt 2 ist destruktiv: jede Org-Config mit Katalog-Name (`*.json` unter `agents/`, `workflows/`, `integrations/`, `skills/`, `branding/branding.json`, `retention.json`) wird mit dem Builtin-Katalog überschrieben. `*.secrets.json`-Dateien, `.history/`-Trails und hochgeladene `branding/images/*` bleiben server-seitig erhalten. Nach Schritt 2 liest die Plattform ausschließlich aus dem Org-first-Layout.

Schritt 3 ist der Point-of-no-Return für Downgrades — siehe unten.

### Org-first-Migration zurückrollen

Zwischen Schritt 1 und 3 kannst du sauber downgraden. Der Convex-Entrypoint markiert jeden Seed-Lauf mit einem Token, das die Layout-Version enthält (`.seeded-<version>-orgfirst`); ein älteres Binary, das diesen Token nicht erkennt, re-seedet idempotent in seine eigenen (flachen) Pfade, und Schritt 1's `cp` hat die alten Pfade intakt gelassen. Downgrade ist ein normales `tale rollback`.

Nach Schritt 3 (`--cleanup-old`) sind die alten Pfade weg. Downgrade re-seedet das Layout zwar weiterhin korrekt via Marker-Token-Mechanismus, aber die App startet mit leeren Provider-Secrets — stelle sie aus dem Backup wieder her (siehe [Backups und Restore](/de/self-hosted/operate/backups-and-restore)), bevor du Traffic wieder aufnimmst.

### Was, wenn ich Schritt 1 überspringe?

`tale deploy` und `tale start` verweigern beide den Start, wenn sie übrig gebliebene flache Layout-Dirs (`agents/`, `workflows/`, `integrations/`, `branding/`, `providers/`, `skills/`, `retention/`) im Workspace-Root finden. Der Fehler nennt die betroffenen Verzeichnisse und verweist auf dieses Runbook. Die Korrektur sind Schritt 1 + 2 in dieser Reihenfolge; es gibt keinen "trotzdem deployen und Legacy-Pfade ignorieren"-Modus — die Runtime-Resolver lesen diese Pfade nicht, ein Boot ohne Migration würde die Plattform also mit leerer Config zurücklassen.
