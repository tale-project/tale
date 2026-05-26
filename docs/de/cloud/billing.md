---
title: Abrechnung
description: Was Tale Cloud verrechnet, wie Budgets ausufernde Kosten stoppen und wo die Rechnung im Produkt erscheint.
---

Abrechnung auf Cloud ist gemessen, nicht pro Sitz. Du zahlst für Tokens, die von Chats und Agents verbraucht werden, für Sprachminuten, Bildgenerierungen und Speicher; die Plattform selbst kommt mit der Org. Diese Seite führt eine Rechnungszeile durch, listet die gemessenen Komponenten und verweist auf die Budgetkontrollen, die Überraschungen verhindern.

Die Rechnung kommt monatlich per E-Mail und ist auch im Produkt unter **Einstellungen > Abrechnung** sichtbar. Cloud rechnet in der Abrechnungswährung deiner Org ab, die bei der Anmeldung auf USD voreingestellt ist und vor dem ersten Rechnungslauf geändert werden kann.

## Eine durchgespielte Rechnungszeile

Eine Zeile auf der Rechnung lautet `Models — Anthropic Claude Sonnet — 1.2M tokens — $4.32`. Tale hat sie aus dem Pro-Nachricht-Nutzungs-Ledger zusammengesetzt: jede Chat-Antwort speichert das genutzte Modell, die Token-Zahl und den Preis zur Rate, die beim Abschluss des Aufrufs aktiv war. Zeilen aggregieren pro Provider und Modell pro Abrechnungsperiode. Das Detail ist als CSV vom selben Bildschirm herunterladbar.

## Plan-Tiers

Tale bietet zwei Tiers — **Community** und **Enterprise**. Community ist die selbstgehostete Open-Source-Edition; du betreibst sie auf deiner eigenen Infrastruktur, und das Abrechnungskonzept dieser Seite gilt dafür nicht. **Enterprise** ist der gemanagte Tier (Cloud oder Self-hosted) mit Support-SLA, Audit-Log-Aufbewahrungs-Kontrollen, SSO, AVV und Zugriff auf Regionen jenseits des Defaults. Der Tier beeinflusst feste Monatsgebühren und Feature-Gates, nicht Pro-Aufruf-Kosten; das gemessene Pricing für Tokens, Sprache und Speicher unten gilt für Enterprise auf Cloud.

## Gemessene Komponenten

| Komponente    | Einheit              | Gezählt als                                       | Wo zu sehen                                                       |
| ------------- | -------------------- | ------------------------------------------------- | ----------------------------------------------------------------- |
| Modelle       | Tokens (rein + raus) | Pro Provider-Aufruf; Aufschlag auf Provider-Rate  | [Nutzungs-Analyse](/de/platform/admin/governance/usage-analytics) |
| Sprache (TTS) | Gesprochene Zeichen  | Pro als Audio gerenderter Agent-Antwort           | Nutzungs-Analyse                                                  |
| Sprache (STT) | Audio-Sekunden       | Pro vom User aufgenommener Nachricht              | Nutzungs-Analyse                                                  |
| Bilder        | Generierungen        | Pro vom Modell zurückgegebenem Bild               | Nutzungs-Analyse                                                  |
| Speicher      | GB-Monat             | Object-Store-Verbrauch über die Periode gemittelt | Abrechnungsseite                                                  |

## Budgets und Überschreitungen

Setz Budgets unter [Policies and limits](/de/platform/admin/governance/policies-and-limits). Eine **Budget rule** deckelt monatliche Ausgaben pro User, pro Team, pro Rolle oder pro Org. Ein Budget zu treffen liest sich als klarer Toast — **Nutzungslimit erreicht** — und pausiert den betroffenen Bereich, bis das Budget angehoben oder die Periode umgedreht wird. Die Default-Vorrangordnung ist `user > team > role > default` — die spezifischste Regel gewinnt.

Eine **Warning threshold (%)** auf derselben Regel emittiert eine Benachrichtigung, wenn die Nutzung die Schwelle überschreitet, ohne zu blockieren. Greif zur Warnung, wenn du wissen, aber nicht unterbrechen willst; greif zu harten Limits, wenn Überschreitungen ein Notfall sind.

## Wo Nutzung zu finden ist

Die reichste Ansicht ist [Nutzungs-Analyse](/de/platform/admin/governance/usage-analytics) unter Governance — sie bricht die Nutzung nach **Top Assistants**, **Top Models**, **Top Voice Models** und **Per-User Usage** auf, alle nach Datumsbereich filterbar. Die Abrechnungsseite in den Einstellungen zeigt die Rechnungs-Ansicht; die Nutzungs-Analyse zeigt die operative Ansicht.

## Wo das hineinpasst

Abrechnung ist die Schlagzeilenseite des Betreibers; [Nutzungs-Analyse](/de/platform/admin/governance/usage-analytics) ist die alltägliche. Sind die Kosten deiner Org hauptsächlich Tokens, ist die Top-Models-Tabelle die zu setzende Lesezeichen-Seite — sie zeigt, auf welche Modelle sich das Team festgelegt hat, und sagt dir, ob ein Wechsel zu einer billigeren Alternative etwas brächte. Für Self-hosted-User gilt das Abrechnungskonzept nicht (du zahlst deinen Provider direkt); die Kosten-Sichtbarkeitsseite schon.
