---
title: Genehmigungen konfigurieren
description: Wo Genehmigungspflichten deklariert werden — pro Connector-Operation, pro MCP-Tool und eingebaut für Schreibzugriffe und Workflow-Änderungen — und wo du siehst, was vor dem Ausführen fragt.
---

Genehmigungspflichten sind in Tale deklarativ: Jede Fähigkeit trägt ihr eigenes Flag, das sagt, ob ein Agent zuerst fragen muss, und das Flag reist mit der Connector oder dem Server, der die Fähigkeit bereitstellt. Damit die Voreinstellung stimmt, musst du nichts konfigurieren — diese Seite zeigt, wo jedes Flag lebt, welche Schreibzugriffe von sich aus fragen und wie du das für deine Organisation änderst.

Das Modell, was eine Genehmigungskarte ist und wer sie entscheidet, steht auf [Genehmigungskonzepte](/de/platform/approvals/concepts). Was folgt, ist die Konfigurationsoberfläche, Fähigkeit für Fähigkeit.

## Connector-Operationen

Jede Connector deklariert ihre Operationen, und jede Operation trägt ihr eigenes Genehmigungs-Flag — bei den mitgelieferten Konnektoren ist das die Schreibseite: Mail senden, Nachrichten posten, Issues erstellen. Lesezugriffe laufen ohne Karte; markierte Schreibzugriffe halten im Chat mit ihren exakten Parametern, bis jemand genehmigt.

Das Flag ist keine separate Einstellung, die ein Admin umlegt. Jede Aktion, die ein Connector deklariert, trägt einen Effekt — `read` oder `write` —, und die Schreibseite ist das, was die Genehmigungsrichtlinie abfängt. Das hält beide ehrlich zueinander: Eine Aktion kann sich nicht klammheimlich von einem Lese- in einen Schreibzugriff verwandeln, ohne auch zu ändern, wofür sie fragen muss.

## Welche Schreibzugriffe fragen

Eine Karte ist die Aufmerksamkeit eines Menschen wert, wenn der Schreibzugriff **deinen Mandanten verlässt**. Genau dort liegt die Grenze:

- **Schreibzugriffe in fremde Systeme fragen** — Mail senden, in Slack posten, ein GitHub-Issue öffnen, auf eine WebDAV-Ablage schreiben. Diese Connectors halten deine Zugangsdaten und handeln in Systemen, die Tale nicht gehören.
- **Schreibzugriffe auf Tales eigener Oberfläche fragen nicht** — eine Aufgabe verschieben, sie kommentieren, ein Dokument im Projekt ablegen, ein Skript in deiner eigenen Sandbox laufen lassen. Sie sind schon durch die Rechte dessen gebunden, der sie ausführt, eine Automatisierung dahinter hat ihr Deploy-Gate passiert, und jeder davon steht im Trace des Laufs und im Audit-Log.

Ohne diese Grenze stapelt ein einzelner Automatisierungslauf ein halbes Dutzend Karten für seine eigene Buchführung — „diese Karte auf In Bearbeitung setzen" — und begräbt darunter die eine Karte, die wirklich einen Menschen brauchte.

## Die Grenze für deine Organisation verschieben

Beide Richtungen sind pro Organisation konfigurierbar, in `governance/approval-policy.yml` in deinem Konfigurationsverzeichnis. Jede Regel nennt **ein** Ziel — einen ganzen Connector oder eine einzelne Aktion als `<connector>.<aktion>` — und die spezifischere Regel gewinnt:

```yaml
rules:
  # Dieses Team prüft jede Aufgabe, die der Desk anfasst.
  - connector: task
    decision: require_approval
  # Der nächtliche Report-Mail wird vertraut; andere Mail-Aktionen fragen weiter.
  - action: imap-smtp.send
    decision: auto_approve
```

Eine Operation, die schon auf einer Karte wartet, behält ihre Karte auch dann, wenn die Richtlinie danach gelockert wird — eine Entscheidung gehört zu der Operation, für die sie erbeten wurde, und ein geparkter Lauf bleibt so nie hängen.

## MCP-Tools

Das Manifest eines MCP-Servers markiert, welche seiner Tools ein Einverständnis brauchen — diese fragen im Chat bei jedem Aufruf durch einen Agent. Das Flag stammt vom Autor des Servers; einen Server zu verbinden heißt, seinen Tool-Vertrag anzunehmen — lies seine Tool-Liste also, bevor du einen anbindest. [MCP-Server](/de/platform/connectors/mcp-servers) behandelt, wie Server deine Agents erreichen.

## Eingebaute Schreib-Tore

Einige Tore sind ab Werk an und nicht konfigurierbar, weil die Aktion ihrer Natur nach folgenreich ist:

- **Dokument-Schreibzugriffe** — ein Agent, der Dateien im Dokumenten-Hub ablegt, fragt immer (**In Dokumenten speichern**).
- **Wissens-Schreibzugriffe** — ein Agent, der einen organisationsweiten Fakt speichert, fragt immer (**In Wissensdatenbank speichern**).
- **Workflow-Erstellung, -Aktualisierungen und -Läufe** — ein Agent, der einen Workflow baut, bearbeitet oder startet, fragt immer; siehe [Genehmigungen in Workflows](/de/platform/automations/approvals-in-workflows).

<Note>

Der Hebel dafür ist nicht das Genehmigungs-Flag, sondern die Fähigkeit selbst: Ein Agent ohne Dokument- oder Workflow-Tools produziert die Karte gar nicht erst. Beschneide das [Tool-Set](/de/platform/agents/tools) des Agents, um die Fähigkeit ganz zu entfernen.

</Note>

## Prüfen, was fragen wird

Bevor du einen Agent vor echte Systeme stellst, lies seine Fähigkeiten wie ein Genehmiger: welche Schreib-Aktionen seine Connectoren deklarieren, welche Tools seine MCP-Server markieren, und ob der Agent überhaupt Schreib-Tools hält. Das [Audit-Log](/de/platform/admin/governance/audit-logs) protokolliert anschließend jede Entscheidung, die dieses Setup produziert.

## Wo das hingehört

Konfiguration ist hier Verteilung — die Flags leben bei den Connectors und Servern, denen die Fähigkeiten gehören. Lies [Genehmigungskonzepte](/de/platform/approvals/concepts) für den Kartenlebenszyklus, den diese Flags produzieren, und [Agent-Tools](/de/platform/agents/tools) für die Fähigkeitsseite derselben Grenze.
