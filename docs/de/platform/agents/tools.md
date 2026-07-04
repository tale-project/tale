---
title: Agent-Tools
description: Die eingebauten Tool-Familien, die ein Agent jenseits von Textgenerierung nutzen kann, wie der Agent wählt, welche aufzurufen sind, und wie Tool-Aufrufe in der Antwort rendern.
---

Tools sind das, was ein Agent jenseits von Textproduktion tun kann. Das Modell entscheidet, welches Tool aus einer Liste aufzurufen ist, die der Agent-Autor freigegeben hat; Tale führt das Tool aus, gibt das Ergebnis zurück, und das Modell macht weiter. Diese Seite listet die eingebauten Tool-Familien und die Regeln dazu, wie sie in einer Antwort erscheinen.

Der volle Katalog lebt im **Tools**-Tab des Agents — schalt ein Tool ein, und der Agent kann es aufrufen; schalt es aus, und der Agent vergisst, dass es existiert. Der Sinn dieser Seite ist die Form und das Vertrauensmodell, nicht eine erschöpfende Flag-für-Flag-Tour.

## Ein durchgespielter Tool-Aufruf

Der User fragt „wie ist das Wetter in Zürich heute". Der Agent hat das Web-Tool eingeschaltet. Das Modell emittiert einen Tool-Aufruf gegen das Web-Tool mit der Anfrage „Wetter Zürich heute"; Tale holt das Ergebnis und gibt es zurück; das Modell schreibt die Antwort mit dem Ergebnis und zitiert die Quelle. Aus Sicht des Users zeigt der Chat einen eingeklappten „Web-Inhalt abrufen"-Tool-Aufruf zwischen der Nachricht des Users und der Antwort.

## Eingebaute Tool-Familien

- **Web** — holt und liest URLs, die das Modell für nützlich hält.
- **Dateien** — liest Anhänge und Dateien im aktiven Projekt.
- **RAG** — sucht in Wissensquellen, die an den Agent gebunden sind, und gibt Chunks mit Zitaten zurück. Nennst du in deiner Anfrage einen Ordner („such nur in Contracts/2024"), beschränkt der Agent die Suche auf diesen Ordner und seine Unterordner.
- **Run code** — führt Python, Node oder Shell-Skripte in einer Sandbox aus. Gegated durch die [Run-Code-Richtlinie](/de/platform/admin/governance/run-code-policy) der Org.
- **Worker** — Chat-Agenten starten für eine Aufgabe einen fokussierten Worker mit einer Teilmenge ihrer eigenen Fähigkeiten. Die Grenzen stehen in [Agent-Worker](/de/platform/agents/delegation).
- **Workflows** — ruft einen Tale-Workflow als Tool auf. Die Outputs des Workflows kommen als Tool-Ergebnis zurück.
- **MCP** — ruft Tools auf, die von registrierten [MCP-Servern](/de/platform/integrations/mcp-servers) freigegeben werden.
- **Integrationen** — ruft eine Drittanbieter-Integration auf, die die Org verbunden hat.
- **User-Eingabe** — pausiert den Agent und fragt den User (oder einen Approver-Pool) eine Frage; die Antwort wird das Tool-Ergebnis.
- **Update todos** — pflegt die laufende Todo-Liste des Agents innerhalb eines [Recherche-Plans](/de/platform/agents/concepts).

## Tools an einen Agent anhängen

Öffne den **Tools**-Tab des Agents. Jede Familie ist ein Schalter; manche zeigen Unterschalter (z.B. welche Integration, welcher MCP-Server). Eine Familie einzuschalten fügt ihre Tools der Tool-Liste des Modells zur Request-Zeit hinzu. Es gibt kein Pro-Tool-Feintuning jenseits des Schalters — Agents sollen auf Familienebene konfiguriert werden.

## Tool-Aufruf-Streaming

Tool-Aufrufe rendern im Chat als eingeklappte Karten zwischen der Nachricht des Users und der Antwort. Eine Karte aufzuklappen zeigt den Tool-Namen, die Inputs, die das Modell emittiert hat, und das Ergebnis, das Tale zurückgegeben hat. Ein fehlgeschlagener Tool-Aufruf zeigt den Fehler und lässt den User sehen, was der Agent versucht hat; das Modell versucht es normalerweise im nächsten Zug mit einer anderen Form.

## Wo das hineinpasst

Tools weiten, was ein Agent tun kann; sie weiten auch die Vertrauensgrenze, weil der Agent jetzt Dinge im Auftrag des Users lesen, schreiben oder aufrufen kann. Paar diese Seite mit der [Run-Code-Richtlinie](/de/platform/admin/governance/run-code-policy), wenn der Agent Code ausführt, und mit [MCP-Servern](/de/platform/integrations/mcp-servers), wenn er per MCP nach aussen greift. Die Instructions des Agents bleiben der Ort, an dem die **Policy** lebt; der **Tools**-Tab ist der Ort, an dem die **Oberfläche** lebt.
