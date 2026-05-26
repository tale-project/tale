---
title: Agent-Wissen
description: Dokumente, Kunden, Produkte, Lieferanten und Websites an einen Agent binden, damit er sie zitieren kann — und der Unterschied zwischen agent-gebundenem Wissen und dem Wissen-Tab.
---

Wissen, das an einen Agent gebunden ist, ist das, worauf der Agent zur Antwortzeit zugreifen kann. Ohne Bindung ist der Agent generisch; mit Bindung kann er Fragen zu bestimmten Dokumenten, Kunden oder Websites beantworten und zitieren, woher die Antwort kam. Diese Seite deckt den Bindungs-Mechanismus auf dem **Knowledge**-Tab des Agents ab.

Die Wissensquellen selbst leben im Abschnitt [Wissen](/de/platform/knowledge/overview) — Dokumente, Kunden, Produkte, Lieferanten, Websites. Binden ist der Akt, einem Agent Zugriff auf eine Teilmenge dieser Quellen zu geben; ohne Bindung kann er sie nicht sehen.

## Eine durchgespielte Bindung

Öffne einen Agent und klick **Knowledge**. Klick **Agent knowledge** und wähl drei Dokumente aus der Org-Bibliothek. Speichere. Öffne einen Chat mit dem Agent und stell eine Frage, die die Dokumente beantworten. Die Antwort streamt mit Zitaten — beim Hover erscheint der Dokumenttitel, beim Klick öffnet das Dokument. Das Retrieval lief nur über die gebundenen Dokumente; nichts anderes in der Bibliothek war erreichbar.

## Quellentypen

Fünf Quellentypen sind bindbar: **Dokumente** (PDFs, DOCX etc., die in die Wissensdatenbank hochgeladen sind), **Kunden** (strukturierte Kunden-Datensätze), **Produkte** (strukturierte Produkt-Datensätze), **Lieferanten** (strukturierte Lieferanten-Datensätze), **Websites** (gecrawlte Site-Inhalte). Jeder bindet sich gleich — aus einer Liste wählen. Das Retrieval des Agents behandelt sie intern unterschiedlich: Dokumente und Websites werden in Chunks geteilt und eingebettet; strukturierte Datensätze werden per Feld abgefragt.

## Scoping

An einen Agent gebundenes Wissen ist pro-Agent, nicht pro-Chat. Jeder Chat, der den Agent nutzt, bekommt dieselben Bindungen. Um Wissen auf einen einzelnen Chat zu begrenzen, häng die Datei inline an (siehe [Anhänge](/de/platform/chat/attachments)). Um Wissen auf ein Projekt zu begrenzen, bind es stattdessen an einen [Projekt-Agent](/de/platform/projects/project-agents).

## Wo das hineinpasst

Agent-Wissen ist die Antwort auf „dieser Agent sollte dieses bestimmte Zeug kennen". Der breitere Wissen-Abschnitt ist, wo die Quellen leben; die Bindung ist, was einen Agent in eine Teilmenge davon einklinkt. Die nächste Lektüre ist [Wissen-Übersicht](/de/platform/knowledge/overview) für die Quellenseite oder [Agent mit Wissen](/de/tutorials/editor/agent-with-knowledge) für den End-to-End-Bau auf einer frischen Instanz.
