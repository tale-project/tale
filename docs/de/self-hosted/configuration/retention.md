---
title: Aufbewahrungs-Konfiguration
description: Konfiguriere, wie lange Konversationen, Dateien, Audit-Einträge und Ausführungen aufbewahrt werden.
---

Tale verfügt über eine zentrale Aufbewahrungs-Konfiguration, die für alle Datendomänen gilt — Chat-Konversationen, hochgeladene Dateien, Audit-Logs, Workflow-Ausführungen und Analytics-Einträge. Die Standardwerte sind für die meisten Deployments angemessen; passe sie an, wenn Compliance, Kosten oder Datenschutzregeln andere Einstellungen erfordern.

Aufbewahrungs-Grenzen werden in drei Schichten aufgelöst:

- **Pro-Org-JSON-Datei** — operator-kontrollierte Baseline unter `$TALE_CONFIG_DIR/retention/{orgSlug}.json`. Die JSON-Datei ist die einzige Source of Truth. Wird beim ersten Start des Convex-Containers pro `TALE_VERSION` automatisch geseedet.
- **Umgebungsvariablen** — vom Operator gesetztes Verschärfungs-Overlay über den Datei-Werten. Kann min/max nur verschärfen (Floor erhöhen, Ceiling senken); kann die Datei-Werte nicht aufweichen.
- **Governance UI** — Werte pro Organisation innerhalb der effektiven Operator-Grenzen.

## Datei-basierte Pro-Org-Defaults

Pro-Org-Dateien liegen unter `$TALE_CONFIG_DIR/retention/`:

- `default.json` — Aufbewahrungs-Grenzen + Initialwerte für die Bootstrap-Org. Der Slug der Default-Org ist hartcodiert auf `default`, daher passt die Datei zur `{orgSlug}.json`-Konvention ohne Sonderfall.
- `{orgSlug}.json` (optional) — Pro-Org-Overrides für weitere Orgs. Wenn eine Org keine eigene Datei hat, fällt der Resolver auf `default.json` zurück.

Jede Datei deklariert eine beliebige Teilmenge der 16 Aufbewahrungs-Kategorien plus einen optionalen **Root-Level**-`_metadata`-Block für das Env-Binding. Eine in der Datei vorhandene Kategorie MUSS alle drei Felder enthalten:

```json
{
  "_metadata": {
    "envPrefix": "TALE_RETENTION_",
    "envNames": {
      "AUDIT_MIN": "auditLog.min",
      "AUDIT_MAX": "auditLog.max",
      "AUDIT_DEFAULT": "auditLog.default",
      "FILES_MIN": "documents.min",
      "FILES_MAX": "documents.max",
      "FILES_DEFAULT": "documents.default"
    }
  },
  "auditLog": { "min": 365, "max": 3650, "default": 730 },
  "documents": { "min": 30, "max": 3650, "default": 365 }
}
```

Wobei:

- `min` / `max` — vom Operator definierte äußere Grenzen. Org-Admins können keine Werte außerhalb dieses Bereichs wählen.
- `default` — der Anfangs-Aufbewahrungswert pro Org, bis ein Org-Admin ihn in der Governance-UI ändert.
- `_metadata` (root, optional) — Env-Binding-Deklaration:
  - `envPrefix` — gemeinsamer Präfix für alle Env-Namen. Vollständige Env-Namen entstehen durch reine String-Konkatenation: `${envPrefix}${suffix}`. Der Trenner (z. B. `_`) gehört zum `envPrefix` und ist sichtbar.
  - `envNames` — direkter 1:1-Map vom Env-Suffix → JSON-Pfad. Pfade müssen `${kategorie}.${min|max|default}` für eine bekannte Kategorie sein.
  - `envPrefix` und `envNames` sind ausschließlich am Root-`_metadata` erlaubt; an einer Kategorie werden sie vom Schema abgewiesen.

Kategorien, die in der Datei einer Org fehlen, fallen auf die `default.json` der Org zurück. Fehlen beide (z. B. Operator hat `default.json` gelöscht), liefern Aufbewahrungs-Reads `RETENTION_CONFIG_MISSING` zurück — Container mit `FORCE_SEED=true` neu starten (oder `TALE_VERSION` erhöhen), um `default.json` aus dem mitgelieferten `examples/retention/default.json` neu zu seeden.

`unit` (`days` vs `hours`) ist nicht pro Kategorie konfigurierbar — sie ist an die Cleanup-Math gebunden und lebt nur im Plattform-Code.

### Display-Metadaten (per Kategorie)

Operatoren können pro Kategorie einen optionalen `_metadata`-Block setzen, um Label / Hilfetext / Sortierreihenfolge / Sichtbarkeit in der Governance-UI zu überschreiben:

```json
{
  "auditLog": {
    "min": 365,
    "max": 3650,
    "default": 730,
    "_metadata": {
      "label": "Audit-Log-Retention (PCI-Bereich)",
      "help": "Vom Operator angepinnt für unser Compliance-Programm.",
      "order": 1,
      "hidden": false
    }
  }
}
```

Env-Binding (`envPrefix` / `envNames`) ist ausschließlich am Root-`_metadata` erlaubt — innerhalb einer Kategorie werden diese Felder vom Schema abgewiesen.

### Admin-Seite "Environment"

Der Governance-Sidebar-Eintrag **Environment** zeigt einen read-only Snapshot jeder retention-relevanten Env-Variable, die der Resolver gerade berücksichtigt — Name, aktueller Wert, Binding-Quelle (`metadata`, wenn in `_metadata.envNames` deklariert; `none` sonst) und ob sie aktuell verschärft.

Nach dem Editieren einer Datei greift die nächste Editor-Reload automatisch die neuen Werte ab — kein Convex-Neustart erforderlich.

## Umgebungsvariablen (Verschärfungs-Overlay)

Die `docker-entrypoint.sh` der Plattform synct standardmäßig jede Env-Variable des Plattform-Containers nach Convex (passend zum `bun run dev`-Verhalten). Eine kleine `ENV_SYNC_DENYLIST` am Anfang des Entrypoints ist der einzige Platform-seitige Wartungsaufwand — sie ist aktuell leer und wächst nur, wenn eine bestimmte Variable Convex aktiv stört. Operatoren müssen keine Plattform-seitige Allowlist verhandeln, um eigene Env-Variablen hinzuzufügen.

Diese gelten für jede Organisation auf dem Deployment, oben auf den Pro-Org-Datei-Werten. Sie können Grenzen nur VERSCHÄRFEN — einen Floor anheben oder ein Ceiling senken — niemals über das hinaus aufweichen, was die Datei deklariert. Alle Werte sind in Tagen, sofern nicht anders angegeben.

Die Env-Namen unten stammen aus dem Root-`_metadata.envNames`-Map des mitgelieferten `examples/retention/default.json`. `envPrefix` ist `"TALE_RETENTION_"` (mit abschließendem Unterstrich). Vollständige Env-Namen entstehen durch reine String-Konkatenation: `envPrefix + suffix`.

| Variable                                     | Min     | Max    | Initial | Steuert                                                                                                      |
| -------------------------------------------- | ------- | ------ | ------- | ------------------------------------------------------------------------------------------------------------ |
| `TALE_RETENTION_CONVERSATIONS_MIN` / `_MAX`  | `1`     | `3650` | `90`    | Chat-Konversationen und ihre Nachrichten.                                                                    |
| `TALE_RETENTION_FILES_MIN` / `_MAX`          | `30`    | `3650` | `365`   | Hochgeladene Dateien (Chat-Anhänge oder Wissensbasis).                                                       |
| `TALE_RETENTION_AUDIT_MIN` / `_MAX`          | `365`   | `3650` | `730`   | Audit-Log-Einträge. Min hartcodiert auf 365 Tage (PCI/SOC2/ISO-Baseline) — Operator kann nur ERHÖHEN.        |
| `TALE_RETENTION_EXECUTIONS_MIN` / `_MAX`     | `1`     | `365`  | `30`    | Workflow-Ausführungsdetails.                                                                                 |
| `TALE_RETENTION_ANALYTICS_MIN` / `_MAX`      | `30`    | `3650` | `365`   | Pro-Anfrage Usage-Analytics-Einträge.                                                                        |
| `TALE_RETENTION_CHAT_FILTER_MIN` / `_MAX`    | `1`     | `365`  | `90`    | Chat-Filter (PII / Wortliste / Moderation) Telemetrie.                                                       |
| `TALE_RETENTION_PROMPTS_MIN` / `_MAX`        | `30`    | `3650` | `730`   | Gespeicherte Prompt-Vorlagen (org-scope).                                                                    |
| `TALE_RETENTION_FEEDBACK_MIN` / `_MAX`       | `30`    | `3650` | `365`   | Pro-Nachricht Daumen / Kommentare. Können zitierten Nutzerinhalt enthalten.                                  |
| `TALE_RETENTION_MEMORY_AUDIT_MIN` / `_MAX`   | `30`    | `3650` | `365`   | Personalisierungs-Memory Änderungs-Log.                                                                      |
| `TALE_RETENTION_CUSTOMERS_MIN` / `_MAX`      | `30`    | `3650` | `730`   | CRM-Kundendaten (Name, Email, Adresse, Locale, Metadaten).                                                   |
| `TALE_RETENTION_VENDORS_MIN` / `_MAX`        | `30`    | `3650` | `730`   | Lieferantendatensätze (Name, Email, Telefon, Adresse, Freitext-Notizen).                                     |
| `TALE_RETENTION_INBOX_MIN` / `_MAX`          | `30`    | `3650` | `730`   | Externer Kundenkanal-Posteingang (`externalConversations`) + kaskadierte Nachrichteninhalte.                 |
| `TALE_RETENTION_MSG_META_MIN` / `_MAX`       | `30`    | `3650` | `365`   | Pro-Nachricht Reasoning, Prompt-Kontextfenster, Tool-I/O. Stark PII-haltige abgeleitete Daten.               |
| `TALE_RETENTION_USER_TEMP_MIN` / `_MAX`      | `1`     | `720`  | `24`    | Temporäre nutzerseitige Dateien (Stunden).                                                                   |
| `TALE_RETENTION_AGENT_TEMP_MIN` / `_MAX`     | `1`     | `720`  | `24`    | Temporäre agentenseitige Dateien (Stunden).                                                                  |
| `TALE_RETENTION_LOGIN_ATTEMPTS_MIN` / `_MAX` | `90`    | `365`  | `90`    | Login-Versuchs-Datensätze.                                                                                   |
| `TALE_RETENTION_DISABLED`                    | `false` | —      | —       | Wenn `true`, läuft der Cleanup-Prozess no-op mit warn-log. Operator-Notbremse für Migrationsfenster / Debug. |

Änderungen an Env-Variablen werden beim **nächsten Backend-Neustart** wirksam (`docker compose restart tale-convex`) — Convex cached Env beim Prozessstart.

## Pro-Org-Policy

Innerhalb der effektiven Operator-Grenzen kann ein Org-Admin jede Kategorie unabhängig in der Governance-UI konfigurieren. Das Formular holt die effektiven Grenzen über die V8-Aktion `getRetentionBoundsAction` (die die Pro-Org-Datei mit Fallback auf `default.json` liest und env-Verschärfung anwendet) und rendert `<input min={N} max={M}>` plus inline Hilfetext BEVOR der Nutzer Werte außerhalb des Bereichs eintippt. Speichervorgänge, die eine Grenze verletzen, werden mit `RETENTION_BELOW_FLOOR` oder `RETENTION_EXCEEDS_CEILING` abgelehnt (jeweils mit der genauen Grenze + Quelle).

## Wie die Löschung läuft

Der Löschjob läuft nächtlich um 04:00 UTC. Der Top-Level-Dispatcher schedulet eine separate Per-Org-Cleanup mit deterministischem 0-15 Minuten hash-basiertem Stagger, sodass RAG und DB nicht bei jedem Cron-Tick einen Thundering-Herd-Burst sehen. Ein paralleler Cron um 01:00 UTC führt `effectReleasesOnly` aus, damit genehmigte Legal-Hold-Freigaben nach Ablauf ihrer 24h-Cooldown auch dann wirksam werden, wenn Retention via `TALE_RETENTION_DISABLED` pausiert ist.

Für jede Org laufen alle Kategorien in Prioritätsreihenfolge:

1. Dokumente (RAG-Einträge gelöscht via authentifiziertem `ragFetch`)
2. Nutzer-Temp-Dateien
3. Agent-Temp-Dateien
4. Chat-Verlauf (cascade-löscht message metadata, threadTodos, approvals, threadBranches, messageFeedback, chatFilterEvents, artifacts + revisions, agentWebhookUserThreads, sub-threads, agent-component-Nachrichten, dann den threadMetadata-Eintrag selbst)
5. Audit-Logs (schreibt einen `auditLogCheckpoints`-Eintrag, der Chain-Head + Anzahl + Max-Timestamp erfasst, sodass die SHA-256-Hash-Chain über den Archiv-Schnitt hinweg verifizierbar bleibt)
6. Workflow-Logs
7. Chat-Filter-Events
8. Usage-Ledger

Login-Versuche sind email-scoped (nicht org-scoped) und laufen als ein einzelner globaler Pass mit fester 30-Tage-TTL. Die Pro-Org-Konfiguration `loginAttemptRetentionDays` steuert diesen Sweep nicht, und die TTL ist absichtlich nicht per Env konfigurierbar, damit die forensische Untergrenze für Brute-Force-Untersuchungen über alle Deployments hinweg einheitlich bleibt.

## Legal Hold (Aufbewahrungspflicht)

Wenn ein `legalHolds`-Eintrag für `(organizationId, targetType, targetId)` existiert UND `releasedAt === undefined`, weigert sich der Cleanup-Runner, die entsprechende Entität physisch zu löschen. Der Hold ist klebrig: `restoreChatThread` weigert sich ebenfalls, solange ein Hold aktiv ist.

Target-Typen: `thread`, `document`, `execution`, `userMembership`, `org`. Ein gesamt-org Hold (`targetType: 'org'`) kurzschließt den gesamten Cleanup-Pass für diese Org.

Holds werden via `placeLegalHold` (nur Admin) platziert. Die Freigabe ist ein ZWEISTUFIGER maker-checker Flow: ein Admin reicht via `requestLegalHoldRelease` ein, ein ANDERER Admin genehmigt via `approveLegalHoldRelease`. Die Genehmigung erzwingt einen 24h-Cooldown (konfigurierbar via `TALE_LEGAL_HOLD_RELEASE_COOLDOWN_HOURS`) plus eine 5-minütige Mindestverzögerung zwischen Anfrage und Genehmigung, um chained-call Angriffe abzuwehren. `rejectLegalHoldRelease` ist der Ablehnungspfad. Selbst-Genehmigung wird abgelehnt, sofern der Operator nicht explizit `TALE_LEGAL_HOLD_SINGLE_ADMIN_OK=true` setzt (Single-Admin-Deployments) — das Audit-Log erfasst `legal_hold_release_approved_self`, sodass der Bypass laut sichtbar ist. Released Holds bleiben in der Tabelle für die Audit-Spur erhalten — niemals physisch gelöscht.

Org-scoped Holds (`targetType: 'org'`, der "halt all retention" Hold) erfordern standardmäßig Vier-Augen-Prinzip; die Platzierung wird abgelehnt, sofern nicht `TALE_LEGAL_HOLD_SINGLE_ADMIN_OK=true` gesetzt ist.

Das Schließen einer `legalMatter` via `closeLegalMatter` reicht automatisch eine ausstehende Freigabe-Anfrage für jeden verlinkten aktiven Hold ein (gematcht über `matterRef`). Die Genehmigung erfordert weiterhin einen zweiten Admin pro verlinkten Hold — der Matter-Close löst NICHT automatisch frei.

Der Cleanup-Runner liest jeden aktiven Hold EINMAL pro Lauf vor, sodass laufende Durchgänge einen konsistenten Snapshot sehen. Mid-run platzierte Holds schützen den _nächsten_ Lauf; das kurze Fenster ist gemäß ISO 27050 akzeptabel, da Cleanup täglich läuft.

## Audit-Chain PII-Schutz

Das Audit-Log wird jahrelang aufbewahrt (Standard 730 Tage, Min 365). Damit diese Chain keine langlebigen Klartext-Email-Adressen und IPs aus unauthentifizierter Nutzereingabe trägt (insbesondere fehlgeschlagene Login-Versuche), setze `TALE_AUDIT_PEPPER` auf ein einmaliges Geheimnis von mindestens 16 Zeichen. Neue Audit-Einträge speichern dann einen HMAC-SHA256-Hash der Email und ein grobes Netzwerk-Präfix der IP (`/24` für v4, `/64` für v6) in dedizierten `actorEmailHash` / `actorIpHash`-Spalten; die Klartext-Spalten bleiben leer. Bestehende Einträge werden nicht umgeschrieben — Rotation invalidiert die Korrelation über die Grenze hinweg, was die Operator-Intention ist.

Wenn `TALE_AUDIT_PEPPER` ungesetzt ist oder kürzer als 16 Zeichen, fallen Audit-Writer auf Klartext zurück und loggen einen einmaligen `[SECURITY]`-Warnung auf stderr beim ersten Aufruf. Setze die Variable in der Produktion bevor das Deployment realen Nutzern ausgesetzt wird.

`TALE_AUDIT_SIGNING_KEY` (separat vom Pepper) signiert `auditLogCheckpoints`-Einträge, sodass der Integritäts-Verifier eine bewusste Retention-/PII-Scrub-Grenze von Tampering unterscheiden kann. Ohne Signing-Key ist die Chain weiterhin tamper-evident über die SHA-256-Chain selbst; die Signatur ist Defense-in-Depth gegen einen Angreifer, der sowohl Einträge löschen als auch einen frischen Checkpoint fälschen kann.

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

- [Umgebungsvariablen-Referenz](/de/self-hosted/configuration/environment-reference) — vollständige Liste der Tale-Umgebungsvariablen.
- [Governance](/de/platform/admin/governance) — Pro-Org-Aufbewahrungseinstellungen und Legal-Hold-Verwaltung.
