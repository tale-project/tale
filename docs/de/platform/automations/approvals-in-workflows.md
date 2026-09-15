---
title: Auf einen wartenden Workflow reagieren
description: Finde einen pausierten Automationslauf, prüfe einen geplanten Schreibzugriff oder beantworte eine Rückfrage des Agenten.
---

Ein Lauf kann auf eine Entscheidung vor einem Connector-Schreibzugriff warten oder auf Informationen, die ein Agent zum Fortfahren braucht. In den Laufdetails siehst du, welche Antwort nötig ist. Ein wartender Lauf ist noch nicht abgeschlossen, auch wenn vorherige Knoten erfolgreich waren.

## Den wartenden Lauf finden

Öffne die Automation und ihre [Ausführungsprotokolle](/de/platform/automations/execution-logs). Wähle den Lauf mit dem Status **Wartet**. Prüfe Version und Eingaben, damit du die richtige Ausführung beurteilst.

Eine Freigabekarte nennt eine Connector-Aktion und zeigt ihre geplanten Eingaben. Eine Rückfrage des Agenten verlangt dagegen eine Antwort, als Auswahl oder Freitext. Beides ist getrennt: Mit einer Antwort gibst du keinen späteren Schreibzugriff frei.

## Einen Schreibzugriff freigeben oder ablehnen

Lies die Aktion und die Angaben unter **Der Schritt würde aufrufen mit** genau. Prüfe Empfänger oder Ziel, den Inhalt und alle Kennungen, die bestimmen, was geändert wird.

Wähle **Freigeben**, um die Aktion zu erlauben. Der Lauf wird fortgesetzt und versucht den Schreibzugriff; kontrolliere danach Knotenergebnis und Auswirkungen. Wähle **Ablehnen**, wenn die Anfrage falsch ist oder nicht ausgeführt werden soll. Die Ablehnung verhindert diese Aktion und lässt den Lauf fehlschlagen.

Auf der Freigabekarte kannst du keine Parameter ändern. Lehne eine falsche Anfrage ab, korrigiere den Workflow oder seine Eingaben und teste die Änderung vor einem neuen Live-Lauf. Änderungen an der Freigaberichtlinie geben eine bereits offene Karte nicht frei. [Freigabekonzepte](/de/platform/approvals/concepts) erklärt den Ablauf; die [Konfiguration der Freigaberichtlinie](/de/self-hosted/configuration/approvals) beschreibt die Regeln für den Betrieb.

## Eine Rückfrage des Agenten beantworten

Nutzt ein Agent-Knoten `ask_human`, zeigen die Laufdetails **Der Agent braucht deine Antwort, um weiterzumachen**. Beantworte vorgegebene Auswahlfragen direkt auf der Karte. Bei einer offenen Frage schreibst du unter **Deine Antwort** einen Text und klickst auf **Antwort senden & fortsetzen**.

Gib die fehlende Information möglichst konkret an. Fragt der Agent nach einem Dokument, nenne das Dokument oder seine Kennung, statt ihn nur zum Fortfahren aufzufordern. Der wartende Knoten wird mit deiner Antwort fortgesetzt. Später kann der Lauf eine weitere Antwort oder eine Freigabe benötigen. Organisationsmitglieder können diese Rückfragen beantworten.

## Den Workflow korrigieren und testen

Eine Workflow-Definition zu ändern ist ein anderer Vorgang als auf ihren laufenden Durchgang zu reagieren. Speichere eine korrigierte Version im [Workflow-Editor](/de/platform/automations/editor), teste sie mit simulierten Connectors und schalte sie anschließend für den Live-Betrieb frei. Das Speichern einer Version ändert keinen Aufruf, der bereits auf Freigabe wartet.

<Frame caption="Bearbeite den Workflow auf der Zeichenfläche; prüfe wartende Ausführungen in ihren Laufdetails.">

![Der Workflow-Editor zeigt den Automationsgraphen und einen Bereich zum Konfigurieren des ausgewählten Knotens.](/images/platform/automation-editor-canvas.webp)

</Frame>

Ein Test mit simulierten Connectors führt keine externen Schreibzugriffe aus und verlangt dafür keine Live-Freigaben. Ein praktisches Beispiel findest du unter [Einen Workflow mit Freigaben erstellen](/de/tutorials/editor/workflow-with-approvals). Prüfe nach einer Live-Entscheidung das Laufergebnis und das [Audit-Protokoll](/de/platform/admin/governance/audit-logs): Die Erlaubnis zur Ausführung und eine erfolgreiche Ausführung sind unterschiedliche Ergebnisse.
