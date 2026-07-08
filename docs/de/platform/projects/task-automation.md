---
title: Aufgaben-Automatisierung
description: Das Standard-Task-Ops-Paket — wie die Zuweisung an einen Agenten ihn arbeiten lässt, das menschliche Review-Gate, Guardrails (Budgets, Parallelität, Sicherungen) und der Kill-Switch.
---

Eine Board-Aufgabe einem KI-Agenten zuzuweisen setzt ihn in Bewegung. Das **Task-Ops-Paket** — dreizehn dateibasierte Workflows, die jede Organisation erhält — deckt den gesamten Lebenszyklus ab: Triage, Ausführung, Review, Eskalation, SLA-Durchsetzung und Aufräumen. Jeder Workflow ist eine JSON-Datei, die deiner Organisation gehört: Schwellwerte anpassen, Prompts bearbeiten oder einzelne Trigger unter **Automatisierungen** deaktivieren.

## Die Ausführungsschleife

1. **Zuweisen** an einen Agenten (oder die _Triage für Unzugewiesenes_ bewertet und routet neue Aufgaben automatisch — sichere Treffer werden direkt zugewiesen, der Rest bekommt einen Vorschlags-Kommentar).
2. Der Agent **bestätigt** (Aufgabe wandert nach _In Arbeit_), arbeitet in seinem eigenen Aufgaben-Thread mit den Task-Werkzeugen und postet sein Ergebnis als Kommentar.
3. Die Aufgabe parkt bei **_In Review_** — Agenten können niemals _Erledigt_ setzen; diese Regel wird serverseitig erzwungen, unabhängig von jeder Workflow-Konfiguration.
4. Ein Mensch **gibt frei** (der einzige automatisierte Weg zu _Erledigt_) oder **fordert Änderungen an** — das Feedback reaktiviert denselben Agenten im gemeinsamen Thread und öffnet ein frisches Review-Gate. Reviews lassen sich aus dem Aufgaben-Detail oder direkt aus dem Posteingang beantworten.

Fehlschläge rollen die Aufgabe mit erklärendem Kommentar nach _Zu erledigen_ zurück. Manager im Agenten-Org-Chart **zerlegen** Wurzel-Aufgaben mit dem Label `epic` in Unteraufgaben für ihre direkten Reports, statt sie allein zu bearbeiten; die übergeordnete Aufgabe wartet, bis die letzte Unteraufgabe schließt, und rollt dann nach _In Review_.

## Mentions, Abhängigkeiten, Fristen

- **@-Mention eines Agenten** in einem Kommentar oder in der Aufgabenbeschreibung lässt ihn den erwähnenden Text lesen und handeln. `@` öffnet eine Autovervollständigung über Mitglieder und die Agenten des Projekts; der Composer zeigt vorab, ob jeder erwähnte Agent wirklich antworten wird (Automatisierung aus, Budget aufgebraucht, pausiert). Beim Bearbeiten einer Beschreibung triggern nur neu hinzugefügte Mentions; was die Automatisierung selbst schreibt, triggert niemanden.
- Schließt ein **Blocker**, erhalten abhängige Aufgaben eine Notiz zu verbleibenden Blockern; voll entblockte Agenten-Arbeit startet automatisch neu, Menschen werden benachrichtigt.
- **Fälligkeitsdaten** treiben eine vierstufige SLA-Leiter: 24h-Warnung, Überfälligkeits-Hinweis, direkter Lauf des Manager-Agenten, schließlich menschliche Eskalation an Projektersteller und Org-Admins. Jede Stufe feuert höchstens einmal; ein verschobenes Fälligkeitsdatum setzt die Leiter zurück.

## Guardrails

Jeder Agenten-Lauf — Zuweisung, Mention, Revision, Eskalation, extern — passiert dasselbe Zulassungs-Gate:

- **Budgets** (pro Agent, monatlich): an der Warnschwelle erhält der Agent eine Spar-Anweisung und Admins werden einmalig benachrichtigt; an der Pausenschwelle werden neue Läufe verweigert und offene Aufgaben gemäß Org-Richtlinie übergeben (an den Manager oder zurück in die Triage). Reset beim Monatswechsel.
- **Parallelitäts-Limits** (pro Agent und org-weit): überzählige Läufe warten und starten automatisch, sobald ein Slot frei wird.
- **Sicherung pro Aufgabe**: mehr als die konfigurierten Läufe pro Stunde auf einer Aufgabe pausieren deren Automatisierung, bis ein Mensch den Status ändert.

Org-weite Standards liegen unter **Einstellungen → Governance** (`agent_workforce`-Richtlinie); Budget und Parallelität pro Agent in dessen Konfiguration.

## Assignee wählen

Nicht jede Aufgabe gehört an einen Coding-Agenten. Faustregel:

| Aufgabenart                                                                           | Zuweisen                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recherche, Texte, Zusammenfassungen, persönliche Deliverables                         | Eine **Person** — deaktiviere unassigned Triage in persönlichen Projekten, damit Agenten sie nicht automatisch übernehmen                                                                                                                                     |
| Allgemeine Automatisierung mit Plattform-Tools (Kommentare, Workflows, Integrationen) | Einen **Agent** (Plattform-Tool-Schleife)                                                                                                                                                                                                                     |
| Repo-Arbeit — Bugs, Features, Refactors, PRs                                          | Einen **Coding-Agent** mit passendem Dispatch: tale-daemon (`runtime`) für Git-Workspaces, durable Sandbox wenn konfiguriert, oder akzeptiere, dass Sandbox-only-Coding-Agenten auf dem Board weiter die Plattform-Schleife nutzen, bis du diese Felder setzt |

Der Assignee-Picker trennt **Agenten** und **Coding-Agenten** und zeigt pro Coding-Agent eine Zeile Dispatch-Hinweis. Image-Agenten erscheinen nicht in der Assignee-Liste.

## Der Kill-Switch

**Agenten → Workforce** trägt den Hauptschalter: Aufgaben-Automatisierung auszuschalten pausiert die Trigger des Pakets UND den Ausführungspfad selbst — Laufendes endet, Neues startet nicht. Nur für Admins, auditiert. Details im [Operations-Runbook](/self-hosted/operate/workforce-operations).
