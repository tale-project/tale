---
title: Genehmigungen in Workflows
description: Wo Menschen rund um Workflows entscheiden — Änderungen des KI-Editors an einer Definition genehmigen, die Anfrage eines Agents auf einen Workflow-Lauf genehmigen und die Fragen beantworten, die einen Lauf pausieren.
---

Workflows laufen ohne dich, aber sie ändern sich und starten nur mit dir. Drei menschliche Tore umgeben jeden Workflow: Die Änderungen des KI-Editors an einer Definition greifen erst nach deiner Genehmigung, ein Agent, der einen Workflow starten will, braucht zuerst dein Einverständnis, und ein Lauf, der auf eine Frage stößt, pausiert, bis jemand antwortet. Diese Seite behandelt die drei Tore; die organisationsweite Geschichte, was eine Genehmigungskarte ist, steht auf [Genehmigungskonzepte](/de/platform/approvals/concepts).

<Frame caption="Der KI-Editor neben der Leinwand — seine Änderungen kommen als Genehmigungskarten an, nie als stille Eingriffe in die Definition.">

![Der Workflow-Editor mit einem Schritt-Graphen auf der Leinwand und rechts dem geöffneten Panel des KI-Editors, in dem vorgeschlagene Workflow-Änderungen zur Genehmigung erscheinen.](/images/platform/automation-editor-canvas.webp)

</Frame>

## Änderungen an einer Definition genehmigen

Bitte den **KI-Editor**, einen Workflow zu bauen oder umzubauen, und sein Vorschlag landet als Karte im Panel — eine Karte **Workflow erstellen** mit der Schrittzahl für eine neue Definition oder eine Aktualisierungskarte mit einem Badge nach Umfang: **Schritt aktualisieren** für einen Einzelschritt-Patch, **{count} Schritte aktualisieren** für mehrere, **Workflow aktualisieren** für ein vollständiges Speichern. Genehmigst du, wendet Tale die Änderung an und versioniert sie wie jedes manuelle Speichern; **Abbrechen** verwirft sie. Nichts berührt die Definition, solange die Karte aussteht.

## Einen Lauf genehmigen

Ein Agent im Chat mit den Workflow-Tools kann darum bitten, einen Workflow zu starten. Die Anfrage kommt als Karte an, die den Workflow benennt — klappe **Parameter anzeigen** aus, um die genaue Eingabe zu prüfen, mit der er laufen wird — und hält, bis du auf **Workflow ausführen** oder **Abbrechen** klickst. Nach der Genehmigung verfolgt dieselbe Karte den laufenden Lauf: den aktuellen Schritt, die verstrichene Zeit und das Ergebnis, mit **Stopp** zum Abbrechen mitten im Flug und **Ausführungsdetails anzeigen** als Sprung ins Journal des Laufs.

<Note>

Der Chat-Composer ist blockiert, solange eine Anfrage aussteht — **Beantworte die ausstehende Anfrage oben, um fortzufahren**. Entscheide die Karte, bevor du die nächste Nachricht schickst.

</Note>

## Einen pausierten Lauf beantworten

Ein Lauf, der eine menschliche Antwort braucht, pausiert mit dem Status **Wartet auf Eingabe** in der [Ausführungsliste](/de/platform/automations/execution-logs). Die Frage kommt als Formularkarte an — fülle sie aus und klicke auf **Antwort absenden**, oder klicke auf **Anders antworten**, um in freiem Text zu widersprechen. Der Lauf setzt mit deiner Antwort als Eingabe des Schritts fort, und das Journal hält fest, wer geantwortet hat und was.

## Was jede Entscheidung hinterlässt

Jedes Tor löst sich in dieselben Zustände auf — **Ausstehend**, **Wird ausgeführt**, **Abgeschlossen** oder **Abgelehnt** — sichtbar auf der Karte selbst, und die Entscheidung landet im [Audit-Log](/de/platform/admin/governance/audit-logs) mit Akteur und Zeitstempel. Eine entschiedene Karte lässt sich nicht wieder öffnen; um einen abgelehnten Lauf erneut zu versuchen, frag noch einmal und entscheide die frische Karte.

## Wo das hingehört

Diese Tore sind die Workflow-Seite eines produktweiten Musters: Ein Agent schlägt vor, ein Mensch entscheidet. [Genehmigungskonzepte](/de/platform/approvals/concepts) benennt jeden Kartentyp jenseits von Workflows — Dokument-Schreibzugriffe, Wissens-Schreibzugriffe, Integrationsaufrufe — und [Genehmigungen konfigurieren](/de/platform/approvals/configure) zeigt, wo die Anforderungen deklariert sind.
