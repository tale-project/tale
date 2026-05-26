---
title: Einen Agent mit Wissen bauen
description: Binde Dokumente aus der Wissensdatenbank an einen frischen Agent, damit seine Antworten die Dokumente zitieren statt aus dem parametrischen Modellgedächtnis zu raten.
---

Ein Agent mit Wissen ist die Form, zu der du greifst, wenn das Modell aus bestimmten Dokumenten antworten soll — deinem Produkt-Handbuch, deinen Richtlinien, den Call-Notizen des letzten Quartals — und nicht aus dem, was es im Training gelernt hat. Der Agent holt zur Antwortzeit Chunks aus den gebundenen Quellen und zitiert sie. Dieser Spaziergang führt einen frischen Agent von „ich will, dass er meine Docs kennt" zu „die Antwort zitiert das richtige Dokument" auf einer Instanz.

Du brauchst eine Editor-Rolle, die Fähigkeit, Dokumente in die Wissensdatenbank hochzuladen, und etwa drei zu bindende Dokumente. Die konzeptuelle Seite lebt in [Agent-Wissen](/de/platform/agents/knowledge); dieser Spaziergang ist der End-to-End-Mechanismus.

## Bevor du beginnst

Bestätige drei Dinge. Deine Rolle ist mindestens Editor — die Agent-Bearbeitung ist auf Editor und höher begrenzt. Du hast mindestens drei Dokumente zum Hochladen bereit (PDFs, DOCX, Markdown — alles, was die Wissensdatenbank akzeptiert). Du hast einen Anbieter konfiguriert, damit der Agent laufen kann — ohne diesen scheitert die Test-Antwort am Ende beim Modell-Call.

## Schritt 1 — Dokumente in die Wissensdatenbank hochladen

Der erste Zug ist, die Dokumente in Tales Wissensdatenbank zu legen. Dokumente ausserhalb der Wissensdatenbank lassen sich nicht binden; der Agent sieht nur Quellen, die er benennen kann.

Öffne **Wissen > Dokumente** und klick **Hochladen**. Zieh die drei Dokumente hinein, gib ihnen sinnvolle Titel und warte, bis die Status-Spalte für jedes **Bereit** zeigt. Der Status durchläuft `hochgeladen → wird verarbeitet → bereit`; die Verarbeitung chunkt das Dokument und berechnet Embeddings. Ein typisches PDF erreicht **Bereit** in ein, zwei Minuten.

Bleibt ein Dokument länger als fünf Minuten auf `wird verarbeitet`, öffne seine Zeile, um den Fehler zu sehen — die häufigste Ursache ist ein nicht unterstütztes Format (reine Bild-PDFs, passwortgeschützte Dateien) oder eine Datei grösser als das Upload-Limit der Org.

## Schritt 2 — Den Agent erstellen

Ein gebundenes Dokument hängt an einem Agent, also muss der Agent zuerst existieren. Öffne **Agenten > Neuer Agent** und füll die vier Knöpfe als Basis aus:

- **Name** — `Docs Q&A`
- **Instruktionen** — `You answer questions strictly from the bound documents. If you cannot find the answer in the documents, say so explicitly. Cite the document title for every claim.`
- **Tools** — **RAG** einschalten; alles andere aus
- **Modell** — was immer die Org als Default nutzt

Speichern und veröffentlichen. Der Agent existiert nun, hat aber kein Wissen — er wird jede Frage verweigern, weil er keine Quelle findet.

## Schritt 3 — Die Dokumente binden

Die Bindung ist die Naht, die dem Agent Retrieval-Zugriff auf eine Teilmenge der Wissensdatenbank gibt. Öffne den Tab **Wissen** des Agenten und klick **Agent-Wissen**. Wähl die drei Dokumente aus Schritt 1 und speicher.

Der Wissen-Tab listet jetzt drei gebundene Quellen. Das RAG-Tool des Agenten holt nur aus diesen drei; nichts anderes in der Wissensdatenbank ist von diesem Agent aus erreichbar, auch keine anderen Dokumente in derselben Bibliothek.

## Schritt 4 — Eine Frage stellen und das Zitat prüfen

Öffne einen Chat mit `Docs Q&A` und stell eine Frage, die eines der Dokumente beantwortet. Die Antwort streamt mit inline gesetzten Zitaten herein — Hovern zeigt den Dokument-Titel, Klicken öffnet das Dokument am zitierten Chunk. Stell eine Frage, die keines der Dokumente abdeckt; der Agent sollte gemäss Instruktion explizit verweigern und keine Antwort erfinden.

Erfindet der Agent trotzdem eine Antwort, sind die Instruktionen nicht streng genug — füg einen expliziten Verweigerungs-Fall hinzu („If you cannot find the answer in the bound documents, respond with exactly: 'I could not find this in the bound documents.'") und veröffentliche erneut.

## Wo das eingesetzt wird

Die vier Züge oben sind der kanonische „Agent, der aus deinen Docs antwortet"-Bau: hochladen, Agent mit aktivem RAG erstellen, binden, mit einem Zitat verifizieren. Dieselbe Form skaliert — bind zehn Dokumente statt drei, füg eine Website oder einen Kunden-Datensatz hinzu, wechsle das Modell. Die Bindungen, nicht das Modell, machen den Agent zu deinem.

Für die konzeptuelle Seite, wie Retrieval mit den anderen Knöpfen des Agenten zusammenspielt, siehe [Agent-Konzepte](/de/platform/agents/concepts). Für die breitere Wissensdatenbank-Geschichte — Kunden, Produkte, Anbieter, Websites — siehe [Wissens-Überblick](/de/platform/knowledge/overview).
