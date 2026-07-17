---
title: Einen Workflow mit Freigabe bauen
description: Lass den KI-Editor einen Drei-Schritt-Workflow bauen, bei dem eine menschliche Entscheidung zwischen Entwurf und Versand sitzt, genehmige seinen Vorschlag und lies danach das Journal des Laufs.
---

Ein Workflow mit einer menschlichen Entscheidung in der Mitte ist die Form, zu der du greifst, wenn die Arbeit aus Entwurf, Review und Aktion besteht — und du eine Person zwischen Entwurf und Aktion willst. Der Lauf pausiert als **Wartet auf Eingabe**, bis jemand antwortet; der nächste Schritt feuert nur bei grünem Licht. Dieser Spaziergang baut so einen Daily-Summary-Workflow, und unterwegs begegnest du beiden menschlichen Toren: dem Genehmigen des KI-Editor-Vorschlags und dem Beantworten des pausierten Laufs.

Du brauchst eine Editor-Rolle und einen Agent, der einen Entwurf produziert (der erste nützliche Agent aus [Deinen ersten Agent bauen](/de/tutorials/editor/first-agent-end-to-end) reicht). Die konzeptuelle Seite lebt in [Automatisierungskonzepte](/de/platform/automations/concepts) und [Genehmigungs-Konzepte](/de/platform/approvals/concepts); dieser Spaziergang ist der End-to-End-Mechanismus.

## Bevor du anfängst

Prüf drei Dinge. Deine Rolle ist mindestens Editor — Workflow-Bearbeitung ist ab Editor aufwärts freigeschaltet. Du hast einen Entwurfs-Agent bereit; ohne ihn hat der Entwurfs-Schritt nichts aufzurufen. Und du kannst das Review selbst beantworten — der pausierte Lauf wartet auf einen Menschen, und in diesem Spaziergang bist du das.

## Schritt 1 — Einen Workflow im Editor öffnen

Workflows leben in der Automatisierung, die sie antreiben: Öffne die Automatisierung, und ihr Tab **Editor** ist der Workflow, mit dem Schritt-Graphen auf der Leinwand. Öffne für diesen Spaziergang einen Workflow, der dir gehört, oder einen aus dem Task-Ops-Paket deiner Org — alles funktioniert, was du bearbeiten darfst, denn die neue Definition baut ohnehin der KI-Editor für dich.

## Schritt 2 — Dem KI-Editor den Workflow beschreiben

Schalte den **KI-Editor** in der Leinwand-Werkzeugleiste ein und beschreib die ganze Form in einer Nachricht:

> Lass jeden Werktag um 08:00 den Agent <dein Agent> die ungelesenen Kontaktnachrichten von gestern in einen Absatz zusammenfassen, dann einen Menschen den Entwurf prüfen, und schick nur den freigegebenen Text an den Team-Kanal.

Der KI-Editor antwortet mit einer Vorschlagskarte — **Workflow erstellen** mit der Schrittzahl, oder **Workflow aktualisieren**, wenn er den geöffneten umbaut. Solange die Karte aussteht, passiert an der Definition nichts: Klapp sie auf, prüf die gelisteten Schritte — ein **LLM**-Schritt für den Entwurf, die Review-Pause, der Versand — und genehmige sie. Die Änderung wird angewendet und versioniert wie jedes manuelle Speichern.

## Schritt 3 — Den Zeitplan anhängen

Wechsle zum Tab **Trigger** und klick **Zeitplan hinzufügen**. Nimm die Vorlage **Täglich** und pass den Cron auf Werktage an (`0 8 * * 1-5`) — oder beschreib die Zeit in Alltagssprache und klick **Generieren**, damit die KI den Cron schreibt. **Workflow-Variablen** füllt sich aus dem Eingabeschema des Workflows vor; lass es wie vorgeschlagen. Die Zeile erscheint mit bereits eingeschaltetem **Aktiv**-Schalter.

## Schritt 4 — Laufen lassen und das Review beantworten

Zurück im Editor: Öffne **Workflow testen**, füg das vorgeschlagene Eingabe-JSON ein und klick **Ausführen**. Das Panel spiegelt den Lauf Schritt für Schritt: Der Entwurfs-Schritt feuert, dann pausiert der Lauf — **Wartet auf Eingabe** — und das Review kommt als Formular-Karte mit dem Entwurf an. Füll sie aus und klick **Antwort absenden**, um freizugeben, oder **Anders antworten**, um im Freitext zurückzugeben; der Lauf setzt mit deiner Antwort fort und der Versand-Schritt feuert.

Öffne den Tab **Ausführungen** und klapp den Lauf auf: Das Journal zeigt einen Eintrag pro Schritt — den Entwurf des Agents, wer das Review beantwortet hat und wie, und den Versand mit seiner Ausgabe. Dieses Journal ist der Audit-Trail; derselbe Datensatz entsteht für jeden künftigen geplanten Lauf.

## Wo das hinführt

Entwerfen, entscheiden, handeln — mit der Entscheidung bei einem Menschen — ist der kleinste nützliche Workflow mit Freigabe, und du hast ihn gebaut, ohne einen einzigen Schritt von Hand zu setzen: Der KI-Editor hat vorgeschlagen, du hast genehmigt, der Lauf hat gefragt, du hast geantwortet. Dieselbe Form skaliert — häng ein zweites Review vor einen destruktiven Schritt, oder lass dir von [Genehmigungen in Workflows](/de/platform/automations/approvals-in-workflows) die übrigen Tore rund um einen Workflow zeigen. Für das Vokabular hinter Definition, Trigger und Ausführung ist [Automatisierungskonzepte](/de/platform/automations/concepts) die Seite, die dieser Spaziergang vorausgesetzt hat.
