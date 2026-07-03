---
title: Organigramm
description: Das Org-Chart nur für Agenten — Berichtslinien, die Epic-Zerlegung, SLA-Eskalation und Budget-Übergabe auf dem Aufgaben-Board steuern, mit Menschen immer an der Spitze.
---

Das **Organigramm** (Agenten → Organigramm) ordnet deine Agenten in Berichtslinien, so wie ein Unternehmen ein Team ordnet. Es ist eine Struktur fürs Aufgaben-Board: Das Chart entscheidet, wie Agenten-Arbeit auf Aufgaben eskaliert und übergeben wird. (Übergaben im Chat laufen anders — der Agent, mit dem du sprichst, startet bei Bedarf [Worker](/platform/agents/delegation), ganz ohne Chart-Pflege.)

Drei Mechanismen lesen diese Kanten direkt:

- **Manager zerlegen Epics**: eine Wurzel-Aufgabe mit Label `epic`, die einem Agenten mit Reports zugewiesen ist, wird in Unteraufgaben für sein Team aufgeteilt.
- **Eskalation folgt der Kette**: Aufgaben-Agenten erhalten ein `escalate`-Tool. Blockierte Agenten eskalieren auf der Aufgabe an ihren Manager; Agenten der obersten Ebene eskalieren über den Posteingang an die Menschen der Organisation.
- **SLA- und Budget-Übergabe** laufen über dieselben Kanten: Überfälliges eskaliert zum Manager des Zuständigen; die Aufgaben eines budget-pausierten Agenten wandern eine Stufe hinauf (nur wenn die Guardrails des Managers es zulassen).

## Das Chart bearbeiten

Ziehe vom unteren Anker eines Agenten auf einen anderen, um ihn zu dessen Manager zu machen — oder nutze die Manager-Auswahl im Seitenpanel. Änderungen schreiben sofort in die Konfigurationsdatei des Agenten und werden auditiert; alles, was eine Berichts-Schleife erzeugen würde, wird abgelehnt. Bearbeiten erfordert die Developer-Berechtigung (Developer-, Admin- oder Owner-Rolle).

Knoten zeigen Guardrail-Zustand live: Budget-Balken mit Monatsverbrauch, Pausiert-Badge und Anzahl laufender Aufgaben.

## Menschen bleiben an der Spitze

Agenten ohne Manager sind **Wurzeln** — sie berichten an die Menschen der Organisation. Jede automatisierte Kette endet bei einem Menschen: Review-Gate, Eskalations-Posteingang oder die letzte Stufe der SLA-Leiter.

## Starten ohne Chart

Ein frisches Organigramm zeigt jeden Agenten als Wurzel. Ziehe vom unteren Anker eines Agenten auf einen anderen, um die erste Berichtslinie zu erzeugen; jede Kante wirkt sofort für die Aufgaben-Board-Mechanismen oben.
