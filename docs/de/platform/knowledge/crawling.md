---
title: Crawling
description: Wie Tale eine Website-Entität in Wissen verwandelt — Domain-Registrierung, sitemap-basierte URL-Erkennung, geplante Re-Scans und die Ansicht indexierter Seiten.
---

Eine Website ist die strukturierte Form für „eine öffentliche Seite, die der Agent kennen soll". Du gibst Tale eine Domain und ein Scan-Intervall; der Crawler entdeckt URLs, ruft Seiten ab, extrahiert den Hauptinhalt, zerlegt und embeddet den Text und liefert die Chunks zur Antwortzeit zurück — genauso wie bei Dokumenten. Diese Seite vermittelt dir das mentale Modell und führt durch das, was du siehst, wenn eine Website vom Hinzufügen bis zur Indexierung läuft.

Crawling ist die eine Hälfte der Websites-Geschichte. Die andere — was die strukturierte Website-Aufzeichnung enthält und wie Agents sie lesen — liegt in [Strukturierte Daten](/de/platform/knowledge/structured-data). Lies die zuerst, wenn die Frage lautet „soll das eine Website oder ein Dokument sein"; lies diese hier, wenn die Frage lautet „was tut der Crawler eigentlich".

## Eine Website hinzufügen

Öffne **Wissen > Websites** und klick **Website hinzufügen**. Zwei Felder: **Domain** (zum Beispiel `example.com`) und **Scan-Intervall** (jede Stunde, alle 6 Stunden, alle 12 Stunden, täglich, alle 5 Tage, alle 7 Tage, alle 30 Tage). Tale normalisiert die Domain — `https://`, `www.`, abschließende Schrägstriche werden toleriert — und weist alles ab, was nicht als Hostname parst. Speichere, und die Website landet in der Tabelle mit Status **Wird gescannt**.

Es gibt kein Auth-Feld, keine pfadbasierte Include-Liste, keine pfadbasierte Exclude-Liste im Formular. Der Crawler behandelt die Domain als öffentliche Oberfläche; alles, was eine Session, eine Kopfzeile oder einen Bypass braucht, ist für Websites außen vor. Für private Inhalte lad [Dokumente](/de/platform/knowledge/documents) hoch oder verdrahte eine [Integration](/de/platform/integrations/overview).

## Wie URLs entdeckt werden

Der Crawler probiert zuerst den kooperativen Weg und fällt auf den groben zurück.

Der erste Versuch ist die Sitemap der Seite. Der Crawler löst die Startseite auf, lässt `ultimate-sitemap-parser` jede `sitemap.xml` und jeden Sitemap-Index durchlaufen, den er findet — inklusive gzip-komprimierter Sitemaps und in `robots.txt` deklarierter Sitemaps — und sammelt jede URL ein, die die Seite selbst veröffentlicht hat. Seiten, die ihre Sitemap pflegen, erhalten eine saubere, vollständige URL-Liste ohne Linkgraphen-Raterei.

Wenn die Sitemap fehlt, kaputt oder leer ist, fällt der Crawler auf einen breitensuchen-basierten Link-Walk von der Startseite aus zurück. Er folgt nur Links innerhalb der Domain, lässt externe Links und Social-Media-Links fallen und entfernt Navigations- und Fußzeilen-Beiwerk, bevor er Inhalt extrahiert. Der Rückfall deckt Seiten ohne Sitemap ab; er erreicht nicht die Vollständigkeit einer gepflegten Sitemap.

## Der Scan-Zeitplan

Das gewählte Scan-Intervall entscheidet, wie oft der Crawler URLs neu entdeckt und Seiten neu abruft. Hinter der Tabelle wacht ein Scheduler in jedem Intervall auf, fragt den Store, welche Websites fällig sind, und führt sie mit begrenzter Parallelität aus. Neue Websites haben keinen Last-Scanned-Zeitstempel, also werden sie beim nächsten Scheduler-Tick aufgegriffen und beginnen den Scan innerhalb von Sekunden nach dem Hinzufügen.

Jeder Scan ist inkrementell: Seiten, die sich nicht geändert haben, werden übersprungen, geänderte Seiten werden neu extrahiert und neu embedded, neue Seiten werden hinzugefügt, entfernte Seiten fallen aus dem Index. Agents, die auf die Website zeigen, sehen den neuen Inhalt beim nächsten Retrieval.

## Was die Tabelle dir sagt

Jede Zeile zeigt die Domain, das Scan-Intervall, den Status, den Last-Scanned-Zeitstempel und einen Prozentwert indexierter Seiten. Der Status liest sich als **Inaktiv** zwischen Scans, **Wird gescannt** während ein Scan läuft, **Aktiv** wenn ein Scan erfolgreich war, **Fehler** wenn der letzte Scan scheiterte, oder **Lösche…** wenn eine Zeile entfernt wird. Der Prozentwert ist `gecrawlt / gesamt` aus dem letzten Scan — fahr drüber für die Rohzahlen.

Öffne eine Zeile, um den entdeckten Titel, die Beschreibung und das Erstellungsdatum der Website zu lesen. Klick **Seiten anzeigen** für die Seitenliste — jede URL, die der Crawler indexiert hat, mit Wortzahl, Chunk-Anzahl, Last-Crawled-Zeitstempel und einer Suchbox, die über die indexierten Chunks läuft.

## Wo das hingehört

Crawling ist der günstige Weg, eine öffentliche Seite in den Agent-Kontext zu bringen. Du gibst eine Domain und eine Taktung, der Rest ist das Problem des Crawlers — Sitemap-Erkennung, Linkgraphen-Rückfall, geplante Re-Scans, inkrementelle Indexierung. Der Trade-off: der Crawler sieht nur das, was ein anonymer Besucher sieht. Alles hinter einem Login liegt in [Dokumenten](/de/platform/knowledge/documents) oder einer [Integration](/de/platform/integrations/overview). Die nächste Lektüre, die sich lohnt, ist [Strukturierte Daten](/de/platform/knowledge/structured-data) — sie deckt ab, wie die Website-Aufzeichnung und die indexierten Seiten neben Kunden, Produkten und Lieferanten in die Wissensdatenbank passen.
