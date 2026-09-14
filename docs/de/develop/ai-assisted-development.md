---
title: Konfiguration mit einem Coding-Agenten bearbeiten
description: Gib einem Coding-Agenten den passenden Projektkontext, unterscheide Vorlagen von aktiver Konfiguration und prüfe Änderungen vor dem Deployment.
---

Ein Coding-Agent kann dir helfen, ein mit der CLI verwaltetes Tale-Konfigurationsprojekt zu bearbeiten. Das Projekt enthält Anweisungen, Konfigurationsbeispiele und ausgewählten Quellcode als Referenz. Prüfe den Vorschlag trotzdem selbst und kläre, welche Organisationen er betrifft.

Änderungen am Tale-Anwendungsquellcode folgen einem anderen Ablauf. Beginne dafür mit [Entwicklungsumgebung einrichten](/de/develop/contributor-setup) und der `AGENTS.md` des Repositorys.

## Eine Arbeitsumgebung anlegen

Installiere die [Tale-CLI](/de/self-hosted/install/cli-install) und lege das Konfigurationsprojekt in einem neuen Verzeichnis an:

```bash
tale init agent-config-example --no-env
cd agent-config-example
ls -a
```

Dieser Auszug zeigt die erzeugten Pfade:

```text
AGENTS.md
CLAUDE.md
default/
.gitignore
.tale/
tale.json
```

`--no-env` überspringt die Umgebungseinrichtung. Der Aufruf erzeugt weder eine betriebsbereite Installation noch eine `.env`. So kannst du die Konfiguration zunächst ohne Container prüfen. Wenn du später `tale dev` ausführst, richtet die CLI die lokale Umgebung ein. Prüfe vorher die [Voraussetzungen des Schnellstarts](/de/self-hosted/install/quickstart).

Öffne das Verzeichnis in deinem Editor. Lass den Agenten zuerst `AGENTS.md`, passende vorhandene Konfigurationen und den Quellcode unter `.tale/reference/` lesen.

## Die beiden Anweisungsdateien

`AGENTS.md` enthält die Tale-Konfigurationshinweise. `CLAUDE.md` verweist darauf, damit nur ein gemeinsamer Anweisungstext gepflegt werden muss. Die CLI erkennt auch eine vorhandene `AGENT.md` oder eine `CLAUDE.md` unter `.claude/`.

Die CLI verwaltet den Abschnitt zwischen den Kommentar-Markierungen `tale:begin` und `tale:end`. Ergänze eigene Projektregeln außerhalb dieses Abschnitts; Initialisierung und Updates erhalten diesen umgebenden Text. Zugangsdaten gehören in keine der beiden Dateien.

Die CLI erzeugt keine getrennten Regeln für Cursor, Windsurf oder Copilot. Falls dein Editor die Projektanweisungen nicht automatisch lädt, füge sie ausdrücklich zum Kontext hinzu. Prüfe die tatsächlichen Konfigurationsschemata, statt dich auf das Wissen des Agenten über ältere Releases zu verlassen.

## Die Verzeichnisse unterscheiden

| Pfad | Verwendung |
| --- | --- |
| `default/agents/` | Agentenkatalog mit dem mitgelieferten Beispiel für einen Coding-Agenten. |
| `default/automations/` | Automatisierungen, die installiert oder bereitgestellt werden können. Eine Datei auf dem Datenträger ist noch keine aktive Automatisierung. |
| `default/skills/` | Skill-Bundles für Dokumente und visuelle Analysen; jedes Bundle liegt in einem Verzeichnis. |
| `default/branding/` | Branding-Konfiguration und Bilddateien der Vorlage. |
| `default/governance/` | Beispiele für Richtlinien und Aufbewahrung. Halte dich an die Dateiformate deiner installierten CLI. |
| `default/README.md` | Erläutert die Vorlage und welche Katalogeinträge automatisch installiert werden. |
| `.tale/reference/` | Ausgewählter Quellcode, den die CLI mitliefert. Nutze ihn zum Lesen; die nächste Generierung ersetzt Änderungen. Er ist kein vollständiger Repository-Checkout. |
| `.tale/orgs/<slug>/<domain>/` | Laufzeitkonfiguration tatsächlich in der App angelegter Organisationen. |
| `.tale/checksums.json` | Prüfsummen der erzeugten Dateien, anhand derer Updates lokale Änderungen erkennen. |

`default/` ist die Vorlage für neue Organisationen, keine selbst bereitstellbare Organisation. Eine Änderung daran aktualisiert eine vorhandene Organisation nicht automatisch. Git ignoriert `.tale/` und die Geheimnisdateien; öffentliche Vorlagendateien gehören in die Versionsverwaltung.

## Die Referenz aktuell halten

`tale update` aktualisiert die CLI innerhalb ihrer Release-Reihe und erneuert erzeugte Projektinhalte. Es erstellt die Referenz neu, aktualisiert verwaltete Anweisungsabschnitte, ergänzt neue Katalogdateien und ersetzt unveränderte Dateien anhand ihrer Prüfsummen. Lokal bearbeitete Katalogdateien bleiben erhalten, solange du nicht `--force` verwendest.

Prüfe geplante Änderungen mit `tale update --dry-run`. Halte öffentliche Konfiguration unter Versionsverwaltung und sichere Laufzeitkonfiguration sowie Geheimnisse geschützt. Pflege einen eigenen Fork nicht in `.tale/reference/`. Ein CLI-Update ersetzt keine laufenden Container. Für die bereitgestellte Version gilt die [Upgrade-Anleitung](/de/self-hosted/operate/upgrades).

## Cursor beim Bearbeiten und bei der Ausführung

Ein Editor-Agent in diesem Verzeichnis ändert lokale Konfigurationsdateien. Ein Tale-[Projektagent](/de/platform/projects/project-agents) mit Cursor-Harness arbeitet dagegen in einer von Tale verwalteten Sandbox. Beide Kontexte haben eigene Zugangsdaten und unterschiedliche Auswirkungen.

Der Sandbox-Harness nutzt sein konfiguriertes Anbieterkonto und Modell. Die Projektanweisungen im Editor richten dieses Konto nicht ein. Den Laufzeitaufbau erklären die [Harnesses](/de/platform/agents/harnesses).

## Einen Vorschlag prüfen und anwenden

1. Begrenze den Auftrag auf eine konkrete Änderung. Benenne, ob sie die Vorlage für neue Organisationen oder eine vorhandene Organisation betrifft.
2. Prüfe jeden geänderten Pfad, Schemawert, Slug und Zugangsdatenverweis. Halte Geheimnisse aus Prompt und öffentlichem Diff heraus.
3. Validiere oder teste über die passende Produktoberfläche. Prüfe bei einer Automatisierung die Validierung und ihre Mock-Tests vor dem Deployment.
4. Kontrolliere Deployment-Plan und Zielorganisation. `tale deploy --override` kann Laufzeitkonfiguration durch die lokale Kopie ersetzen; nutze es nur für ein bewusst geprüftes Überschreiben.
5. Lies die gespeicherte Konfiguration zurück und teste das Verhalten nach dem Deployment.

Schlägt der Agent ein Feld vor, das im installierten Schema fehlt, korrigiere den Vorschlag vor der Bereitstellung. Bleibt eine vorhandene Organisation nach einer Änderung an `default/` unverändert, prüfe das Ziel, statt die Vorlage wiederholt bereitzustellen.
