---
title: Einen Workflow mit Freigabe bauen
description: Verdrahte einen Drei-Schritt-Workflow, bei dem eine menschliche Freigabe zwischen Entwurf und Versand sitzt, lass ihn von Anfang bis Ende laufen und prüf den Audit-Trail.
---

Ein Workflow mit Freigabe ist die Form, zu der du greifst, wenn die Arbeit aus Entwurf, Entscheidung und Aktion besteht — und du einen Menschen zwischen Entwurf und Aktion willst. Das Freigabe-Gate pausiert den Lauf, bis jemand „Genehmigen" klickt; der nächste Schritt feuert nur bei grünem Licht. Dieser Spaziergang baut auf einer frischen Org einen Daily-Summary-Workflow mit einem Freigabe-Gate.

Du brauchst eine Editor-Rolle und einen Agent, der einen Entwurf produziert (der erste nützliche Agent aus [Deinen ersten Agent bauen](/de/tutorials/editor/first-agent-end-to-end) reicht). Die konzeptuelle Seite lebt in [Workflow-Konzepte](/de/platform/workflows/concepts) und [Freigabe-Konzepte](/de/platform/approvals/concepts); dieser Spaziergang ist der End-to-End-Mechanismus.

## Bevor du beginnst

Bestätige drei Dinge. Deine Rolle ist mindestens Editor — die Workflow-Bearbeitung ist auf Editor und höher begrenzt. Du hast einen Entwurfs-Agent bereit; ohne ihn hat Schritt 2 des Workflows nichts aufzurufen. Du bist Mitglied des Freigeber-Pools, den du in Schritt 3 zuweist, oder du hast eine Kollegin bereit, die genehmigt, damit der Lauf tatsächlich weiterläuft.

## Schritt 1 — Das Workflow-Gerüst erstellen

Der erste Zug ist die Workflow-Definition — der geordnete Behälter, in dem die Schritte leben. Leg aus der App, der der Workflow gehören soll, einen neuen Workflow an und setze:

- **Name** — `Daily inbox summary`
- **Trigger** — vorerst **Manuell**; du kannst ihn auf einen Schedule wechseln, sobald der Lauf funktioniert
- **Inputs** — leer lassen

Als Entwurf speichern. Das Gerüst existiert, hat aber keine Schritte; jetzt ausgeführt, käme er sofort zurück.

## Schritt 2 — Den Entwurfs-Schritt hinzufügen

Der Entwurfs-Schritt ist der Agent-Aufruf. Klick **Schritt hinzufügen > Agent aufrufen** und konfiguriere:

- **Agent** — der Entwurfs-Agent, den du bereit hast
- **Prompt** — `Summarise yesterday's unread customer messages into a paragraph and propose a single team-wide reply.`
- **Output-Variable** — `draft`

Speichern. Der Workflow hat jetzt einen Schritt; ein Lauf produziert eine `draft`-Variable, tut damit aber nichts.

## Schritt 3 — Das Freigabe-Gate hinzufügen

Das Freigabe-Gate ist die Naht zwischen Agent-Entwurf und Aktion. Klick **Schritt hinzufügen > Freigabe-Gate** und konfiguriere:

- **Titel** — `Review daily summary`
- **Body** — `{{ draft }}`, damit der Freigeber den ganzen Text auf der Karte sieht
- **Freigeber-Pool** — ein Team oder eine explizite User-Liste, in der du drin bist
- **Timeout** — 30 Minuten, eskaliere auf Fehlschlag

Speichern. Der Workflow pausiert jetzt auf diesem Schritt und wartet auf eine Entscheidung; Ablehnen beendet den Lauf.

## Schritt 4 — Den Aktions-Schritt hinzufügen und ausführen

Der Aktions-Schritt feuert nur, wenn das Gate auf Genehmigen aufgelöst wird. Klick **Schritt hinzufügen > Mail senden** (oder eine Aktion, die deine Org verdrahtet hat) und konfiguriere:

- **An** — deine eigene Adresse für diesen Spaziergang
- **Betreff** — `Daily inbox summary`
- **Body** — `{{ draft }}`

Speichern und **Veröffentlichen**. Klick **Ausführen**. Der Entwurfs-Schritt feuert; das Freigabe-Gate erscheint als Karte in deinem Posteingang; klick **Genehmigen**; der Mail-Schritt feuert; der Lauf endet. Die Execution-Ansicht zeigt drei Zeilen — Entwurf, Gate-Entscheidung, Mail — mit Zeitstempeln und dem Akteur am Gate.

## Wo das eingesetzt wird

Drei Schritte mit einem Gate sind der kleinste nützliche Workflow-mit-Freigabe: Agent entwirft, Mensch entscheidet, System handelt. Dieselbe Form skaliert — Manuell gegen Schedule tauschen, ein zweites Gate vor einem destruktiven Schritt einziehen, bei der Entscheidung verzweigen statt bei Ablehnung zu scheitern.

Für die Zustands-Maschine des Gates und die Routing-Regeln siehe [Freigaben in Workflows](/de/platform/workflows/approvals-in-workflows). Für die vier Stücke, aus denen jeder Workflow besteht, siehe [Workflow-Konzepte](/de/platform/workflows/concepts).
