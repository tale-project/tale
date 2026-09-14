---
title: Zwei-Faktor-Authentifizierung
description: Sichere dein Konto mit Authenticator oder Passkey, bewahre Backup-Codes auf und richte die Richtlinie für deine Organisation ein.
---

Sichere dein Konto mit einer Authenticator-App oder einem Passkey. Mitglieder richten ihre Anmeldemethoden unter **Einstellungen > Konto** ein. Admins können einen zweiten Faktor verlangen und Mitgliedern helfen, wieder Zugang zu bekommen.

## Eine Anmeldemethode wählen

| Methode | Was du brauchst | So meldest du dich an |
| --- | --- | --- |
| Authenticator-App | Ein Tale-Passwort und eine App für zeitbasierte Codes (TOTP) | Gib dein Passwort und danach den sechsstelligen Code aus der App ein. |
| Passkey | Ein geeignetes Gerät oder einen Sicherheitsschlüssel | Bestätige die Browserabfrage mit deinem Gerät oder Schlüssel. Das geht auch nach der Anmeldung mit Passwort. |
| Backup-Code | Einen gespeicherten Code aus der Authenticator-Einrichtung | Verwende ihn einmal anstelle des Authenticator-Codes, wenn du die App nicht nutzen kannst. |

Ein Passkey erfüllt Tales Zwei-Faktor-Richtlinie auch ohne eingerichteten Authenticator. Bei Konten, die sich ausschließlich per SSO anmelden, fehlt die Authenticator-Einrichtung: Sie setzt ein Tale-Passwort voraus. Die SSO-Ausnahme deiner Organisation bestimmt, ob du einen Tale-Passkey brauchst.

## Einen Authenticator einrichten

1. Öffne **Einstellungen > Konto**, gehe zu **Sicherheit** und wähle **Zwei-Faktor aktivieren**.
2. Gib dein aktuelles Tale-Passwort ein und wähle **Bestätigen**.
3. Scanne den QR-Code mit deiner Authenticator-App. Falls das nicht geht, gib den angezeigten Einrichtungsschlüssel manuell in der App ein.
4. Gib den aktuellen sechsstelligen Code unter **Bestätigungscode** ein und wähle **Prüfen und aktivieren**.
5. Lade die Backup-Codes herunter oder kopiere sie, bevor du **Fertig** wählst. Tale zeigt sie später nicht noch einmal an.

Auf der Kontoseite steht jetzt, dass Zwei-Faktor-Authentifizierung aktiv ist. Bei der nächsten Anmeldung mit Passwort gibst du einen Code aus demselben Authenticator-Eintrag ein.

<Tip>
Bewahre Backup-Codes so auf, dass du sie auch ohne dein Anmeldegerät erreichst, etwa in einem Passwortmanager auf einem weiteren vertrauenswürdigen Gerät.
</Tip>

## Einen Passkey hinzufügen

1. Wähle unter **Einstellungen > Konto > Sicherheit** die Aktion **Passkey hinzufügen**.
2. Trage unter **Passkey-Name** einen Namen ein, den du wiedererkennst, etwa `Arbeitslaptop`.
3. Lass **Authenticator-Typ** auf **Beliebig (empfohlen)**, damit der Browser alle verfügbaren Möglichkeiten anbietet. Alternativ wählst du den eingebauten Authenticator oder einen Sicherheitsschlüssel beziehungsweise ein Smartphone.
4. Wähle **Passkey hinzufügen** und bestätige die Browserabfrage.

Der Passkey erscheint in deiner Kontoliste. Wähle auf der Anmeldeseite **Mit einem Passkey anmelden**. Nach einer Passwortanmeldung kannst du auf der Bestätigungsseite auch **Stattdessen einen Passkey verwenden** wählen.

Um einen Passkey nicht mehr zu verwenden, wähle bei ihm **Entfernen** und bestätige. War er dein einziger zweiter Faktor und verlangt deine Organisation einen, musst du einen neuen einrichten.

## Zugang wiederherstellen und Codes ersetzen

Wähle auf der Bestätigungsseite **Stattdessen einen Backup-Code verwenden** und gib einen gespeicherten Code ein. Jeder Code funktioniert einmal. Brauchst du danach neue Codes, öffne **Einstellungen > Konto** und wähle **Backup-Codes neu erzeugen**. Bestätige dein Passwort und sichere die neuen Codes. Dadurch werden alle bisherigen Codes ungültig, auch unbenutzte.

Wird ein Code abgelehnt, prüfe den Authenticator-Eintrag für dieses Tale-Konto, verwende den aktuellen Code und kontrolliere die Geräteuhr. Wiederholte Fehlversuche können die Bestätigung vorübergehend sperren. Folge dann der angezeigten Meldung, statt weitere Codes einzureichen.

Hast du weder Authenticator noch Passkey oder Backup-Code zur Hand, wende dich an einen Admin deiner Organisation. Schicke ihm weder dein Passwort noch den Einrichtungsschlüssel oder übrige Codes.

## Einen zweiten Faktor für die Organisation verlangen

Admins richten die Richtlinie unter **Einstellungen > Richtlinien > Sicherheit** ein. Lege vorher einen Kontakt für Zugangsprobleme fest und gib den Mitgliedern Zeit, eine Methode einzurichten.

<Frame caption="Die Sicherheitseinstellungen enthalten Passwort-, Anmelde- und Zwei-Faktor-Richtlinien. Scrolle für die Einrichtungspflicht zu Zwei-Faktor-Authentifizierung.">

![Sicherheitseinstellungen mit Anmeldelimits und Passwortanforderungen oberhalb der Zwei-Faktor-Richtlinie.](/images/platform/governance-security-monitoring.webp)

</Frame>

| Einstellung | Wirkung |
| --- | --- |
| **Zwei-Faktor-Authentifizierung verlangen** | Aktiviert die Pflicht nach einer Bestätigung. Ein registrierter Passkey oder Authenticator erfüllt sie. |
| **Übergangsfrist (Tage)** | Zeit für die Einrichtung ab der ersten Anmeldung des Mitglieds unter dieser Richtlinie. Null verlangt sie sofort. |
| **Nur-SSO-Benutzer ausnehmen** | Mitglieder ohne Tale-Passwort verlassen sich auf die Anmeldung ihres Identitätsanbieters. |

Während der Übergangsfrist sehen Mitglieder eine Erinnerung. Danach sperrt Tale den Organisationszugang, bis sie eine Methode einrichten. Deinen eigenen Authenticator zu deaktivieren, hebt die Richtlinie nicht auf.

## Einem ausgesperrten Mitglied helfen

Prüfe zuerst die Identität der Person nach dem Wiederherstellungsprozess deiner Organisation. Öffne dann **Einstellungen > Mitglieder**, bearbeite das Mitglied und wähle **Zwei-Faktor zurücksetzen**. Die Bestätigung entfernt die Authenticator-Einrichtung und beendet alle aktiven Sitzungen. Die Person kann sich erneut anmelden und einen neuen Authenticator einrichten. Gilt die Pflicht, muss sie die Einrichtung abschließen, bevor sie weiterarbeiten kann.

Ist ein Passkey verloren gegangen, entferne stattdessen diesen Eintrag im Abschnitt **Passkeys** des Mitglieddialogs. Auch das beendet alle Sitzungen des Mitglieds. Die Wiederherstellungsaktionen findest du in den [Audit-Logs](/platform/admin/governance/audit-logs).
