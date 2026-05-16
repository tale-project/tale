---
title: Genehmigungen
description: Aktionen prüfen, freigeben oder ablehnen, die Automatisierungen und Agents zur menschlichen Freigabe einreihen — direkt in der Chat-Konversation.
---

Genehmigungen sind Inline-Karten, die in einer Chat-Konversation auftauchen, sobald eine Automatisierung oder ein KI-Agent einen Schritt erreicht, der eine menschliche Freigabe verlangt. Die Karte trägt den vollen Kontext — welcher Workflow oder welches Tool sie ausgelöst hat, welche Aktion sie ausführen will, welche Daten sie nutzen würde — und bietet **Genehmigen** und **Ablehnen** als Buttons, die die Aktion an Ort und Stelle ausführen oder abbrechen. Die Zielgruppe ist jeder in der Konversation, wenn eine Genehmigung landet; die Karten erscheinen inline bei den Nachrichten, zu denen sie gehören, sodass der Prüfer für die Entscheidung nicht die Oberfläche wechseln muss.

Diese Seite behandelt die sieben Genehmigungsformen, denen du begegnen kannst, den Prüf-Ablauf jeder Karte und wie sich die beiden interaktiven Varianten (Benutzeranfragen und Standortanfragen) vom Standard-Paar Genehmigen-oder-Ablehnen unterscheiden.

## Genehmigungs-Typen

Die sieben Karten, die in einer Konversation auftauchen können, jede aus einem anderen Grund gesperrt:

| Typ                     | Wofür sie die Freigabe einholt                                                                        |
| ----------------------- | ----------------------------------------------------------------------------------------------------- |
| Integrationen-Operation | Erlaubnis, einen REST-API-Aufruf oder eine SQL-Abfrage über eine angebundene Integration auszuführen. |
| Workflow-Erstellung     | Erlaubnis, einen neuen Automatisierungs-Workflow anzulegen.                                           |
| Workflow-Ausführung     | Erlaubnis, einen bestehenden Workflow mit konkreten Parametern auszuführen.                           |
| Workflow-Änderung       | Erlaubnis, die Schritte oder Konfiguration eines bestehenden Workflows zu ändern.                     |
| Dokument-Schreiben      | Erlaubnis, eine oder mehrere Dateien in der Wissensdatenbank anzulegen oder zu speichern.             |
| Benutzeranfrage         | Ein pausierter Workflow bittet den Prüfer, Informationen einzugeben, bevor er weiterläuft.            |
| Standortanfrage         | Erlaubnis, den Browser-Standort für eine ortsbezogene Aufgabe zu nutzen.                              |

## Eine Genehmigung prüfen

Jede Karte hat dieselbe Form. Eine Kopfzeile nennt den Genehmigungs-Typ und den Akteur (den Workflow oder Agent, der sie ausgelöst hat). Ein aufklappbarer Detailbereich zeigt die Parameter, die Dateiliste oder die Workflow-Schritte — alles, was die Aktion anfassen würde. Die zwei Buttons unten führen die Aktion aus oder brechen sie ab.

Um die Aktion fortfahren zu lassen, klicke **Genehmigen**. Die Karte wechselt in eine Ausführungs-Ansicht mit Live-Fortschritt und schliesslich dem Endergebnis. Um sie abzubrechen, klicke **Ablehnen** (manche Karten nutzen ein kontextspezifisches Label wie **Workflow-Erstellung abbrechen** oder **Diese Operation ablehnen**). Der Agent erhält eine Benachrichtigung über die Ablehnung und passt seinen Ansatz für die nächste Runde an.

## Benutzeranfragen und Standortanfragen

Zwei der sieben Typen sind interaktiv statt einfache Genehmigen-oder-Ablehnen-Entscheidungen. Benutzeranfragen zeigen ein Formular mit Feldern, die der pausierte Workflow braucht — Texteingaben, Dropdowns, Ja/Nein-Schalter — und das Absenden der Antwort setzt den Workflow mit den angehängten Werten fort. Standortanfragen bitten um den Browser-Standort: klicke **Standort teilen**, um den Zugriff zu gewähren (der Browser zeigt seinen nativen Berechtigungs-Prompt), oder **Verweigern**, um abzulehnen.

In beiden Formen pausiert die Konversation, bis der Prüfer antwortet. Die Karte zeigt _Warte auf Eingabe_ im Agent-Transkript, damit der Chat-Verlauf lesbar bleibt.

## Wo das einsetzt

Genehmigungen sind die Mensch-in-der-Schleife-Kontrolloberfläche. Sie existieren, weil manche Aktionen — Abrechnungs-Operationen, Massen-E-Mail, Schreibvorgänge auf Produktivdaten — auch dann nicht autonom laufen sollten, wenn der Agent die technische Fähigkeit dazu hat. Das Karten-Muster ist dasselbe, egal ob die Anfrage von einem [Agent](/de/platform/agents/concepts) stammt, der eine Schreib-Operation einer Integration aufruft, von einer Automatisierung, die einen für Prüfung gesperrten Schritt erreicht, oder von einem MCP-Server-Tool, das mit `requiresApproval: true` markiert ist.

Um eine bestimmte Integrationen-Operation hinter eine Genehmigung zu legen, liegt das Pro-Operations-Flag auf der Konfigurationsseite der Integration unter [Einstellungen > Integrationen](/de/platform/integrations/overview). Um eine Genehmigung vor einem Workflow-Schritt zu verlangen, bietet der Workflow-Editor dasselbe Flag pro Schritt.
