---
title: Automatisierungs-Konzepte
description: Wie Workflows, Schritte, Trigger und Variablen zusammenhängen.
---

Eine Automatisierung ist ein kleines, deterministisches Programm, das startet, wenn etwas es triggert. Anders als der Chat — der offen ist — tun Automatisierungen genau das, was ihre Schritte sagen, in Reihenfolge, jedes Mal. Sie bringen KI in den Hintergrund eines Geschäftsprozesses: nächtliche Importe, eingehende Webhook-Fan-Outs, geplante Zusammenfassungen, alles, was ohne Menschen im Chat passieren muss.

Diese Seite richtet sich an alle, die eine Automatisierung bauen, debuggen oder lesen — Entwickler-Rolle oder höher, auf beiden Editionen. Die Bausteine unten — Workflow, Schritt, Trigger, Variable — sind das kleine Vokabular, das der Rest dieses Bereichs voraussetzt. Einmal gelesen, werden Editor, Trigger-Konfiguration und Ausführungslogs alle für sich navigierbar.

## Workflow

Ein Workflow ist die gesamte Automatisierung. Er hat einen Namen, eine Beschreibung, eine Liste von Schritten, einen oder mehrere Trigger und eine kleine Reihe von Konfigurationen (Timeout, Retries, Variablen). Ein Workflow ist eine ausführbare Einheit; du veröffentlichst, versionierst und beobachtest ihn als ein Stück.

## Schritt

Ein Schritt ist eine Arbeitseinheit. Die Plattform liefert sechs Schritttypen, jeder im Editor farblich markiert, damit die Absicht eines Workflows auf einen Blick lesbar bleibt:

| Schritt       | Farbe     | Funktion                                                                                                                  |
| ------------- | --------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Start**     | Blau      | Der Einstiegspunkt. Definiert das Input-Schema und welche Trigger den Workflow starten.                                   |
| **Action**    | Orange    | Führt eine Operation aus — eine API aufrufen, eine Datenbank abfragen, eine E-Mail senden, einen Datensatz aktualisieren. |
| **LLM**       | Lila      | Schickt einen Prompt an ein KI-Modell und reicht die Antwort weiter.                                                      |
| **Condition** | Bernstein | Prüft eine Bedingung und zweigt zu verschiedenen Ästen.                                                                   |
| **Loop**      | Cyan      | Wiederholt eine Gruppe von Schritten für jedes Element einer Liste.                                                       |
| **Output**    | Grün      | Definiert die Form der Daten, die zurückgegeben werden, wenn der Workflow fertig ist.                                     |

Schritte werden mit gerichteten Links verbunden. Die Ausführung folgt den Links von Start zu Output; Äste innerhalb eines Conditions werden unabhängig verfolgt; Loop-Schritte wiederholen ihren inneren Block pro Listeneintrag.

## Trigger

Ein Trigger sagt dem Workflow, wann er laufen soll. Die Plattform unterstützt drei Arten: einen Zeitplan (Cron-Stil), ein Ereignis (etwas ist in Tale passiert) und einen Webhook (ein externes System hat uns gerufen). Ein Workflow kann mehrere Trigger haben — derselbe Fan-Out läuft nachts auf Zeitplan _und_ wenn ein Webhook feuert. Siehe [Trigger](/de/platform/automations/triggers) für die Details jeder Art und die Syntax zur Konfiguration.

## Variablen

Variablen sind gemeinsam genutzte Key-Value-Daten, auf die jeder Schritt zugreifen kann. Sie sind nützlich für API-Schlüssel, die mehrere Schritte referenzieren, für Feature-Flags, die das Workflow-Verhalten ändern, und für Konstanten, die du nicht in jeder Schritt-Konfiguration wiederholen willst. Variablen liegen im Konfigurations-Tab des Workflows und werden von jedem Schritt mit der Syntax `{{ variables.name }}` gelesen.

## Entwurf vs. Aktiv

Workflows haben, wie Agents, ein Entwurf-Veröffentlichen-Modell. Ein Workflow kann erst aktiviert werden, wenn er veröffentlicht ist. Änderungen nach der Aktivierung erzeugen einen neuen Entwurf, der neben der aktiven Version läuft, bis du erneut veröffentlichst — du überarbeitest einen Schritt also, ohne die aktive Automatisierung abzuschalten.

## Läufe und Ausführungen

Jedes Mal, wenn ein Trigger feuert, erstellt die Plattform eine **Ausführung**. Ausführungen leben im Ausführungen-Tab des Workflows mit Startzeit, Dauer, Endstatus und einer Pro-Schritt-Aufschlüsselung von Inputs, Outputs und Fehlern. Das Ausführungslog ist der Ort, an dem du Fehler debuggst: Jeder Schritt zeichnet Input, Output und jeden geworfenen Fehler auf, sodass ein `400 Bad Request` eines Drittsystems einen Klick entfernt ist von der konkreten Anfrage, die ihn ausgelöst hat. Siehe [Ausführungslogs](/de/platform/automations/execution-logs).

## Wann du danach greifst

Automatisierungen sind das deterministische Hintergrund-Primitiv in Tale. Ihr Geschwister ist der **Agent** — das Konversations-Primitiv, das synchron mit einem Menschen im Chat läuft. Wähle danach, wo die Arbeit stattfindet.

| Greif zur Automatisierung, wenn …                                              | Greif zum Agent, wenn …                                                              |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| ein Zeitplan, ein Webhook oder ein internes Ereignis die Arbeit feuert         | ein Mensch eine Frage stellt und auf eine Antwort wartet                             |
| der Ablauf jedes Mal gleich ist — dieselben Schritte, dieselbe Reihenfolge     | der Ablauf bei jeder Antwort verzweigt; der nächste Schritt hängt von der Absicht ab |
| die Ausgabe eine Wirkung auf ein anderes System ist (DB-Zeile, E-Mail, Ticket) | die Ausgabe eine geschriebene Antwort oder kleine strukturierte Nutzlast ist         |
| du eine lückenlose Spur jedes Inputs, Outputs und Fehlers willst               | du einen Konversationsverlauf mit den Modellentscheidungen inline willst             |

Die beiden komponieren. Der LLM-Schritt eines Workflows kann die Anweisungen eines Agents nutzen; ein Agent kann einen langlaufenden Job über das Integrationen-Tool an eine Automatisierung übergeben. Wähle das primäre Primitiv danach, ob der Nutzer in der Schleife ist, wenn die Arbeit startet.

## Einen bauen

Das Vokabular oben ist das ganze Modell. Die nächste Seite ist der Editor, der es in einen ausführbaren Workflow verwandelt: [Workflows](/de/platform/automations/workflows).
