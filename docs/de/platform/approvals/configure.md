---
title: Genehmigungen konfigurieren
description: Wo Genehmigungspflichten deklariert werden — pro Connector-Operation, mit einer Richtliniendatei pro Organisation, die die Grenze verschiebt — und welche menschlichen Tore außerhalb dieser Richtlinie liegen.
---

Genehmigungspflichten sind in Tale deklarativ: Jede Fähigkeit trägt ihr eigenes Flag, das sagt, ob ein Lauf zuerst fragen muss, und das Flag reist mit dem Connector, der die Fähigkeit bereitstellt. Damit die Voreinstellung stimmt, musst du nichts konfigurieren — diese Seite zeigt, wo jedes Flag lebt, welche Schreibzugriffe von sich aus fragen und wie du das für deine Organisation änderst.

Das Modell, was eine Genehmigungskarte ist und wer sie entscheidet, steht auf [Genehmigungskonzepte](/de/platform/approvals/concepts). Was folgt, ist die Konfigurationsoberfläche, Fähigkeit für Fähigkeit.

## Connector-Operationen

Jede Connector deklariert ihre Operationen, und jede Operation trägt ihr eigenes Genehmigungs-Flag — bei den mitgelieferten Konnektoren ist das die Schreibseite: Mail senden, Nachrichten posten, Issues erstellen. Lesezugriffe laufen ohne Karte; ein markierter Schreibzugriff parkt den Automatisierungslauf, und die Detailseite des Laufs zeigt die Operation mit ihren exakten Parametern, bis jemand entscheidet.

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

Externe MCP-Server — und die Genehmigungs-Flags pro Tool, die ihre Manifeste einmal trugen — gibt es in dieser Version nicht: Es gibt keinen Server zu verbinden und keine Tool-Liste zu prüfen. Die einzige MCP-Oberfläche ist der eingehende Endpoint unter **Einstellungen > API > MCP**, an dem dein Client Tale steuert, und eine Connector-Aktion, die darüber aufgerufen wird, unterliegt denselben Genehmigungsregeln wie überall sonst — eine abgefangene Aktion antwortet mit einer ausstehenden Genehmigung, statt zu laufen. [MCP-Endpoint](/de/develop/mcp-endpoint) behandelt die Tools und was der Schlüssel jeder Rolle darf; [MCP-Server](/de/platform/connectors/mcp-servers) sagt, was an die Stelle des Registrierungsformulars getreten ist.

## Tore außerhalb dieser Richtlinie

Drei menschliche Tore im Produkt sind keine Sache der Genehmigungsrichtlinie und lassen sich hier nicht abschalten, weil jedes seine eigene Tür hat:

- **Agent-Arbeit in Prüfung** — ein Projekt-Agent schließt eine Aufgabe nie ab; sein Ergebnis parkt in **In Prüfung**, bis ein Mensch es abnimmt, und [Aufgaben-Automatisierung](/de/platform/projects/task-automation) behandelt, wer das darf.
- **Kontrollierte Dokumente** — eine als kontrolliert markierte Datei durchläuft einen Lebenszyklus aus Einreichen, Prüfen und Freigeben mit einer benannten Prüfperson; [Dokumente](/de/platform/knowledge/documents) behandelt ihn.
- **Löschanfragen** — eine DSGVO-Löschung braucht die Freigabe eines zweiten Admins, bevor die Kaskade läuft; [Anfragen betroffener Personen](/de/platform/admin/governance/data-subject-requests) behandelt sie.

<Note>

Der Chat-Assistent erzeugt keinerlei Genehmigung: Seine Tools sind nur lesend, es gibt also keine Dokument-Schreib-Karte, keine Wissens-Schreib-Karte und keine Workflow-Karte in einem Chat. Ein Lauf, der eine Antwort statt einer Erlaubnis braucht — eine Agent-Node, die eine Frage stellt —, ist ein Lauf im Status **Wartet**, behandelt in [Genehmigungen in Workflows](/de/platform/automations/approvals-in-workflows).

</Note>

## Prüfen, was fragen wird

Bevor du eine Automatisierung gegen echte Systeme live schaltest, lies ihre Connector-Nodes wie ein Genehmiger: Welche davon schreiben, und welche davon gibt deine Richtlinie automatisch frei. **Testlauf** zeigt dir den Graphen, ohne irgendetwas anzufassen — der Mock-Modus fragt nie —, und das [Audit-Log](/de/platform/admin/governance/audit-logs) protokolliert anschließend jede Entscheidung, die die Live-Läufe produzieren.

## Wo das hingehört

Konfiguration ist hier Verteilung — die Flags leben bei den Connectors, denen die Fähigkeiten gehören, und eine Richtliniendatei pro Organisation verschiebt die Grenze. Lies [Genehmigungskonzepte](/de/platform/approvals/concepts) für die Karte, die diese Flags produzieren, und [Genehmigungen in Workflows](/de/platform/automations/approvals-in-workflows) dafür, wo der geparkte Lauf wartet.
