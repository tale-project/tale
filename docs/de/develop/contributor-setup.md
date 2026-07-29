---
title: Contributor-Setup
description: Die zentrale Quelle der Wahrheit für das Aufsetzen von Tales Quellcode zur lokalen Entwicklung — Voraussetzungen, bun install, der Pre-flight-Check, was bun run dev tut, Port-Konflikte und die Pre-PR-Checkliste.
---

Diese Seite ist für Contributors, die Tale aus dem Quellcode laufen lassen und eine Änderung zurückgeben wollen. Sie deckt die Voraussetzungen ab, das einmalige Setup, den Pre-flight-Check, der eine kaputte Maschine vor einem langen Boot erkennt, und was du von `bun run dev` erwarten kannst. Es ist nicht der Operator-Weg — willst du Tale benutzen statt verändern, installiert der [Self-hosted Quickstart](/de/self-hosted/install/quickstart) stattdessen den paketierten Stack mit der CLI.

Der Quellcode ist ein einziger Bun-Workspace, von Anfang bis Ende — der ganze Stack ist TypeScript, ohne Python und ohne einen zweiten Paketmanager zu installieren. Ein einziges `bun install` verdrahtet jeden Dienst, und `bun run dev` bootet die Plattform mit einem lokalen Convex-Backend, generierten Dev-Secrets und Vite — kein Cloud-Konto, keine von Hand editierte `.env`. Die Wissens-Arbeit, die früher in eigenständigen Diensten lebte (RAG-Suche, Dokument-Ingestion, Web-Crawling, Dokumentgenerierung), läuft jetzt im Convex-Backend, also gibt es dafür nichts Zusätzliches zu starten.

## Ein funktionierendes Setup von Anfang bis Ende

Der kürzeste Weg von einem frischen Klon zu einer laufenden App sind vier Befehle. Der Pre-flight-Check zwischen Install und Dev ist der, der dir ein verwirrendes Scheitern zehn Schichten tief erspart:

```bash
bun install            # jeden Workspace verdrahten
bun run setup:check    # Bun, die Dev-Ports und die Convex-CLI prüfen
bun run dev            # Convex + Vite booten (achte auf das READY-Banner)
```

Wenn `setup:check` durchweg grün ausgibt und `bun run dev` sein `READY`-Banner erreicht, ist deine Umgebung in Ordnung. Der Rest dieser Seite erklärt jedes Teil und was zu tun ist, wenn eines davon meckert.

## Voraussetzungen

Nur ein Tool muss auf deinem `PATH` liegen, bevor irgendetwas anderes passiert, denn der ganze Stack ist TypeScript auf einer einzigen Laufzeit:

- **Bun 1.3 oder höher** — die Workspace-Laufzeit und der Paketmanager. Installier es von [bun.sh](https://bun.sh/docs/installation) und bestätige mit `bun --version`. Alles andere, was der Quellcode braucht (die Convex-CLI, jede Dienst-Abhängigkeit), löst `bun install` auf.

Für die lokale Entwicklung mit `bun run dev` brauchst du kein Docker — es spawnt Convex direkt auf deiner Maschine. Docker kommt nur für den containerisierten Hybrid-Modus weiter unten und für die Operator-Installation ins Spiel.

## Installation und Pre-flight

Ein einziges Install deckt jeden Workspace ab, denn das Repo ist ein Bun-Workspace-Graph:

```bash
bun install
```

Vor dem ersten `bun run dev` lauf den Pre-flight-Check. Er prüft deine Bun-Version, dass die Ports 3000 und 3210 frei sind und dass die Convex-CLI erreichbar ist — und gibt für alles Fehlende die exakte Korrektur aus, sodass du keine falsche Bun-Version mitten in einem Cold-Boot entdeckst:

```bash
bun run setup:check
```

Jede fehlschlagende Zeile trägt ihre Korrektur: ein `bun upgrade` für ein altes Bun, ein `lsof`/`kill`-Paar für einen belegten Port. Ein sauberer Lauf endet mit Null und sagt dir, dass du mit `bun run dev` weitermachen kannst.

## Was `bun run dev` tut

`bun run dev` ist der Entwicklungs-Orchestrator. Er lädt deine `.env`-Dateien, generiert unsichere lokale Defaults für jedes Secret, das du nicht gesetzt hast, spawnt ein lokales Convex-Backend im Anonymous-Modus, synct das Environment hinein, führt Convex-Codegen aus, wartet, bis die Auth-Routen antworten, und startet dann Vite. Die Plattform ist der langsamste Server beim Hochkommen, weil sie auf Convex wartet, also dauert ein Cold-Start 30 bis 90 Sekunden.

Bis der Orchestrator sein `READY`-Banner ausgibt, ist es erwartet und kein Fehler, dass die App auf `http://localhost:3000` Verbindungen ablehnt — Vite hat den Port noch nicht gebunden. Siehst du das Banner, ist die App erreichbar und die Auth gesund. Stopp den ganzen Stack mit `Ctrl-C`; er fährt sowohl Convex als auch Vite sauber herunter.

Der Dev-Orchestrator generiert alles, was er braucht, also ist eine lokale Kopie von `.env.example` für die lokale Entwicklung optional — die unsicheren Defaults (`INSTANCE_SECRET`, `BETTER_AUTH_SECRET`, der WebDAV-HMAC-Key) werden beim Boot gefüllt und als Warnungen ausgegeben. Setz echte Werte in `services/platform/.env.local` nur, wenn du produktionsförmiges Verhalten brauchst oder einen Default überschreiben willst.

## Wenn ein Port belegt ist

`bun run dev` bindet zwei Ports: 3000 für die Vite-App und 3210 für das lokale Convex-Backend. Es scheitert sofort mit einer umsetzbaren Meldung, wenn einer belegt ist, denn ein stiller Fallback auf einen anderen Port würde den Convex-Proxy und jeden `localhost:3000`-Link brechen. Der übliche Verursacher ist ein vorheriges `bun run dev` oder `tale dev`, das nicht vollständig beendet wurde.

Gib den Port frei und lauf erneut. Der Befehl, der den Halter findet und stoppt, ist derselbe, den `setup:check` und der Orchestrator vorschlagen:

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN   # die PID zeigen, die den App-Port hält
kill <PID>                         # sie stoppen
```

Um die App stattdessen auf einem anderen Port laufen zu lassen, setz `PORT`: `PORT=3005 bun run dev`. Gerät das Convex-Deployment nach der automatischen Wartung in einen schlechten Zustand — veraltetes Schema nach abgebrochener Migration, korrupte lokale SQLite-Datei — siehe [Lokale Convex-Dev-Daten zurücksetzen](#lokale-convex-dev-daten-zurücksetzen) unten; lösch `.convex/local/` nicht beiläufig.

## Wartung des lokalen Convex-Speichers

Jeder `convex dev`-Push legt ein neues Function-Bundle unter `services/platform/.convex/local/default/convex_local_storage/modules/` ab. Die Convex-CLI räumt alte Blobs lokal nie auf — nach Monaten täglicher Entwicklung können Zehntausende Dateien (10+ GB) entstehen, und Cold Starts scheitern im 30-Sekunden-Fenster der CLI.

`bun run dev` führt Wartung automatisch aus, bevor Convex startet:

- **Prune**, wenn der Modul-Speicher 1.500 Blobs oder 2 GB überschreitet — löscht nur unreferenzierte historische Function-Bundle-Blobs unter `convex_local_storage/modules/` und behält jedes Blob, das das aktuelle Deployment noch lädt (Modul-Source-Packages und ihre Node-`externalPackageId`-Deps-Parents, plus bis zu 1.000 neueste unreferenzierte Reste). SQLite-Datenbank, Uploads und Org-Konfig bleiben unberührt. Lassen sich die Live-Referenzen nicht lesen, oder wirken sie leer obwohl noch Blobs auf der Platte liegen, wird der Prune übersprungen statt zu raten.
- **Integritätsprüfung** — fehlt ein Live-Modul-Blob schon auf der Platte, stoppt `bun run dev` mit einem klaren Fehler und verweist auf `setup:clean`. Weitermachen würde ein halb totes Backend starten (Chat und Crons scheitern mit undurchsichtigen Serverfehlern).
- **Snapshot-Export-Artefakte löschen**, wenn die gecachte Convex-Backend-Version nicht mehr zur lokalen Deployment-Konfiguration passt — entfernt `export.zip` und Import/Export-Reste, die einen fehlgeschlagenen Re-Import auslösen können, ohne Dev-Daten zu löschen.

Setz `TALE_DEV_SKIP_CONVEX_MAINTENANCE=1`, um Prune/Snapshot-Cleanup zu deaktivieren (die Integritätsprüfung läuft weiter). `bun run setup:check` warnt (nicht blockierend), wenn der Modul-Speicher den Prune-Schwellenwert schon überschreitet.

## Lokale Convex-Dev-Daten zurücksetzen

Nur als letzter Ausweg — `bun run setup:clean` löscht **alle** lokalen Convex-Dev-Daten: jede Tabelle in der lokalen SQLite-Datei, jeden Upload in `convex_local_storage/files/` und jedes Function-Bundle. Org-Konfig auf der Platte und `.env.local` bleiben unberührt.

**Über die 0.4-Baseline wechseln:** Lokale Dev-Daten und Per-Org-Konfigbäume aus Prä-0.4-Checkouts haben keinen Migrationspfad — der 0.4-Baseline-Reset hat die Migrations-Historie geleert, und auch der Export/Import-Roundtrip unten überbrückt das nicht (der alte Export passt nicht zum neuen Schema). Eine Dev-Maschine über die Baseline zu bewegen heißt: lokale Convex-Daten zurücksetzen und die Dev-Orgs neu anlegen; behandle Prä-0.4-Org-Verzeichnisse unter `$TALE_CONFIG_DIR` genauso.

**Behalte deine Daten über den Reset hinweg.** Selbst wenn das Integritäts-Gate anschlägt (ein Bundle eines Live-Moduls fehlt), startet das Backend selbst noch — du kannst deine Daten also vorher exportieren und danach wiederherstellen, und der Reset verliert nichts:

```bash
# 1. Backend starten (umgeht das Integritäts-Gate von `bun run dev`), dann
#    in einem zweiten Terminal exportieren:
bun run --filter @tale/platform convex:dev
cd services/platform && npx convex export --path convex-backup.zip

# 2. Zurücksetzen (abgesichert — siehe unten), frisches Deployment
#    bootstrappen, dann wiederherstellen:
bun run setup:clean            # tippe: delete local convex
bun run dev                    # auf das READY-Banner warten
cd services/platform && npx convex import --replace-all convex-backup.zip
```

`bun run setup:clean` ist absichtlich abgesichert (Coding-Agenten dürfen es nicht laufen lassen, es sei denn, du hast ausdrücklich darum gebeten):

1. Selbst im Terminal ausführen — nicht über einen Agenten.
2. Beim Prompt die exakte Phrase `delete local convex` tippen (ein bloßes `y` wird abgelehnt).
3. Nicht-interaktive Läufe (CI) brauchen `TALE_CONFIRM_DESTROY_LOCAL_CONVEX=delete-local-convex` — in Agent-Shells nie setzen.

Probier zuerst automatische Wartung und normales `bun run dev`. Musst du doch zurücksetzen, **exportiere vorher** (siehe oben), um deine Daten zu behalten — lass den Export nur weg, wenn du die lokalen Conversations, Uploads und den übrigen Anonymous-Deployment-Zustand wirklich nicht brauchst.

## Hybrid-Modus gegen ein containerisiertes Convex

`bun run dev` spawnt standardmäßig ein ephemeres Convex-Backend, was für die meiste Arbeit das Richtige ist. Willst du schnelle Vite-Reloads gegen ein stabiles Convex, das Produktion spiegelt, fahr den dedizierten `convex`-Container und richte Vite stattdessen auf ihn:

```bash
docker compose up convex                 # ein Terminal: das stabile Backend
CONVEX_EXTERNAL=true bun run dev          # ein anderes: Vite gegen den Container
```

Setz `CONVEX_URL`, wenn dein Container Convex auf einem Nicht-Standard-Host oder -Port bereitstellt. Das ist der einzige lokale Dev-Weg, der Docker braucht, und er ist optional — das ephemere Default-Backend braucht nichts außer den drei Voraussetzungen.

## Bevor du einen PR öffnest

Jeder PR läuft durch ein Gate: `bun run check`, also Format, Lint, Typecheck und die volle Testsuite über jeden berührten Workspace. Ein grüner Lauf ist das Merge-Signal; ein roter blockiert. Die Pre-PR-Checkliste in [`AGENTS.md`](https://github.com/tale-project/tale/blob/main/AGENTS.md) listet den Rest — Docs und Übersetzungen kommen im selben PR wie der Code, der sie geändert hat.

Berührt deine Änderung `services/docs/`, lauf auch das Docs-Gate (`bun run --filter @tale/docs test`), damit strukturelle Parität, Terminologie und Prosa-Checks vor dem Review passen. Alles, was ein Nutzer sehen, konfigurieren oder aufrufen kann, braucht seine Docs in allen drei Basis-Locales im selben Commit aktualisiert.

## Wo das hingehört

Contributor-Setup ist der Boden, auf dem jede andere Entwickler-Aufgabe steht: bring die Voraussetzungen an ihren Platz, lass `setup:check` die Maschine bestätigen, und `bun run dev` gibt dir die ganze Plattform mit einem lokalen Backend in unter zwei Minuten, sobald die Images warm sind. Der Pre-flight-Check und die Port-Korrektur existieren, weil die häufigsten First-Run-Fehler eine falsche Tool-Version oder ein zurückgebliebener Prozess sind, der einen Port hält — beides Fünf-Sekunden-Korrekturen, sobald du sie sehen kannst.

Läuft der Stack erst, rahmt die [Develop-Übersicht](/de/develop/overview) die externe Oberfläche, gegen die du baust, und [KI-gestützte Entwicklung](/de/develop/ai-assisted-development) deckt das Nutzen von Tales eigenen Agents zum Schreiben von Tale-Konfigurationen ab. Trägst du eine Container-Änderung statt einer Quellcode-Änderung bei, ist [Mitwirken](/de/self-hosted/contributing-docker) unter dem Reiter Selbst gehostet der Build-and-Test-Spaziergang für diesen Weg.
