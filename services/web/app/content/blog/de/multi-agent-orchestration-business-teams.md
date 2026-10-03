---
title: "Multi-Agenten-Orchestrierung für Unternehmen"
description: "Koordiniere KI-Agenten mit klaren Aufgaben, prüfbaren Belegen und gezielten Übergaben. Ein Handbuchprojekt zeigt, wann mehrere Agenten helfen."
slug: "multi-agent-orchestration-business-teams"
topicId: "T01"
reviewed: "2026-10-03"
draft: false
coverAlt: "Eine zentrale Koordination verbindet drei getrennte Aufgabenstationen mit einem gemeinsamen Ergebnis."
---

Ein Team gibt drei KI-Agenten denselben Einstiegsleitfaden und bittet sie, ihn zu verbessern. Einer überarbeitet die Anleitung, ein zweiter prüft die Fakten und der dritte kontrolliert das Ergebnis. Alle drei stützen sich auf denselben veralteten Produkthinweis. Ihre Übereinstimmung lässt das fertige Dokument vertrauenswürdig wirken, macht es aber nicht richtig.

Multi-Agenten-Orchestrierung koordiniert mehrere Agenten für ein gemeinsames Ergebnis: Sie verteilt Arbeit, verwaltet Abhängigkeiten, übergibt Belege und legt fest, ob das Ergebnis akzeptabel ist. Ihr Nutzen hängt von der Arbeitsteilung ab. Zusätzliche Rollen schaffen noch keine unabhängigen Belege.

Für Unternehmen gilt als sinnvoller Ausgangspunkt: **Trenne Untersuchungen, die unabhängig prüfbare Belege liefern können, und benenne anschließend eine verantwortliche Person oder einen Agenten für die Zusammenführung.** Ergänze einen weiteren Agenten, wenn du erklären kannst, was er herausfinden oder prüfen soll, das der bisherige Bearbeiter nicht ausreichend abdeckt. Das folgende Handbuchprojekt zeigt, wie du diese Entscheidung triffst und mit widersprüchlichen Ergebnissen umgehst.

## Jeder zusätzliche Agent braucht einen konkreten Beitrag

Notiere zuerst die Fragen, die das Projekt beantworten muss, bevor du ein Orchestrierungsmuster auswählst. „Recherche, Redaktion, Review“ beschreibt Tätigkeitsbereiche. „Kundenprobleme ermitteln, aktuelles Produktverhalten prüfen und vorgeschlagene Korrekturen abstimmen“ beschreibt Arbeit mit überprüfbaren Ergebnissen.

Der aktuelle Forschungs-Preprint *Towards a Science of Scaling Agent Systems* verglich Architekturen anhand von sechs Benchmarks. Zusätzliche Agenten halfen bei einigen zerlegbaren Aufgaben und verschlechterten die Ergebnisse bei sequenziellen Planungsaufgaben. Die Experimente nutzten kontrollierte Tools und Budgets. Daraus folgt weder eine allgemeine Regel für die Teamgröße noch ein Leistungsversprechen für Unternehmensprojekte. [Lies die Fassung vom April 2026 einschließlich Methodik und Einschränkungen](https://arxiv.org/html/2512.08296v3).

Für dein Team ergibt sich daraus eine überprüfbare Annahme: Die Aufteilung sollte zusätzliche Abdeckung, Zugänge oder Prüfungen ermöglichen, deren Nutzen den Aufwand der Zusammenführung überwiegt. Eine weitere Meinung allein ist dafür eine schwache Begründung.

| Vorgeschlagener zusätzlicher Agent | Was ihn rechtfertigen könnte | Wann die Arbeit zusammenbleiben sollte |
| --- | --- | --- |
| Zweiter Rechercheagent | Ein eigener Quellenbestand oder eine andere Frage | Beide würden dasselbe kleine Quellenpaket durchsuchen |
| Quellenprüfer | Direkter Zugriff auf maßgebliche Belege, denen der Entwurf entsprechen muss | Die „Prüfung“ würde lediglich die Zusammenfassung des ersten Agenten erneut lesen |
| Fachprüfer | Ausdrückliche Kriterien und passende Fachkenntnisse oder Tools | Die Rolle hat nur einen eindrucksvolleren Namen |
| Zweiter Schreibagent | Eigenständig betreute Abschnitte mit stabilen Grenzen | Alle Abschnitte hängen von einer sich ändernden gemeinsamen Argumentation ab |

Getrennte Agenten können trotzdem denselben Fehler machen. Unterschiedliche Prompts oder Modelle schaffen für sich genommen keine unabhängigen Belege. Frage, welche Informationen oder Prüfmethoden sich tatsächlich unterscheiden. Ein Prüfer mit Zugriff auf eine maßgebliche Spezifikation leistet etwas anderes als ein Agent, der nur beurteilen soll, ob der Text plausibel klingt.

## Veranschaulichendes Beispiel: die Überarbeitung eines Handbuchs planen

Ein Softwareunternehmen aktualisiert sein Handbuch für den Einstieg. Die folgenden Dokumente und Ergebnisse sind erfunden, um die Vorgehensweise zu erläutern. Sie stammen nicht aus einer Ausführung in Tale.

Das Projekt hat drei Eingaben: Handbuchrevision 6, Produktreferenzrevision 12 und einen zur Nutzung genehmigten Bestand aktueller Supportnotizen. Ziel sind korrekte Anweisungen und sichtbare offene Richtlinienentscheidungen. Die Veröffentlichung gehört nicht zu diesem Auftrag.

Zwei Fragen lassen sich unabhängig untersuchen: Womit haben Kunden Schwierigkeiten? Wo widerspricht die Anleitung der genehmigten Produktreferenz? Keine der beiden Untersuchungen muss auf den Abschluss der anderen warten.

| Auftrag | Untersuchte Belege | Eigenes Ergebnis | Abhängigkeit |
| --- | --- | --- | --- |
| Kundenfragen untersuchen | Bereitgestellte Supportnotizen | Fragenverzeichnis mit Verweisen auf Notizen | Nur das gemeinsame Briefing |
| Anleitung prüfen | Handbuch und Produktreferenz | Abweichungstabelle mit beiden Fundstellen | Nur das gemeinsame Briefing |
| Überarbeitung zusammenführen | Akzeptierte Erkenntnisse und Entscheidungen der Verantwortlichen | Ein vorgeschlagenes Handbuch mit offenen Punkten | Beide Untersuchungen |
| Vorschlag prüfen | Entwurf, Originalbelege, Abnahmekriterien | Abnahme oder konkrete Änderungswünsche | Die vorgeschlagene Revision |

Eine Person oder ein Agent verantwortet die Zusammenführung. Die beiden Untersuchungen bearbeiten das Handbuch nicht gleichzeitig. So ist klar, wer entscheidet, wenn zwei Erkenntnisse denselben Absatz betreffen. Außerdem wird ein früher Entwurf nicht zur beweglichen Grundlage von Untersuchungen, die eigentlich das ursprüngliche Material prüfen sollen.

![Ein gemeinsames Briefing führt zu zwei unabhängigen Untersuchungen. Ihre Erkenntnisse fließen in die Zusammenführung und Klärung von Widersprüchen ein, bevor ein Ergebnis zur Prüfung vorliegt.](/blog/diagrams/de/T01-diagram.svg)

Bei einer dreiteiligen Kurzanleitung mit nur einer maßgeblichen Quelle sähe der Aufbau anders aus. Ein Bearbeiter könnte sie prüfen und überarbeiten; anschließend kontrolliert eine Person das Ergebnis. Zwei getrennte Untersuchungsaufgaben wären schwer zu rechtfertigen. Ein Handbuch für mehrere unabhängig gepflegte Produkte könnte dagegen eigene Produktprüfungen benötigen, weil sich Belege und Verantwortliche unterscheiden.

## Aus einem Widerspruch eine begründete Korrektur ableiten

Angenommen, die beiden Untersuchungen liefern diese erfundenen Erkenntnisse:

| Erkenntnis | Beleg | Was der Beleg nachweist |
| --- | --- | --- |
| Laut Handbuch darf jedes Teammitglied Nutzer einladen | Handbuch r6, „Lade dein Team ein“ | Was die bestehende Anleitung behauptet |
| Einladungen erfordern eine Administratorrolle | Genehmigte Produktreferenz r12, Berechtigungstabelle | Die dokumentierte Berechtigungsvoraussetzung |
| Ein Kunde berichtet von einer erfolgreichen Einladung mit einem Standardkonto | Supportnotiz S-08 | Eine geschilderte Erfahrung, deren Kontodetails ungeprüft sind |

Die Koordination sollte darüber nicht abstimmen lassen. Die erste Zeile enthält das zu prüfende Material und kann sich daher nicht selbst bestätigen. Die dritte Zeile belegt eine untersuchenswerte Erfahrung, aber noch nicht die wirksame Rolle oder Produktkonfiguration des Nutzers. Die zweite Zeile ist die festgelegte Autorität für dokumentiertes Verhalten. Der Widerspruch muss trotzdem sichtbar bleiben.

Die vorgeschlagene Korrektur ist daher präzise: „Ein Administrator versendet die Einladung.“ Die Abweichungstabelle enthält zusätzlich die offene Frage: „Beschreibt S-08 eine andere Rolle, eine andere Konfiguration oder einen Fehler in der Produktreferenz?“ Die produktverantwortliche Person erhält die Frage mit beiden Fundstellen. Der Entwurf darf daraus keine erfundene Erklärung wie „Der Kunde hatte erweiterte Berechtigungen“ machen.

Kann die verantwortliche Person die Regel vor der Prüfung nicht bestätigen, kann der Prüfer unbeeinträchtigte Abschnitte abnehmen und den Einladungsabschnitt offenlassen, sofern das vereinbarte Verfahren eine Teilabnahme zulässt. Andernfalls wartet das gesamte Ergebnis. Diese Entscheidung gehört in den Aufgabenauftrag. Die Koordination sollte nicht improvisieren, was „fertig“ bedeutet.

Dieses Arbeitsergebnis ist hilfreicher als drei überzeugend formulierte Texte, die sich darin einig sind, dass der Leitfaden verbessert werden muss. Es trennt eine bestätigte Abweichung, eine vorgeschlagene Korrektur und einen ungeklärten Bericht über tatsächliches Verhalten. Daraus ergeben sich unterschiedliche nächste Schritte.

## Den Auftrag auf den wahrscheinlichen Fehler ausrichten

Ein hilfreicher Aufgabenauftrag konzentriert sich auf die Unklarheit, an der die Arbeit scheitern könnte. Für die Anleitungsprüfung könnte er lauten:

> Vergleiche Handbuch r6 mit der genehmigten Produktreferenz r12. Liefere für jede wesentliche Abweichung eine Zeile mit beiden Fundstellen und einer vorgeschlagenen Korrektur. Behandle Supportnotizen als geschilderte Erfahrungen, nicht als Nachweis aktueller Berechtigungen. Halte Widersprüche für die produktverantwortliche Person fest. Ändere keine Quelle und veröffentliche das Handbuch nicht. Halte an und melde jede fehlende Referenz, die du zur Begründung einer Korrektur brauchst.

Ergänze den erreichbaren Ablageort, die zuständige Person für Rückfragen, den Prüfer und eine Aufwandsgrenze. Ein Bearbeiter muss wissen, was er bei unvollständiger Arbeit zurückgeben soll: Ein konkretes Hindernis und die betroffene Anforderung sind nützliche Ergebnisse; eine unbelegte Antwort ist es nicht.

Die [Vorlage für den Aufgabenauftrag](/blog/worksheets/de/T01-task-contract.md) fragt auch, warum dieser Auftrag getrennt ausgeführt werden soll. Fülle das Feld vor dem Anlegen des Agenten aus. Kannst du keinen eigenständigen Beitrag benennen, vereinfache den Aufbau.

Trenne dauerhafte Standards vom aktuellen Auftrag. Ein Prüfer soll vielleicht immer Belege nennen und Unsicherheiten erhalten. Die Handbuchrevisionen und die Berechtigungsfrage gehören dagegen zu dieser Aufgabe. Tale dokumentiert wiederverwendbare Anweisungen für Projektagenten neben aufgabenspezifischen Eingaben. [Mehr zu Projektagenten](https://docs.tale.dev/de/platform/projects/project-agents).

## Änderungen koordinieren, nicht nur Arbeitsstarts

Die wichtigste Koordinationsaufgabe kann erst nach der Delegation entstehen. Angenommen, die produktverantwortliche Person ersetzt r12 durch r13, während beide Untersuchungen laufen. Würde die Zusammenführung starten, sobald zwei Dateien vorliegen, würden Belege zu unterschiedlichen Ständen vermischt.

Halte die Änderung einmal in der gemeinsamen Aufgabe fest. Ermittle die abhängigen Aufträge, kennzeichne betroffene Erkenntnisse zur erneuten Prüfung und definiere ausdrücklich, wann die Zusammenführung beginnen darf. Die Kundenfragenanalyse kann weiterhin nutzbar sein, weil sich ihre Supportnotizen nicht geändert haben. Die Einladungskorrektur muss gegen r13 geprüft werden. Alles zu wiederholen verschwendet Arbeit; alles unverändert zu übernehmen verbirgt die Änderung.

Verlange, dass gelieferte Dateien ihre Eingaberevisionen nennen. Bei der Übergabe öffnet der Empfänger die tatsächliche Datei und prüft, ob sie zum aktuellen Briefing passt. „Fertig“ reicht nicht, wenn die Arbeit auf einer überholten Grundlage fertiggestellt wurde.

Dasselbe Vorgehen hilft beim Ausfall eines Bearbeiters. Kann die Anleitungsprüfung die Berechtigungsreferenz nicht öffnen, bewahre ihre bereits abgeschlossenen, belegbaren Erkenntnisse und grenze den blockierten Teil ab. Lass den Schreibagenten die Lücke nicht aus allgemeinem Produktwissen füllen. Repariere oder ersetze die fehlende Untersuchung, bevor du davon abhängige Aussagen abnimmst.

## Das kleinste nützliche Team mit einer einfacheren Alternative vergleichen

Die Koordination mehrerer Agenten kann ihren Aufwand wert sein. Anthropics Bericht über sein Recherchesystem beschreibt erfolgreiche parallele Untersuchungen und Schwierigkeiten bei eng voneinander abhängiger Arbeit. Er belegt die Entscheidungen für dieses System und rechtfertigt nicht, jede Unternehmensaufgabe mit einem Agententeam zu beginnen. [Lies den Entwicklungsbericht](https://www.anthropic.com/engineering/multi-agent-research-system).

Vergleiche für das Handbuch die zwei Untersuchungen mit einem einzelnen Bearbeiter, der dasselbe Quellenpaket erhält. Halte Umfang, erlaubte Tools und Prüfkriterien konstant. Bekommt das Team insgesamt ein größeres Budget, dokumentiere den Unterschied. Eine Verbesserung ließe sich dann nicht allein der Orchestrierung zuschreiben.

Prüfe die Korrekturen anhand der Originalbelege. Erfasse unbelegte Änderungen, übersehene Abweichungen und ob offene Widersprüche die Zusammenführung überstanden haben. Miss die Zeit bis zur Abnahme sowie Vorbereitung, Koordination, Prüfung und Nacharbeit. Schnellere parallele Untersuchungen können dennoch später zu einem abgenommenen Dokument führen, wenn die Zusammenführung aufwendig wird.

Die Entscheidung lässt sich anschließend konkret treffen. Behalte getrennte Untersuchungen bei, wenn sie nützliche Belege aufdecken und den Gesamtaufwand senken. Führe sie zusammen, wenn dieselben Erkenntnisse mit weniger Koordination entstehen. Ein Pilot ohne nachweisbaren Vorteil ist eine erfolgreiche Architekturentscheidung, auch wenn daraus ein kleineres Team entsteht.

## Den Aufbau in einem gemeinsamen Projekt umsetzen

Tale bietet Projektaufgaben, Dateien und konfigurierte Agenten für solche zugeordneten Arbeiten. Die dokumentierte Delegation erfordert eine ausdrückliche Tool-Berechtigung. Delegierte Starts prüfen die Voraussetzungen und ob der Bearbeiter bereits beschäftigt ist. Ein von einem anderen Agenten gestarteter Agent kann nicht weiterdelegieren. Auch die verfügbare Sandbox-Kapazität begrenzt die Ausführung. [Lies die Dokumentation zur Aufgabendelegation](https://docs.tale.dev/de/platform/projects/task-automation).

Die Aufgabenprüfung ist eine andere Entscheidung als die erfolgreiche Ausführung. Wähle einen Prüfer, der die Originalbelege untersuchen und die Abnahme entscheiden kann. Der ausführende Agent kann sein eigenes Ergebnis nicht genehmigen. Tales dokumentiertes Prüfverfahren hält eine Entscheidung fest; die Aufgabe braucht weiterhin inhaltliche Kriterien und zugängliche Belege. [Mehr zu den Prüfregeln](https://docs.tale.dev/de/platform/projects/task-automation).

Bring eine kleine Aufgabe mit widersprüchlichen Quellen in eine [Tale-Demo](/de/request-demo) mit: zwei unterscheidbare Untersuchungen, eine verantwortliche Stelle für die Zusammenführung und eine überprüfbare Korrektur. Damit wird der Nutzen der Koordination konkret genug, um den Aufbau anzunehmen, zu verwerfen oder zu vereinfachen.
