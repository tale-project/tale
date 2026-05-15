---
title: Trigger
description: Wie Workflows starten — Zeitpläne, Events, Webhooks und manuelle Starts.
---

Jeder Workflow braucht mindestens einen Trigger. Der Trigger definiert, _wann_ der Workflow startet und _mit welchem Input_. Ein Workflow kann mehrere Trigger gleicher oder unterschiedlicher Art haben.

Trigger werden auf dem **Start**-Schritt des Workflows konfiguriert.

## Zeitplan-Trigger

Lasse den Workflow nach Zeitplan laufen.

- Gib einen Cron-Ausdruck direkt ein (`0 9 * * 1-5` läuft um 9 Uhr UTC an Werktagen).
- Oder nutze den KI-Assistenten neben dem Feld, um Cron aus natürlicher Sprache zu erzeugen ("jeden Werktag um 9 Uhr").
- Quick-Presets: alle 5 Minuten, stündlich, täglich, wöchentlich, monatlich.

Alle Zeitpläne laufen in **UTC**. Wenn dein Team in einer anderen Zeitzone ist, rechne vor dem Eintragen um.

## Event-Trigger

Lasse den Workflow laufen, wenn in Tale etwas passiert.

| Event                      | Beispiel-Einsatz                                          |
| -------------------------- | --------------------------------------------------------- |
| Neuer Kunde hinzugefügt    | Eine Willkommens-E-Mail senden.                           |
| Neue Konversation geöffnet | Die Konversation basierend auf der Kundenhistorie taggen. |
| Genehmigung angefordert    | Einen Slack-Kanal benachrichtigen.                        |
| Dokument hochgeladen       | Metadaten extrahieren und klassifizieren.                 |
| Produktbestand ≤ Schwelle  | Nachbestellen oder die Beschaffung alarmieren.            |

Jeder Event-Typ unterstützt optionale Filter. Der Filter greift, bevor der Workflow startet — unpassende Events werden still übersprungen.

## Webhook-Trigger

Jeder Workflow bekommt eine eigene Webhook-URL, an die du POSTen kannst. Nutze Webhook-Trigger, wenn etwas außerhalb von Tale den Workflow starten soll — ein Formular-Submit, ein Upstream-System-Event, ein CI/CD-Hook.

- Der Anfrage-Body steht jedem Schritt als Workflow-Input zur Verfügung.
- Füge ein Webhook-Secret hinzu, um Anfrage-Authentizität zu prüfen. Tale prüft den Kopfzeile `X-Tale-Signature` und lehnt nicht passende Anfragen ab.
- Die Webhook-URL ist auf dem Start-Schritt und im **Konfiguration**-Tab des Workflows sichtbar.

Siehe [Webhooks](/de/develop/webhooks) für detaillierte Anfrage-/Response-Formate und Signatur-Verifizierungs-Code.

## Manuelle Trigger

Der **Ausführen**-Button auf jedem Workflow erlaubt einen manuellen Start mit eigenem Input. Nützlich für:

- einen neuen Workflow testen, bevor du ihn einplanst;
- einmalige Runs, wenn der Workflow existiert, aber nicht automatisch laufen soll;
- Backfills anstoßen.

Manuelle Läufe erscheinen genau wie andere Läufe im **Ausführungen**-Tab.

## Mehrere Trigger auf einem Workflow

Ein Workflow kann z. B. sowohl per Zeitplan (jede Stunde) als auch per Webhook (on-demand) getriggert werden. Jede Ausführung zeigt, welcher Trigger sie gestartet hat.

## Wo das hingehört

Trigger sind die Grenze zwischen Tale und allem anderen. Ein Workflow ohne Trigger tut nichts; ein Workflow mit dem richtigen Trigger läuft genau im richtigen Moment mit genau dem richtigen Input. Die vier Arten — Zeitplan, Event, Webhook, manuell — decken fast alles ab: Regelarbeit per Zeitplan, reaktive Arbeit per Event oder Webhook, Ausnahmefälle manuell.

Für eingehende Webhooks im Speziellen deckt [Webhooks](/de/develop/webhooks) das Signatur-Schema und ein durchgearbeitetes Beispiel in cURL, Node und Python ab. Um zu sehen, was ein Trigger gefeuert und was er übergeben hat, springe zu [Ausführungslogs](/de/platform/automations/execution-logs).
