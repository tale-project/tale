---
title: Anfragen betroffener Personen
description: Reiche Löschanfragen ein, verwalte Freigaben und Fristen und prüfe den daraus entstehenden Beleg.
---

Als Admin oder Inhaber bearbeitest du unter **Einstellungen > Richtlinien > Anfragen betroffener Personen** Löschanfragen. Tale verfolgt die Anfrage, ihre Freigabe und Wartezeit sowie das Ergebnis der Löschung. Prüfe vor der Einreichung Identität und passenden Umfang nach dem Verfahren deiner Organisation.

<Frame caption="Richtlinien > Anfragen betroffener Personen — die Richtlinie für Löschanfragen (Karenzzeit, Doppelfreigabe, Tageslimit) über der Liste der Anfrage-Belege mit Anfrage einreichen.">

![Die Einstellungsseite Anfragen betroffener Personen zeigt das Karenzzeit, den Schalter für die Vier-Augen-Freigabe und die Tageslimit-Felder über einer Tabelle der Löschungs-Anfragen mit einer offenen Anfrage — betroffene Person Jordan Blake, Begründungs-Code Einwilligung widerrufen, noch 24 Stunden bis zur Ausführung und 29 Tage SLA-Frist —, daneben die Schaltfläche Anfrage einreichen.](/images/platform/governance-data-subject-requests.webp)

</Frame>

## Eine Anfrage einreichen

1. Wähle **Anfrage einreichen** und suche die **Person** nach Name oder E-Mail. Prüfe, ob du das richtige Konto ausgewählt hast.
2. Wähle den **Rechtsgrund** und schreibe unter **Begründung**, worum es geht. Verweise auf deinen internen Fall.
3. Gib exakt `ERASE` ein und wähle **Anfrage einreichen**.
4. Öffne den Beleg und prüfe Status, Frist und die nächste erforderliche Aktion.

Die Löschung entfernt betroffene Daten endgültig; sie verschiebt sie nicht in den Papierkorb. Der Beleg erfasst Kategorien und Anzahlen, darunter Chats, Dokumente und Uploads, Einstellungen, Feedback, Benachrichtigungen, Nutzung und das Bereinigen von Personenkennungen im Audit-Protokoll.

## Vorher die Richtlinie prüfen

| Einstellung | Wirkung |
| --- | --- |
| **Karenzzeit (Stunden)** | Wartezeit von 0–72 Stunden vor der Ausführung. Admins können währenddessen abbrechen. Null erlaubt die sofortige Ausführung, sobald alle anderen Voraussetzungen erfüllt sind. |
| **Doppelfreigabe erforderlich** | Ein anderer Admin muss zustimmen, bevor die Karenzzeit beginnt. Die einreichende Person kann nicht selbst freigeben. |
| **Tägliches Limit pro Admin** | Begrenzt jeden Admin auf 1–50 Einreichungen pro Tag. |

Nur der Inhaber kann diese Richtlinie ändern. Strengere Schutzmaßnahmen gelten sofort. Lockerungen werden 24 Stunden vorgemerkt, damit jeder Admin sie abbrechen kann. Prüfe die wirksamen Einstellungen und Hinweise auf ausstehende Änderungen, bevor du mit einem neuen Wert planst.

## Den Beleg verfolgen

| Zustand | Nächster Schritt |
| --- | --- |
| Ausstehend / wartet auf Freigabe | Prüfe, ob ein zweiter Admin zustimmen oder die Karenzzeit enden muss. Brich ab oder lehne ab, wenn die Anfrage nicht ausgeführt werden soll. |
| Läuft | Warte auf die Kategorieergebnisse und reiche keine doppelte Anfrage ein. |
| Abgeschlossen | Prüfe die Anzahlen und bewahre den Beleg bei deinem Fall auf. |
| Teilweise | Untersuche übersprungene Kategorien und Fehler. Behebe die Ursache vor einem neuen Versuch. |
| Blockiert | Prüfe den [Legal Hold](/de/platform/admin/governance/legal-hold). Betroffene Daten bleiben geschützt. |
| Fehlgeschlagen | Lies die Fehlerdetails. Nutze **Erneut versuchen**, wenn verfügbar. Bei einem Watchdog-Timeout kann eine neue Anfrage nötig sein. |
| Abgebrochen | Dieser Beleg plant keine weitere Ausführung. Reiche bei Bedarf eine neue Anfrage ein. |

Ein offener Beleg kann eine zweite Anfrage für dieselbe Person verhindern. Arbeite mit diesem Beleg weiter. War die Anfrage schon bei der Einreichung blockiert, muss ein neuer Versuch erneut die aktuelle Freigabe- und Wartezeitregel erfüllen.

## Die Frist verwalten

Die Liste zeigt die erfasste Frist und mögliche Überschreitungen. Nutze **Frist verlängern** für eine begründete Verlängerung, solange die Aktion verfügbar ist. Die Anwendung erlaubt eine Verlängerung vor Ablauf der ursprünglichen Frist und protokolliert Grund und Admin.

Die Frist unterstützt die Nachverfolgung. Deine Organisation bleibt für die Prüfung und die Kommunikation mit der Person verantwortlich. Ein abgeschlossener Tale-Beleg bestätigt für sich allein keine Löschung in unabhängigen externen Systemen oder Backups.

## Das Ergebnis prüfen

Öffne die Kategorieanzahlen, Fehler und Audit-Zeitleiste des Belegs. Eine abgeschlossene Aktion, eine gesperrte Kategorie und ein fehlgeschlagener Durchlauf haben unterschiedliche Ergebnisse. Halte diese Unterschiede im Fall fest. Zugehörige Admin-Ereignisse findest du in den [Audit-Logs](/de/platform/admin/governance/audit-logs).
