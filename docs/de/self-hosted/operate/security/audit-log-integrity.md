---
title: Audit-Log-Integritätswarnungen
description: Wie du reagierst, wenn die tägliche Integritätsprüfung des Audit-Logs eine Warnung auslöst.
---

Tale verifiziert die Audit-Log-Hash-Kette jeder Organisation nach Zeitplan und löst in dem Moment eine Warnung aus, in dem eine Verifizierung fehlschlägt. Diese Seite ist das Runbook für den Operator oder Admin, der diese Warnung erhalten hat: wie du den Befund liest, wie du ein echtes Manipulationssignal von einem gewöhnlichen Aufbewahrungs- oder Konfigurationsartefakt trennst und was du sicherst, bevor du irgendetwas anfasst. Die Warnung ist absichtlich laut, weil ein echter Bruch selten und ernst ist — aber die meisten Brüche, die in der Praxis feuern, haben eine alltägliche Erklärung, also besteht die Arbeit darin, diese methodisch auszuschließen, statt in Panik zu verfallen.

## Was sie auslöst

Ein täglicher Cron läuft die append-only Audit-Kette jeder Organisation samt ihrer Aufbewahrungs- und Scrub-Checkpoints ab. Wenn eine Kette nicht verifiziert, tut der Lauf zwei Dinge. Er schreibt eine In-Band-Audit-Zeile der Kategorie `security` — bei jedem fehlschlagenden Lauf, damit der dauerhafte Datensatz immer vollständig ist — und er löst eine Out-of-Band-Benachrichtigung an die Admins der Organisation aus, in der Benachrichtigungsglocke und in deinem Slack-Kanal, wenn einer verbunden ist.

Die Out-of-Band-Warnung ist dedupliziert. Du bekommst eine Benachrichtigung, wenn ein Bruch zuerst erkannt wird, und nur dann eine weitere, wenn er sich ändert — eine andere gebrochene Zeile oder ein anderer fehlschlagender Checkpoint — nicht jeden Tag einen frischen Alarm für denselben Bruch. Ein späterer sauberer Lauf räumt die Warnung von selbst ab; ein späterer, anderer Bruch löst eine neue aus.

## Manipulation oder Konfigurationslücke

Die Warnung kommt in zwei Formen, und der Titel sagt dir, welche. **Integritätsprüfung des Audit-Logs fehlgeschlagen** ist die kritische: Die Hash-Kette selbst verifiziert nicht, oder die Signatur eines signierten Checkpoints passt nicht zum konfigurierten Schlüssel. Behandle das als mögliches Manipulationssignal, bis du es erklärt hast.

**Audit-Log-Signaturen können nicht überprüft werden** ist eine ruhige Warnung, kein Einbruch: Ein Checkpoint ist signiert, aber das Deployment hat keinen `TALE_AUDIT_SIGNING_KEY` konfiguriert, gegen den sich die Signatur prüfen ließe. Nichts wurde gefälscht — Tale kann nur nicht beweisen, dass der Checkpoint echt ist, bis du den Schlüssel wiederherstellst. Das Panel im Produkt spiegelt die Trennung: Eine gesunde Kette zeigt das grüne Badge **Verifiziert**, ein aktiver Vorfall das rote Badge **Integritätswarnung aktiv**, und eine Organisation, die der Cron noch nicht erreicht hat, zeigt **Noch nicht geprüft**.

## Das Integritäts-Panel öffnen

Die Admins einer Organisation inspizieren die Kette unter **Einstellungen > Richtlinien > Audit-Logs**. Das Panel **Ketten-Integrität** oben auf der Seite zeigt das Status-Badge, den Zeitpunkt der letzten automatischen Prüfung und einen Knopf **Jetzt prüfen**, der dieselbe Verifizierung auf Abruf erneut fährt. Kommst du aus der Benachrichtigung, führt dich ein Klick auf die Warnung per Deep-Link direkt zur markierten Zeile in der Audit-Tabelle statt an den Anfang des Logs.

Fahre **Jetzt prüfen**, um den strukturierten Befund zu sehen. Bei einem Bruch der Hash-Kette zeigt das Panel **Ketten-Integrität verletzt** mit der **Eintrags-ID** der ersten fehlschlagenden Zeile, wann er **Aufgetreten** ist, dem **Erwarteter Hash** und dem **Gespeicherter Hash**, der nicht passte — plus einem Knopf **Diesen Eintrag öffnen**, der die Zeile in der Tabelle aufdeckt. Bei einem Checkpoint-Problem zeigt es **Checkpoint-Prüfung fehlgeschlagen** mit der **Checkpoint-ID** und einem **Grund**. Halte diese Details fest, bevor du irgendetwas änderst: Sie sind der Beweis.

## Die harmlosen Ursachen ausschließen

Ein Hash-Bruch ist nur dann ein Manipulationssignal, wenn nichts Legitimes ihn erklärt, und der Verifizierer kennt die drei gewöhnlichen Ereignisse bereits, die fast jede Warnung verursachen — sie zu bestätigen ist dein erster Zug.

**Ein Aufbewahrungsschnitt.** Wenn die Aufbewahrung alte Zeilen endgültig löscht, zeigt der überlebende Kettenkopf auf eine Zeile, die nicht mehr existiert. Der Verifizierer verankert die Kette über den Schnitt hinweg neu, über einen signierten Aufbewahrungs-Checkpoint — ein sauberer Schnitt verifiziert also normal. Siehst du stattdessen **Audit-Log-Signaturen können nicht überprüft werden**, ist der Schnitt selbst in Ordnung — dem Deployment fehlt der `TALE_AUDIT_SIGNING_KEY`, der den Checkpoint beglaubigt. Das ist eine Konfigurationslücke, keine Manipulation.

**Ein DSGVO-Scrub.** Das Löschen einer betroffenen Person leert ihre Felder an Ort und Stelle, was die Hashes dieser Zeilen ändern würde — deshalb schreibt ein Scrub einen signierten Scrub-Checkpoint über die betroffenen Zeilen, und der Verifizierer vertraut ihnen auf dieser Grundlage. Ein Scrub sollte auf einem Deployment mit Signierschlüssel nie als Bruch auftauchen.

**Alte Zeilen aus der Zeit vor der Kette.** Zeilen, die geschrieben wurden, bevor es die Audit-Hash-Verkettung gab, tragen keinen Integritäts-Hash. Der Verifizierer überspringt sie automatisch; sie sind kein Bruch.

Ein echtes Manipulationssignal ist ein Hash-Unterschied ohne jede dieser Erklärungen: kein Aufbewahrungsschnitt an dieser Stelle, kein Scrub über der Zeile, und der Signierschlüssel vorhanden und korrekt.

## Auf einen echten Bruch reagieren

Übersteht der Befund diese Triage — ein Hash-Unterschied, den du nicht erklären kannst —, behandle ihn als Sicherheitsvorfall und sichere zuerst die Beweise. Audit-Zeilen sind absichtlich append-only; lösche oder bearbeite keine Zeile, auch nicht die markierte, denn das zerstört den Datensatz, von dem eine Untersuchung abhängt.

1. Halte den Befund wörtlich fest — die **Eintrags-ID**, die Zeit unter **Aufgetreten**, **Erwarteter Hash** und **Gespeicherter Hash** (oder die **Checkpoint-ID** und den **Grund**) aus dem Panel. Kopiere sie oder mach einen Screenshot, statt dich allein auf die Warnung zu verlassen.
2. Bestätige, ob der Signierschlüssel auf dem Host konfiguriert ist, damit du einen echten Unterschied von einem nicht verifizierbaren Checkpoint unterscheiden kannst. Das meldet die Anwesenheit, ohne das Geheimnis auszugeben:
   ```bash
   grep -q '^TALE_AUDIT_SIGNING_KEY=' .env && echo configured || echo missing
   ```
3. Korreliere den Zeitstempel des Bruchs mit jüngerer Aktivität — einem Aufbewahrungslauf, einem Scrub einer betroffenen Person, einem Deploy, einer Datenbank-Wiederherstellung oder direktem Datenbankzugriff. Ein Bruch, der mit einer Wartungsaktion zusammenfällt, hat meist eine gewöhnliche Ursache, die du jetzt benennen kannst.
4. Erklärt ihn nichts, eskaliere über deine Security-Incident-Richtlinie und behandle die Datenbank als potenziell kompromittiert, bis das Gegenteil bewiesen ist. Bewahre je einen Backup-Snapshot von vor und nach dem erkannten Bruch für die Forensik auf.

## Die Warnung abräumen

Die Warnung ist vorfallbasiert, kein wiederkehrendes Ereignis. Sobald der Bruch behoben oder erklärt ist — der Schlüssel wiederhergestellt, das Aufbewahrungsartefakt verstanden, eine manipulierte Datenbank aus einem sauberen Backup neu aufgebaut —, verifiziert der nächste tägliche Lauf sauber und räumt die Warnung von selbst ab, und das Badge **Ketten-Integrität** kehrt zu **Verifiziert** zurück. Es gibt keinen Bestätigen- oder Verwerfen-Schritt, den du dir merken müsstest. Taucht später ein anderer Bruch auf, löst die Prüfung dafür eine frische Warnung aus — Stummschalten ist also nie nötig.

## Wo das einzuordnen ist

Eine Integritätswarnung ist eine Aufforderung zur Untersuchung, kein Urteil — die tägliche Prüfung läuft laut, damit sich ein seltener echter Bruch nicht zwischen den Logs verstecken kann, und dieses Runbook trennt diesen seltenen Fall von den Aufbewahrungs- und Scrub-Artefakten hinter den meisten Warnungen. Der Mechanismus, den der Verifizierer prüft — die SHA-256-Hash-Kette und die HMAC-signierten Checkpoints — ist in [Kryptografie](/de/self-hosted/operate/security/cryptography) dokumentiert, und die Aufbewahrungsschnitte, die sie legitim neu verankern, stehen in [Aufbewahrung](/de/self-hosted/configuration/retention). Das Panel, die Spalten und der Export, mit denen du eine markierte Zeile liest, leben in der Referenz [Audit-Logs](/de/platform/admin/governance/audit-logs); die Checkliste [Härtung](/de/self-hosted/operate/security/hardening) ist der Ort, an dem dieses Monitoring überhaupt erst eingeschaltet wird.
