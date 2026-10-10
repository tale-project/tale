---
title: Einstellungen über MCP
description: Lass einen Coding-Agenten die Einstellungen von Tale über den MCP-Endpunkt lesen und ändern — im Rahmen der Rolle der Person, deren API-Schlüssel er nutzt.
---

Ein Coding-Agent, der mit dem [MCP-Endpunkt](/de/develop/mcp-endpoint) verbunden ist, liest die Einstellungen deiner Organisation, plant eine Änderung und nimmt sie vor — mit drei Tools: `get_settings`, `plan_settings` und `apply_settings`. Er handelt mit der Rolle der Person, deren API-Schlüssel er nutzt. Er darf ändern, was diese Person in der App ändern dürfte, und durchläuft dieselben Prüfungen. Die [Audit-Logs](/de/platform/admin/governance/audit-logs) halten jede Änderung als Änderung dieser Person fest, vorgenommen über MCP.

## Was ein Agent ändern kann {#kinds}

Tale liest und schreibt jede Art von Einstellung mit seinem eigenen Code und den Prüfungen, die auch die App vornimmt. Deshalb gelten dieselben Rollenregeln wie in der App.

| Art                    | Was sie enthält                                                                                                                                                                       | Änderungen                                                           | Wer sie ändern darf                                                                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `provider`             | Ein KI-Anbieter, den deine Organisation selbst angelegt hat: sein Endpunkt, sein API-Format und sein Modellkatalog. Die Anbieter, die Tale mitbringt, sind keine Einstellungen.       | Setzen, löschen; den Modellkatalog neu einlesen (`refresh-catalogs`) | Inhaber, Admins und Entwickler                                                                                                                                |
| `provider-credential`  | Zugangsdaten, die ihren Schlüssel aus einer Umgebungsvariable des Deployments lesen. Zugangsdaten mit Schlüssel oder Abonnement erscheinen ohne ihr Secret und lassen sich entfernen. | Setzen, löschen                                                      | Inhaber, Admins und Entwickler                                                                                                                                |
| `governance`           | Eine Richtlinie der Organisation, benannt nach ihrem Schlüssel: Modelle und Modellzugriff, Budgets und Limits, Anmelde- und Sitzungssicherheit, Guardrails, Sandbox-Kontingente.      | Setzen                                                               | Inhaber und Admins                                                                                                                                            |
| `knowledge-embedding`  | Das Embedding-Modell des Wissens deiner Organisation, mit seiner Ähnlichkeitsschwelle und seinen Nutzungsgrenzen.                                                                     | Setzen                                                               | Inhaber und Admins                                                                                                                                            |
| `branding`             | Die Akzentfarbe und die Dateinamen von Logo und Favicons.                                                                                                                             | Setzen                                                               | Inhaber und Admins                                                                                                                                            |
| `project-instructions` | Die festen Anweisungen eines Projekts.                                                                                                                                                | Setzen                                                               | Wer das Projekt bearbeiten darf                                                                                                                               |
| `agent-instructions`   | Die Anweisungen eines Projekt-Agenten.                                                                                                                                                | Setzen                                                               | Wer das Projekt bearbeiten darf                                                                                                                               |
| `agent-tools`          | Die Tools, die ein Projekt-Agent nutzen darf.                                                                                                                                         | Setzen                                                               | Wer das Projekt bearbeiten darf                                                                                                                               |
| `agent-model` | Die Agent-Laufzeit (Harness), das Modell und der Anbieter, mit denen ein Projekt-Agent läuft. Eine Änderung gilt für die Läufe, die er danach startet. | Setzen | Wer das Projekt bearbeiten darf |
| `task-instructions`    | Die Beschreibung einer Aufgabe.                                                                                                                                                       | Setzen                                                               | Wer die Aufgabe ändern darf                                                                                                                                   |
| `task-review-context` | Ob die Arbeit an einer Aufgabe ein unabhängiges Review durch einen anderen Projekt-Agenten erhält, und durch welchen. Einmal gesetzt, bleibt der Reviewer-Agent derselbe. | Setzen | Wer das Projekt bearbeiten darf |
| `deployment`           | Die eigenen Einstellungen des Deployments, die für jede Organisation darauf gelten, etwa die Sandbox-Laufzeit.                                                                        | Setzen                                                               | Lesen darf sie jeder Inhaber und Admin einer Organisation auf dem Deployment; ändern dürfen sie nur die Adressen auf der Editor-Freigabeliste des Deployments |

Eine Ressource hat innerhalb ihrer Art eine ID: ein Anbieter seinen Namen, Zugangsdaten `<provider>/<name>` mit URI-kodiertem Namen, eine Richtlinie ihren Schlüssel wie `password_policy`, ein Projekt seine ID, ein Agent `<projectId>/<agentId>` und eine Aufgabe `<projectId>/<taskId>`. Embedding-Modell, Branding und Deployment-Einstellungen haben keine ID. `get_settings` listet Projekt- und Agenteneinstellungen seitenweise über die Projekte, die du lesen darfst; die Beschreibung einer Aufgabe und ihren Review-Kontext liest es nur über die ID der Aufgabe.

Manche Änderungen bleiben in Tale:

- Jedes Secret, etwa der API-Schlüssel eines Anbieters, ein Abonnement oder der Schlüssel des Moderationsanbieters, gibt eine Person in Tale ein.
- Die Aufbewahrungsrichtlinie und die Richtlinie für Anfragen betroffener Personen ändern sich nur über ihre eigenen, gestuften Abläufe.
- Branding-Bilder werden in Tale hochgeladen. Ein Dateiname, den ein Agent setzt, muss ein bereits hochgeladenes Bild nennen.
- Über MCP ändert sich das Embedding-Modell selbst nur, solange das Wissen der Organisation kein Dokument und keine Website enthält. So treffen Vektoren zweier Modelle nie in einer Suche aufeinander. Ähnlichkeitsschwelle und Nutzungsgrenzen ändern sich jederzeit; sind Dokumente indexiert, ändert eine Person das Modell in Tale.
- Der Standard-Agent eines Projekts folgt der Richtlinie `standard_agent`, die die Art `governance` ändert; seine eigenen Anweisungen, Tools und sein Modell sind keine Einstellungen.
- Mitglieder, Teams, Connectors, Skills, Kompetenzen, Legal Holds, die Audit-Logs, Metriken und persönliche Einstellungen deckt keine Art ab. `get_settings` ohne Argumente zeigt, was jede Art abdeckt.

## Eine Änderung vornehmen {#make-a-change}

1. Ruf `get_settings` ohne Argumente auf. Die Antwort listet jede Art, ob dieses Deployment sie bedient und ob deine Rolle sie lesen und ändern darf.
2. Lies mit `get_settings` und `kinds` (und `ids`), was du ändern willst. Jede Ressource kommt mit ihrem `key`, ihrer `config` und ihrem `hash`.
3. Plane die Änderung mit `plan_settings`. Ein `set` ersetzt die ganze Ressource durch ihre `config`. Schick deshalb jedes Feld mit, das erhalten bleiben soll, so wie du es gelesen hast. Der Plan nennt für jede Änderung ihre Aktion, ihren Diff, ihre Auswirkungen und ihr Risiko oder die Ablehnung, an der sie scheitert. Geschrieben wird dabei nichts.
4. Zeig der Person den Plan und warte auf ihre Entscheidung. Stell die Auswirkungen und das Risiko an den Anfang.
5. Nimm dieselben Änderungen mit `apply_settings` vor. `expected` ordnet dem `key` jeder geänderten Ressource den Hash zu, den du gelesen hast, oder `null` für eine, die du anlegst.

So sehen die Argumente eines Plans aus, der die Passwort-Rotation einschaltet:

```json
{
  "changes": [
    {
      "kind": "governance",
      "id": "password_policy",
      "op": "set",
      "config": {
        "minLength": 12,
        "requireUpper": true,
        "requireLower": true,
        "requireDigit": true,
        "requireSpecial": true,
        "rotationDays": 90
      }
    }
  ]
}
```

Der Plan nennt die Auswirkung auf die Mitglieder, denn die Rotation lässt bereits gesetzte Passwörter ablaufen. Der Hash ist hier gekürzt:

```json
{
  "ok": true,
  "changes": [
    {
      "kind": "governance",
      "id": "password_policy",
      "key": "governance/password_policy",
      "op": "set",
      "action": "update",
      "currentHash": "5c1f…",
      "diff": [{ "path": "/rotationDays", "before": 0, "after": 90 }],
      "effects": ["may-lock-out-members"],
      "risk": "critical"
    }
  ]
}
```

Zum Übernehmen schickst du dieselben `changes` mit `"expected": { "governance/password_policy": "5c1f…" }`, mit dem vollständigen Hash. Bevor etwas geschrieben wird, plant Tale jede Änderung noch einmal gegen das, was jetzt gespeichert ist. Wird eine abgelehnt oder hat sich eine Ressource seit dem Lesen geändert, wird nichts übernommen. Sonst laufen die Änderungen in einer festen Reihenfolge über die Arten hinweg, damit das, worauf eine Ressource verweist, zuerst existiert. Die erste Änderung, die scheitert, hält die übrigen an, und die Antwort listet, was übernommen wurde (`applied`), was gescheitert ist (`failed`) und was übersprungen wurde (`skipped`). Was bereits übernommen wurde, wird nicht rückgängig gemacht.

`apply_settings` fragt die Person vor jedem Aufruf und hat ein eigenes [Budget](/de/develop/rate-limits).

## Die Auswirkungen eines Plans lesen {#effects}

Das Risiko eines Plans ist das höchste aus dem Grundrisiko seiner Art und dem Risiko seiner Auswirkungen. Diese Auswirkungen können die heute bedienten Arten nennen:

| Auswirkung                | Risiko   | Wann ein Plan sie nennt                                                                                                                             |
| ------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `may-lock-out-members`    | critical | Die Anmeldesperre ist nach der Änderung aktiv, die Passwort-Rotation beginnt oder wird kürzer, oder die Zwei-Faktor-Authentifizierung wird strenger |
| `signs-out-members`       | critical | Das Inaktivitätslimit wird eingeschaltet oder kürzer                                                                                                |
| `removes-human-approval`  | critical | Eine Freigaberegel oder eine Prüfpflicht fragt keine Person mehr                                                                                    |
| `changes-serving-account` | high     | Der Endpunkt eines Anbieters ändert sich, oder andere Zugangsdaten bedienen seine Anfragen                                                          |
| `breaks-dependents`       | high     | Die aktiven Standard-Zugangsdaten des Anbieters werden entfernt, und nichts ersetzt sie                                                             |
| `requires-empty-corpus`   | critical | Das Embedding-Modell ändert sich; das setzt voraus, dass das Wissen der Organisation leer ist                                                                                     |
| `restart-required`        | critical | Die Sandbox-Laufzeit des Deployments ändert sich                                                                                                    |
| `reaches-vendor`          | high     | Der Modellkatalog eines Anbieters wird mit dem Schlüssel deiner Organisation neu eingelesen                                                         |

Die Einstellungsreferenz, die `get_docs` für das Thema `settings` liefert (auch `tale://docs/settings`), listet das ganze Vokabular, die Felder jeder Art und jede Richtlinie.

## Secrets {#secrets}

Kein Secret geht in einen Einstellungsaufruf hinein oder kommt aus ihm heraus. Ein gespeichertes Secret erscheint als `{"masked": true, "preview": "…"}`, ebenso alle Zugangsdaten, die irgendwo sonst in einer gespeicherten Einstellung stehen — etwa ein Schlüssel, den jemand in Tale in eine Richtlinie eingefügt hat. Schick diesen Wert unverändert zurück, um zu behalten, was dort gespeichert ist. Eine Änderung, die ein Secret enthält, wird mit `SECRET_ARGUMENT_REFUSED` abgelehnt; die Ablehnung nennt die Stelle, nie den Wert. Ein neues Secret gibt eine Person in Tale ein.

## Wenn eine Änderung abgelehnt wird {#refusals}

Eine Ablehnung kommt als Daten zurück, mit `error`, `code`, `hint` und manchmal `data`, nie als abgebrochene Verbindung. Diese Codes begegnen einem Agenten am häufigsten:

| Code                                                         | Was er bedeutet                                                                                                                                                  |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SETTINGS_STALE`                                             | Die Ressource hat sich seit dem Lesen geändert. Lies sie erneut, plane gegen den aktuellen Stand und übernimm mit `data.currentHash`.                            |
| `SETTINGS_INVALID`                                           | Die Konfiguration passt nicht zur Art. `data.issues` nennt jedes Problem mit seiner Stelle in der Konfiguration, auch ein Feld, das die Einstellung nicht kennt. |
| `SECRET_ARGUMENT_REFUSED`                                    | Die Änderung enthält ein Secret. `data.places` nennt die Stelle.                                                                                                 |
| `SETTINGS_TALE_ONLY`                                         | Diese Änderung geht nur in Tale, zum Beispiel bei Zugangsdaten mit Schlüssel.                                                                                    |
| `FORBIDDEN`, `ORG_FORBIDDEN`, `FORBIDDEN_DEVELOPER_SETTINGS` | Die Rolle der Person erlaubt diese Änderung auch in Tale nicht. Ein neuer Versuch hilft nicht.                                                                   |
| `EMBEDDING_CORPUS_NOT_EMPTY`                                 | Das Embedding-Modell ändert sich nur, solange das Wissen der Organisation leer ist. `data` nennt, wie viele Dokumente und Websites es enthält.                                    |
| `BRANDING_IMAGE_UNKNOWN`                                     | Ein Branding-Dateiname nennt kein Bild, das in die Organisation hochgeladen wurde.                                                                               |
| `PROVIDER_IN_USE`, `CREDENTIAL_IN_USE`                       | Zugangsdaten nennen den Anbieter noch, oder das Embedding-Modell nutzt die Zugangsdaten. Ändere zuerst diese.                                                    |

Die Einstellungsreferenz listet jeden Code. Die Seite zum [MCP-Endpunkt](/de/develop/mcp-endpoint#settings) beschreibt die Argumente und Antworten der Tools.
