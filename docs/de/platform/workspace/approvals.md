---
title: Freigaben
description: Aktionen, die Automatisierungen und Agents anfordern, direkt im Chat prüfen und freigeben oder ablehnen.
---

Automatisierungen und KI-Agents können so konfiguriert werden, dass sie an bestimmten Stellen anhalten und auf eine menschliche Freigabe warten, bevor es weitergeht. Wenn eine Freigabe nötig ist, erscheint sie als Inline-Karte in deiner Chat-Konversation.

## Freigabe-Typen

| Typ                   | Wozu die Freigabe dient                                                                   |
| --------------------- | ----------------------------------------------------------------------------------------- |
| Integration-Operation | Erlaubnis, eine REST-API oder SQL-Abfrage über eine angebundene Integration auszuführen.  |
| Workflow-Anlage       | Erlaubnis, eine neue Automatisierung anzulegen.                                           |
| Workflow-Ausführung   | Erlaubnis, einen bestehenden Workflow mit bestimmten Parametern auszuführen.              |
| Workflow-Änderung     | Erlaubnis, die Schritte oder Konfiguration eines bestehenden Workflows zu ändern.         |
| Dokument-Schreiben    | Erlaubnis, eine oder mehrere Dateien in der Wissensdatenbank anzulegen oder zu speichern. |
| Human-Input-Anfrage   | Ein pausierter Workflow bittet dich, Informationen einzugeben, bevor er weiterläuft.      |
| Location-Anfrage      | Erlaubnis, deine Browser-Position für eine ortsbezogene Aufgabe zu nutzen.                |

## Eine Freigabe prüfen

Wenn ein Agent oder eine Automatisierung eine Freigabe braucht, erscheint eine Karte im Chat mit dem vollständigen Kontext: welcher Workflow oder welches Tool die Anfrage ausgelöst hat, welche Aktion geplant ist und welche Daten genutzt werden sollen.

Jede Karte enthält:

- einen Kopfzeile mit dem Freigabe-Typ;
- detaillierte Metadaten, die du aufklappen kannst (Parameter, Dateilisten, Workflow-Schritte);
- die Buttons **Genehmigen** und **Ablehnen**.

Klicke **Genehmigen**, damit die Aktion ausgeführt wird. Die Karte zeigt den Fortschritt und das Endergebnis. Klicke **Ablehnen**, um sie abzubrechen. Der Agent erhält eine Benachrichtigung, dass die Aktion abgelehnt wurde, und kann sein Vorgehen anpassen.

## Human-Input- und Location-Anfragen

Manche Freigaben sind interaktiv statt nur zu bestätigen oder abzulehnen:

- **Human-Input-Anfragen** zeigen ein Formular mit Feldern (Text, Dropdowns, Ja/Nein), das ein pausierter Workflow von dir ausgefüllt haben will. Mit dem Abschicken setzt sich der Workflow fort.
- **Location-Anfragen** fragen nach deiner Browser-Position. Klicke **Standort teilen**, um den Zugriff zu erlauben, oder lehne die Anfrage ab.
