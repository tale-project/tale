---
title: Ausführungsprotokolle
description: Die Laufhistorie pro Workflow — jede Ausführung mit Status, Zeiten und Trigger-Quelle, ausklappbar zum Journal pro Schritt. Lies das, wenn ein Lauf fehlschlug oder sich seltsam verhielt.
---

Ausführungsprotokolle sind die Laufhistorie eines einzelnen Workflows. Jedes Mal, wenn ein Trigger feuert, öffnet Tale einen Ausführungsdatensatz und schreibt hinein, während der Lauf voranschreitet — Status, Zeiten, die empfangene Eingabe und was jeder Schritt konsumiert und produziert hat. Der Tab **Ausführungen** ist die Debugging-Oberfläche, auf die jede andere Automatisierungs-Seite zeigt, wenn etwas schiefging.

<Frame caption="Der Ausführungen-Tab — eine Zeile pro Lauf; das eine rote Abzeichen zwischen den grünen ist der Startpunkt jeder Debugging-Sitzung.">

![Der Ausführungen-Tab einer Automatisierung listet zwölf Läufe — elf mit grünem Abzeichen Abgeschlossen und einer mit rotem Abzeichen Fehlgeschlagen —, jeder mit Ausführungs-ID, Startzeitstempel, Dauer und event als Trigger-Quelle.](/images/platform/automation-executions.webp)

</Frame>

## Die Listenansicht

Eine Zeile pro Lauf, neueste zuerst. Die Werkzeugleiste trägt **Nach Ausführungs-ID suchen**, einen **Filter** und eine Datumsbereichsauswahl.

| Spalte         | Beschreibung                                                                                                                                                                                                         |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ausführungs-ID | Stabile Kennung des Laufs — das Kopiersymbol legt sie in die Zwischenablage.                                                                                                                                         |
| Status         | **Ausstehend**, **Läuft**, **Abgeschlossen** oder **Fehlgeschlagen** — dazu **Wartet auf Eingabe**, wenn ein Lauf auf einen Menschen wartet, und **Pausiert (Debug)** während eines Schritt-für-Schritt-Debug-Laufs. |
| Gestartet am   | Startzeit nach Wanduhr, auf die Millisekunde genau.                                                                                                                                                                  |
| Dauer          | Start bis Abschluss; leer, solange der Lauf noch läuft.                                                                                                                                                              |
| Ausgelöst von  | Welcher Weg den Lauf gestartet hat — ein Zeitplan, ein Webhook, ein Ereignis oder ein Test aus dem Editor.                                                                                                           |

## Der ausgeklappte Lauf

Klappe eine Zeile aus, und der Datensatz erscheint als JSON: die Metadaten der Ausführung (Status, Zeiten, Trigger-Quelle und der Fehler, falls vorhanden), die vom Trigger mitgeführten Metadaten, die Eingabevariablen und das **Journal** — ein Eintrag pro ausgeführtem Schritt mit seinen Eingaben, Ausgaben und seinem Status. Ein fehlgeschlagener Schritt trägt den Fehlertext, der ihn beendet hat. Lies das Journal von oben nach unten, und der Lauf erzählt sich selbst nach; der Eintrag, dessen Status kippt, ist der Schritt, der sich danebenbenommen hat.

## Wiederholungen und Neustarts

Vorübergehende Fehler wiederholen sich von selbst. Der Tab **Konfiguration** des Workflows setzt den Standard — **Max. Wiederholungen** und **Backoff (ms)** — und jeder Schritt kann ihn in seiner eigenen Konfiguration überschreiben.

<Frame caption="Der Konfiguration-Tab — das Wiederholungsbudget und der Backoff, die jeder Schritt erbt, sofern er sie nicht überschreibt.">

![Der Konfiguration-Tab einer Automatisierung mit Feldern für Name und Beschreibung, einem Timeout von 600000 Millisekunden, maximal 3 Wiederholungen, einem Backoff von 1000 Millisekunden und einem JSON-Editor für Variablen.](/images/platform/automation-configuration.webp)

</Frame> Ein Lauf, der über sein Wiederholungsbudget hinaus fehlschlägt, bleibt für die Audit-Spur **Fehlgeschlagen**; für einen neuen Versuch öffne **Workflow testen** im Editor, füge die aus dem Variablenblock des fehlgeschlagenen Laufs kopierte Eingabe ein und klicke auf **Ausführen**. Der Neustart ist eine frische Ausführung mit eigener ID.

## Eine Debugging-Sitzung, durchgespielt

Ein täglicher Bericht kam nicht an. Öffne den Workflow, wechsle zu **Ausführungen** und filtere auf die heutigen Fehlschläge — der fehlgeschlagene Lauf liegt obenauf. Klappe ihn aus: Das Journal zeigt, dass der zusammenfassende Schritt an einem Timeout scheiterte, und seine Eingaben tragen den Prompt, den er erhielt. Behebe die Ursache, starte aus dem Testpanel mit derselben Eingabe neu und sieh der neuen Ausführung beim Abschließen zu, bevor du dem morgigen Zeitplan traust.

## Wo das hingehört

Ausführungsprotokolle sind die Quittung, die jeder Workflow hinterlässt. Kombiniere sie mit [Triggern](/de/platform/automations/triggers) für den Startschuss, der jeden Datensatz geöffnet hat, und mit [Audit-Logs](/de/platform/admin/governance/audit-logs) für die organisationsweite Spur, wer was geändert hat.
