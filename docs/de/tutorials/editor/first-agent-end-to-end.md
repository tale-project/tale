---
title: Deinen ersten Agent bauen
description: Bring eine frische Org von „ich will einen Agent" zu einem geprüften Aufgaben-Ergebnis, indem du die vier Knöpfe — Instruktionen, Wissen, Tools, Modell — der Reihe nach auf einer Instanz drehst.
---

Ein erster Agent ist das kleinste nützliche Ding in Tale: Instruktionen plus Modell, manchmal mit einem Tool oder einem gebundenen Dokument. Dieser Spaziergang dreht die vier Knöpfe der Reihe nach — Instruktionen, Wissen, Tools, Modell — und hinterlässt dir einen veröffentlichten Agent, der aus einer echten Aufgabe ein prüfbares Ergebnis macht. Die Form verallgemeinert sich: jeder spätere Agent ist dieselben vier Züge mit anderen Entscheidungen.

Du brauchst eine Editor-Rolle und ein konfiguriertes Chat-getaggtes Modell beim Anbieter der Org. Die konzeptuelle Seite lebt in [Agent-Konzepte](/de/platform/agents/concepts); dieser Spaziergang ist der End-to-End-Mechanismus.

## Bevor du beginnst

Bestätige drei Dinge. Deine Rolle ist mindestens Editor — die Agent-Bearbeitung ist auf Editor und höher begrenzt. Die Org hat einen Anbieter konfiguriert und mindestens ein Chat-getaggtes Modell darauf; ohne das scheitert die Test-Antwort am Ende beim Modell-Call. Du hast eine Frage im Kopf, die der Agent beantworten soll — wähl etwas eng genug, dass ein Absatz Instruktionen sie rahmen kann, etwa „fass eine eingehende Kontaktnachricht in einen Satz plus eine empfohlene nächste Aktion zusammen".

## Schritt 1 — Die Instruktionen schreiben

Instruktionen sind der System-Prompt — die Prosa, die jede Antwort rahmt. Der erste Knopf ist der, bei dem die meisten überdrehen. Öffne **Agenten > Neuer Agent** und setze:

- **Name** — `Triage assistant`
- **Instruktionen** — `You read a contact message and produce two lines. Line one: a one-sentence summary in plain English. Line two: a recommended next action — reply, escalate, or close. If the message is blank or off-topic, refuse and say so.`

Speicher vorerst als Entwurf; veröffentlichen kommt nach den anderen Knöpfen. Kurze, meinungsstarke, konkrete Instruktionen schlagen lange — halt die Regeln unter einem Absatz.

## Schritt 2 — Über das Wissen entscheiden

Wissen ist das, worauf der Agent zur Antwortzeit zurückgreifen kann. Lass Wissen für diesen ersten Agent leer: die Aufgabe ist, die Nachricht zu lesen, nicht etwas zu holen. Der Wissen-Tab bleibt unangetastet.

Wolltest du später Wissen ergänzen — etwa eine Eskalations-Matrix, die der Agent konsultieren soll — würdest du das Dokument hochladen, den **Wissen**-Tab des Agenten öffnen und es binden. Der ganze Mechanismus liegt in [Agent mit Wissen](/de/tutorials/editor/agent-with-knowledge).

## Schritt 3 — Die Tools wählen

Tools sind das, was der Agent jenseits von Text-Antworten tun kann. Für Triage brauchst du keine Tools: der Agent liest Input und schreibt Output. Öffne den Tab **Tools** und lass jeden Schalter aus. Jedes Tool, das du gewährst, erweitert die Vertrauensgrenze; halt die Liste kurz.

Soll der Agent die empfohlene Aktion in ein CRM zurückschreiben, würdest du später den entsprechenden Connector-Tool-Schalter aktivieren — aber nicht, bevor die reine Text-Variante funktioniert.

## Schritt 4 — Modell wählen und veröffentlichen

Öffne den Tab **Modell** und wähl als primäres den Org-Default; setz ein kleineres Modell als Fallback, damit der Agent läuft, wenn das primäre rate-limited ist. Speicher, dann klick **Veröffentlichen**. Der Agent steht nun jedem Projekt und jeder Automatisierung mit passender Rolle zur Verfügung — der Chat selbst führt nur den eingebauten Assistenten aus.

Erstell eine Aufgabe, füg eine echte Kontaktnachricht in ihre Beschreibung ein und weis sie dem `Triage assistant` zu. Das Ergebnis des Laufs sollte gemäß den Instruktionen in zwei Zeilen landen — Ein-Satz-Zusammenfassung und empfohlene Aktion. Driftet das Format ab, zieh die Instruktionen straffer und veröffentliche neu; das ist die Schleife, in der du am meisten Zeit verbringst.

## Wo das eingesetzt wird

Vier Knöpfe, ein veröffentlichter Agent, eine verifizierte Antwort: dieselbe Form, der jeder später gebaute Agent folgt. Die nächsten Spaziergänge spezialisieren sich auf je einen Knopf — [Agent mit Wissen](/de/tutorials/editor/agent-with-knowledge) auf den zweiten, [Arbeit an einen Worker geben](/de/tutorials/editor/delegate-between-agents) auf den dritten.

Für die Konzept-Seite, die die vier Knöpfe und ihre Trade-offs benennt, siehe [Agent-Konzepte](/de/platform/agents/concepts). Für Versionierung und Rollback, sobald der Agent reift, siehe [Agent-Versionen](/de/platform/agents/versions).
