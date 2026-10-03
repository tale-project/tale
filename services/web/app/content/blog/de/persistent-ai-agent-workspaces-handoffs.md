---
title: "Was der nächste KI-Agent zum Weiterarbeiten braucht"
description: "Schreib eine Übergabe, mit der die nächste KI-Sitzung sinnvoll weiterarbeitet. Halte Dateien, geänderte Annahmen und den nächsten Schritt fest."
slug: persistent-ai-agent-workspaces-handoffs
topicId: T04
reviewed: '2026-10-03'
draft: false
coverAlt: "Ein Dossier gelangt über eine blaue Brücke zwischen zwei getrennten Arbeitsablagen."
---

Damit ein Agent eine frühere Sitzung fortsetzen kann, solltest du mehr als den Chat speichern. Halte das aktuelle Ziel fest, die benötigten Dateien, erledigte Arbeit, offene Fragen und den nächsten sinnvollen Schritt. Lass die nächste Sitzung diese Übergabe prüfen, bevor sie weiterarbeitet.

Erhaltene Dateien verhindern, dass Arbeit verloren geht. Sie sagen dem nächsten Agenten aber nicht, ob die gestrige Schlussfolgerung noch die heutige Frage beantwortet. Eine kurze Übergabe macht diesen Unterschied sichtbar.

## Prüfe, worauf die nächste Sitzung zugreifen kann

Lege die Arbeit vor dem Beenden dort ab, wo die nächste Sitzung oder der nächste Agent sie öffnen kann. Benenne die genauen Dateiversionen. Bewahre den aktuellen Auftrag daneben auf, besonders wenn sich die Anweisungen während der Arbeit geändert haben.

Dateien, Aufgabenkommentare, Gesprächsverlauf und das aktuell für das Modell verfügbare Material sind verschiedene Dinge. Ein gespeicherter Bericht kann erhalten bleiben, auch wenn ein Gespräch neu beginnt. Ein fortgesetztes Gespräch kann noch einen überholten Auftrag enthalten. „Der Agent erinnert sich“ reicht als Übergabeplan nicht aus.

In Tale verwenden Projektagenten einen dauerhaften Arbeitsbereich weiter. Ob auch das Gespräch fortgesetzt wird, hängt von der Laufzeitumgebung ab. Gemini CLI beginnt ein neues Gespräch mit dem erhaltenen Arbeitsbereich. Prüfe in der [Anleitung zu Laufzeitumgebungen](https://docs.tale.dev/de/platform/agents/harnesses), wie die von dir verwendete Variante funktioniert.

![Projektreferenzen, Aufgabenverlauf, Dateien, Gesprächshistorie und aktiver Modellkontext tragen unterschiedliche Teile zur Fortsetzung bei. Eine ausdrückliche Übergabe sagt dem nächsten Agenten, was er prüfen und verwenden soll.](/blog/diagrams/de/T04-diagram.svg)

Übergibst du die Arbeit an einen anderen Agenten, prüfe seinen Zugriff. Nimm nicht an, dass er den Arbeitsbereich des ersten Agenten teilt. Stelle das benötigte Material über das gemeinsame Projekt als Anhang oder Link bereit. Ein Pfad in einem fremden privaten Verzeichnis ist keine brauchbare Übergabe.

## Hinterlasse eine Übergabe, die den nächsten Schritt bestimmt

Nehmen wir einen Anbietervergleich als Beispiel. Auftrag B2 verlangte Tools für fünf Personen. Die erste Sitzung erstellte ein Quellenverzeichnis, Funktionsnotizen und eine Empfehlung. Danach kam vom Projektverantwortlichen Auftrag B3: Das Team wird 50 Personen umfassen und braucht zwingend eine Einmalanmeldung (SSO).

„Anbieter A sieht am besten aus; stell den Bericht fertig“ würde den nächsten Agenten in die falsche Richtung schicken. Eine nützliche Übergabe hält fest, welche bisherige Arbeit weiterhin trägt:

| Feld | Ausgefülltes Beispiel |
| --- | --- |
| Aktuelles Ziel | Die bisherigen Kandidaten nach Auftrag B3 für 50 Personen mit erforderlicher Einmalanmeldung vergleichen |
| Zu öffnende Dateien | Auftrag B3, Quellenverzeichnis r4, Funktionsnotizen zu A und B, Empfehlung r2; die tatsächlichen Dateien oder zugängliche Links beifügen |
| Weiter nutzbare Arbeit | Quellenverzeichnis und Funktionsnotizen mit ihren Belegen als Ausgangsmaterial |
| Arbeit, die den Auftrag nicht mehr beantwortet | Empfehlung r2 und die Kostenschätzung für fünf Personen entstanden unter B2 |
| Fehlende Belege | Welche Tarife die erforderliche Einmalanmeldung bieten und was sie für 50 Personen kosten |
| Nächster Schritt | Tarif- und Funktionsquellen der bisherigen Kandidaten prüfen, dann Kosten neu berechnen und die Empfehlung überdenken |
| Anhalten und nachfragen | Eine erforderliche Quelle ist unzugänglich oder klärt nicht, ob ein Kandidat die Anforderungen erfüllt |

So muss der nächste Agent nicht die gesamte Suche wiederholen. Zugleich verhindert die Übergabe, dass er eine nicht mehr belegte Empfehlung nur sprachlich verbessert. Weitere Anbieter werden relevant, wenn die bisherigen Kandidaten B3 nicht erfüllen. Vor dieser Prüfung muss die Liste nicht wachsen.

Die [Übergabevorlage](/blog/worksheets/de/T04-handoff.md) lässt sich für dein Projekt anpassen. Bei einer kleinen Aufgabe kann das ausgefüllte Beispiel oben bereits als Struktur reichen.

## Prüfe die Übergabe vor dem Weiterarbeiten

Gib der nächsten Sitzung die Übergabe mit dieser Anweisung:

> Lies den aktuellen Auftrag und öffne die aufgeführten Dateien. Sag mir, was weiterhin brauchbar ist, was erneut geprüft werden muss und was du zuerst tun wirst. Wenn Übergabe und aktueller Auftrag einander widersprechen, benenne den Unterschied, bevor du fortfährst.

Im Beispiel erkennt eine hilfreiche erste Antwort B3 als aktuellen Auftrag, legt die alte Empfehlung beiseite und prüft Einmalanmeldung und Tarifbedingungen. Sie sollte weder die frühere Recherche löschen noch jede gespeicherte Aussage als aktuell behandeln.

Prüfe die Schlussfolgerungen neu, die von der Änderung betroffen sind. Eine Preisberechnung für fünf Personen muss ersetzt werden. Eine datierte Notiz zu einem früheren Kundeninterview kann als historischer Beleg weiterhin nützlich sein. Fehlen im alten Bericht die Quellen, ist möglicherweise eine breitere Prüfung nötig: Der nächste Agent kann dann nicht erkennen, welche Annahmen welche Aussagen stützen.

Kläre auch, was „fertig“ bedeutet. Eine Datei namens `final.md` kann noch ein ungeprüfter Entwurf sein. Halte fest, ob die Arbeit vorgeschlagen, geprüft oder abgenommen wurde, damit die nächste Sitzung aus einer Arbeitsdatei keine freigegebene Schlussfolgerung macht.

## Halte unbestätigte Aktionen fest, bevor du sie wiederholst

Wenn die vorige Sitzung ein externes System ändern konnte, kommt eine Frage hinzu: Hat eine versuchte Aktion tatsächlich stattgefunden?

Hat der Agent versucht, ein Ticket anzulegen, aber die Antwort verloren, notiere „Ticketerstellung unbestätigt“ samt Anfrage-ID und Zielsystem. Prüfe das empfangende System, bevor du den Versuch wiederholst. Eine fehlende Bestätigung beweist nicht, dass nichts geschehen ist.

Bei einer reinen Rechercheaufgabe reicht der Hinweis, dass keine externen Schreibzugriffe versucht wurden. Halte die Übergabe kurz genug, damit sie genutzt wird. Sie erfüllt ihren Zweck, wenn der nächste Agent das richtige Material öffnen, eine überholte Annahme verwerfen und den nächsten sinnvollen Schritt tun kann, ohne dass du die vorige Sitzung rekonstruieren musst.
