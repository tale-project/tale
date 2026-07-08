<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/assets/logo-dark.svg">
  <img alt="Tale" src=".github/assets/logo-light.svg" width="150">
</picture>

### Der Orchestrator für KI-Agents

Verbinde **OpenClaw**, **Hermes Agent**, **Claude Code**, **Codex**, **Cursor**, **Gemini CLI**, **OpenCode** und **Pi**.<br/>
Bündle ihr Wissen, delegiere Aufgaben und bau deinen Schwarm aus Agents.

[![Lizenz: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Docs](https://img.shields.io/badge/docs-tale-0a0a0a.svg)](https://tale.dev/docs/de)
[![Self-hosted](https://img.shields.io/badge/self--hosted-Docker-2496ed.svg)](https://tale.dev/docs/de/self-hosted/install/quickstart)

[Schnellstart](#schnellstart) · [Was kannst du tun?](#was-kannst-du-tun) · [Befehle](#befehlsreferenz) · [Dokumentation](#dokumentation) · [Mitwirken](#mitwirken)

**Lies das auf:** [English](README.md) · [Deutsch](README.de.md) · [Français](README.fr.md)

</div>

---

Tale ist eine **selbstgehostete KI-Plattform**, die die Agents und CLIs, die dein Team bereits nutzt, zu einer koordinierten Belegschaft verbindet. Gib ihnen eine gemeinsame Wissensdatenbank, binde deine Tools und Integrationen an und delegiere Arbeit über sie hinweg — Agents, Workflows und ein gemeinsamer Posteingang, alles auf deiner eigenen Infrastruktur. Installiere die CLI, dann reichen zwei Befehle zum Start.

**Wähl deinen Weg:**

- **Tale lokal ausprobieren** — installier die CLI und lauf zwei Befehle auf deiner eigenen Maschine. Beginn mit [Schnellstart](#schnellstart) unten.
- **Tale Cloud nutzen** — lass Tale den Stack betreiben, melde dich an und bring dein Team an Bord. Beginn mit [Cloud-Onboarding](https://tale.dev/docs/de/cloud/onboarding).
- **Mitwirken** — lass Tale aus dem Quellcode laufen und gib eine Änderung zurück. Beginn mit [Contributor-Setup](docs/de/develop/contributor-setup.md).

## Schnellstart

Bring Tale auf deine Maschine — CLI installieren, dann zwei Befehle: Projekt anlegen, starten. Die CLI installiert Docker, falls es fehlt, und generiert jedes Secret für dich, sodass nichts vorab einzurichten und nichts von Hand zu editieren ist.

**Voraussetzungen für einen lokalen Test: keine.** Der Installer richtet Docker für dich ein, und `tale init` generiert jedes Secret — du musst nichts mitbringen, um den Stack hochzubekommen. Ein [OpenRouter-API-Key](https://openrouter.ai) (oder ein beliebiger OpenAI-kompatibler Anbieter) ist optional und erst nötig, bevor ein Agent antworten kann: du fügst ihn in der App nach der Anmeldung hinzu, im Einrichtungsassistenten oder unter **Einstellungen → KI-Anbieter**. `tale init` fragt nicht danach.

> **Windows mit Hyper-V-Backend:** Stelle sicher, dass dein Projekt-Laufwerk in den Docker-Desktop-Einstellungen unter Resources > File Sharing freigegeben ist. Das WSL2-Backend (Standard) braucht keine zusätzliche Konfiguration.

### 1. Die CLI installieren

**Linux / macOS:**

```bash
curl -fsSL https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh | bash
```

**Windows (PowerShell):**

```powershell
irm https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.ps1 | iex
```

### 2. Ein Projekt anlegen

```bash
tale init my-project
cd my-project
```

`tale init` schreibt localhost-Defaults mit selbstsigniertem Zertifikat und generiert jedes Sicherheits-Secret — die Domain wählst du später, bei `tale deploy`. Es fragt einmal, ob Agents in ihren Sandboxes Docker ausführen dürfen (Standard: nein), legt Beispiel-Configs unter `default/` ab und schreibt `AGENTS.md` plus einen `CLAUDE.md`-Verweis; der Plattform-Quellcode liegt entpackt in `.tale/reference/`, damit KI-Editoren Configs mit voller Plattform-Kenntnis erstellen und ändern können. Dasselbe Projekt funktioniert für einen lokalen Test und ein echtes Deployment.

### 3. Tale starten

```bash
tale dev
```

Sobald "Tale is running" erscheint, öffnet `tale dev` https://localhost (oder deine konfigurierte Domain) in deinem Browser — kann es das nicht, gibt es die URL zum Besuchen aus.

> **Hinweis:** Dein Browser zeigt eine Zertifikatswarnung für selbstsignierte Zertifikate. Die ist sicher zu akzeptieren.

Eine ausführliche Einrichtungsanleitung findest du im [Self-hosted-Quickstart](https://tale.dev/docs/de/self-hosted/install/quickstart).

## Was kannst du tun?

| Ziel                           | Wie                                                                                                                   |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| **Eigene Agents bauen**        | JSON-Dateien in `agents/` bearbeiten — Anweisungen, Tools und Modelle definieren                                      |
| **Workflows bauen**            | JSON-Dateien in `workflows/` bearbeiten — Trigger, Bedingungen, Schleifen, KI-Schritte                                |
| **Integrationen hinzufügen**   | Dateien in `integrations/` bearbeiten — REST-APIs, SQL-Datenbanken, eigene Konnektoren                                |
| **Configs mit KI bauen**       | Projekt in deinem KI-Editor öffnen — `AGENTS.md` und `.tale/reference/` tragen die Schemas                            |
| **Mit KI-Assistenten chatten** | Direkt in der Plattform — sofort einsatzbereit                                                                        |
| **Wissensdatenbank aufbauen**  | Dokumente hochladen, Websites crawlen, Produkte und Kunden verwalten                                                  |
| **Kunden-E-Mails beantworten** | E-Mail-Automatisierung installieren (Gmail, Outlook, IMAP/SMTP) — gemeinsamer Posteingang mit KI-gestützten Antworten |
| **Backend-Daten ansehen**      | `tale convex admin` ausführen und das Convex Dashboard öffnen                                                         |

Alle Dateien in `agents/`, `workflows/` und `integrations/` werden live neu geladen — bearbeiten und Änderungen sofort sehen.

## Befehlsreferenz

### Entwicklung

```bash
tale init [directory]              # Neues Projekt mit Beispiel-Configs anlegen (kein Docker nötig)
tale dev                           # Alle Dienste lokal starten
tale dev --detach                  # Im Hintergrund starten
tale dev --port 8443               # Eigenen HTTPS-Port nutzen
tale update                        # CLI aktualisieren + Projektdateien synchronisieren (danach `tale deploy`; die CLI gleicht sich automatisch an)
tale convex admin                  # Convex-Dashboard-Admin-Key generieren
tale config                        # CLI-Konfiguration verwalten
```

### Produktion

```bash
tale deploy                        # Blue-Green-Zero-Downtime-Deployment der aktuellen CLI-Version
tale status                        # Deployment-Status anzeigen
tale logs <service>                # Logs eines Dienstes ansehen
tale logs platform -f              # Log-Ausgabe live folgen
tale backup                        # Alle Daten-Volumes snapshotten
tale restore                       # Snapshots auflisten / einen wiederherstellen (gestoppter Stack)
tale rollback                      # Auf die vorherige Patch-Version zurückrollen
tale cleanup                       # Inaktive Container entfernen
tale reset --force                 # Alle Container entfernen
```

In der [CLI-Referenz](tools/cli/README.md) findest du alle Optionen und Flags. Eine bestehende Installation aktualisierst du mit zwei Befehlen: `tale update` hebt die CLI und deine Projektdateien auf die neue Version, `tale deploy` rollt danach die Container. Das vollständige Runbook findest du in [Self-hosted Upgrades](https://tale.dev/docs/de/self-hosted/operate/upgrades).

## In Produktion deployen

```bash
tale deploy
```

Die CLI macht Blue-Green-Zero-Downtime-Deployments mit automatischen Health-Checks und Rollback. Für die volle Produktions-Einrichtung inkl. Reverse-Proxy-Konfiguration und Subpath-Deployment siehe den [Produktions-Deployment-Guide](https://tale.dev/docs/de/self-hosted/install/linux-server).

## Authentifizierungs-Optionen

Tale nutzt standardmässig passwortbasierte Authentifizierung. Der erste User legt das Owner-Konto an; alle weiteren werden vom Admin angelegt. Für Self-Service-Login verbindest du SSO oder Trusted Headers über Microsoft Entra ID — siehe die [Integrationen-Übersicht](https://tale.dev/docs/de/platform/integrations/overview) für den Microsoft-365-Connector, der sowohl Dokumentensynchronisation als auch SSO bedient.

- **Microsoft Entra ID (SSO):** Single Sign-On mit Microsoft 365 / Azure AD inkl. automatischem Provisioning
- **Trusted Headers:** Für Deployments hinter einem authentifizierenden Reverse-Proxy (Authelia, Authentik, oauth2-proxy)

## Entwicklung

Für lokale Entwicklung (ohne Docker):

### Voraussetzungen

- **Bun**: 1.3.x oder höher ([Installationsanleitung](https://bun.sh/docs/installation))
- **Python**: 3.12.x (für die mitgelieferten Python-Skill-Skripte, z. B. den PPTX-Skill)
- **uv**: Python-Paketmanager ([Installationsanleitung](https://github.com/astral-sh/uv))

### Entwicklungs-Befehle

```bash
bun install                      # Abhängigkeiten installieren
bun run dev                      # Entwicklungs-Server starten (spawnt lokales Convex)
bun run typecheck                # Typprüfung
bun run lint                     # Linting
bun run test                     # Tests laufen lassen
bun run build                    # Alle Dienste bauen
```

#### Optional: Hybrid-Modus gegen ein containerisiertes Convex

Du kannst Vite lokal gegen den dedizierten `convex`-Container laufen lassen, statt `bunx convex dev` zu spawnen:

```bash
docker compose up convex                        # in einem Terminal
CONVEX_EXTERNAL=true bun run dev                # in einem zweiten (CONVEX_URL optional)
```

Praktisch, wenn du schnelle Vite-Reloads willst, aber ein stabiles Convex-Backend, das die Produktion spiegelt. Setze `CONVEX_URL`, falls dein Container Convex auf einem nicht-Standard-Host/-Port exponiert.

### Bekannte Probleme

- **xlsx-Sicherheitslücke**: Das Projekt nutzt xlsx@0.18.5 mit bekannten Sicherheitslücken (Prototype Pollution und ReDoS). Das ist die aktuell verfügbare Version; ein Fix ist noch nicht veröffentlicht. Das Paket wird zum Parsen von Excel-Dateien im Documents-Feature genutzt.
- **ENVIRONMENT_FALLBACK-Warnung**: Beim Platform-Build kann ein `ENVIRONMENT_FALLBACK`-Fehler erscheinen. Eine Convex-spezifische Warnung — der Build läuft trotzdem erfolgreich durch.

## Dokumentation

Doku-Seite und Plattform-UI laufen in drei Basis-Sprachen (`en`, `de`, `fr`) plus regionalen Varianten, wo lokale Formulierungen abweichen (heute: `de-CH`; der Loader erkennt jedes neue `xx-YY`-Bundle automatisch). Varianten tragen nur die Strings, die von ihrer Basis abweichen; fehlende Keys fallen über die Basis bis auf Englisch zurück. Start unter [tale.dev/docs/de](https://tale.dev/docs/de), um nach Persona einzusteigen (Quelle: [`docs/de/index.md`](docs/de/index.md)).

<details>
<summary><strong>Für alltägliche Nutzer</strong></summary>

- **[Chat-Übersicht](https://tale.dev/docs/de/platform/chat/overview)** — die vier Bereiche des Bildschirms, wo es tiefer geht
- **[KI-Chat-Grundlagen](https://tale.dev/docs/de/platform/chat/basics)** — Composer, Agents, Modell-Picker, Streaming, Zitate
- **[Tiefenrecherche](https://tale.dev/docs/de/platform/chat/deep-research)** — der Researcher-Agent mit Live-Plan und PDF-Bericht
- **[Anhänge](https://tale.dev/docs/de/platform/chat/attachments)** — Dateien im Chat, RAG vs wörtlich
- **[Geteilte Chats](https://tale.dev/docs/de/platform/chat/shared-threads)** — Chat per Link mit der Org teilen, in einen eigenen forken
- **[Genehmigungen](https://tale.dev/docs/de/platform/approvals/concepts)** — KI-Aktionen prüfen

</details>

<details>
<summary><strong>Für Bauende (Agents, Workflows, Integrationen)</strong></summary>

- **[Agent-Konzepte](https://tale.dev/docs/de/platform/agents/concepts)** — das Vier-Knöpfe-Modell hinter jedem Agent
- **[Einen Agent erstellen](https://tale.dev/docs/de/platform/agents/create)** — spezialisierte KI-Assistenten von Anfang bis Ende
- **[Agent-Tools](https://tale.dev/docs/de/platform/agents/tools)** — die eingebauten Tool-Familien
- **[Projekte](https://tale.dev/docs/de/platform/projects/overview)** — geteilter Workspace für Dateien, Chats und Projekt-Agents
- **[Workflow-Konzepte](https://tale.dev/docs/de/platform/workflows/concepts)** — Definitionen, Trigger, Genehmigungstore
- **[Integrationen-Übersicht](https://tale.dev/docs/de/platform/integrations/overview)** — Slack, Teams, Gmail, Outlook, Microsoft 365, Google Drive, Confluence, WebDAV, GitHub, Shopify, Tavily, MCP
- **[Modelle out of the box](https://tale.dev/docs/de/platform/models)** — OpenRouter als einziger Default-Provider, plus die ausgelieferten Modelllisten

</details>

<details>
<summary><strong>Für Admins</strong></summary>

- **[Mitglieder und Rollen](https://tale.dev/docs/de/platform/admin/members-and-roles)** — Userverwaltung und Berechtigungs-Matrix
- **[Modelle out of the box](https://tale.dev/docs/de/platform/models)** — welche Modelle die Defaults mitbringen; Provider tauschen oder hinzufügen
- **[Integrationen-Übersicht](https://tale.dev/docs/de/platform/integrations/overview)** — Drittanbieter-Konnektoren, MCP-Server, eigene Konfigurationen
- **[Cloud-Trust und Compliance](https://tale.dev/docs/de/cloud/trust-and-compliance)** — Frameworks, geteilte Verantwortung, Belege für Auditoren

</details>

<details>
<summary><strong>Für Operators</strong></summary>

- **[Self-hosted-Übersicht](https://tale.dev/docs/de/self-hosted/overview)** — Architektur und Dienste
- **[Quickstart](https://tale.dev/docs/de/self-hosted/install/quickstart)** — Single-Host-Installation in zwanzig Minuten
- **[Produktions-Deployment](https://tale.dev/docs/de/self-hosted/install/linux-server)** — Linux-Server mit TLS, Firewall, Non-Root-User
- **[Docker-Compose-Referenz](https://tale.dev/docs/de/self-hosted/install/docker-compose-reference)** — Basis-Datei und Overlays
- **[Tale CLI](tools/cli/README.md)** — CLI-Referenz
- **[Environment-Referenz](https://tale.dev/docs/de/self-hosted/configuration/environment-reference)** — alle Environment-Variablen
- **[Container-Architektur](https://tale.dev/docs/de/self-hosted/operate/container-architecture)** — sieben Container, was was besitzt

</details>

<details>
<summary><strong>Für Developer</strong></summary>

- **[API-Referenz](https://tale.dev/docs/de/develop/api-reference)** — REST-API für Agenten, Chat, Wissen und Workflows
- **[Webhooks](https://tale.dev/docs/de/develop/webhooks)** — Workflow- und Agent-Webhooks mit Signaturprüfung
- **[Develop-Übersicht](https://tale.dev/docs/de/develop/overview)** — die Entwickler-Oberfläche von Anfang bis Ende

</details>

## Brauchst du Hilfe?

- **Logs**: `tale logs <service>` für Dienst-Logs
- **Health-Checks**: `{SITE_URL}/api/health` öffnen
- **Deployment-Status**: `tale status` für den Produktions-Status
- **Convex Dashboard**: `tale convex admin` für einen Admin-Key
- **Issues und Diskussionen**: [github.com/tale-project/tale/issues](https://github.com/tale-project/tale/issues)

## Mitwirken

Neu im Repo? [Contributor-Setup](docs/de/develop/contributor-setup.md) ist die zentrale Quelle der Wahrheit, um den Quellcode lokal zum Laufen zu bringen — Voraussetzungen, `bun install`, der `bun run setup:check`-Pre-flight und `bun run dev`. Lies [`AGENTS.md`](AGENTS.md) vor deinem ersten PR — das ist der einzige Vertrag für Code-Stil, Security, Tests, i18n und Dokumentation über alle Workspaces hinweg. Der [`write-docs`](.agents/skills/write-docs/SKILL.md)-Skill deckt die Doku-Seite ab; der [`write-translations`](.agents/skills/write-translations/SKILL.md)-Skill die sprachübergreifenden Übersetzungsregeln. Lass `bun run check` (Format, Lint, Typecheck, Tests) durchlaufen, bevor du einen PR öffnest; das [Pull-Request-Template](.github/pull_request_template.md) listet den Rest der Pre-Merge-Checkliste.

---

## Star-History

[![Star History Chart](https://api.star-history.com/svg?repos=tale-project/tale&type=date&legend=top-left)](https://www.star-history.com/#tale-project/tale&type=date&legend=top-left)
