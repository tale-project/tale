---
title: Website-Crawling
description: Tales Crawler konfigurieren, um externe Websites für KI-Suche zu indizieren.
---

Tales Crawler besucht Seiten einer Domain, die du angibst, extrahiert den Textinhalt und indiziert ihn in die Wissensdatenbank neben deinen hochgeladenen Dokumenten. Der KI-Agent kann dann Fragen beantworten, die sich auf diesen Inhalt stützen — "Wie ist unser aktueller Preis auf der Website?", "Welche Features sind in den v3-Release-Notes neu?".

Diese Seite ist für Redakteur/Entwickler. Für den Endnutzer-Workflow (eine Website aus dem Chat hinzufügen) siehe [Wissensdatenbank](/de/platform/workspace/knowledge-base).

## Was der Crawler tut

1. Ruft die angegebene URL ab und parst das HTML.
2. Entdeckt verlinkte Seiten auf derselben Domain.
3. Holt jede entdeckte Seite und wiederholt den Prozess bis zum Discovered-URL-Limit der Domain.
4. Wandelt jede Seite in sauberen Text um (entfernt Navigation, Footer und Ads).
5. Indiziert den Text in den gemeinsamen Wissens-Store mit der Seiten-URL als Quelle.

Nicht-HTML-Dokumente (PDF, DOCX), die auf gecrawlten Seiten verlinkt sind, werden ebenfalls geholt, konvertiert und indiziert.

## Scan-Intervalle

Der Crawler besucht die Site nach einem Zeitplan, den du pro Site wählst:

| Scan-Intervall            | Ideal für                              |
| ------------------------- | -------------------------------------- |
| Jede Stunde               | Seiten mit häufigen Inhaltsänderungen. |
| Alle 6 Stunden (Standard) | Dokumentations-Sites und Firmen-Wikis. |
| Alle 12 Stunden           | Halbwegs aktive Sites.                 |
| Täglich                   | Marketing-Sites und Blogs.             |
| Alle 5 Tage               | Moderat statische Inhalte.             |
| Alle 7 Tage               | Referenz-Sites mit seltenen Updates.   |
| Alle 30 Tage              | Kaum wechselnde Referenzinhalte.       |

Jeder Rescan vergleicht gegen den letzten Fetch. Unveränderte Seiten werden nicht neu indiziert — nur neue, geänderte oder gelöschte Seiten lösen Arbeit aus.

## Rücksicht auf die Ziel-Site

- Der Crawler beachtet `robots.txt`. Disallowed-Pfade werden übersprungen.
- Anfragen sind ratelimit-begrenzt (standardmässig ein Fetch pro 2 Sekunden pro Domain), um das Ziel nicht zu überlasten.
- Der User-Agent ist `TaleCrawler/1.0 (+https://tale.dev/crawler)`, damit Website-Betreiber den Traffic identifizieren können.

Für Sites mit Auth oder angepasstem User-Agent konfiguriere stattdessen eine REST-API-Integration — siehe [Integrationen – Überblick](/de/platform/integrations/overview).

## Einen Crawl debuggen

Wenn ein Crawl Seiten nicht findet, die du erwartest:

- Öffne die Detailseite der Site unter **Wissen > Websites**. Die Liste der gefundenen Seiten zeigt, was der Crawler entdeckt hat.
- Der Fehler-Tab listet Seiten, deren Abruf oder Parsing fehlgeschlagen ist, mit HTTP-Status und Fehlermeldung.
- Prüfe, ob die erwarteten Seiten von der Startseite oder der Sitemap verlinkt sind. Der Crawler findet nur, was er über Links erreichen kann.

## Eine Site entfernen

Eine Site aus **Wissen > Websites** zu löschen, entfernt alle indizierten Inhalte dieser Site. Das geschieht sofort — die KI findet diese Seiten danach nicht mehr.
