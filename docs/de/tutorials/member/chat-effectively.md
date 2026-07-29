---
title: Effektiv chatten
description: Fünf Gewohnheiten, die einen Chat von „danke für die Textwand" zu „genau, was ich brauchte" drehen — den Agent benennen, das Modell wählen, die richtige Datei anhängen, im Scope fragen und die Zitate lesen.
---

Effektives Chatten in Tale dreht sich nicht um clevere Prompts; es dreht sich darum, dem Chat genug Kontext zu geben, damit das Modell deine Absicht beim ersten Lesen erfasst. Fünf kleine Gewohnheiten — den richtigen Agent wählen, das richtige Modell wählen, nur Wichtiges anhängen, im Scope fragen, die Zitate lesen — drehen die durchschnittliche Antwort von „danke für die Textwand" zu „genau, was ich brauchte". Diese Seite läuft die Gewohnheiten der Reihe nach in einem frischen Chat ab.

Du brauchst eine Member-Rolle (das Minimum für Chat) und einen veröffentlichten Agent in der Org, den du ansprechen kannst. Die konzeptuelle Seite lebt in [Chat-Grundlagen](/de/platform/chat/basics); dieser Spaziergang ist der Alltags-Mechanismus.

## Gewohnheit 1 — Den Agent vor der ersten Nachricht wählen

Der Agent ist der Hebel mit dem höchsten Ertrag pro Klick. Der Default-Assistant ist eine leere Leinwand; ein Agent mit gebundenem Wissen, aktiven Tools und justierter Stimme schlägt ihn bei jeder nicht-generischen Frage. Öffne den Agent-Picker im Chat und wähl den Agent, dessen Scope zu deiner Frage passt — Support, Sales, Research — bevor du tippst.

Passt kein Agent, lass den Assistant an; greif nicht zu einem schief sitzenden Agent für „passt schon ungefähr". Ein schief sitzender Agent verweigert oft oder weicht vom gebundenen Wissen ab.

## Gewohnheit 2 — Das Modell zur Nachricht passend wählen

Der Modell-Picker neben dem Agent-Picker listet jedes Modell, das die Anbieter-Zugangsdaten der Organisation freigeben, gruppiert in **Modelle** und **Sandbox-Agents**. Nichts wird für dich vorausgewählt, also wechsle, sobald die Nachricht ihre Form ändert. Eine lange Reasoning-Frage will ein grösseres Modell; ein schneller Lookup will ein kleineres, schnelleres. Eine Nachricht mit Bild braucht ein Vision-fähiges Modell — ohne dieses fällt das Bild stillschweigend weg.

Der Modell-Picker zeigt den Tag (`Chat`, `Vision`, `Image`, `Embedding`) neben jedem Namen; pass den Tag zur Nachricht.

## Gewohnheit 3 — Nur anhängen, was der Agent braucht

Anhänge laden zur Übernutzung ein. Ein 200-Seiten-PDF als einzelner Anhang füllt das Kontext-Budget und verdünnt die Antwort; die relevanten Seiten in den Prompt exzerpiert schlagen die ganze Datei. Hängst du ein langes Dokument doch an, stell eine spezifische Frage dagegen („was steht auf Seite 12 zu Rückerstattungen?") statt einer offenen („erzähl mir alles").

Für Dateien, auf die du oft verweisen wirst — eine Preisliste, ein Richtlinien-Dokument — lad sie in den [Wissen](/de/platform/knowledge/documents)-Bereich und binde sie an einen Agent. Einmal gebunden, hat jeder Chat mit diesem Agent sie verfügbar, ohne erneutes Hochladen.

## Gewohnheit 4 — Innerhalb des Scopes des Agenten fragen

Jeder Agent hat einen impliziten Scope aus seinen Instruktionen und seinem gebundenen Wissen. Einen Billing-Agent zu Marketing-Strategie zu fragen, bringt im besten Fall eine höfliche Verweigerung, im schlimmsten eine Halluzination. Der billige Fix: lies die Bio des Agenten oben im Picker, bevor du fragst — sie benennt den Scope. Liegt deine Frage ausserhalb, wechsle den Agent.

## Gewohnheit 5 — Die Zitate lesen und ihnen folgen

Enthält die Antwort Zitate (die kleinen inline Links), öffne eines. Das Zitat zeigt auf das Chunk der Quelle, aus dem der Agent zitiert hat; das Lesen bestätigt, dass der Agent nicht über das hinaus paraphrasiert hat, was die Quelle wirklich sagt. Die Zwei-Minuten-Gewohnheit, pro Antwort ein Zitat zu öffnen, fängt die kleine Teilmenge der Antworten ab, bei denen der Agent übergriffig war.

## Wo das eingesetzt wird

Fünf Gewohnheiten, ein Chat, dieselbe Schleife jedes Mal, wenn du den Chat-Tab öffnest. Die Gewohnheiten verstärken sich — der richtige Agent macht das richtige Modell offensichtlich; das richtige Modell macht die Zitate vertrauenswürdig; die Zitate schliessen die Schleife.

Für die Oberfläche, auf der diese Gewohnheiten leben, siehe [Chat-Grundlagen](/de/platform/chat/basics). Für die Datei-Seite — was wortwörtlich eingefügt wird, was indexiert wird — siehe [Anhänge](/de/platform/chat/attachments).
