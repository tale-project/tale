---
title: Modellkatalog
description: Welche Modelle deine Organisation auswählen kann, woher die Liste jedes Anbieters stammt und was du prüfst, wenn ein erwartetes Modell in der Auswahl fehlt.
---

Jeder Modell-Picker in Tale bietet dasselbe an — die Modelle, die deine Organisation gerade wirklich erreichen kann. Diese Menge entsteht pro Anbieter, aus der Modellliste des Connectors und den Zugangsdaten, die du dagegen hältst, und wird danach von deinen Governance-Regeln eingeengt. Diese Seite erklärt, woher jedes Stück kommt, damit „warum fehlt dieses Modell“ eine Antwort hat, mit der du etwas anfangen kannst.

## Der Katalog gehört zum Anbieter

Eine einzige globale Modellliste gibt es nicht. Jeder Anbieter-Connector deklariert, woher seine Modelle kommen, und das Badge im Abschnitt dieses Connectors unter **Einstellungen > KI-Anbieter** benennt die Quelle:

- **Mitgelieferter Katalog** — die Liste kommt mit der Plattform und wird mit ihr aktualisiert. So arbeiten OpenAI, Anthropic, Gemini, DeepSeek, Moonshot AI (Kimi), Qwen (Alibaba), SpaceXAI und Z.ai (GLM).
- **OpenRouter-Katalog** — direkt aus OpenRouters eigenem Katalog geholt und beim Eintreffen normalisiert. So arbeitet OpenRouter, weshalb seine Liste mit Abstand die längste ist.
- **Models-Endpunkt des Anbieters** — aus der Modell-Auflistung des Anbieters selbst geholt. So arbeitet Vercel AI Gateway.
- **Kein Katalog** — der Anbieter veröffentlicht nichts, was sich mitliefern liesse, also kommen die Modelle stattdessen aus den einzelnen Zugangsdaten. So arbeiten Azure OpenAI und Nous Portal (Hermes).

Die Zahl neben dem Badge ist die aktuelle Liste dieses Connectors. Diese Zahl sagt nichts darüber, was deine Organisation aufrufen darf, sondern nur, was der Anbieter anbietet.

## Was über Verfügbarkeit entscheidet

Ein Modell erreicht eine Auswahl, nachdem es zwei Schranken in dieser Reihenfolge passiert hat.

Die erste sind die Zugangsdaten. Ein Connector ohne Zugangsdaten ist ein Anbieter, den du nicht aufrufen kannst — Katalog hin oder her. Ein Eintrag mit leerer Liste **Erlaubte Modelle** bietet den ganzen Katalog seines Connectors an, ein Eintrag mit gefüllter Liste nur die Modelle darauf. Die Vereinigung über alle aktiven Zugangsdaten ist das, was deine Organisation technisch erreicht.

Die zweite ist Governance. Die Modellzugriffs-Regeln unter [Inhalte und Modelle](/de/platform/admin/governance/content-models) erlauben oder sperren Modelle pro Organisation, Team, Rolle oder Person und greifen auf die erste Schranke obendrauf. Ein Modell, das die Zugangsdaten passiert, aber nicht die Richtlinie, bleibt für diesen Geltungsbereich unsichtbar, und die Auflösung bindet auch dann nicht daran, wenn ein Agent es fest gesetzt hat.

<Note>

Fehlt ein Modell, das du erwartet hast, geh die beiden Schranken in dieser Reihenfolge durch. Prüf, ob Zugangsdaten für seinen Anbieter existieren und aktiv sind, ob deren Liste erlaubter Modelle es ausschliesst, und dann die Modellzugriffs-Regeln für den Geltungsbereich, aus dem du schaust. Fast jedes „fehlende Modell“ ist einer dieser drei Fälle.

</Note>

## Anbieter ohne mitgelieferten Katalog

Manche Anbieter können keine Liste veröffentlichen, die Tale mitliefern könnte. Bei diesen Connectoren ist die Liste **Erlaubte Modelle** kein Filter mehr, sondern die Verfügbarkeit selbst: Das Feld nimmt freien Text, du trägst Modell-IDs durch Kommas getrennt ein, und genau diese IDs sind die einzigen Modelle, die der Eintrag erreicht.

<Info>

Bei Azure OpenAI sind das die Deployment-Namen, die du in deiner Azure-Ressource vergeben hast, nicht die öffentlichen Modellnamen des Herstellers. Ein Eintrag mit leerer Liste stellt dort überhaupt kein Modell bereit — das ist die übliche Ursache für einen Azure-Connector, der konfiguriert aussieht und trotzdem nichts anbietet.

</Info>

## Einen Live-Katalog aktualisieren

Kataloge, die von einem Anbieter geholt werden, liegen im Cache und werden nur auf Zuruf erneuert. Die Karte **Modellkataloge** oben auf **Einstellungen > KI-Anbieter** trägt den Knopf **Kataloge aktualisieren**, der jede Live-Quelle neu holt und eine Zeile pro Connector meldet: die Anzahl gefundener Modelle oder den Fehler, der sie gestoppt hat.

Einen Hintergrundabgleich und einen geplanten Job gibt es nicht, also erscheint ein heute Morgen veröffentlichtes Modell nach der nächsten Aktualisierung und keine Minute früher. Wenn jeder Connector deiner Instanz einen mitgelieferten Katalog hat, gibt es nichts zu holen, und die Karte sagt genau das.

## Ein Modell auswählen

Der Chat startet auf **Auto**: Tale liest jede Nachricht und wählt ein Modell dafür — eine leichte Heuristik über Länge, Code, Thema und angehängte Dokumente, nie ein weiterer KI-Aufruf — und lässt genau dieses Modell laufen. Auf der Antwort steht es dann fest; die Nachrichtendetails nennen es beim Namen. Wählst du stattdessen ein Modell aus dem Menü, bleibt die Wahl deine, bis du sie an Auto zurückgibst — ein Modell festzunageln ist die Lösung, wenn die automatische Wahl zu langsam, zu teuer oder für die Aufgabe falsch ist.

Überall sonst wird das Modell immer ausdrücklich benannt: auf einem Agenten, auf jedem Workflow-Schritt, der ein Modell aufruft, und auf jeder API-Anfrage. Dort routet nichts für dich — keine Auswahl nach Aufgabenkomplexität, keine Qualitätsstufen. Und nirgendwo — der Chat eingeschlossen — gibt es stilles Ausweichen: Das Modell, das eine Antwort beginnt, beantwortet sie auch, oder du siehst den Fehler. Ein Lauf bleibt reproduzierbar und eine Rechnung zuordenbar, denn welches Modell lief, wird festgehalten, nie geraten.

<Tip>

Wenn mehrere Modelle die Aufgabe plausibel erledigen könnten, schickt [Arena-Modus](/de/platform/chat/arena-mode) denselben Prompt nebeneinander an mehrere davon — aus der Wahl wird ein Vergleich statt eines Bauchgefühls.

</Tip>

## Wo das hingehört

Der Katalog ist die sichtbare Hälfte der Anbieter-Konfiguration: Was ein Admin unter [KI-Anbieter](/de/platform/admin/providers) verbindet, sehen alle anderen hier in einer Auswahl. Die Menge zu erweitern heisst, Zugangsdaten hinzuzufügen oder eine Liste zu lockern; sie zu verengen heisst, eine Liste erlaubter Modelle zu setzen oder eine Modellzugriffs-Regel unter [Inhalte und Modelle](/de/platform/admin/governance/content-models). Wie das Modell neben Anweisungen, Wissen und Werkzeugen in einen Agenten passt, steht in [Agent-Konzepte](/de/platform/agents/concepts).
