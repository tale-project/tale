# Tale

> **Lies das auf:** [English](README.md) · [Deutsch](README.de.md) · [Français](README.fr.md)

Bau KI-gestützte Anwendungen in Minuten, nicht Monaten.

Tale ist eine selbstgehostete KI-Plattform mit eigenen Agents, einer Wissensdatenbank, Workflow-Automatisierungen, Integrationen und einem gemeinsamen Posteingang. Installiere die CLI und starte mit einem einzigen Befehl.

## Schnellstart

**Voraussetzungen:** [Docker Desktop](https://www.docker.com/products/docker-desktop) (v24+) und ein [OpenRouter-API-Key](https://openrouter.ai).

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

Die CLI fragt nach Domain, API-Key und TLS-Modus. Sicherheits-Secrets werden automatisch generiert. Sie legt ausserdem Konfigurationsdateien für KI-Editoren an und entpackt den Plattform-Quellcode nach `.tale/reference/`, damit KI-Editoren Configs mit voller Plattform-Kenntnis erstellen und ändern können. Siehe [KI-gestützte Entwicklung](docs/de/develop/ai-assisted-development.md).

### 3. Tale starten

```bash
tale start
```

Öffne https://localhost (oder deine konfigurierte Domain), sobald "Tale Platform is running!" erscheint.

> **Hinweis:** Dein Browser zeigt eine Zertifikatswarnung für selbstsignierte Zertifikate. Die ist sicher zu akzeptieren.

Eine ausführliche Einrichtungsanleitung findest du im [Erste-Schritte-Guide](docs/de/platform/member/overview.md).

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
tale init [directory]              # Neues Projekt mit Beispiel-Configs anlegen
tale start                         # Alle Dienste lokal starten
tale start --detach                # Im Hintergrund starten
tale start --port 8443             # Eigenen HTTPS-Port nutzen
tale start --fresh                 # Builtin-Configs neu seeden
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
tale rollback                      # Auf vorherige Version zurückrollen
tale cleanup                       # Inaktive Container entfernen
tale reset --force                 # Alle Container entfernen
```

In der [CLI-Referenz](tools/cli/README.md) findest du alle Optionen und Flags. Anstehende Daten-Migrationen werden beim nächsten `tale start` oder `tale deploy` automatisch erkannt und angewendet.

## In Produktion deployen

```bash
tale deploy
```

Die CLI macht Blue-Green-Zero-Downtime-Deployments mit automatischen Health-Checks und Rollback. Für die volle Produktions-Einrichtung inkl. Reverse-Proxy-Konfiguration und Subpath-Deployment siehe den [Produktions-Deployment-Guide](docs/de/self-hosted/install/linux-server.md).

## Authentifizierungs-Optionen

Tale nutzt standardmässig passwortbasierte Authentifizierung. Der erste User legt das Owner-Konto an; alle weiteren werden vom Admin angelegt. Für Self-Service-Login verbindest du SSO oder Trusted Headers. Volle Details im [Authentifizierungs-Guide](docs/de/self-hosted/admin/authentication.md).

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

Doku-Seite und Plattform-UI laufen in drei Basis-Sprachen (`en`, `de`, `fr`) plus regionalen Varianten, wo lokale Formulierungen abweichen (heute: `de-CH`; der Loader erkennt jedes neue `xx-YY`-Bundle automatisch). Varianten tragen nur die Strings, die von ihrer Basis abweichen; fehlende Keys fallen über die Basis bis auf Englisch zurück. Start unter [`docs/index.md`](docs/index.md), um nach Persona einzusteigen.

### Für alltägliche Nutzer

- **[Erste Schritte](docs/de/platform/member/overview.md)** — Tale installieren und die App öffnen
- **[KI-Chat-Grundlagen](docs/de/platform/chat/basics.md)** — chatten, Dateien anhängen, Video-Links einfügen, Agents auswählen
- **[Wissensdatenbank](docs/de/platform/workspace/knowledge-base.md)** — Dokumente und Websites
- **[Konversationen](docs/de/platform/workspace/conversations.md)** — Kunden-Posteingang
- **[Genehmigungen](docs/de/platform/workspace/approvals.md)** — KI-Aktionen prüfen
- **[Deine Einstellungen](docs/de/platform/member/preferences.md)** — Passwort, Sprache, Theme

### Für Bauende (Agents, Automatisierungen, Integrationen)

- **[Was du bauen kannst](docs/de/platform/developer/overview.md)** — Orientierung für Editor/Developer
- **[Einen Agent erstellen](docs/de/platform/agents/create.md)** — spezialisierte KI-Assistenten
- **[Workflows](docs/de/platform/automations/workflows.md)** — mehrstufige Automatisierungen
- **[Strukturierte Daten](docs/de/platform/knowledge/structured-data.md)** — Produkte, Kunden, Lieferanten
- **[Integrationen-Übersicht](docs/de/platform/integrations/overview.md)** — REST, SQL, Email, OneDrive

### Für Admins

- **[Mitglieder und Rollen](docs/de/platform/admin/members-and-roles.md)** — Userverwaltung und Berechtigungs-Matrix
- **[Authentifizierung](docs/de/self-hosted/admin/authentication.md)** — Passwort, SSO, Trusted Headers
- **[KI-Anbieter](docs/de/platform/admin/providers.md)** — Modelle im Admin-UI konfigurieren
- **[Richtlinien](docs/de/platform/admin/governance.md)** — Budgets, Retention, Guardrails (Content Safety, PII-Erkennung, Moderation-Provider), Audit-Logs
- **[Nutzungs-Analytics](docs/de/platform/admin/usage-analytics.md)** — zeitbasiertes Token- und Kosten-Reporting

### Für Operators

- **[Plattform-Übersicht](docs/de/self-hosted/overview.md)** — Architektur und Dienste
- **[Produktions-Deployment](docs/de/self-hosted/install/linux-server.md)** — Docker Compose, Zero-Downtime-Deploys, Reverse Proxy
- **[Tale CLI](tools/cli/README.md)** — CLI-Referenz
- **[Environment-Referenz](docs/de/self-hosted/configuration/environment-reference.md)** — alle Environment-Variablen
- **[Betrieb](docs/de/self-hosted/operate/observability/operations.md)** — Monitoring, Error-Tracking, Backups
- **[Troubleshooting](docs/de/self-hosted/operate/observability/troubleshooting.md)** — typische Probleme

### Für Developer

- **[API-Referenz](docs/de/develop/api-reference.md)** — REST-API für RAG, Crawler und Platform
- **[Webhooks](docs/de/develop/webhooks.md)** — Workflow- und Agent-Webhooks mit Signaturprüfung
- **[KI-gestützte Entwicklung](docs/de/develop/ai-assisted-development.md)** — Agents/Workflows in KI-Editoren konfigurieren
- **[Docker beitragen](docs/de/develop/contributing-docker.md)** — Dockerfiles ändern und Container-Tests laufen lassen

## Brauchst du Hilfe?

- **Logs**: `tale logs <service>` für Dienst-Logs
- **Health-Checks**: `{SITE_URL}/api/health` öffnen
- **Deployment-Status**: `tale status` für den Produktions-Status
- **Convex Dashboard**: `tale convex admin` für einen Admin-Key
- **Issues und Diskussionen**: [github.com/tale-project/tale/issues](https://github.com/tale-project/tale/issues)

## Mitwirken

Lies [`AGENTS.md`](AGENTS.md) vor deinem ersten PR — das ist der einzige Vertrag für Code-Stil, Security, Tests, i18n und Dokumentation über alle Workspaces hinweg. Der [`docs`](.agents/docs/AGENTS.md)-Skill deckt die Doku-Seite ab; der [`terminology`](.agents/terminology/AGENTS.md)-Skill die sprachübergreifenden Übersetzungsregeln. Lass `bun run check` (Format, Lint, Typecheck, Tests) durchlaufen, bevor du einen PR öffnest; das [Pull-Request-Template](.github/pull_request_template.md) listet den Rest der Pre-Merge-Checkliste.

---

## Star-History

[![Star History Chart](https://api.star-history.com/svg?repos=tale-project/tale&type=date&legend=top-left)](https://www.star-history.com/#tale-project/tale&type=date&legend=top-left)
