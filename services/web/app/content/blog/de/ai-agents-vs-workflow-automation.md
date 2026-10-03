---
title: "KI-Agenten oder Workflow-Automatisierung?"
description: "Wähle feste Abläufe, einen Modellschritt oder KI-Agenten anhand eines konkreten Berichts. Mit Entscheidungsmatrix, Belegen und Abnahmekriterien."
slug: "ai-agents-vs-workflow-automation"
topicId: "T03"
reviewed: "2026-10-03"
draft: false
coverAlt: "Ein fester und ein verzweigter Weg führen zu einem gemeinsamen Arbeitsergebnis."
---

Ein Monatsbericht kann die richtigen Schritte durchlaufen, jede Summe korrekt berechnen und trotzdem die falsche Geschichte erzählen. Acht Rückmeldungen erwähnen Einrichtungsprobleme. Ein Agent macht daraus: „40 % der Kunden haben Schwierigkeiten beim Einstieg.“ Für die bereitgestellten Rückmeldungen mag die Rechnung stimmen; die Aussage über Kunden ist damit nicht belegt.

Die Entscheidung zwischen KI-Agenten und Workflow-Automatisierung legt fest, wo das System urteilen darf. Workflow-Automatisierung eignet sich für Schritte, deren Regeln vorab definierbar sind. Ein Agent wird nützlich, wenn Beobachtungen bestimmen, welche erlaubte Aktion als Nächstes sinnvoll ist. Viele Geschäftsprozesse brauchen beides, aber jeweils mit einem präzisen Auftrag.

**Halte Zählregeln und erforderliche Kontrollen ausdrücklich fest. Gib einem Agenten Entscheidungsspielraum für eine begrenzte Untersuchung, deren Schlussfolgerungen überprüfbar sind.** Prüfe vor dieser zusätzlichen Komplexität, ob ein einzelner Modellschritt oder die Bearbeitung von Ausnahmen durch eine Person ausreicht.

## Ablaufsteuerung und erzeugten Inhalt trennen

Ein Workflow legt eine Folge von Schritten oder Verzweigungen fest. Er kann gewöhnlichen Code, einen Sprachmodellaufruf, menschliche Eingaben oder einen Agenten enthalten. Ein Agent kann Aktionen auswählen, ihre Ergebnisse prüfen und seinen nächsten Schritt am Ziel ausrichten.

Anthropics Architekturleitfaden unterscheidet vorgegebene Workflows von Agenten, die ihren Ablauf und ihre Tools selbst steuern. Dabei geht es um die Kontrolle über die Arbeit; nicht jeder Modellaufruf ist deshalb ein Agent. [Lies Building effective agents](https://www.anthropic.com/engineering/building-effective-agents).

Zwei Eigenschaften werden leicht verwechselt. Eine Steuerung kann immer zuerst klassifizieren und anschließend zusammenfassen. Die Klassifizierung selbst kann trotzdem variieren oder falsch sein. Googles ADK-Beispiel verdeutlicht das mit einer sequenziellen Steuerung von KI-Unteragenten; die Dokumentation weist zugleich auf Änderungen an neueren ADK-Workflow-Strukturen hin. [Mehr zur sequenziellen Steuerung](https://adk.dev/agents/workflow-agents/sequential-agents/).

Ebenso braucht ein Agent keine Befugnis über den gesamten Prozess. Er kann eine Auffälligkeit untersuchen und Belege zurückgeben, während feste Schritte für Validierung, Summen, Datensatzänderungen und Verteilung zuständig bleiben. Die Architektur sollte zeigen, wo Unsicherheit entsteht, wo Handlungsspielraum nützt und wo eine falsche Antwort erkannt wird.

![Ein Workflow folgt festen Schritten. Ein Agent beobachtet, entscheidet und verwendet Tools in einer Schleife. Ein hybrider Ablauf validiert Eingaben, führt eine begrenzte Agentenaufgabe aus und prüft das Ergebnis.](/blog/diagrams/de/T03-diagram.svg)

## Veranschaulichendes Beispiel: mit einem abgestimmten Feedbackbericht beginnen

Angenommen, ein Team erhält einen monatlichen Export und möchte wissen, ob Einrichtungsprobleme näher untersucht werden sollten. Alle Datensätze und Zahlen in diesem Beispiel sind erfunden.

Der Export enthält 22 Zeilen. Zwei wiederholen eine bereits enthaltene Feedbackkennung. Nach der vereinbarten Regel des Teams bleibt pro Kennung eine Zeile, also 20 unterschiedliche Rückmeldungen. Jede verbleibende Rückmeldung hat eine bestehende Hauptkategorie. Der Vormonatsvergleich umfasst nach denselben Regeln ebenfalls 20 unterschiedliche Rückmeldungen.

| Hauptkategorie | Vormonat | Aktueller Monat |
| --- | ---: | ---: |
| Einrichtung | 4 | 8 |
| Abrechnung | 6 | 5 |
| Zuverlässigkeit | 5 | 4 |
| Sonstiges | 5 | 3 |
| Gesamt | 20 | 20 |

Die Rechnung ist eindeutig. Der Anteil der Einrichtungsthemen an den erfassten Rückmeldungen steigt von `4 / 20 = 20 %` auf `8 / 20 = 40 %`, also um 20 Prozentpunkte. Die Anzahl verdoppelt sich. Keine der beiden Aussagen belegt, dass doppelt so viele Kunden ein Einrichtungsproblem hatten: Ein Kunde könnte mehrere unterschiedliche Rückmeldungen abgeben, oder das Erfassungsverfahren könnte sich geändert haben.

Ein festgelegter Workflow kann Kennungen validieren, die vereinbarte Duplikatregel anwenden, Kategorien prüfen, Zahlen berechnen und ausgeschlossene Zeilen dokumentieren. Ein Agent sollte nicht stillschweigend entscheiden, dass zwei unterschiedliche Kennungen „wie Duplikate aussehen“, Kategorien ändern oder Kunden als Nenner einsetzen. Solche Änderungen verändern die Messung.

Auch die vereinbarten Regeln können unzureichend sein. Haben zwei Zeilen dieselbe Kennung, aber widersprüchlichen Text, braucht der Workflow einen ausdrücklichen Ausnahmeweg. Die deterministische Ausführung einer schlechten Regel liefert weiterhin ein schlechtes Ergebnis. Die verantwortliche Person muss vor der Abnahme der Zahlen festlegen, wie widersprüchliche Versionen behandelt werden.

## Entscheiden, ob eine Untersuchung wirklich nötig ist

Die berichtsverantwortliche Person hat nun drei mögliche Anliegen. Jedes verlangt einen anderen Aufbau.

| Tatsächliches Anliegen | Kleinster plausibler Aufbau | Was würde mehr Handlungsspielraum rechtfertigen? |
| --- | --- | --- |
| Vereinbarte Kategorien zählen | Festgelegte Validierung, Berechnung und Vorlage | Dieses Anliegen erfordert keine offene Untersuchung |
| Die acht bereitgestellten Einrichtungsmeldungen zusammenfassen | Ein Modellschritt mit Quellenverweisen und Prüfung | Das Paket beantwortet die Frage nicht, und weitere Belege sind verfügbar |
| Mögliche Gründe für die Veränderung untersuchen | Begrenzte Agentenuntersuchung oder menschliche Untersuchung | Jede Erkenntnis bestimmt, welche erlaubte Quelle als Nächstes geprüft wird |

Beim dritten Anliegen findet eine erste Sichtung beispielsweise drei Meldungen zu Einladungen, zwei zu Single Sign-on (SSO), zwei zu Importen und eine unklare Meldung. Das sind vorgeschlagene Anmerkungen zu den acht Datensätzen, keine neuen offiziellen Berichtskategorien.

Die Einladungsthemen führen zur bereitgestellten Berechtigungsreferenz. Die Anmeldethemen verweisen auf einen genehmigten Versionshinweis. Die Importbeschwerden betreffen unterschiedliche Dateiformate. Innerhalb einer breiten Kategorie könnten mehrere unabhängige Gründe vorliegen. Ein Agent könnte nützen, weil die ersten Belege bestimmen, was als Nächstes zu prüfen ist. Wäre sämtliches Material bereits in einem kurzen Paket enthalten, könnte ein einzelner Analyseaufruf mit anschließender Prüfung dasselbe leisten.

Erlaube keine externen Änderungen allein deshalb, weil die Untersuchung mehrere Tools braucht. Die erlaubte Referenzsammlung zu lesen und Erklärungen vorzuschlagen, ist ein vollständiger, nützlicher Auftrag. Kundendatensätze zu ändern oder eine Ursachenmeldung zu veröffentlichen, ist eine separate Entscheidung.

## Eine Erklärung verlangen, die Gegenbelegen standhält

Eine vorgeschlagene Erklärung sollte Belege enthalten, die sie widerlegen könnten. So könnte ein ausgefüllter Teil des Untersuchungsergebnisses aussehen:

| Vorgeschlagene Erkenntnis | Unterstützende Belege | Einschränkung oder Gegenbeleg | Entscheidung |
| --- | --- | --- | --- |
| Die Einladungsanleitung sollte geprüft werden | Drei bereitgestellte Meldungen betreffen die Frage, wer Teammitglieder einladen darf | Bisher keine bestätigte Änderung an Berechtigungen oder Dokumentation | Eine begrenzte Anleitungsprüfung anlegen |
| Eine Änderung der Anmeldung verursachte den Anstieg | Zwei Meldungen erwähnen die Anmeldung; ein Versionshinweis stammt aus demselben Monat | Zeitliche Nähe belegt keine Ursache; die Umgebungen der Meldungen sind ungeprüft | Die Ursache nicht als erwiesen darstellen |
| Alle Einrichtungsrückmeldungen beschreiben ein Problem | Gemeinsame Hauptkategorie | Import-, Einladungs- und Anmeldethemen unterscheiden sich | Die Zusammenfassung mit einer einzigen Ursache verwerfen |

Ein begründeter Bericht kann nun lauten: „Einrichtungsthemen betreffen diesen Monat acht von 20 erfassten Rückmeldungen, im Vormonat vier von 20. Die Kommentare weisen auf mehrere Themen hin. Die Einladungsanleitung verdient eine gezielte Prüfung; die bereitgestellten Belege zeigen keine gemeinsame Ursache.“

Diese Formulierung nennt einen nächsten Schritt, ohne so zu tun, als beantworte der Export eine andere Frage. Die Untersuchung verbessert die Entscheidung, indem sie Unsicherheit eingrenzt, obwohl sie keine spektakuläre Diagnose liefert.

Bewahre Originalzeilen und abgenommene Zähltabelle auf. Lege Anmerkungen mit Quellenkennungen separat ab. Genehmigt die verantwortliche Person später neue Kategorien, wiederhole den betroffenen Vergleich nach der neuen Regel und kennzeichne ihn als überarbeitete Analyse. Vermische alte und neue Definitionen nicht in einem Trend.

## Die Grenze im Prozessauftrag festhalten

Für dieses Beispiel wird ein hybrider Ablauf gewählt: Feste Schritte erstellen die Zähltabelle, eine begrenzte Untersuchung analysiert die Einrichtungsrückmeldungen und eine Person prüft die vorgeschlagene Interpretation. Diese Wahl folgt den genannten Anforderungen und ist kein gemessener Überlegenheitsnachweis.

Die Grenze lässt sich in einem kurzen Auftrag festhalten:

> Untersuche die acht bereitgestellten Einrichtungsrückmeldungen anhand der erlaubten Produktreferenzen und Versionshinweise. Liefere vorgeschlagene Erklärungen mit Datensatzkennungen, unterstützenden Passagen, Gegenbelegen und fehlenden Fakten. Bewahre die abgenommene Zähltabelle. Frage die verantwortliche Person, wenn die Antwort nicht verfügbare Kontodaten erfordert. Ändere keine Datensätze und verteile keine Schlussfolgerungen.

Der Workflow prüft, ob jede zitierte Rückmeldung zu den erlaubten Eingaben gehört und ob alle Pflichtfelder vorhanden sind. Der Prüfer kontrolliert, ob die Belege die Interpretation tatsächlich tragen. Eine gültige strukturierte Antwort belegt, dass sich die Ausgabe verarbeiten lässt; sie belegt nicht, dass die Erklärung stimmt.

Begrenze die Untersuchung durch verfügbare Tools, Fragen, Zeit oder Versuche und ein nützliches Ergebnis für unvollständige Arbeit. Ist ein benötigter Versionshinweis unzugänglich, kann „Versionshypothese nicht überprüfbar“ akzeptabel sein, sofern die fehlende Quelle und ihre Folgen ausdrücklich genannt werden. Eine erfundene Referenz ist ein Fehler.

Das [Arbeitsblatt zur Prozessentscheidung](/blog/worksheets/de/T03-process-decision.md) hält diese unveränderlichen Regeln fest und trennt bekannte Vorgaben, vorgeschlagene Interpretationen und genehmigte Wirkungen. Es fragt auch, welche Bedingung die Architekturentscheidung umkehren würde. Eine stabile wiederkehrende Analyse ohne adaptive Untersuchung könnte hier zu einem einfacheren Workflow werden. Ist eine Erklärung praktisch nicht überprüfbar, braucht die Aufgabe möglicherweise menschliche Untersuchung statt eines aufwendigeren Agenten.

## Wiederholte Abnahme statt bloß irgendwann Erfolg prüfen

Eine gelungene Vorführung beantwortet nicht, ob das System konsistent arbeitet. Die ursprüngliche τ-bench-Forschung bewertet Agenten mit Tools anhand simulierter Kundenservicegespräche und unterscheidet mindestens einen Erfolg von Erfolg bei wiederholten Versuchen. Simulierte Nutzer und vereinfachte Fachgebiete begrenzen die Übertragbarkeit auf reale Berichtsprozesse. Die Unterscheidung bleibt dennoch hilfreich. [Lies Methodik und Einschränkungen des Benchmarks](https://arxiv.org/html/2406.12045v1).

Die Studie weist außerdem darauf hin, dass ein korrekter Endzustand der Datenbank einen Richtlinienverstoß wie Handeln ohne Bestätigung verbergen kann. Erforderliche Kontrollen brauchen deshalb eigene Prüfungen.

Behalte für den Feedbackprozess gewöhnliche Fälle bei und ergänze gezielt schwierige: doppelte Kennungen mit widersprüchlichem Inhalt, eine fehlende Kategorie, eine nicht verfügbare Referenz und Text mit mehreren möglichen Erklärungen. Lege die Abnahme vor dem Test fest. Zahlen müssen aufgehen, der Umfang muss unverändert bleiben, Unsicherheit muss den Bericht erreichen und verbotene Änderungen dürfen nicht stattfinden.

Wiederhole ausgewählte Fälle vom selben zurückgesetzten Ausgangszustand mit denselben Abnahmeregeln. Erfasse jeden gültigen Versuch einschließlich Fehlern und Zeitüberschreitungen. Trenne die Abnahme im ersten Anlauf von der Abnahme nach Korrektur. „Einer von fünf Versuchen lieferte einen brauchbaren Bericht“ und „Alle fünf lieferten brauchbare Berichte“ sind unterschiedliche Beobachtungen. Keine dieser kleinen Stichproben ist eine Verlässlichkeitsgarantie für den Betrieb.

Vergleiche Workflow, einzelnen Modellschritt und Agent nur dort, wo sie das tatsächliche Anliegen erfüllen können. Eine reine Zählvariante beantwortet keine Untersuchungsfrage; eine Untersuchung verdient keinen Vorteil, nur weil sie mehr Text produziert. Bewerte das entscheidungsrelevante Ergebnis und erfasse die zusätzliche Arbeit bis zur Abnahme.

## Nach Gesamtaufwand wählen und den Aufbau auf Tale übertragen

Berücksichtige menschliche Vorbereitung, Prüfung, Korrektur und Pflege neben Maschinenzeit und gemessenen Kosten. Muss der Agent jeden Monatsbericht umfangreich manuell nachbessern lassen, gehört das in den Vergleich. Liefert er verlässlich eine wertvolle Untersuchung, die der feste Bericht nicht bietet, kann der Zusatzaufwand gerechtfertigt sein. Fehlende Kostenbestandteile bleiben ungemessen und sind nicht null.

Tales Automationskonzepte unterscheiden einmalige `llm`-Knoten von `agent`-Knoten für Arbeit mit Tools, Dateien oder mehreren Gesprächsschritten. Projektaufgaben bieten einen Ort für zugeordnete Ergebnisse und deren Prüfung. Damit können Berichtsschritte und Untersuchung unterschiedliche Grenzen haben. [Lies die Automationskonzepte](https://docs.tale.dev/de/platform/automations/concepts).

Bring zur [Tale-Demo](/de/request-demo) den kleinen Export, die abgenommenen Zählregeln und die unbelegte Ursachenerklärung mit. Lass zeigen, wie der gewählte Aufbau die Tabelle erhält, die Erklärung hinterfragt und ein abnehmbares Ergebnis zurückgibt. Diese Beobachtungen sagen mehr aus als der Name der Architektur.
