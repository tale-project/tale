---
title: AI-gestützte Entwicklung
description: Wie Claude Code, Cursor, Copilot und Windsurf ein Tale-Projekt bearbeiten — die Rules-Datei, die jeder Editor liest, und der Schema-Spiegel, den Tale unter `.tale/reference/` erzeugt.
---

Tale-Projekte sind JSON — Agents, Workflows, Connectors, Branding — und JSON lässt sich in AI-Editoren gut bearbeiten, wenn der Editor das Schema kennt. Die CLI legt dafür zwei Dinge an: eine Rules-Datei, die jeder Editor im Projekt-Root liest (`CLAUDE.md` für Claude Code, `.cursor/rules/tale.mdc` für Cursor, `.github/copilot-instructions.md` für Copilot, `.windsurfrules` für Windsurf), und einen schreibgeschützten Schema-Spiegel unter `.tale/reference/`, auf den die Rules-Datei den Editor verweist.

Lies das, wenn du ein Tale-Projekt im AI-Editor bearbeiten willst, ohne JSON von Hand zu tippen. Komm zurück, wenn der Editor Felder erfindet oder die falsche Agent-Form verdrahtet — die Antwort ist fast immer, dass das Schema unter `.tale/reference/` veraltet ist.

## Ein durchgespieltes Setup

Initialisier ein Projekt — die CLI schreibt die Rules-Datei und den Schema-Spiegel im selben Schritt:

```bash
tale init my-org
cd my-org
ls -a
# .cursor/  .github/  .tale/  .windsurfrules
# CLAUDE.md  agents/  workflows/  connectors/  branding/
```

`CLAUDE.md` (gleichzeitig installiert als Cursor-`.mdc`, Copilot-`.md` und Windsurf-Rules) sagt dem Editor, wo er nachschlagen soll, bevor er eine Config bearbeitet:

> Before creating or editing any config, read the relevant schemas and implementation code in `.tale/reference/` to understand the valid structure, fields, and constraints. Use existing config files in the project as examples.

Die Direktive zählt, weil jeder Editor unter Last Schema-Reads überspringt, sofern nicht anders gesagt. Die Rules-Datei ist der Vertrag; der Schema-Spiegel ist die Wahrheit am Boden.

## Was wo liegt

| Pfad                             | Was es ist                                                                          |
| -------------------------------- | ----------------------------------------------------------------------------------- |
| `agents/`                        | Eine JSON-Datei pro Agent — Anweisungen, Wissen, Tools, Modell.                     |
| `workflows/`                     | Workflow-JSON-Configs, gruppiert nach Kategorie-Unterverzeichnis.                   |
| `connectors/<slug>/config.json`  | Connector-Manifest — Operations, Auth-Methode, erlaubte Hosts.                      |
| `connectors/<slug>/connector.ts` | Optionaler TypeScript-Connector für REST-Formen, die das Manifest nicht abdeckt.    |
| `branding/branding.json`         | Org-Branding — Farben, Logos, E-Mail-Absender.                                      |
| `.tale/reference/`               | Schreibgeschützter Schema-Spiegel; neu erzeugt durch `tale init` und `tale update`. |

Der Reference-Baum ist byte-identisch zu den Schemas, gegen die die Plattform beim Deploy validiert. Behandle ihn als kanonisch: wenn ein Feldname in einer handgeschriebenen Config dem Reference widerspricht, gewinnt das Reference.

## Arbeiten mit dem Editor

Die Rules-Datei nennt drei Regeln, die jeder Editor beim Bearbeiten durchsetzt:

- **Agents binden, delegieren, hängen an.** Ein Agent kann gleichzeitig Connectors binden (`connectorBindings`), an andere Agents delegieren (`delegates`) und Workflows anhängen (`workflows`). Lies bestehende Configs, bevor du eine neue Bindung einführst.
- **Workflows nutzen Connector-Operations.** Ein Workflow-Schritt referenziert Connector-Operations, die in `connectors/<slug>/config.json` deklariert sind. Ein Schritt gegen eine nicht-existente Operation zu bearbeiten, lässt die Validierung scheitern.
- **Benennung ist erzwungen.** Agent-Dateinamen matchen `[a-z0-9][a-z0-9_-]*\.json`. Workflow-Step-Slugs matchen `[a-z0-9][a-z0-9_-]*`. Connector-Verzeichnisse sind kleingeschrieben alphanumerisch mit Bindestrichen oder Unterstrichen.

Wenn der Editor eine Änderung vorschlägt, frag ihn, welche Datei in `.tale/reference/` er zugrunde gelegt hat. Wenn er das nicht kann, erzeug den Spiegel mit `tale update` neu und versuch es nochmal.

## Cursor: Config-Ebene vs. Runtime-Ebene

Cursor taucht in Tale an zwei getrennten Stellen auf — verwechsle sie nicht.

| Ebene       | Was sie tut                                                                                                                         | Wo sie lebt                                                                                            |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Config**  | Hilft Cursor (oder einem anderen AI-Editor), Tale-Projekt-JSON auf deinem Rechner zu bearbeiten                                     | `.cursor/rules/tale.mdc`, `CLAUDE.md`, `.tale/reference/` — alles, was `tale init` schreibt            |
| **Runtime** | Führt die Cursor Agent CLI headless in einer isolierten Sandbox aus, wenn du mit dem eingebauten **Cursor**-External-Agent chattest | Chat-Picker → **Cursor**; Agent-JSON mit `primaryBehavior: "external-agent"` und `agentKind: "cursor"` |

Rules-Datei und Schema-Spiegel auf dieser Seite sind die **Config-Ebene**: Sie steuern einen lokalen Editor, während du Agents, Workflows und Connectors änderst. Die **Runtime-Ebene** ist ein verwalteter Sandbox-Turn — `agent -p --output-format stream-json` mit deinem `CURSOR_API_KEY`, normalisierter Fortschritt im Chat und Session-Resume über Follow-ups. Credentials, Modelle und Abrechnung für Runtime-Turns stehen in [External agents](/de/platform/agents/external-agent), nicht hier.

## Wo das hingehört

AI-gestützte Entwicklung ist der Bearbeitungspfad; Deployment ist der Veröffentlichungspfad. Sobald eine Config die Editor-Validierung passiert, gleicht [`tale deploy`](/de/self-hosted/install/cli-install) sie gegen die Plattform ab — derselbe Schema-Check, diesmal als Schranke. Für Features, die der Editor nicht erreicht (der In-Product-Builder, der visuelle Workflow-Editor), ist der [Platform-Reiter](/de/platform) die kanonische Oberfläche; der AI-Editor-Pfad hier ist für Projekte, die Config-as-Code bevorzugen.
