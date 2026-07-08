---
title: Aufgaben-Automatisierung
description: Das Standard-Task-Ops-Paket — wie die Zuweisung an einen Agenten ihn arbeiten lässt, das menschliche Review-Gate, Guardrails (Budgets, Parallelität, Sicherungen) und der Kill-Switch.
---

Eine Board-Aufgabe einem KI-Agenten zuzuweisen setzt ihn in Bewegung. Das **Task-Ops-Paket** — elf dateibasierte Workflows, die jede Organisation erhält — deckt den gesamten Lebenszyklus ab: Triage, Ausführung, Review, Eskalation, SLA-Durchsetzung und Aufräumen. Jeder Workflow ist eine JSON-Datei, die deiner Organisation gehört: Schwellwerte anpassen, Prompts bearbeiten oder einzelne Trigger direkt am Workflow deaktivieren. Eine Aufgabe, die eine Automatisierung vorschlägt, liegt im [Backlog](/de/platform/projects/backlog), bis ein Mensch sie startet — von diesem Moment an ist sie eine Board-Aufgabe wie jede andere und tritt in die Schleife unten ein.

## Die Ausführungsschleife

1. **Zuweisen** an einen Agenten (oder die _Triage für Unzugewiesenes_ bewertet und routet neue Aufgaben automatisch — sichere Treffer werden direkt zugewiesen, der Rest bekommt einen Vorschlags-Kommentar).
2. Der Agent **bestätigt** (Aufgabe wandert nach _In Arbeit_), arbeitet in seinem eigenen Aufgaben-Thread mit den Task-Werkzeugen und postet sein Ergebnis als Kommentar.
3. Die Aufgabe parkt bei **_In Review_** — Agenten können niemals _Erledigt_ setzen; diese Regel wird serverseitig erzwungen, unabhängig von jeder Workflow-Konfiguration.
4. Ein Mensch **gibt frei** (der einzige automatisierte Weg zu _Erledigt_) oder **fordert Änderungen an** — das Feedback reaktiviert denselben Agenten im gemeinsamen Thread und öffnet ein frisches Review-Gate. Reviews lassen sich aus dem Aufgaben-Detail oder direkt aus dem Posteingang beantworten.

Fehlschläge rollen die Aufgabe mit erklärendem Kommentar nach _Zu erledigen_ zurück. Hat eine zerlegte Wurzel-Aufgabe Unteraufgaben, wartet die übergeordnete Aufgabe, bis die letzte Unteraufgabe schließt, und rollt dann nach _In Review_.

## Mentions, Abhängigkeiten, Fristen

- **@-Mention eines Agenten** in einem Kommentar oder in der Aufgabenbeschreibung lässt ihn den erwähnenden Text lesen und handeln. `@` öffnet eine Autovervollständigung über Mitglieder und die Agenten des Projekts; der Composer zeigt vorab, ob jeder erwähnte Agent wirklich antworten wird (Automatisierung aus, Budget aufgebraucht, pausiert). Beim Bearbeiten einer Beschreibung triggern nur neu hinzugefügte Mentions; was die Automatisierung selbst schreibt, triggert niemanden.
- Schließt ein **Blocker**, erhalten abhängige Aufgaben eine Notiz zu verbleibenden Blockern; voll entblockte Agenten-Arbeit startet automatisch neu, Menschen werden benachrichtigt.
- **Fälligkeitsdaten** treiben eine SLA-Leiter: 24h-Warnung, Überfälligkeits-Hinweis, dann menschliche Eskalation an Projektersteller und Org-Admins — bleibt die Aufgabe überfällig, wiederholt sie sich einmal. Jede Stufe feuert höchstens einmal; ein verschobenes Fälligkeitsdatum setzt die Leiter zurück.

## Guardrails

Jeder Agenten-Lauf — Zuweisung, Mention, Revision, Eskalation, extern — passiert dasselbe Zulassungs-Gate:

- **Budgets** (pro Agent, monatlich): an der Warnschwelle erhält der Agent eine Spar-Anweisung und Admins werden einmalig benachrichtigt; an der Pausenschwelle werden neue Läufe verweigert. Reset beim Monatswechsel.
- **Parallelitäts-Limits** (pro Agent und org-weit): überzählige Läufe warten und starten automatisch, sobald ein Slot frei wird.
- **Sicherung pro Aufgabe**: mehr als die konfigurierten Läufe pro Stunde auf einer Aufgabe pausieren deren Automatisierung, bis ein Mensch den Status ändert.

Org-weite Limits (Lauf-Parallelität, Läufe pro Aufgabe und Stunde) sind feste Plattform-Standards; Budget und Parallelität pro Agent liegen in dessen Konfiguration.

## Der Kill-Switch

Die Governance-Richtlinie `task_automation` trägt den Hauptschalter: `enabled: false` in der Konfigurationsdatei `governance/task-automation.json` der Organisation stoppt den Ausführungspfad — Laufendes endet, Neues startet nicht. Nur für Admins, auditiert.
