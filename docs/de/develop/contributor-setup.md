---
title: Contributor-Setup
description: Die zentrale Quelle der Wahrheit für das Aufsetzen von Tales Quellcode zur lokalen Entwicklung — Voraussetzungen, bun install, der Pre-flight-Check, was bun run dev tut, Port-Konflikte und die Pre-PR-Checkliste.
---

Diese Seite ist für Contributors, die Tale aus dem Quellcode laufen lassen und eine Änderung zurückgeben wollen. Sie deckt die Voraussetzungen ab, das einmalige Setup, den Pre-flight-Check, der eine kaputte Maschine vor einem langen Boot erkennt, und was du von `bun run dev` erwarten kannst. Es ist nicht der Operator-Weg — willst du Tale benutzen statt verändern, installiert der [Self-hosted Quickstart](/de/self-hosted/install/quickstart) stattdessen den paketierten Stack mit der CLI.

Der Quellcode ist ein einziger Bun-Workspace, von Anfang bis Ende — der ganze Stack ist TypeScript, ohne Python und ohne einen zweiten Paketmanager zu installieren. Ein einziges `bun install` verdrahtet jeden Dienst, und `bun run dev` startet die Backing-Container, das Platform-Backend und Vite mit generierten Dev-Secrets — kein Cloud-Konto, keine von Hand editierte `.env`. Die Wissens-Arbeit, die früher in eigenständigen Diensten lebte (RAG-Suche, Dokument-Ingestion, Web-Crawling, Dokumentgenerierung), läuft im Backend, also gibt es dafür nichts Zusätzliches zu starten.

## Ein funktionierendes Setup von Anfang bis Ende

Der kürzeste Weg von einem frischen Klon zu einer laufenden App sind drei Befehle. Der Pre-flight-Check zwischen Install und Dev ist der, der dir ein verwirrendes Scheitern zehn Schichten tief erspart:

```bash
bun install            # jeden Workspace verdrahten
bun run setup:check    # Bun und die Dev-Ports prüfen
bun run dev            # den Stack booten (auf das READY-Banner warten)
```

Wenn `setup:check` alles grün meldet und `bun run dev` sein `READY`-Banner erreicht, ist deine Umgebung in Ordnung. Der Rest dieser Seite erklärt jedes Teilstück und was zu tun ist, wenn eines davon meckert.

## Voraussetzungen

Zwei Dinge müssen auf deiner Maschine sein, weil der ganze Stack TypeScript auf einer einzigen Runtime ist — plus eine echte Datenbank:

- **Bun 1.3 oder höher** — die Workspace-Runtime und der Paketmanager. Installier es von [bun.sh](https://bun.sh/docs/installation) und bestätige mit `bun --version`. Jede Service-Abhängigkeit löst `bun install` auf.
- **Docker** — `bun run dev` lässt das Backend auf deinem Host laufen, seine Backing-Services aber in Containern: Postgres (die App-Datenbank), ParadeDB (der Wissens-Korpus), das LLM-Gateway und die Sandbox-Ebene. Docker Desktop oder irgendein Daemon, auf den der Docker-Context deiner Shell zeigt, genügt.

## Install und Pre-flight

Ein einziges Install deckt jeden Workspace ab, weil das Repo ein einziger Bun-Workspace-Graph ist:

```bash
bun install
```

Vor dem ersten `bun run dev` lauf den Pre-flight-Check. Er prüft deine Bun-Version und ob die Ports 3000 und 3005 frei sind — und druckt für alles Fehlende die exakte Behebung, damit du eine falsche Bun-Version nicht erst mitten in einem Kaltstart entdeckst:

```bash
bun run setup:check
```

Jede fehlschlagende Zeile trägt ihre Behebung: ein `bun upgrade` für ein altes Bun, ein `lsof`/`kill`-Paar für einen belegten Port. Ein sauberer Lauf endet mit Exit-Code 0 und sagt dir, dass du mit `bun run dev` weitermachen kannst.

## Was `bun run dev` tut

`bun run dev` ist der Entwicklungs-Orchestrator. Er lädt deine `.env`-Dateien, generiert unsichere lokale Defaults für jedes nicht gesetzte Secret, fährt die Docker-Backing-Services hoch und startet dann das **Platform-Backend** — denselben `backend/main.ts`-Einstieg, den auch der Container fährt, in der kombinierten Rolle `all` (HTTP-API und Job-Worker in einem Prozess) — und wartet, bis es seinen Port bindet. Vite startet zuletzt und proxied `/api`, `/events`, `/dav` und `/scim` dorthin. Ein Kaltstart dauert 20 bis 60 Sekunden, ein warmer deutlich weniger.

Das Backend wendet seine Datenbank-Migrationen beim Start selbst an, unter einem Advisory Lock — ein frischer Klon bekommt also ohne Extraschritt eine vollständig migrierte Datenbank. Eine Health-Probe überwacht es: Antwortet es nicht mehr, startet der Orchestrator es bis zu einem Limit neu und sagt dir, wenn er aufgibt.

Bis der Orchestrator sein `READY`-Banner druckt, ist eine abgelehnte Verbindung auf `http://localhost:3000` erwartet und kein Fehler — Vite hat den Port noch nicht gebunden. Beim Banner ist die App erreichbar und die Authentifizierung gesund. Stopp den ganzen Stack mit `Ctrl-C`; er fährt Backend und Vite sauber herunter.

Der Dev-Orchestrator generiert alles, was er braucht, eine lokale `.env.example`-Kopie ist für lokale Entwicklung also optional — die unsicheren Defaults (`INSTANCE_SECRET`, `BETTER_AUTH_SECRET`, der WebDAV-HMAC-Key) werden beim Boot gefüllt und als Warnungen gedruckt. Setz echte Werte in `services/platform/.env.local` nur, wenn du produktionsnahes Verhalten brauchst oder einen Default überschreiben willst.

Laufen die Container schon, oder willst du nur an Frontend-Code arbeiten? `bun run dev:fast` (`TALE_DEV_SKIP_DOCKER=1`) überspringt die Docker-Bring-up und geht direkt zu Backend und Vite.

## Ein einsatzbereiter Dev-Login

Ein frischer Stack seedet ein Owner-Konto, damit du vor dem Testen nicht durch den `/setup`-Wizard musst: `dev@tale.test` / `TaleDev!Passw0rd`, Owner einer aufgesetzten Organisation "Dev Workspace". Der Seeder ist idempotent (er läuft bei jedem Boot und tut nichts, wenn das Konto schon existiert) und weigert sich zu laufen, wenn `SITE_URL` kein Loopback-Host ist — ein bekanntes Passwort auf einem erreichbaren Hostnamen wäre eine Konto-Übernahme, keine Bequemlichkeit. Abwählen mit `TALE_DEV_SEED_USER=0`, Identität überschreiben mit `TALE_DEV_SEED_USER_EMAIL` / `TALE_DEV_SEED_USER_PASSWORD`.

## Wenn ein Port belegt ist

`bun run dev` bindet zwei Ports: 3000 für die Vite-App und 3005 für das Backend. Es scheitert schnell mit einer umsetzbaren Meldung, wenn einer belegt ist, denn ein stiller Fallback auf einen anderen Port würde den Vite-Proxy und jeden `localhost:3000`-Link brechen. Meist ist ein früheres `bun run dev` oder `tale dev` schuld, das nicht vollständig beendet wurde.

Gib den Port frei und starte neu. Der Befehl, der den Halter findet und stoppt, ist derselbe, den `setup:check` und der Orchestrator vorschlagen:

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN   # die PID zeigen, die den App-Port hält
kill <PID>                         # sie stoppen
```

## Lokale Dev-Daten zurücksetzen

Lokaler Dev-Zustand liegt in den Docker-Volumes der Backing-Services, ein Reset ist also ein Compose-Befehl statt eines eigenen Skripts:

```bash
docker compose -f compose.yml -f compose.dev.yml down -v db knowledge-db
```

Das zerstört die lokalen Datenbanken — jede Organisation, Konversation und hochgeladene Datei in deinem Dev-Stack. Org-Config-Bäume auf der Platte (`$TALE_CONFIG_DIR`) und `.env.local` bleiben unangetastet. Das nächste `bun run dev` migriert von leer neu und seedet den Dev-Login wieder.

## Hybrid-Modus gegen ein containerisiertes Backend

`bun run dev` lässt das Backend auf deinem Host laufen, was für die meiste Arbeit richtig ist. Um Vite auf ein Backend zeigen zu lassen, das woanders läuft — ein Container oder der Stack einer Kollegin — setz `TALE_BACKEND_URL`:

```bash
TALE_BACKEND_URL=http://localhost:3105 bun run dev:fast
```

Vite proxied jede Backend-Lane dorthin, und der Orchestrator wartet auf diese URL, statt ein eigenes Kind zu starten.

## Bevor du einen PR aufmachst

Jeder PR läuft durch ein Gate: `bun run check` — Format, Lint, Typecheck und die volle Test-Suite über jeden berührten Workspace. Ein grüner Lauf ist das Merge-Signal, ein roter blockiert. Die Pre-PR-Checkliste in [`AGENTS.md`](https://github.com/tale-project/tale/blob/main/AGENTS.md) listet den Rest — Docs und Übersetzungen gehen im selben PR raus wie der Code, der sie geändert hat.

Berührt deine Änderung `services/docs/`, lauf auch das Docs-Gate (`bun run --filter @tale/docs test`), damit strukturelle Parität, Terminologie und Prosa-Checks vor dem Review passen. Alles, was ein Nutzer sehen, konfigurieren oder aufrufen kann, braucht seine Docs in allen drei Basis-Locales im selben Commit.

## Wo das hingehört

Contributor-Setup ist der Boden, auf dem jede andere Entwickleraufgabe steht: Voraussetzungen hinstellen, `setup:check` die Maschine bestätigen lassen, und `bun run dev` gibt dir die ganze Plattform in unter zwei Minuten, sobald die Images warm sind. Der Pre-flight-Check und die Port-Behebung existieren, weil die häufigsten Erstlauf-Fehler eine falsche Tool-Version oder ein übrig gebliebener Prozess auf einem Port sind — beides Fünf-Sekunden-Fixes, sobald man sie sieht.

Sobald der Stack läuft, rahmt die [Develop-Übersicht](/de/develop/overview) die externe Oberfläche ein, gegen die du baust, und [KI-gestützte Entwicklung](/de/develop/ai-assisted-development) deckt ab, wie du Tales eigene Agenten zum Schreiben von Tale-Configs nutzt. Trägst du eine Container-Änderung statt einer Quellcode-Änderung bei, ist [Contributing](/de/self-hosted/contributing-docker) unter dem Self-hosted-Tab der Build-and-Test-Weg dafür.
