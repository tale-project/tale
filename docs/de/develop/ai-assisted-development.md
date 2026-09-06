---
title: AI-gestützte Entwicklung
description: Wie ein Coding-Agent ein Tale-Projekt bearbeitet — die AGENTS.md und CLAUDE.md, die die CLI schreibt, der Quell-Spiegel unter .tale/reference/ und die org-first-Struktur der Konfigurationsdateien.
---

Ein Tale-Projekt ist ein Verzeichnis aus reinen Konfigurationsdateien — Agenten, Skills, Branding, Provider, Connectors —, angelegt pro Organisation, und diese Struktur bearbeitet sich gut mit einem Coding-Agenten, sobald er die Regeln kennt. Die CLI schreibt dir diese Regeln: eine `AGENTS.md` im Projekt-Root mit der vollständigen Anleitung, eine `CLAUDE.md`, die darauf verweist, und einen schreibgeschützten Spiegel des Plattform-Quellcodes unter `.tale/reference/`, den beide Dateien den Agenten lesen lassen, bevor er eine Config anfasst.

Lies das, wenn du ein Tale-Projekt mit Claude Code oder einem anderen Agenten ändern willst, der `AGENTS.md` liest, ohne die Konfiguration von Hand zu tippen. Komm zurück, wenn der Agent Felder erfindet — die Lösung ist fast immer, ihn `.tale/reference/` noch einmal lesen zu lassen oder den Spiegel mit `tale update` aufzufrischen.

## Ein durchgespieltes Setup

`tale init` legt Projekt, Anleitungsdateien und Spiegel in einem Schritt an. Das ist der gesamte Baum, den es hinterlässt:

```bash
tale init my-org --no-env
cd my-org
ls -a
```

```text
AGENTS.md  CLAUDE.md  default  .gitignore  .tale  tale.json
```

`--no-env` überspringt für diesen Durchlauf nur die `.env`-Abfrage. Die Zusammenfassung, die der Befehl ausgibt, nennt, was er gesät hat — einen Agenten im Katalog, fünf Skill-Bundles, eine Branding-Datei — und die nächsten Schritte: `tale dev` startet die Instanz lokal, `tale deploy` veröffentlicht sie, wenn du bereit bist.

## Die zwei Anleitungsdateien

`AGENTS.md` trägt die Anleitung: die org-first-Struktur, die Benennungsregeln für Slugs und Dateinamen, den Umgang mit Secrets und eine Direktive, die den größten Teil der Arbeit erledigt:

> Before creating or editing any config, read the relevant schemas and implementation code in `.tale/reference/` to understand the valid structure, fields, and constraints. Use existing config files in the project as examples.

`CLAUDE.md` gibt es, weil Claude Code `CLAUDE.md` liest und nicht `AGENTS.md`; sie enthält einen Verweis auf `AGENTS.md` und sonst nichts, damit es eine einzige Quelle der Wahrheit gibt. Beide Dateien werden in einem verwalteten Block geschrieben — von `<!-- tale:begin -->` bis `<!-- tale:end -->` —, und alles, was du außerhalb der Marker ergänzt, überlebt jedes `tale init --force` und jedes `tale update`. Editor-spezifische Regeldateien schreibt die CLI nicht: keine `.cursor/rules`, keine `.windsurfrules`, keine Copilot-Anweisungen. Ein Agent, der der `AGENTS.md`-Konvention folgt, liest die Datei von selbst; einen, der das nicht tut, zeigst du von Hand darauf.

## Was wo liegt

Konfiguration und Spiegel liegen nebeneinander unter dem Projekt-Root. Alles unter `default/` gehört dir — bearbeiten und committen; alles unter `.tale/` ist generiert und von git ignoriert.

| Pfad                                                              | Was es ist                                                                                                                                                                                    |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `default/agents/`                                                 | Eine YAML-Datei pro Agent-Persona; `coding-agent.yml` kommt mit.                                                                                                                              |
| `default/skills/`                                                 | Ein Verzeichnis pro Skill-Bundle; `docx`, `pdf`, `pptx`, `xlsx` und `visual-aspect-analyzer` kommen mit.                                                                                      |
| `default/branding/`                                               | `branding.json` und ein Ordner `images/` für hochgeladene Assets.                                                                                                                             |
| `default/automations/`                                            | Eine Datei pro Automatisierung — die 25 mitgelieferten Automatisierungen kommen als Katalog mit, aus dem du deployst.                                                                          |
| `default/governance/`                                             | Governance-Richtlinien der Organisation, je eine `<policyType>.json`, dazu der Grenzwert-Katalog `retention.json`; verschlüsselte `*.secrets.json`-Sidecars werden nie angelegt.                 |
| `default/README.md`                                               | Erklärt den Baum; verwaltet wie die anderen Gerüstdateien.                                                                                                                                    |
| `.tale/reference/`                                                | Schreibgeschützter Quellcode der Plattform — `backend/` und `lib/`, inklusive der gemeinsamen Schemas, gegen die eine Config validiert wird. Neu erzeugt durch `tale init` und `tale update`. |
| `.tale/orgs/<slug>/<domain>/`                                     | Laufzeit-Konfiguration der Organisationen, die in der App entstehen; `tale deploy --override` schiebt sie hoch.                                                                               |
| `.tale/checksums.json`                                            | Der Hash jeder Gerüstdatei, damit `tale update` deine Änderungen von seinen eigenen unterscheiden kann.                                                                                       |

`default` ist die Vorlage, aus der jede neue Organisation gesät wird — nie selbst eine deploybare Organisation. Echte Organisationen entstehen in der App und liegen unter `.tale/orgs/`.

## Den Spiegel frisch halten

`tale update` hebt die CLI auf das neueste Release ihrer Linie und synchronisiert die Projektdateien nach: Es schreibt die verwalteten Blöcke von `AGENTS.md` und `CLAUDE.md` neu, erzeugt `.tale/reference/` frisch, ergänzt neue Gerüstdateien, überschreibt die, die du nie angefasst hast, und lässt jede Datei in Ruhe, deren Prüfsumme deine Änderung zeigt — `--force` setzt das außer Kraft, `--dry-run` zeigt vorher den Plan. Danach rollst du die Container mit `tale deploy`.

## Cursor: Config-Ebene vs. Runtime-Ebene

Cursor taucht in Tale an zwei getrennten Stellen auf — verwechsle sie nicht. Die **Config-Ebene** ist diese Seite: `AGENTS.md`, `CLAUDE.md` und `.tale/reference/` steuern Cursor, während es auf deinem Rechner Konfiguration bearbeitet. Die **Runtime-Ebene** ist ein [Projekt-Agent](/de/platform/projects/project-agents), dessen **Agent-Laufzeit** das Cursor-Harness ist: Tale führt die Cursor Agent CLI (`agent -p`) headless in einer isolierten Sandbox mit deinem `CURSOR_API_KEY` aus und meldet sich auf der Aufgabe zurück, ohne deine Arbeitskopie zu berühren. Credentials, Modelle und Abrechnung dieser Ebene stehen in [Harnesses](/de/platform/agents/harnesses), nicht hier.

## Wo das hingehört

AI-gestützte Entwicklung ist der Bearbeitungspfad; `tale deploy` ist der Veröffentlichungspfad. Der Agent liest `AGENTS.md`, prüft `.tale/reference/` und bearbeitet Dateien unter `default/`; du prüfst den Diff, siehst dir das Ergebnis mit `tale dev` lokal an und veröffentlichst mit `tale deploy` — mit `--override`, wenn die Änderung die Konfiguration überschreiben soll, die die Container bereits halten. Die CLI selbst, ihre Befehle und Flags, ist unter [Die tale-CLI installieren](/de/self-hosted/install/cli-install) dokumentiert.
