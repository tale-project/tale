---
title: Dokumente
description: Der Dokumente-Bereich ist der Ort, an dem Redakteure Dateien in die Wissensdatenbank hochladen, sie indexieren sehen und an Agents binden. Diese Seite behandelt das Hochladen, die Indexierungs-Pipeline, unterstützte Formate und den Per-Dokument-Lebenszyklus.
---

Der Dokumente-Bereich ist die Datei-Oberfläche der Wissensdatenbank. Redakteure laden Dateien hoch — PDFs, Word-Dokumente, Markdown, Klartext, Code, Tabellen, Folien-Decks — und Tale schickt jede durch eine Indexierungs-Pipeline, die Text extrahiert, ihn in Chunks zerlegt, die Chunks einbettet und sie speichert, damit Agents zur Antwort-Zeit relevante Stücke abrufen können. Einmal indexiert, kann ein Dokument an einen oder mehrere Agents gebunden werden; gebundene Agents sehen die Chunks des Dokuments während des RAG-Abrufs und zitieren sie in Antworten.

Diese Seite behandelt die Betreiber-Seite von Dokumente: hochladen, was während der Indexierung passiert, unterstützte Formate, wie der Per-Dokument-Lebenszyklus funktioniert und wie sich Dokumente von den strukturierten Datentypen (Kunden, Produkte, Lieferanten, Websites) unterscheiden, die sich die Wissensdatenbank teilen.

## Ein durchgespielter Upload

Um ein Dokument hochzuladen, öffne **Wissen > Dokumente** und lass die Datei auf den Upload-Bereich fallen, oder klick auf **Hochladen** und wähl die Datei von der Festplatte. Das Dokument erscheint sofort in der Liste mit Status `Indexierung`; Tale fährt die Pipeline im Hintergrund. Wenn der Status auf `Indexiert` umspringt, ist das Dokument bereit, an Agents gebunden zu werden. Pipeline-Fehler erscheinen mit Status `Fehler` und einer einzeiligen Begründung; die Zeile trägt eine **Wiederholen**-Schaltfläche, die die Pipeline von Grund auf neu fährt.

Das Dokument an einen Agent zu binden ist ein separater Schritt. Öffne den Agent und füg das Dokument unter seinem **Wissen**-Tab hinzu; die nächste Anfrage, die der Agent bedient, ruft über die Chunks des neuen Dokuments ab. Ein Dokument ohne Bindungen bleibt indexiert, ist aber für jeden Agent unsichtbar — nützlich, wenn du das Dokument in der Bibliothek willst, aber noch nicht in der Produktion.

## Was die Indexierungs-Pipeline tut

Die Indexierung passiert in vier Stufen, der Reihe nach:

- **Extrahieren** — Text aus der Datei ziehen. PDFs gehen durch layoutbewusste Extraktion; Office-Dokumente und Markdown gehen durch strukturbewusste Extraktion; Bilder in einem Dokument gehen durch OCR.
- **Chunken** — den extrahierten Text in abrufgrosse Stücke aufteilen und dabei Überschriften und Absatzgrenzen respektieren, wo die Struktur der Datei sie sichtbar macht.
- **Einbetten** — das Embedding-Modell des konfigurierten Anbieters der Organisation aufrufen, um pro Chunk einen Vektor zu erzeugen.
- **Speichern** — die Chunks und ihre Vektoren in den Such-Index schreiben, mit den Metadaten der Quelldatei dran.

Die Pipeline ist idempotent auf dem Hash der Quelldatei. Dieselbe Datei zweimal hochzuladen erzeugt eine indexierte Kopie, nicht zwei. Die Datei zu bearbeiten und neu hochzuladen ersetzt die alten Chunks durch die neuen; Agents sehen die Aktualisierung beim nächsten Abruf.

## Unterstützte Formate

Die Pipeline behandelt die Dateitypen, die das Gros des Organisations-Wissens abdecken:

- **Text und Code.** Markdown (`.md`), Klartext (`.txt`), Quellcode (jede Sprache, die Tale hervorhebt — siehe die Highlighter-Liste).
- **Dokumente.** PDF (`.pdf`), Word (`.docx`), Open Document (`.odt`), Rich Text (`.rtf`).
- **Tabellenkalkulationen.** Excel (`.xlsx`), CSV (`.csv`), Open Document Sheet (`.ods`).
- **Folien.** PowerPoint (`.pptx`), Open Document Presentation (`.odp`).
- **Webseiten.** HTML (`.html`) und die gerenderte Ausgabe eines Seiten-Crawls.
- **Bilder.** PNG, JPG, WEBP, mit OCR angewendet, um Text zu extrahieren.

Eine Datei in einem nicht unterstützten Format lädt hoch, scheitert aber bei der Indexierung; die Zeile zeigt den Format-nicht-unterstützt-Fehler. Die Liste der unterstützten Formate wächst, wie die Pipeline wächst.

## Der Per-Dokument-Lebenszyklus

Jedes Dokument trägt einen kleinen Satz Felder über seinen Inhalt hinaus: einen **Titel** (automatisch aus den Metadaten der Datei extrahiert, bearbeitbar), eine **Quelle** (die Datei oder die Integration, die es hereingebracht hat), einen **Eigentümer** (das Mitglied oder Team, das es hochgeladen hat), **Tags** (freie Labels zum Filtern) und eine **Sichtbarkeit** (organisationsweit, team-skopiert oder per Agent). Der Sichtbarkeits-Hebel ist das Dokument-Level-Pendant zur anderswo gemachten Team-Skopierung — ein team-skopiertes Dokument ist für Mitglieder ausserhalb des Teams unsichtbar, selbst wenn ihre Rolle es sonst erlauben würde.

Dokumente, die aus einer Integration synchronisiert wurden, tragen das Quell-Feld der Integration. Ein Dokument, das durch die OneDrive-Sync hereingekommen ist, zeigt den OneDrive-Pfad; ein Dokument, das aus Confluence gezogen wurde, zeigt die Seiten-URL. Das Quell-Feld macht Zitate zurück zum Upstream-System klickbar.

## Löschen und neu indexieren

Klick auf die Zeile des Dokuments, dann auf **Löschen**, um es aus der Bibliothek zu entfernen. Löschen entfernt die Chunks beim nächsten Durchgang aus dem Such-Index; laufende Abrufe werden fertig, der nächste sieht das Dokument nicht. Es gibt kein Undo — dieselbe Datei neu hochzuladen stellt es wieder her, aber der Audit-Verlauf des Dokuments startet frisch.

Ohne Löschen neu zu indexieren ist die richtige Bewegung, wenn sich die Pipeline zwischen Uploads verbessert hat. Klick auf **Neu indexieren** in der Zeile; Tale fährt die Pipeline erneut auf der gespeicherten Quelldatei und ersetzt die Chunks atomar. Das Dokument verschwindet während des Neu-Indexierens nicht aus der Reichweite der Agents.

## Dokumente versus strukturierte Daten

Die Wissensdatenbank hat zwei Hälften. **Dokumente** sind unstrukturiert — Text, Prosa, Folien, alles, was die Pipeline chunken und einbetten kann. **Strukturierte Daten** (Kunden, Produkte, Lieferanten, Websites) sind Zeilen in typisierten Tabellen — Felder mit Namen, Validierung und expliziten Beziehungen. Greif zu Dokumenten, wenn der Inhalt Prosa ist; greif zu strukturierten Daten, wenn der Inhalt eine Liste von Dingen mit derselben Form ist. Siehe [Strukturierte Daten](/de/platform/knowledge/structured-data) für die Typisierte-Tabellen-Oberfläche.

## Wo das hingehört

Dokumente sind die meistgenutzte Ecke der Wissensdatenbank — jeder Agent, der eine Quelle zitiert, zitiert wahrscheinlich ein Dokument. Die natürliche nächste Lektüre ist [Wissens-Übersicht](/de/platform/knowledge/overview) für die übergreifende Karte und [Agent-Wissen](/de/platform/agents/knowledge) dafür, wie ein Agent sich an Dokumente bindet und zur Antwort-Zeit darüber abruft.
