---
title: Genehmigungen in Workflows
description: Wo ein Live-Lauf auf einen Menschen wartet — ein für die Freigabe geparkter Connector-Schreibzugriff, eine Frage einer Agent-Node — und wie eine Definition sich ändert und live geht, ohne Vorschlagskarte.
---

Automatisierungen laufen ohne dich, aber ein Lauf hält an zwei Stellen für dich an. Ein Connector-Schreibzugriff, der deinen Mandanten verlässt, parkt, bis jemand ihn freigibt, und eine Agent-Node, die eine Antwort braucht, parkt, bis jemand sie gibt; beide warten auf der Detailseite des Laufs, und beide setzen genau dort fort, wo sie stehen geblieben sind. Die Definition selbst zu ändern hat in dieser Version keine Karte: Du bearbeitest und speicherst Versionen auf dem Canvas, und Live-Schalten ist ein eigener, ausdrücklicher Schritt. Diese Seite behandelt die zwei Tore und den Authoring-Weg; was eine Genehmigung grundsätzlich ist, steht auf [Genehmigungskonzepte](/de/platform/approvals/concepts).

<Frame caption="Der Canvas einer Automatisierung mit dem Panel daneben — die Definition ändert sich hier durch das Speichern einer Version, und ein Live-Lauf parkt auf seiner Detailseite, wenn ein Schritt einen Menschen braucht.">

![Der Workflow-Canvas einer Automatisierung mit einem Graphen aus Nodes und einem geöffneten Panel daneben.](/images/platform/automation-editor-canvas.webp)

</Frame>

## Einen Connector-Schreibzugriff freigeben

Erreicht ein Live-Lauf einen Schreibzugriff, den deine Richtlinie abfängt, nimmt der Lauf in den [Ausführungsprotokollen](/de/platform/automations/execution-logs) den Status **Wartet** an, und seine Detailseite zeigt die Genehmigungskarte: **Wartet auf deine Freigabe**, die Operation als `<connector>.<aktion>`, die Node, die sie angefragt hat, und die exakte Eingabe unter **Der Schritt würde aufrufen mit**. **Freigeben** lässt den Schritt beim nächsten Poll handeln, und der Lauf setzt fort; **Ablehnen** lässt den Schritt fehlschlagen, und der Lauf stoppt. Testläufe parken hier nie — im Mock-Modus wird nichts außerhalb der Plattform berührt. Welche Schreibzugriffe fragen und wie du die Grenze verschiebst, steht auf [Genehmigungen konfigurieren](/de/platform/approvals/configure).

## Einen pausierten Lauf beantworten

Eine Agent-Node, die ohne dich nicht fertig wird, fragt: Der Lauf parkt als **Wartet**, und seine Detailseite zeigt die Frage — als Auswahl, wenn der Agent Optionen angeboten hat, sonst als Freitextfeld. Beantworte sie, und der Lauf setzt an der Node wieder ein, an der er stehen geblieben ist, mit deiner Antwort in der Hand, und arbeitet den Rest des Graphen ab; nichts, was eine abgeschlossene Node getan hat, passiert zweimal. Der Agent fragt über sein Tool `ask_human`, das jede Automation-Agent-Node trägt — die Pause ist also die Entscheidung des Agents, keine Node, die du platzierst.

## Eine Definition ändern und live schalten

Zwischen dir und der Definition steht in dieser Version keine Vorschlagskarte — kein KI-Editor auf dem Canvas, kein Chat-Agent, der eine Änderung für dich entwirft, die du dann genehmigst. Du änderst eine Definition, indem du Nodes auf dem Canvas bearbeitest und auf **Speichern** klickst, was eine Version mit deiner Notiz anhängt und jede frühere Version unangetastet lässt; **Testlauf** prüft sie gegen Mocks; und nichts läuft live, bevor du auf **Diese Version live schalten** klickst, was die eigenen Tests der Automatisierung absichern. Ein Modell, das eine Automatisierung verfasst, geht über den [MCP-Endpoint](/de/develop/mcp-endpoint) — `save_automation` hängt auf dieselbe Weise eine Version an, und `deploy_automation` ist derselbe ausdrückliche Schritt. [Der Workflow-Editor](/de/platform/automations/editor) geht die drei Schritte durch.

## Was jede Entscheidung hinterlässt

Beide Tore hinterlassen an zwei Orten eine Spur: in den Details des Laufs selbst, wo die Karte zu freigegeben oder abgelehnt wird und das Ergebnis des Schritts folgt, und im [Audit-Log](/de/platform/admin/governance/audit-logs), das festhält, wer wann entschieden hat. Eine entschiedene Karte lässt sich nicht wieder öffnen; ein abgelehnter Lauf ist vorbei, und die Automatisierung erneut laufen zu lassen ist ein frischer Lauf mit einer frischen Karte. Weil eine Entscheidung zu der Operation gehört, für die sie erbeten wurde, gibt eine danach gelockerte Richtlinie eine bereits wartende Karte nie frei. Endet ein Lauf, während seine Karte noch wartet — weil jemand ihn abbricht oder ein anderer Zweig fehlschlägt —, zieht er die Karte zurück: In den Details des Laufs steht sie als abgelehnt, denn die Schreiboperation, um die es ging, findet nicht mehr statt.

## Wo das hingehört

Ein Lauf wartet aus zwei Gründen auf einen Menschen — ein Schreibzugriff, der den Mandanten verlässt, und eine Frage, die nur ein Mensch beantworten kann —, und beide Wartestellen liegen auf der Detailseite des Laufs statt in einem Chat. [Genehmigungskonzepte](/de/platform/approvals/concepts) ist das Modell hinter dem Schreib-Tor, [Genehmigungen konfigurieren](/de/platform/approvals/configure) verschiebt die Grenze, und [Ausführungsprotokolle](/de/platform/automations/execution-logs) ist der Ort, an dem du den wartenden Lauf überhaupt erst findest.
