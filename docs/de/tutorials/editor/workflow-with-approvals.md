---
title: Einen Workflow mit Freigabe erstellen
description: Importiere einen kleinen Workflow, teste seine geplante E-Mail und lehne die Live-Freigabe ab, ohne die Nachricht zu senden.
---

Diese Übung erstellt einen Workflow mit zwei Schritten: eine Nachricht vorbereiten und die Erlaubnis zum Senden anfordern. Du prüfst Empfänger und Text im wartenden Lauf und lehnst die Aktion ab. So lernst du den vollständigen Freigabeablauf kennen, ohne eine echte Nachricht zustellen zu müssen.

## Bevor du beginnst

Nutze ein Konto mit der Rolle Entwickler, Admin oder Inhaber. Prüfe, dass die Freigaberichtlinie deiner Organisation für `imap-smtp.send` eine Entscheidung verlangt. Das ist die Standardeinstellung. Eine eigene Richtlinie kann sie ändern. Lies deshalb vor dem Live-Teil [Freigaben konfigurieren](/de/platform/approvals/configure).

Der Mock-Test braucht keine Postfach-Zugangsdaten. Für einen tatsächlich freigegebenen Versand wären ein eingerichteter IMAP-/SMTP-Connector und ein beabsichtigter Empfänger nötig. Diese Übung endet mit **Ablehnen**.

## Das Beispiel importieren

Speichere den folgenden Inhalt als `workflow.yml`. Der Knoten `draft` liefert festen Text, damit das Ergebnis leicht prüfbar ist. `send` liest ihn; diese Referenzen erzeugen die Verbindung auf dem Canvas.

```yaml
version: 1
name: docs/approval-check
description: Practice reviewing an outgoing message before it is sent.
nodes:
  - id: draft
    type: transform
    code: |
      return {
        subject: "Approval practice",
        text: "This is a test message for the approval walkthrough."
      };
  - id: send
    type: imap-smtp.send
    input:
      to: reviewer@example.com
      subject: '{{ nodes.draft.output.subject }}'
      text: '{{ nodes.draft.output.text }}'
output:
  messageId: '{{ nodes.send.output.messageId }}'
tests:
  - name: prepares the outgoing message
    input: {}
    expect:
      effects:
        - connector: imap-smtp.send
```

1. Öffne **Automatisierungen > Automatisierung erstellen > Paket hochladen**.
2. Wähle `workflow.yml` und belasse **Installieren in** auf **Organisation**.
3. Klicke auf **Paket hochladen**. Tale validiert das Dokument und speichert `docs/approval-check` als Entwurf.
4. Wähle in der Veröffentlichungsfrage **Später** und öffne anschließend **Approval check** in der Liste. Die Automatisierung öffnet sich im Tab **Editor**.

Existiert der Name bereits, fügt der Upload eine weitere Version hinzu. Wähle einen anderen Workflow-`name`, wenn die Übung getrennt bleiben soll.

<Frame caption="Paket hochladen nimmt die Workflow-Datei an und bietet Organisation oder Projekt als Ziel an.">

![Der Dialog Paket hochladen zeigt die Dateiauswahl und den Zielwähler mit Organisation.](/images/platform/automations-upload-dialog.webp)

</Frame>

## Den Datenfluss testen

Klicke im **Editor** auf **Testlauf**. Dieses Beispiel braucht keine Laufzeiteingabe und kann mit einem leeren Objekt laufen. Wechsle zu **Läufe**. Dort sollte ein **Erfolgreich** abgeschlossener Test erscheinen.

Öffne den Lauf und prüfe auf dem Canvas, ob beide Knoten ausgeführt wurden. Wähle `send` und prüfe die aufgelöste Eingabe. Der Empfänger muss `reviewer@example.com` sein, der Betreff `Approval practice` und der Text der Satz aus `draft`. In diesem Modus antwortet ein deterministischer Mock des Connectors. Es wird keine E-Mail gesendet und keine Freigabekarte angezeigt.

Der Workflow enthält einen Test, der den Effekt `imap-smtp.send` erwartet. Ein erfolgreicher Mock prüft Ablauf und vorgesehenen Aufruf. Er belegt weder gültige Postfach-Zugangsdaten noch die Zustellung.

## Die Live-Freigabe prüfen

Kehre zum **Editor** zurück und klicke auf **Diese Version live schalten**, um die getestete Version live zu schalten. Lass den Trigger unkonfiguriert; diese Übung startet einmal von Hand.

Wähle **Live ausführen**, lies Bestätigung und Organisationsumfang und bestätige. Wechsle zu **Läufe** und öffne den neuen wartenden Lauf. Die Freigabekarte sollte die ausstehende Entscheidung, `imap-smtp.send`, den Knoten `send` sowie dessen geplante Eingabe zeigen. Empfänger, Betreff und Text müssen dem Mock-Test entsprechen.

Wartet der Lauf nicht, prüfe Status und Richtlinie, bevor du fortfährst. Ein fehlgeschlagener Connector-Aufruf beweist nicht, dass eine Freigabe angefordert wurde.

## Ablehnen und das Ergebnis prüfen

Klicke auf der Karte auf **Ablehnen**. Die Aktion wird verweigert und der Lauf endet als **Fehlgeschlagen**. Das ist das erwartete Ergebnis dieser Übung: Der Workflow hat die menschliche Entscheidung erreicht und die Nachricht nicht gesendet.

Die Parameter eines wartenden Aufrufs lassen sich auf der Karte nicht ändern. Ist eine echte vorgeschlagene Nachricht falsch, lehne sie ab, korrigiere Definition oder Eingabe und starte einen neuen Lauf. Die spätere Freigabe eines korrekten Aufrufs erlaubt die tatsächliche Aktion; sie bestätigt nicht nur, dass du die Karte gelesen hast.

Braucht ein Agent eine Antwort statt einer Erlaubnis, nutzt er `ask_human`. Diese andere Form des Wartens erklärt [Freigaben in Workflows](/de/platform/automations/approvals-in-workflows). [Ausführungsprotokolle](/de/platform/automations/execution-logs) hilft, beide von einem noch arbeitenden Agenten zu unterscheiden.
