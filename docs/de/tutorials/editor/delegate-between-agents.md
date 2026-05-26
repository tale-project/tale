---
title: Zwischen Agenten delegieren
description: Verdrahte einen Router-Agent, der über das Sub-Agent-Tool an einen Spezialisten übergibt, und beobachte die Kette in einem einzigen Chat von Anfang bis Ende.
---

Delegation ist die Form, zu der du greifst, wenn ein Agent für die ganze Aufgabe der falsche Zuschnitt ist, aber für eine Etappe der richtige. Ein Router-Agent liest die Anfrage, wählt einen Spezialisten, ruft ihn über das Sub-Agent-Tool auf und konsolidiert die Antwort. Dieser Spaziergang baut eine Zwei-Agenten-Kette — Router plus Billing-Spezialist — auf einer frischen Instanz.

Du brauchst eine Editor-Rolle und ein Modell mit Tool-Calling-Unterstützung beim primären Anbieter. Die konzeptuelle Seite lebt in [Agent-Delegation](/de/platform/agents/delegation); dieser Spaziergang ist der End-to-End-Mechanismus.

## Bevor du beginnst

Bestätige drei Dinge. Deine Rolle ist mindestens Editor — die Agent-Bearbeitung ist auf Editor und höher begrenzt. Die Org hat mindestens ein Chat-getaggtes Modell mit Tool-Calling; ohne das kann der Router keinen Tool-Call ausgeben. Das Execution-Timeout-Budget der erstellten Agenten bleibt auf dem Default (ein paar Minuten); kurze Timeouts kappen die Kette, bevor der Sub-Agent antwortet.

## Schritt 1 — Den Spezialisten zuerst erstellen

Der Spezialist existiert vor dem Router, weil der Router auf eine ID zeigt, die aufgelöst werden muss. Öffne **Agenten > Neuer Agent** und füll aus:

- **Name** — `Billing specialist`
- **Instruktionen** — `You answer billing questions concisely. State the customer ID you are answering for in the first sentence. If the question is not about billing, refuse and ask the router to re-route.`
- **Tools** — für diesen Spaziergang alles aus
- **Modell** — der Org-Default

Speichern und veröffentlichen. Kopier die Agent-ID aus der URL oder dem Agent-Header — der Router braucht sie im nächsten Schritt.

## Schritt 2 — Den Router mit dem Sub-Agent-Tool erstellen

Der Router ist der Agent, mit dem der User tatsächlich chattet. Öffne wieder **Agenten > Neuer Agent** und konfiguriere:

- **Name** — `Support router`
- **Instruktionen** — `You triage incoming questions. For billing questions, delegate to the Billing specialist and frame their reply in one sentence. For anything else, refuse and explain why.`
- **Tools** — schalte **Sub-Agents** ein; wähl `Billing specialist` aus dem Dropdown
- **Modell** — der Org-Default

Speichern und veröffentlichen. Die Tool-Liste des Routers enthält jetzt einen Sub-Agent: den Spezialisten aus Schritt 1.

## Schritt 3 — Eine Delegation im Chat laufen lassen

Öffne einen Chat mit `Support router` und frag `My last invoice has a duplicate charge — what should I do?`. Die Antwort rendert in drei Teilen: eine `sub_agent`-Tool-Call-Karte mit dem Aufruf des Routers an den Spezialisten, die Antwort des Spezialisten in dieser Karte und die Ein-Satz-Rahmung des Routers darunter. Klapp die Karte auf, um den vom Router gesendeten Prompt und die Antwort des Spezialisten zu sehen.

Verweigert der Router oder antwortet er selbst statt zu delegieren, drücken die Instruktionen nicht stark genug — füg eine explizite Regel hinzu (`Always delegate billing questions; do not answer them yourself.`) und veröffentliche neu.

## Schritt 4 — Den Execution-Eintrag prüfen

Öffne **Automationen > Executions** (oder den Tab **History** des Chats, je nachdem, wie die Org die Oberfläche benennt) und such den eben gelaufenen Chat. Die Execution listet den Parent-Lauf und den Sub-Agent-Lauf als verschachtelte Zeilen: wer ausgelöst hat, was jeder Agent erhielt, was jeder ausgab und wie lange jeder brauchte. Das ist der Audit-Trail, auf den du zeigst, wenn ein Kunde fragt „was hat der Agent eigentlich gesagt".

## Wo das eingesetzt wird

Eine Router-plus-Spezialist-Kette ist die kleinste nützliche Delegation: eine Routing-Entscheidung, ein Spezialist, eine konsolidierte Antwort. Dieselbe Form skaliert — füg neben dem Billing-Spezialisten einen technischen hinzu, häng eine dritte Stufe für Eskalationen dran, ersetze den Router durch einen Workflow, wenn die Etappen fest sind.

Für den Trade-off zwischen Delegation und einem Workflow mit Approvals siehe [Agent-Delegation](/de/platform/agents/delegation). Für das Vier-Knöpfe-Modell hinter jedem Agent siehe [Agent-Konzepte](/de/platform/agents/concepts).
