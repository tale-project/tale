---
title: Strukturierte Daten
description: Produkte, Kunden und Lieferanten als strukturierte Datensätze verwalten, die die KI abfragen kann.
---

Die strukturierten Bereiche der Wissensdatenbank speichern Geschäftsdatensätze, die der KI-Agent neben Dokumenten- und Website-Inhalten abfragen kann. Anders als freie Dokumente haben strukturierte Einträge feste Felder und lassen sich in Massen importieren.

## Produkte

Der Bereich **Produkte** speichert deinen Produktkatalog. Jeder Produktdatensatz enthält Namen, Beschreibung, Bild-URL, Bestand, Preis, Währung, Kategorie und Status.

Produkte lassen sich einzeln anlegen oder in Masse per CSV importieren. Das CSV-Format hat keine Kopfzeile-Zeile; die Spalten stehen in dieser Reihenfolge:

```text
name, description, imageUrl, stock, price, currency, category, status
```

Gültige Status-Werte: `active`, `inactive`, `draft`, `archived`. Ungültige Werte fallen auf `draft` zurück.

## Kunden

Der Bereich **Kunden** speichert deine Kundenliste. Jeder Kunde hat eine E-Mail-Adresse, ein Locale, einen Status und optionale benutzerdefinierte Metadaten. Importierte Kunden haben standardmäßig den Status `churned`.

CSV-Import in diesem Format:

```text
email, locale
```

Gültige Locale-Werte: `en`, `de`, `es`, `fr`, `it`, `nl`, `pt`, `zh`. Ungültige Locales fallen auf `en` zurück.

## Lieferanten

Der Bereich **Lieferanten** speichert Lieferanten- und Partnerdatensätze. Die Lieferantendaten sind vom KI-Agent durchsuchbar und lassen sich in automatisierten Workflows referenzieren. Derselbe CSV-Import wie bei Kunden funktioniert auch hier.

## Strukturierte Daten in Agents nutzen

Strukturierte Datensätze werden in denselben Wissens-Store wie Dokumente indiziert. Agents mit Wissens-Zugriff können alle Typen gleichzeitig durchsuchen. Um einen Agent auf eine Teilmenge zu beschränken — etwa einen Sales-Agent, der nur Produkte und Kunden sieht — konfiguriere seinen Wissen-Tab. Siehe [Agent erstellen](/de/platform/agents/create).

## Wo das hingehört

Strukturierte Daten sind die Hälfte der Wissensdatenbank, die Reihen und Spalten hat, statt Absätze und Überschriften. Die Freitext-Hälfte (Dokumente, gecrawlte Websites) ist für prosa-förmigen Inhalt; diese Hälfte ist für Entitäten — die Kataloge, Kundenlisten und Lieferanten-Datensätze, die die KI zitiert, wenn sie domänenspezifische Fragen beantwortet. Beide Hälften werden in denselben Store indiziert und sind über dieselbe Wissens-Suche erreichbar; ein Agent, der sich in beiden verankert, mischt sie fliessend.

Für die Prosa-Hälfte der Wissensdatenbank deckt [Wissensdatenbank](/de/platform/workspace/knowledge-base) Dokumenten-Upload und Website-Crawling ab. Für die agent-seitigen Stellen, die entscheiden, welche Entitäten ein Agent sieht, ist [Agent erstellen → Wissen](/de/platform/agents/create) die nächste Seite.
