---
title: Mit einer Vorlage beginnen
description: Lege aus einer Vorlage eine fertige Automatisierung an, indem du ein paar Fragen beantwortest, starte sie sofort und sieh, was jede Vorlage tut.
---

Eine Vorlage ist eine Automatisierung, die Tale einsatzbereit mitliefert. Du beantwortest ein paar Fragen — welchem Projekt sie dient, wen sie benachrichtigt, wann sie läuft —, und Tale legt sie als deine eigene Automatisierung an, die du wie jede andere ändern kannst. Automatisierungen legen nur Inhaber, Admins und Entwickler an.

## Eine anlegen

1. Öffne **Automatisierungen** und wähle **Automatisierung erstellen** › **Aus einer Vorlage**.
2. Wähle eine Vorlage. Ihre Seite zeigt, was sie tut, wodurch sie startet und welche Schritte sie ausführt.
3. Beantworte ihre Fragen. **Name** ist zunächst der Name der Vorlage; ändere ihn, um deine Automatisierungen auseinanderzuhalten.
4. Lass **Jetzt starten** an, um Version 1 sofort live zu schalten und ihren Trigger einzuschalten. Ausgeschaltet wird die Automatisierung als Entwurf angelegt, den du im [Editor](/de/platform/automations/editor) live schaltest.
5. Wähle **Automatisierung erstellen**. Die neue Automatisierung öffnet sich im Editor.

<Frame caption="Jede Vorlage sagt in einer Zeile, was sie tut.">

![Der Dialog Choose a starter mit einem Suchfeld und fünf Vorlagen: Answer questions from your documents, Create tasks from a webhook, Summarize the inbox, Tell the reviewer und Triage new tasks, jede mit einer Zeile Beschreibung.](/images/platform/automation-starter-gallery.webp)

</Frame>

<Frame caption="Tell the reviewer, beantwortet für das Projekt Website relaunch; benachrichtigt wird Priya Raman.">

![Der Dialog Tell the reviewer: was die Vorlage tut, How it works mit ihren zwei Schritten, Name, Project Website relaunch, Reviewer Priya Raman, Message, Start it now angehakt und die Schaltfläche Create automation.](/images/platform/automation-starter-setup.webp)

</Frame>

Aus der Liste **Automatisierungen** eines Projekts beginnt eine Vorlage, die einem Projekt dient, mit genau diesem Projekt, und die neue Automatisierung öffnet sich im Projekt.

Eine Vorlage, die ein Webhook startet, zeigt ihre Adresse genau einmal, direkt nach dem Anlegen. Kopiere sie, bevor du **Automatisierung öffnen** wählst: Gespeichert wird nur ein Hash ihres Tokens, eine verlorene Adresse lässt sich also nur mit **Token rotieren** ersetzen — siehe [Einen Webhook empfangen](/de/platform/automations/triggers#einen-webhook-empfangen).

Kann Tale eine Antwort nicht verwenden — ein Projekt, das du nicht öffnen kannst, oder jemand, der kein Mitglied der Organisation ist —, sagt die Frage, warum, und es wird nichts angelegt. Einen Namen, den schon eine andere Automatisierung trägt, lehnt Tale ebenfalls ab; wähle dann einen anderen.

## Die Vorlagen

| Vorlage | Startet | Was sie tut |
| --- | --- | --- |
| **Fragen aus deinen Dokumenten beantworten** | Wenn im Projekt eine Aufgabe erstellt wird | Endet der Titel der Aufgabe mit einem Fragezeichen, durchsucht sie die Dokumente der Organisation und kommentiert eine Antwort, die nur auf dem Gefundenen beruht, mit den Quellen. Andere neue Aufgaben bleiben unberührt. |
| **Aufgaben per Webhook erstellen** | Bei jeder Lieferung an ihre Webhook-Adresse | Erstellt im Projekt eine Aufgabe: `title` im JSON der Lieferung gibt ihr den Namen, `description` den Text. Eine Lieferung ohne Titel wird abgelehnt und erstellt nichts. |
| **Posteingang zusammenfassen** | Nach ihrem Zeitplan — werktags um 08:00 in deiner Zeitzone, solange du ihn nicht änderst | Fasst die Unterhaltungen des gewählten Postfachs, die noch auf eine Antwort warten, in je einer Zeile zusammen, die dringendste zuerst, und schickt die Zusammenfassung an das gewählte Mitglied. |
| **Reviewer benachrichtigen** | Wenn eine Aufgabe des Projekts ihren Status wechselt | Wechselt die Aufgabe in den Status **In Prüfung**, benachrichtigt sie das gewählte Mitglied, mit einem Link zur Aufgabe. |
| **Neue Aufgaben einordnen** | Wenn im Projekt eine Aufgabe erstellt wird | Kommentiert die Aufgabe mit einer vorgeschlagenen Priorität und einem ersten Schritt, in der Sprache der Aufgabe. Sonst ändert sich an der Aufgabe nichts. |

Nachrichten von **Posteingang zusammenfassen** und **Reviewer benachrichtigen** kommen in den Benachrichtigungen des Mitglieds an und per E-Mail, wenn seine Einstellungen eine senden; [Mitglieder aus einer Automatisierung benachrichtigen](/de/platform/automations/notify-members) erklärt, wer übersprungen wird. Eine Vorlage nennt ein Modell für ihre Sprachmodell-Schritte: Bedient es keiner deiner Anbieter, bekommt jeder dieser Schritte ein vergleichbares Modell, das sie bedienen, und die Nachricht von Version 1 sagt, welches.
