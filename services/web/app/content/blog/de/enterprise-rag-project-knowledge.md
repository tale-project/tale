---
title: "Warum die Firmen-KI trotz Quellen falsche Antworten gibt"
description: "Verfolge eine falsche KI-Antwort bis zur Quelle. Prüfe veraltete Dokumente, fehlenden Text und unbelegte Aussagen, bevor du das Modell wechselst."
slug: "enterprise-rag-project-knowledge"
topicId: "T05"
reviewed: "2026-10-03"
draft: false
coverAlt: "Eine ausgewählte Quellenpassage verbindet eine Dokumentbibliothek mit einem geöffneten Bericht."
---

Eine Quellenangabe zeigt dir, wo du eine Antwort überprüfen kannst. Sie sagt noch nicht, ob das Dokument aktuell oder freigegeben ist und ob die Antwort seinen Inhalt richtig wiedergibt.

Wenn eure Firmen-KI falsch antwortet, nimm zunächst eine konkrete Frage und die zitierte Textstelle. Gehe von dort zurück: Ist die Quelle falsch, hat die Suche die richtige Quelle übersehen oder hat das Modell den gefundenen Text missverstanden? Je nach Ursache hilft eine andere Korrektur. Ein Modellwechsel kann das eigentliche Problem bestehen lassen.

## Ein Entwurf kann wie eine verbindliche Antwort wirken

Angenommen, jemand fragt: „Können wir für diesen Launch Support am Wochenende zusagen?“ In eurer Wissensdatenbank liegen drei Dokumente:

- Die gültige Support-Richtlinie sieht Montag bis Freitag vor. Wochenenden brauchen eine genehmigte Ausnahme.
- Ein neuerer Launch-Vorschlag beantragt Wochenend-Support; die Genehmigung steht noch aus.
- Im Entwurf der Ankündigung steht: „Wir bieten Support am Wochenende.“

Eine Antwort, die die Ankündigung zitiert, wirkt zunächst gut belegt. Der Entwurf wiederholt aber genau die Zusage, die ihr erst überprüfen wollt. Er kann sie nicht genehmigen.

Hilfreich wäre: **„Der reguläre Support läuft Montag bis Freitag. Für das Wochenende braucht der vorliegende Vorschlag noch eine Genehmigung. Prüfe die genehmigte Ausnahme, bevor du Wochenend-Support zusagst.“** Damit bleibt auch offen, ob die Genehmigung anderswo vorliegt und in dieser Sammlung fehlt.

Kennzeichne Vorschlag und Ankündigung als Entwürfe und mache die gültige Richtlinie eindeutig erkennbar, bevor du den Prompt änderst. Das letzte Änderungsdatum sagt dem System nicht, welches Dokument verbindlich ist.

## Finde heraus, wo die Antwort falsch wurde

Retrieval-Augmented Generation, kurz RAG, durchsucht eure Inhalte und gibt passende Textstellen an ein Modell weiter. Ein Dokument kann in der Antwort fehlen, weil sein Text nie indexiert wurde, die Suche es übersehen hat oder die falschen Abschnitte ausgewählt wurden. Das Modell kann auch eine Textstelle missverstehen, die ihm tatsächlich vorlag.

Prüfe die konkrete falsche Antwort mit dieser Tabelle:

| Was du feststellst | Was du als Nächstes tun kannst |
| --- | --- |
| Das zitierte Dokument ist veraltet oder noch ein Entwurf | Benenne die gültige Quelle und kennzeichne die alte oder nicht freigegebene Fassung eindeutig. |
| Das richtige Dokument ist hochgeladen, sein Text aber nicht durchsuchbar | Prüfe Textextraktion und Indexierung. Ein gescanntes PDF braucht gegebenenfalls eine Fassung mit lesbarem Text. |
| Der richtige Text ist durchsuchbar, fehlt aber im übergebenen Kontext | Untersuche Suche und Auswahl anhand genau der Frage, die fehlgeschlagen ist. |
| Die richtige Textstelle liegt vor, aber die Antwort verändert ihren Sinn | Prüfe die Interpretation des Modells an dieser Stelle, einschließlich Bedingungen und Ausnahmen. |
| Keine vorhandene Quelle klärt die Frage | Frage die verantwortliche Person. Eine flüssigere Formulierung ersetzt die fehlende Entscheidung nicht. |

Halte Frage, Quellenstand, zitierte Textstelle und Antwort zusammen fest. Wenn du die an das Modell übergebenen Abschnitte einsehen kannst, speichere sie ebenfalls. Sichtbare Quellenangaben zeigen nicht alles, was das Modell gesehen hat. Deshalb lässt sich ein Suchfehler möglicherweise noch nicht von einem Interpretationsfehler unterscheiden.

Quellenangaben und sachliche Richtigkeit brauchen jeweils eine Prüfung. Der [Forschungsbenchmark ALCE](https://arxiv.org/abs/2305.14627) bewertet beides; eine vorhandene Quellenangabe gilt dort nicht schon als Beweis für eine richtige Antwort.

In Tale sind Speichern und Indexieren getrennte Zustände. Prüfe den Indexierungsstatus, bevor du die Antwort testest. Eine weitere Datei mit demselben Namen erzeugt außerdem einen eigenen Eintrag und ersetzt die alte nicht. Details stehen im [Dokumente-Leitfaden](https://docs.tale.dev/de/platform/knowledge/documents).

![Die Zugriffsprüfung bestimmt, welche Quellen verwendet werden dürfen. Die gefundenen Textstellen und ihre Fassungen müssen anschließend die Antwort belegen. Änderungen an Inhalten und Rechten brauchen getrennte Prüfungen.](/blog/diagrams/de/T05-diagram.svg)

## Teste die Entscheidung erneut, nicht nur den Wortlaut

Stelle die ursprüngliche Frage nach der Korrektur in einem neuen Gespräch. Formuliere sie dann anders. Im Support-Beispiel sollten „Gehört Samstag dazu?“ und „Können wir Wochenend-Support anbieten?“ derselben Richtlinie folgen.

Ändere anschließend die Belege: Ergänze eine genehmigte Wochenend-Ausnahme für diesen Launch. Jetzt sollte sich die Antwort ändern. Ein Assistent, der Wochenend-Support immer ablehnt, hat das Problem ebenfalls nicht gelöst.

Bewahre diese Fälle als kleinen wiederholbaren Test auf. Ergänze Fragen, die im Team tatsächlich gestellt wurden, darunter eine, die die Dokumente nicht beantworten können. Notiere vor dem Test die erwartete Antwort und die zugehörige Quelle. So kannst du mehr vergleichen als nur den Eindruck, dass die nächste Antwort besser klingt.

Bei häufig geänderten Quellen solltest du auch eine Aktualisierung testen: Ändere ein unkritisches Detail, warte den normalen Import und die Indexierung ab und frage in einem neuen Gespräch danach. Prüfe, ob die Antwort die neue Fassung verwendet. Gehe nicht davon aus, dass eine hochgeladene Kopie automatisch ihrem Original folgt.

## Prüfe den Zugriff, bevor du weitere Dokumente hinzufügst

Fehlt eine Quelle, wirken großzügigere Zugriffsrechte vielleicht wie eine schnelle Lösung. Kläre zuerst, ob die fragende Person diese Quelle überhaupt verwenden darf.

In Tale kann der Projektchat die Dateien seines Projekts und zugängliches Organisationswissen durchsuchen. Der Organisationschat durchsucht keine Projektdateien. Ein Projektagent braucht zusätzlich die passenden Tools. Diese Grenzen beschreiben die [Wissensübersicht](https://docs.tale.dev/de/platform/knowledge/overview) und der [Leitfaden zu Projektdateien](https://docs.tale.dev/de/platform/projects/manage-files).

Teste mit einem gewöhnlichen Mitgliedskonto, nicht nur als Administrator. Prüfe neben der Antwort auch Quellentitel, Vorschau, Quellenangabe und Download. Teste nach einem Rechteentzug erneut in einem frischen Gespräch. Sieh dir bestehende Gespräche und Ergebnisse gesondert an: Dort können bereits kopierte Informationen stehen.

Mit der [Vorlage zur Wissensprüfung](/blog/worksheets/de/T05-knowledge-acceptance.md) kannst du die fehlerhafte Frage, Quelle, Korrektur und den erneuten Test festhalten. Beginne mit einer falschen Antwort aus eurem Alltag. Einen nachvollziehbaren Fehler zu beheben hilft mehr, als hundert weitere Dokumente hinzuzufügen, ohne zu wissen, was gefehlt hat.
