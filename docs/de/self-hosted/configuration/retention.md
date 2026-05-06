---
title: Aufbewahrungs-Konfiguration
description: Konfiguriere, wie lange Konversationen, Dateien, Audit-Einträge und Ausführungen aufbewahrt werden.
---

Tale verfügt über eine zentrale Aufbewahrungs-Konfiguration, die für alle Datendomänen gilt — Chat-Konversationen, hochgeladene Dateien, Audit-Logs, Workflow-Ausführungen und Analytics-Einträge. Die Standardwerte sind für die meisten Deployments angemessen; passe sie an, wenn Compliance, Kosten oder Datenschutzregeln andere Einstellungen erfordern.

Die Aufbewahrung kann an zwei Stellen konfiguriert werden:

- **Umgebungsvariablen** — vom Operator gesetzte Grenzen. Pro-Org-Admins können diese nicht aufweichen.
- **Governance UI** — Werte pro Organisation innerhalb der Operator-Grenzen.

## Umgebungsvariablen

Diese gelten für jede Organisation auf dem Deployment. Alle Werte sind in Tagen, sofern nicht anders angegeben. Paare `_MIN_DAYS` und `_MAX_DAYS` pro Kategorie — Operatoren können die Standardwerte verschärfen, aber niemals lockern.

| Variable                                                   | Standard min | Standard max | Steuert                                                                                                      |
| ---------------------------------------------------------- | ------------ | ------------ | ------------------------------------------------------------------------------------------------------------ |
| `TALE_RETENTION_CONVERSATIONS_MIN_DAYS` / `_MAX_DAYS`      | `1`          | `3650`       | Chat-Konversationen und ihre Nachrichten.                                                                    |
| `TALE_RETENTION_FILES_MIN_DAYS` / `_MAX_DAYS`              | `30`         | `3650`       | Hochgeladene Dateien (Chat-Anhänge oder Wissensbasis).                                                       |
| `TALE_RETENTION_AUDIT_MIN_DAYS` / `_MAX_DAYS`              | `365`        | `3650`       | Audit-Log-Einträge. Min hartcodiert auf 365 Tage (PCI/SOC2/ISO-Baseline) — Operator kann nur ERHÖHEN.        |
| `TALE_RETENTION_EXECUTIONS_MIN_DAYS` / `_MAX_DAYS`         | `1`          | `365`        | Workflow-Ausführungsdetails.                                                                                 |
| `TALE_RETENTION_ANALYTICS_MIN_DAYS` / `_MAX_DAYS`          | `30`         | `3650`       | Pro-Anfrage Usage-Analytics-Einträge.                                                                        |
| `TALE_RETENTION_LOGIN_ATTEMPTS_MIN_DAYS` / `_MAX_DAYS`     | `90`         | `365`        | Login-Fehler Forensik-Einträge. Min auf 90 Tage erhöht.                                                      |
| `TALE_RETENTION_CHAT_FILTER_EVENTS_MIN_DAYS` / `_MAX_DAYS` | `1`          | `365`        | Chat-Filter (PII / Wortliste / Moderation) Telemetrie.                                                       |
| `TALE_RETENTION_USER_TEMP_MIN_HOURS` / `_MAX_HOURS`        | `1`          | `720`        | Temporäre nutzerseitige Dateien (Stunden).                                                                   |
| `TALE_RETENTION_AGENT_TEMP_MIN_HOURS` / `_MAX_HOURS`       | `1`          | `720`        | Temporäre agentenseitige Dateien (Stunden).                                                                  |
| `TALE_RETENTION_DISABLED`                                  | `false`      | —            | Wenn `true`, läuft der Cleanup-Prozess no-op mit warn-log. Operator-Notbremse für Migrationsfenster / Debug. |

Änderungen an Env-Variablen werden beim **nächsten Backend-Neustart** wirksam (`docker compose restart tale-convex`) — Convex cached Env beim Prozessstart.

## Pro-Org-Policy

Innerhalb der Operator-Grenzen kann ein Org-Admin jede Kategorie unabhängig in der Governance-UI konfigurieren. Das Formular fetched die effektiven Grenzen über `getEffectiveRetentionBounds` und rendert `<input min={N} max={M}>` plus inline Hilfetext BEVOR der Nutzer Werte außerhalb des Bereichs eintippt. Speichervorgänge, die eine Grenze verletzen, werden mit `RETENTION_BELOW_FLOOR` oder `RETENTION_EXCEEDS_CEILING` abgelehnt (jeweils mit der genauen Grenze + Quelle).

## Wie die Löschung läuft

Der Löschjob läuft nächtlich um 03:00 UTC. Der Top-Level-Dispatcher schedulet eine separate Per-Org-Cleanup mit deterministischem 0-15 Minuten hash-basiertem Stagger, sodass RAG und DB nicht bei jedem Cron-Tick einen Thundering-Herd-Burst sehen.

Für jede Org laufen alle Kategorien in Prioritätsreihenfolge:

1. Dokumente (RAG-Einträge gelöscht via authentifiziertem `ragFetch`)
2. Nutzer-Temp-Dateien
3. Agent-Temp-Dateien
4. Chat-Verlauf (cascade-löscht message metadata, threadTodos, approvals, threadBranches, messageFeedback, chatFilterEvents, artifacts + revisions, agentWebhookUserThreads, sub-threads, agent-component-Nachrichten, dann den threadMetadata-Eintrag selbst)
5. Audit-Logs (schreibt einen `auditLogCheckpoints`-Eintrag, der Chain-Head + Anzahl + Max-Timestamp erfasst, sodass die SHA-256-Hash-Chain über den Archiv-Schnitt hinweg verifizierbar bleibt)
6. Workflow-Logs
7. Chat-Filter-Events
8. Usage-Ledger

Login-Versuche sind email-scoped (nicht org-scoped) und laufen als ein einzelner globaler Pass mit fester 30-Tage-TTL.

## Legal Hold (Aufbewahrungspflicht)

Wenn ein `legalHolds`-Eintrag für `(organizationId, targetType, targetId)` existiert UND `releasedAt === undefined`, weigert sich der Cleanup-Runner, die entsprechende Entität physisch zu löschen. Der Hold ist klebrig: `restoreChatThread` weigert sich ebenfalls, solange ein Hold aktiv ist.

Target-Typen: `thread`, `document`, `execution`, `userMembership`, `org`. Ein gesamt-org Hold (`targetType: 'org'`) kurzschließt den gesamten Cleanup-Pass für diese Org.

Holds werden via `placeLegalHold` platziert und via maker-checker Flow released (`requestLegalHoldRelease` + `approveLegalHoldRelease`, der Genehmigende muss vom Anfragenden abweichen, 24h Cooldown nach der Genehmigung). Released Holds bleiben in der Tabelle für die Audit-Spur erhalten — niemals physisch gelöscht.

## GDPR Art 17 Löschung

Für verifizierte Subject-Erasure-Anfragen kann ein Admin `requestErasure(organizationId, userId, reason)` aufrufen, um sofort jede Thread, die der genannte Nutzer in dieser Org besitzt, kaskadierend zu löschen. Dies UMGEHT das Aufbewahrungs-Grace-Window und das Cooldown-on-Shortening (sodass die Löschung "ohne ungerechtfertigte Verzögerung" gemäß Art 17 erfolgt). Verweigert, wenn ein passender Legal Hold aktiv ist.

Audit-Subtyp `gdpr_erasure_executed` (`category: 'admin'`) erfasst Akteur, Grund, gelöschte Threads und etwaige durch Hold blockierte Items.

## Was gelöscht wird

- Zeilen werden aus der Datenbank gelöscht.
- Zugehörige Dateien werden aus dem Object Storage gelöscht.
- Vector-Embeddings für gelöschte Dokumente werden aus dem Knowledge-Store entfernt.
- Bei der Chat-Verlauf-Aufbewahrung wird jede Nachfolge-Zeile (Nachrichten, Metadata, Todos, Feedback, Artifacts usw.) per Cascade über den geteilten `cascadeDeleteThreadChildren`-Helper gelöscht, sodass User-Delete und Retention-Delete niemals auseinanderdriften.
- Die Audit-Log-Aufbewahrung schreibt an jeder Batch-Grenze einen `auditLogCheckpoints`-Eintrag, sodass die SHA-256-Hash-Chain verifizierbar bleibt.

## Verwandt

- [Umgebungsvariablen-Referenz](/self-hosted/configuration/environment-reference) — vollständige Liste der Tale-Umgebungsvariablen.
- [Governance](/platform/admin/governance) — Pro-Org-Aufbewahrungseinstellungen und Legal-Hold-Verwaltung.
