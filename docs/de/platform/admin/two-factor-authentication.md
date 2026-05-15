---
title: Zwei-Faktor-Authentifizierung
description: Zweiten Faktor bei der Anmeldung erzwingen, das eigene Konto einrichten und ein Mitglied zurücksetzen, das sein Gerät verloren hat.
---

Zwei-Faktor-Authentifizierung (2FA) ergänzt das Passwort-Login um einen Einmal-Code aus einer Authenticator-App. Tale nutzt einen TOTP-basierten zweiten Faktor — dasselbe Protokoll, das Google Authenticator, 1Password, Authy und die meisten Passwort-Manager implementieren — zusammen mit einmal nutzbaren Backup-Codes für den Wiederherstellungsfall. 2FA gilt nur für Konten, die sich mit Passwort anmelden; Nutzer, die per SSO oder Trusted Kopfzeilen authentifiziert werden, übernehmen die 2FA-Entscheidung ihres Identity-Systems und sehen die Tale-Prompts nie.

Es gibt zwei Stellen, die du kennen musst. Unter **Konto > Sicherheit** richtet jeder Nutzer 2FA selbst ein, regeneriert Backup-Codes oder deaktiviert es wieder. Unter **Einstellungen > Richtlinien** erzwingen Admins 2FA organisationsweit und setzen den zweiten Faktor zurück, wenn ein Mitglied sein Gerät verloren hat.

## Eigenes Konto einrichten

Öffne **Konto > Sicherheit** im Avatar-Menü und klicke **Zwei-Faktor aktivieren**. Tale fragt dein Passwort ab und zeigt anschließend einen QR-Code und ein Secret zur manuellen Eingabe.

1. Scanne den QR-Code mit einer Authenticator-App, oder füge das Secret manuell ein, wenn du nicht scannen kannst.
2. Gib den 6-stelligen Code aus der App ein. Tale prüft ihn, bevor 2FA aktiv wird, damit ein falscher Scan dich nie aussperrt.
3. Speichere die anschließend angezeigten **Backup-Codes**. Jeder Code funktioniert einmal und ist der einzige Weg zurück in dein Konto, wenn du deinen Authenticator verlierst. Tale zeigt die Codes genau einmal — lade sie jetzt herunter oder drucke sie aus.

Auf derselben Seite kannst du **Backup-Codes regenerieren** (alte Codes werden ungültig) oder **Zwei-Faktor deaktivieren** (Passwort-Bestätigung erforderlich). Regeneriere, sobald du einige Codes verbraucht hast — Tale blendet ein Banner ein, wenn du unter den Schwellwert fällst.

## Mit 2FA anmelden

Nach der Passwort-Eingabe fragt Tale den 6-stelligen Code ab. Der Verify-Screen kennt zwei Modi:

- **Authenticator-App** — Standard. Gib den aktuellen Code aus deiner App ein.
- **Backup-Code** — schalte _Stattdessen Backup-Code verwenden_ ein, wenn du keinen Authenticator zur Hand hast. Jeder Code wird bei der Verwendung verbraucht; eine Wiederverwendung wird abgewiesen. Tale erinnert dich daran, neu zu generieren, sobald weniger als fünf Codes übrig sind.

Wiederholte Fehlversuche werden mit demselben Back-off rate-limitiert wie falsche Passwörter. Sperrungen landen im Audit-Log.

## 2FA organisationsweit erzwingen

Öffne **Einstellungen > Richtlinien > Zwei-Faktor-Policy**. Aktiviere **Zwei-Faktor erforderlich**, damit 2FA für jedes Mitglied mit Passwort-Login zur Pflicht wird. Zwei Einstellungen bestimmen den Rollout:

- **Karenzfrist (Tage)** — wie viele Tage jeder Nutzer ab seiner ersten Anmeldung unter dieser Policy hat, bevor die Pflicht greift. Setze `0` für sofortiges Erzwingen; wähle ein längeres Fenster bei der Einführung in einer bestehenden Organisation, damit Mitglieder sich einrichten können, ohne den Zugriff zu verlieren. Wer in der Karenzfrist ist, sieht ein Banner mit der Aufforderung zur Einrichtung; nach Ablauf der Frist ist das Dashboard erst nach Einrichtung wieder erreichbar.
- **Zwei-Faktor des Mitglieds zurücksetzen** — in **Einstellungen > Mitglieder** hat das Zeilenmenü für Admins die Aktion **Zwei-Faktor zurücksetzen**. Nutze sie, wenn jemand seinen Authenticator verloren hat und keine Backup-Codes mehr besitzt. Der Reset deaktiviert 2FA für diesen Nutzer, beendet alle aktiven Sessions und erzwingt eine erneute Einrichtung bei der nächsten Anmeldung. Jeder Reset wird im Audit-Log protokolliert, damit Security-Teams die Spur nachvollziehen können.

Die Policy gilt nur für Passwort-Logins. SSO- und Trusted-Kopfzeilen-Nutzer sind **nur dann ausgenommen, wenn die Option _SSO-Nutzer ausnehmen_ in der Policy aktiv ist** — Tale geht in dem Fall davon aus, dass das Identity-System den zweiten Faktor bereits steuert. Wer sowohl ein SSO-Konto als auch ein Passwort hat, ist nie ausgenommen, weil das Passwort einen Bypass-Pfad bietet.

## Audit-Events

Jede 2FA-Aktion schreibt einen strukturierten Eintrag, sichtbar unter **Einstellungen > Richtlinien > Audit-Logs**:

| Action                   | Wann er ausgelöst wird                                                            |
| ------------------------ | --------------------------------------------------------------------------------- |
| `2fa_enrolled`           | Ein Nutzer schließt die Einrichtung ab.                                           |
| `2fa_disabled`           | Ein Nutzer deaktiviert 2FA für sein eigenes Konto.                                |
| `2fa_verified`           | Erfolgreiche TOTP-Prüfung bei der Anmeldung.                                      |
| `2fa_verify_failed`      | Fehlgeschlagene TOTP-Prüfung.                                                     |
| `2fa_backup_code_used`   | Ein Backup-Code wurde erfolgreich verbraucht.                                     |
| `2fa_backup_code_failed` | Ein Backup-Code-Versuch ist fehlgeschlagen.                                       |
| `2fa_reset_by_admin`     | Ein Admin hat den zweiten Faktor in **Einstellungen > Mitglieder** zurückgesetzt. |

## Verwandt

- [Authentifizierung](/de/self-hosted/admin/authentication) — Passwort-, SSO- und Trusted-Kopfzeilen-Login.
- [Mitglieder und Rollen](/de/platform/admin/members-and-roles) — 2FA eines Mitglieds aus dem Zeilenmenü zurücksetzen.
- [Richtlinien](/de/platform/admin/governance) — Policy setzen und Audit-Log lesen.
