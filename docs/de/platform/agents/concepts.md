---
title: Agent-Konzepte
description: Ein Agent ist die Vier-Knöpfe-Kombination aus Instructions, Wissen, Tools und einem Modell. Diese Seite vermittelt dir das mentale Modell, das der Rest des Agents-Abschnitts voraussetzt.
---

Ein Agent ist die Einheit, zu der Tale greift, wenn dieselbe Frage immer wiederkommt. Er ist die Vier-Knöpfe-Kombination aus Instructions, Wissen, Tools und einem Modell — die vier Dinge, an denen du drehst, damit der Agent sich anders verhält. Redakteure und Entwickler bauen sie; Mitglieder und andere Rollen führen sie aus.

Diese Seite vermittelt dir das mentale Modell, das der Rest des Abschnitts voraussetzt. Lies sie einmal, bevor du deinen ersten Agent baust; komm zurück, wenn du nicht mehr weisst, ob ein Verhalten, das du ändern willst, in den Instructions, im Wissen, in den Tools oder im Modell sitzt.

## Die vier Knöpfe

**Instructions** sind das System-Prompt — die Prosa, die jede Antwort rahmt. Halt sie kurz, meinungsstark und konkret; lange Instructions verwässern in langen Konversationen. Sag die Stimme, die Einschränkungen und die Ablehnungsfälle.

**Wissen** ist das, worauf der Agent zurückgreifen kann. Bind Dokumente, Kunden, Produkte, Lieferanten oder Websites aus der Wissensdatenbank an; der Agent holt sich Chunks zur Antwortzeit und zitiert sie. Wissen, das nicht angebunden ist, ist für den Agent unsichtbar — es gibt kein implizites Ziehen aus der gesamten Bibliothek der Organisation.

**Tools** sind das, was der Agent zusätzlich zum Text-Antworten kann. Eingebaute Tool-Familien decken Web, Dateien, RAG über Wissen, Code-Ausführung, Sub-Agent-Delegation, Workflow-Aufruf, MCP-Server und User-Eingaben ab. Schalt sie pro Agent ein — jedes Tool, das du erlaubst, weitet die Vertrauensgrenze, also halt die Liste kurz.

**Modell** ist das LLM hinter jeder Antwort. Wähl das primäre, setz einen Fallback, Tale löst zur Request-Zeit auf. Modellwechsel trainiert nichts neu — die anderen drei Knöpfe sind das „Gedächtnis" des Modells für den Job.

## Fähigkeiten als Bündel

Eine Fähigkeit verpackt Instructions und (optional) ein Sandbox-Skript in ein wiederverwendbares Bündel, das du an einen Agent hängen kannst. Greif zu einer Fähigkeit, wenn dasselbe Muster über mehrere Agents auftaucht — eine Schreibstimme, eine Berechnung, eine mehrstufige Aufgabe. Fähigkeiten komponieren mit den vier Knöpfen: ein Agent mit drei Fähigkeiten hat die Instructions jeder Fähigkeit plus seine eigenen.

Die Konzept-Seite zu Fähigkeiten beleuchtet den Trade-off zwischen Fähigkeiten und Inline-Instructions im Detail: siehe [Fähigkeiten](/de/platform/agents/skills).

## Zusammengesetzt — ein Support-Triage-Agent

Ein erster nützlicher Agent ist der Support-Triage-Agent: er liest die eingehende Konversation, entscheidet, ob er direkt antwortet, an einen Menschen eskaliert oder an einen Spezialisten weitergibt. Die vier Knöpfe:

- Instructions: ein Absatz Stimme + drei explizite Ablehnungsfälle.
- Wissen: die Produkt-Dokumentation und der FAQ-Ordner; nicht der Quellcode.
- Tools: RAG, Web-Suche und das Sub-Agent-Tool für die Eskalation. Keine Code-Ausführung.
- Modell: ein fähiges Modell als primäres, ein kleineres als Fallback, wenn das primäre Rate-Limits trifft.

Die Konversation läuft dann: User-Nachricht → Instructions rahmen die Antwort → Wissens-Retrieval findet drei relevante Chunks → Tools antworten entweder oder delegieren → die Antwort landet mit Zitaten.

## Wann du danach greifst

Ein einzelner Agent ist die richtige Form, wenn die Konversation in einer Domäne und einer Stimme bleibt. Greif zu einer [Automatisierung](/de/platform/automations/concepts), wenn die Arbeit mehrstufig ist und du Genehmigungen oder Zeitpläne dazwischen willst; greif zu einem rohen Chat (kein Agent), wenn du eine Antwort selbst explorierst und die Modell-Defaults reichen.

| Nutz … wenn                                         | Agent | Roher Chat | Automatisierung |
| --------------------------------------------------- | ----- | ---------- | --------------- |
| Dieselbe Frage kehrt wieder                         | ✓     |            |                 |
| Die Stimme oder die Einschränkungen sind wichtig    | ✓     |            |                 |
| Du brauchst Genehmigungen oder Zeitpläne dazwischen |       |            | ✓               |
| Du explorierst eine Antwort einmalig                |       | ✓          |                 |

## Bau einen

Die vier Knöpfe sind das, woraus jeder Tale-Agent besteht: dreh an einem, und du hast das Verhalten verändert; dreh an dreien, und du hast ein neues Produkt gemacht. Die natürliche nächste Lektüre ist [Bau deinen ersten Agent](/de/tutorials/editor/first-agent-end-to-end) — sie geht die vier Knöpfe auf einer frischen Instanz durch.
