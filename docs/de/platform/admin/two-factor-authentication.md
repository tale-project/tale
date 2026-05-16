---
title: Zwei-Faktor-Authentifizierung
description: Einen TOTP-Zweitfaktor bei der Passwort-Anmeldung erzwingen, das eigene Konto einrichten, Backup-Codes verwalten und ein Mitglied zurücksetzen, das sein Gerät verloren hat.
---

Zwei-Faktor-Authentifizierung fügt der Passwort-Anmeldung einen Einmal-Code aus einer Authenticator-App hinzu. Tale verwendet TOTP — dasselbe Protokoll, das Google Authenticator, 1Password, Authy und die meisten Passwort-Manager umsetzen — zusammen mit einmal nutzbaren Backup-Codes zur Wiederherstellung. Der Faktor gilt nur für Konten, die sich mit Passwort anmelden; Nutzer über SSO oder vertrauenswürdige Kopfzeilen erben die MFA-Entscheidung ihres Identitätsanbieters und sehen die Tale-Prompts nie.

Auf dieser Seite zählen zwei Oberflächen. **Konto > Sicherheit** ist die Stelle, an der jeder Nutzer sein eigenes Konto einrichtet, Backup-Codes neu erzeugt oder den zweiten Faktor abschaltet. **Einstellungen > Richtlinien > Zwei-Faktor-Authentifizierung** ist die Stelle, an der Admins die organisationsweite Erzwingung setzen, und **Einstellungen > Mitglieder** ist die Stelle, an der Admins den zweiten Faktor eines Mitglieds zurücksetzen, das sein Gerät verloren hat.

## Eigenes Konto einrichten

Öffne das Avatar-Menü und wähle **Konto**. Klicke unter **Sicherheit** auf **Zwei-Faktor aktivieren**. Tale bestätigt dein Passwort und zeigt dann einen QR-Code und ein manuelles Geheimnis.

1. Scanne den QR-Code mit einer Authenticator-App oder gib das Geheimnis manuell ein, falls du nicht scannen kannst.
2. Gib den 6-stelligen Code aus der App ein. Tale verifiziert ihn vor der Aktivierung der Zwei-Faktor-Authentifizierung, sodass ein falscher Scan dich nie aussperren kann — der Dialog bleibt offen, bis der Code passt.
3. Speichere die **Backup-Codes**, die Tale danach zeigt. Jeder Code funktioniert einmal und ist der einzige Weg zurück in dein Konto, falls du den Authenticator verlierst. Tale zeigt die Codes genau einmal — lade sie jetzt herunter oder kopiere sie.

Aus demselben Bildschirm kannst du **Backup-Codes neu erzeugen** (macht den alten Satz ungültig) oder **Deaktivieren** (verlangt erneute Passwort-Bestätigung). Ein Banner für wenige Codes erscheint, sobald du unter den Schwellenwert fällst, damit du neu erzeugst, bevor der letzte Code weg ist.

## Mit Zwei-Faktor anmelden

Nach der Passwort-Eingabe fragt Tale den 6-stelligen Code. Der Verifizierungs-Bildschirm hat zwei Modi:

- **Authenticator-App** — die Voreinstellung. Tippe den aktuellen Code aus der App.
- **Backup-Code** — schalte auf **Stattdessen einen Backup-Code verwenden** um, wenn du den Authenticator nicht hast. Jeder Code wird bei der Nutzung verbraucht; eine Wiederverwendung wird abgelehnt. Eine Erinnerung an wenige Codes greift unter fünf verbleibenden Codes.

Wiederholte Fehlversuche werden mit demselben Backoff wie falsche Passwort-Versuche rate-limitiert. Sperrungen werden im Audit-Log unter der Kategorie **Sicherheit** festgehalten.

## Zwei-Faktor organisationsweit erzwingen

Öffne **Einstellungen > Richtlinien > Zwei-Faktor-Authentifizierung**. Das Formular nimmt drei Einstellungen:

- **Zwei-Faktor-Authentifizierung verlangen** — der Hauptschalter. Solange aus, ist Zwei-Faktor für jeden Nutzer optional.
- **Schonfrist (Tage)** — wie viele Tage jeder Nutzer ab seiner ersten Anmeldung unter der Richtlinie hat, bevor die Einrichtung erzwungen wird. `0` setzt die sofortige Erzwingung; eine längere Spanne ist sinnvoll, wenn du Zwei-Faktor in einer bestehenden Organisation ausrollst, damit Mitglieder den Zugang nicht verlieren. Mitglieder in ihrer Schonfrist sehen ein Banner, das an die Einrichtung erinnert; ist die Schonfrist um, kommen sie nicht über den Anmelde-Bildschirm hinaus, bis sie eingerichtet haben.
- **SSO-only-Nutzer ausnehmen** — ist aktiv, sind Konten, deren einziger Anmelde-Weg eine föderierte Identität ist (Microsoft Entra ID, OIDC), ausgenommen, weil der Upstream-IdP deren MFA steuert. Ein Nutzer mit sowohl SSO-Konto als auch Passwort ist **nie** ausgenommen, weil das Passwort ein Umgehungs-Weg ist.

Klicke **Speichern**, um die Einstellung anzuwenden.

## Zwei-Faktor eines Mitglieds zurücksetzen

Öffne **Einstellungen > Mitglieder**, klicke das Zeilen-Menü des betroffenen Nutzers und wähle **Zwei-Faktor zurücksetzen**. Der Bestätigungs-Dialog beschreibt die Folge — Zwei-Faktor wird für diesen Nutzer deaktiviert, jede aktive Sitzung endet, und er muss bei der nächsten Anmeldung neu einrichten. Nutze die Aktion, wenn ein Mitglied seinen Authenticator verloren und alle Backup-Codes aufgebraucht hat. Jede Zurücksetzung wird im Audit-Log festgehalten, damit Sicherheitsteams den Pfad nachvollziehen können.

## Audit-Events

Jede Zwei-Faktor-Aktion schreibt einen strukturierten Audit-Log-Eintrag unter **Einstellungen > Richtlinien > Audit-Logs**, Kategorie **Sicherheit**:

| Aktion                   | Wann sie ausgelöst wird                                                                         |
| ------------------------ | ----------------------------------------------------------------------------------------------- |
| `2fa_enrolled`           | Ein Nutzer schließt die Einrichtung ab.                                                         |
| `2fa_disabled`           | Ein Nutzer deaktiviert Zwei-Faktor an seinem eigenen Konto.                                     |
| `2fa_verified`           | Eine erfolgreiche TOTP-Prüfung bei der Anmeldung.                                               |
| `2fa_verify_failed`      | Eine fehlgeschlagene TOTP-Prüfung.                                                              |
| `2fa_backup_code_used`   | Ein Backup-Code wurde erfolgreich verbraucht.                                                   |
| `2fa_backup_code_failed` | Ein Backup-Code-Versuch ist gescheitert.                                                        |
| `2fa_reset_by_admin`     | Ein Admin hat den Zwei-Faktor eines Mitglieds aus **Einstellungen > Mitglieder** zurückgesetzt. |

## Wo das hingehört

Zwei-Faktor-Authentifizierung ist die Zweitfaktor-Schicht auf der Passwort-Anmeldung. Sie steht in Wechselwirkung mit zwei weiteren Oberflächen: [Authentifizierung](/de/self-hosted/admin/authentication) entscheidet, ob sich ein Nutzer über Passwort (wo Zwei-Faktor gilt), SSO oder vertrauenswürdige Kopfzeilen (wo der Upstream-IdP den zweiten Faktor besitzt) anmeldet; [Mitglieder und Rollen](/de/platform/admin/members-and-roles) ist die Stelle, an der der Admin den Zwei-Faktor eines Mitglieds zurücksetzt, wenn das Gerät verloren ist. Die organisationsweite Erzwingungs-Richtlinie lebt auf dieser Seite; die breitere Richtlinien-Oberfläche, die Budgets, Aufbewahrung und Guardrails hält, ist [Richtlinien](/de/platform/admin/governance).
