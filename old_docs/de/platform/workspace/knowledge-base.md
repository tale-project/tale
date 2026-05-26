---
title: Wissensdatenbank
description: Die Dokumente und gecrawlten Websites hochladen, organisieren und durchsuchen, in denen die KI ihre Antworten verankert.
---

Die Wissensdatenbank ist der Ort, an dem Tale die Informationen ablegt, in denen die KI ihre Antworten verankert. Alles, was du hier hinzufügst, wird für jeden Agent in der Organisation durchsuchbar — hochgeladene Dateien, vom Crawler indizierte Websites, importierte strukturierte Datensätze. Diese Seite behandelt die beiden nutzerseitigen Hauptbereiche: **Dokumente** für Dateien, die du hochlädst oder synchronisierst, und **Websites** für gecrawlte Quellen. Redakteur-Rolle oder höher ist nötig, um Einträge hinzuzufügen, zu ändern oder zu löschen; Mitglieder können den Katalog lesen.

Für strukturierte Datenbereiche (Produkte, Kunden, Lieferanten) siehe [Strukturierte Daten](/de/platform/knowledge/structured-data) — dieselbe Wissensoberfläche, mit einer Tabellen-Form statt freier Dateien.

## Dokumente

Dokumente sind der Kern der Wissensdatenbank. Lade Dateien direkt vom Gerät hoch, synchronisiere sie aus Microsoft 365 oder lasse einen Vergleich gegen ein vorhandenes Dokument laufen. Sobald eine Datei indiziert ist, wird der Inhalt für jeden Agent durchsuchbar, der Zugriff auf den Ordner hat, in dem sie liegt.

### Dokumente hochladen

Um eine oder mehrere Dateien hochzuladen, öffne **Wissen > Dokumente** und klicke im Aktionsmenü oben rechts auf **Hochladen**. Der Dialog akzeptiert Dateien, die du in den Drop-Bereich ziehst, oder eine Auswahl aus dem Dateiauswahl-Dialog — wähle mehrere auf einmal, wenn du einen Stapel hast. Ordne die Dokumente optional einem oder mehreren Teams zu, um zu steuern, in welchen teamgefilterten Ansichten sie erscheinen. Klicke auf **Hochladen**, um die Dateien in die Warteschlange zu stellen; jede zeigt während der Indizierung im Hintergrund einen Status-Indikator.

Die akzeptierten Dateitypen: PDF, DOCX, PPTX, XLSX, TXT, Markdown, CSV, HTML, JSON, YAML und die meisten gängigen Code-Datei-Formate. Die maximale Dateigrösse beträgt standardmässig 100 MB pro Datei; Admins können die Obergrenze pro MIME-Typ in der [Upload-Richtlinie](/de/platform/admin/governance#upload-policy) senken.

### In Ordner organisieren

Dokumente können in Ordnern liegen, sodass das Team einen tiefen Katalog navigieren kann, ohne durch eine flache Liste zu scrollen. Nutze die Breadcrumb-Navigation oben in der Dokumente-Tabelle, um zwischen Ordnern zu wechseln, oder wähle **Neuer Ordner** aus dem Aktionsmenü. Du kannst beim Upload oder jederzeit später einen Ordner anlegen; Dokumente lassen sich aus dem Zeilen-Aktionsmenü zwischen Ordnern verschieben.

### Aus Microsoft 365 synchronisieren

Wenn eine Microsoft-Account-Integration verbunden ist, erscheint **Aus Microsoft 365** im Upload-Dialog neben **Vom Gerät**. Auswählen öffnet einen Browser für OneDrive- und SharePoint-Sites, die der Account erreichen kann — wähle einen einmaligen Import oder eine Synchronisation, die die Dateien mit dem Quellordner im Takt hält. So importierte Dateien tragen ein SharePoint- oder OneDrive-Quell-Badge in der Dokumente-Tabelle, sodass du synchronisierte Dateien von Gerät-Uploads unterscheidest.

### Zwei Dokumente vergleichen

Um zwei Dokumente zu diffen — eine neue Vertragsversion gegen die vorherige, eine aufgefrischte Richtlinie gegen die Spezifikation —, öffne das Aktionsmenü und wähle den Vergleichs-Eintrag. Der Dialog führt durch den Hochladen-oder-Wählen-Flow und rendert ein Diff auf Absatzebene. Die volle Doktrin liegt unter [Dokumenten-Vergleich](/de/platform/workspace/document-comparison).

## Websites

Das Website-Tracking weist Tales Crawler an, Seiten einer Domain nach Plan zu besuchen und zu indizieren. Sobald eine Site indiziert ist, kann jeder Agent mit Web-Zugriff Fragen zu ihrem Inhalt beantworten — nützlich für Dokumentations-Sites, interne Wikis und jede öffentliche Domain, die das Team oft zitiert.

### Eine Website hinzufügen

Um eine Site hinzuzufügen, öffne **Wissen > Websites** und klicke **Website hinzufügen**. Der Dialog fragt nach der vollständigen URL (zum Beispiel `https://docs.example.com`) und einem Scan-Intervall. Klicke **Hinzufügen**, um zu speichern — der Crawler ruft die Startseite sofort ab und beginnt, verlinkte Seiten zu entdecken.

Die sieben unterstützten Scan-Intervalle tauschen Aktualität gegen Crawl-Kosten:

| Scan-Intervall  | Am besten für                          |
| --------------- | -------------------------------------- |
| Stündlich       | Sites mit häufigen Inhaltsänderungen.  |
| Alle 6 Stunden  | Dokumentations-Sites und Firmen-Wikis. |
| Alle 12 Stunden | Halbwegs aktive Sites.                 |
| Täglich         | Marketing-Sites und Blogs.             |
| Alle 5 Tage     | Moderat statische Inhalte.             |
| Alle 7 Tage     | Referenz-Sites mit seltenen Updates.   |
| Alle 30 Tage    | Kaum wechselndes Referenzmaterial.     |

Für tiefere Kontrolle über den Crawl-Umfang (erlaubte Pfade, ignorierte Bereiche, robots.txt-Überschreibungen) siehe [Website-Crawling](/de/platform/knowledge/crawling).

## Wo das einsetzt

Die Wissensdatenbank ist das Substrat, in dem jeder Agent verankert ist — die Dokumente, Websites und strukturierten Datensätze, die die KI bei der Antwort zitiert. Gut zu kuratieren ist, was einen generischen KI-Assistenten in einen verwandelt, der deine Produkte, deine Richtlinien und deine Kunden kennt. Die meisten Qualitätsgewinne beim Bau eines neuen Agents kommen aus dem Schärfen des Wissensumfangs, nicht aus dem Modelltausch.

Um einzugrenzen, was ein bestimmter Agent durchsuchen darf, statt jedem Agent Zugriff auf alles zu geben, ist die nächste Seite [Agent-Konzepte → Wissen](/de/platform/agents/concepts#wissen). Um die Datenbank mit strukturierten Datensätzen anzureichern, führt [Strukturierte Daten](/de/platform/knowledge/structured-data) durch die Entitäten Produkte, Kunden und Lieferanten.
