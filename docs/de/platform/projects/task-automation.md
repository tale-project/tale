---
title: Aufgaben-Automatisierung
description: Das Standard-Task-Ops-Paket — wie die Zuweisung an einen Agenten ihn arbeiten lässt, die Prüfung direkt über den Status In Prüfung, Leitplanken (Budgets, Parallelität, Sicherungen) und der Notausschalter.
---

Eine Board-Aufgabe einem KI-Agenten zuzuweisen setzt ihn in Bewegung. Das **Task-Ops-Paket** — elf dateibasierte Workflows, die jede Organisation erhält — deckt den gesamten Lebenszyklus ab: Triage, Ausführung, Review, Eskalation, SLA-Durchsetzung und Aufräumen. Jeder Workflow ist eine schlichte JSON-Datei, die deiner Organisation gehört: Schwellwerte anpassen, Prompts bearbeiten oder einzelne Trigger direkt am Workflow deaktivieren. Eine Aufgabe, die eine Automatisierung vorschlägt, liegt im [Backlog](/de/platform/projects/backlog), bis ein Mensch sie startet — von diesem Moment an ist sie eine Board-Aufgabe wie jede andere und tritt in die Schleife unten ein.

<Frame caption="Das Aufgaben-Board eines Projekts — eine Karte einem Agenten zuzuweisen startet die Schleife unten.">

![Ein Kanban-Aufgaben-Board im Projekt Website-Relaunch mit sieben Aufgabenkarten, verteilt über seine Status-Spalten, von Backlog und Zu erledigen über In Prüfung bis Erledigt und Abgebrochen.](/images/platform/projects-task-board.webp)

</Frame>

## Die Ausführungsschleife

1. **Zuweisen** an einen Agenten (oder die _Triage für Unzugewiesenes_ bewertet und routet neue Aufgaben automatisch — sichere Treffer werden direkt zugewiesen, der Rest bekommt einen Vorschlags-Kommentar).
2. Der Agent **bestätigt** (Aufgabe wandert nach _In Bearbeitung_), arbeitet in seinem eigenen Aufgaben-Thread mit den Task-Werkzeugen und postet sein Ergebnis als Kommentar.
3. Die Aufgabe parkt bei **_In Prüfung_** — Agenten können niemals _Erledigt_ setzen; diese Regel wird serverseitig erzwungen, unabhängig von jeder Workflow-Konfiguration.
4. Ein Mensch **prüft direkt aus der Spalte _In Prüfung_** — das Aufgaben-Detail bringt alles Nötige mit: den Bericht des Agenten, das Live-Protokoll hinter jedem Aktivitäts-Badge und die Kommentare. Zum Abschließen die Aufgabe nach _Erledigt_ ziehen; für Nacharbeit den Zugewiesenen per @-Erwähnung ansprechen — ein laufender Agent nimmt den Kommentar mitten im Lauf auf, ein untätiger startet einen Nacharbeits-Lauf und parkt die Aufgabe wieder bei _In Prüfung_. Keine Freigabe-Karte unterbricht den Fluss — und keine Automatisierung setzt je _Erledigt_.

Fehlschläge rollen die Aufgabe mit erklärendem Kommentar nach _Zu erledigen_ zurück. Hat eine zerlegte Wurzel-Aufgabe Unteraufgaben, wartet die übergeordnete Aufgabe, bis die letzte Unteraufgabe schließt, und rollt dann nach _In Prüfung_ hoch.

## Erwähnungen, Abhängigkeiten, Fristen

- **Erwähne einen Agenten mit @** in einem Aufgabenkommentar oder in der Beschreibung, und er liest den erwähnenden Text und handelt. Ein getipptes `@` öffnet eine Autovervollständigung über Mitglieder und die Agenten des Projekts; der Chat zeigt vorab, ob jeder erwähnte Agent wirklich antworten wird (Automatisierung aus, Budget aufgebraucht, pausiert). Das Bearbeiten einer Beschreibung oder eines Kommentars löst nur neu hinzugekommene Erwähnungen aus, und was die Automatisierung selbst schreibt, löst nie jemanden aus. Erwähnungen bewegen das Board nicht — mit einer Ausnahme: Ist der erwähnte Agent der **Zugewiesene** der Aufgabe, gilt die Erwähnung als neuer Anlauf seiner zugewiesenen Arbeit und folgt der Zuweisungs-Choreografie — _In progress_, solange der zugelassene Lauf arbeitet, _In review_ bei Erfolg, und bei einem Fehlschlag zurück auf _To do_ mit einem erklärenden Kommentar.
- Schließt ein **Blocker**, bekommen abhängige Aufgaben einen Hinweis auf die verbleibenden Blocker; vollständig entblockte Agenten-Arbeit startet automatisch neu, menschliche Arbeit bekommt eine Benachrichtigung in die Inbox.
- **Fälligkeitsdaten** treiben eine SLA-Leiter: eine 24-Stunden-Warnung, ein Überfällig-Anstoß, dann eine menschliche Eskalation an die Person, die das Projekt erstellt hat, und die Org-Admins — bleibt die Aufgabe überfällig, wiederholt sie sich noch einmal. Jede Stufe feuert höchstens einmal; das Verschieben der Frist nach hinten setzt die Leiter zurück.

## Leitplanken

Jeder Agenten-Lauf — Zuweisung, Erwähnung, Überarbeitung, Eskalation, extern — passiert dasselbe Zulassungstor:

- **Budgets** (pro Agent, monatlich): An der Warnschwelle bekommt der Agent eine Sparsamkeits-Anweisung, und die Admins werden einmal benachrichtigt; an der Pausenschwelle werden neue Läufe abgewiesen. Budgets setzen sich am Monatswechsel zurück.
- **Parallelitäts-Deckel** (pro Agent und org-weit): Überzählige Läufe warten in der Schlange und starten automatisch, sobald ein Platz frei wird.
- **Sicherung pro Aufgabe**: Mehr als die konfigurierten Läufe pro Stunde auf einer Aufgabe pausieren die Automatisierung auf dieser Aufgabe, bis ein Mensch ihren Status ändert.

Org-weite Deckel (Lauf-Parallelität, Läufe pro Aufgabe und Stunde) sind feste Plattform-Standardwerte; Budget und Parallelität pro Agent liegen in der Konfiguration des Agenten.

## Den richtigen Bearbeiter wählen

Nicht jede Aufgabe gehört auf einen Sandbox-Agenten. Als Faustregel:

| Aufgabenform                                                                          | Zuweisen an                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recherche, Texte, Zusammenfassungen, persönliche Liefergegenstände                    | Eine **Person** — schalte die Sichtung unzugewiesener Aufgaben in persönlichen Projekten ab, damit Agents sie nicht automatisch übernehmen                                                                 |
| Allgemeine Automatisierung mit Plattform-Tools (Kommentare, Workflows, Integrationen) | Einen **Agent** (Plattform-Tool-Schleife)                                                                                                                                                                  |
| Repository-Arbeit — Bugs, Features, Refactorings, PRs                                 | Einen **Sandbox-Agenten** mit dem passenden Dispatch: Durable-Sandbox wo konfiguriert — oder akzeptiere, dass Sandbox-only-Agents auf dem Board die Plattform-Schleife nutzen, bis du diese Felder ergänzt |

Die Bearbeiter-Auswahl gruppiert **Agents** und **Sandbox-Agents** getrennt und zeigt zu jedem Sandbox-Agenten einen einzeiligen Dispatch-Hinweis.

## Der Notausschalter

Die Governance-Richtlinie `task_automation` trägt den Hauptschalter: Schaltest du sie aus, stoppt der Ausführungspfad — laufende Arbeit endet noch, Neues startet nicht. Der Schalter ist Admins vorbehalten und wird auditiert; auf einer selbst gehosteten Instanz ist die Richtlinie eine der Governance-Konfigurationsdateien der Organisation, neben den Limits, die [Richtlinien und Limits](/de/platform/admin/governance/policies-and-limits) behandelt.

## Wo das hingehört

Aufgaben-Automatisierung macht aus dem Projekt-Board eine Delegationsfläche statt einer To-do-Liste: Ein Mensch weist zu und schließt ab, das Paket erledigt alles dazwischen, und _Erledigt_ bleibt eine menschliche Entscheidung. Die natürliche nächste Lektüre ist [Backlog](/de/platform/projects/backlog) dafür, wie vorgeschlagene Arbeit in die Schleife gelangt, und [Der Workflow-Editor](/de/platform/automations/editor) fürs Feintuning der paketeigenen Workflows.
