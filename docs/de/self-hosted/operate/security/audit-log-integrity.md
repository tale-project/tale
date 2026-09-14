---
title: Die Integrität des Audit-Protokolls untersuchen
description: Prüfe die Audit-Kette, beachte die Grenzen der Prüfung und sichere Nachweise bei einem Fehler.
---

Nutze diese Anleitung, wenn **Ketten-Integrität** einen Bruch meldet oder du eine Benachrichtigung zur Audit-Integrität erhältst. Für den beschriebenen Weg durch die Einstellungen brauchst du ein Admin- oder Owner-Konto. Ziehe für die Untersuchung der Datenbank den Betreiber deiner Installation hinzu.

## Den geprüften Bereich feststellen

1. Öffne **Einstellungen > Governance > Protokolle** und suche **Ketten-Integrität**.
2. Notiere Status und Zeitpunkt der letzten automatischen Prüfung. **Noch nicht geprüft** bedeutet, dass noch kein Ergebnis vorliegt; es bestätigt keine erfolgreiche Prüfung.
3. Wähle **Jetzt prüfen**. Das Ergebnis nennt die Zahl der geprüften Einträge. Ein Aufruf prüft höchstens 1.000 Einträge ab dem Anfang der noch vorhandenen Kette.
4. Ist das Ergebnis unvollständig, bitte den Betreiber, den restlichen Bereich zu prüfen. Ein erneuter Klick beginnt wieder am selben Anfang. Eine fehlerfreie erste Seite belegt nicht die Integrität des gesamten Verlaufs.

Das Ergebnis dieses Aufrufs und der Status der geplanten Prüfung sind getrennt. **Jetzt prüfen** aktualisiert den Zeitpunkt der letzten automatischen Prüfung nicht.

## Verstehen, was die Prüfung abdeckt

Das aktuelle PostgreSQL-Backend prüft den SHA-256-Hash jedes noch vorhandenen, nicht bereinigten Audit-Eintrags und die Verknüpfungen zwischen den Einträgen. Die erste erhaltene Zeile liefert den Ausgangswert. So lassen sich viele Änderungen innerhalb der Kette erkennen. Die Prüfung liefert jedoch keinen unabhängig signierten Nachweis aller früheren Daten.

Die Aufbewahrungsregel kann den Anfang der Kette entfernen. Die geplante Prüfung setzt an ihrem gespeicherten Fortschritt fort. Wurde dieser Ausgangspunkt regulär durch die Aufbewahrung gelöscht, beginnt sie bei der ersten erhaltenen Verknüpfung. Fehlt ein Ausgangspunkt innerhalb des Aufbewahrungszeitraums, wird das nicht auf diese Weise akzeptiert.

Bei Einträgen, deren personenbezogene Inhalte gelöscht wurden, prüft das Backend die Verknüpfung, ohne den Hash aus den gelöschten Inhalten neu zu berechnen. Es zählt ausserdem bereinigte Zeilen ohne passenden Löschantrag. Untersuche eine solche Warnung anhand der Löschvorgänge. Das aktuelle Backend prüft keine HMAC-signierten Prüfpunkte; ein Audit-Signaturschlüssel behebt diese Befunde nicht.

<Warning title="Unabhängige Nachweise aufbewahren">
Eine Hash-Kette verhindert weder Datenbankänderungen noch belegt sie, dass jede Aktion protokolliert wurde. Schütze den Datenbankzugriff und bewahre geeignete unabhängige Nachweise auf. Eine vollständig neu geschriebene Kette lässt sich mit dieser Prüfung allein nicht zuverlässig erkennen.
</Warning>

## Einen Fehler dokumentieren

Bei einem abweichenden Hash oder einer fehlerhaften Verknüpfung zeigt das Panel **Ketten-Integrität verletzt**, die **Eintrags-ID**, den Zeitpunkt sowie **Erwarteter Hash** und **Gespeicherter Hash**. Über **Diesen Eintrag öffnen** untersuchst du das Ereignis.

1. Sichere den Befund zusammen mit Organisation, Eintrags-ID, Zeitpunkt und bereitgestellter Version. Übernimm die Werte unverändert.
2. Bewahre vor Reparaturen Datenbank-Snapshots sowie relevante Deployment-, Zugriffs- und Backup-Protokolle auf. Beschränke den Zugriff auf Kopien mit personenbezogenen Daten.
3. Vergleiche den Zeitpunkt mit Aufbewahrung, Löschung, Wiederherstellung und Wartung. Zeitliche Nähe ist ein Ermittlungsansatz, kein Beweis für einen harmlosen Fehler.
4. Folge deinem Ablauf für Sicherheitsvorfälle, wenn der Befund ungeklärt bleibt. Ändere oder lösche die betroffene Zeile nicht, nur damit die Prüfung erfolgreich wird.

Die Anleitung zu [Audit-Protokollen](/de/platform/admin/governance/audit-logs) erklärt Felder und Export. Ein gefilterter Export mit Zeilenlimit ist weder ein vollständiges Backup noch zwingend eine vollständige Kette.

## Die geplante Prüfung verfolgen

Ein täglicher Job prüft Organisationen mit Audit-Einträgen schrittweise. Ein erkannter Hash-Bruch aktiviert eine Integritätswarnung und benachrichtigt die Admins der Organisation. Wiederholte Prüfungen führen für denselben Befund nicht zu doppelten Benachrichtigungen. Ein veränderter Befund kann eine neue auslösen.

Prüfe nach Reparatur oder Wiederherstellung, ob der betroffene Bereich wieder gültig ist. Eine anschliessende erfolgreiche geplante Prüfung hebt die aktive Warnung auf. Einem Kollegen den Fehler zu erklären oder eine Benachrichtigung zu schliessen repariert die Kette nicht.

Weitere Schutzmassnahmen findest du unter [Härtung](/de/self-hosted/operate/security/hardening). Welche alten Nachweise entfernt werden, regelt die [Aufbewahrung](/de/self-hosted/configuration/retention).
