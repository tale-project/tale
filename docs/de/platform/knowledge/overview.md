---
title: Wissen
description: Wissen ist der Bereich, in dem die Dokumente und strukturierten Daten der Organisation liegen, damit Agents sie zitieren können. Redakteure kuratieren ihn; Agents rufen zur Antwort-Zeit darüber ab. Diese Übersicht nennt die zwei Hälften und verweist auf die Per-Bereich-Seiten.
---

Wissen ist der Bereich, in dem die Daten der Organisation liegen, damit Agents sie lesen können. Er hat zwei Hälften: **Dokumente** — unstrukturierte Dateien, die durch die Indexierungs-Pipeline laufen, damit Agents zur Antwort-Zeit relevante Chunks abrufen können — und **Strukturierte Daten** — typisierte Tabellen von Kunden, Produkten, Lieferanten und Websites, die Agents als Datensätze lesen, nicht als Prosa. Redakteure kuratieren beide Hälften; Agents sehen die Stücke, an die sie gebunden sind.

Der Wissens-Bereich ist der Ort, in den jeder Agent hineingreift, der seine Antworten in der Realität der Organisation verankern muss. Die Übersicht nennt die Hälften und die Per-Bereich-Seiten; das konzeptuelle Modell, wie ein Agent das Wissen nutzt, an das er gebunden ist, liegt unter [Agent-Wissen](/de/platform/agents/knowledge).

## Die zwei Hälften

**Dokumente** ist die unstrukturierte Hälfte. Lass ein PDF, eine Markdown-Datei, ein Folien-Deck, eine Tabelle, eine Code-Datei einfallen; die Indexierungs-Pipeline extrahiert den Text, chunked ihn, bettet die Chunks ein und speichert sie, damit RAG-getaggte Tools zur Antwort-Zeit relevante Stücke abrufen. Der Inhalt muss kein Schema treffen; die Pipeline liest, was die Datei gibt.

**Strukturierte Daten** ist die typisierte Hälfte. Kunden, Produkte, Lieferanten und Websites sind erstklassige Tabellen mit benannten Feldern, Validierung und expliziten Beziehungen. Ein Agent liest einen strukturierten Datensatz so, wie er ein JSON-Objekt liest — Feld für Feld — und kann den Datensatz direkt zitieren. Greif zu strukturierten Daten, wenn der Inhalt über viele Zeilen dieselbe Form hat (jeder Kunde hat einen Namen, eine E-Mail, eine Stufe); greif zu Dokumenten, wenn der Inhalt Prosa ohne feste Form ist.

Die zwei Hälften teilen sich dieselben Sichtbarkeits- und Team-Skopierungs-Hebel. Ein team-skopierter Kunden-Datensatz ist für Mitglieder ausserhalb des Teams genauso unsichtbar wie ein team-skopiertes Dokument.

## Wie Agents hineinreichen

Ein Agent sieht die ganze Wissensdatenbank nicht standardmässig. Der **Wissen**-Tab des Agents ist der Ort, an dem du spezifische Dokumente, Kundenlisten, Produktkataloge oder Website-Crawls an den Agent bindest. Gebundene Ressourcen sind beim Abruf sichtbar; ungebundene nicht. Das ist Absicht — es hält die Vertrauensgrenze sichtbar und hindert einen Agent daran, etwas hereinzuziehen, das die Organisation nicht für ihn vorgesehen hat.

Der Abruf selbst passiert zur Antwort-Zeit und wird von der RAG-getaggten Tool-Familie am Agent getrieben. Ein gebundenes Dokument wird von derselben Mechanik abgerufen, egal woher es kommt — ein direkter Upload, eine OneDrive-Sync, ein Confluence-Pull, ein Website-Crawl. Das Quell-Feld jedes indexierten Elements zeigt das Zitat zurück ans Original.

## Seiten in diesem Bereich

**[Dokumente](/de/platform/knowledge/documents)** — Redakteure lesen das, wenn sie Dateien hochladen, die Indexierungs-Pipeline beobachten und den Per-Dokument-Lebenszyklus verwalten.

**[Strukturierte Daten](/de/platform/knowledge/structured-data)** — Redakteure lesen das, wenn sie typisierte Tabellen pflegen — Kunden, Produkte, Lieferanten, Websites — die Agents als Datensätze lesen.

## Wo das hingehört

Wissen ist die Datenschicht, in der Agents ihre Antworten verankern; ohne sie wissen Agents nur, was das Modell schon weiss. Die natürliche nächste Lektüre hängt vom Inhalt ab, den du hereinbringst — für Dateien [Dokumente](/de/platform/knowledge/documents); für typisierte Datensätze [Strukturierte Daten](/de/platform/knowledge/structured-data); dafür, wie ein Agent bindet und abruft, [Agent-Wissen](/de/platform/agents/knowledge).
