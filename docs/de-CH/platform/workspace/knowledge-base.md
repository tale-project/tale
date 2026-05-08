---
title: Wissensdatenbank
description: Dokumente und gecrawlte Websites in deinem Arbeitsbereich hochladen, organisieren und durchsuchen.
---

Die Wissensdatenbank ist der Ort, an dem Tale Informationen für die KI ablegt. Alles, was du hier hinzufügst, wird vom Chat-Agent per bedeutungsbasierter Suche durchsucht. Diese Seite behandelt die beiden nutzerseitigen Bereiche — **Dokumente** und **Websites**. Für strukturierte Daten (Produkte, Kunden, Lieferanten) siehe [Strukturierte Daten](/de/platform/knowledge/structured-data).

> **Hinweis:** Das Bearbeiten der Wissensdatenbank erfordert die Redakteur-Rolle oder höher. Nutzer mit der Mitglied-Rolle können alle Wissens-Einträge sehen, aber nicht anlegen, ändern oder löschen.

## Dokumente

Dokumente sind der Kern der Wissensdatenbank. Du kannst Dateien direkt hochladen oder aus Microsoft OneDrive synchronisieren. Einmal indiziert, ist der Inhalt für den KI-Agent durchsuchbar.

### Dokumente hochladen

1. Navigiere zu **Wissen > Dokumente**.
2. Klicke oben rechts im Aktionsmenü auf **Hochladen**.
3. Ziehe Dateien in den Upload-Bereich oder klicke, um zu durchsuchen. Du kannst mehrere Dateien gleichzeitig auswählen.
4. Ordne die Dokumente optional einem oder mehreren Teams zu. Das steuert, in welchen teamgefilterten Ansichten sie erscheinen.
5. Klicke auf **Hochladen**. Jede Datei wird in die Hintergrundverarbeitung eingereiht. Ein Status-Indikator zeigt an, wann die Indizierung fertig ist.

Unterstützte Dateitypen: PDF, DOCX, PPTX, XLSX, TXT, Markdown, CSV, HTML, JSON, YAML und die meisten gängigen Code-Dateien.

Maximale Dateigrösse: 100 MB pro Datei.

### Ordner-Organisation

Dokumente lassen sich in Ordner organisieren. Nutze die Breadcrumb-Navigation oben in der Dokumenten-Tabelle, um zwischen Ordnern zu wechseln. Ordner kannst du beim Upload oder aus dem Aktionsmenü anlegen.

### Microsoft-OneDrive-Sync

Wenn eine Microsoft-Account-Integration konfiguriert ist, erscheint im Aktionsmenü die Option **Aus OneDrive synchronisieren**. Sie importiert Dokumente direkt aus OneDrive, ohne sie vorher auf deinen Server zu laden.

### Dokumenten-Vergleich

Du kannst zwei Dokumente vergleichen, um zu sehen, was sich geändert hat. Lade eine neue Version hoch oder wähle ein vorhandenes Dokument aus — die Plattform erzeugt ein detailliertes Diff mit Hinzufügungen, Löschungen und Änderungen.

Siehe [Dokumenten-Vergleich](/de/platform/workspace/document-comparison) für alle Details.

## Websites

Das Website-Tracking weist Tales Crawler an, Seiten einer Domain nach Plan zu besuchen und zu indizieren. Einmal indiziert, kann der KI-Agent Fragen zum Inhalt dieser Seite beantworten.

### Website hinzufügen

1. Navigiere zu **Wissen > Websites** und klicke auf **Website hinzufügen**.
2. Gib die vollständige URL der Website an, z. B. `https://docs.example.com`.
3. Wähle ein Scan-Intervall. Es steuert, wie oft der Crawler nach geänderten Inhalten sucht.
4. Klicke auf **Hinzufügen**. Der Crawler ruft sofort die Startseite ab und findet dann verlinkte Seiten.

| Scan-Intervall            | Ideal für                             |
| ------------------------- | ------------------------------------- |
| Jede Stunde               | Seiten mit häufigen Inhaltsänderungen |
| Alle 6 Stunden (Standard) | Dokumentations-Sites und Firmen-Wikis |
| Alle 12 Stunden           | Halbwegs aktive Sites                 |
| Täglich                   | Marketing-Sites und Blogs             |
| Alle 5 Tage               | Moderat statische Inhalte             |
| Alle 7 Tage               | Referenz-Sites mit seltenen Updates   |
| Alle 30 Tage              | Kaum wechselnde Referenzinhalte       |

Für tiefere Kontrolle über das Crawl-Verhalten siehe [Website-Crawling](/de/platform/knowledge/crawling).
