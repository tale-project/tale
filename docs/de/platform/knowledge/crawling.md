---
title: Crawling
description: Wie Tale eine Website in Wissen verwandelt — Domain registrieren, URLs über die Sitemap entdecken, geplante Re-Scans und die Ansicht der indexierten Seiten.
---

Eine Website ist die Form der Wissensdatenbank für „eine öffentliche Seite, die der Agent kennen soll“. Du gibst Tale eine Domain und ein Scan-Intervall; der Crawler entdeckt URLs, holt Seiten, extrahiert den Hauptinhalt, chunked und bettet den Text ein und serviert die Chunks zur Antwortzeit genauso wie bei Dokumenten. Diese Seite geht durch, was du zwischen dem Hinzufügen einer Domain und den ersten Agenten-Zitaten ihrer Seiten siehst.

<Frame caption="Eine Website hinzufügen — Domain plus Scan-Intervall ist das ganze Formular.">

![Der Dialog Website hinzufügen auf dem Websites-Tab, der nach einer Domain und einem Scan-Intervall fragt, das standardmäßig auf alle sechs Stunden steht.](/images/platform/websites-add-dialog.webp)

</Frame>

## Eine Website hinzufügen

Öffne **Wissen > Websites** und klicke auf **Website hinzufügen**. Der Dialog hat zwei Felder: **Domain** (zum Beispiel `example.com`) und **Scan-Intervall** — jede Stunde, alle 6 Stunden (der Standard), alle 12 Stunden, täglich, alle 5 Tage, alle 7 Tage oder alle 30 Tage. Tale normalisiert die Domain — `https://`, `www.` und Schrägstriche am Ende sind verkraftbar — und weist alles ab, was sich nicht als Hostname lesen lässt. Klicke auf **Speichern**; der Scheduler nimmt neue Websites beim nächsten Takt auf, der erste Scan startet also binnen Sekunden.

<Note>

Es gibt kein Auth-Feld und keine Include/Exclude-Pfadliste — der Crawler sieht exakt das, was ein anonymer Besucher sieht. Alles hinter einem Login gehört stattdessen in [Dokumente](/de/platform/knowledge/documents) oder eine [Connector](/de/platform/connectors/overview).

</Note>

## Wie URLs entdeckt werden

Der Crawler versucht zuerst den kooperativen Weg. Er löst die Startseite auf und geht jede Sitemap durch, die die Website veröffentlicht — `sitemap.xml`, Sitemap-Indizes, gezippte und in der robots-Datei deklarierte Sitemaps — und sammelt so die URL-Liste, die die Website selbst pflegt. Websites mit gesunder Sitemap bekommen vollständige Abdeckung ohne Raten.

Fehlt die Sitemap, ist sie kaputt oder leer, fällt der Crawler auf einen Breitensuche-Linklauf von der Startseite zurück: nur Links innerhalb der Domain, externe und Social-Links fallen weg, Navigations- und Footer-Chrome wird vor der Extraktion entfernt. Der Fallback deckt Websites ohne Sitemap ab, erreicht aber nie die Vollständigkeit einer gepflegten Sitemap.

## Der Scan-Zeitplan

Das Intervall entscheidet, wie oft URLs neu entdeckt und Seiten neu geholt werden. Jeder Scan ist inkrementell: Unveränderte Seiten werden übersprungen, geänderte neu extrahiert und neu eingebettet, neue Seiten kommen dazu, entfernte fliegen aus dem Index. Agenten, die auf die Website zeigen, sehen den neuen Inhalt beim nächsten Abruf — einen separaten Veröffentlichungsschritt gibt es nicht.

## Die Tabelle lesen

Jede Zeile zeigt die Domain, ihren **Status** — **Inaktiv** zwischen Scans, **Wird gescannt** im Flug, **Aktiv** nach einem erfolgreichen Scan, **Fehler**, wenn der letzte Scan fehlschlug, **Lösche…** während der Entfernung —, den Prozentwert **Indexiert** (Hover zeigt gecrawlte von insgesamt gefundenen Seiten), die letzte **Gescannt**-Zeit und das **Intervall**. Öffne eine Zeile für den entdeckten Titel und die Beschreibung der Website; klicke auf **Seiten anzeigen** für die Seitenliste — jede indexierte URL mit Wortzahl, Chunk-Zahl und letzter Crawl-Zeit, plus ein Suchfeld, das über die indexierten Chunks läuft und damit der schnellste Weg ist zu prüfen, was ein Agent wirklich abrufen würde.

## Wo das hingehört

Crawling ist der günstige Weg, eine öffentliche Website in den Agenten-Kontext zu holen: eine Domain, ein Takt, und der Rest ist das Problem des Crawlers. Der Preis ist die Grenze des anonymen Besuchers — private Inhalte brauchen [Dokumente](/de/platform/knowledge/documents) oder eine Connector. Wie die Website-Zeilen neben Kontakte, Produkten und Lieferanten stehen, liest du in [Strukturierte Daten](/de/platform/knowledge/structured-data).
