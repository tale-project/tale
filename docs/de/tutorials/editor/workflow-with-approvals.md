---
title: Einen Workflow mit Freigabe bauen
description: Den KI-Editor und seine Vorschlagskarte gibt es in dieser Version nicht — einen Workflow mit menschlicher Entscheidung baust du auf dem Canvas, und der Lauf wartet auf diese Entscheidung auf seiner Detailseite.
---

Dieses Tutorial schaltete einmal einen **KI-Editor** in der Werkzeugleiste des Canvas ein, beschrieb einen Drei-Schritt-Workflow in einer Nachricht, genehmigte die Vorschlagskarte, mit der er antwortete, und beantwortete danach den pausierten Lauf. Den KI-Editor gibt es in dieser Version von Tale nicht — der Canvas hat kein Assistenten-Panel, und keine Karte schlägt dir eine Definition zur Genehmigung vor. Die menschliche Entscheidung mitten im Lauf gibt es sehr wohl; sie kommt aus dem Lauf selbst, nicht aus einer Karte in einem Editor.

<Note>

Der KI-Editor ist in dieser Version nicht verfügbar. Du baust die Definition auf dem Canvas und speicherst sie selbst als Version, oder du lässt sie ein Modell über den [MCP-Endpoint](/de/develop/mcp-endpoint) verfassen; den ausgehenden Schritt entscheidet zur Laufzeit weiterhin ein Mensch.

</Note>

## Heute einen Menschen zwischen Entwurf und Versand setzen

Bau die Form von Hand auf dem Canvas: eine **Agent**-Node, die die Zusammenfassung entwirft, dann eine Connector-Node, die sie versendet. Für die Entscheidung brauchst du nichts Zusätzliches — ein Connector-Schreibzugriff, der deinen Mandanten verlässt, etwa Mail senden oder in einen Kanal posten, parkt den Live-Lauf von sich aus. Der Lauf steht als **Wartet** in der Liste der Läufe, seine Detailseite zeigt **Wartet auf deine Freigabe** mit der exakten Nachricht, die der Schritt senden würde, und **Freigeben** gibt sie frei, während **Ablehnen** den Lauf stoppt. Ein Zeitplan auf der eigenen Seite der Automatisierung lässt sie jeden Werktagmorgen laufen, und **Testlauf** prüft den Graphen gegen Mocks, ohne etwas zu senden. [Der Workflow-Editor](/de/platform/automations/editor) geht Canvas, Speichern und Live-Schalten durch; [Automatisierungs-Trigger](/de/platform/automations/triggers) behandelt den Zeitplan.

Soll die Entscheidung den Entwurf statt den Versand betreffen, lass den Agent fragen: Eine Automation-Agent-Node trägt ein Tool `ask_human`, und ein Lauf, der es aufruft, parkt als **Wartet** mit der Frage auf seiner Detailseite, bis du antwortest, und setzt dann an dieser Node mit deiner Antwort fort. [Genehmigungen in Workflows](/de/platform/automations/approvals-in-workflows) behandelt beide Tore.

## Wo das hinführt

Die Form, die dieses Tutorial versprach — entwerfen, entscheiden, handeln —, ist die Form, die ein Lauf in dieser Version von sich aus annimmt: Der ausgehende Schreibzugriff fragt, ein Mensch liest den exakten Aufruf, und das Protokoll sagt, wer ihn erlaubt hat. [Automatisierungskonzepte](/de/platform/automations/concepts) ist das Vokabular hinter Definition, Trigger und Lauf; [Genehmigungskonzepte](/de/platform/approvals/concepts) ist das Modell hinter dem Warten.
