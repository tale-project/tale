---
title: Agent-Delegation
description: Ein Agent kann einen anderen über das Sub-Agent-Tool aufrufen. Diese Seite erklärt, wann du delegierst, wie Timeouts propagieren und was eine Kette vor dem Looping schützt.
---

Delegation ist der Zug, den du machst, wenn ein Agent die falsche Form für den ganzen Job ist, aber die richtige Form für eine Stufe davon. Der Router-Agent liest die Anfrage, entscheidet, an welchen Spezialisten er übergibt, ruft ihn über das Sub-Agent-Tool, und konsolidiert die Antwort. Das Muster funktioniert für Triage, Routing und jeden Fall, wo die richtige Stimme von der Frage abhängt.

Diese Seite vermittelt dir das mentale Modell, wann du delegierst und wie du die Kette begrenzt hältst. Lies sie, bevor du deinen ersten Multi-Agent-Workflow verdrahtest; komm zurück, wenn eine Delegations-Kette nicht mehr zurückkehrt und du wissen musst, welcher Cap gefeuert hat.

## Wie Delegation läuft

Die Tool-Liste eines Router-Agents enthält das **Sub-Agent**-Tool. Wenn der Router es mit der ID des Spezialisten und einem Prompt aufruft, startet Tale eine Kind-Konversation: der Spezialist sieht nur den Prompt, den der Router geschickt hat (nicht die ganze Historie des Routers), läuft bis zum Ende und gibt seine finale Antwort zurück. Der Router liest die Antwort als Tool-Ergebnis und macht weiter — typischerweise konsolidiert er in eine einzige ausgehende Antwort.

Die Kind-Konversation läuft gegen die vier Knöpfe des Spezialisten: seine Anweisungen, sein Wissen, seine Tools, sein Modell. Der Router erbt keines davon; der Spezialist sieht keines des Routers. Sie teilen sich eine Organisation und ein Budget, sonst nichts.

## Timeouts und Budget-Propagation

Zwei Caps verhindern, dass eine Kette für immer läuft:

- **Ausführungs-Timeout** — pro Agent in Minuten gesetzt. Wenn der Timeout feuert, gibt der laufende Tool-Aufruf einen Fehler zurück und der Agent rollt zurück. Sub-Agent-Aufrufe laufen im verbliebenen Timeout des Elternteils; ein Sub-Agent kann das Budget seines Elternteils nicht verlängern.
- **Token-Budget** — auf Organisations- oder Team-Ebene durch Governance-Richtlinie angewendet. Token-Verbrauch rollt hoch: die Tokens eines Sub-Agents zählen gegen den Lauf des Eltern-Agents, der gegen die Budget-Regel der Organisation zählt.

Trifft eine Delegations-Kette mitten im Aufruf auf eine Budget-Regel, kommt die Antwort des laufenden Sub-Agents trotzdem zurück; der nächste Tool-Aufruf des Elternteils ist blockiert. Das Ausführungs-Log hält den Budget-Treffer fest.

## Beispiel — eine Router → Spezialist-Kette

Ein Kunden-Support-Router-Agent hat eine kurze Anweisung und drei Tools: Sub-Agent für einen Abrechnungs-Spezialisten, Sub-Agent für einen technischen Spezialisten, RAG über die Support-FAQ. Bei einer eingehenden Nachricht:

1. Der Router entscheidet zwischen Abrechnung, Technik oder „Antworte ich selbst aus der FAQ".
2. Bei Abrechnung: er ruft den Abrechnungs-Spezialisten mit der Frage des Kunden und der Kunden-ID. Der Spezialist hat Tools zur Abfrage des Abrechnungssystems; er gibt einen Antwort-Entwurf zurück.
3. Der Router liest den Entwurf, fügt einen rahmenden Absatz hinzu und antwortet.
4. Das Ausführungs-Log zeigt den Eltern-Agent, den Spezialisten-Aufruf und das FAQ-Retrieval (oder dessen Fehlen) für die Audit-Spur.

## Wann du danach greifst

| Nutz … wenn                                               | Delegation | Einzelner Agent | Workflow |
| --------------------------------------------------------- | ---------- | --------------- | -------- |
| Stimme oder Wissen hängt von der Domäne der Frage ab      | ✓          |                 |          |
| Ein Agent kann den ganzen Job abdecken                    |            | ✓               |          |
| Arbeit hat explizite Etappen mit Genehmigungen dazwischen |            |                 | ✓        |
| Die Kette hat mehr als drei Sprünge                       |            |                 | ✓        |

Delegation ist die richtige Form, wenn die Routing-Entscheidung selbst ein Job für einen Agent ist. Ein Workflow ist die richtige Form, wenn die Etappen fest sind und du Genehmigungen oder Zeitpläne dazwischen willst.

## Bau eine

Die Kosten der Delegation sind ein zusätzlicher Aufruf pro Übergabe; der Nutzen ist das richtige Wissen und die richtige Stimme in jeder Stufe, ohne dass ein Agent alles wissen muss. Halt Ketten kurz (zwei oder drei Agents); für längere Ketten gibt eine Automatisierung dir die Audit-Spur und die Genehmigungs-Nähte, die Delegation nicht hat. Der natürliche nächste Walkthrough ist [Zwischen Agents delegieren](/de/tutorials/editor/delegate-between-agents) — er baut eine Router → Spezialist-Kette von Anfang bis Ende.
