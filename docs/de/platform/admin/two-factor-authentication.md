---
title: Zwei-Faktor-Authentifizierung
description: TOTP-Registrierung, Passkeys, Backup-Codes, die organisationsweite Erzwingungsrichtlinie und wie ein Admin ein Mitglied zurücksetzt, das seinen Authenticator verloren hat. Lies das, wenn du 2FA für die Org verdrahtest oder einen Account wiederherstellst.
---

Zwei-Faktor-Authentifizierung legt einen zweiten Identitätsbeweis über das Passwort — einen sechsstelligen Code aus einer Authenticator-App oder einen WebAuthn-Passkey. Tale bringt TOTP (zeitbasierte Einmal-Passwörter) mit, kompatibel zu Google Authenticator, 1Password, Authy und jeder anderen App, die dem Standard folgt, plus Passkeys als phishing-resistente Alternative. Die Seite deckt die Pro-Benutzer-Registrierung ab, Passkeys, die Backup-Codes, die einen Account wiederherstellen, wenn das Telefon weg ist, die organisationsweite Erzwingungsrichtlinie und das Admin-Reset für ein ausgesperrtes Mitglied.

Zwei-Faktor ist standardmäßig optional. Admins können sie für die ganze Organisation verpflichtend machen, mit einem Karenzfenster, damit Mitglieder Zeit zum Einrichten haben.

## Pro-Benutzer-Registrierung

Um 2FA für deinen eigenen Account einzuschalten, öffne **Konto > Sicherheit**. Klick auf **Zwei-Faktor aktivieren**, bestätige dein Passwort und scanne den QR-Code mit einer Authenticator-App. Tippe den sechsstelligen Code ein, den die App zeigt, um zu prüfen, dass das Geheimnis aufgenommen wurde, und sichere dann die Backup-Codes, die der nächste Bildschirm zeigt. Die Codes erscheinen einmal — lade oder kopiere sie, bevor du auf **Fertig** klickst.

Derselbe Bildschirm trägt **Deaktivieren** und **Backup-Codes neu erzeugen**. Deaktivieren entfernt den zweiten Faktor; Neu-Erzeugen entwertet jeden vorherigen Backup-Code. Beide Aktionen verlangen das Account-Passwort zur Bestätigung.

## Backup-Codes

Backup-Codes sind einmal verwendbare Strings, die die Plattform prägt, wenn 2FA aktiviert oder neu erzeugt wird. Jeder davon ersetzt den Authenticator-Code bei einem einzelnen Sign-in — nützlich, wenn das Telefon verloren ist, der Authenticator deinstalliert wurde oder du irgendwo ohne das Gerät feststeckst. Die Plattform beobachtet die verbleibende Anzahl und zeigt ein Niedrig-Banner, wenn nur noch wenige Codes übrig sind; das Banner verlinkt direkt auf den Neu-Erzeugen-Flow.

Behandle Backup-Codes wie Passwörter. Lege sie in einen Passwort-Manager oder drucke sie und schließe sie weg. Wer dein Passwort und einen Backup-Code hat, kann sich als du anmelden.

## Passkeys

Ein Passkey ist ein WebAuthn-Credential — Face ID, Touch ID, Windows Hello oder ein Hardware-Security-Key —, das bei jeder Anmeldung eine Challenge signiert, statt einen getippten Code zu liefern. Das Credential ist an die Origin der Site gebunden; eine täuschend ähnliche Phishing-Domain bekommt nichts, was sie wiederverwenden könnte. Ein Passkey ist dadurch phishing-resistent auf eine Art, die TOTP nicht erreicht, und er erfüllt eine erzwungene Zwei-Faktor-Richtlinie genau wie TOTP.

Zum Registrieren öffne **Konto > Sicherheit** und klick auf **Passkey hinzufügen**. Gib dem Credential einen Namen, den du später wiedererkennst, und wähle den **Authenticator-Typ**: **Beliebig (empfohlen)** lässt den Browser alles anbieten, was verfügbar ist, **Dieses Gerät (Face ID, Touch ID, Windows Hello)** beschränkt die Zeremonie auf den eingebauten Authenticator, und **Security-Key oder Smartphone** auf einen externen. Den Rest erledigt der Browser mit der Registrierungszeremonie. Jeder Eintrag in derselben Liste trägt eine **Entfernen**-Schaltfläche (Symbol) zum Widerrufen deiner eigenen Credentials; sie fragt vor dem Entfernen des Passkeys nach einer Bestätigung.

Ein registrierter Passkey funktioniert an drei Türen. Auf dem Login-Bildschirm meldet dich **Mit einem Passkey anmelden** ohne Passwort an — das Credential ist selbst ein starker Nachweis. Auf dem Bestätigungs-Bildschirm nach einem Passwort-Login ersetzt **Stattdessen einen Passkey verwenden** den sechsstelligen Code. Und auf dem Registrierungs-Bildschirm, zu dem eine erzwungene Richtlinie nicht registrierte Mitglieder leitet, sitzt **Stattdessen einen Passkey registrieren** neben der TOTP-Einrichtung — ein Mitglied, das nur einen Passkey registriert und nie TOTP, besteht die Richtlinie.

Verliert ein Mitglied ein Gerät mit einem Passkey darauf, widerruft ein Admin das Credential: Öffne **Einstellungen > Mitglieder**, klick beim Mitglied auf **Mitglied bearbeiten** und entferne das Credential im Abschnitt **Passkeys** des Dialogs. Tale löscht das Credential und beendet jede aktive Sitzung des Mitglieds, sodass ein verlorener oder gestohlener Authenticator keine Sitzung am Leben hält. Der Admin-Widerruf landet im Audit-Log als `passkey.revoked_by_admin`.

## Die Erzwingen-für-Org-Richtlinie

Admins können Zwei-Faktor für jedes passwortauthentifizierte Mitglied der Organisation verpflichtend machen. Öffne **Einstellungen > Richtlinien > Sicherheit** und schalte unter **Zwei-Faktor-Authentifizierung** die Option **Zwei-Faktor-Authentifizierung verlangen** ein. Die Richtlinie trägt eine Karenzzeit (in Tagen), die jedem Mitglied vom ersten Sign-in unter der Richtlinie an Zeit zur Registrierung gibt; setz sie auf null für sofortige Erzwingung.

<Frame caption="Einstellungen > Richtlinien > Sicherheit — Limits für Anmeldeversuche und Passwort-Richtlinie; die Richtlinie für die Zwei-Faktor-Authentifizierung sitzt weiter unten auf derselben Seite.">

![Die Governance-Seite Sicherheit & Überwachung zeigt die Felder für die Limits der Anmeldeversuche und die Zeichenklassen-Anforderungen der Passwort-Richtlinie; die Zwei-Faktor-Richtlinie steht weiter unten auf derselben Seite.](/images/platform/governance-security-monitoring.webp)

</Frame>

| Feld                                    | Typ      | Pflicht | Beschreibung                                                                                                                           |
| --------------------------------------- | -------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Zwei-Faktor-Authentifizierung verlangen | Schalter | ja      | Aus hält 2FA für jedes Mitglied optional; ein schaltet die Richtlinie an.                                                              |
| Karenzzeit (Tage)                       | Ganzzahl | ja      | Tage ab dem ersten angemeldeten Moment eines Mitglieds unter der Richtlinie, bevor die Registrierung verlangt wird. Null heißt sofort. |
| Nur-SSO-Benutzer ausnehmen              | Schalter | nein    | Wenn an, vertrauen Mitglieder, deren einziger Account eine föderierte Identität ist, dem vorgelagerten IdP für MFA.                    |

Ein Mitglied innerhalb des Karenzfensters sieht ein Countdown-Banner in der App, das auf den Registrierungs-Flow zeigt. Sobald die Karenz abläuft, leitet der nächste Sign-in durch den Registrierungs-Bildschirm, und das Mitglied kann erst weiter, nachdem es registriert ist.

## Admin-Reset für ein ausgesperrtes Mitglied

Wenn ein Mitglied sein Telefon und seine Backup-Codes verliert, entfernt ein Admin den zweiten Faktor auf seinem Account. Öffne **Einstellungen > Mitglieder**, klick beim Mitglied auf **Mitglied bearbeiten** und dann auf **Zwei-Faktor zurücksetzen** im Dialog. Tale deaktiviert 2FA für den Account und beendet jede aktive Sitzung, sodass sich das Mitglied beim nächsten Sign-in neu registriert.

Das Zurücksetzen wird im Audit-Log unter `2fa_reset_by_admin` festgehalten. Greif dazu als Wiederherstellungs-Aktion — das Mitglied sollte sich sofort neu registrieren, wenn es wieder drin ist.

## Wo das hingehört

Zwei-Faktor sitzt eine Schicht über dem Passwort — gleicher Login-Bildschirm, zweiter Schritt. Paar es mit [Mitglieder und Rollen](/de/platform/admin/members-and-roles) (der Admin, der den zweiten Faktor zurücksetzt, ist derselbe Admin, der den Account verwaltet), mit [Richtlinien und Limits](/de/platform/admin/governance/policies-and-limits) (die Erzwingungsrichtlinie lebt in der Governance-Oberfläche) und mit [Audit-Logs](/de/platform/admin/governance/audit-logs) (jede Registrierung, Deaktivierung und jedes Admin-Reset landet dort).
