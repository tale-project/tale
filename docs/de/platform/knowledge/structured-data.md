---
title: Strukturierte Daten
description: Tales Wissensdatenbank kennt vier eingebaute strukturierte Entitäten — Kunden, Produkte, Lieferanten, Websites — neben Dokumenten. Diese Seite erklärt, wann du eine strukturierte Aufzeichnung statt eines Dokuments wählst.
---

Tales Wissensdatenbank kennt zwei Formen nebeneinander. Dokumente sind freie Text-Blobs, aus denen der Agent Chunks abruft; strukturierte Aufzeichnungen sind typisierte Zeilen, aus denen der Agent Felder liest. Die Form, die du wählst, ist die wichtigste Entscheidung dafür, wie ein Agent dein Wissen nutzt — wählst du falsch, verwässert der Agent eine klare Antwort oder rät einen Wert, den du in der Datei stehen hast.

Diese Seite vermittelt dir das mentale Modell, wann jede Form die richtige ist. Lies sie, bevor du einen Ordner an Dateien lädst; komm zurück, wenn du in Versuchung gerätst, eine Tabelle als PDF hochzuladen.

## Dokumente vs. strukturierte Aufzeichnungen

Ein Dokument ist frei: die Indexier-Pipeline extrahiert Text, chunked ihn, embeddet die Chunks und liefert sie zur Antwortzeit per RAG. Der Agent sieht Passagen und zitiert sie per Dateinamen. Das ist die richtige Form, wenn die Quelle Prosa ist — Verträge, Handbücher, Wissensdatenbank-Artikel, Besprechungsnotizen.

Eine strukturierte Aufzeichnung ist typisiert: die Entität hat bekannte Felder (ein Kunde hat `name`, `email`, `industry`; ein Produkt hat `sku`, `price`, `stock`). Der Agent liest die Felder direkt, joint über Entitäten hinweg und antwortet mit dem Wert. Das ist die richtige Form, wenn die Quelle eine Datenbankzeile ist — Accounts, Bestellungen, Teile, Lieferanten-Daten.

## Die vier eingebauten Modelle

Vier strukturierte Entitäts-Typen sind in jeder Tale-Instanz dabei:

- **Kunden** — die Personen und Organisationen, mit denen du Geschäfte machst.
- **Produkte** — die Dinge, die du verkaufst.
- **Lieferanten** — die Lieferanten, von denen du kaufst.
- **Websites** — Seiten, die ein Crawler zeitgesteuert abruft; strukturiert als URL + gecrawlter Inhalt + Metadaten.

Plus **Dokumente** für alles andere.

## Inhaltsmodelle für eigene Formen

Wenn die vier Eingebauten nicht passen, kannst du mit Inhaltsmodellen einen eigenen strukturierten Aufzeichnungs-Typ definieren. Ein Inhaltsmodell ist eine JSON-Schema-förmige Definition unter [Governance Inhaltsmodelle](/de/platform/admin/governance/content-models): benenne die Entität, deklarier ihre Felder, setz den Feldzugriff, und der neue Typ erscheint neben Kunden, Produkten, Lieferanten und Websites.

Inhaltsmodelle kosten Governance-Aufmerksamkeit — jede Zugriffs- und Aufbewahrungsrichtlinie eines Felds liegt bei dir — also greif dazu, wenn die Daten wirklich eine neue Form sind, nicht eine leichte Variante einer der vier Eingebauten.

## Zusammengesetzt — ein CRM-Agent

Ein CRM-Agent, der „Wo stehen wir mit Acme?" beantwortet, nutzt beide Formen. Die Kunden-Entität hat die kanonische Aufzeichnung von Acme — Name, primärer Kontakt, Branche, Status. Dokumente halten die Gesprächsnotizen und Verträge. Der Agent liest die Felder des Kunden direkt, holt Chunks aus den Dokumenten und antwortet mit beidem: dem strukturierten Status aus Kunden, dem letzten Kontext aus der jüngsten Gesprächsnotiz.

Ohne strukturierte Aufzeichnungen muss der Agent Acme per Namen über PDFs hinweg finden und riskiert, zwei Kunden mit ähnlichen Namen zu verwechseln. Ohne Dokumente kennt der Agent Acmes Status, kann dir aber nicht sagen, was am Dienstag im Gespräch passiert ist.

## Wann du danach greifst

| Nutz … wenn                                                        | Dokumente | Strukturierte Aufzeichnung |
| ------------------------------------------------------------------ | --------- | -------------------------- |
| Die Quelle ist freie Prosa                                         | ✓         |                            |
| Die Quelle hat typisierte Felder und du willst exakte Werte zurück |           | ✓                          |
| Du musst über viele Aufzeichnungen joinen                          |           | ✓                          |
| Der Agent soll Passagen per Stelle zitieren                        | ✓         |                            |

Freie Dokumente und typisierte Aufzeichnungen sind nicht austauschbar; die falsche Form macht den Agent schlechter im Job, den du wolltest.

## Wo das hingehört

Strukturierte Daten sind die Naht zwischen deinen operativen Daten und der Agent-Oberfläche. Nutz die vier Eingebauten für das, was sie abdecken; greif zu [Inhaltsmodellen](/de/platform/admin/governance/content-models), wenn eine fünfte Form auftaucht. Die nächste Lektüre, die sich lohnt, ist [Dokumente](/de/platform/knowledge/documents) — sie deckt die Dokument-Indexier-Pipeline ab und wie Agents zur Antwortzeit nach Chunks greifen.
