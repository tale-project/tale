---
title: Workflow-Konzepte
description: Ein Workflow ist eine Schritt-Definition plus ein Trigger plus eine Ausführungshistorie. Diese Seite benennt die vier Stücke und zeigt, wie ein Tagesbericht hindurchfliesst.
---

Ein Workflow ist die Einheit, zu der Tale greift, wenn die Arbeit mehrstufig ist und du Genehmigungen, Zeitpläne oder externe Trigger zwischen den Schritten willst. Er ist eine Schritt-Definition plus ein Trigger plus eine Ausführungshistorie — drei Dinge, die du komponierst, um eine wiederkehrende Aufgabe in einen Graphen zu verwandeln, der sich selbst ausführt.

Diese Seite gibt dir das Vokabular, das der Rest des Workflows-Abschnitts voraussetzt. Lies sie, bevor du einen Workflow baust, und komm zurück, wenn du nicht mehr weisst, ob ein Verhalten in einen Schritt, in den Trigger oder in ein Genehmigungs-Gate gehört.

## Die vier Stücke

**Die Definition** ist die geordnete Menge an Schritten mit ihren Eingaben und Ausgaben. Schritte können sequenziell, parallel oder hinter einem bedingten Zweig laufen. Ein Workflow ist versioniert; jedes Speichern erzeugt eine neue Version, zu der du zurückrollen kannst.

**Trigger** entscheiden, wann ein Workflow läuft. Vier Trigger-Typen sind dabei: manuell (ein Knopf in der UI), Schedule (cron-förmig), Webhook (ein externes System postet an eine URL) und Event (etwas geschieht innerhalb von Tale — ein Dokument wird hochgeladen, ein Agent beendet eine Antwort).

**Schritte** sind das, was läuft. Eingebaute Schritt-Typen rufen Agents auf, führen Sandbox-Code aus, treffen externe APIs, schreiben in die Wissensdatenbank, schicken Mail oder pausieren für User-Eingaben. Schritte, die die Aussenwelt berühren, sind in Idempotenz-Schlüssel gehüllt, damit ein Retry nicht doppelt feuert.

**Ausführungen** sind die Lauf-Historie. Jede Workflow-Auslösung erzeugt einen Ausführungs-Datensatz: wer ausgelöst hat, was jeder Schritt empfangen und ausgegeben hat, wo die Fehler waren, wie lange es gedauert hat. Das Ausführungs-Log ist Audit-Spur und Debugging-Oberfläche in einem.

## Genehmigungen als Gates

Ein Workflow-Schritt kann ein Genehmigungs-Gate sein. Der Lauf pausiert, eine Genehmigungs-Karte taucht im konfigurierten Genehmiger-Pool auf, und der nächste Schritt feuert erst, wenn ein Genehmiger auf Genehmigen klickt. Ablehnen beendet den Lauf; ein Timeout eskaliert oder schlägt fehl, je nach Konfiguration des Gates. Genehmigungen sind die Naht zwischen Automatisierung und menschlicher Beurteilung.

Die Konzept-Seite [Genehmigungen in Workflows](/de/platform/workflows/approvals-in-workflows) deckt die Gate-Zustände und die Routing-Regeln im Detail ab.

## Zusammengesetzt — ein Tagesbericht-Workflow

Ein Tagesbericht-Workflow setzt die vier Stücke in eine Kette:

- Trigger: ein Schedule, der werktags um 08:00 feuert.
- Schritt 1: ein Agent, der die Kundenkonversationen des Vortags aus dem Posteingang zusammenfasst.
- Schritt 2: ein Genehmigungs-Gate, geroutet an die Teamleitung — Genehmigen zum Senden, Ablehnen zum Verwerfen.
- Schritt 3: ein Mail-Schritt, der die genehmigte Zusammenfassung an die Team-Verteilerliste schickt.

Jeder Lauf hält den Entwurf des Agents, die Entscheidung des Genehmigers und die Empfängerliste des Mail-Schritts fest. Schlägt ein Schritt fehl — der Agent läuft in den Timeout, der Genehmiger antwortet nicht, der Mail-Server ist nicht erreichbar — fängt die Ausführung den Fehler ein, und der gescheiterte Schritt ist aus der Ausführungs-Ansicht wiederholbar.

## Wann du danach greifst

| Nutz … wenn                                                  | Workflow | Agent | Cron-Job |
| ------------------------------------------------------------ | -------- | ----- | -------- |
| Arbeit hat mehrere abhängige Schritte                        | ✓        |       |          |
| Du brauchst eine menschliche Genehmigung zwischen Schritten  | ✓        |       |          |
| Dasselbe Prompt kehrt wieder, aber immer einmalig            |          | ✓     |          |
| Du brauchst nur einen wiederkehrenden Shell-Befehl auf Linux |          |       | ✓        |

Agents sind die richtige Form für einmalige Konversationen; Workflows sind die richtige Form, wenn die Arbeit Etappen hat und du Eingabe, Ausgabe und Genehmiger jeder Etappe festhalten willst.

## Bau einen

Definition, Trigger, Schritte und Ausführungen sind die vier Stücke, aus denen jeder Tale-Workflow besteht: die Definition ist das Rezept, der Trigger ist der Startschuss, die Schritte sind die Züge, die Ausführung ist die Aufzeichnung. Greif zu einem Workflow, wenn die Arbeit Etappen hat; greif zu einem Agent, wenn die Konversation in einer Stimme bleibt. Die natürliche nächste Lektüre ist [Workflow mit Genehmigungen](/de/tutorials/editor/workflow-with-approvals) — sie geht die vier Stücke auf einer frischen Instanz durch.
