<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/assets/logo-dark.svg">
  <img alt="Tale" src=".github/assets/logo-light.svg" width="150">
</picture>

[![Build](https://github.com/tale-project/tale/actions/workflows/build.yml/badge.svg?branch=main)](https://github.com/tale-project/tale/actions/workflows/build.yml)
[![Tests](https://github.com/tale-project/tale/actions/workflows/checks.yml/badge.svg?branch=main)](https://github.com/tale-project/tale/actions/workflows/checks.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[English](README.md) · [Deutsch](README.de.md) · [Français](README.fr.md)

</div>

# Tale

Tale verbindet KI-Chat, Projektarbeit, Wissen und Automatisierungen in einem Arbeitsbereich. Stelle Fragen zu deinen Dokumenten, gib einem Agenten eine konkrete Aufgabe und prüfe das Ergebnis mit deinem Team. Du wählst die Modellanbieter und betreibst Tale auf eigener Infrastruktur oder nutzt den verwalteten Cloud-Dienst.

Der Code steht unter der MIT-Lizenz. Community und Enterprise enthalten dieselben Produktfunktionen; Enterprise ergänzt professionellen Betrieb und Support. Das aktuelle Angebot findest du unter [Tarife und Preise](https://tale.dev/pricing).

<table>
  <tr>
    <td width="50%" valign="top">
      <a href="services/docs/public/images/platform/chat-arena-split.webp"><img src=".github/assets/readme-gallery-chat-arena.webp" alt="Arena zeigt zwei Antworten auf denselben Prompt und die Bewertungsaktionen." width="100%"></a>
      <br><a href="https://docs.tale.dev/de/platform/chat/arena-mode"><b>Chat und Arena</b></a><br><sub>Vergleiche zwei Modellantworten nebeneinander.</sub>
    </td>
    <td width="50%" valign="top">
      <a href="services/docs/public/images/platform/projects-task-board.webp"><img src=".github/assets/readme-gallery-tasks.webp" alt="Das Task-Board des Projekts Website relaunch gruppiert Karten nach Status." width="100%"></a>
      <br><a href="https://docs.tale.dev/de/platform/projects/tasks"><b>Projektaufgaben</b></a><br><sub>Organisiere die Arbeit und prüfe ihren Fortschritt.</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <a href="services/docs/public/images/platform/project-agents-models.webp"><img src=".github/assets/readme-gallery-project-agents.webp" alt="Der Agents-Tab des Projekts zeigt benannte Agents mit Laufzeit und Modell." width="100%"></a>
      <br><a href="https://docs.tale.dev/de/platform/projects/project-agents"><b>Projekt-Agents</b></a><br><sub>Wähle Anweisungen, Laufzeit, Modell und Tools.</sub>
    </td>
    <td width="50%" valign="top">
      <a href="services/docs/public/images/platform/automation-editor-canvas.webp"><img src=".github/assets/readme-gallery-workflow-editor.webp" alt="Der Automatisierungseditor zeigt verbundene Schritte und die Einstellungen des ausgewählten Knotens." width="100%"></a>
      <br><a href="https://docs.tale.dev/de/platform/automations/editor"><b>Workflow-Editor</b></a><br><sub>Prüfe Schritte, Testeingaben und Laufprotokolle.</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <a href="services/docs/public/images/platform/connectors-add-credential.webp"><img src=".github/assets/readme-gallery-connectors.webp" alt="Der Dialog zum Hinzufügen von Zugangsdaten zeigt die verfügbaren Konnektoren." width="100%"></a>
      <br><a href="https://docs.tale.dev/de/platform/connectors/overview"><b>Konnektoren</b></a><br><sub>Wähle die Dienste für deinen Arbeitsbereich.</sub>
    </td>
    <td width="50%" valign="top">
      <a href="services/docs/public/images/platform/governance-guardrails.webp"><img src=".github/assets/readme-gallery-guardrails.webp" alt="Die Guardrails-Einstellungen zeigen den Richtlinienstatus und die verfügbaren Einstellungen." width="100%"></a>
      <br><a href="https://docs.tale.dev/de/platform/admin/governance/guardrails"><b>Governance</b></a><br><sub>Prüfe Inhaltssicherheit und Datenrichtlinien.</sub>
    </td>
  </tr>
</table>

Öffne einen Screenshot, um ihn in voller Größe anzusehen. Die Aufnahmen zeigen die englische Oberfläche.

## Finde deinen Einstieg

| Dein Ziel | Passende Anleitung |
| --- | --- |
| Einen vorhandenen Arbeitsbereich nutzen | [Deine erste Nachricht senden](https://docs.tale.dev/de/get-started/quickstart) |
| Tale installieren | [Schnellstart für den Eigenbetrieb](https://docs.tale.dev/de/self-hosted/install/quickstart) |
| Eine verwaltete Instanz erhalten | [Demo anfragen](https://tale.dev/request-demo) |
| Einen Agenten für ein Projekt erstellen | [Projektagent erstellen und testen](https://docs.tale.dev/de/get-started/editors) |
| Eine andere Anwendung anbinden | [Einstieg in die API](https://docs.tale.dev/de/get-started/developers) |
| Den Quellcode ändern | [Entwicklungsumgebung einrichten](docs/de/develop/contributor-setup.md) |
| Mit Tales UI-Komponenten entwickeln | [Komponenten und interaktive Beispiele (Englisch)](https://ui.tale.dev/docs/getting-started/introduction) |

### Eine lokale Instanz starten

Installiere die Tale-CLI, lege ein Projekt an und starte die Entwicklungsumgebung:

```bash
curl -fsSL https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh | bash
tale init my-project
cd my-project
tale dev
```

Die Umgebung benötigt Docker. Folge den Einrichtungshinweisen der CLI und warte, bis Docker läuft, bevor du Tale startest. Beim ersten Start lädt die CLI Container-Images herunter und zeigt anschließend die Adresse an. Erstelle im Einrichtungsassistenten das erste Konto und die Organisation. Verbinde danach einen KI-Anbieter, damit Modelle antworten können.

Die [Installationsanleitung](https://docs.tale.dev/de/self-hosted/install/quickstart) beschreibt Windows, Voraussetzungen und die Fehlersuche beim Start. Befehle und Optionen stehen in der [CLI-Referenz](tools/cli/README.md). Lies vor dem Umzug auf einen Server die [Bereitstellungsanleitung](https://docs.tale.dev/de/self-hosted/install/cli-install).

### Aus dem Quellcode entwickeln

Du brauchst die Bun-Version aus [package.json](package.json), eine kompatible Node.js-Version und Docker für die unterstützenden Dienste. Für alle Repository-Prüfungen kommen Python und uv hinzu. Die [Einrichtungsanleitung](docs/de/develop/contributor-setup.md) beschreibt Versionen, Umgebungsvariablen und Ports.

```bash
bun install --frozen-lockfile
bun run setup:check
bun run dev
```

Warte auf die Bereitschaftsmeldung der Plattform und öffne die angezeigte Adresse. Der Einrichtungscheck prüft nur einen Teil der Umgebung. Auch bei grünem Ergebnis müssen Datenbanken, Speicher und Modellanbieter eingerichtet sein.

Für die Arbeit an der Dokumentation allein brauchst du weder eine Plattform-Datenbank noch einen Modellanbieter. Der erste Befehl startet die Produktdokumentation, der zweite den Design-System-Leitfaden:

```bash
bun run --filter @tale/docs dev
bun run --filter @tale/ui-docs dev
```

## Was du mit Tale tun kannst

- **[Chat](https://docs.tale.dev/de/platform/chat/basics):** Texte entwerfen, Zusammenhänge klären und Informationen im Gespräch bearbeiten. Vergleiche Modelle in Arena und prüfe Quellen bei Antworten aus der Wissensdatenbank.
- **[Projekte](https://docs.tale.dev/de/platform/projects/overview):** Aufgaben, Dateien, Anweisungen und Chats zusammenhalten. Du entscheidest, welche Chats du mit dem Projekt teilst.
- **[Projektagenten](https://docs.tale.dev/de/platform/projects/project-agents):** Anweisungen, Laufzeit, Modell und Werkzeuge festlegen. Weise eine Aufgabe zu, starte den Agenten und prüfe sein Ergebnis.
- **[Wissen](https://docs.tale.dev/de/platform/knowledge/overview):** Dokumente, Wissenseinträge und Website-Inhalte für die Suche aufbereiten. Hochladen und Indexieren sind getrennte Schritte.
- **[Automatisierungen](https://docs.tale.dev/de/platform/automations/concepts):** Schritte zu einem Workflow verbinden, ihn testen und manuell oder über konfigurierte Auslöser starten.
- **[Konnektoren](https://docs.tale.dev/de/platform/connectors/overview):** Externe Dienste mit den Zugangsdaten deines Arbeitsbereichs anbinden.
- **[Verwaltung](https://docs.tale.dev/de/platform/admin/overview):** Mitglieder, Rollen, Anbieter, Richtlinien, Nutzung und Audit-Einträge verwalten.

Welche Funktionen du nutzen kannst, hängt von deiner Rolle und der Konfiguration ab. Ein lokales Modell hält die Inferenz auf deiner Infrastruktur; angebundene Dienste und externe Werkzeuge haben weiterhin eigene Datenflüsse. Lies vor der Wahl deiner Betriebsumgebung die Hinweise zur [Datenresidenz](https://docs.tale.dev/de/self-hosted/configuration/data-residency).

## Dokumentation

Die Dokumentation gibt es auf [Englisch](https://docs.tale.dev), [Deutsch](https://docs.tale.dev/de) und [Französisch](https://docs.tale.dev/fr).

Beginne mit einer angeleiteten Aufgabe. Die Plattformseiten begleiten die tägliche Arbeit, die Betriebs- und API-Referenzen liefern genaue Konfigurationsangaben. Die [Screenshot-Galerie](SCREENSHOTS.md) zeigt die wichtigsten Ansichten. Wenn du die Dokumentation verbessern möchtest, lies die [README des Docs-Workspaces](services/docs/README.md).

Du baust eine Oberfläche mit Tales Komponenten? Der [Design-System-Leitfaden](https://ui.tale.dev) beschreibt `@tale/ui` und `@tale/marketing-ui` mit interaktiven Beispielen, auf Englisch. Seine Seiten liegen in [services/ui-docs](services/ui-docs/README.md).

## Mitwirken und Hilfe finden

Lies vor Codeänderungen [CONTRIBUTING.md](.github/CONTRIBUTING.md) und den [Repository-Vertrag](AGENTS.md). Führe vor einem Pull Request `bun run check` aus. Weitere Prüfungen richten sich nach deiner Änderung und stehen im Beitragsleitfaden.

- Stelle Fragen in [GitHub Discussions](https://github.com/tale-project/tale/discussions).
- Melde reproduzierbare Fehler in [GitHub Issues](https://github.com/tale-project/tale/issues), mit Version, Schritten sowie erwartetem und tatsächlichem Ergebnis.
- Melde Sicherheitslücken über die [vertrauliche Sicherheitsmeldung](https://github.com/tale-project/tale/security).

## Lizenz

Tale steht unter der [MIT-Lizenz](LICENSE).
