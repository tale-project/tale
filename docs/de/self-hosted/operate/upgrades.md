---
title: Upgrades
description: Wie `tale update` eine Tale-Instanz vorwärtsbewegt — die automatische CLI-/Instanz-Versions-Angleichung, das Rolling-Restart-Pattern, was vor einem Upgrade zu tun ist und die Versions-Kompatibilitäts-Story.
---

Upgrades auf einer self-hosted Tale-Instanz laufen durch zwei Kommandos: `tale update` bewegt das CLI-Binary auf die neue Version und synct deine Projektdateien passend dazu, dann rollt `tale deploy` die Plattform-Container. Der Deploy nutzt ein Blue-Green-Pattern — die neue Farbe startet neben der alten, Healthchecks bestehen, der Traffic kippt, die alte Farbe drainet. Zero-Downtime ist der Default; macht ein Patch-Release Ärger, bringt `tale rollback` den vorherigen Patch in einem Kommando zurück, und alles Größere recovert aus dem Pre-Upgrade-Snapshot.

**Eine harte Ausnahme:** Auf 0.5 führt von keiner früheren Linie ein Upgrade-Pfad. 0.5 ist ein Breaking Cutover, der ein frisches Deployment verlangt — lies zuerst [0.4 → 0.5: Breaking Cutover](#04--05-breaking-cutover), wenn deine Instanz auf 0.4.x oder älter läuft (0.4 war selbst der vorige Cutover dieser Art und hat 0.3.x abgetrennt).

Was du nicht mehr tust, ist das CLI von Hand im Gleichschritt zu halten: Das CLI gleicht sich automatisch an die Instanz an (siehe unten), sodass der einzige bewusste Schritt die Wahl ist, wann du mit `tale update` die Version wechselst.

Die CLI-Installation lebt in [Tale-CLI installieren](/de/self-hosted/install/cli-install). Diese Seite deckt ab, was jedes Kommando tut und wie das Versions-Modell funktioniert.

## Das CLI verfolgt die Instanz automatisch

Das CLI-Binary hat immer dieselbe Version wie die Instanz, die es verwaltet. Der Workspace zeichnet diese Version in `tale.json` auf; bei jedem Kommando vergleicht das CLI seine eigene Version dagegen und aktualisiert sich selbst — auf- oder abwärts —, falls sie sich unterscheiden, bevor es läuft. Stimmen sie schon überein — der ganz überwiegend häufige Fall —, ist das ein No-op ohne Netzwerk-Aufruf, sodass du nie etwas davon merkst.

Das heißt, du läufst `tale update` selten, außer wenn du bewusst auf eine neue Version willst. Ein Teamkollege, der ein neueres CLI als deine Instanz installiert hat, oder einen älteren Snapshot wiederhergestellt hat, bekommt beim nächsten Kommando automatisch die richtige CLI-Version. Es gibt kein Flag, das abzuschalten — Tool und Instanz im Gleichschritt zu halten ist das, was Deploys sicher macht.

## Bevor du upgradest

Zwei Dinge sind es wert, zuerst zu bestätigen:

- Deine Off-Host-Kopie des `backups`-Volumes ist aktuell — siehe [Backups und Restore](/de/self-hosted/operate/backups-and-restore). `tale update` snapshotet die Daten-Volumes automatisch vor jedem Schritt, der Daten migrieren kann, aber der Snapshot lebt auf demselben Host; die Off-Host-Kopie ist das, was eine tote Platte überlebt.
- Die Release-Notes für die Zielversion nennen keinen breaking Change. Die Notes sind von der GitHub-Release-Seite verlinkt; breaking Changes sind oben als solche markiert.

Überschreitet das Upgrade eine Major-Version (1.x → 2.x), lies die Migrations-Notes End-to-End, bevor du anfängst. Major-Versionen sind, wo Schema-Migrationen und Config-Datei-Format-Änderungen landen.

## Die zwei Kommandos

`tale update` aktualisiert das CLI-Binary und synct dann deine Projektdateien auf die Templates dieser Version. Es fasst die laufenden Container **nicht** an — das ist der Job von `tale deploy`. Scheitert der Datei-Sync, rollt das CLI sein eigenes Binary auf die Version zurück, auf der dein Workspace war, sodass Binary und `tale.json` nie auseinanderdriften.

Ohne Argumente zielt das Kommando auf das neueste Release **innerhalb deiner aktuellen x.y-Release-Linie** — eine 0.3.x-Instanz bewegt sich auf das neueste 0.3.x. Releases auf einer neueren Linie können breaking Changes tragen, deshalb überquert `tale update` diese Grenze nie von selbst: Existiert eine neuere Linie, sagt es das und bleibt stehen. Der Linienwechsel ist ein bewusster Schritt — lies zuerst die Release-Notes der neuen Linie und nagle die Zielversion dann mit `--version` fest.

```bash
# Bewege das CLI und die Projektdateien auf das neueste Release der aktuellen x.y-Linie
tale update

# Eine bestimmte Version festnageln — der einzige Weg, die Linie zu wechseln (erlaubt Downgrades — siehe Zurückrollen)
tale update --version 0.10.2

# Versions-Wechsel und Datei-Sync vorab ansehen, ohne etwas anzufassen
tale update --dry-run
```

`tale deploy` macht den eigentlichen Rolling-Restart und deployt immer die eigene Version des CLI — die dank der Angleichung die Version ist, die dein Workspace aufzeichnet. Es sortiert die Services in drei Tiers:

- **App-Tier** — `platform` — rollt bei **jedem** Deploy ohne Downtime (Blue-Green: die neue Farbe startet neben der alten, Healthchecks bestehen, der Traffic kippt, die alte Farbe drainet).
- **Backend und Compute** — `backend-api`, `backend-worker`, `sandbox`, `sandbox-egress`, `sandbox-llm-gateway` — rollen ebenfalls bei jedem Deploy, sodass sie nie gegenüber `platform` versions-skewen. Jeder erstellt sich **in-place** neu, wenn sich sein Image tatsächlich geändert hat; der Deploy drainet zuerst die laufende Arbeit (Chat-Turns beim Backend, Agent-Runs bei `sandbox`), damit der kurze Neustart keine lebende Anfrage abschneidet.
- **Stop-gegateter Tier** — `db`, `object-store`, `proxy` — bleibt standardmäßig **laufend und unangetastet** (Postgres, den Blob-Store oder den Proxy neu zu erstellen ist eine kurze Ausfallzeit, die du bei einem Routine-Roll nicht willst). Mit `--stop` aktualisierst du sie; der Deploy warnt und nennt sie, wenn er sie überspringt.

```bash
# Nach tale update die Container passend rollen (App-Tier + Backend)
tale deploy

# Auch db/proxy aktualisieren (kurze Downtime, während sie neu erstellt werden)
tale deploy --stop

# Nur bestimmte Services rollen
tale deploy --services platform

# Vorschau ohne Änderungen
tale deploy --dry-run
```

`--dry-run` ist es wert, vor jedem Produktions-Upgrade zu laufen — es bringt fehlende Images, fehlende Migrationen und Dependency-Mismatches zum Vorschein, ohne die laufenden Container zu berühren.

## Das Blue-Green-Pattern

Eine laufende Instanz ist zu jeder Zeit eine der zwei Farben (Blue oder Green). Die Deploy-Phase bringt die andere Farbe hoch, wartet, bis sie Healthchecks besteht, und kippt dann Caddys Upstream auf die neue Farbe. Die alte Farbe drainet ihre in-flight-Anfragen (Default 30 s), dann beendet sie sich.

Drei Garantien, die das Pattern dir gibt:

- **Kein Fenster, in dem beide Farben Traffic servieren.** Ein Datenbank-Constraint setzt single-active durch — Caddy routet zur gesunden.
- **Patch-Rollback ist ein Kommando.** `tale rollback` deployt das vorherige Patch-Release auf der inaktiven Farbe neu und kippt den Traffic zurück. Minor- und Major-Downgrades verweigert es — die können die Datenbank vor dem Binary zurücklassen, und ihr Recovery-Pfad ist ein Snapshot-Restore.
- **Gescheiterte Healthchecks blockieren den Kipp.** Besteht die neue Farbe nicht innerhalb des Timeouts, bricht der Deploy ab und die alte Farbe serviert weiter.

Die vollständige Deploy-Prozedur inklusive der Cleanup-Phase lebt in `tale --help`; das operatorseitige Rezept ist `tale update && tale deploy && tale status` und visuelle Bestätigung im Browser.

## Wie Schema-Änderungen in ein Deployment kommen

Schema-Änderungen an der Datenbank sind kein eigener Schritt, den du ausführst. Das Backend jeder Release wendet seine eigenen SQL-Migrationen **beim Start** an, unter einem Advisory Lock — die api- und worker-Container (und beliebige skalierte Repliken) wenden sie also genau einmal an, während die anderen warten. Ein deployter Container ist damit immer auf seinem eigenen Schema; es gibt nichts von Hand zu prüfen, anzuwenden oder nachzuziehen.

Migrationen laufen **nur vorwärts** und sind so geschrieben, dass sie unter einem rollenden Deploy sicher sind: Die vorherige Version bedient weiter Requests, während die neue migriert — eine Release liefert also nie eine Änderung aus, die die Version kaputtmacht, die sie ablöst. Eine Version ZURÜCK ist ein Snapshot-Restore, keine Down-Migration — deshalb weigert sich `tale rollback` bei Minor- und Major-Downgrades (siehe unten).

```bash
# Die mitgelieferten Defaults in jede Organisation neu provisionieren (idempotent).
# Derselbe Schritt, den jeder Deploy ausführt — auf Zuruf.
tale migrate
```

Kann das Backend eine Migration nicht anwenden, startet es nicht, und der Healthcheck des Deploys blockiert den Traffic-Wechsel: Die alte Farbe bedient weiter, während du `docker compose logs` liest und die Ursache behebst. Halb migrierter Zustand kommt nie vor Nutzer.

## Zurückrollen

```bash
# Zurück zur vorherigen Patch-Version (fragt nach Bestätigung)
tale rollback

# Die Abfrage im nicht-interaktiven Betrieb überspringen
tale rollback --yes
```

`tale rollback` ist auf Patch-Schritte begrenzt: Es zielt nur auf die aufgezeichnete vorherige Version und verweigert, wenn diese Version nicht `major.minor` mit der laufenden Plattform teilt. Patch-Releases tragen nie Migrationen, also ist das Redeploy des vorherigen Patches immer sicher. Alles Größere kann Daten vorwärts migriert haben — ein älteres Binary auf migrierten Daten zu deployen korrumpiert die Instanz, statt sie zu retten. Für diese Fälle ist der Recovery-Pfad, den Pre-Upgrade-Snapshot wiederherzustellen und mit `tale update --version <version>` gefolgt von `tale deploy --stop` (sodass `db`/`proxy` ebenfalls zurückrollen) auf die passende Version zurückzugehen; die Verweigerungs-Meldung druckt die exakten Kommandos, und der volle Walk lebt in [Backups und Restore](/de/self-hosted/operate/backups-and-restore).

Weil das Zurückrollen die laufenden Container abräumt, warnt das Kommando, was es vorhat, und fragt nach Bestätigung, bevor es auch nur ein Image zieht; mit `--yes` überspringst du diese Abfrage in Skripten oder CI.

## Versions-Kompatibilität

Tale-Versionen sind semver. Die Kompatibilitäts-Regeln:

- Patch (`0.9.0 → 0.9.1`) — keine Migrationen, keine Config-Änderungen, `tale rollback` ist immer sicher.
- Minor (`0.9.x → 0.10.x`) — kann forward-only Migrationen enthalten; `tale rollback` verweigert, Recovery ist Snapshot-Restore plus Redeploy.
- Major (`0.x → 1.x`) — lies die Migrations-Notes, plan das Wartungsfenster, erwarte Überraschungen.
- **Die 0.5.0-Baseline** — Versionen unter 0.5.0 und Versionen ab 0.5.0 sind getrennte Welten: kein Upgrade in keine Richtung, siehe den Cutover-Abschnitt unten.

Minor-Versionen zu überspringen (von 0.9 auf 0.11 zu gehen) ist unterstützt, solange die Zwischen-Schema-Migrationen noch im Image stecken; die Release-Notes nennen es, wenn das nicht der Fall ist. Die 0.5.0-Baseline ist der Dauerfall dieser Ausnahme: Bei 0.5 hat sich der Anwendungs-Store selbst geändert, also kann kein 0.5+-Release lesen, was davor entstand.

Um bewusst eine Version _runter_ zu gehen — etwa wenn ein Minor-Release Ärger macht —, nagle das Ziel mit `tale update --version <version>` fest. Das Kommando warnt, wenn das Ziel älter als die laufende Version ist; gehe nur auf eine Version zurück, deren Schema-Migrationen ein Präfix dessen sind, was die Datenbank angewendet hat, oder stelle einen Volume-Snapshot von vor dem Upgrade wieder her. Ein Downgrade unter 0.5.0 kreuzt den Cutover rückwärts und ist nicht unterstützt: Ein 0.4.x-Release kann von 0.5+ erzeugte Daten nicht lesen — stelle einen Prä-0.5-Snapshot wieder her oder deploye 0.4.x frisch.

## 0.4 → 0.5: Breaking Cutover

0.5 hat Laufzeit und Store des Anwendungs-Backends ersetzt: Anwendungsdaten liegen jetzt in Postgres, wo 0.4 sie in der eigenen Datenbank des mitgelieferten Convex-Dienstes hielt. Kein Importer verbindet die beiden, also **lässt sich eine 0.4.x-Instanz nicht in-place upgraden — 0.5 verlangt ein frisches Deployment.**

**Was das praktisch heißt:**

- `tale deploy` mit einem 0.5+-CLI **verweigert** jede Instanz, deren laufende Version unter 0.5.0 liegt — bevor ein Image gezogen oder irgendetwas geschrieben wird.
- Nichts aus der Datenbank einer 0.4-Instanz wird übernommen: Chats, Automationen samt Lauf-Historie, Wissenseinträge, Aufgaben-Historie, Benutzer und Anmeldungen. Der **Konfigurationsbaum** der Organisation (Agenten, Skills, Anbieter, Governance-Richtlinien) liegt als Dateien auf dem geteilten Konfigurations-Volume und wandert mit; Dateien in einem BYO-S3-Bucket bleiben physisch im Bucket, aber die neue Instanz hat keine Referenzen darauf.
- Die 0.4.x-Linie bleibt für Sicherheits- und kritische Fixes auf dem Branch `release/0.4` gepflegt — eine Weile auf 0.4.x zu bleiben ist ein unterstützter Weg; der Wechsel auf 0.5 ist ein Re-Onboarding, kein Upgrade.

**Der Weg auf 0.5:**

```bash
# 1. Die 0.4-Instanz unangetastet lassen (sie bedient weiter).
# 2. Ein NEUES Projektverzeichnis mit einem 0.5-CLI anlegen:
mkdir tale-05 && cd tale-05
tale init
tale deploy

# 3. Re-Onboarding: Organisationen, Benutzer (Einladung / SSO),
#    Konfiguration, Dokumente und Wissen neu hochladen.
# 4. Die 0.4-Instanz stilllegen, sobald die neue abgenommen ist.
```

Der Experten-Override — `tale deploy --accept-data-loss` — existiert für den seltenen Fall, dass du bewusst einen Host wiederverwendest, dessen alte Volumes du bereits behandelt hast. Er tut genau, was sein Name sagt: Prä-0.5-Daten dieser Instanz werden dauerhaft unlesbar.

## Wo das hingehört

Der Upgrade-Flow knüpft jede andere Operate-Seite an — Backups sind das, was ein gescheitertes Upgrade wiederherstellbar macht, Observability ist das, was dir sagt, dass die neue Farbe healthy ist, Hardening ist das, was du nach einer Major-Version neu durchgehst. Setzt du das CLI zum ersten Mal auf, deckt [Tale-CLI installieren](/de/self-hosted/install/cli-install) das workstationseitige Setup ab; nimmst du den Pager mitten im Rollout auf, nennt [Troubleshooting](/de/self-hosted/operate/observability/troubleshooting) die Symptome.
