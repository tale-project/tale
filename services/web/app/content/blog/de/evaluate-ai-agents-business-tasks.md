---
title: "Spart euer KI-Pilot dem Team wirklich Arbeit?"
description: "Vergleiche einen KI-Piloten mit eurem bisherigen Ablauf: anhand brauchbarer Ergebnisse und der Zeit für Vorbereitung, Prüfung und Korrekturen."
slug: "evaluate-ai-agents-business-tasks"
topicId: "T08"
reviewed: "2026-10-03"
draft: false
coverAlt: "Drei Beispielberichte werden am selben Bewertungsrahmen gemessen."
---

Ein KI-Pilot spart Arbeit, wenn dein Team mit weniger Aufwand zu einem Ergebnis kommt, das es verwenden kann. Ein Entwurf mag in zwei Minuten fertig sein und trotzdem eine Stunde Prüfung brauchen. Diese Stunde gehört in den Vergleich, ebenso wie Vorbereitung, Korrekturen, Fehlversuche und alles, was jemand von Hand fertigstellen muss.

Wähle eine wiederkehrende Aufgabe und vergleiche den gesamten Ablauf damit, wie ihr sie heute erledigt. Halte den Qualitätsmaßstab gleich. Du willst herausfinden, ob die Arbeit leichter wird, und nicht nur, ob der Agent schnell etwas ausgibt.

## Vereinbart, was als brauchbares Ergebnis gilt

Wähle ein Arbeitsergebnis, das ihr bereits beurteilen könnt: ein Kampagnenbriefing, eine Support-Zusammenfassung oder einen Wochenbericht. Haltet vor dem Pilotversuch die wenigen Bedingungen fest, die es brauchbar machen.

Bei einem Kampagnenbriefing könnten das belegte Produktaussagen, ein klares Problem der Zielgruppe, zwei unterschiedliche Botschaften und ausdrücklich benannte Wissenslücken sein. Behauptet ein Briefing, eine Funktion aus einem geschlossenen Pilotversuch sei „für alle verfügbar“, fällt es durch, auch wenn es hervorragend geschrieben ist. Benennt es die ungeklärte Verfügbarkeit korrekt, kann es die Anforderungen erfüllen.

Lass eine prüfende Person diese Kriterien auf einige Beispielergebnisse anwenden. Sind sich zwei Personen uneinig, was wichtig ist, klärt das vor dem Vergleich. Ein Modell kann Probleme markieren; gleiche seine Urteile aber mit denen einer Person ab, die die Aufgabe kennt. [Anthropics Anleitung zur Bewertung von Agenten](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) empfiehlt, modellgestützte Bewertungen mit fachkundigen menschlichen Urteilen abzugleichen.

## Vergleiche gleichwertige Arbeit

Nutze Aufgaben, die der geplanten Arbeit entsprechen, einschließlich fehlender Informationen und schwieriger Fälle. Gib dem bisherigen und dem KI-gestützten Ablauf gleichwertige Eingaben und Fristen. Bewahre die verwendeten Quellenfassungen auf, damit sich Unterschiede später erklären lassen.

Lass möglichst nicht dieselbe Person eine Aufgabe erst von Hand und direkt danach mit KI wiederholen, während ihr alles noch frisch im Gedächtnis ist. Lass die Methoden von verschiedenen Personen ausprobieren oder nutze vergleichbare Aufträge. Halte Unterschiede im Schwierigkeitsgrad fest. Ein kleiner Pilotversuch kann nicht jede Schwankung erklären, sollte einer Methode aber keinen offensichtlichen Vorsprung geben.

Lege fest, wie viel Nacharbeit erlaubt ist. Soll später ein Mensch das Ergebnis prüfen und korrigieren, teste genau diesen Ablauf und zähle den Aufwand mit. Bewahre das erste Ergebnis gesondert auf, damit menschliche Verbesserungen nicht wie Genauigkeit des Agenten aussehen.

## Zähle auch die Arbeit nach dem Entwurf

Erfasse aktive menschliche Arbeitszeit an vier Stellen: bei der Vorbereitung der Eingabe, der Begleitung des Laufs, der Prüfung des Ergebnisses und seiner Fertigstellung. Fehlversuche zählen mit. Auch eine Kollegin, die das Briefing neu schreibt, arbeitet am Pilotversuch.

Erfasse Wartezeiten getrennt. Zehn Minuten Prüfung sind Arbeitszeit; zwei Tage Warten auf diese Prüfung verzögern die Lieferung. Beides kann relevant sein, doch zusammengezählt lassen sich die Zahlen schlechter deuten.

![Vergleiche brauchbare Ergebnisse, menschlichen Prüfaufwand, erfasste Kosten und Lieferzeit anhand gleichwertiger Eingaben und derselben Abnahmekriterien.](/blog/diagrams/de/T08-diagram.svg)

Hier ein erfundener Vergleich für zehn Kampagnenbriefings. Beide Methoden liefern alle zehn im selben vereinbarten Qualitätsstandard. Beim KI-gestützten Ablauf müssen zwei Briefings von Hand fertiggestellt werden; dieser Aufwand ist in der Korrekturzeit enthalten.

| Menschlicher Aufwand für zehn brauchbare Briefings | Bisheriger Ablauf | KI-gestützter Ablauf |
| --- | --- | --- |
| Eingaben vorbereiten | 40 Minuten | 60 Minuten |
| Recherchieren und schreiben bzw. den Agenten aktiv begleiten | 260 Minuten | 30 Minuten |
| Ergebnisse prüfen | 60 Minuten | 100 Minuten |
| Arbeit korrigieren oder fertigstellen | 40 Minuten | 70 Minuten |
| Aktive Arbeitszeit insgesamt | 400 Minuten | 260 Minuten |
| Aktive Arbeitszeit je brauchbarem Briefing | 40 Minuten | 26 Minuten |

Unter diesen Annahmen spart das Team insgesamt 140 Minuten, also 14 Minuten pro Briefing. Die Prüfung dauert mit KI länger, trotzdem braucht der gesamte Ablauf weniger menschliche Arbeit. Würden Prüfung und Korrekturen die eingesparte Schreibzeit aufbrauchen, wäre die schnelle Erstellung allein kein erfolgreicher Pilotversuch.

Die Tabelle belegt weder einen finanziellen Gewinn noch eine kürzere Lieferzeit. Berücksichtige Modell- und Werkzeugkosten, Abonnements sowie zusätzliche Infrastrukturkosten, bevor du Kosteneinsparungen behauptest. Tales [Nutzungsanalyse](https://docs.tale.dev/de/platform/admin/governance/usage-analytics) zeigt die in der Anwendung erfasste Nutzung; sie ist keine vollständige Rechnung deines Anbieters.

## Lass offene und problematische Arbeit sichtbar

Im Beispiel entstehen auf beiden Seiten zehn brauchbare Briefings. Das muss in deinem Pilotversuch nicht so sein. Liefert der Agent sieben brauchbare Briefings und bricht drei ab, zeige alle zehn Versuche, den gesamten Aufwand und die drei offenen Aufgaben. Durch zehn zu teilen würde so tun, als hätten alle einen Nutzen geliefert. Durch sieben zu teilen, ohne die offene Arbeit zu nennen, würde verschleiern, dass ein Teil der Aufgaben unerledigt bleibt.

Schau dir die Fehler an, bevor du dich auf einen Durchschnitt verlässt. Ein Agent, der nachfragt, verursacht ein anderes Problem als einer, der eine Quelle erfindet oder unerlaubt eine Nachricht versendet. Macht ein schwerer Fehler den Ablauf unbrauchbar, gleicht eine Zeitersparnis an anderer Stelle das nicht aus.

Wiederhole außerdem einige Aufgaben. Ein einzelnes gutes Ergebnis sagt noch nicht, wie zuverlässig derselbe Ablauf nächste Woche funktioniert. Du brauchst zum Einstieg keinen aufwendigen Benchmark, solltest aber wissen, ob der erste Erfolg ungewöhnlich war.

## Entscheide konkret über den nächsten Schritt

Finde mit dem Pilotversuch heraus, wo der Ablauf hilft und wo er zusätzliche Arbeit schafft. Vielleicht setzt ihr ihn für Briefings mit vollständigen Quellen weiter ein, während unklare Rechercheaufträge im Team bleiben. Vielleicht müsst ihr einen wiederkehrenden Fehler bei Produktaussagen beheben, bevor ihr mehr Aufgaben übergebt. Den Versuch zu beenden ist sinnvoll, wenn das Prüfen mehr kostet als die ersetzte Arbeit.

Der [Bewertungsbogen](/blog/worksheets/de/T08-evaluation-scorecard.md) enthält einen ausführlicheren Vergleich zweier Agentenkonfigurationen sowie leere Felder für Eingaben, Prüfaufwand, Fehler und Kosten. Nutze diese Details, wenn du sie brauchst. Für die erste Entscheidung genügt eine klare Frage: **Brauchen Menschen bei vergleichbarer Arbeit und gleichem Qualitätsmaßstab weniger Zeit, um ein brauchbares Ergebnis zu erhalten?**
