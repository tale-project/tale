---
title: Automatisierungen
description: Automatisierungen im visuellen Editor bauen, konfigurieren und testen.
---

Der Automatisierungs-Editor ist der Ort, an dem das Vokabular aus [Automatisierungs-Konzepte](/de/platform/automations/concepts) zu einem ausführbaren Graphen wird. Diese Seite deckt den Build-Ablauf selbst ab: den Editor öffnen, die sechs Schritttypen, die Konfigurations-Stellschrauben für Wiederholungen und Timeouts, die Variablen, die jeder Schritt lesen kann, und den Weg über **Automatisierung testen**, der einen Entwurf beweist, bevor er live geht. Die Zielgruppe ist der Entwickler oder höher, der eine Automatisierung baut oder pflegt; Trigger- und Ausführungsoberflächen haben eigene Seiten, unten verlinkt.

## Den Editor öffnen

Öffne **Automatisierungen** in der Seitenleiste und klick auf **Automatisierung erstellen**. Der Dialog hat zwei Tabs: **Leer** lässt dich in einem einzigen Feld beschreiben, was die Automatisierung tun soll, und der KI-Assistent macht aus dieser Beschreibung einen ersten Entwurf aus Schritten, den du im Editor verfeinerst. **Aus Vorlage** listet die fertigen Automatisierungen, die mit installierten Integrationen kommen — wähle eine, gib ihr einen Namen, und der Editor öffnet sich mit den bereits verdrahteten Schritten der Vorlage.

Der Editor selbst ist eine Leinwand. Schritte sind Knoten, Verbindungen zwischen ihnen sind gerichtet, und das Panel auf der rechten Seite öffnet, was gerade ausgewählt ist. Die Symbolleiste oben auf der Leinwand trägt **Schritt hinzufügen**, **Automatisierung testen**, **KI-Assistent** und **Fokus** (klappt die Leinwand auf eine einzelne Spalte für einen kleineren Bildschirm zusammen).

## Schritttypen

Sechs Schritttypen decken die Arbeit ab, die eine Automatisierung leisten kann. Wähle nach dem, was der Schritt erreichen muss.

| Schritt       | Wofür                                                                                                |
| ------------- | ---------------------------------------------------------------------------------------------------- |
| **Start**     | Der Einstiegspunkt. Benennt das Eingabeschema und bindet die Trigger.                                |
| **Aktion**    | Eine Integrationsoperation, ein MCP-Tool oder eine Tale-eigene Aktion aufrufen.                      |
| **LLM**       | Einen Prompt an ein Modell schicken und die Antwort weiter routen.                                   |
| **Bedingung** | Auf einen von mehreren Pfaden verzweigen, basierend auf einer Prüfung der bisherigen Schrittausgabe. |
| **Schleife**  | Einen Block von Schritten pro Element einer Liste wiederholen.                                       |
| **Ausgabe**   | Die Daten benennen, die die Automatisierung beim Abschluss zurückgibt.                               |

Jeder Schritt landet mit sinnvollen Vorgaben auf der Leinwand; du konfigurierst ihn, indem du ihn anklickst und im rechten Panel bearbeitest. Das Panel validiert beim Tippen und markiert fehlende Felder mit einem Inline-Fehler, statt die Automatisierung in einem kaputten Zustand speichern zu lassen.

## Konfiguration

Öffne den Tab **Konfiguration** einer beliebigen Automatisierung, um die Stellschrauben zu setzen, die für die gesamte Ausführung gelten, nicht für einen einzelnen Schritt.

| Feld                    | Standard    | Was es tut                                                                                                          |
| ----------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------- |
| **Name**                | —           | Der Name, der überall in der Plattform angezeigt wird. Pflicht.                                                     |
| **Beschreibung**        | —           | Freitext-Beschreibung, taucht in Auswahllisten und in den Metriken auf.                                             |
| **Timeout (ms)**        | 300.000     | Wie lange die gesamte Automatisierung laufen darf, bevor die Engine sie stoppt. Standard sind fünf Minuten.         |
| **Max. Wiederholungen** | 3           | Anzahl der Wiederholungen pro Schritt, wenn ein Schritt mit einem vorübergehenden Fehler scheitert.                 |
| **Backoff (ms)**        | 1.000       | Verzögerung zwischen Wiederholungen. Verdoppelt sich pro Versuch bis zu einer sinnvollen Grenze.                    |
| **Variablen**           | `{}` (JSON) | Gemeinsamer Schlüssel-Wert-Beutel, den jeder Schritt als `{{ variables.<key> }}` liest. Als JSON-Objekt bearbeiten. |

Der Button **Konfiguration speichern** schreibt die Änderung. Gespeicherte Änderungen gelten für die nächste Ausführung — laufende Ausführungen behalten die Konfiguration, mit der sie gestartet sind.

## Variablen

Das Feld **Variablen** ist ein JSON-Objekt. Alles, was du dort ablegst, ist aus jeder Schritt-Konfiguration mit der Syntax `{{ variables.<key> }}` lesbar. Die zwei häufigen Formen sind Zugangsdaten, die mehrere Schritte referenzieren, und Feature-Flags, die das Verhalten zwischen Entwürfen und der Live-Version ändern. Zwei Punkte sind festzuhalten: geheime Werte, die als Variablen abgelegt sind, sind nicht zusätzlich verschlüsselt — für Zugangsdaten, die ein Konnektor liest, nutze stattdessen die Zugangsdaten-Oberfläche der Integration; und Variablen sind mit dem Rest der Automatisierung versioniert, sodass ein Wiederherstellen aus **Verlauf** sie zusammen mit den Schritten zurückholt.

## Automatisierung testen

Klick **Automatisierung testen** in der Symbolleiste, um den Entwurf mit einem Eingabe-Payload deiner Wahl laufen zu lassen. Der Test läuft gegen dieselbe Engine wie Produktionsausführungen, wird aber auf dem Tab **Ausführungen** mit der Trigger-Quelle `manual` festgehalten, sodass du ihn erneut abspielen, seine Ausgabe gegen eine frühere Ausführung diffen und seine Eingabe später wiederverwenden kannst. Nutze ihn vor dem Veröffentlichen — ein veröffentlichter Entwurf beginnt sofort auf seinen echten Triggern zu feuern, und ein Fünf-Sekunden-Testfang schlägt einen Pager-Alarm um 3 Uhr morgens wegen eines falsch konfigurierten Schritts vom Typ **Aktion**.

## Verlauf

Jede gespeicherte Änderung landet im **Verlauf**, neben der Hauptleinwand des Editors. Der Button **Wiederherstellen** rollt die Automatisierung auf den von dir gewählten Schnappschuss zurück; die Ansicht **Änderungen vergleichen** zeigt das Diff, bevor du dich zum Wiederherstellen entscheidest. Der Verlauf ist das Sicherheitsnetz für „die Änderung, die ich heute Morgen ausgespielt habe, hat die nächtliche Ausführung kaputt gemacht" — öffnen, vorigen Schnappschuss finden, wiederherstellen.

## Bau einen

Der Editor ist mit Absicht meinungsstark: jeder Schritt tut einen Zug, der Graph läuft von **Start** zu **Ausgabe**, und **Automatisierung testen** beweist die Form vor der Veröffentlichung. Die nächsten zwei Seiten decken die Teile des Modells ab, auf die der Editor nur zeigt — [Trigger](/de/platform/automations/triggers) für die vier Wege, auf denen eine Automatisierung startet, und [Ausführungsprotokolle](/de/platform/automations/execution-logs) für die Spur pro Lauf, die du liest, wenn etwas schiefläuft.
