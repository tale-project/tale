---
title: Genehmigungskonzepte
description: Eine Genehmigung ist ein geparkter Schritt in einem laufenden Automatisierungslauf — ein Connector-Schreibzugriff, der auf der Detailseite des Laufs wartet, bis ein Mensch ihn freigibt oder ablehnt. Diese Seite benennt, was eine auslöst, welche Entscheidung sie bietet und was sie hinterlässt.
---

Eine Genehmigung ist die Naht zwischen der Initiative einer Automatisierung und deinem Urteil. Erreicht ein Live-Lauf einen Connector-Schreibzugriff, den die Richtlinie deiner Organisation abfängt — Mail senden, eine Nachricht posten, ein Issue öffnen —, läuft der Schritt nicht: Der Lauf parkt, und seine Detailseite zeigt eine Karte mit der Operation und der exakten Eingabe, mit der der Schritt aufrufen würde, bis ein Mensch entscheidet. Solange die Karte aussteht, geht nichts hinaus, und ein abgelehnter Schritt lässt den Lauf fehlschlagen, statt hinter deinem Rücken einen neuen Versuch zu starten.

Diese Seite ist das Denkmodell — was eine Genehmigung auslöst, wo sie erscheint und was eine Entscheidung hinterlässt. Wo die Anforderung deklariert wird, steht auf [Genehmigungen konfigurieren](/de/platform/approvals/configure); der andere Ort, an dem ein Lauf auf einen Menschen wartet — die Frage, die eine Agent-Node mitten im Lauf stellt —, steht auf [Genehmigungen in Workflows](/de/platform/automations/approvals-in-workflows).

## Was eine Genehmigung auslöst

Genau eines: ein **Connector-Schreibzugriff in einem Live-Lauf**, für den die Genehmigungsrichtlinie eine Entscheidung verlangt. Die Standardgrenze ist, ob der Schreibzugriff deinen Mandanten verlässt — Mail, Slack, GitHub und WebDAV fragen; eine verschobene Aufgabe oder ein auf Tales eigener Oberfläche abgelegtes Dokument nicht —, und `governance/approval-policy.yml` verschiebt diese Grenze pro Connector oder pro Aktion. Lesezugriffe fragen nie. Testläufe fragen ebenfalls nie: Im Mock-Modus liefern Connectors Platzhalter, und nichts außerhalb der Plattform wird berührt.

Nichts sonst erzeugt in dieser Version eine Genehmigungskarte. Der Chat-Assistent kann nirgends schreiben — seine drei Tools suchen und laden —, also gibt es keine Karte im Chat; die Connector-Aufrufe eines Projekt-Agents laufen nur lesend über seinen Broker, ein Aufgabenlauf erreicht das Tor also nie; und es gibt kein Genehmigungs-Flag pro Tool auf einem MCP-Server, weil ausgehende MCP-Server nicht Teil dieser Version sind.

## Die Entscheidung auf der Karte

Öffne den Lauf — aus der Liste der Läufe der Automatisierung, wo er als **Wartet** steht —, und die Karte liest sich **Wartet auf deine Freigabe**, nennt die Operation als `<connector>.<aktion>` und die Node, die sie angefragt hat, und zeigt die Eingabe unter **Der Schritt würde aufrufen mit**. Zwei Entscheidungen: **Freigeben** lässt den geparkten Schritt beim nächsten Poll handeln, und der Lauf setzt fort; **Ablehnen** lässt den Schritt fehlschlagen und stoppt den Lauf. Einen dritten Weg gibt es nicht — du kannst die Parameter nicht bearbeiten und die Automatisierung nicht bitten, den Aufruf zu überarbeiten; ein falscher Aufruf wird abgelehnt, und die Definition wird auf dem Canvas korrigiert.

<Note>

Genehmigungen haben in dieser Version keinen Posteingang. Die Karte lebt auf der Detailseite des Laufs, und wer diese Seite öffnen kann, entscheidet — es gibt kein Routing an einen Genehmiger-Pool und keine persönliche Warteschlange. Die eine Entscheidung, die einen Admin verlangt, ist die zweite Unterschrift unter einer Löschanfrage, behandelt in [Anfragen betroffener Personen](/de/platform/admin/governance/data-subject-requests).

</Note>

## Zustände und die Spur

Eine Karte wandert von ausstehend zu in Ausführung, wenn sie freigegeben wird — der Schritt handelt beim nächsten Poll, und der Datensatz landet bei abgeschlossen — oder zu abgelehnt. Die Entscheidung gehört zu der Operation, für die sie erbeten wurde: Eine danach gelockerte Richtlinie gibt eine bereits wartende Karte nicht frei, und ein Lauf, der dieselbe Operation erneut erreicht, liest dieselbe Antwort, statt zweimal zu fragen. Jede Entscheidung landet im [Audit-Log](/de/platform/admin/governance/audit-logs) mit Akteur und Zeitstempel, und der Lauf behält das Ergebnis in seinen eigenen Details. Eine entschiedene Karte lässt sich nicht wieder öffnen — ein abgelehnter Lauf ist vorbei, und der neue Versuch ist ein frischer Lauf.

## Wo das hingehört

Genehmigungen sind der Weg, auf dem eine Automatisierung fremde Systeme erreicht, ohne allein zu handeln: Der Schreibzugriff wartet, ein Mensch liest den exakten Aufruf, und das Protokoll sagt, wer was erlaubt hat. Lies [Genehmigungen konfigurieren](/de/platform/approvals/configure), um zu sehen, wo die Grenze zwischen Fragen und Nicht-Fragen verläuft, und [Genehmigungen in Workflows](/de/platform/automations/approvals-in-workflows) für den anderen Ort, an dem ein Lauf auf einen Menschen wartet.
