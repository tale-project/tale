---
title: Workflow-Trigger
description: Die drei Wege, auf denen ein Workflow von selbst startet — Zeitpläne, Webhooks und Ereignisse — was jeder davon in den Lauf trägt und wie du einen pausierst, ohne ihn zu löschen.
---

Ein Trigger ist das, was einen Workflow startet, ohne dass ein Mensch etwas anklickt. Der Tab **Trigger** eines Workflows trägt drei Abschnitte — **Zeitpläne**, **Webhooks** und **Ereignisse** — und ein Workflow kann mehrere Trigger in beliebiger Mischung halten; alle füttern denselben ersten Schritt. Ein Workflow ohne Trigger läuft weiterhin von Hand über das Panel **Workflow testen** im Editor — nützlich beim Bauen, nie für die Produktion.

<Frame caption="Der Trigger-Tab mit ausgeklapptem Ereignisse-Abschnitt — ein Ereignis-Trigger, sein Aktiv-Schalter und der Zeitpunkt der letzten Auslösung.">

![Der Trigger-Tab einer Automatisierung mit eingeklappten Abschnitten für Zeitpläne und Webhooks und einem ausgeklappten Ereignisse-Abschnitt mit einer task.created-Trigger-Zeile.](/images/platform/automation-triggers.webp)

</Frame>

## Zeitpläne

Klicke auf **Zeitplan hinzufügen**, um den Workflow nach der Uhr laufen zu lassen. Das Formular nimmt einen Standard-Cron-Ausdruck mit fünf Feldern, mit Voreinstellungen von **Alle 5 Minuten** bis **Monatlich** — oder beschreib das Timing in Alltagssprache und klicke auf **Generieren**, damit die KI den Cron-Ausdruck für dich schreibt. **Workflow-Variablen** sind die Eingabe, die jeder geplante Lauf erhält, vorbefüllt aus dem Eingabeschema des Workflows. Die Zeile zeigt unter **Zuletzt ausgelöst** den letzten Zeitpunkt und wer den Zeitplan erstellt hat.

## Webhooks

Klicke auf **Webhook hinzufügen**, und Tale prägt eine eindeutige URL; jedes System, das JSON dorthin POSTet, startet den Lauf, mit dem Body der Anfrage als Eingabe des Laufs.

<Warning>

Sichere die Webhook-URL, wenn sie angezeigt wird — das Token in der URL wirkt als Zugangsnachweis. Wer die URL hält, kann den Workflow starten; behandle sie also wie ein Geheimnis und lösche den Webhook, um sie zu widerrufen.

</Warning>

## Ereignisse

Klicke auf **Ereignis-Trigger hinzufügen** und wähle einen Ereignistyp aus dem Dropdown — Dinge, die innerhalb von Tale passieren, etwa `task.created`, `conversation.message_received`, `customer.updated` oder `workflow.completed`. Optionale Filter grenzen ein, wann der Trigger feuert, und der Payload des Ereignisses wird zur Eingabe des Laufs. Greif zum Ereignis-Trigger, wenn der Job des Workflows darin besteht, auf etwas zu reagieren, das Tale selbst gerade getan hat.

<Note>

Ein Workflow, der zu einer [Automatisierung](/de/platform/automations/concepts) gehört, läuft nur innerhalb seiner Automatisierung — Ereignisse kann er selbst nicht abonnieren.

</Note>

## Den richtigen Trigger wählen

| Nimm … wenn                                 | Zeitplan | Webhook | Ereignis |
| ------------------------------------------- | -------- | ------- | -------- |
| Die Arbeit kehrt nach der Uhr wieder        | ✓        |         |          |
| Ein externes System signalisiert die Arbeit |          | ✓       |          |
| Etwas, das Tale getan hat, ist der Anlass   |          |         | ✓        |

Ein Workflow kann mehr als einen tragen — ein täglicher Zeitplan plus ein Webhook für spontane externe Anstöße ist ein übliches Paar.

## Pausieren und entfernen

Jede Trigger-Zeile hat einen **Aktiv**-Schalter. Ihn abzuschalten stoppt das Feuern, ohne die Zeile oder die Laufhistorie zu verlieren; ihn wieder einzuschalten nimmt den Betrieb sofort wieder auf. Die Zeile zu löschen ist endgültig — bei Webhooks stirbt damit auch die URL, jedes System, das noch dorthin POSTet, läuft also ins Leere.

## Wo das hingehört

Trigger sind die Startschicht; die Schritte danach sind die eigentliche Arbeit. Geh zu [Automatisierungskonzepte](/de/platform/automations/concepts) für das Modell, in das ein Trigger einspeist, und zu [Ausführungsprotokolle](/de/platform/automations/execution-logs), um zu sehen, was jeder ausgelöste Lauf aufgezeichnet hat — einschließlich der Frage, welcher Trigger ihn gestartet hat.
