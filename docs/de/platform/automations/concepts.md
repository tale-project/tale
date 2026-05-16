---
title: Automatisierungs-Konzepte
description: Wie Automatisierungen, Schritte, Trigger und Variablen zusammenspielen.
---

Eine Automatisierung ist ein deterministisches Hintergrund-Programm, das läuft, wenn etwas sie anstösst: eine Uhr, ein Ereignis innerhalb von Tale, ein Webhook aus einem Fremdsystem oder eine Person, die auf **Ausführen** klickt. Während der Chat offen bleibt und der Konversation folgt, tut eine Automatisierung exakt das, was ihre Schritte sagen, in der Reihenfolge, in der sie es sagen, bei jedem Lauf. Das Publikum dieser Seite sind alle, die gleich eine Automatisierung bauen, debuggen oder lesen — Entwickler-Rolle oder höher, in der Cloud oder selbst gehostet.

Das Vokabular unten — Automatisierung, Schritt, Trigger, Variable, Lauf — ist die kleine Menge, die der Rest dieses Bereichs voraussetzt. Lies es einmal, und der Editor, der **Trigger**-Tab und der **Ausführungen**-Tab werden alle für sich allein lesbar.

## Die Automatisierung selbst

Eine Automatisierung ist eine benannte, ausführbare Einheit. Sie besitzt eine Liste von Schritten, die Trigger, die sie starten, die Variablen, die jeder Schritt lesen kann, und eine kleine Reihe von Stellschrauben (Timeout, Anzahl Wiederholungen, Backoff-Verzögerung). Veröffentlichen, eine ältere Version aus **Verlauf** wiederherstellen und eine einzelne Linie im Metriken-Dashboard beobachten sind alles Aktionen pro Automatisierung — der Rest des Modells baut auf der Automatisierung als Atom auf.

## Schritte

Ein Schritt ist eine Arbeitseinheit. Der Editor liefert sechs Schritttypen, farblich markiert, damit sich die Form einer Automatisierung auf einen Blick lesen lässt.

| Schritt       | Was er tut                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------ |
| **Start**     | Der Einstiegspunkt. Trägt das Eingabeschema und bindet die Trigger, die die Automatisierung starten.   |
| **Aktion**    | Führt eine Operation aus — eine Integration aufrufen, in eine Datenbank schreiben, eine E-Mail senden. |
| **LLM**       | Schickt einen Prompt an ein Modell und reicht die Antwort an den nächsten Schritt weiter.              |
| **Bedingung** | Verzweigt den Pfad anhand einer Prüfung.                                                               |
| **Schleife**  | Läuft eine Untersequenz einmal pro Element einer Liste.                                                |
| **Ausgabe**   | Benennt die Daten, die die Automatisierung beim Abschluss zurückgibt.                                  |

Schritte sind durch gerichtete Links miteinander verdrahtet. Die Ausführung läuft die Links von **Start** zu **Ausgabe** ab; **Bedingung** wählt eine Verzweigung; **Schleife** wiederholt ihren inneren Block pro Listeneintrag.

## Trigger

Ein Trigger benennt den Moment, in dem die Automatisierung startet, und mit welcher Eingabe sie beginnt. Tale liefert drei Geschmacksrichtungen — **Zeitpläne** für uhr-gesteuerte Läufe, **Webhooks** für Läufe, die von ausserhalb der Plattform angestossen werden, und **Ereignisse** für Läufe, die auf etwas reagieren, das innerhalb von Tale passiert (ein neuer Kunde, eine geschlossene Konversation, eine andere Automatisierung, die fertig wird). Eine Automatisierung kann mehrere Trigger beliebiger Art tragen, sodass derselbe Fan-out auf einem nächtlichen Zeitplan und bei jedem eingehenden Webhook laufen kann. Die Details — Cron-Syntax, die Webhook-URL, die unterstützten Ereignistypen — stehen unter [Trigger](/de/platform/automations/triggers).

## Variablen

Variablen sind der gemeinsame Schlüssel-Wert-Beutel, den jeder Schritt lesen kann. Hier hinterlegst du den API-Schlüssel, auf den drei Schritte verweisen, das Feature-Flag, das das Verhalten zwischen Staging und Produktion umlegt, oder die Konstante, die du nicht in fünf Schritt-Konfigurationen einkopiert haben willst. Sie leben im **Konfiguration**-Tab und werden in jedem Schritt mit der Syntax `{{ variables.name }}` gelesen.

## Läufe

Jedes Mal, wenn ein Trigger feuert, erzeugt die Plattform einen Lauf im **Ausführungen**-Tab. Ein Lauf trägt die Trigger-Quelle, die Start- und Endzeit, den Endstatus und eine Aufzeichnung pro Schritt mit der gesehenen Eingabe, der erzeugten Ausgabe und jedem geworfenen Fehler. Das ist das Artefakt, das du öffnest, wenn eine Drittanbieter-API `400` zurückgegeben hat und du den buchstäblichen Anfrage-Body sehen willst, der ihn produziert hat — siehe [Ausführungslogs](/de/platform/automations/execution-logs).

## Wann du danach greifst

Automatisierungen und Agents sind die zwei Arten, wie Tale KI-Arbeit erledigt; wähle danach, wo der Mensch sitzt.

| Greif zur Automatisierung, wenn …                                                 | Greif zum Agent, wenn …                                                            |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Ein Zeitplan, ein Webhook oder ein Systemereignis die Arbeit startet              | Eine Person eine Frage stellt und auf eine geschriebene Antwort wartet             |
| Der Ablauf in jedem Lauf gleich ist — gleiche Schritte, gleiche Reihenfolge       | Der Ablauf an der Antwort verzweigt; der nächste Schritt hängt von der Absicht ab  |
| Die Ausgabe ein Schreibvorgang in ein anderes System, eine E-Mail, ein Ticket ist | Die Ausgabe Text ist, den die Person liest, oder eine kleine strukturierte Payload |
| Du eine Pro-Lauf-Spur jeder Eingabe, Ausgabe und jedes Fehlers willst             | Du ein Konversationsprotokoll mit den Modellüberlegungen inline willst             |

Die beiden komponieren. Der **LLM**-Schritt einer Automatisierung kann die Anweisungen und Tool-Liste eines Agents übernehmen; ein Agent kann einen langlaufenden Job über das Integrationen-Tool an eine Automatisierung übergeben. Wähle das primäre Element danach, ob ein Mensch eingebunden ist, wenn die Arbeit startet.

## Einen bauen

Die fünf Begriffe auf dieser Seite — Automatisierung, Schritt, Trigger, Variable, Lauf — sind das ganze Modell. Die nächste Seite ist der Editor, der sie in etwas Lauffähiges verwandelt: [Automatisierungen](/de/platform/automations/workflows).
