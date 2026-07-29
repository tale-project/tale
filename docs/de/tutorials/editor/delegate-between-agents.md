---
title: Arbeit an einen Worker geben
description: Bitte den Assistenten um offene Recherche, sieh zu, wie er einen fokussierten Worker startet, und folge der Job-Karte — Live-Fortschritt, Ergebnis und vollständiges Protokoll.
---

Wenn eine Anfrage ihren eigenen fokussierten Kontext verdient — zitierte Recherche, Massen-Extraktion, ein langer Entwurf — startet der Assistent einen **Worker**: einen flüchtigen Agenten, zusammengestellt für genau diese Aufgabe, mit genau den Fähigkeiten, die der Assistent ihm aus seinem eigenen Satz mitgibt. Es gibt nichts zu konfigurieren; dieser Durchlauf fährt einen Recherche-Job von Anfang bis Ende und zeigt dir, wie du die Job-Karte liest.

Die konzeptionelle Seite (Fähigkeits-Teilmengen, Budgets, Methodiken) steht in [Agent-Worker](/platform/agents/delegation).

## Bevor du beginnst

Du brauchst einen chatfähigen Agenten (der eingebaute Assistent funktioniert direkt) auf einem Modell mit Tool-Calling. Für Live-Webquellen verbinde eine Such-Connector wie Tavily unter **Einstellungen > Connectors** — ohne sie fällt der Worker auf einfaches Web-Abrufen zurück und sagt das in seinem Ergebnis.

## Schritt 1 — Frag nach etwas, das einen Worker verdient

Öffne einen Chat mit `Assistent` und bitte um offene, zitierbare Arbeit, zum Beispiel: `Recherchiere den Stand von Feststoffbatterien — Markt, wichtigste Akteure, zitierte Quellen.` Eine schnelle Faktenfrage startet keinen Worker (und sollte es auch nicht); Worker sind für Aufgaben, die von Isolation profitieren.

## Schritt 2 — Beobachte die Job-Karte

Der Assistent ruft `spawn_agent` auf, und unter seinem Zug erscheint eine **Job-Karte**: der Name des Workers, ein Live-Status und die eigene Fortschritts-Checkliste des Workers, die sich füllt, während er plant und die Teilfragen abarbeitet. Die Karte blockiert nie den Eingabebereich — du kannst weitertippen, während der Worker läuft.

Zeigt die Karte einen „Übersprungen“-Hinweis, hat der Assistent etwas außerhalb seiner eigenen Freigaben angefragt (etwa eine nicht verbundene Connector); der Lauf geht mit dem Rest weiter, und der Hinweis sagt dir, was du fürs nächste Mal verbinden solltest.

## Schritt 3 — Lies Ergebnis und Protokoll

Ist der Job fertig, faltet der Assistent das Ergebnis des Workers in seine Antwort — bei Recherche ein Fazit, Kernpunkte mit Inline-Zitaten und Quellen. Klappe auf der Karte **Worker-Aktivität** auf, um das vollständige Protokoll zu sehen: jede Suche, jeden Tool-Aufruf und die Überlegungen des Workers. Dieses Protokoll ist der Audit-Trail, auf den du zeigst, wenn jemand fragt, was der Agent tatsächlich getan hat.

## Schritt 4 — Wenn etwas schiefgeht

Ein Worker, dem die Zeit ausgeht oder der auf einen Fehler stößt, endet mit sichtbarem Status auf der Karte — `Zeit abgelaufen` oder `Fehlgeschlagen` — mit intaktem Teilfortschritt. Der Assistent berichtet, was er bekommen hat, und macht selbst weiter, wo er kann. Nichts scheitert still: Brauchte der Worker eine Eingabe, die nur du geben kannst, fragt dich der Assistent direkt.

## Wo das hingehört

Eine Anfrage, ein Worker, eine Karte ist die kleinste nützliche Form. Dieselbe Mechanik skaliert auf mehrere Worker in einem Zug — jeder bekommt seine eigene Karte, seinen eigenen Fortschritt und sein eigenes Protokoll. Für feste Stufen mit Freigaben oder Zeitplänen dazwischen greif stattdessen zu einem [Workflow](/de/platform/automations/concepts).
