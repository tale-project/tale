---
title: Agent-Versionen
description: Sicher an einem aktiven Agent iterieren — jedes Speichern landet im Verlauf, und jeder vergangene Snapshot lässt sich gegen den aktuellen Stand vergleichen und mit einem Klick wiederherstellen.
---

Tales Agents speichern automatisch, während du sie bearbeitest, und jedes Speichern landet in einem Verlauf pro Agent. Anweisungen, Wissensfilter, Tools, Modell-Voreinstellung, Gesprächseinstiege und Delegationsziele werden gemeinsam erfasst — stellst du einen vergangenen Snapshot wieder her, kommt das ganze Paket atomar zurück. Diese Seite behandelt den Iterationsablauf: was ein Verlaufseintrag enthält, wie du zwei Snapshots vergleichst und wann Wiederherstellen der richtige Schritt ist.

Das mentale Modell hinter den vier Stellschrauben liegt unter [Agent-Konzepte](/de/platform/agents/concepts); der Ablauf, der diese Snapshots erzeugt, liegt unter [Agent erstellen](/de/platform/agents/create).

## Wie Speichern und Snapshots funktionieren

Änderungen an der Konfiguration eines Agents speichern automatisch — eine Status-Anzeige oben rechts im Editor zeigt den aktuellen Zustand (speichert, gespeichert). Jedes Speichern erzeugt einen Verlaufseintrag, der die gesamte Agent-Konfiguration in diesem Moment festhält: Anweisungen, Modellauswahl, Wissensumfang, Tool-Schalter, Gesprächseinstiege, Delegationsziele. Keine Teil-Speicherungen, keine Halbzustände; war das Speichern erfolgreich, ist der Eintrag vollständig.

Laufende Konversationen arbeiten weiter mit dem Agent-Zustand, der galt, als die Nachricht startete — niemand sieht mitten in einer Antwort einen Persönlichkeitswechsel, nur weil jemand parallel eine neue Bearbeitung gespeichert hat.

## Verlauf öffnen

Um die Snapshots zu durchstöbern, öffne das Menü **Verlauf** im Agent-Editor. Die Liste zeigt jeden Snapshot mit Akteur und Datum, neueste zuerst. Jede Zeile entspricht einem Speichern; fahre über eine Zeile für eine Tooltip-Vorschau oder öffne den Diff-Dialog, um einen Snapshot gegen den aktuellen Stand zu vergleichen.

Ist die Liste leer, wurde der Agent seit seiner Erstellung nicht bearbeitet — das erste Speichern erzeugt den ersten Verlaufseintrag.

## Zwei Snapshots vergleichen

Klicke auf einen Verlaufseintrag, um den Dialog **Änderungen vergleichen** zu öffnen. Die Ansicht zeigt den aktuellen Stand auf einer Seite und den Snapshot auf der anderen, mit den Unterschieden auf Feldebene hervorgehoben. Nutze sie, um zu sehen, was eine Teamkollegin oder ein Teamkollege im Speichern vom letzten Mittwoch geändert hat, oder um eine konkrete Formulierung der Anweisungen vor dem Zurückrollen zu prüfen. Ist der Snapshot identisch zum aktuellen Stand, zeigt der Dialog _Keine Unterschiede gefunden_ und der Button **Diese Version wiederherstellen** ist deaktiviert.

## Einen vergangenen Snapshot wiederherstellen

Um den Agent auf einen vergangenen Snapshot zurückzurollen, öffne ihn im Diff-Dialog und klicke **Diese Version wiederherstellen**. Das Wiederherstellen ist destruktiv für die aktuelle Konfiguration — Tale speichert den aktuellen Stand nicht automatisch, bevor die Wiederherstellung läuft. Speichere also vorher, wenn du deine laufenden Änderungen behalten willst. Die Wiederherstellung wirkt sofort für alle neuen Konversationen; bereits begonnene Antworten laufen mit ihrem ursprünglichen Stand zu Ende.

Greif zu Wiederherstellen, wenn eine kürzliche Bearbeitung schlechtere Antworten zu liefern begann — falscher Ton, fehlender Umfang, kaputter Tool-Zugriff — und du die Änderungen rausnehmen willst, ohne sie einzeln auseinanderzunehmen. Für ein schrittweises Zurückrollen (nur die Anweisungen zurücksetzen, das neue Tool behalten) öffne den Snapshot zur Referenz und kopiere das gewünschte Feld in den aktuellen Editor, statt eine vollständige Wiederherstellung zu fahren.

## Datei-basierte Agents

Agents, die als JSON-Dateien in `TALE_CONFIG_DIR/agents/*.json` definiert sind, tragen ihren Versionsverlauf in deinem Git-Repository statt im in-Produkt-Verlauf. Bearbeite die Datei, committe die Änderung, und die Plattform übernimmt die neue Konfiguration beim nächsten Sync. Die Verlaufs-UI im Editor zeigt weiterhin Snapshots, die die Plattform beim letzten Anfassen der Datei erfasst hat, aber für datei-basierte Agents ist die Wahrheit das Repository. Siehe [KI-gestützte Entwicklung](/de/develop/ai-assisted-development) für den datei-basierten Ablauf.

## Wo das einsetzt

Der Verlauf ist das Iterations-Sicherheitsnetz für Agents. Die eine Sache, die du dir merken solltest: jedes Speichern erzeugt einen Snapshot, das Umschreiben der Anweisungen eines Agents ist also gefahrlos — produziert die neue Fassung schlechtere Antworten, ist die vorherige einen Klick entfernt. Nutze den Diff-Dialog bei jeder bedeutsamen Änderung, um zu bestätigen, dass der Snapshot das enthält, was du erwartet hast; greif zu Wiederherstellen, wenn eine kürzliche Bearbeitung schlechtere Ausgaben zu liefern begann und du den vorherigen Zustand komplett zurückwillst.

Für den Erstellungsablauf selbst — Name, Modellauswahl, Anweisungen, Wissen, Tools — geh zurück zu [Agent erstellen](/de/platform/agents/create). Für das mentale Modell hinter den vier Stellschrauben, [Agent-Konzepte](/de/platform/agents/concepts).
