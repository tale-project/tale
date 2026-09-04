---
title: Strukturierte Daten
description: Tales Wissensdatenbank bringt drei eingebaute strukturierte Entitäten mit — Kontakte, Produkte, Websites — neben den Dokumenten. Diese Seite gibt dir das mentale Modell dafür, wann ein typisierter Datensatz ein Dokument schlägt.
---

Tales Wissensdatenbank führt zwei Formen nebeneinander. Dokumente sind Text, aus dem der Agent Chunks abruft; strukturierte Datensätze sind typisierte Zeilen, aus denen der Agent Felder liest. Die Form, die du wählst, ist die wichtigste Entscheidung dafür, wie ein Agent dein Wissen nutzt — liegst du falsch, verwässert der Agent entweder eine klare Antwort oder rät bei einem Wert, den du längst vorliegen hast.

Diese Seite gibt dir das mentale Modell dafür, wann welche Form die richtige ist. Lies sie, bevor du einen Ordner voller Dateien lädst; komm zurück, wenn du versucht bist, eine Tabelle als PDF hochzuladen.

## Dokumente gegenüber strukturierten Datensätzen

Ein Dokument ist frei geformt: Die Indexierungs-Pipeline extrahiert Text, chunked ihn, bettet die Chunks ein und serviert zur Antwortzeit Passagen über den Abruf. Der Agent sieht Passagen und zitiert sie nach Quelle. Das ist die richtige Form, wenn der Inhalt Prosa ist — Verträge, Handbücher, Wissensdatenbank-Artikel, Meeting-Notizen.

Ein strukturierter Datensatz ist typisiert: Die Entität hat bekannte Felder (ein Kontakt hat einen Namen, eine E-Mail, eine Branche; ein Produkt hat eine SKU, einen Preis, einen Bestand). Der Agent liest die Felder direkt, verknüpft über Entitäten hinweg und antwortet mit dem Wert. Das ist die richtige Form, wenn die Quelle eine Datenbankzeile ist — Konten, Bestellungen, Teile, Lieferantendaten.

## Die drei eingebauten Entitäten

Drei strukturierte Tabs sitzen im Wissensbereich neben **Dokumente** und **Wissenseinträge**:

- **Kontakte** — die Menschen und Organisationen, mit denen du Geschäfte machst, Kunden wie Lieferanten; das Verzeichnis vereint beide, ein Lieferant ist also ein Kontakt, bei dem du einkaufst.
- **Produkte** — die Dinge, die du verkaufst.
- **Websites** — öffentliche Seiten, die ein Crawler nach Zeitplan holt; der Datensatz hält Domain und Scan-Einstellungen, die indexierten Seiten halten den Inhalt ([Crawling](/de/platform/knowledge/crawling)).

Strukturierte Datensätze teilen die Team-Bindungshebel der Wissensdatenbank: Ein team-gebundener Datensatz ist außerhalb des Teams genauso unsichtbar wie ein team-gebundenes Dokument.

## Content-Modelle für eigene Formen

Wenn die drei eingebauten Entitäten nicht passen, definierst du mit Content-Modellen einen eigenen strukturierten Datensatztyp: die Entität benennen, ihre Felder deklarieren, Zugriff pro Feld setzen — und der neue Typ erscheint neben den eingebauten. Die Definitionen liegen bei den [Content-Modellen](/de/platform/admin/governance/content-models) der Governance.

<Note>

Content-Modelle kosten Governance-Aufmerksamkeit — Zugriff und Aufbewahrung jedes Feldes liegen bei dir. Greif dazu, wenn die Daten wirklich eine neue Form sind, nicht eine leichte Variante einer der drei eingebauten.

</Note>

## Alles zusammen — ein CRM-Agent

Ein CRM-Agent, der „Wo stehen wir mit Acme?“ beantwortet, nutzt beide Formen. Die Entität Kontakte hält den kanonischen Datensatz — Name, Hauptkontakt, Branche, Status. Dokumente halten die Gesprächsnotizen und Verträge. Der Agent liest die Felder des Kontakts direkt, ruft Passagen aus den Dokumenten ab und antwortet mit beidem: dem strukturierten Status aus Kontakten, dem jüngsten Kontext aus der letzten Gesprächsnotiz.

Ohne strukturierte Datensätze muss der Agent Acme namentlich über PDFs hinweg suchen und riskiert, zwei ähnlich benannte Kontakte zu verwechseln. Ohne Dokumente kennt der Agent Acmes Status, kann dir aber nicht sagen, was im Gespräch am Dienstag passiert ist.

## Wann du wozu greifst

| Nimm … wenn                                                        | Dokumente | Strukturierter Datensatz |
| ------------------------------------------------------------------ | --------- | ------------------------ |
| Die Quelle ist freie Prosa                                         | ✓         |                          |
| Die Quelle hat typisierte Felder und du willst exakte Werte zurück |           | ✓                        |
| Du musst über viele Datensätze hinweg verknüpfen                   |           | ✓                        |
| Der Agent soll Passagen nach Fundstelle zitieren                   | ✓         |                          |

## Wo das hingehört

Strukturierte Daten sind die Naht zwischen deinen operativen Daten und der Agenten-Fläche. Nimm die drei eingebauten Entitäten für das, was sie abdecken; greif zu [Content-Modellen](/de/platform/admin/governance/content-models), wenn eine vierte Form auftaucht. Die nächste Lektüre, die sich lohnt, ist [Dokumente](/de/platform/knowledge/documents) — die Indexierungs-Pipeline, die die unstrukturierte Hälfte bedient.
