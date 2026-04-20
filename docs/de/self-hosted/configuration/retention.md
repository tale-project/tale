---
title: Aufbewahrungs-Konfiguration
description: Konfiguriere, wie lange Konversationen, Dateien, Audit-Daten und Ausführungen aufbewahrt werden.
---

Tale hat eine zentrale Aufbewahrungs-Konfiguration, die für alle Datendomänen gilt — Chat-Konversationen, hochgeladene Dateien, Audit-Logs, Workflow-Ausführungen und Analytics-Daten. Die Standardwerte passen für die meisten Deployments; passe sie an, wenn Compliance-, Kosten- oder Datenschutzregeln andere Werte erfordern.

Die Aufbewahrung lässt sich an zwei Orten konfigurieren:

- **Environment-Variablen** — die Untergrenze, vom Operator gesetzt, der Tale betreibt. Nutzer können diese nicht lockern.
- **Governance-UI** — pro-Organisations-Overrides im Rahmen der Environment-Vorgabe. Siehe [Governance](/de/platform/admin/governance).

## Environment-Variablen

Diese gelten für jede Organisation im Deployment. Alle Werte in Tagen.

| Variable                             | Standard | Bereich                                                          |
| ------------------------------------ | -------- | ---------------------------------------------------------------- |
| `TALE_RETENTION_CONVERSATIONS_DAYS`  | `365`    | Chat-Konversationen und deren Nachrichten.                       |
| `TALE_RETENTION_FILES_DAYS`          | `365`    | Hochgeladene Dateien in Chat und Wissensdatenbank.               |
| `TALE_RETENTION_AUDIT_DAYS`          | `730`    | Audit-Log-Einträge.                                              |
| `TALE_RETENTION_EXECUTIONS_DAYS`     | `90`     | Workflow-Ausführungsdetails. Zusammenfassungen bleiben 365 Tage. |
| `TALE_RETENTION_ANALYTICS_DAYS`      | `395`    | Per-Request-Analytics-Datensätze.                                |
| `TALE_RETENTION_DELETION_GRACE_DAYS` | `30`     | Soft-gelöschte Datensätze (Papierkorb) vor endgültiger Löschung. |

Der Löschjob läuft nächtlich um 03:00 UTC. Setze `TALE_RETENTION_DISABLED=true`, um das Löschen ganz auszusetzen — nützlich zum Debuggen, in Produktion nicht empfohlen.

## Reihenfolge und Overrides

Die Environment-Variable ist die Obergrenze. Eine Governance-Policy im Admin-UI kann die Organisations-Aufbewahrung nur **gleich oder niedriger** als den Environment-Wert setzen. So kannst du als Operator eine Compliance-Untergrenze erzwingen, während datenschutzempfindliche Organisationen weniger behalten dürfen.

Fordert eine Governance-Policy eine höhere Aufbewahrung als das Environment erlaubt, wird sie mit klarer Fehlermeldung abgelehnt.

## Legal Hold

Wenn ein Audit-Datensatz für Legal Hold markiert ist, wird die Aufbewahrung für zugehörige Konversationen, Dateien und Ausführungen ausgesetzt, bis der Hold aufgehoben wird. Legal Hold wird in Governance verwaltet und im Audit-Stream protokolliert.

## Was gelöscht wird

- Zeilen werden aus der Datenbank gelöscht.
- Zugehörige Dateien werden aus dem Object-Storage gelöscht.
- Vector-Embeddings für gelöschte Dokumente werden aus dem Wissens-Store entfernt.
- Schritt-Level-Details der Ausführungen werden gelöscht, aber Aggregatzahlen bleiben für Analytics erhalten.

## Verwandt

- [Environment-Referenz](/de/self-hosted/configuration/environment-reference) — vollständige Liste der Tale-Environment-Variablen.
- [Governance](/de/platform/admin/governance) — Pro-Organisations-Aufbewahrungs-Overrides und Legal Hold.
