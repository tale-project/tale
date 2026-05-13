---
title: Automatisierungs-Konzepte
description: Wie Workflows, Schritte, Trigger und Variablen zusammenhängen.
---

Eine Automatisierung ist ein kleines, deterministisches Programm, das startet, wenn etwas es triggert. Anders als der Chat — der offen ist — tun Automatisierungen genau das, was ihre Schritte sagen, in Reihenfolge, jedes Mal. So bringst du KI in den Hintergrund deiner Geschäftsprozesse.

## Workflow

Ein Workflow ist die gesamte Automatisierung. Er hat einen Namen, eine Beschreibung, eine Liste von Schritten, einen oder mehrere Trigger und eine Reihe von Konfigurationen (Timeout, Retries, Variablen).

## Schritt

Ein Schritt ist eine Arbeitseinheit. Die Plattform liefert sechs Schritttypen:

| Schritt       | Farbe     | Funktion                                                                                                                 |
| ------------- | --------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Start**     | Blau      | Der Einstiegspunkt. Definiert das Input-Schema und welche Trigger den Workflow starten.                                  |
| **Action**    | Orange    | Führt eine Operation aus — eine API aufrufen, eine Datenbank abfragen, eine Email senden, einen Datensatz aktualisieren. |
| **LLM**       | Lila      | Schickt einen Prompt an ein KI-Modell und reicht die Antwort weiter.                                                     |
| **Condition** | Bernstein | Prüft eine Bedingung und zweigt zu verschiedenen Ästen.                                                                  |
| **Loop**      | Cyan      | Wiederholt eine Gruppe von Schritten für jedes Element einer Liste.                                                      |
| **Output**    | Grün      | Definiert die Form der Daten, die zurückgegeben werden, wenn der Workflow fertig ist.                                    |

Schritte werden mit gerichteten Links verbunden. Die Ausführung folgt den Links von Start zu Output.

## Trigger

Ein Trigger sagt dem Workflow, wann er laufen soll. Siehe [Trigger](/de/platform/automations/triggers) für die drei Arten (Zeitplan, Event, Webhook) und deren Konfiguration.

## Variablen

Variablen sind gemeinsam genutzte Key-Value-Daten, auf die jeder Schritt zugreifen kann. Nützlich für API-Schlüssel, die mehrere Schritte referenzieren, für Feature-Flags, die das Workflow-Verhalten ändern, oder für Konstanten, die du nicht in jeder Schritt-Konfiguration wiederholen willst.

Variablen liegen im **Konfiguration**-Tab des Workflows. Jeder Schritt kann sie per `{{ variables.name }}` auslesen.

## Entwurf vs. Aktiv

Workflows haben, wie Agents, ein Entwurf-Veröffentlichen-Modell. Ein Workflow kann erst aktiviert werden, wenn er veröffentlicht ist. Änderungen nach der Aktivierung erzeugen einen neuen Entwurf, der neben der aktiven Version läuft, bis du erneut veröffentlichst.

## Läufe und Ausführungen

Jedes Mal, wenn ein Trigger feuert, erstellt die Plattform eine **Ausführung**. Ausführungen leben im **Ausführungen**-Tab des Workflows mit Startzeit, Dauer, Endstatus und einer Pro-Schritt-Aufschlüsselung von Inputs, Outputs und Fehlern. Siehe [Ausführungslogs](/de/platform/automations/execution-logs).

## Weiter

Bereit, einen zu bauen? Gehe zu [Workflows](/de/platform/automations/workflows).
