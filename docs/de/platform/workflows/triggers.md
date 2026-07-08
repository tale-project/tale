---
title: Workflow-Trigger
description: Die vier Arten, wie ein Workflow starten kann — manuell, Schedule, Webhook, Event — was jede in den Lauf hineinträgt und wie du zwischen ihnen wechselst, ohne den Workflow neu zu bauen.
---

Ein Trigger ist das, was einen Workflow startet. Tale liefert vier Trigger-Typen: manuell (eine Schaltfläche), Schedule (cron-förmig), Webhook (ein externer POST) und Event (etwas passiert in Tale). Jeder Workflow hat mindestens einen Trigger; manche haben mehrere. Diese Seite ist die Referenz dafür, was jeder Trigger in den Lauf hineinträgt, wie er konfiguriert wird und wie du dich zwischen ihnen entscheidest, wenn mehr als einer funktionieren würde.

Das Mentalmodell von Workflows, Schritten, Ausführungen und Genehmigungen liegt auf [Workflow-Konzepte](/de/platform/workflows/concepts). Trigger sind die Anstoss-Ebene über diesem Modell; der Rest des Workflows muss nicht wissen, welcher Trigger ihn gestartet hat, aber die Eingaben, die der erste Schritt erhält, kommen vom Trigger, den Tale gerade gefeuert hat.

## Wo Trigger liegen

Öffne den Workflow und wechsle in den **Trigger**-Tab. Der Tab listet die aktuellen Trigger des Workflows und lässt dich neue hinzufügen. Ein Workflow ohne Trigger läuft nur über die Schaltfläche **Jetzt ausführen** im Editor — nützlich zum Testen, nie für die Produktion.

Ein Workflow kann mehrere Trigger desselben Typs oder unterschiedlicher Typen tragen. Ein Tagesbericht-Workflow könnte einen Schedule-Trigger haben, der jeden Wochentagmorgen feuert, plus einen manuellen Trigger, damit ein Mensch ihn ad hoc feuern kann; beide speisen in denselben ersten Schritt.

## Die vier Trigger-Typen

**Manuell** ist eine Schaltfläche. Mitglieder und Redakteure mit Zugriff auf den Workflow starten ihn über seinen Start-Button; ein Klick öffnet das Eingabeformular (ein Feld pro deklarierter Eingabe) und startet den Lauf. Greif zu manuell, wenn der Workflow gelegentlich ist und ein Mensch weiss, wann er laufen soll.

**Schedule** ist cron-förmig. Der Trigger feuert auf ein wiederkehrendes Zeit-Muster — jeden Wochentag um 08:00, am Ersten jedes Monats, alle 15 Minuten. Der Schedule-Trigger trägt keine eigene Nutzlast; der erste Schritt sieht nur die deklarierten Eingaben des Workflows (typischerweise am Trigger vorbelegt). Greif zu Schedule, wenn der Workflow nach Uhr wiederkehrt.

**Webhook** ist ein externer POST. Tale prägt eine eindeutige URL für den Trigger; jedes System, das auf diese URL postet, feuert den Lauf. Der Webhook-Trigger trägt den JSON-Body der Anfrage als Eingabe des ersten Schritts. Greif zu Webhook, wenn ein externes System signalisiert, dass Arbeit ansteht — die Benachrichtigung eines Anbieters, das Ende eines CI-Jobs, eine Formular-Übermittlung.

**Event** ist ein internes Signal. Tale emittiert Events, wenn sich Dinge im Produkt ändern — ein Dokument wird hochgeladen, ein Agent beendet eine Antwort, eine Genehmigung wird aufgelöst, ein Kunde wird erstellt. Der Event-Trigger abonniert eines dieser Events und trägt die Nutzlast des Events als Eingabe des ersten Schritts. Greif zu Event, wenn die Aufgabe des Workflows darin besteht, auf etwas zu reagieren, das Tale selbst gerade getan hat.

## Ein durchgespielter Schedule-Trigger

Um einen Workflow jeden Wochentag um 08:00 laufen zu lassen, füg einen Schedule-Trigger hinzu und wähl `Jeden Wochentag um 08:00` aus dem Picker (der Picker akzeptiert Cron-Ausdrücke für Formen, die der visuelle Builder nicht ausdrücken kann). Die Vorschau-Zeile des Triggers zeigt die nächsten drei Feuerzeiten — nützlich zum Plausibilitätscheck des Cron-Ausdrucks vor dem Speichern.

Schedules respektieren die Zeitzone der Organisation. Die konfigurierte Zeitzone ist die, in der die Stunden des Pickers interpretiert werden; `08:00` in `Europe/Zurich` laufen zu lassen heisst 08:00 lokal, nicht 08:00 UTC. Der Lauf-Verlauf erfasst die Wanduhrzeit, zu der der Lauf startete, die Zeitzone und die Trigger-ID.

## Ein durchgespielter Webhook-Trigger

Um einen externen POST zu akzeptieren, füg einen Webhook-Trigger hinzu. Tale prägt eine URL der Form `https://<dein-tale-host>/api/automations/triggers/<id>`, erzeugt ein Signier-Geheimnis und zeigt beides in der Zeile des Triggers. Konfiguriere das aufrufende System, JSON an die URL zu posten, mit dem Geheimnis in der Kopfzeile `X-Tale-Signature`; der Trigger prüft die Signatur, bevor er den Lauf feuert. Eine Anfrage mit falscher Signatur gibt `401` zurück und feuert nicht.

Das Nutzlast-Schema des Webhook-Triggers wird am Trigger deklariert — Tale validiert eingehendes JSON gegen das Schema, bevor gefeuert wird. Eine Nutzlast, die die Validierung nicht besteht, gibt `400` mit dem Validierungsfehler im Body zurück, und der Lauf startet nicht.

## Ein durchgespielter Event-Trigger

Um einen Workflow laufen zu lassen, sobald ein `automation.approval.resolved`-Event eintrifft, füg einen Event-Trigger hinzu und wähl den Event-Typ aus dem Dropdown. Das Nutzlast-Schema des Triggers ist durch den Event-Typ festgelegt — Tale zeigt das Schema in der Zeile des Triggers. Event-Trigger können nach Nutzlast-Feldern filtern: nur feuern, wenn die Genehmigung genehmigt wurde (nicht abgelehnt), nur für Genehmigungen in einem bestimmten Team und so weiter.

Die Event-Oberfläche ist offen; die Liste verfügbarer Events wächst mit Tale. Das aktuelle Set deckt die offensichtlichen Lebenszyklus-Momente ab (Dokument-Upload, Agent-Antwort fertig, Genehmigung aufgelöst, Integrations-Anmeldedaten rotiert, Mitglied hinzugefügt).

## Den richtigen Trigger wählen

| Nutze … wenn                                                | Manuell | Schedule | Webhook | Event |
| ----------------------------------------------------------- | ------- | -------- | ------- | ----- |
| Ein Mensch weiss, wann die Arbeit laufen soll               | ✓       |          |         |       |
| Die Arbeit wiederkehrt nach Uhr                             |         | ✓        |         |       |
| Ein externes System signalisiert die Arbeit                 |         |          | ✓       |       |
| Etwas, was Tale getan hat, ist der Grund zu laufen          |         |          |         | ✓     |
| Du willst beides — wiederkehrend plus Ad-hoc-Menschen-Läufe | ✓       | ✓        |         |       |

Ein Workflow kann mehr als einen Trigger tragen; die Typ-Spalte muss nicht nur eine Zeile sein.

## Einen Trigger deaktivieren und entfernen

Jeder Trigger hat einen Aktiviert-Schalter auf Zeilen-Ebene. Einen Trigger zu deaktivieren stoppt das Feuern, ohne ihn zu entfernen — der Lauf-Verlauf bleibt intakt, und das Wiedereinschalten stellt das Feuern sofort wieder her. Greif zu Deaktivieren, wenn du einen Workflow vorübergehend anhalten willst; greif zu Löschen, wenn du sicher bist, dass der Trigger ausgemustert ist.

## Wo das hingehört

Trigger sind die Anstoss-Ebene des Workflow-Modells; die Schritte, die ihnen folgen, sind die eigentliche Arbeit. Die natürliche nächste Lektüre ist [Workflow-Konzepte](/de/platform/workflows/concepts) für das Workflow-, Schritt- und Ausführungs-Modell, in das der Trigger speist, und [Genehmigungen in Workflows](/de/platform/workflows/approvals-in-workflows) für das Gate, das den Lauf zwischen Schritten anhält.
