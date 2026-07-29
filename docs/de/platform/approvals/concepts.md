---
title: Genehmigungskonzepte
description: Eine Genehmigung ist eine Karte im Chat, die die Aktion eines Agents anhält, bis du entscheidest. Diese Seite benennt, was eine auslöst, welche Entscheidungen jede Karte bietet und was jede Entscheidung hinterlässt.
---

Eine Genehmigung ist die Naht zwischen der Initiative eines Agents und deinem Urteil: eine Karte, die im Chat dort erscheint, wo die Aktion versucht wurde, und die Aktion anhält, bis ein Mensch entscheidet. Agents schlagen vor — einen Dokument-Schreibzugriff, einen ausgehenden API-Aufruf, einen Workflow-Lauf — und nichts läuft, solange die Karte aussteht. Der Chat sagt es ausdrücklich: **Beantworte die ausstehende Anfrage oben, um fortzufahren**.

Diese Seite ist das Denkmodell — was eine Genehmigung auslöst, was die Karte bietet und was eine Entscheidung hinterlässt. Die Workflow-spezifischen Tore stehen auf [Genehmigungen in Workflows](/de/platform/automations/approvals-in-workflows); wo die Anforderungen deklariert werden, steht auf [Genehmigungen konfigurieren](/de/platform/approvals/configure).

## Was eine Genehmigung auslöst

Jede Karte stammt von einem Agent, der auf etwas wirken will, das das Gespräch überdauert:

- **Pläne** — ein Agent schlägt einen mehrstufigen Plan als Karte **Vorgeschlagener Plan** vor; **Genehmigen & ausführen** startet ihn.
- **Dokument-Schreibzugriffe** — eine Karte **In Dokumenten speichern** hält Dateien, die ein Agent ablegen will; nichts landet im Dokumenten-Hub, bevor du genehmigst.
- **Wissens-Schreibzugriffe** — eine Karte **In Wissensdatenbank speichern** hält einen Fakt, den ein Agent organisationsweit festhalten will.
- **Connector-Aufrufe** — eine Operation mit Genehmigungspflicht (typischerweise ausgehende Schreibzugriffe) hält an, mit den exakten Parametern sichtbar.
- **MCP-Tools** — ein Tool, das der Server mit **Genehmigung erforderlich** markiert, fragt, bevor es läuft.
- **Workflow-Erstellung, -Aktualisierungen und -Läufe** — die Tore auf der Workflow-Seite, behandelt in [Genehmigungen in Workflows](/de/platform/automations/approvals-in-workflows).

## Die Entscheidungen auf einer Karte

Jede Karte trägt den exakten Payload der Aktion — die Datei, den Fakt, die Parameter — und zwei Entscheidungen: genehmigen (der Button benennt die Aktion, etwa **Workflow ausführen** oder **Genehmigen & ausführen**) oder ablehnen. Connectorskarten fügen einen dritten Weg hinzu, **Änderungen vorschlagen**: Beschreib in freiem Text, was falsch ist, und der Agent überarbeitet den Aufruf, statt ihn aufzugeben.

<Note>

Genehmigungen werden in dem Gespräch entschieden, das sie unterbrechen — von der Person, die diesen Chat führt. Es gibt keinen separaten Genehmigungs-Posteingang und kein Routing an einen Genehmiger-Pool; die Person, für die der Agent arbeitet, ist die Person, die entscheidet.

</Note>

## Zustände und die Spur

Eine Karte wandert von **Ausstehend** über **Wird ausgeführt** zu **Abgeschlossen** — oder **Abgelehnt** — und behält ihren entschiedenen Zustand im Transkript, sodass sich ein Chat als Protokoll dessen wiederliest, was erlaubt wurde. Jede Entscheidung landet außerdem im [Audit-Log](/de/platform/admin/governance/audit-logs) mit Akteur, Aktion und Zeitstempel. Entschiedene Karten lassen sich nicht wieder öffnen; ein neuer Versuch heißt ein frischer Vorschlag und eine frische Karte.

## Wo das hingehört

Genehmigungen sind das, was dich Agents echte Fähigkeiten anvertrauen lässt — Dateien, APIs, Workflows — ohne das Protokoll aus der Hand zu geben, wer was erlaubt hat. Lies als Nächstes [Genehmigungen konfigurieren](/de/platform/approvals/configure), um zu sehen, wo eine Anforderung eingeschaltet wird, und [Genehmigungen in Workflows](/de/platform/automations/approvals-in-workflows) für die Tore rund um Workflows.
