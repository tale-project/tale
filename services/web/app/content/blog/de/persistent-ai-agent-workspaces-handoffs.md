---
title: "Persistente KI-Arbeitsbereiche und verlässliche Übergaben"
description: "Erfahre, was zwischen Agentenausführungen erhalten bleibt, wie du überholte Annahmen erkennst und mit prüfbaren Übergaben zuverlässig weiterarbeitest."
slug: "persistent-ai-agent-workspaces-handoffs"
topicId: "T04"
reviewed: "2026-10-03"
draft: false
coverAlt: "Ein Dossier gelangt über eine blaue Brücke zwischen zwei getrennten Arbeitsablagen."
---

Ein Rechercheagent nimmt seine Arbeit wieder auf; alle Dateien sind erhalten. Er öffnet den gestrigen Vergleich und arbeitet an der Empfehlung weiter. Allerdings hat die verantwortliche Person über Nacht die Zielkundengruppe geändert. Der Arbeitsbereich blieb vollständig erhalten, doch die Schlussfolgerung beantwortet jetzt die falsche Frage.

Ein persistenter KI-Arbeitsbereich bewahrt Arbeitsmaterial zwischen Ausführungen. Eine verlässliche Übergabe klärt, welches Material für den nächsten Schritt noch gültig ist. Das sind unterschiedliche Aufgaben. Dateien, gespeicherte Entscheidungen und ein scheinbar vollständiger Gesprächsverlauf können alle eine überholte Annahme festhalten.

Behandle eine Übergabe als **Aussage über den Arbeitsstand, die der Empfänger überprüfen muss**. Sie sollte das aktuelle Ziel, nutzbare Belege, offene Entscheidungen und Bedingungen nennen, unter denen der vorgeschlagene nächste Schritt nicht mehr passt. So kann ein neuer Bearbeiter gezielt weiterarbeiten, statt alles neu zu beginnen oder allem Erhaltenen zu vertrauen.

## Erhaltene und neu zu erschließende Informationen unterscheiden

„Gedächtnis“ ist als betriebliche Anforderung zu ungenau. Frage, was nach einer bestimmten Unterbrechung verfügbar bleibt, wer darauf zugreifen kann und wie die nächste Ausführung es erhält.

| Ebene der Kontinuität | Nützlicher Inhalt | Noch offene Frage |
| --- | --- | --- |
| Projektreferenzen | Dauerhafte Anweisungen und genehmigte Quellen | Welche Revision gilt für diese Aufgabe? |
| Aufgabeneintrag | Ziel, Entscheidungen, Zuständigkeit, Prüfstatus | Hat der aktuelle Bearbeiter ihn gelesen? |
| Dateien im Arbeitsbereich | Entwürfe, Skripte, Zwischenbelege | Kann der Empfänger diese Ablageorte öffnen? |
| Gesprächsverlauf | Frühere Nachrichten und Zustand der Laufzeitumgebung | Setzt diese Laufzeitumgebung das Gespräch fort? |
| Aktiver Modellkontext | Material für die aktuelle Antwort | Sind die relevanten Belege tatsächlich darin enthalten? |

LangGraphs Persistenzdokumentation unterscheidet zwischen Gesprächsprüfpunkten und Speicher für Daten über mehrere Gesprächsverläufe hinweg. Diese Implementierung verdeutlicht, warum der Geltungsbereich eines Speichers wichtig ist. Sie beschreibt nicht, wie Tale Agentenzustand speichert. [Lies den Persistenzleitfaden](https://docs.langchain.com/oss/python/langgraph/persistence).

Gehe nicht davon aus, dass ein größeres Kontextfenster diese Unterscheidung aufhebt. *Lost in the Middle* variierte die Position relevanter Informationen in Frage-Antwort- und Suchaufgaben und fand bei den untersuchten Modellen positionsabhängige Leistung. Das waren ältere Modelle und kontrollierte Aufgaben, keine Messung aktueller Tale-Laufzeitumgebungen. Die nützliche Testfrage bleibt, ob der nächste Bearbeiter die benötigten Belege finden und verwenden kann. [Lies die Experimente](https://arxiv.org/html/2307.03172).

![Kontinuität umfasst Projektreferenzen, Aufgabeneintrag, Arbeitsdateien, Laufzeitgespräch und aktiven Modellkontext. Ein neuer Bearbeiter braucht eine ausdrückliche Übergabe der Dateien und muss sie prüfen.](/blog/diagrams/de/T04-diagram.svg)

## Veranschaulichendes Beispiel: Belege bei geändertem Briefing erhalten

Ein Team erstellt eine Entscheidungsvorlage zur Anbieterauswahl. Die folgenden Dateien, Anbieter und Entscheidungen sind erfunden.

Das ursprüngliche Briefing B2 fragt nach Tools für ein fünfköpfiges Team. Der bisherige Bearbeiter hinterlässt zwei Anbieterprofile, einen Vergleichsentwurf und eine offene Frage zu Anmeldeanforderungen. Vor der nächsten Sitzung ersetzt die verantwortliche Person B2 durch B3: Geplant sind jetzt 50 Nutzer, und Single Sign-on ist vorgeschrieben.

Eine schwache Übergabe lautet: „Anbieter A liegt vorn; stelle die Empfehlung fertig.“ Sie bewahrt die Schlussfolgerung und verbirgt ihre Annahmen. Eine hilfreiche Übergabe lässt den Empfänger entscheiden, was nutzbar bleibt:

| Element | Zustand unter B2 | Folge von B3 | Nächster Schritt |
| --- | --- | --- | --- |
| Quellenverzeichnis r4 | URLs und beobachtete Fakten erfasst | Als Verzeichnis weiterhin nützlich | Die für den neuen Vergleich nötigen Quellen öffnen |
| Kostenschätzung für fünf Plätze | Für die bisherige Teamgröße berechnet | Beantwortet die Kostenfrage nicht mehr | Erst anwendbare Tarifbedingungen prüfen, dann neu berechnen |
| Funktionsnotizen zu Anbieter A | Einige Aussagen belegt; Single Sign-on ungeprüft | Erforderliche Fähigkeit weiterhin unbekannt | Verfügbarkeit und Einschränkungen von Single Sign-on prüfen |
| Anbieterempfehlung r2 | Unter B2 vorgeschlagen | Als Empfehlung überholt | Auswahl aussetzen, bis die B3-Kriterien geprüft sind |

Der Empfänger sollte die bisherige Arbeit nicht löschen. Das Quellenverzeichnis und einige Funktionsbelege können nützlich bleiben. Er sollte aber auch die bisherige Rangfolge nicht übernehmen, nur weil ihre Dateien das jüngste Änderungsdatum haben. „Kürzlich gespeichert“ und „nach den aktuellen Entscheidungskriterien gültig“ sind unterschiedliche Eigenschaften.

Der neue nächste Schritt prüft die erforderliche Fähigkeit und die geltenden Tarifbedingungen. Die Anbieterliste muss vielleicht erweitert werden, wenn keiner der Kandidaten die Anforderungen erfüllt. Vor dieser Prüfung wäre das jedoch verfrüht. Die Übergabe grenzt die nächste Untersuchung ein, statt eine weitere allgemeine Recherche anzustoßen.

## Einen kurzen Nachweis mit ausdrücklichen Gültigkeitsbedingungen schreiben

Die nützlichste Übergabe ist meist kürzer als die beschriebene Arbeit. Sie muss nicht jede Nachricht wiedergeben. Sie braucht genügend Informationen, um Belege zu finden und eine relevante Änderung zu erkennen.

Ein ausgefüllter Ausschnitt des Beispiels:

| Feld | Übergabe H-04 |
| --- | --- |
| Aktuelles Ziel | Kandidaten für 50 Nutzer mit vorgeschriebenem Single Sign-on nach Briefing B3 vergleichen |
| Erledigt | Quellenverzeichnis r4; Funktionsnotizen zu A und B mit aussagebezogenen Verweisen |
| Nicht abgenommen | Empfehlung r2 entstand unter B2 und ist überholt |
| Blockierende Frage | Welcher geeignete Tarif deckt das erforderliche Single Sign-on ab? |
| Nächster Schritt | Fähigkeit und Tarifbedingungen der bestehenden Kandidaten prüfen |
| Stoppbedingung | Benötigte Quelle unzugänglich, widersprüchlich oder für den Eignungsnachweis unzureichend |
| Entscheidungsverantwortung | Projektverantwortliche Person entscheidet über zulässige Ersatzlösungen oder Umfangsänderungen |

Ergänze die tatsächlichen Ablageorte. Ein Dateiname wie `comparison-final.md` belegt weder Abnahme noch Aktualität. Nenne Revision und Status sowie gegebenenfalls die zugehörige Abnahmeentscheidung.

Anthropics Arbeit an länger laufenden Programmieragenten nutzte Fortschrittsdateien, damit spätere Sitzungen den Arbeitskontext wieder erschließen konnten. Die Übertragung auf Unternehmensrecherche ist ein Gestaltungsvorschlag und kein Ergebnis des Programmierexperiments. [Lies den Entwicklungsbericht](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents).

Die [Übergabevorlage](/blog/worksheets/de/T04-handoff.md) ergänzt für jede wesentliche Schlussfolgerung eine Gültigkeitsbedingung. Trage eine tatsächliche Abhängigkeit ein: „Für B3 nur gültig, wenn der zitierte Tarif das erforderliche Single Sign-on für diese Bereitstellung unterstützt.“ Vermeide eine inhaltsleere Kennzeichnung wie „geprüft“. Der Empfänger muss wissen, was geprüft wurde und welche Änderung eine erneute Kontrolle verlangt.

## Die betroffene Schlussfolgerung erneut prüfen, nicht das ganze Archiv

Aktualität hängt von der Aussage ab. Eine Quelle kann weiterhin belegen, was ein Kunde im Vorjahr berichtet hat, und zugleich als Nachweis aktueller Produktbedingungen ungeeignet sein. Eine Richtlinienänderung kann eine Schlussfolgerung ungültig machen, obwohl sich die Quelle selbst nicht geändert hat.

Im Anbieterbeispiel prüft der Empfänger zuerst B3 und öffnet dann die Tarif- und Funktionsquellen zur Eignungsbewertung. Unabhängige historische Interviewnotizen können als datierte Beobachtungen erhalten bleiben. Die alte Kostenrechnung bleibt im Archiv, erscheint aber nicht in der aktuellen Empfehlung.

Ändert sich eine Quelle, verfolge die betroffenen Schlussfolgerungen. Ein anderer Tarif kann eine neue Kostenrechnung und Eignungsentscheidung verlangen, ohne jede Anbieternotiz ungültig zu machen. Dokumentiere die geänderte Aussage, abhängige Dateien und die nötige erneute Prüfung. So entspricht die Wiederaufnahme dem tatsächlichen Unterschied.

Dieses sparsame Vorgehen hat eine Grenze. Fehlen aussagebezogene Verweise, kann der Empfänger womöglich nicht erkennen, was von der überholten Annahme abhängt. Dann ist eine umfassendere Prüfung erforderlich. Gute Herkunftsnachweise ermöglichen gezielte Wiederverwendung; man darf sie nicht nachträglich voraussetzen.

Auch Zugriffsfehler zählen. Verweist das Quellenverzeichnis auf das private Verzeichnis eines anderen Bearbeiters, stellt das Kopieren der Schlussfolgerung in einen gemeinsamen Chat die fehlenden Belege nicht bereit. Übertrage oder verknüpfe die erlaubten Dateien über einen zugänglichen Projekteintrag und lass den Empfänger sie öffnen. Teile die für den Auftrag nötigen Belege, ohne unbeteiligtes privates Material mitzugeben.

## Ungewisse Aktionen vor einer Wiederholung abgleichen

Die Fortsetzung wird schwieriger, wenn eine frühere Ausführung eine externe Änderung versucht hat. Angenommen, das Projekt genehmigt später das Anlegen eines Folgetickets. Die Anfrage wird gesendet, aber ihre Antwort geht verloren. Die Übergabe sagt: „Ticketanlage nicht bestätigt.“ Das bedeutet nicht dasselbe wie „Ticket wurde nicht angelegt“.

Zuerst muss der Empfänger den tatsächlichen Zustand abgleichen. Nutze Vorgangskennung, Ziel, Parameter und verfügbare maßgebliche Statusnachweise, um festzustellen, was passiert ist. Eine Textsuche ohne passenden Titel kann unzureichend sein: Titel sind nicht zwingend eindeutig, die Suche kann verzögert sein oder der Bearbeiter hat möglicherweise keinen Zugriff.

AWS erläutert in seinem Leitfaden zu idempotenten APIs, wie eine clientseitige Anfragekennung Wiederholungen derselben Absicht erkennbar macht. Er behandelt auch geänderte Parameter und die dienstspezifische Aufbewahrung solcher Kennungen. Eine lokal gespeicherte Aufgabenkennung schützt nicht davor, sofern der empfangende Dienst die entsprechende Zusicherung nicht unterstützt und einhält. [Lies Making retries safe with idempotent APIs](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/).

| Belege nach der Unterbrechung | Angemessener nächster Schritt |
| --- | --- |
| Das beabsichtigte Ticket ist mit passendem Vorgang und passenden Parametern bestätigt | Ergebnis festhalten und ohne erneute Anlage fortfahren |
| Der Dienst bestätigt ein Scheitern vor jeder Wirkung | Das genehmigte Wiederholungsverfahren befolgen |
| Ergebnis unbekannt, aber eine dokumentierte Zusicherung für idempotente Wiederholung gilt | Kennungsumfang, Parameter und Aufbewahrung prüfen, bevor sie genutzt wird |
| Ergebnis unbekannt und kein ausreichender Wiederholungsschutz vorhanden | Zustandsklärung eskalieren; Schreibvorgang nicht blind wiederholen |

Deshalb sollte die Übergabe vorgeschlagene, versuchte und bestätigte Aktionen trennen. Eine Liste „verbleibender Aufgaben“, die jede fehlende Antwort als unerledigte Arbeit behandelt, kann doppelte Wirkungen auslösen.

Bei einer reinen Lese- und Rechercheaufgabe kann das schlank bleiben. Halte fest, dass keine externen Schreibvorgänge versucht wurden, und prüfe die Dateien weiter. Ergänze das Aktionsprotokoll erst, wenn der Ablauf es tatsächlich braucht. Eine Übergabe soll echte Unsicherheit zeigen, ohne zum Katalog hypothetischer Vorfälle zu werden.

## Tales Arbeitsbereichs- und Zugriffsgrenzen prüfen

Tale dokumentiert persistente Arbeitsbereiche für Projektagenten und die Übernahme von Aufgabenausgaben als Arbeitsergebnisse. Dateien und Laufzeitgespräche werden unterschiedlich fortgeführt. Kläre, bevor du dich auf eine Wiederaufnahme verlässt, ob die konfigurierte Laufzeitumgebung das Gespräch wiederherstellt oder mit erhaltenem Material neu beginnt. [Lies Tales Dokumentation zu Laufzeitumgebungen](https://docs.tale.dev/de/platform/agents/harnesses).

Für den Empfänger können andere Zugriffsgrenzen gelten. Von Mitgliedern gestartete Agentenausführungen nutzen einen separaten Arbeitsbereich für die Arbeit dieser Person mit dem Agenten. Persönliche Projektchats werden nicht automatisch geteilt. Ein gemeinsames Projekt braucht daher ausdrücklich zugängliche Eingaben und Ergebnisse statt der Annahme eines gemeinsamen Gedächtnisses aller Bearbeiter. [Mehr zum Projektkontext](https://docs.tale.dev/de/platform/projects/concepts) und zu [von Mitgliedern gestarteten Ausführungen](https://docs.tale.dev/de/platform/projects/tasks).

Persistenz ist keine unbegrenzte Aufbewahrung. Tale unterscheidet das Freigeben ungenutzter Ausführungskapazität bei erhaltenen Dateien vom Löschen eines Arbeitsbereichs. Bereinigung und Entfernung zugehöriger Elemente können Dateien löschen; Arbeitsbereiche von Workflow-Ausführungen haben einen anderen Lebenszyklus. Sichere benötigte Ergebnisse in einer geeigneten dauerhaften Ablage und prüfe die betreffende Aufbewahrungskonfiguration. [Mehr zur Sandbox-Verwaltung](https://docs.tale.dev/de/platform/admin/sandboxes).

## Die erste Entscheidung des Empfängers testen

Eine hilfreiche Übergabeübung endet nicht damit, dass eine Datei wieder erscheint. Gib einem zweiten Bearbeiter nur das aktuelle Briefing, die Übergabe und den erlaubten Dateizugriff. Nimm die überholte Empfehlung und die ungeklärte Funktionsfrage aus dem Beispiel hinzu.

Die Übung ist bestanden, wenn der Empfänger B3 als maßgeblich erkennt, die B2-Empfehlung nicht unverändert übernimmt, die als Nächstes benötigten Belege öffnet und nennt, was noch nicht feststeht. Er sollte nützliche Arbeit erhalten und die unbelegte Schlussfolgerung blockieren. Sind externe Aktionen Teil des Umfangs, ergänze einen harmlosen Fall mit ungewissem Ergebnis und prüfe, ob die Zustandsklärung vor der Wiederholung erfolgt.

Bring diese Übung in eine [Tale-Demo](/de/request-demo) mit. Sie macht aus „persistenter Arbeitsbereich“ eine beobachtbare Frage: Kann der nächste Bearbeiter die richtige Arbeit auf Grundlage eines überprüfbaren Zustands fortsetzen?
