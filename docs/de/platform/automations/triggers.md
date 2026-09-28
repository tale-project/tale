---
title: Automatisierungen automatisch starten
description: Richte Zeitpläne, Webhooks und Plattform-Ereignisse ein, prüfe die Eingaben und finde die Ursache ausbleibender Starts.
---

Im Abschnitt **Trigger** im Tab **Allgemein** einer Automatisierung legst du fest, wann sie selbstständig startet. Jeder Trigger führt die Live-Version im Live-Modus aus. Teste den Workflow vorher mit der tatsächlich gelieferten Eingabestruktur und prüfe seine externen Aktionen.

## Den Auslöser wählen

| Trigger-Typ | Geeignet für | Eingabe des Laufs |
| --- | --- | --- |
| **Zeitplan** | Wiederkehrende Arbeit zu einer Ortszeit oder in festen Abständen. | `{ trigger: "schedule", firedAt: <epoch ms> }` |
| **Webhook** | Zustellungen eines anderen Systems. | `{ trigger: "webhook", payload: … }` |
| **Plattform-Ereignis** | Ein benanntes Ereignis innerhalb der Organisation. | `{ trigger: "event", event: "…", payload: … }` |

Eine Automatisierung hat jeweils einen konfigurierten Trigger. Ein anderer Typ ersetzt die bisherige Bindung. Ersetzt du einen Webhook, wird seine URL sofort ungültig. Ein später angelegter Webhook stellt diese Zugangsdaten nicht wieder her.

API- und MCP-Clients können auch ohne Trigger starten. API-Schlüssel und Projektberechtigungen autorisieren den Aufruf; der Client übergibt die Workflow-Eingabe direkt. Näheres steht in der [API-Referenz](/de/develop/api-reference).

## Einen Zeitplan einrichten

<Steps>

<Step title="Trigger-Einstellungen öffnen">

Öffne die Automatisierung und darin den Tab **Allgemein**. Ohne Bindung steht im Abschnitt **Trigger**, dass die Automatisierung nur von Hand oder über die API läuft; wähle **Trigger hinzufügen** und dann unter **Trigger-Typ** den **Zeitplan**. Ein neuer Trigger ist zunächst nicht **Aktiv** — lass ihn ausgeschaltet, solange der Workflow noch nicht selbstständig starten soll.

</Step>

<Step title="Zeitpunkt eingeben">

Fülle **Cron** aus und wähle die **Zeitzone**. Die fünf Cron-Felder bedeuten Minute, Stunde, Tag des Monats, Monat und Wochentag. Nutze eine IANA-Zeitzone wie `Europe/Zurich`, wenn die örtliche Geschäftszeit zählt. Ohne Angabe gilt UTC.

</Step>

<Step title="Prüfen und speichern">

Prüfe den nächsten angezeigten Zeitpunkt und klick neben den Tabs auf **Speichern**. Kontrolliere, ob die Live-Version die oben gezeigte Zeitplan-Eingabe akzeptiert. Schalte den fertigen Trigger mit **Aktiv** ein und speichere erneut. Den nächsten gestarteten Lauf findest du unter **Läufe**.

</Step>

</Steps>

```text
*/15 * * * *     alle fünfzehn Minuten
0 9 * * 1-5      werktags um 09:00 Uhr
0 6 1 * *        am Monatsersten um 06:00 Uhr
30 8 1 * 1       am Monatsersten und jeden Montag um 08:30 Uhr
```

Die Felder erlauben `*`, Zahlen, Bereiche, Schrittweiten und kommagetrennte Listen. 0 und 7 stehen beide für Sonntag. Sind Monatstag und Wochentag eingeschränkt, genügt eine Übereinstimmung. Das letzte Beispiel läuft daher montags und am ersten Tag jedes Monats.

Die Ortszeit folgt den Sommerzeitregeln der Zeitzone. Ein Zürcher Zeitplan für 09:00 Uhr bleibt örtlich bei 09:00 Uhr. Die Auflösung beträgt eine Minute. Während eines Ausfalls verpasste Termine werden nicht nachgeholt; der nächste reguläre Termin setzt den Betrieb fort. Unmögliche Kalenderdaten werden beim Speichern abgelehnt.

## Einen Webhook empfangen

Wähle **Webhook** und speichere, um die Zugangsdaten zu erzeugen. Kopiere die vollständige URL, sobald sie erscheint. Der Token wird einmal gezeigt und nur als Hash gespeichert. Der Abschnitt bietet eine Organisations-URL und ein Muster für Projekt-URLs. Nutze für ein aktives Projekt mit installierter Automatisierung die Projekt-URL. Eine Automatisierung mit Projektzuordnung kann nicht über die reine Organisations-URL starten.

Sende eine kleine Nutzlast an die URL. JSON landet als `payload` innerhalb der Eingabe, nicht unmittelbar auf deren oberster Ebene. Andere Anfrageinhalte werden als Text weitergereicht. Die Grenze liegt bei 256 KiB; große Dokumente lädst du separat hoch. Eine angenommene Anfrage liefert die Lauf-ID, ohne auf das Ende zu warten.

Die gesendete Nutzlast `{ "invoiceId": "inv-1" }` erreicht den Workflow beispielsweise so:

```json
{
  "trigger": "webhook",
  "payload": { "invoiceId": "inv-1" }
}
```

Verwende eine Zustellungs-ID, etwa `Idempotency-Key` oder einen unterstützten Header des Absenders. Dieselbe ID liefert innerhalb von 24 Stunden den ursprünglichen Lauf zurück. Ohne ID gilt ein identischer Inhalt an derselben URL innerhalb von zwei Minuten als Duplikat. Vergib unterschiedliche IDs, wenn identische Inhalte getrennte Arbeit bedeuten. [Webhooks](/de/develop/webhooks) beschreibt Header, Projektpfade, Fehler und Antwortformate.

<Warning>

Die URL berechtigt zum Start. Bewahre sie wie Zugangsdaten auf und gib sie nur dem sendenden System. **Token rotieren** erzeugt einen Ersatz und macht die alte URL ungültig. Entfernen oder Ersetzen des Triggers widerruft sie ebenfalls. Aktualisiere den Absender nach einer Rotation.

</Warning>

## Auf ein Plattform-Ereignis reagieren

Wähle **Plattform-Ereignis** und unter **Ereignisname** das Ereignis. Speichere und aktiviere den fertigen Trigger. Das Eingabeschema muss die Struktur mit `trigger`, `event` und `payload` aus der Tabelle akzeptieren. Von Automatisierungsläufen ausgelöste Ereignisse starten keine Trigger. So erzeugt ein Workflow durch seine eigenen Änderungen keine endlose Startschleife.

Erwartet ein Workflow Pflichtfelder wie `owner` und `repo` auf oberster Ebene, passen Zeitplan-Metadaten oder eine eingepackte Webhook-Nutzlast nicht unverändert dazu. Passe Schema und Verweise an oder starte per API mit diesen Feldern. Die Trigger-Einstellungen bieten keine frei definierbaren gespeicherten Eingabefelder.

## Einen ausgebliebenen Start untersuchen

Prüfe zuerst **Aktiv**, die Live-Version und den letzten Auslösezeitpunkt. Lies anschließend einen gegebenenfalls protokollierten Grund:

| Grund oder Symptom | Was du prüfst |
| --- | --- |
| `not_deployed` | Schalte eine getestete Version live. Ein gespeicherter Entwurf reicht nicht. |
| `start_refused` | Vergleiche das Eingabeschema der Live-Version mit der Trigger-Struktur und behebe den gemeldeten Start- oder Validierungsfehler. |
| `unusable_cron` | Korrigiere Ausdruck oder Zeitzone und speichere erneut. Andere Zeitpläne laufen währenddessen weiter. |
| `paused_after_failures` | Der Zeitplan hat sich nach wiederholten Fehlern selbst ausgeschaltet. Siehe [Wenn sich ein Zeitplan selbst pausiert](#wenn-sich-ein-zeitplan-selbst-pausiert). |
| Webhook-Zugang abgelehnt | Prüfe aktuelle URL und Aktivierung. Unbekannte und deaktivierte Tokens liefern absichtlich dieselbe Ablehnung. |
| Lauf vorhanden, aber nicht beendet | Öffne die [Ausführungsprotokolle](/de/platform/automations/execution-logs). Der Start gelang; das Problem liegt im Lauf. |

Der letzte Auslösezeitpunkt ändert sich erst bei einem tatsächlichen Start. Ein fälliger Trigger, der nicht starten kann, protokolliert stattdessen den ausgelassenen Start. So erkennst du den Unterschied zu einem gestarteten Workflow, der später scheitert.

## Wenn sich ein Zeitplan selbst pausiert

Scheitern die Läufe eines Zeitplans bei jedem Termin auf dieselbe Weise, würde er sonst endlos weiter fehlschlagen. Tale zählt deshalb die Läufe eines Triggers, die an einem Fehler scheitern, den ein erneuter Versuch nicht behebt: am eigenen Code der Automatisierung (`node_error`), an einem Connector (`connector_error`), an einer Modellantwort, die nicht zu ihrem Schema passt (`llm_output_invalid`), oder am Modellanbieter der Organisation (`auth_error`, `missing_api_key`, `credit_exhausted`, `model_not_found`). Ein erfolgreicher Lauf setzt die Zählung zurück. Andere Fehler, etwa ein Ratenlimit oder ein nicht erreichbarer Anbieter, zählen nicht mit und setzen die Zählung auch nicht zurück. Hat sich ein Zeitplan bereits selbst pausiert, behält er die Zählung, die zur Pause geführt hat, auch wenn ein Lauf, der zu diesem Zeitpunkt noch lief, danach erfolgreich endet. Erst das Speichern des Triggers setzt die Zählung zurück.

Nach fünf solchen Fehlern in Folge schaltet der Zeitplan **Aktiv** aus und protokolliert `paused_after_failures`. Der Abschnitt **Trigger** zeigt dann die Pause, Code und Zeitpunkt des letzten Fehlers sowie **Lauf ansehen**, das diesen Lauf öffnet. Scheitern Läufe, während der Zeitplan noch aktiv ist, zeigt der Abschnitt, wie viele nacheinander fehlgeschlagen sind. Inhaber und Admins erhalten eine Benachrichtigung über die Glocke, per E-Mail zusätzlich, wenn die Organisation ein verbundenes Postfach hat; das Audit-Log hält die Pause fest. Unter **Einstellungen > Benachrichtigungen** können sie diese Hinweise mit **Automatisierungs-Warnungen** abschalten.

Öffne den fehlgeschlagenen Lauf, lies den Fehler und behebe ihn in der Automatisierung oder in ihrer Verbindung. Schalte danach **Aktiv** ein und speichere. Jedes Speichern des Triggers beginnt die Zählung neu, ob es den Zeitplan wieder einschaltet oder ausgeschaltet lässt, und markiert die Hinweise als gelesen.

Webhook- und Plattform-Ereignis-Trigger zählen Fehler genauso, werden aber nie pausiert. Ihre Läufe bringen eine Zustellung oder ein Ereignis mit, das ein pausierter Trigger verwerfen würde.

## Den Trigger pausieren oder ersetzen

Schalte **Aktiv** aus und speichere. Konfiguration und Laufhistorie bleiben erhalten; erneutes Einschalten setzt die Starts fort. **Trigger entfernen** löscht die Bindung und macht bei einem Webhook dessen URL unbrauchbar.

Trigger gehören zum Namen der Automatisierung, nicht zu einer Version. Live-Schaltung und Rollback behalten Zeitplan oder URL bei und ändern die Version künftiger Läufe. Eine Trigger-Änderung erzeugt keine Workflow-Version. Prüfe die Einstellungen daher auch bei einer Live-Schaltung, die erwartete Eingaben verändert.
