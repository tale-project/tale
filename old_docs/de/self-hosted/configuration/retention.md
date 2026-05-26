---
title: Aufbewahrungs-Konfiguration
description: Konfiguriere, wie lange Konversationen, Dateien, Audit-Einträge und Ausführungen aufbewahrt werden.
---

Aufbewahrung steuert, wie lange jede Kategorie an Daten lebt, die Tale speichert — Chat-Konversationen, hochgeladene Dateien, Audit-Log-Einträge, Workflow-Ausführungsdetails, Analytik-Zeilen, Kundendatensätze und ein Dutzend weitere. Diese Seite ist für Operatoren, die diese Grenzen aus Compliance-, Kosten- oder Datenschutzgründen feinjustieren müssen; der In-App-Knopf pro Organisation, der innerhalb der Operator-Grenzen läuft, lebt unter [Governance](/de/platform/admin/governance). Die ausgelieferten Voreinstellungen sind für die meisten Installationen konservativ genug, also rühren die meisten Operatoren die Datei- und Env-Schichten nicht an und berühren nur den Per-Org-Schieber in der UI.

Das Modell ist drei Schichten tief. Die **Per-Org-JSON-Datei** setzt die äußeren Grenzen. **Umgebungsvariablen** verschärfen diese Grenzen (Boden heben, Decke senken) darauf. Die **Governance-UI** wählt einen Wert innerhalb dessen, was der Operator übriggelassen hat. Jede Schicht kann nur verschärfen — Operatoren können nie ausweiten, was die Datei deklariert.

## Datei-basierte Per-Org-Voreinstellungen

Die Per-Org-Dateien leben unter `$TALE_CONFIG_DIR/retention/`. Der convex-Container versorgt sie beim ersten Boot automatisch pro `TALE_VERSION`; spätere Bearbeitungen greifen beim nächsten Lesen, weil die Datei bei jeder Aufbewahrungs-Aktion konsultiert wird.

- `default.json` — die Aufbewahrungsgrenzen und Anfangswerte der Bootstrap-Organisation. Jede Organisation ohne eigene Datei fällt auf diese zurück.
- `{orgSlug}.json` (optional) — Per-Org-Overrides für zusätzliche Organisationen.

Jede Datei deklariert eine beliebige Teilmenge der sechzehn Aufbewahrungs-Kategorien plus einen optionalen `_metadata`-Block auf Wurzel-Ebene. Eine in der Datei vorhandene Kategorie muss `min`, `max` und `default` enthalten; Per-Kategorie-`_metadata` für Anzeige-Overrides ist optional.

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
      "FILES_DEFAULT": "documents.default",
      "INBOX_MIN": "externalConversations.min",
      "INBOX_MAX": "externalConversations.max",
      "INBOX_DEFAULT": "externalConversations.default"
    }
  },
  "auditLog": { "min": 365, "max": 3650, "default": 730 },
  "documents": { "min": 30, "max": 3650, "default": 365 },
  "externalConversations": { "min": 30, "max": 3650, "default": 730 }
}
```

`min` und `max` sind die vom Operator definierten äußeren Grenzen — Org-Admins können keine Werte außerhalb dieses Bereichs wählen. `default` ist der Per-Org-Anfangs-Aufbewahrungswert, der genutzt wird, bis ein Org-Admin ihn unter **Governance** ändert. Die Wurzel-`_metadata.envPrefix`- und `_metadata.envNames`-Karte deklariert die Bindung von Env-Variable an JSON-Feld; jeder Eintrag sagt "diese Env-Variable kontrolliert dieses Feld." Pfade müssen `${category}.${min|max|default}` für eine bekannte Aufbewahrungskategorie entsprechen. `envPrefix` und `envNames` sind nur auf der Wurzel-`_metadata` erlaubt — sie in einer Per-Kategorie-`_metadata` zu platzieren, wird bei der Schema-Validierung abgelehnt.

Aus der Datei einer Org fehlende Kategorien fallen auf die `default.json` dieser Org zurück. Falls beide fehlen — etwa weil der Operator `default.json` gelöscht hat — geben Aufbewahrungslesungen `RETENTION_CONFIG_MISSING` zurück. Starte den convex-Container mit `FORCE_SEED=true` neu (oder erhöhe `TALE_VERSION`), um `default.json` aus der gebündelten `examples/retention/default.json` neu zu setzen.

Die Kategorie-Einheit (Tage gegenüber Stunden) ist nicht pro Kategorie konfigurierbar — sie ist an die Laufzeit-Bereinigungsmathematik gebunden und lebt im Platform-Code. Nach dem Bearbeiten einer Datei nimmt die nächste Aufbewahrungsaktion die neuen Werte automatisch auf, weil Datei-I/O bei jedem Lesen passiert; kein convex-Neustart nötig.

### Typumwandlung bei Env-Bindung

Env-Variablen sind flache Strings. Der Resolver wandelt jede gemäß dem Laufzeit-Typ des Feldes um: `number` über `parseInt` oder `parseFloat`; `string` wortgetreu; `boolean` aus `"true"` oder `"false"` (Groß-/Kleinschreibung ignoriert); `date` als ISO 8601; `array<scalar>` auf `,` gesplittet, jedes Element umgewandelt. Komplexe Objekte, verschachtelte Records und unterscheidbare Unions können keine Env-Bindung tragen — strukturierte Daten in einen einzigen Env-String zu packen, ist mehrdeutig und verlustbehaftet. Für Aufbewahrung speziell ist jedes bindbare Feld eine Ganzzahl, also ist die Regel hier theoretisch; sie zählt, wenn dasselbe `_metadata.envPrefix`-Muster für zukünftige Konfigurationsbereiche wiederverwendet wird.

### Anzeige-Overrides

Ein Kategorie-Level-`_metadata`-Block trägt optionale, nur für die Anzeige geltende Felder für den Governance-Editor. `label` und `help` überlagern die Platform-i18n-Strings; `order` und `hidden` ändern das visuelle Layout.

```json
{
  "auditLog": {
    "min": 365,
    "max": 3650,
    "default": 730,
    "_metadata": {
      "label": "Audit-Log-Aufbewahrung (PCI-Bereich)",
      "help": "Vom Operator gepinnt für unser Compliance-Programm.",
      "order": 1,
      "hidden": false
    }
  }
}
```

Bei `hidden: true` verschwindet die Kategorie aus dem Editor; das Bereinigungs-Verhalten bleibt unverändert, weil die Grenzen weiter gelten. Env-Bindung lebt an der Wurzel-`_metadata`, nie pro Kategorie.

### Die Environment-Admin-Seite

Der Sidebar-Eintrag **Environment** unter Governance ist eine schreibgeschützte Momentaufnahme jeder Aufbewahrungs-Env-Variable, die der Resolver aktuell betrachtet — Name, aktueller Wert, Bindungsquelle (`metadata`, wenn in `_metadata.envNames` deklariert, `none`, wenn kein Eintrag auf dieses Feld mappt) und ob sie aktiv verschärft. Es ist die Antwort auf "ist mein Override tatsächlich verdrahtet?" — nützlich, wenn ein Env-Wert keine Wirkung zu haben scheint.

## Umgebungsvariablen (Verschärfungs-Overlay)

Die Umgebungs-Overrides gelten über jede Organisation auf dem Deployment, oben auf den Per-Org-Datei-Werten. Sie können nur verschärfen — einen Boden heben oder eine Decke senken — niemals weiter ausdehnen als die Datei deklariert.

Die effektiven Grenzen, die ein Org-Admin sieht, kommen aus `max(file_min, env_MIN)` für den Boden und `min(file_max, env_MAX)` für die Decke. Eine Env-Variable auf `0` zu setzen wird als Fehler abgelehnt, weil sie den gültigen Bereich kollabieren ließe; leere oder ungesetzte Env-Variablen fallen auf den Datei-Wert zurück. Env-Werte, die eine Grenze ausdehnen wollen, werden still auf den Datei-Wert geklammert — kein Fehler, keine Warnung.

Der Entrypoint der Platform synchronisiert jede Env-Variable auf dem Platform-Container standardmäßig nach convex (passend zum lokalen `bun run dev`-Verhalten). Ein kleines `ENV_SYNC_DENYLIST`-Array nahe am Anfang des Entrypoints ist die einzige platform-seitige Wartungsbelastung; es ist aktuell leer und wächst nur, wenn eine bestimmte Variable nachweislich aktiv mit Convex konfligiert. Operatoren müssen keine platform-seitigen Allowlist-Updates aushandeln, um eigene Env-Variablen hinzuzufügen.

Die Spalten unten zeigen die **ausgelieferten** Boden-, Decken- und Anfangswerte aus der gebündelten `examples/retention/default.json`. Operatoren können diese durch Bearbeiten von `$TALE_CONFIG_DIR/retention/default.json` ändern; Env-Overrides gelten obenauf. Um eine Bindung umzubenennen, ein Feld an eine andere Env zu binden oder eine neue Bindung hinzuzufügen, bearbeite `_metadata.envNames` direkt — keine Code-Änderung nötig.

| Variable                                     | Boden   | Decke  | Anfang | Regiert                                                                                                                |
| -------------------------------------------- | ------- | ------ | ------ | ---------------------------------------------------------------------------------------------------------------------- |
| `TALE_RETENTION_CONVERSATIONS_MIN` / `_MAX`  | `1`     | `3650` | `90`   | Chat-Konversationen und ihre Nachrichten.                                                                              |
| `TALE_RETENTION_FILES_MIN` / `_MAX`          | `30`    | `3650` | `365`  | Hochgeladene Dateien, die an Chat oder die Wissensdatenbank angehängt sind.                                            |
| `TALE_RETENTION_AUDIT_MIN` / `_MAX`          | `365`   | `3650` | `730`  | Audit-Log-Einträge. Boden fest auf 365 Tagen (PCI/SOC2/ISO-Baseline) — Operator kann nur anheben.                      |
| `TALE_RETENTION_EXECUTIONS_MIN` / `_MAX`     | `1`     | `365`  | `30`   | Workflow-Ausführungsdetails.                                                                                           |
| `TALE_RETENTION_ANALYTICS_MIN` / `_MAX`      | `30`    | `3650` | `365`  | Nutzungs-Analytik-Zeilen pro Anfrage.                                                                                  |
| `TALE_RETENTION_CHAT_FILTER_MIN` / `_MAX`    | `1`     | `365`  | `90`   | Chat-Filter-Telemetrie (PII, verbotene Wörter, Moderation).                                                            |
| `TALE_RETENTION_PROMPTS_MIN` / `_MAX`        | `30`    | `3650` | `730`  | Gespeicherte Prompt-Vorlagen (nur Org-Bereich).                                                                        |
| `TALE_RETENTION_FEEDBACK_MIN` / `_MAX`       | `30`    | `3650` | `365`  | Per-Nachricht-Daumen und Kommentare. Können zitierten Nutzerinhalt enthalten.                                          |
| `TALE_RETENTION_MEMORY_AUDIT_MIN` / `_MAX`   | `30`    | `3650` | `365`  | Personalisierungs-Memory-Änderungs-Log.                                                                                |
| `TALE_RETENTION_CUSTOMERS_MIN` / `_MAX`      | `30`    | `3650` | `730`  | CRM-Kunden-Datensätze (Name, E-Mail, Adresse, Locale, Metadaten).                                                      |
| `TALE_RETENTION_VENDORS_MIN` / `_MAX`        | `30`    | `3650` | `730`  | Lieferanten-Datensätze (Name, E-Mail, Telefon, Adresse, Freitext-Notizen).                                             |
| `TALE_RETENTION_INBOX_MIN` / `_MAX`          | `30`    | `3650` | `730`  | Externer Kunden-Kanal-Posteingang.                                                                                     |
| `TALE_RETENTION_MSG_META_MIN` / `_MAX`       | `30`    | `3650` | `365`  | Per-Nachricht-Reasoning, Prompt-Kontextfenster, Tool-I/O. Hoch-PII-abgeleitete Daten.                                  |
| `TALE_RETENTION_USER_TEMP_MIN` / `_MAX`      | `1`     | `720`  | `24`   | Flüchtige nutzerseitige Temp-Dateien (Stunden).                                                                        |
| `TALE_RETENTION_AGENT_TEMP_MIN` / `_MAX`     | `1`     | `720`  | `24`   | Flüchtige agentseitige Temp-Dateien (Stunden).                                                                         |
| `TALE_RETENTION_LOGIN_ATTEMPTS_MIN` / `_MAX` | `90`    | `365`  | `90`   | Login-Versuchs-Datensätze.                                                                                             |
| `TALE_RETENTION_DISABLED`                    | `false` | —      | —      | Bei `true` wird die Bereinigung als No-Op mit Warn-Log ausgeführt. Operator-Notschalter für Migrationsfenster / Debug. |

Änderungen an Env-Variablen greifen beim nächsten Backend-Neustart (`docker compose restart tale-convex`) — Convex cacht die Env beim Prozess-Start.

## Per-Org-Politik

Innerhalb der effektiven Grenzen des Operators konfiguriert ein Org-Admin jede Kategorie unabhängig in der Governance-UI. Das Formular holt die Grenzen, rendert ein vorgeklammertes Eingabefeld auf `min` und `max` und lehnt out-of-range-Werte beim Speichern mit `RETENTION_BELOW_FLOOR` oder `RETENTION_EXCEEDS_CEILING` ab. Beide Fehler benennen die exakte Grenze und die Quelle (`file` oder `env`), damit der Org-Admin weiß, mit welcher Schicht er argumentieren muss.

## Wie die Löschung läuft

Der Lösch-Job läuft nächtlich um 04:00 UTC. Der Top-Level-Dispatcher plant eine separate Per-Org-Bereinigung mit einem deterministischen, hash-basierten Staffel-Versatz von 0 bis 15 Minuten, damit RAG und die Datenbank bei jedem Cron-Tick keine donnernde-Herde-Salve sehen. Ein Geschwister-Cron um 01:00 UTC fährt `effectReleasesOnly`, damit genehmigte Legal-Hold-Freigaben jenseits ihres 24-Stunden-Cooldowns auch dann greifen, wenn die Aufbewahrung über `TALE_RETENTION_DISABLED` pausiert ist.

Für jede Org läuft jede Kategorie in Prioritätsreihenfolge:

1. Dokumente (RAG-Einträge über authentifiziertes `ragFetch` gelöscht).
2. Nutzerseitige Temp-Dateien.
3. Agentseitige Temp-Dateien.
4. Chat-Verlauf (kaskadiert Nachrichten-Metadaten, Thread-Todos, Genehmigungen, Branches, Feedback, Chat-Filter-Events, Artefakte und ihre Revisionen, Unter-Threads, Agent-Komponenten-Nachrichten, dann die `threadMetadata`-Zeile selbst).
5. Audit-Logs (schreibt eine Checkpoint-Zeile, die den Ketten-Kopf, Anzahl und Maximum-Zeitstempel erfasst, damit die SHA-256-Hash-Kette über den Schnitt hinweg verifizierbar bleibt).
6. Workflow-Logs.
7. Chat-Filter-Events.
8. Nutzungs-Ledger.

Login-Versuche sind E-Mail-bezogen (nicht org-bezogen) und laufen als einzelner globaler Durchgang mit fester 30-Tage-TTL. Per-Org-`loginAttemptRetentionDays`-Konfiguration regiert diesen Sweep nicht, und die TTL ist absichtlich nicht env-tunbar, um den Brute-Force-Forensik-Boden über Deployments hinweg einheitlich zu halten.

## Legal Hold

Wenn eine `legalHolds`-Zeile für `(organizationId, targetType, targetId)` existiert und `releasedAt` undefiniert ist, weigert sich der Bereinigungs-Runner, die passende Entität physisch zu löschen. Der Hold ist klebrig: `restoreChatThread` weigert sich ebenfalls, solange ein Hold aktiv ist.

Zieltypen: `thread`, `document`, `execution`, `userMembership`, `org`. Ein Whole-Org-Hold (`targetType: 'org'`) kurzschließt den gesamten Bereinigungs-Pass für diese Org.

Holds werden über `placeLegalHold` gesetzt (nur Admin). Freigabe ist ein zweistufiger Maker-Checker-Ablauf: irgendein Admin reicht über `requestLegalHoldRelease` ein, und ein anderer Admin genehmigt über `approveLegalHoldRelease`. Die Genehmigung legt einen 24-Stunden-Cooldown an (konfigurierbar über `TALE_LEGAL_HOLD_RELEASE_COOLDOWN_HOURS`) plus eine 5-Minuten-Mindestverzögerung zwischen Antrag und Genehmigung, um verkettete Aufrufe abzuwehren. `rejectLegalHoldRelease` ist der Ablehnungspfad. Selbst-Genehmigung wird verweigert, außer der Operator zieht es per `TALE_LEGAL_HOLD_SINGLE_ADMIN_OK=true` ausdrücklich vor (Single-Admin-Deployments); das Audit-Log notiert `legal_hold_release_approved_self`, damit die Umgehung laut ist.

Org-bezogene Holds (der "halt all retention"-Hold) verlangen standardmäßig Doppelkontrolle; das Setzen wird verweigert, außer `TALE_LEGAL_HOLD_SINGLE_ADMIN_OK=true` ist gesetzt. Das Schließen einer `legalMatter` über `closeLegalMatter` reicht automatisch einen ausstehenden Freigabe-Antrag für jeden verlinkten aktiven Hold ein; die Genehmigung verlangt immer noch einen zweiten Admin pro verlinkten Hold — der Matter-Close gibt nicht automatisch frei. Freigegebene Holds werden im Audit-Trail in der Tabelle behalten und nie physisch gelöscht.

Der Bereinigungs-Runner holt jeden aktiven Hold einmal pro Lauf vorab, sodass laufende Läufe eine konsistente Momentaufnahme sehen. Holds, die mitten im Lauf gesetzt werden, schützen den nächsten Lauf; das kurze Fenster ist nach ISO 27050 akzeptabel, weil die Bereinigung täglich ist.

## Audit-Chain-PII-Schutz

Das Audit-Log wird jahrelang aufbewahrt (Voreinstellung 730 Tage, Boden 365). Damit diese Kette keine langlebigen Klartext-E-Mail-Adressen und IPs aus nicht authentifiziertem Nutzer-Input (besonders fehlgeschlagene Login-Versuche) trägt, setze `TALE_AUDIT_PEPPER` auf ein einzigartiges Geheimnis von mindestens 16 Zeichen. Neue Audit-Zeilen speichern dann einen HMAC-SHA256-Hash der E-Mail und ein grobes Netzwerk-Präfix der IP (`/24` für v4, `/64` für v6) in dedizierten `actorEmailHash`- und `actorIpHash`-Spalten; die Klartext-Spalten bleiben leer. Bestehende Zeilen werden nicht überschrieben — die Rotation entwertet die Korrelation über die Grenze hinweg, was der Wille des Operators ist.

Wenn `TALE_AUDIT_PEPPER` ungesetzt oder kürzer als 16 Zeichen ist, fallen Audit-Schreiber auf Klartext zurück und loggen beim ersten Aufruf eine einmalige `[SECURITY]`-Warnung auf stderr. Setze die Variable in Produktion, bevor du das Deployment echten Nutzern aussetzt.

`TALE_AUDIT_SIGNING_KEY` (getrennt vom Pepper) signiert die Audit-Log-Checkpoint-Zeilen, damit der Integritäts-Prüfer eine bewusste Aufbewahrungs-/PII-Scrub-Grenze von Manipulation unterscheiden kann. Ohne Signing-Schlüssel ist die Kette über die SHA-256-Kette selbst noch manipulations-erkennbar; die Signatur ist Defense-in-Depth gegen einen Angreifer, der sowohl Zeilen löschen als auch einen frischen Checkpoint fälschen kann.

## DSGVO Art. 17 Löschung

Für verifizierte Subjekt-Löschanträge ruft ein Admin `requestErasure(organizationId, userId, reason)` auf, um sofort jeden Thread, den der genannte Nutzer in dieser Org besitzt, kaskadiert zu löschen. Das umgeht das Aufbewahrungs-Gnadenfenster und den Cooldown-bei-Verkürzung, damit Löschung "ohne unangemessene Verzögerung" nach Art. 17 passiert. Verweigert, wenn ein passender Legal Hold aktiv ist; die Antwort listet gehaltene Elemente zur Referenz für den Admin auf.

Der Audit-Subtyp `gdpr_erasure_executed` (Kategorie `admin`) erfasst den Akteur, die Begründung, die gelöschten Threads und jede blockiert-von-Hold-Liste.

## Was gelöscht wird

Zeilen werden aus der Datenbank gelöscht. Zugehörige Dateien werden aus dem Object Storage gelöscht. Vektor-Embeddings für gelöschte Dokumente werden aus dem Wissens-Store entfernt. Für die Chat-Verlauf-Aufbewahrung wird jede Nachfahren-Zeile — Nachrichten, Metadaten, Todos, Feedback, Artefakte und der Rest — über den geteilten Helfer kaskadiert gelöscht, damit Nutzer-Löschung und Aufbewahrungs-Löschung nie auseinanderdriften, welche Tabellen bereinigt werden. Die Audit-Log-Aufbewahrung schreibt an jeder Stapel-Grenze eine Checkpoint-Zeile, damit die SHA-256-Hash-Kette verifizierbar bleibt.

## Wo das einsetzt

Aufbewahrung ist die Per-Tabelle-Lebensdauer-Politik für alles, was Tale speichert. Die Voreinstellungen sind konservativ; die Per-Org-Overrides kommen aus [Governance](/de/platform/admin/governance); und jede Umgebungsvariable, die das Aufbewahrungsverhalten steuert, ist in der [Umgebungsreferenz](/de/self-hosted/configuration/environment-reference) katalogisiert. Greif zu dieser Seite, wenn eine Compliance-Person fragt, wie lange eine bestimmte Tabelle lebt; greif zu Governance, wenn die Antwort für einen bestimmten Mandanten geändert werden muss.
