---
title: Workflows
description: Mehrstufige Workflows mit Triggern, Bedingungen, Schleifen und KI-Schritten bauen und ausführen.
---

Mit Automatisierungen definierst und führst du mehrstufige Geschäftsprozesse aus, ohne Backend-Code schreiben zu müssen. Ein Workflow ist eine Reihe von Schritten. Jeder Schritt tut eine Sache, und Schritte werden zu einem vollständigen Ablauf verbunden.

## Einen Workflow erstellen

Es gibt drei Wege, einen Workflow zu erstellen:

### KI-unterstützt

1. Navigiere zu Automatisierungen und klicke auf New Automatisierung.
2. Gib einen Namen und eine Beschreibung ein, was der Workflow tun soll. Je mehr Details, desto besser kann die KI die ersten Schritte bauen.
3. Klicke auf Continue. Die Plattform erstellt den Workflow und öffnet rechts den KI-Chat, in dem du gesprächsweise verfeinern kannst.

### Manueller visueller Editor

1. Erstelle einen neuen Workflow wie oben, aber lasse die Beschreibung leer.
2. Nutze den Add-Step-Button auf dem Workflow-Canvas, um Schritte einzeln hinzuzufügen.
3. Konfiguriere jeden Schritt im Seitenpanel, das beim Klick auf einen Schritt erscheint.
4. Verbinde Schritte, indem du die Connector-Griffe anklickst und Linien dazwischen ziehst.

### Datei-basiert mit KI-Unterstützung

Du kannst Workflows erstellen, indem du JSON-Dateien ins Verzeichnis `workflows/` deines Projekts legst. Wenn du das Projekt in einem KI-Editor (Claude Code, Cursor, GitHub Copilot oder Windsurf) öffnest, kennt der Editor Workflow-Schemas, Schritttypen und Trigger-Konfiguration vollständig. Beschreibe, was der Workflow tun soll, und die KI erzeugt eine gültige Konfiguration. Siehe [AI-assisted development](/de/develop/ai-assisted-development).

## Schritttypen

| Schritttyp | Farbe     | Funktion                                                                                                          |
| ---------- | --------- | ----------------------------------------------------------------------------------------------------------------- |
| Start      | Blau      | Einstiegspunkt des Workflows. Definiert das Input-Schema und wann er startet (Zeitplan, Event, Webhook, manuell). |
| Action     | Orange    | Führt eine Operation aus — einen Datensatz anlegen, eine Nachricht senden, eine API rufen, Daten ändern.          |
| LLM        | Lila      | Schickt einen Prompt an ein KI-Modell und reicht die Antwort an den nächsten Schritt.                             |
| Condition  | Bernstein | Prüft eine Bedingung und zweigt in unterschiedliche Äste.                                                         |
| Loop       | Cyan      | Wiederholt eine Gruppe von Schritten für jedes Element einer Liste.                                               |
| Output     | Grün      | Definiert das Output-Mapping des Workflows — was beim Abschluss zurückgegeben wird.                               |

## Trigger

Jeder Workflow braucht mindestens einen Trigger, der sagt, wann er laufen soll.

### Zeitplan-Trigger

Lasse den Workflow nach Zeitplan laufen. Du kannst einen Cron-Ausdruck direkt eingeben oder den KI-Assistenten nutzen, um einen aus natürlicher Sprache zu erzeugen, z. B. "jeden Werktag um 9 Uhr".

Alle Zeitpläne laufen in UTC. Quick-Presets: alle 5 Minuten, stündlich, täglich, wöchentlich, monatlich.

### Event-Trigger

Lasse den Workflow laufen, wenn in der Plattform etwas passiert, z. B. wenn ein neuer Customer angelegt, eine Konversation eröffnet oder der Bestand eines Produkts 0 erreicht. Jeder Event-Typ kann optionale Filterbedingungen haben.

### Webhook-Trigger

Jeder Workflow bekommt eine eigene Webhook-URL. Ein HTTP-POST an diese URL mit einem JSON-Body startet den Workflow mit diesen Daten als Input. Du kannst ein Webhook-Secret hinzufügen, um die Authentizität eingehender Requests zu prüfen.

## Workflow-Konfiguration

Navigiere zum Configuration-Tab eines Workflows, um Folgendes anzupassen:

- Active-Umschalter: Workflow aktivieren oder deaktivieren. Drafts lassen sich erst aktivieren, wenn sie publiziert sind.
- Timeout: maximale Laufzeit eines Workflows in Millisekunden, bevor er gestoppt wird. Standard ist 300.000 ms (5 Minuten).
- Max Retries: wie oft ein fehlgeschlagener Schritt erneut versucht wird, bevor der Workflow fehlschlägt. Standard ist 3.
- Backoff: Wartezeit in Millisekunden zwischen Retry-Versuchen. Standard ist 1.000 ms.
- Variables: ein JSON-Objekt aus Key-Value-Paaren, auf das alle Schritte als gemeinsame Konfiguration zugreifen.

## Einen Workflow testen

Nutze das Test-Panel (verfügbar im Seitenpanel des Workflow-Editors), um:

- Execute: einen echten Run mit Test-Input auszulösen. Das Ergebnis siehst du im Executions-Tab.

## Ausführungsverlauf

Navigiere zum Executions-Tab eines beliebigen Workflows, um ein Log aller vergangenen Runs zu sehen, inklusive Startzeit, Dauer, Status sowie Input- und Output-Daten in jedem Schritt.
