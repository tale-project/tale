<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/assets/logo-dark.svg">
  <img alt="Tale" src=".github/assets/logo-light.svg" width="150">
</picture>

[![Build](https://github.com/tale-project/tale/actions/workflows/build.yml/badge.svg?branch=main&event=push)](https://github.com/tale-project/tale/actions/workflows/build.yml)
[![Tests](https://github.com/tale-project/tale/actions/workflows/checks.yml/badge.svg?branch=main)](https://github.com/tale-project/tale/actions/workflows/checks.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[English](README.md) · [Deutsch](README.de.md) · [Français](README.fr.md)

</div>

# Tale — Der Open-Source-Arbeitsbereich für Teams und KI-Agenten

**Mache aus Problemen im Unternehmen Aufgaben, die dein Team gemeinsam mit KI-Agenten lösen kann.**

Tale gibt Teammitgliedern und KI-Agenten einen gemeinsamen Projektarbeitsbereich. Erstelle Aufgaben auf dem Board, weise sie Personen oder Agenten zu, verfolge die Arbeit und prüfe Berichte und gelieferte Dateien. Auftrag, Diskussionen, Projektwissen und Ergebnisse bleiben zusammen. Lass Agenten recherchieren, Dokumente prüfen, Berichte und Marketingmaterial erstellen oder eine Website, App oder ein internes Werkzeug entwickeln.

Wähle für jeden Agenten Laufzeit, Modell, Skills und Werkzeuge. Statte einen koordinierenden Agenten so aus, dass er bereite Aufgaben delegieren und Folgearbeiten abstimmen kann. Agenten arbeiten in dauerhaften Sandbox-Arbeitsbereichen; deine eingerichtete Kapazität begrenzt die gleichzeitige Ausführung.

Nutze eigene API-Schlüssel der Anbieter oder unterstützte Abonnements mit kompatiblen Agentenlaufzeiten. Die [Übersicht der Laufzeiten und Zugangsdaten](https://docs.tale.dev/de/platform/agents/harnesses) zeigt die verfügbaren Kombinationen.

Betreibe Tale auf eigener Infrastruktur oder nutze den verwalteten Cloud-Dienst. Der Code steht unter der MIT-Lizenz. Community und Enterprise enthalten dieselben Produktfunktionen; Enterprise ergänzt professionellen Betrieb und Support. Das aktuelle Angebot findest du unter [Tarife und Preise](https://tale.dev/pricing).

<table>
  <tr>
    <td width="50%" valign="top">
      <a href="services/docs/public/images/platform/projects-task-board.webp"><img src=".github/assets/readme-gallery-tasks.webp" alt="Das Task-Board des Projekts Website relaunch gruppiert Karten nach Status." width="100%"></a>
      <br><a href="https://docs.tale.dev/de/platform/projects/tasks"><b>Projektaufgaben</b></a><br><sub>Organisiere die Arbeit und prüfe ihren Fortschritt.</sub>
    </td>
    <td width="50%" valign="top">
      <a href="services/docs/public/images/platform/project-agents-models.webp"><img src=".github/assets/readme-gallery-project-agents.webp" alt="Der Agents-Tab des Projekts zeigt benannte Agents mit Laufzeit und Modell." width="100%"></a>
      <br><a href="https://docs.tale.dev/de/platform/projects/project-agents"><b>Projekt-Agents</b></a><br><sub>Wähle Anweisungen, Laufzeit, Modell und Tools.</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <a href="services/docs/public/images/platform/automation-editor-canvas.webp"><img src=".github/assets/readme-gallery-workflow-editor.webp" alt="Der Automatisierungseditor zeigt verbundene Schritte und die Einstellungen des ausgewählten Knotens." width="100%"></a>
      <br><a href="https://docs.tale.dev/de/platform/automations/editor"><b>Workflow-Editor</b></a><br><sub>Prüfe Schritte, Testeingaben und Laufprotokolle.</sub>
    </td>
    <td width="50%" valign="top">
      <a href="services/docs/public/images/platform/chat-arena-split.webp"><img src=".github/assets/readme-gallery-chat-arena.webp" alt="Arena zeigt zwei Antworten auf denselben Prompt und die Bewertungsaktionen." width="100%"></a>
      <br><a href="https://docs.tale.dev/de/platform/chat/arena-mode"><b>Chat und Arena</b></a><br><sub>Vergleiche zwei Modellantworten nebeneinander.</sub>
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

## Von der Aufgabe zum geprüften Ergebnis

1. **Die Arbeit beschreiben.** Erstelle eine [Projektaufgabe](https://docs.tale.dev/de/platform/projects/tasks) mit dem Problem, den Quelldateien und den Abnahmekriterien.
2. **Personen und Agenten zuweisen.** Richte [Projektagenten](https://docs.tale.dev/de/platform/projects/project-agents) für die Arbeit ein, wähle ihre Werkzeuge und starte die Aufgaben, die sie übernehmen sollen.
3. **Koordinieren und prüfen.** Verfolge den Fortschritt auf dem Board, steuere Agenten mit @Erwähnungen in Aufgabenkommentaren und prüfe Berichte und Dateien. Ein [koordinierender Agent](https://docs.tale.dev/de/platform/projects/task-automation) kann bereite Aufgaben delegieren, wenn er die nötigen Werkzeuge hat.
4. **Einen festen Prozess wiederholen.** Nutze eine versionierte [Automatisierung](https://docs.tale.dev/de/platform/automations/concepts), wenn die Arbeit geplante Starts, festgelegte Schritte oder Genehmigungen für Connector-Aktionen braucht.

### Beispiel: ein Briefing zum Produktstart prüfen

Wenn ein Projektagent und passende Zugangsdaten für das Modell eingerichtet sind, passe diese beispielhafte Aufgabenbeschreibung an deine Quelldateien an:

> Vergleiche das angehängte Briefing zum Produktstart mit den Besprechungsnotizen. Erstelle einen Markdown-Bericht mit widersprüchlichen Terminen, fehlenden Verantwortlichen und offenen Entscheidungen. Nenne zu jedem Fund die Quelldatei und Textstelle. Trenne gesicherte Fakten von offenen Fragen und lasse die Quelldateien unverändert.

Öffne vor der Abnahme den gelieferten Bericht, gleiche seine Belege mit beiden Dateien ab und prüfe, ob er alle verlangten Kategorien abdeckt. Bitte in der Aufgabe um Korrekturen, wenn Belege fehlen. Die [Anleitung zur Aufgabenprüfung](https://docs.tale.dev/de/platform/projects/task-automation) erklärt, wie du Änderungen anforderst oder fertige Arbeit annimmst.

## Tale für dein Team prüfen

**Welche Agenten-Laufzeiten kann ich verwenden?** Tale enthält Claude Code, Codex, Cursor, Gemini CLI, Hermes, OpenClaw, OpenCode, Pi und Qwen Code. Was verfügbar ist, hängt von deiner Bereitstellung, den Zugangsdaten und der Sandbox-Kapazität ab. Die [Kompatibilitätsübersicht](https://docs.tale.dev/de/platform/agents/harnesses) beschreibt Zugangsdaten, Werkzeuge und Einschränkungen bei der Fortsetzung von Gesprächen.

**Kann ich einen API-Schlüssel oder ein vorhandenes Abonnement nutzen?** Gespeicherte API-Schlüssel von Modellanbietern nutzen Tales Modell-Gateway. Unterstützte Anbieterabonnements funktionieren nur mit passenden Laufzeiten, sind nicht für den normalen Chat nutzbar und umgehen die Verbrauchserfassung und Ausgabenlimits des Gateways. Lies vor der Auswahl die [Hinweise zu Zugangsdaten und Kosten](https://docs.tale.dev/de/platform/agents/harnesses).

**Was brauche ich für den Eigenbetrieb?** Für den Einstieg brauchst du Docker mit Compose, Speicherplatz für Images und persistente Daten sowie Zugangsdaten für einen unterstützten Modellanbieter. Im Produktivbetrieb kommen DNS, TLS, Backups und Zugriffskontrollen hinzu. Der [Schnellstart für den Eigenbetrieb](https://docs.tale.dev/de/self-hosted/install/quickstart) beschreibt die lokale Einrichtung und verlinkt die Vorbereitung für den Produktivbetrieb.

**Wohin gehen meine Daten?** Anwendungsdaten, durchsuchbares Wissen und Originaldateien haben getrennte Speichereinstellungen. Modellanbieter, Konnektoren und externe Werkzeuge können Daten außerhalb dieser Speicher verarbeiten; Eigenbetrieb allein hält nicht jede Anfrage lokal. Prüfe die [Datenresidenz](https://docs.tale.dev/de/self-hosted/configuration/data-residency) und den [Umgang der Laufzeit mit Zugangsdaten und Netzwerkzugriffen](https://docs.tale.dev/de/platform/agents/harnesses).

**Was unterscheidet Community und Enterprise?** Beide enthalten dieselben Produktfunktionen unter der MIT-Lizenz. Enterprise ergänzt professionelle Betriebsführung und Support. Die aktuellen Leistungsbedingungen findest du unter [Angebote und Preise](https://tale.dev/pricing).

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
