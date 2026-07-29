---
title: Genehmigungen in Workflows
description: Wo Menschen rund um Workflows entscheiden — Änderungen des KI-Editors an einer Definition genehmigen, die Anfrage eines Agents auf einen Workflow-Lauf genehmigen und die Fragen beantworten, die einen Lauf pausieren.
---

Workflows laufen ohne dich, aber sie ändern sich und starten nur mit dir. Drei menschliche Tore umgeben jeden Workflow: Die Änderungen des KI-Editors an einer Definition greifen erst nach deiner Genehmigung, ein Agent, der einen Workflow starten will, braucht zuerst dein Einverständnis, und ein Lauf, der auf eine Frage stößt, pausiert, bis jemand antwortet. Diese Seite behandelt die drei Tore; die organisationsweite Geschichte, was eine Genehmigungskarte ist, steht auf [Genehmigungskonzepte](/de/platform/approvals/concepts).

<Frame caption="Der Canvas einer Automatisierung mit dem Panel daneben — eine vorgeschlagene Änderung kommt als Genehmigungskarte an und greift nie still ins Dokument ein.">

![Der Workflow-Canvas einer Automatisierung mit einem Graphen aus Nodes und einem geöffneten Panel daneben.](/images/platform/automation-editor-canvas.webp)

</Frame>

## Änderungen an einer Definition genehmigen

Bitte den Assistenten, eine Automatisierung zu bauen oder umzubauen, und sein Vorschlag landet als Karte statt als Änderung. Die Karte benennt, was sie tun würde — eine neue Automatisierung anlegen, eine einzelne Node anpassen oder das ganze Dokument ersetzen — und hält, bis du entscheidest. Genehmigst du sie, wird das Ergebnis als neue Version gespeichert, genau wie bei einem manuellen Speichern: Das Dokument, das du angesehen hast, bleibt unangetastet, und die live geschaltete Version bleibt live, bis jemand live schaltet. Abbrechen verwirft den Vorschlag, und solange die Karte aussteht, erreicht nichts das Dokument.

## Einen Lauf genehmigen

Ein Agent im Chat, der die Automatisierungs-Tools hält, kann darum bitten, eine zu starten. Die Anfrage kommt als Karte an, die die Automatisierung benennt, und du kannst sie ausklappen, um vor der Entscheidung genau die Eingabe zu prüfen, mit der sie laufen würde. Nach der Genehmigung verfolgt dieselbe Karte den laufenden Lauf — an welcher Node er ist, wie lange er schon läuft und wie er geendet hat — und lässt dich ihn mitten im Flug stoppen oder den Lauf selbst für die vollständigen Details pro Node öffnen.

<Note>

Der Chat hält an, solange eine Anfrage aussteht, und sagt dir das auch. Entscheide die Karte, bevor du die nächste Nachricht schickst.

</Note>

## Einen pausierten Lauf beantworten

Ein Lauf, der eine menschliche Antwort braucht, nimmt in der [Liste der Läufe](/de/platform/automations/execution-logs) den Status **Wartet** an und parkt dort. Die Frage kommt als Formularkarte an — fülle sie aus und schick sie ab, oder widersprich in freiem Text, wenn das Formular nicht das Richtige fragt. Antworten startet nichts neu: Der Lauf setzt an genau der Node wieder ein, an der er stehen geblieben ist, trägt deine Antwort als deren Eingabe weiter und arbeitet den Rest des Graphen ab. Jede bereits abgeschlossene Node bleibt abgeschlossen, nichts von vorher passiert also zweimal.

## Was jede Entscheidung hinterlässt

Jedes Tor durchläuft auf der Karte selbst dieselbe Handvoll Zustände — ausstehend, dann in Ausführung, dann abgeschlossen oder abgelehnt —, und die Entscheidung landet im [Audit-Log](/de/platform/admin/governance/audit-logs) mit Akteur und Zeitstempel. Eine entschiedene Karte lässt sich nicht wieder öffnen; um einen abgelehnten Lauf erneut zu versuchen, frag noch einmal und entscheide die frische Karte. Eine Genehmigung, die einen Lauf gestartet hat, hinterlässt diesen Lauf als eigenen Datensatz — was die Entscheidung tatsächlich bewirkt hat, bleibt also in der [Liste der Läufe](/de/platform/automations/execution-logs) lesbar, lange nachdem die Karte weg ist.

## Wo das hingehört

Diese Tore sind die Workflow-Seite eines produktweiten Musters: Ein Agent schlägt vor, ein Mensch entscheidet. [Genehmigungskonzepte](/de/platform/approvals/concepts) benennt jeden Kartentyp jenseits von Workflows — Dokument-Schreibzugriffe, Wissens-Schreibzugriffe, Connector-Aufrufe — und [Genehmigungen konfigurieren](/de/platform/approvals/configure) zeigt, wo die Anforderungen deklariert sind.
