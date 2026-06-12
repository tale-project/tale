---
title: Workforce-Betrieb
description: Runbook für das Task-Ops-Automatisierungspaket — Rollout-Wellen, Kill-Switch, Symptom→Aktion-Tabelle und wohin schauen, wenn die Agenten-Automatisierung klemmt.
---

Die Operator-Seite der KI-Workforce-Automatisierung. Die Produkt-Oberflächen liegen in der App (**Agenten → Workforce** ist die operative Zentrale); diese Seite behandelt Rollout, Kill-Switch und Diagnose.

## Rollout-Wellen

Das Paket wird pro Organisation mit klebrigen Opt-outs ausgerollt (Org-Änderungen gewinnen immer; ein erneuter Lauf reaktiviert keine von Admins deaktivierten Trigger):

1. **Welle 0 — Dogfood**: für eine interne Organisation aktivieren (`migrations/provision_task_ops_pack` mit Aktivierung), eine Woche die Workforce-Gesundheitsleiste beobachten. Exit: null unquittierte Automatisierungs-Fehler.
2. **Welle 1 — ausgerollt, aus**: alle Organisationen erhalten das Paket inaktiv; Admins aktivieren selbst über den Workforce-Hauptschalter. Exit: Gesundheitsleiste 72 h sauber über die aktivierten Orgs.
3. **Welle 2 — standardmäßig an**: Standard-Aktivierung für Organisationen, die nie umgeschaltet haben.

## Der Kill-Switch

**Zeit bis Ruhe: unter zwei Minuten.** Den Hauptschalter auszuschalten (Agenten → Workforce, nur Admins, auditiert) — oder die Operation `workflows/ops/disable_task_ops_pack` auszuführen — bewirkt zweierlei: alle Pack-Trigger werden deaktiviert (der Scheduler scannt sie nicht mehr) und der Ausführungspfad selbst wird gesperrt (`task_automation`-Richtlinie), sodass auch bereits eingereihte Ereignisse keine Agenten-Arbeit mehr starten. Laufendes endet; Neues startet nicht.

Verifikation: die Workforce-Seite zeigt Automatisierung **aus**; neue Zuweisungen erzeugen keinen Bestätigungs-Kommentar; `[TaskOpsKillSwitch]` erscheint in den Backend-Logs.

## Symptom → Aktion

| Symptom                                             | Wahrscheinliche Ursache                          | Aktion                                                                                        |
| --------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Agenten-Aufgaben tun nichts                         | Automatisierung aus oder Pack-Trigger inaktiv    | Workforce-Schalter; Automatisierungen → `tasks/…`-Trigger prüfen                              |
| Arbeit hängt > 24 h _In Arbeit_                     | Agenten-Lauf gestorben; Stale-Sweep rollt zurück | Lauf-Historie der Aufgabe prüfen; der stündliche Sweep stellt auf _Zu erledigen_ zurück       |
| Agent verweigert jeden Lauf                         | Budget-Pause oder Sicherung                      | Workforce → Aufmerksamkeits-Warteschlangen; Budget erhöhen oder Status als Mensch ändern      |
| Reviews stapeln sich                                | Reviewer übersehen den Posteingang               | Review-Erinnerungen eskalieren automatisch nach 4 h / 24 h; Posteingangs-Einstellungen prüfen |
| Externe Läufe scheitern stets mit `runtime_offline` | Kein Daemon für den Adapter online               | Einstellungen → API → Runtimes: Daemon-Status; `tale-daemon status` auf der Maschine          |
| Digest meldet `capped`-Zahlen                       | Sehr aktiver Tag traf eine Scan-Grenze           | Zahlen sind Untergrenzen; keine Aktion nötig                                                  |

## Wohin schauen

- **Logs**: stabile Klammer-Präfixe — `[AgentTaskRun]`, `[ExternalRuns]`, `[WorkforceRollup]`, `[TaskOpsKillSwitch]`, `[RetentionCleanup]` — mit key=value-Feldern. Prompt-Inhalte werden nie geloggt.
- **Spur pro Aufgabe**: die Lauf-Historie im Aufgaben-Detail verlinkt jeden Lauf mit seiner Automatisierungs-Ausführung.
- **Datenlebenszyklus**: Laufdaten folgen der Retention-Kategorie `agentRuns` (Standard 180 Tage, org-einstellbar 30–400); Aggregate werden fix nach 400 Tagen entfernt; Review-Entscheidungen überleben eine Betroffenen-Löschung pseudonymisiert.
