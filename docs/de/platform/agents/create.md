---
title: Einen Agent erstellen
description: Vom leeren Create-agent-Dialog zu einem veröffentlichten Agent — Modell wählen, Instructions schreiben, Wissen anbinden, Tools einschalten und im Chat verifizieren.
---

Dieses Tutorial führt vom leeren **Agent erstellen**-Dialog zu einem Agent, den du veröffentlichst und nutzt. Das Ergebnis ist ein funktionierender Agent, der seine Domäne kennt, die Tools hat, um auf das zu reagieren, was er liest, und aus jedem Chat in deiner Org erreichbar ist. Etwa fünfzehn Minuten, wenn du bereits einen Modell-Provider konfiguriert hast; länger, wenn du auch einen einrichten musst.

Du brauchst die Rolle Redakteur oder höher und einen unter **Einstellungen > Provider** konfigurierten Modell-Provider; die erste Voraussetzung unten verlinkt die Einrichtung, falls nicht. Die Stimme, die dieses Tutorial nutzt, ist dieselbe wie die in [Agent-Konzepte](/de/platform/agents/concepts) — lies diese Seite einmal, bevor du die Instructions deines ersten Agents schreibst.

## Bevor du beginnst

Stell sicher, dass zwei Dinge bereit sind:

- Ein Modell-Provider ist unter **Einstellungen > Provider** konfiguriert. Cloud-User bekommen einen by default; Self-hosted-User folgen [Konfiguration → Provider](/de/self-hosted/configuration/providers).
- Du hältst die Rolle Redakteur oder höher in dieser Org. Schau unter **Einstellungen > Personen**, wenn du nicht sicher bist; die Rolle steht in deiner Mitgliedszeile.

Das Tutorial nutzt einen Support-Triage-Agent als laufendes Beispiel — denselben, den [Agent-Konzepte](/de/platform/agents/concepts) einführt. Tausch deine eigene Domäne frei aus; die Schritte hängen nicht vom Beispiel ab.

## Schritt 1 — Das primäre Modell wählen

Öffne **Agents** in der Sidebar und klick **Create agent**. Der Dialog wirft dich auf den Tab **Instructions & model**. Öffne den Modell-Picker, und das Suchfeld erwartet einen Modellnamen oder eine Familie — tipp „gpt", „claude" oder „llama", um zu filtern. Wähl ein fähiges Modell als primäres; das Verhalten des Agents lehnt sich stark an diese Wahl. Der Picker zeigt auch einen Fallback-Slot — wähl ein kleineres, billigeres Modell, damit der Agent weiterläuft, wenn das primäre rate-limitiert ist.

## Schritt 2 — Die Instructions schreiben

Das Instructions-Feld ist reines Markdown. Drei Ratschläge aus der Praxis:

- **Öffne mit der Stimme.** Ein Absatz, der benennt, wer der Agent ist, wem er antwortet und welchen Ton er anschlägt. Das Modell behandelt das als stärkstes Signal.
- **Benenne die Ablehnungsfälle explizit.** Drei oder vier Sätze, die sagen, was der Agent ablehnt und was er beim Ablehnen sagt.
- **Widersteh der Versuchung, jedes Verhalten zu spezifizieren.** Lange Instructions verwässern in langen Konversationen. Gehört ein Verhalten in Code, lehn dich auf ein Tool; gehört es in Daten, lehn dich auf Wissen.

Speicher den Agent mit dem **Save**-Knopf oben rechts. Der Dialog bleibt offen mit der Agent-ID sichtbar in der URL — du kannst zurückkommen, um zu verfeinern.

## Schritt 3 — Wissensquellen anbinden

Wechsle zum **Knowledge**-Tab. Wissen ist das, worauf der Agent zugreifen kann; standardmässig ist nichts gebunden. Klick **Agent knowledge** und wähl aus den Dokumenten, Kunden, Produkten, Lieferanten oder Websites der Org. Der Agent wird zur Antwortzeit aus diesen Quellen abrufen und zitieren, was er genutzt hat.

Zwei Warnungen:

- Bind die kleinste nützliche Menge. Ein gebundenes, aber selten abgerufenes Dokument kostet trotzdem Embedding-Zyklen.
- Das hier gebundene Wissen kommt zusätzlich zu allem, was die Instructions des Agents direkt abzurufen sagen. Die Instructions benennen die Policy; die Bindung benennt die Oberfläche.

## Schritt 4 — Die Tools einschalten

Wechsle zum **Tools**-Tab. Tools sind das, was der Agent jenseits von Textgenerierung tun kann. Die Schalter sind nach Familie gruppiert — Web, Dateien, RAG, Code-Ausführung, Sub-Agents, Workflows, MCP, Integrationen, Benutzereingaben. Schalt ein, was der Agent braucht, und lass den Rest aus. Jeder Schalter weitet die Vertrauensgrenze, also sei sparsam.

Die Schalter, die besondere Überlegung brauchen:

- **Run code** ist durch die [Run-Code-Richtlinie](/de/platform/admin/governance/run-code-policy) der Org gegated. Wenn deine Org-Policy es verbietet, liest sich der Schalter als deaktiviert.
- **Sub-agents** lässt diesen Agent an andere delegieren; [Agent-Delegation](/de/platform/agents/delegation) deckt ab, wann das der richtige Zug ist.

## Schritt 5 — Veröffentlichen und ausprobieren

Zurück auf **Instructions & model**, leg **Visible in chat** um und klick **Save**. Ein Toast bestätigt **Agent saved**. Öffne einen neuen Chat, wähl den Agent im Picker und sende eine Nachricht, die das gebundene Wissen und die Tools fordert. Antwortet der Agent so, wie du ihn geschrieben hast, bist du fertig; tut er es nicht, zeigt der **History**-Tab am Agent jede Änderung, die du gemacht hast, und lässt dich vergleichen oder wiederherstellen.

## Fehlersuche

- **Save ist ausgegraut.** Das Instructions-Feld ist leer, oder der Modell-Picker hat keine Auswahl. Beides ist erforderlich.
- **Der Agent erscheint nicht im Chat-Picker.** Bestätige, dass **Visible in chat** an ist. Wenn ja, bestätige, dass der wählende User Zugriff hat — Projekt-Agents erscheinen nicht ausserhalb ihres Projekts.
- **Antworten sagen „kein Zugriff" auf ein Tool.** Eine Governance-Policy gated das Tool. Die Agent-Definition erlaubt es; die Runtime weigert sich. Schau in [Policies and limits](/de/platform/admin/governance/policies-and-limits).
- **Retrieval gibt nichts zurück.** Die Wissensquellen, die du gebunden hast, enthalten vielleicht nicht das, was der Prompt gefragt hat. Überprüf, ob die Quelle indiziert ist, indem du sie aus [Dokumente](/de/platform/knowledge/documents) öffnest und bestätigst, dass die Chunks rendern.

## Wo das eingesetzt wird

Einen Agent zu erstellen ist der Moment, in dem sich der Rest der Plattform wie Tale anfühlt und nicht wie ein generischer Chat. Der natürliche nächste Spaziergang ist [Agent mit Wissen](/de/tutorials/editor/agent-with-knowledge) — dieselbe Form, aber bindet einen Ordner voller PDFs und fordert die Zitierungs-Pipeline von Anfang bis Ende. Muss der gerade gebaute Agent an einen Spezialisten übergeben, ist [Zwischen Agents delegieren](/de/tutorials/editor/delegate-between-agents) das Kettenmuster.
