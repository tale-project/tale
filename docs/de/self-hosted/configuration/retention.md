---
title: Retention
description: Wie organisationsweite Retention konfiguriert wird — Operator-Grenzen in Env-Vars und UI-Controls unter Governance für Chats, Dokumente, Audit-Logs und Ledger-Zeilen.
---

Retention in Tale ist die Policy, die alte Daten nach einem Zeitplan löscht — Chats, Dokumente, Audit-Logs, Workflow-Ausführungen, Token-Nutzungs-Ledger-Zeilen. Der Operator setzt Grenzen (Minimum und Maximum) pro Kategorie; der Admin jeder Organisation wählt das tatsächliche Retention-Fenster innerhalb dieser Grenzen über **Einstellungen > Governance > Retention-Policy**. Die Trennung existiert, damit ein Hosting-Team Compliance-Untergrenzen durchsetzen kann, ohne jede Mandantin im Detail zu mikromanagen.

Diese Seite deckt die Operator-Oberfläche ab. Die Admin-seitigen Controls und die per-Kategorie-Beschreibungen leben in [Governance > Retention-Policy](/de/platform/admin/governance/policies-and-limits).

## Wie die Grenzen funktionieren

Jede Retention-Kategorie — Chat-Threads, Dokumente, Kunden, Lieferanten, Prompt-Templates, Ledger-Zeilen, Audit-Logs, Workflow-Ausführungen, Workflow-Trigger-Logs, Login-Versuche — hat ein `min` und ein `max`. Ein Org-Admin setzt einen Wert innerhalb dieses Fensters. Den Boden über eine bestehende Instanz hinweg anzuziehen ist ein mehrstufiger Flow: Operator schlägt die neue Grenze vor, jeder betroffene Admin sieht ein Banner, die Änderung greift, sobald sie akzeptiert ist.

| Kategorie                 | Typische Untergrenze | Warum                                           |
| ------------------------- | -------------------- | ----------------------------------------------- |
| Chat-Verlauf              | 30 T                 | Die meisten wollen jüngsten Kontext, nicht ewig |
| Dokumente                 | 1 J                  | Wissen veraltet langsam                         |
| Audit-Logs                | 1 J Minimum          | Compliance-Frameworks erwarten ein Jahr         |
| Token-Nutzungs-Ledger     | 90 T                 | Analytics und Budget-Berichte hängen an Zeilen  |
| Workflow-Ausführungs-Logs | 30 T                 | Debugging reicht selten weiter zurück           |
| Login-Versuche            | 30 T                 | Brute-Force-Untersuchung braucht die Audit-Spur |

Die mitgelieferten Defaults sind locker; zieh sie an, je nach deiner Compliance-Haltung.

## Wo du Grenzen setzt

Die Grenzen leben in der Operator-Config-Datei, nicht in Env-Vars. Editiere `governance/retention-bounds.json` unter `TALE_CONFIG_DIR` (default `/app/data/platform-config/` im Plattform-Container):

```json
{
  "chatHistory": { "min": 30, "max": 730, "unit": "days" },
  "documents": { "min": 1, "max": 3650, "unit": "days" },
  "auditLog": { "min": 365, "max": 3650, "unit": "days" },
  "tokenLedger": { "min": 90, "max": 1095, "unit": "days" }
}
```

Der Plattform-Container beobachtet die Datei; Änderungen schlagen ein Grenzen-Update für jede bestehende Org vor. Admins sehen den Vorschlag in ihrem **Retention-Policy**-Bildschirm und wenden ihn selbst an. Der Vorschlagen-dann-anwenden-Schritt ist Absicht: Eine Untergrenze anzuziehen kürzt Historie, was eine destruktive Aktion ist, die kein Operator stillschweigend bei jeder Mandantin landen sollte.

## Der Retention-Sweep

Ein geplanter Cron in `tale-convex` läuft die tatsächliche Löschung. Jede Kategorie wird unabhängig gesweept — ein langsamer Lauf einer blockiert die anderen nicht. Löschungen sind audited (jede Kategorie hat ihr eigenes `*.retention_deleted`-Event), und eine Entität in ihrem Gnaden-Fenster wiederherzustellen ist von **Papierkorb** möglich, bevor der finale Sweep läuft.

Audit-Log-Einträge unterliegen selbst der Retention, aber ihre Untergrenze wird pro Deployment durchgesetzt, nicht pro Org: Die strengste (kürzeste) Audit-Log-Retention über alle Orgs ist das, was tatsächlich läuft. Eine strengere Mandantin zieht alle enger — denk daran auf Multi-Tenant-Instanzen.

## Legal Hold

Ein Legal Hold friert die Retention für einen bestimmten Scope ein: einen einzelnen Thread, einen Kunden-Datensatz oder eine ganze Organisation. Gehaltene Entitäten überspringen den Sweep, bis der Hold gelöst wird. Der Hold selbst ist audited; org-weite Holds sind laut genug, dass die UI eine Bestätigung anzeigt, bevor sie greifen.

## Wo das hingehört

Die Grenzen-Datei ist der Hebel des Operators; die per-Kategorie-Fenster, die der Admin sieht, sind in [Retention-Policy](/de/platform/admin/governance/policies-and-limits) dokumentiert. Setzt du Grenzen gegen ein Compliance-Framework (DSGVO, HIPAA, SOC 2), ist die Audit-Log-Untergrenze meist das, was Auditoren zuerst prüfen.
