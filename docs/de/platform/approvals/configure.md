---
title: Genehmigungen konfigurieren
description: Wo Genehmigungspflichten deklariert werden — pro Integrations-Operation, pro MCP-Tool und eingebaut für Schreibzugriffe und Workflow-Änderungen — und wo du siehst, was vor dem Ausführen fragt.
---

Genehmigungspflichten sind in Tale deklarativ: Jede Fähigkeit trägt ihr eigenes Flag, das sagt, ob ein Agent zuerst fragen muss, und das Flag reist mit der Integration oder dem Server, der die Fähigkeit bereitstellt. Es gibt keine zentrale Regeltabelle zu pflegen — diese Seite zeigt, wo jedes Flag lebt und wie du abliest, was vor dem Ausführen fragen wird.

Das Modell, was eine Genehmigungskarte ist und wer sie entscheidet, steht auf [Genehmigungskonzepte](/de/platform/approvals/concepts). Was folgt, ist die Konfigurationsoberfläche, Fähigkeit für Fähigkeit.

## Integrations-Operationen

Jede Integration deklariert ihre Operationen, und jede Operation trägt ihr eigenes Genehmigungs-Flag. Öffne **Einstellungen > Integrationen**, klicke auf eine Integration, und ihre Operationsliste kennzeichnet die als **Genehmigung erforderlich** markierten — bei den mitgelieferten Konnektoren ist das die Schreibseite: Mail senden, Nachrichten posten, Issues erstellen. Lesezugriffe laufen ohne Karte; markierte Schreibzugriffe halten im Chat mit ihren exakten Parametern, bis jemand genehmigt.

Das Flag ist keine separate Einstellung, die ein Admin umlegt. Jede Aktion, die ein Connector deklariert, trägt einen Effekt — `read` oder `write` —, und die Schreibseite ist das, was die Genehmigungsrichtlinie abfängt. Das hält beide ehrlich zueinander: Eine Aktion kann sich nicht klammheimlich von einem Lese- in einen Schreibzugriff verwandeln, ohne auch zu ändern, wofür sie fragen muss.

## MCP-Tools

Das Manifest eines MCP-Servers markiert, welche seiner Tools ein Einverständnis brauchen. Öffne **Einstellungen > API > MCP**, klappe einen Server aus, und seine Liste **Erkannte Tools** kennzeichnet jedes markierte Tool mit **Genehmigung erforderlich** — diese fragen im Chat bei jedem Aufruf durch einen Agent. Das Flag stammt vom Autor des Servers; einen Server zu verbinden heißt, seinen Tool-Vertrag anzunehmen — lies die Liste also, bevor du einen aktivierst. [MCP-Server](/de/platform/integrations/mcp-servers) behandelt die Registrierung.

## Eingebaute Schreib-Tore

Einige Tore sind ab Werk an und nicht konfigurierbar, weil die Aktion ihrer Natur nach folgenreich ist:

- **Dokument-Schreibzugriffe** — ein Agent, der Dateien im Dokumenten-Hub ablegt, fragt immer (**In Dokumenten speichern**).
- **Wissens-Schreibzugriffe** — ein Agent, der einen organisationsweiten Fakt speichert, fragt immer (**In Wissensdatenbank speichern**).
- **Workflow-Erstellung, -Aktualisierungen und -Läufe** — ein Agent, der einen Workflow baut, bearbeitet oder startet, fragt immer; siehe [Genehmigungen in Workflows](/de/platform/automations/approvals-in-workflows).

<Note>

Der Hebel dafür ist nicht das Genehmigungs-Flag, sondern die Fähigkeit selbst: Ein Agent ohne Dokument- oder Workflow-Tools produziert die Karte gar nicht erst. Beschneide das [Tool-Set](/de/platform/agents/tools) des Agents, um die Fähigkeit ganz zu entfernen.

</Note>

## Prüfen, was fragen wird

Bevor du einen Agent vor echte Systeme stellst, lies seine Fähigkeiten wie ein Genehmiger: die Operationsliste der Integration auf markierte Schreibzugriffe, die **Erkannte Tools** des MCP-Servers auf markierte Tools und den Tool-Tab des Agents darauf, ob er überhaupt Schreib-Tools hält. Das [Audit-Log](/de/platform/admin/governance/audit-logs) protokolliert anschließend jede Entscheidung, die dieses Setup produziert.

## Wo das hingehört

Konfiguration ist hier Verteilung — die Flags leben bei den Integrationen und Servern, denen die Fähigkeiten gehören. Lies [Genehmigungskonzepte](/de/platform/approvals/concepts) für den Kartenlebenszyklus, den diese Flags produzieren, und [Agent-Tools](/de/platform/agents/tools) für die Fähigkeitsseite derselben Grenze.
