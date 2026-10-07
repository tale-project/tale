---
title: Das erste Inhaberkonto erstellen
description: Schließe die Ersteinrichtung ab, prüfe die Inhaberrolle und bereite die Instanz für dein Team vor.
---
Auf einer leeren Instanz erstellt die Tale-Einrichtung das erste Konto und die erste Organisation. Dieses Konto erhält die Rolle Inhaber. Schließe die Einrichtung ab, solange du den Zugriff auf die neue Instanz kontrollierst und bevor du ihre Adresse weitergibst.

## Bereitschaft der Instanz prüfen

Öffne die von `tale dev` angezeigte Adresse oder bei einer Bereitstellung die konfigurierte `SITE_URL`. Prüfe Zertifikat und Hostname. Bei einer CLI-Bereitstellung verwende `tale status`; bei einer eigenen Bereitstellung prüfe Dienste und Gesundheitsprüfungen. Ein fehlerhaftes Backend braucht [Fehlerbehebung](/de/self-hosted/operate/observability/troubleshooting), bevor du Konten einrichtest.

Eine Anmeldeseite statt der Einrichtung bedeutet meist, dass bereits ein Konto existiert. In einer vorbereiteten Entwicklungsumgebung ist das normal. Lösche nicht die Datenbank, um Zugriff zurückzubekommen. Melde dich mit dem vorhandenen Konto an oder bitte einen Admin, dein Konto hinzuzufügen.

## Einrichtung abschließen

Öffne die Instanz-URL. Folge der Einrichtung, erstelle dein Konto und benenne die Organisation. Bewahre deine Anmeldedaten in einem Passwortmanager auf.

Öffne nach dem Erstellen von Konto und Organisation den Anbieterlink auf der Abschlussseite oder **Einstellungen > KI-Anbieter**. Ohne Anbieter kannst du die App ansehen; für eine echte Antwort brauchst du gültige Zugangsdaten und ein verfügbares Modell. [KI-Anbieter](/de/platform/admin/providers) beschreibt die Verbindung.

## Inhaberrolle bestätigen

Öffne **Einstellungen > Mitglieder** und prüfe, ob dein Konto die Rolle **Inhaber** hat. Organisation und Konto sollten zu der Instanz passen, die du einrichten wolltest.

<Frame caption="Prüfe Inhaber und Rollen der Mitglieder, bevor du dem Team Zugriff gibst.">

![Die Mitgliederseite der Organisation zeigt Personen und ihre zugewiesenen Rollen.](/images/get-started/settings-organization-members.webp)

</Frame>

Melde dich ab und erneut an, um die Zugangsdaten unabhängig von der Einrichtungssitzung zu testen. Halte einen weiteren geprüften administrativen Wiederherstellungsweg bereit, bevor du die Authentifizierung änderst.

## Teammitglieder hinzufügen {#teammitglieder-einladen}

Füge Personen unter **Einstellungen > Mitglieder** hinzu und wähle ihre Rollen bewusst. Für ein neues Konto legt das Formular ein Anfangspasswort fest; bestehende Konten behalten ihre Zugangsdaten. Dieser Ablauf versendet keine Einladungs-E-Mail. Übermittle neue Zugangsdaten über einen sicheren Kanal. Nach dem ersten Konto ist die öffentliche Selbstregistrierung geschlossen. Für Unternehmens-SSO und Bereitstellung gelten eigene [Einrichtungs- und Mitgliedschaftsregeln](/de/platform/admin/enterprise-sso).

Wenn ein Administrator ein Passwort festlegt oder zurücksetzt, muss das Mitglied bei der nächsten Anmeldung ein neues Passwort wählen; beim Zurücksetzen wird es von allen Sitzungen abgemeldet.

Das setzt das Backend selbst durch, nicht nur der Proxy davor: Sobald ein Konto existiert, antwortet `/api/auth/sign-up/email` mit 403. Das zählt, weil das Backend auch aus dem Sandbox-Netz der Agenten erreichbar ist, das der Proxy nie sieht — Code in einer Agenten-Sitzung kann also ebenfalls keine Konten anlegen. **Einstellungen > Mitglieder** legt Konten serverseitig an und bleibt davon unberührt. Eine Wegwerf-Testumgebung, die die offene Route braucht, setzt `TALE_ALLOW_OPEN_SIGN_UP=true`; auf einer echten Umgebung niemals.

Eine weitere Organisation darf jede angemeldete Person erstellen, solange du nicht festlegst, wer das darf: Setze `TALE_ORGANIZATION_CREATORS` auf deren Anmeldeadressen, dann verschwindet für alle anderen der Eintrag **Organisation erstellen** aus der Organisationsauswahl, und die API weist sie mit `403 ORGANIZATION_CREATION_FORBIDDEN` ab. Die erste Organisation ist immer erlaubt, die Einrichtung bleibt also unberührt. Ein verwaltetes Deployment deklariert dieselbe Liste als `organizations.creators` in seiner Spezifikation; siehe [Die tale-CLI installieren](/de/self-hosted/install/cli-install#managed-organization-creators) und die [Umgebungsvariablen-Referenz](/de/self-hosted/configuration/environment-reference).

[Mitglieder und Rollen](/de/platform/admin/members-and-roles) hilft bei der Zugriffswahl. [Sende danach deine erste Nachricht](/de/get-started/quickstart) und prüfe die vollständige Antwort. Erstelle einen [Projektagenten](/de/tutorials/editor/first-agent-end-to-end), sobald du eine Aufgabe delegieren möchtest. Ein funktionierendes Dashboard bestätigt den App-Zugriff, aber noch nicht den Anbieter oder jeden Hintergrunddienst.
