<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/assets/logo-dark.svg">
  <img alt="Tale" src=".github/assets/logo-light.svg" width="150">
</picture>

### Der Orchestrator für KI-Agents

Verbinde **OpenClaw**, **Hermes Agent**, **Claude Code**, **Codex**, **Cursor**, **Gemini CLI**, **OpenCode** und **Pi**.<br/>
Bündle ihr Wissen, delegiere Aufgaben und bau deinen Schwarm aus Agents.

[![Lizenz: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Docs](https://img.shields.io/badge/docs-tale-0a0a0a.svg)](docs/de/index.md)
[![Self-hosted](https://img.shields.io/badge/self--hosted-Docker-2496ed.svg)](docs/de/self-hosted/install/quickstart.md)

[Schnellstart](#schnellstart) · [Was kannst du tun?](#was-kannst-du-tun) · [Befehle](#befehlsreferenz) · [Dokumentation](#dokumentation) · [Mitwirken](#mitwirken)

**Lies das auf:** [English](README.md) · [Deutsch](README.de.md) · [Français](README.fr.md)

</div>

---

Tale ist eine **selbstgehostete KI-Plattform**, die die Agents und CLIs, die dein Team bereits nutzt, zu einer koordinierten Belegschaft verbindet. Gib ihnen eine gemeinsame Wissensdatenbank, binde deine Tools und Integrationen an und delegiere Arbeit über sie hinweg — Agents, Automatisierungen und ein gemeinsamer Posteingang, alles auf deiner eigenen Infrastruktur. Installiere die CLI und starte mit einem einzigen Befehl.

## Schnellstart

Bring Tale in drei Befehlen auf deine Maschine — CLI installieren, Projekt anlegen, starten. Die CLI installiert Docker, falls es fehlt, und generiert jedes Secret für dich, sodass nichts vorab einzurichten und nichts von Hand zu editieren ist.

**Voraussetzungen:** keine. Der Installer richtet Docker für dich ein. Bring einen [OpenRouter-API-Key](https://openrouter.ai) (oder einen beliebigen OpenAI-kompatiblen Anbieter) mit, wenn du ein Modell verbinden möchtest — der In-App-Einrichtungsassistent führt dich hindurch, und du kannst ihn auch später hinzufügen.

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

Die CLI stellt eine Frage — **lokaler Test** oder **Produktiv-Domain** — und konfiguriert alles für dieses Ziel: TLS, alle Sicherheits-Secrets, Konfigurationsdateien für KI-Editoren und den nach `.tale/reference/` entpackten Plattform-Quellcode, damit KI-Editoren Configs mit voller Plattform-Kenntnis erstellen und ändern können. Dasselbe Projekt funktioniert für einen lokalen Test und ein echtes Deployment.

### 3. Tale starten

```bash
tale start
```

Öffne https://localhost (oder deine konfigurierte Domain), sobald "Tale Platform is running!" erscheint.

> **Hinweis:** Dein Browser zeigt eine Zertifikatswarnung für selbstsignierte Zertifikate. Die ist sicher zu akzeptieren.

Eine ausführliche Einrichtungsanleitung findest du im [Self-hosted-Quickstart](docs/de/self-hosted/install/quickstart.md).

## Was kannst du tun?

| Ziel                           | Wie                                                                                       |
| ------------------------------ | ----------------------------------------------------------------------------------------- |
| **Eigene Agents bauen**        | JSON-Dateien in `agents/` bearbeiten — Anweisungen, Tools und Modelle definieren          |
| **Automatisierungen bauen**    | JSON-Dateien in `workflows/` bearbeiten — Trigger, Bedingungen, Schleifen, KI-Schritte    |
| **Integrationen hinzufügen**   | Dateien in `integrations/` bearbeiten — REST-APIs, SQL-Datenbanken, eigene Konnektoren    |
| **Configs mit KI bauen**       | Projekt in Claude Code, Cursor, Copilot oder Windsurf öffnen — die KI kennt deine Schemas |
| **Mit KI-Assistenten chatten** | Direkt in der Plattform — sofort einsatzbereit                                            |
| **Wissensdatenbank aufbauen**  | Dokumente hochladen, Websites crawlen, Produkte und Kunden verwalten                      |
| **Konversationen verwalten**   | Gemeinsamer Posteingang für Kunden-Konversationen mit KI-gestützten Antworten             |
| **Backend-Daten ansehen**      | `tale convex admin` ausführen und das Convex Dashboard öffnen                             |

Alle Dateien in `agents/`, `workflows/` und `integrations/` werden live neu geladen — bearbeiten und Änderungen sofort sehen.

## Befehlsreferenz

### Entwicklung

```bash
tale init [directory]              # Neues Projekt mit Beispiel-Configs anlegen (kein Docker nötig)
tale start                         # Alle Dienste lokal starten
tale start --detach                # Im Hintergrund starten
tale start --port 8443             # Eigenen HTTPS-Port nutzen
tale upgrade                       # CLI upgraden und Projektdateien synchronisieren
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

In der [CLI-Referenz](tools/cli/README.md) findest du alle Optionen und Flags. Das Aktualisieren einer bestehenden Installation erfordert eine einmalige manuelle Migration: führe `tale migrate config-layout` aus, danach `tale deploy --override-all -y`. Das vollständige Runbook findest du in [Self-hosted Upgrades](docs/de/self-hosted/operate/upgrades.md).

## In Produktion deployen

```bash
tale deploy
```

Die CLI macht Blue-Green-Zero-Downtime-Deployments mit automatischen Health-Checks und Rollback. Für die volle Produktions-Einrichtung inkl. Reverse-Proxy-Konfiguration und Subpath-Deployment siehe den [Produktions-Deployment-Guide](docs/de/self-hosted/install/linux-server.md).

## Authentifizierungs-Optionen

Tale nutzt standardmässig passwortbasierte Authentifizierung. Der erste User legt das Owner-Konto an; alle weiteren werden vom Admin angelegt. Für Self-Service-Login verbindest du SSO oder Trusted Headers über Microsoft Entra ID — siehe die [Integrationen-Übersicht](docs/de/platform/integrations/overview.md) für den Microsoft-365-Connector, der sowohl Dokumentensynchronisation als auch SSO bedient.

- **Microsoft Entra ID (SSO):** Single Sign-On mit Microsoft 365 / Azure AD inkl. automatischem Provisioning
- **Trusted Headers:** Für Deployments hinter einem authentifizierenden Reverse-Proxy (Authelia, Authentik, oauth2-proxy)

## Entwicklung

Für lokale Entwicklung (ohne Docker):

### Voraussetzungen

- **Bun**: 1.3.x oder höher ([Installationsanleitung](https://bun.sh/docs/installation))
- **Python**: 3.12.x (für die Python-Dienste rag und crawler)
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

Für die Python-Dienste:

```bash
cd services/rag && uv sync --extra dev
cd services/crawler && uv sync --extra dev
```

### Bekannte Probleme

- **xlsx-Sicherheitslücke**: Das Projekt nutzt xlsx@0.18.5 mit bekannten Sicherheitslücken (Prototype Pollution und ReDoS). Das ist die aktuell verfügbare Version; ein Fix ist noch nicht veröffentlicht. Das Paket wird zum Parsen von Excel-Dateien im Documents-Feature genutzt.
- **ENVIRONMENT_FALLBACK-Warnung**: Beim Platform-Build kann ein `ENVIRONMENT_FALLBACK`-Fehler erscheinen. Eine Convex-spezifische Warnung — der Build läuft trotzdem erfolgreich durch.

## Dokumentation

Doku-Seite und Plattform-UI laufen in drei Basis-Sprachen (`en`, `de`, `fr`) plus regionalen Varianten, wo lokale Formulierungen abweichen (heute: `de-CH`; der Loader erkennt jedes neue `xx-YY`-Bundle automatisch). Varianten tragen nur die Strings, die von ihrer Basis abweichen; fehlende Keys fallen über die Basis bis auf Englisch zurück. Start unter [`docs/de/index.md`](docs/de/index.md), um nach Persona einzusteigen.

<details>
<summary><strong>Für alltägliche Nutzer</strong></summary>

- **[Chat-Übersicht](docs/de/platform/chat/overview.md)** — die vier Bereiche des Bildschirms, wo es tiefer geht
- **[KI-Chat-Grundlagen](docs/de/platform/chat/basics.md)** — Composer, Agents, Modell-Picker, Streaming, Zitate
- **[Tiefenrecherche](docs/de/platform/chat/deep-research.md)** — der Researcher-Agent mit Live-Plan und PDF-Bericht
- **[Anhänge](docs/de/platform/chat/attachments.md)** — Dateien im Chat, RAG vs wörtlich
- **[Geteilte Chats](docs/de/platform/chat/shared-threads.md)** — Chat per Link mit der Org teilen, in einen eigenen forken
- **[Genehmigungen](docs/de/platform/approvals/concepts.md)** — KI-Aktionen prüfen

</details>

<details>
<summary><strong>Für Bauende (Agents, Automatisierungen, Integrationen)</strong></summary>

- **[Agent-Konzepte](docs/de/platform/agents/concepts.md)** — das Vier-Knöpfe-Modell hinter jedem Agent
- **[Einen Agent erstellen](docs/de/platform/agents/create.md)** — spezialisierte KI-Assistenten von Anfang bis Ende
- **[Agent-Tools](docs/de/platform/agents/tools.md)** — die eingebauten Tool-Familien
- **[Projekte](docs/de/platform/projects/overview.md)** — geteilter Workspace für Dateien, Chats und Projekt-Agents
- **[Automatisierungs-Konzepte](docs/de/platform/automations/concepts.md)** — Workflows, Trigger, Genehmigungstore
- **[Integrationen-Übersicht](docs/de/platform/integrations/overview.md)** — Slack, Teams, Gmail, Outlook, Microsoft 365, Google Drive, Confluence, WebDAV, GitHub, Shopify, Tavily, MCP
- **[Modelle out of the box](docs/de/platform/models.md)** — OpenRouter als einziger Default-Provider, plus die ausgelieferten Modelllisten

</details>

<details>
<summary><strong>Für Admins</strong></summary>

- **[Mitglieder und Rollen](docs/de/platform/admin/members-and-roles.md)** — Userverwaltung und Berechtigungs-Matrix
- **[Modelle out of the box](docs/de/platform/models.md)** — welche Modelle die Defaults mitbringen; Provider tauschen oder hinzufügen
- **[Integrationen-Übersicht](docs/de/platform/integrations/overview.md)** — Drittanbieter-Konnektoren, MCP-Server, eigene Konfigurationen
- **[Cloud-Trust und Compliance](docs/de/cloud/trust-and-compliance.md)** — Frameworks, geteilte Verantwortung, Belege für Auditoren

</details>

<details>
<summary><strong>Für Operators</strong></summary>

- **[Self-hosted-Übersicht](docs/de/self-hosted/overview.md)** — Architektur und Dienste
- **[Quickstart](docs/de/self-hosted/install/quickstart.md)** — Single-Host-Installation in zwanzig Minuten
- **[Produktions-Deployment](docs/de/self-hosted/install/linux-server.md)** — Linux-Server mit TLS, Firewall, Non-Root-User
- **[Docker-Compose-Referenz](docs/de/self-hosted/install/docker-compose-reference.md)** — Basis-Datei und Overlays
- **[Tale CLI](tools/cli/README.md)** — CLI-Referenz
- **[Environment-Referenz](docs/de/self-hosted/configuration/environment-reference.md)** — alle Environment-Variablen
- **[Container-Architektur](docs/de/self-hosted/operate/container-architecture.md)** — sieben Container, was was besitzt

</details>

<details>
<summary><strong>Für Developer</strong></summary>

- **[API-Referenz](docs/de/develop/api-reference.md)** — REST-API für RAG, Crawler und Platform
- **[Webhooks](docs/de/develop/webhooks.md)** — Workflow- und Agent-Webhooks mit Signaturprüfung
- **[Develop-Übersicht](docs/de/develop/overview.md)** — die Entwickler-Oberfläche von Anfang bis Ende

</details>

## Brauchst du Hilfe?

- **Logs**: `tale logs <service>` für Dienst-Logs
- **Health-Checks**: `{SITE_URL}/api/health` öffnen
- **Deployment-Status**: `tale status` für den Produktions-Status
- **Convex Dashboard**: `tale convex admin` für einen Admin-Key
- **Issues und Diskussionen**: [github.com/tale-project/tale/issues](https://github.com/tale-project/tale/issues)

## Mitwirken

Lies [`AGENTS.md`](AGENTS.md) vor deinem ersten PR — das ist der einzige Vertrag für Code-Stil, Security, Tests, i18n und Dokumentation über alle Workspaces hinweg. Der [`docs`](.agents/docs/AGENTS.md)-Skill deckt die Doku-Seite ab; der [`translation`](.agents/translation/AGENTS.md)-Skill die sprachübergreifenden Übersetzungsregeln. Lass `bun run check` (Format, Lint, Typecheck, Tests) durchlaufen, bevor du einen PR öffnest; das [Pull-Request-Template](.github/pull_request_template.md) listet den Rest der Pre-Merge-Checkliste.

---

## Star-History

[![Star History Chart](https://api.star-history.com/svg?repos=tale-project/tale&type=date&legend=top-left)](https://www.star-history.com/#tale-project/tale&type=date&legend=top-left)
