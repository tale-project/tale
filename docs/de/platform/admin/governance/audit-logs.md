---
title: Audit-Logs
description: Das chronologische Protokoll von wer-was-getan-hat in deiner Organisation — Anmeldungen, Rollenänderungen, Anbieter-Bearbeitungen, Agent-Bearbeitungen, Run-code-Aufrufe. Admins und Inhaber lesen das, wenn ein Audit fragt, wer eine Ressource wann angefasst hat.
---

Das Audit-Log ist die unveränderliche Aufzeichnung jeder folgenreichen Aktion in deiner Organisation. Jede Anmeldung, Rollenänderung, Anbieter-Bearbeitung, Agent-Speicherung, Workflow-Ausführung und jeder Sandbox-Aufruf landet hier mit Akteur, Ressource, Vorher-/Nachher-Status und Zeitstempel. Admins und Inhaber lesen das, wenn ein Audit fragt, wer eine Ressource wann angefasst hat, wenn ein Compliance-Officer einen Export braucht, oder wenn etwas schiefläuft und die Frage ist _wer hat um 03:14 was geändert_.

Diese Seite ist die Referenz für die Spalten, die Filter, die Kategorien und die Exportformate. Das Aufbewahrungsfenster für Audit-Zeilen wird im selben Governance-Bereich unter der Aufbewahrungsrichtlinie gesetzt — halte es lang genug, damit deine Compliance-Anforderungen erfüllt sind, bevor Zeilen ausgesteuert werden.

## Ein durchgespielter Filter

Um den Moment zu finden, in dem die Rolle eines Mitglieds geändert wurde, öffne **Einstellungen > Governance > Audit-Logs**, setze den Filter **Kategorie** auf **Mitglied** und suche nach Akteur oder Ziel über den Namen. Jede Zeile öffnet die volle Payload — vorheriger Status, neuer Status, die IP, wenn die Anfrage über das Netz kam, der Akteurstyp (Benutzer, System, API, Workflow). Exportiere die gefilterte Auswahl über die Symbolleiste über der Tabelle als CSV oder JSON.

## Die Spalten

| Name             | Typ      | Pflicht | Beschreibung                                                                                |
| ---------------- | -------- | ------- | ------------------------------------------------------------------------------------------- |
| Zeitstempel      | ISO 8601 | ja      | Serverzeit, zu der die Aktion committet wurde.                                              |
| Aktion           | string   | ja      | Die semantische Aktion — `update_member_role`, `provider_created`, `agent_saved`.           |
| Benutzer         | string   | ja      | Anzeigename des Akteurs; `System`, `API` oder `Workflow`, wenn der Akteur keine Person ist. |
| Ressource        | string   | ja      | Die berührte Ressource — `agent`, `provider`, `member`, `workflow`.                         |
| Kategorie        | enum     | ja      | Auth, Mitglied, Daten, Integration, Workflow, Sicherheit, Admin, AI, Skill, Agent.          |
| Status           | enum     | ja      | Erfolg, Fehlschlag, Verweigert.                                                             |
| Geänderte Felder | JSON     | nein    | Der Diff zwischen vorherigem und neuem Status bei Update-Aktionen.                          |

## Filter

Filtere nach Zeitraum, Kategorie, Status, Akteur, Ressource oder Freitext über die Aktionsnamen. Kombiniere Filter — ein Zeitraum plus die Kategorie **Sicherheit** plus Status **Verweigert** bringt die fehlgeschlagenen Anmeldeversuche in einem Fenster zum Vorschein. Der Filterzustand spiegelt sich in der URL, sodass ein gespeicherter Link dieselbe Ansicht wieder öffnet.

## Exportieren

Zwei Exportformate werden ausgeliefert: CSV für Tabellenkalkulationen und JSON für nachgelagerte Systeme. Beide respektieren die aktiven Filter — was du exportierst, ist was du siehst. Große Exporte streamen als Download; die Symbolleiste meldet Fortschritt und meldet Abschluss mit Dateigröße und Zeilenanzahl.

## Aufbewahrung und Integrität

Audit-Zeilen sind unveränderlich: Bearbeitungen und Löschungen werden selbst auditiert, und das Zeilenschema trägt einen Integritäts-Hash, den du gegen den Export prüfen kannst. Die Aufbewahrung steht standardmäßig auf 90 Tagen und ist auf der Seite zur Aufbewahrungsrichtlinie konfigurierbar (30 bis 365 Tage). Zeilen, die altern, werden vom nächsten Cleanup-Lauf entfernt — es gibt kein Soft-Delete-Fenster für Audit-Daten.

## Wo das hingehört

Das Audit-Log ist die Leseseite jedes anderen Governance-Features: Legal Hold benennt die platzierten Holds, Anfragen betroffener Personen protokollieren jeden Cascade-Schritt, die Run-code-Richtlinie protokolliert die URLs, die jede Sandbox zu erreichen versuchte. Wenn eine Frage mit _wer, wann, was_ beginnt, ist das Audit-Log die Antwort. Die Begleitseite ist die [Aufbewahrungsrichtlinie](/de/platform/admin/governance/policies-and-limits) — sie steuert, wie lange diese Zeilen bleiben, bevor Cleanup sie entfernt.
