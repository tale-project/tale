---
title: Upgrades
description: Wie `tale update` eine Tale-Instanz vorwärtsbewegt — die automatische CLI-/Instanz-Versions-Angleichung, das Rolling-Restart-Pattern, was vor einem Upgrade zu tun ist und die Versions-Kompatibilitäts-Story.
---

Upgrades auf einer self-hosted Tale-Instanz laufen durch zwei Kommandos: `tale update` bewegt das CLI-Binary auf die neue Version und synct deine Projektdateien passend dazu, dann rollt `tale deploy` die Plattform-Container. Der Deploy nutzt ein Blue-Green-Pattern — die neue Farbe startet neben der alten, Healthchecks bestehen, der Traffic kippt, die alte Farbe drainet. Zero-Downtime ist der Default; macht ein Patch-Release Ärger, bringt `tale rollback` den vorherigen Patch in einem Kommando zurück, und alles Größere recovert aus dem Pre-Upgrade-Snapshot.

**Eine harte Ausnahme:** Von 0.3.x auf 0.4 gibt es keinen Upgrade-Pfad. 0.4 ist ein Breaking Cutover, der ein frisches Deployment verlangt — lies zuerst [0.3 → 0.4: Breaking Cutover](#03--04-breaking-cutover), wenn deine Instanz auf 0.3.x läuft.

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
- **Backend und Compute** — `convex`, `sandbox`, `sandbox-egress` — rollen ebenfalls bei jedem Deploy, sodass sie nie gegenüber `platform` versions-skewen. Jeder ist ein einzelner Container, der sich **in-place** neu erstellt, wenn sich sein Image tatsächlich geändert hat; der Deploy drainet zuerst die laufende Arbeit (Chat-Generierungen bei `convex`, Agent-Runs bei `sandbox`), damit der kurze Neustart keine lebende Anfrage abschneidet.
- **Stop-gegateter Tier** — `db`, `proxy` — bleibt standardmäßig **laufend und unangetastet** (Postgres oder den Proxy neu zu erstellen ist eine kurze Ausfallzeit, die du bei einem Routine-Roll nicht willst). Mit `--stop` aktualisierst du sie; der Deploy warnt und nennt sie, wenn er sie überspringt.

```bash
# Nach tale update die Container passend rollen (App-Tier + convex)
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

## Mit Datenmigrationen arbeiten

Die Migrationskette beginnt an der **0.4.0-Baseline**: Releases ab 0.4.0 tragen versionierte Migrationen für die Änderungen, die sie ausliefern, und nichts Älteres — die Prä-0.4-Historie steckt in keinem Binary (genau das macht den 0.3 → 0.4 Cutover breaking). Innerhalb der 0.4.x-Linie wendet jedes Deploy ausstehende Datenmigrationen automatisch an — aber nur die nicht-destruktiven. Migrationen, die Daten entfernen oder überschreiben (ein Tabellen-Drop, eine entfernte Spalte), laufen nie unbeaufsichtigt: Das Deploy überspringt sie, listet auf, welche warten, und überlässt dir die Entscheidung.

```bash
# Was angewendet ist, was aussteht, was fehlgeschlagen ist
tale migrate status

# Ausstehende Migrationen anwenden, jeden destruktiven Schritt einzeln prüfen
tale migrate up --step

# Alles ohne Rückfragen anwenden (CI / nach Prüfung des Plans)
tale migrate up --yes

# Daten auf eine frühere Version zurückrollen (0.4.0 oder neuer)
tale migrate down --to 0.4.0
```

Destruktive Migrationen sichern die betroffenen Zeilen bzw. Konfigurationsdateien, bevor sie sie anfassen — `tale migrate down` kann so wiederherstellen, was sie entfernt haben. Beide Richtungen sind fortsetzbar: Der Fortschritt wird pro Migration festgehalten (bei Konfigurationsdatei-Migrationen pro Organisation), ein Absturz oder Timeout setzt also dort wieder an, wo er unterbrochen wurde.

Schlägt eine Migration während eines Deploys fehl, bootet die Plattform trotzdem auf ihrem aktuellen Schema — das Boot-Log zeigt einen deutlichen Fehler, und `tale migrate status` nennt die fehlgeschlagene Migration samt Fehlermeldung. Ursache beheben, dann `tale migrate up` erneut ausführen; bereits erledigte Arbeit wird übersprungen.

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
- **Die 0.4.0-Baseline** — Versionen unter 0.4.0 und Versionen ab 0.4.0 sind getrennte Welten: kein Upgrade in keine Richtung, siehe den Cutover-Abschnitt unten.

Minor-Versionen zu überspringen (von 0.9 auf 0.11 zu gehen) ist unterstützt, solange die Zwischen-Migrationen noch im Binary sind; die Release-Notes nennen es, wenn das nicht der Fall ist. Die 0.4.0-Baseline ist der Dauerfall dieser Ausnahme: Prä-0.4-Migrationen stecken in keinem 0.4+-Binary.

Um bewusst eine Version _runter_ zu gehen — etwa wenn ein Minor-Release Ärger macht und du seine Migrationen schon zurückgenommen hast —, nagle das Ziel mit `tale update --version <version>` fest. Das Kommando warnt, wenn das Ziel älter als die laufende Version ist, und erinnert dich, zuerst die Daten-Migrationen zurückzunehmen. Ein Downgrade unter 0.4.0 kreuzt den Cutover rückwärts und ist nicht unterstützt: Ein 0.3.x-Release kann von 0.4+ erzeugte Daten nicht lesen — stelle einen Prä-0.4-Snapshot wieder her oder deploye 0.3.x frisch.

## 0.3 → 0.4: Breaking Cutover

0.4 hat das KI-Backend der Plattform — und damit das Datenmodell — von einer sauberen Baseline neu aufgebaut. Die versionierte Migrations-Historie wurde bei 0.4.0 zurückgesetzt: Kein 0.4+-Release trägt die Prä-0.4-Migrationen, also **lässt sich eine 0.3.x-Instanz nicht in-place upgraden — 0.4 verlangt ein frisches Deployment.**

**Was das praktisch heißt:**

- `tale deploy` mit einem 0.4+-CLI **verweigert** jede Instanz, deren laufende Version unter 0.4.0 liegt — bevor ein Image gezogen oder irgendetwas geschrieben wird. Der Container trägt dieselbe Wache beim Boot (Log-Marker `[migrations][breaking-cutover]`) für Stacks, die außerhalb des CLI verwaltet werden.
- Nichts aus einer 0.3-Instanz wird übernommen: Chats, Automationen samt Lauf-Historie, Wissenseinträge, Aufgaben-Historie, Benutzer und Anmeldungen. Dateien in einem BYO-S3-Bucket bleiben physisch im Bucket, aber die neue Instanz hat keine Referenzen darauf.
- Die 0.3.x-Linie bleibt für Sicherheits- und kritische Fixes auf dem Branch `release/0.3` gepflegt — eine Weile auf 0.3.x zu bleiben ist ein unterstützter Weg; der Wechsel auf 0.4 ist ein Re-Onboarding, kein Upgrade.

**Der Weg auf 0.4:**

```bash
# 1. Die 0.3-Instanz unangetastet lassen (sie bedient weiter).
# 2. Ein NEUES Projektverzeichnis mit einem 0.4-CLI anlegen:
mkdir tale-04 && cd tale-04
tale init
tale deploy

# 3. Re-Onboarding: Organisationen, Benutzer (Einladung / SSO),
#    Konfiguration, Dokumente und Wissen neu hochladen.
# 4. Die 0.3-Instanz stilllegen, sobald die neue abgenommen ist.
```

Der Experten-Override — `tale deploy --accept-data-loss` bzw. `TALE_ACCEPT_DATA_LOSS=1` am Container — existiert für den seltenen Fall, dass du bewusst einen Host wiederverwendest, dessen alte Volumes du bereits behandelt hast. Er tut genau, was sein Name sagt: Prä-0.4-Daten dieser Instanz werden dauerhaft unlesbar.

## Wo das hingehört

Der Upgrade-Flow knüpft jede andere Operate-Seite an — Backups sind das, was ein gescheitertes Upgrade wiederherstellbar macht, Observability ist das, was dir sagt, dass die neue Farbe healthy ist, Hardening ist das, was du nach einer Major-Version neu durchgehst. Setzt du das CLI zum ersten Mal auf, deckt [Tale-CLI installieren](/de/self-hosted/install/cli-install) das workstationseitige Setup ab; nimmst du den Pager mitten im Rollout auf, nennt [Troubleshooting](/de/self-hosted/operate/observability/troubleshooting) die Symptome.
