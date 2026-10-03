---
title: "KI-Agenten an echten Geschäftsaufgaben bewerten"
description: "Vergleiche KI-Agenten anhand realer Aufgaben, abgenommener Ergebnisse, Prüfzeit, Kosten und Dauer. Entwickle einen Bewertungsbogen für deinen Pilotversuch."
slug: "evaluate-ai-agents-business-tasks"
topicId: "T08"
reviewed: "2026-10-03"
draft: false
coverAlt: "Drei Beispielberichte werden am selben Bewertungsrahmen gemessen."
---

Ein KI-Agent, der mehr Aufgaben erledigt, kann trotzdem die falsche Wahl sein, wenn seine Prüfung den ganzen Arbeitstag beansprucht. Ein günstiger Lauf kann nach Fehlversuchen und Korrekturen ein teures Ergebnis liefern. Bewerte den Arbeitsablauf, den du tatsächlich einsetzen möchtest: die erste Ausgabe, die nötige Unterstützung und das Ergebnis, das dein Team schließlich abnehmen kann.

Dafür brauchst du vier getrennte Größen: Abnahme, menschlichen Aufwand, erfasste Kosten und Lieferzeit. Außerdem brauchst du eine verlässliche Bewertung. Ein überzeugend gestalteter Bericht und ein begeistertes automatisiertes Prüfurteil sind zwei zu prüfende Ausgaben, keine unabhängigen Erfolgsnachweise.

Dieser Leitfaden vergleicht zwei fiktive Konfigurationen für Kampagnenrecherche. Sämtliche Versuchszahlen, Zeiten und Preise des Beispiels sind zu Lehrzwecken angenommen; keine davon ist ein Tale-Benchmark. Der zugehörige [Bewertungsbogen](/blog/worksheets/de/T08-evaluation-scorecard.md) enthält die ausgeführte Rechnung und eine leere Vorlage für deinen Pilotversuch.

## Definiere die Abnahme dort, wo Fehler teuer werden

Wähle ein Ergebnis, das dein Team fachkundig prüfen kann. Im Kampagnenbeispiel liefert jede Aufgabe eine Produktspezifikation, Interviewauszüge und datiertes Wettbewerbsmaterial. Der Agent soll zwei Botschaften für die Produkteinführung samt Belegen vorschlagen. Eine Veröffentlichung liegt außerhalb seiner Befugnisse.

Eine prüfende Person kann der vorgeschlagenen Strategie widersprechen und die Analyse trotzdem als fundiert abnehmen. Umgekehrt fällt ansprechender Text durch, wenn seine zentrale Produktaussage erfunden ist. Richte die Bewertung an diesen Unterschieden aus:

| Anforderung | Was geprüft wird | Abnahmeregel |
| --- | --- | --- |
| Belegte Produktaussagen | Jede wesentliche Aussage anhand der vorgegebenen Spezifikation | Keine unbelegte wesentliche Aussage |
| Ehrlicher Umgang mit Zielgruppenbelegen | Interviewkontext und daraus abgeleitete Aussage | Keine Stichprobenbeobachtung wird als Verbreitung im Markt dargestellt |
| Brauchbare Alternativen | Zielgruppenproblem, Versprechen, Beleg und Einwand | Zwei unterschiedliche Optionen mit Begründung |
| Sichtbare Unsicherheit | Fehlende Quellen und offene Entscheidungen | Lücken bleiben ausdrücklich benannt |
| Erlaubte Aktivitäten | Verfügbare Aktionsprotokolle und relevanter externer Zustand | Keine Veröffentlichung oder Kundenansprache |

Verlange nicht genau die Suchfolge, die du selbst gewählt hättest, außer wenn diese Reihenfolge ausdrücklich vorgeschrieben ist. Gültige Arbeit kann auf verschiedenen Wegen entstehen. Verbietet die Aufgabe jedoch Nachrichtenversand, macht ein korrektes Dokument eine unerlaubte Nachricht nicht ungeschehen. Ergebnisprüfung und Prozessvorgaben erfüllen unterschiedliche Zwecke. [Anthropics Evaluationsleitfaden](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) unterscheidet entsprechend zwischen dem, was ein Agent meldet, und dem tatsächlichen Zustand der Umgebung.

## Prüfe die Bewertung, bevor du der Punktzahl vertraust

Ein Modell kann helfen, unbelegte Aussagen zu finden oder Verständlichkeit zu vergleichen. Dafür muss es an deinen Kriterien kalibriert werden. Die MT-Bench-Forschung fand eine beträchtliche Übereinstimmung zwischen einem starken bewertenden Modell und menschlichen Präferenzen, zeigte aber auch eine Empfindlichkeit gegenüber Antwortreihenfolge und unnötiger Länge. Untersucht wurden Gesprächsbewertungen mit älteren Modellen. Das bestätigt oder widerlegt die Eignung deiner heutigen Bewertungsinstanz nicht. [MT-Bench: Methoden und Grenzen](https://arxiv.org/html/2306.05685v4)

Stelle vor dem Kandidatenvergleich ein kleines Kalibrierungspaket zusammen: ein knappes, korrektes Briefing, ein flüssig geschriebenes Briefing, das die Bedeutung einer Quelle verändert, eines mit ausdrücklich benannter fehlender Eingabe und eines mit einem harmlosen Stilfehler. Lass qualifizierte Personen wesentliche Mängel unabhängig kennzeichnen und kläre Abweichungen anschließend anhand der Quellen. Können sie sich nicht über die Abnahme einigen, präzisiere erst die Kriterien, bevor du den Agenten anpasst.

Nehmen wir für die fiktive Kampagne an, dass eine Quelle eine Funktion als privaten Pilotversuch beschreibt. Ein Entwurf nennt sie allgemein verfügbar. Das ist ein wesentlicher Fehler, selbst wenn der Entwurf einen Stilvergleich gewinnt. Ein Entwurf mit dem Hinweis, dass die Verfügbarkeit unbestätigt ist, kann dagegen richtig sein. So muss die Bewertung mehr leisten, als eine offensichtlich ausgezeichnete von einer offensichtlich fehlerhaften Antwort zu unterscheiden.

Blende Konfigurationsnamen bei der Bewertung möglichst aus. Tausche bei paarweisen Modellbewertungen die Antwortreihenfolge und untersuche umgekehrte Urteile. Verlange einen Beleg für Tatsachenurteile; auch die Erklärung des bewertenden Modells kann falsch sein. Prüfe stichprobenartig abgenommene ebenso wie abgelehnte Ergebnisse. Wer nur Fehlschläge kontrolliert, findet keine fälschlich bestandenen Prüfungen. Das sind vorgeschlagene Betriebskontrollen, keine Genauigkeitsgarantie.

Automatisierte Prüfung ist besonders nützlich, wenn sie wiederkehrende Kontrollen reduziert, ohne die einzige Wahrheitsquelle zu werden. Für einen kleinen Pilotversuch kann eine direkte fachliche Prüfung günstiger sein als Aufbau und Pflege einer komplexen Bewertungsinstanz. Bei großen Mengen klar begrenzter Arbeit können kalibrierte automatische Prüfungen ihren Aufwand rechtfertigen.

## Trenne Abdeckung und Wiederholbarkeit

Verwende Fälle aus dem vorgesehenen Arbeitsalltag: normale Eingaben, Widersprüche, fehlende Informationen und Situationen, in denen eine Rückfrage richtig ist. Halte einige Fälle während der Konfigurationsanpassung zurück. Fixiere möglichst die Quellenstände, damit geänderte Webinhalte nicht unbemerkt den Test verändern.

Unterschiedliche Fälle prüfen die Abdeckung. Wiederholte Versuche desselben Falls prüfen die Beständigkeit. Sechs Fälle mit je zwei Durchläufen ergeben zwölf Versuche über sechs Fälle. Sie belegen keine zwölf unabhängigen Arten von Arbeit. Bewahre diesen Unterschied in der Darstellung der Zahlen.

Die ursprüngliche tau-bench-Forschung formalisierte einen hilfreichen Gegensatz: Mindestens einen Erfolg über mehrere Wiederholungen zu finden und bei jeder Wiederholung erfolgreich zu sein, beantwortet unterschiedliche Fragen. Die Umgebungen verwenden simulierte Nutzer und begrenzte Aufgaben aus Einzelhandel und Flugverkehr. Ihre Quoten sagen die Ergebnisse deines Teams daher nicht voraus. [Tau-bench: Evaluation und Grenzen](https://arxiv.org/html/2406.12045v1)

Ein rein mathematisches Beispiel: Bei einer angenommenen Erfolgswahrscheinlichkeit von 90 % je unabhängigem Versuch beträgt die Wahrscheinlichkeit für zehn Erfolge in Folge `0.9^10`, also ungefähr 35 %. Reale Fehler können miteinander zusammenhängen. Übertrage die Rechnung deshalb nicht ohne Prüfung der Annahmen auf einen gemessenen Durchschnitt. Sie erklärt lediglich, weshalb „irgendwann kam eine gute Antwort“ für unbeaufsichtigte, wiederkehrende Arbeit nicht genügt.

Wiederholungen sind sinnvoll, wenn eine zuverlässige Prüfung ein gültiges Ergebnis erkennen kann und ihre Kosten tragbar sind. Sie überzeugen weniger, wenn jeder Versuch eine folgenreiche Aktion wiederholt oder dieselbe unsichere Bewertungsinstanz den vermeintlichen Gewinner auswählt. Lege vor dem Start fest, welchen Prozess du bewertest.

## Halte Versuch und Korrekturverlauf zusammen

Dokumentiere Laufzeitumgebung, Modell, Anbieter, Anweisungen, Skills, Tools, Eingabestand und Grenzen. Starte unabhängige Versuche unter gleichwertigen Bedingungen in entbehrlichen Testarbeitsbereichen. Bewahre Ergebnisse vor dem Zurücksetzen auf. Ein Agent, der die vorige Antwort lesen kann, hat eine andere Ausgangslage.

Eine Korrektur gehört zu ihrem ursprünglichen Versuch. Erfasse das erste Urteil vor der Rückmeldung und anschließend, ob der erlaubte Korrekturprozess zu einem abgenommenen Ergebnis führte. Gültige Versuche mit Zeitüberschreitung oder ohne Ausgabe bleiben Fehlschläge. Dokumentiere eine Konfiguration, die gar nicht startet, separat als Verfügbarkeitsproblem. Für die Bereitstellung bleibt das relevant, auch ohne bewertbare Ausgabe.

![Bewerte Fertigstellung, Prüfaufwand, Kostenabdeckung und Zeit bis zur Abnahme getrennt. Verwende für wiederholte Versuche denselben Eingabestand und dieselben Abnahmekriterien und berücksichtige Fehlschläge.](/blog/diagrams/de/T08-diagram.svg)

*Bewahre nach einer Korrektur das ursprüngliche Urteil auf. Sonst kann menschliche Hilfe einen schwachen Agenten eigenständig zuverlässig erscheinen lassen.*

Miss aktive menschliche Arbeit getrennt von der verstrichenen Zeit. Vorbereitung, Begleitung, Quellenprüfung und Korrektur kosten Arbeitszeit. Warteschlangen und das Warten auf die Prüfung beeinflussen den Liefertermin. Laufzeiten paralleler Agenten lassen sich nicht einfach addieren und als Zeitersparnis ausgeben; sie können sich überlappen. Erfasse die aktiven Zeitintervalle jeder Person, ohne dieselbe Minute doppelt zu zählen.

## Rechne die Kosten eines abgenommenen Ergebnisses durch

Beide Konfigurationen erhalten annahmegemäß dieselben sechs Fälle, jeweils zweimal unter sauberen Ausgangsbedingungen. Beide erlauben eine Korrekturrunde. Kein Versuch hat eine verbotene Wirkung. Die gesamte unten erfasste Arbeit umfasst Vorbereitung, Begleitung, Prüfung und Korrektur erfolgreicher wie erfolgloser Versuche. Alle Zahlen sind erfunden, einschließlich des angenommenen Stundensatzes von 60 USD.

| Kennzahl der fiktiven Versuchsgruppe | Konfiguration A | Konfiguration B |
| --- | --- | --- |
| Gültige gestartete Versuche | 12 | 12 |
| Mit erster Ausgabe abgenommen | 8/12 | 10/12 |
| Innerhalb des erlaubten Korrekturprozesses abgenommen, einschließlich sofort bestandener Ergebnisse | 10/12 | 11/12 |
| Am Ende nicht abgenommen | 2 | 1 |
| Erfasste Modell- und Tool-Kosten | 6 USD | 18 USD |
| Aktive menschliche Zeit | 180 Minuten | 120 Minuten |
| Geschätzte Personalkosten bei 60 USD/Stunde | 180 USD | 120 USD |
| Geschätzte Zwischensumme der erfassten Kosten | 186 USD | 138 USD |
| Zwischensumme je abgenommenem Ergebnis | 18,60 USD | 12,55 USD |

A wirkt günstiger, solange nur Modell- und Tool-Kosten zählen. Einschließlich Arbeit hat B die geringere erfasste Zwischensumme je abgenommenem Ergebnis: `(18 + 120) / 11 = 12.55`, gerundet. Das bleibt eine Teilkostenrechnung. Infrastruktur, Abonnements und Bereitstellungsaufwand sind hier nicht gemessen. Gesamteinsparungen belegt sie deshalb nicht.

Das Urteil hängt außerdem von der Arbeitskostenannahme ab. Sei `r` der Stundensatz. Das Verhältnis für A lautet `(6 + 3r) / 10`, für B `(18 + 2r) / 11`. Beide sind bei ungefähr 8,77 USD/Stunde gleich. Unterhalb dieses Satzes hat A das niedrigere erfasste Verhältnis, oberhalb B. Fehlende Kostenunterschiede können den Vergleich erneut verändern. Dokumentiere diese Empfindlichkeit, statt den gewählten Satz als allgemeine Geschäftstatsache darzustellen.

Nach diesen Annahmen verdient B den nächsten beaufsichtigten Pilotversuch, sofern der verbleibende Fehler akzeptabel ist und die Lieferfrist eingehalten wird. Zwölf Versuche rechtfertigen keine präzise allgemeine Rangfolge. Hätte Bs einziger Fehler vertrauliche Inhalte offengelegt, während As Fehler lediglich zu Rückfragen führten, würde der niedrigere Durchschnittspreis B nicht retten. Schwere und Bedeutung eines Fehlers gehen der Kennzahl vor.

## Wähle den Nenner, bevor du die Tabelle öffnest

Verwende für die festgelegte Versuchsgruppe `F/N` als Abnahmequote der ersten Ausgabe und `A/N` als Quote innerhalb des erlaubten Korrekturprozesses. `N` umfasst alle gültigen gestarteten Versuche, auch Zeitüberschreitungen und ausbleibende Ausgaben. `A` enthält die sofort abgenommenen Ergebnisse. Kläre unbewertete Ausgaben vor dem Quotenvergleich und lege ungültige Tests sowie betriebliche Startfehler offen, statt sie still zu entfernen.

Addiere für die Kosten nicht doppelt gezählte beobachtete Gebühren, offengelegte Umlagen und geschätzte Arbeit über die gesamte Gruppe einschließlich der Fehlschläge. Teile dann durch die abgenommenen Ergebnisse. Ein zugerechneter Abonnementanteil ist eine Rechnungsannahme, keine gemessene Gebühr dieses Laufs. Zähle dieselbe Anbietergebühr nicht einmal aus dem Gateway und nochmals aus einer Rechnung.

Bei `N = 0` sind Abnahmequoten nicht definiert. Bei `A = 0` sind Kosten und Aufwand je abgenommenem Ergebnis nicht definiert. Berichte dann Ausgaben, Aufwand und null Abnahmen. Fehlen Kostenkategorien, nenne das Ergebnis **geschätzte Zwischensumme der erfassten Kosten je abgenommenem Ergebnis**. Verwende „gemessene Zwischensumme“ nur für tatsächlich beobachtete Gebühren. Unbekannte Kosten sind nicht null.

Stelle die verstrichene Lieferzeit daneben. Berichte die Zeit bis zur Abnahme erfolgreicher Versuche und die Dauer bis zum Ende erfolgloser Versuche getrennt. Eine Konfiguration, die schnell scheitert, hat nicht schnell geliefert. Zähle bei einer festen Frist sowohl rechtzeitig abgenommene Ergebnisse als auch alle irgendwann bestandenen Ergebnisse.

## Begrenze die Pilotentscheidung stärker als die Tabelle

Der Bewertungsbogen sollte zu einer begrenzten Handlung führen: mit beaufsichtigter Arbeit fortfahren, einen bestimmten Fehler beheben, eine weitere Konfiguration vergleichen oder stoppen. Benenne, was die Auswahl umkehren würde. Ein günstigeres Modell kann genügen, wenn Ausgaben billige deterministische Prüfungen erlauben. Aufwendige Prüfung kann dominieren, wenn jede Aussage das Lesen einer Quelle erfordert.

Hinterlege in Tale Briefing und Kriterien an einer [Projektaufgabe](https://docs.tale.dev/de/platform/projects/tasks), konfiguriere den Agenten über [Projektagenten](https://docs.tale.dev/de/platform/projects/project-agents) und bewahre Ergebnisse mit ihren Prüfentscheidungen auf. Bestätige die Prüfregelung deiner Installation anhand des [Leitfadens zur Aufgabenprüfung](https://docs.tale.dev/de/platform/projects/task-automation). Das Arbeitsblatt bleibt ein separates Evaluationsdokument.

Die [Nutzungsanalyse](https://docs.tale.dev/de/platform/admin/governance/usage-analytics) liefert aufgezeichnete Anwendungsnutzung, keine vollständige Anbieterrechnung oder garantierte Gesamtkosten pro Aufgabe. Unterstützte Laufzeitumgebungen mit Abonnementanbindung rufen Anbieter direkt auf und umgehen Tales Gateway-Messung und Ausgabenlimits. Kläre diese Abdeckung, bevor du die Einträge für einen Kostenvergleich nutzt. [Zugangsdaten der Laufzeitumgebungen](https://docs.tale.dev/de/platform/agents/harnesses)

Bring eine repräsentative Eingabe, die Abnahmekriterien und den ausgefüllten Bewertungsbogen zu einer [Tale-Demo](/de/request-demo) mit. Entscheidend ist, ob diese konkrete Arbeitsweise Ergebnisse liefert, die dein Team mit vertretbarem Prüfaufwand abnehmen kann.
