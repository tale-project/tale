---
title: "KI-Agent oder Workflow: Was braucht diese Aufgabe?"
description: "Wähle feste Schritte, einen Modellaufruf oder einen Agenten für deinen Bericht. Rechne nach klaren Regeln und untersuche nur, was offenbleibt."
slug: ai-agents-vs-workflow-automation
topicId: T03
reviewed: '2026-10-03'
draft: false
coverAlt: "Ein fester und ein verzweigter Weg führen zu einem gemeinsamen Arbeitsergebnis."
---

Nutze einen festen Workflow, wenn du Schritte und Entscheidungsregeln im Voraus festlegen kannst. Ein Agent ist sinnvoll, wenn er ein Ergebnis untersuchen und dann entscheiden muss, was er als Nächstes prüft oder tut. Für eine Zusammenfassung mitgelieferter Texte kann ein einziger Modellaufruf reichen.

Diese Ansätze lassen sich im selben Prozess verbinden. Ein Monatsbericht kann feste Schritte zur Berechnung von Summen, ein Modell zur Zusammenfassung von Kommentaren und einen Agenten zur Untersuchung einer unerklärten Veränderung nutzen. Kläre zuerst, was jeder Teil leisten soll, und wähle danach den Aufbau.

## Wer entscheidet über den nächsten Schritt?

Ein Workflow folgt den Schritten und Verzweigungen, die du vorgibst. Ein Agent wählt seine nächste Aktion aus den Möglichkeiten, die ihm zur Verfügung stehen. Der Unterschied liegt darin, wer den Ablauf steuert, nicht darin, ob überhaupt KI beteiligt ist. So unterscheidet auch [Anthropics Leitfaden zum Aufbau von Agenten](https://www.anthropic.com/engineering/building-effective-agents) die beiden Ansätze.

Ein Workflow kann einen Sprachmodellschritt enthalten. „Ordne diese Kommentare Kategorien zu und fasse sie dann zusammen“ bleibt eine vorgegebene Abfolge, auch wenn die Zuordnungen variieren oder falsch sein können. Ein fester Ablauf macht generierte Inhalte nicht automatisch richtig.

Ein Agent muss auch nicht die ganze Aufgabe steuern. Du kannst ihn eine Frage untersuchen lassen und Berechnungen, Datenänderungen und Versand weiterhin in festgelegten Schritten ausführen.

![Ein fester Workflow folgt vorgegebenen Schritten, ein Agent wählt Aktionen anhand seiner Beobachtungen. Ein kombinierter Ablauf setzt eine begrenzte Untersuchung durch einen Agenten zwischen Validierung und Prüfung.](/blog/diagrams/de/T03-diagram.svg)

## Geh einen monatlichen Feedbackbericht durch

Ein Beispiel: Ein Team erhält 22 Feedbackzeilen. Zwei wiederholen eine bereits vorhandene Feedback-ID. Nach der vereinbarten Regel, je ID eine Zeile zu behalten, bleiben 20 verschiedene Rückmeldungen.

Acht sind bereits der Kategorie Einrichtung zugeordnet. Im Vormonat waren es vier von 20. Der Anteil dieser Kategorie am erfassten Feedback ist damit von 20 % auf 40 % gestiegen, also um 20 Prozentpunkte.

Das sind Berechnungen, für die ein Agent keinen Entscheidungsspielraum braucht. Ein definierter Schritt kann die IDs prüfen, die Dublettenregel anwenden, die Kategorien zählen und ausgeschlossene Zeilen aufbewahren. Widersprechen sich zwei Versionen derselben ID, geht dieser Fall an den Berichtsverantwortlichen, statt stillschweigend eine Version zu wählen.

Was danach sinnvoll ist, hängt von der eigentlichen Frage ab:

| Gewünschtes Ergebnis | Verfügbare Eingaben | Erster Ansatz | Grund |
| --- | --- | --- | --- |
| Anzahl je Kategorie melden | Geprüfte Zeilen und vereinbarte Zählregeln | Fester Workflow | Die Rechenschritte stehen bereits fest |
| Die acht Einrichtungskommentare zusammenfassen | Alle zugehörigen Kommentare | Ein Modellaufruf mit anschließender Prüfung | Weitere Quellen müssen nicht ausgewählt werden |
| Mögliche Gründe für den Anstieg untersuchen | Kommentare und Erlaubnis, Produktreferenzen hinzuzuziehen | Ein klar begrenzter Agentenauftrag oder eine Person | Die Erkenntnisse bestimmen, welche Quelle als Nächstes geprüft wird |

Die dritte Variante hilft nur, wenn weitere Recherche die Antwort verändern kann. Passt das relevante Material bereits in ein kurzes Dokument, bringt eine zusätzliche Schleife mit Tool-Aufrufen womöglich wenig.

## Gib der Untersuchung einen engen Auftrag

Angenommen, beim ersten Lesen fallen drei Beschwerden zu Einladungen auf, zwei zur Einmalanmeldung (SSO), zwei zum Import und eine unklare Rückmeldung. Die Einladungskommentare legen einen Blick in die Berechtigungsreferenz nahe. Die Kommentare zur Anmeldung sprechen dafür, eine Versionsnotiz zu prüfen. Unterschiedliche Befunde führen zu unterschiedlichen nächsten Quellen.

Das ist eine plausible Aufgabe für einen Agenten. Ein Auftrag könnte lauten:

> Untersuche die acht Einrichtungskommentare anhand der bereitgestellten Produktreferenzen und Versionsnotizen. Liefere mögliche Erklärungen mit Feedback-IDs, belegenden Textstellen und noch fehlenden Fakten. Behalte die bestätigten Zählwerte bei. Frage den Berichtsverantwortlichen, wenn du nicht verfügbare Kontodaten brauchst. Ändere keine Datensätze und veröffentliche den Bericht nicht.

Der Agent kann empfehlen, die Einladungsanleitung zu prüfen, ohne allen acht Kommentaren dieselbe Ursache zuzuschreiben. Zwei Beschwerden zur Anmeldung und eine Veröffentlichung im selben Monat belegen nicht, dass die Veröffentlichung den Anstieg verursacht hat.

Ebenso darf aus „40 % des erfassten Feedbacks betreffen die Einrichtung“ nicht „40 % der Kunden haben Probleme mit der Einrichtung“ werden. Der Export liefert diese Gesamtzahl der Kunden nicht. Prüfe die vorgeschlagene Erklärung an den ursprünglichen Datensätzen, nicht nur an ihrer sauberen Darstellung.

## Teste den einfachsten Ansatz, der die Frage beantwortet

Probiere ein kleines Beispiel aus, bevor du den ganzen Prozess aufbaust. Nimm eine gewöhnliche Eingabe, eine widersprüchliche Dublette und eine fehlende Referenz dazu. Prüfe, ob die Zählwerte stimmen, offene Fragen sichtbar bleiben und das Ergebnis die gestellte Frage beantwortet.

Wenn ein einzelner Modellaufruf aus dem vorliegenden Material eine ausreichende Erklärung liefert, bleib dabei. Findet ein Agent zusätzliche nützliche Belege, vergleiche diesen Gewinn mit den weiteren Tool-Aufrufen und dem Prüfaufwand. Eine Person kann für die Untersuchung weiterhin besser geeignet sein, wenn wesentliche Belege unzugänglich sind oder sich nicht prüfen lassen.

Bei wiederkehrenden Prozessen solltest du typische Fälle mehrfach testen, statt dich auf einen gelungenen Durchlauf zu verlassen. Halte Fehler und notwendige Korrekturen fest. Die [Entscheidungsvorlage für den Prozess](/blog/worksheets/de/T03-process-decision.md) hilft dir, deine Wahl und den Anlass für eine spätere Neubewertung zu notieren.

Tale bietet einen `llm`-Schritt für einen einzelnen Modellaufruf und einen `agent`-Schritt für Arbeit mit Tools, Dateien oder mehreren Gesprächsschritten. Die [Automationskonzepte](https://docs.tale.dev/de/platform/automations/concepts) beschreiben ihr aktuelles Verhalten.
