---
title: Modelle in der Arena vergleichen
description: Sende eine Frage an zwei Modelle, beurteile beide Antworten und entscheide, wie der Chat weitergeht.
---

Mit **Arena-Modus** vergleichst du zwei Modelle anhand derselben Nachricht. Beide Seiten verwenden den Chat-Assistenten und denselben Ausgangskontext. Wähle eine Frage, deren Antwort du beurteilen kannst: Eine persönliche Vorliebe belegt noch keine sachliche Richtigkeit.

## Einen Vergleich starten

Öffne einen privaten Chat, dann das **+**-Menü im Eingabebereich und wähle **Arena-Modus**. Geteilte Chats können nicht in die Arena wechseln. Wähle unter **Modell A** und **Modell B** die Modelle und sende deine Nachricht. Du darfst dasselbe Modell zweimal wählen, um Unterschiede zwischen Antworten zu untersuchen, oder zwei verschiedene Modelle vergleichen.

Für einen ersten Vergleich eignen sich eine kurze Quelle und ein präziser Auftrag, etwa: „Liste die drei Entscheidungen aus diesen Besprechungsnotizen auf und belege jede mit dem passenden Satz.“ Quelle, Anweisungen und gewünschtes Format bleiben für beide Seiten gleich.

<Frame caption="Dasselbe Prompt, von zwei Modellen beantwortet, mit der Bewertungszeile darunter.">

![Der Arena-Modus mit einem Prompt für eine Launch-Checkliste, beantwortet in zwei Spalten — links liefert Claude Haiku 4.5 eine nummerierte Liste aus fünf Schritten, rechts gruppiert Claude Sonnet 4.6 dieselbe Arbeit unter Überschriften und ergänzt die Risiken, die eine Erwähnung wert sind — über den Bewertungs-Knöpfen A ist besser, B ist besser, Unentschieden und Beide schlecht.](/images/platform/chat-arena-split.webp)

</Frame>

Jede Antwort erscheint in einer eigenen Spalte. Warte mit der Bewertung, bis beide abgeschlossen sind. Während eine Seite noch antwortet, bleiben die Bewertungsbuttons gesperrt. Auch die Wartezeit gehört zum Vergleich. Schlägt eine Seite fehl, lies zuerst den Fehler, bevor du das Ergebnis als Qualitätsurteil wertest.

## Die Antworten beurteilen

Prüfe die Fakten anhand der Quelle, die Einhaltung der Anweisungen, fehlende wesentliche Details und den Bearbeitungsaufwand vor der Verwendung. Eine längere oder selbstbewusst formulierte Antwort ist nicht automatisch besser.

| Bewertung | Wann sie passt | Der Chat geht weiter mit |
| --- | --- | --- |
| **A ist besser** | A ist hilfreicher oder genauer. | Spalte A. |
| **B ist besser** | B ist hilfreicher oder genauer. | Spalte B. |
| **Unentschieden** | Beide erfüllen den Auftrag gleich gut. | Spalte A. |
| **Beide schlecht** | Keine Antwort ist brauchbar. | Spalte A. |
| **Ohne Bewertung beenden** | Du möchtest den Vergleich nicht bewerten. | Spalte A, ohne Bewertung. |

Jede Auswahl beendet den Vergleich mit zwei Spalten. Die nächste Nachricht geht an den verbleibenden Chat. Aktiviere die Arena für einen neuen Vergleich erneut; bei einem Unentschieden bleiben nicht beide Spalten aktiv.

## Gespeichertes Feedback finden

Wenn beide Modelle geantwortet haben, fließt die Bewertung in die [Feedback-Analyse](/de/platform/admin/governance/feedback-analytics) der Organisation ein. Administratoren können dort die Arena-Bewertungen und Modellvergleiche prüfen. **Ohne Bewertung beenden** erzeugt keine Bewertung.

Vergleiche mehrere typische Aufgaben, bevor du ein Modell beurteilst. Ein Ergebnis für kurze Zusammenfassungen sagt wenig über Code oder lange Dokumente aus. Organisationsweite Vorlieben enthalten außerdem Aufgaben anderer Personen.

## Einen blockierten Vergleich klären

Fehlt ein Modell, prüfe mit dem [Modellkatalog](/de/platform/models) Provider und Zugriffsregeln. Sind die Bewertungsbuttons noch gesperrt, müssen zuerst beide Antworten enden. Ein fehlgeschlagener Aufruf kann an Zugangsdaten, Verfügbarkeit oder Richtlinien liegen. Entscheide anhand der angezeigten Begründung, was vor einem neuen Versuch zu korrigieren ist.
