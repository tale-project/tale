---
title: "Bleiben deine KI-Daten beim Selbsthosting intern?"
description: "Eine selbst gehostete KI kann Daten nach außen senden. Verfolge eine Aufgabe durch Modelle, Tools, Speicher und Protokolle und prüfe ihre Datenwege."
slug: self-hosted-ai-agent-platform-data-flow
topicId: T06
reviewed: '2026-10-03'
draft: false
coverAlt: "Ein offener Arbeitsbereich ist mit getrennten externen Diensten verbunden."
---

Beim Selbsthosting entscheidest du, wo die Anwendung läuft. Ob ihre Daten im Unternehmen bleiben, hängt davon ab, welche Dienste sie aufruft. Auch ein Agent auf deinem Server kann ein vertrauliches Dokument an ein externes Modell schicken, seinen Inhalt in eine Websuche übernehmen oder in ein externes Fehlerprotokoll schreiben.

Die entscheidende Frage lautet: **Welche Teile dieser Aufgabe dürfen unsere Umgebung verlassen, und über welche Verbindungen?** Das lässt sich klären, bevor du Hardware kaufst oder eine Betriebsform wählst. Verfolge eine typische Aufgabe vom Ausgangsmaterial bis zum Ergebnis und beziehe die Dienste ein, die sie dabei nutzt.

## Verfolge ein Dokument durch die Aufgabe

Stell dir vor, dein Einkauf lässt einen Agenten drei Anbieter mit einem internen Anforderungskatalog vergleichen. Darin stehen ein Budget und ein noch nicht veröffentlichter Einführungstermin. Die Websites der Anbieter sind öffentlich; der Anforderungskatalog muss in der kontrollierten Umgebung des Unternehmens bleiben.

Der Agent braucht beide Arten von Informationen, muss sie aber nicht gemeinsam versenden. Er könnte öffentliche Produktseiten anhand der Anbieternamen abrufen und sie anschließend mit einem internen Modell gegen die Anforderungen prüfen. Beide Quellen zusammen an ein externes Modell zu schicken, würde die Regel dieses Beispiels verletzen. Dasselbe gilt für eine öffentliche Suchanfrage, die den Einführungstermin enthält.

Halte fest, was jeder Schritt tatsächlich überträgt. „Läuft in unserer privaten Cloud“ sagt noch zu wenig über eine Modellanfrage oder eine Websuche aus.

| Schritt | Was du prüfst | Was im Beispiel erlaubt ist |
| --- | --- | --- |
| Anforderungskatalog hochladen und Text extrahieren | Originaldatei, extrahierter Text, temporäre Kopien | Alles bleibt in der kontrollierten Umgebung |
| Anforderungen durchsuchbar machen | Text, den der Embedding-Dienst erhält | Für diesen Text einen internen Dienst nutzen |
| Anbieter recherchieren | Suchanfragen, abgerufene Seiten, Formulareingaben | Anbieternamen und öffentliche Suchbegriffe senden |
| Vergleich entwerfen | Vollständige Anfrage an das generierende Modell | Internen und öffentlichen Kontext zusammen intern verarbeiten |
| Ergebnis speichern | Bericht, Gesprächsverlauf, Protokolle und Backups | Dieselbe Regel auf Kopien mit internen Angaben anwenden |

Dabei wird eine häufige Lücke sichtbar: Ein selbst betriebenes Modell für die Texterzeugung klärt noch nicht, wo die Embeddings entstehen. Ein Embedding-Dienst wandelt Text für die Suche in Vektoren um. Läuft er extern, erreicht ihn der Text bereits, bevor jemand eine Frage dazu stellt.

![Anwendung und Arbeitsbereich liegen innerhalb der gewählten Infrastruktur. Die Verbindungen zu Modellen, Tools und Betriebsdiensten müssen jeweils auf ihre Datenflüsse geprüft werden.](/blog/diagrams/de/T06-diagram.svg)

## Prüfe die Verbindungen hinter dem Hosting-Begriff

Bitte die Person, die das System betreibt, für jede Tabellenzeile das tatsächliche Ziel zu bestimmen. Bei Modellaufrufen gehören dazu der Endpunkt, der Anbieter dahinter und ein möglicher Ausweichdienst. Prüfe bei Tools die Suchanfrage oder die übertragenen Felder. Zum Speicher gehören neben hochgeladenen Dateien auch extrahierte Texte und Backups.

In Tale haben Anwendungsdaten, durchsuchbares Wissen und Originaldateien getrennte Speichereinstellungen. Der Umzug eines Speichers verschiebt weder die anderen noch deren bestehende Inhalte. Der [Leitfaden zu Datenspeichern](https://docs.tale.dev/de/self-hosted/configuration/data-residency) erklärt diese Grenzen.

Auch Netzwerkregeln gelten nur für bestimmte Verbindungen. Tales ausgehende Sandbox-Verbindungen und der Modell-Gateway sind getrennte Wege. Eine Einschränkung der Websites, die ein Agent abrufen darf, legt deshalb nicht fest, wo das Modell seine Anfragen verarbeitet. Prüfe im [Leitfaden zur Absicherung](https://docs.tale.dev/de/self-hosted/operate/security/hardening), welche Verbindung eine Regel tatsächlich erfasst. Berücksichtige außerdem die direkten Anbieterzugänge im [Leitfaden zu Laufzeitumgebungen](https://docs.tale.dev/de/platform/agents/harnesses).

Beziehe Fehlermeldungen ein. Ein erfolgreicher Lauf löst womöglich keine aus. Scheitert eine Anfrage, kann die Meldung dagegen Teile der Aufgabe enthalten. Die Ziele für Tales optionale Überwachung hängen von der Konfiguration ab; das Maskieren von Headern entfernt nicht automatisch vertraulichen Text aus jeder Fehlermeldung. Siehe [Überwachung konfigurieren](https://docs.tale.dev/de/self-hosted/configuration/observability-config).

## Prüfe das Verhalten mit harmlosen Daten

Eine Konfigurationsdatei beschreibt das vorgesehene Verhalten. Ein kontrollierter Lauf hilft dir zu prüfen, was tatsächlich passiert. Nutze einen erfundenen Anforderungskatalog mit einer auffälligen, harmlosen Formulierung. Bitte die zuständige Person, die zugehörigen Modellanfragen, Tool-Aufrufe und gemeldeten Ereignisse zu prüfen. Übernimm die Formulierung nicht in öffentliche Suchanfragen, es sei denn, genau diesen Weg willst du ausdrücklich testen.

Prüfe einen normalen Lauf und einen kontrolliert ausgelösten Fehler. Gibt es einen externen Ausweichdienst, teste diesen Weg gesondert. Prüfe auch ein gesperrtes Ziel: Eine Aufgabe, deren Daten intern bleiben müssen, sollte bei Ausfall ihres erlaubten Modells anhalten und nicht unbemerkt auf ein externes Modell wechseln.

Ein beobachteter Lauf beweist nicht, dass es keine weiteren Wege gibt. Gleiche die Beobachtung mit den konfigurierten Zielen und den durchgesetzten Netzwerkregeln ab. Kennzeichne Verbindungen, die du nicht prüfen konntest, als ungeklärt. So kann die zuständige Person über konkrete offene Punkte entscheiden.

## Beschreibe die gewählte Betriebsform genau

Für den Anbietervergleich könnte eine brauchbare Entscheidung so lauten:

> Anforderungskatalog, extrahierter Text, Modellanfragen und Bericht bleiben in unserer kontrollierten Umgebung. Öffentliche Anbieternamen gehen an den Websuchdienst. Fehlermeldungen werden nicht an externe Dienste gesendet. Backups liegen in unserem freigegebenen Speicher.

Das ist ein Beispiel für eine zu prüfende Entscheidung, keine Beschreibung jedes selbst gehosteten Systems. Deine Entscheidung kann durchaus einen benannten externen Modellanbieter zulassen. Entscheidend ist, dass diese Ausnahme sichtbar und genehmigt ist, bevor vertrauliche Arbeit beginnt.

Nutze das [Arbeitsblatt zu Datenflüssen](/blog/worksheets/de/T06-data-flow-inventory.md), um Ziele und ungeklärte Verbindungen gemeinsam mit dem Betrieb festzuhalten. Wenn du erklären kannst, wohin eine echte Aufgabe ihre Daten sendet, kannst du Hosting-Optionen an der Anforderung messen, die dich überhaupt zum Selbsthosting gebracht hat.
