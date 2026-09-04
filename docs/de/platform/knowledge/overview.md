---
title: Wissen
description: Wissen ist die geteilte Bibliothek der Organisation — Dokumente, kleine Fakten, gecrawlte Websites und typisierte Datensätze —, in der Agenten ihre Antworten verankern. Diese Übersicht nennt die Tabs und verweist auf die Seiten pro Bereich.
---

Wissen ist der Bereich, in dem die Daten der Organisation liegen, damit Agenten sie lesen und zitieren können. Redakteure kuratieren sie einmal; Agenten rufen zur Antwortzeit darüber ab — deshalb kann ein Agent in Tale mit deiner Realität antworten statt mit den Trainingsdaten des Modells. Der Bereich öffnet auf fünf Tabs: **Dokumente**, **Wissenseinträge**, **Websites**, **Produkte** und **Kontakte**.

Lieber erst zusehen? Episode 3 geht die ganze Bibliothek in gut drei Minuten durch — Indexierung, Einträge, Datensätze, Crawler und Zugriff, mit Untertiteln.

<Video src="/videos/de/tutorials/ep3-knowledge/ep3-knowledge.de.mp4" poster="/videos/de/tutorials/ep3-knowledge/ep3-knowledge.de.webp" captions="/videos/de/tutorials/ep3-knowledge/ep3-knowledge.de.vtt" lang="de" title="Episode 3 — Wissen" caption="Episode 3 — Wissen (3:22)">

</Video>

<Frame caption="Der Dokumente-Tab — die meistgenutzte Ecke der Wissensdatenbank.">

![Der Dokumente-Tab des Wissensbereichs mit drei hochgeladenen Textdateien samt Spalten für Größe, Quelle, RAG-Status und Team.](/images/get-started/documents-list.webp)

</Frame>

## Die zwei Formen

Alles in diesem Bereich hat eine von zwei Formen. **Indexierte Inhalte** — die Dateien in Dokumente, die Fakten in Wissenseinträge, die Seiten, die ein Website-Crawl hereinholt — laufen durch die Indexierungs-Pipeline (extrahieren, chunken, einbetten, speichern), damit Agenten relevante Passagen abrufen und zitieren. **Typisierte Datensätze** — Produkte und Kontakte (das Korrespondenten-Verzeichnis, das Kunden und Lieferanten umfasst) — sind Zeilen mit benannten Feldern, die Agenten als Daten lesen, nicht als Prosa: exakte Werte, kein Abruf-Rätselraten.

Die Form, die du wählst, entscheidet, wie ein Agent den Inhalt nutzen kann — deshalb ist [Strukturierte Daten](/de/platform/knowledge/structured-data) eine Entscheidungsseite, nicht nur eine Referenz.

## Wo der Index liegt

Indexierte Inhalte werden in Tales eingebaute Vektordatenbank eingebettet — einen **PostgreSQL**-Speicher (ParadeDB), der `pgvector`-Embeddings mit Keyword-Suche (BM25) kombiniert und beide fusioniert, sodass die Suche sowohl semantische Treffer als auch exakte Begriffe erfasst. Er kommt mit der Plattform, es gibt also nichts zusätzlich zu lizenzieren oder zu betreiben, und Suche, Zitate, team-bezogene Berechtigungen und DSGVO-Löschung arbeiten alle auf einem Speicher. Embeddings stammen vom konfigurierten **Embedding-Modell** der Organisation — ein Org-Admin wählt Anbieter, Modell und Vektorbreite unter **Einstellungen > Datenresidenz**, und die Wissenssuche verweigert mit einem konkreten Hinweis, bis eines eingerichtet ist, statt ein Modell zu raten.

**Bring deine eigene Vektordatenbank mit — es ist Postgres.** Weil der Vektorspeicher PostgreSQL ist, kannst du Tales Wissensdatenbank statt auf die mitgelieferte auf jedes von dir betriebene verwaltete PostgreSQL zeigen (mit den Erweiterungen `pgvector` und `pg_search`/ParadeDB) — deine Daten, deine Infrastruktur, deine Region. Ein Org-Admin richtet die Verbindung unter **Einstellungen > Datenresidenz** ein — trage Host, Datenbank und Anmeldedaten für dein Postgres ein, gleich für eine selbst gehostete Bereitstellung und eine dedizierte Cloud-Instanz. Tale prüft die Verbindung und das Vorhandensein der nötigen Erweiterungen, bevor du umstellst. Siehe [Datenresidenz](/de/self-hosted/configuration/data-residency) für die Verbindungsdetails und die Erweiterungs-Voraussetzungen.

## Wie Agenten hineingreifen

Ein Agent sucht sich keinen eigenen Ausschnitt der Bibliothek aus. Der Chat-Assistent durchsucht den ganzen Bestand mit `rag_search` und lädt Gefundenes mit `rag_fetch`, sobald eine Frage danach verlangt, ein Projekt-Agent liest ihn über die Plattform-Tools, mit denen du ihn ausrüstest, und team-gebundene Einträge bleiben für Agenten und Mitglieder außerhalb des Teams unsichtbar. Jede abgerufene Passage trägt ihre Quelle, sodass Zitate auf die Datei, den Eintrag oder die Seite zurückzeigen, aus der sie kamen. Die Mechanik auf Agenten-Seite steht in [Projekt-Agenten](/de/platform/projects/project-agents).

## Seiten in diesem Bereich

<CardGroup cols="2">

<Card title="Dokumente" icon="file-text" href="/de/platform/knowledge/documents">

Dateien hochladen, die Indexierungs-Pipeline, unterstützte Formate und der Lebenszyklus pro Dokument.

</Card>

<Card title="Wissenseinträge" icon="book-open" href="/de/platform/knowledge/knowledge-entries">

Kleine Fakten mit Themen-Schlüssel — aus dem Chat mit Freigabe erfasst oder von Hand hinzugefügt.

</Card>

<Card title="Crawling" icon="globe" href="/de/platform/knowledge/crawling">

Aus einer öffentlichen Website wird Wissen — Domain, Scan-Intervall und die Ansicht der indexierten Seiten.

</Card>

<Card title="Strukturierte Daten" icon="table" href="/de/platform/knowledge/structured-data">

Kontakte, Produkte, Websites — wann ein typisierter Datensatz ein Dokument schlägt.

</Card>

</CardGroup>

## Wo das hingehört

Wissen ist die Datenschicht, auf der jede verankerte Antwort steht; ohne sie wissen Agenten nur, was das Modell ohnehin weiß. Bring Inhalte über den Tab herein, der zu ihrer Form passt, und binde dann Agenten daran — die natürliche nächste Lektüre ist [Dokumente](/de/platform/knowledge/documents) für Dateien, [Strukturierte Daten](/de/platform/knowledge/structured-data) für Datensätze und [Projekt-Agenten](/de/platform/projects/project-agents) dafür, wie ein Agent darauf zugreift.
