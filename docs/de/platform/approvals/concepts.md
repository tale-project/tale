---
title: Freigaben für Aktionen verstehen
description: Erfahre, warum ein Connector-Schreibzugriff wartet, was Freigeben oder Ablehnen bewirkt und wo du das Ergebnis prüfst.
---

Mit einer Freigabe prüfst du einen geplanten Connector-Schreibzugriff, bevor er ausgeführt wird. Eine Automation kann zum Beispiel eine E-Mail vorbereiten und dann warten, bis du Empfänger und Inhalt vor dem Versand geprüft hast.

## Wann ein Schreibzugriff wartet

Ein Live-Lauf pausiert, sobald er einen Connector-Schreibzugriff erreicht, für den die Richtlinie der Organisation eine Freigabe verlangt. Standardmäßig brauchen Schreibzugriffe auf externe Systeme eine Freigabe; Schreibzugriffe über interne, durch die Plattform authentifizierte Connectors nicht. Die Organisation kann diese Regel für einen Connector oder eine einzelne Aktion ändern. Mehr dazu unter [Freigaben konfigurieren](/de/platform/approvals/configure).

Lesezugriffe verlangen keine Freigabe. Ein **Testlauf** nutzt simulierte Connectors: Er führt den externen Schreibzugriff nicht aus und zeigt dessen Live-Freigabekarte nicht. Ein bestandener Test belegt nicht, dass die geplante Live-Aktion angemessen ist.

## Die geplante Aktion prüfen

Öffne die [Laufliste](/de/platform/automations/execution-logs) der Automation und wähle den Lauf mit dem Status **Wartet**. Die Freigabekarte nennt die Aktion, etwa `imap-smtp.send`, und den anfragenden Knoten. **Der Schritt würde aufrufen mit** zeigt die genauen Eingaben.

Vergleiche Ziel, Empfänger, Inhalt und Kennungen mit der beabsichtigten Aufgabe. Prüfe auch sensible Angaben in den Eingaben, bevor du entscheidest:

- **Freigeben** erlaubt die Ausführung dieser Aktion, sobald der Lauf fortgesetzt wird.
- **Ablehnen** verhindert die Aktion; der Schritt und der Lauf schlagen fehl.

Auf der Karte kannst du die Aktion nicht bearbeiten. Ist eine Eingabe falsch, lehne sie ab, korrigiere den Workflow oder seine Eingaben und starte einen neuen Lauf.

<Note>

Organisationsmitglieder können über Connector-Aktionen entscheiden. Diese Karten werden keiner bestimmten prüfenden Person oder Gruppe zugewiesen; die Entscheidung erfolgt in den Laufdetails. Für andere Prüfverfahren können strengere Berechtigungen gelten.

</Note>

## Das Ergebnis prüfen

Eine Freigabe erlaubt die Ausführung, garantiert aber nicht, dass der Connector erfolgreich ist. Prüfe nach der Fortsetzung den Laufstatus, das Knotenergebnis und die Auswirkungen. Ein abgelehnter Lauf nennt die Ablehnung als Fehlergrund. Das [Audit-Protokoll](/de/platform/admin/governance/audit-logs) hält die Entscheidung und die handelnde Person fest.

Eine ausstehende Freigabe bleibt offen, wenn die Richtlinie gelockert wird. Dieselbe Aktion im selben Lauf behält ihre gespeicherte Entscheidung; ein neuer Lauf wird erneut bewertet. Ein beendeter oder abgebrochener Lauf kann eine noch offene Freigabe nicht mehr für seinen Schreibzugriff nutzen.

## Freigabe und Rückfrage unterscheiden

Ein Agent-Knoten kann auch pausieren, weil er Informationen von einer Person braucht. Deine Antwort liefert eine Eingabe; sie gibt keinen Connector-Schreibzugriff frei. [Freigaben in Workflows](/de/platform/automations/approvals-in-workflows) erklärt beide Abläufe. Für Aufgabenprüfungen, kontrollierte Dokumente und Löschanträge gelten eigene [Prüfregeln](/de/platform/approvals/configure).
