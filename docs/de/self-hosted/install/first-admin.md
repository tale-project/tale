---
title: Das erste Inhaberkonto erstellen
description: Schließe die Ersteinrichtung ab, prüfe die Inhaberrolle und bereite die Instanz für dein Team vor.
---
Auf einer leeren Instanz erstellt die Tale-Einrichtung das erste Konto und die erste Organisation. Dieses Konto erhält die Rolle Inhaber. Schließe die Einrichtung ab, solange du den Zugriff auf die neue Instanz kontrollierst und bevor du ihre Adresse weitergibst.

## Bereitschaft der Instanz prüfen

Öffne die konfigurierte `SITE_URL` und prüfe Zertifikat und Hostname. Bei einer CLI-Bereitstellung verwende `tale status`; bei einer eigenen Bereitstellung prüfe Dienste und Gesundheitsprüfungen. Ein fehlerhaftes Backend braucht [Fehlerbehebung](/de/self-hosted/operate/observability/troubleshooting), bevor du Konten einrichtest.

Eine Anmeldeseite statt der Einrichtung bedeutet meist, dass bereits ein Konto existiert. In einer vorbereiteten Entwicklungsumgebung ist das normal. Lösche nicht die Datenbank, um Zugriff zurückzubekommen. Melde dich mit dem vorhandenen Konto an oder bitte einen Admin um eine Einladung.

## Einrichtung abschließen

Öffne die Instanz-URL. Folge der Einrichtung, erstelle dein Konto und benenne die Organisation. Bewahre deine Anmeldedaten in einem Passwortmanager auf.

Den Modellanbieter richtest du während der Einrichtung oder später unter **Einstellungen > KI-Anbieter** ein. Ohne Anbieter kannst du die App ansehen; für eine echte Antwort brauchst du gültige Zugangsdaten und ein verfügbares Modell. [KI-Anbieter](/de/platform/admin/providers) beschreibt die Verbindung.

## Inhaberrolle bestätigen

Öffne **Einstellungen > Mitglieder** und prüfe, ob dein Konto die Rolle **Inhaber** hat. Organisation und Konto sollten zu der Instanz passen, die du einrichten wolltest.

<Frame caption="Prüfe Inhaber und Rollen eingeladener Mitglieder, bevor du dem Team Zugriff gibst.">

![Die Mitgliederseite der Organisation zeigt Personen und ihre zugewiesenen Rollen.](/images/get-started/settings-organization-members.webp)

</Frame>

Melde dich ab und erneut an, um die Zugangsdaten unabhängig von der Einrichtungssitzung zu testen. Halte einen weiteren geprüften administrativen Wiederherstellungsweg bereit, bevor du die Authentifizierung änderst.

## Teammitglieder einladen

Füge Personen unter **Einstellungen > Mitglieder** hinzu und wähle ihre Rollen bewusst. Nach dem ersten Konto erfolgt die lokale Kontoerstellung per Einladung, nicht über eine offene Registrierung. Für Unternehmens-SSO und Bereitstellung gelten eigene [Einrichtungs- und Mitgliedschaftsregeln](/de/platform/admin/enterprise-sso).

Das setzt das Backend selbst durch, nicht nur der Proxy davor: Sobald ein Konto existiert, antwortet `/api/auth/sign-up/email` mit 403. Das zählt, weil das Backend auch aus dem Sandbox-Netz der Agenten erreichbar ist, das der Proxy nie sieht — Code in einer Agenten-Sitzung kann also ebenfalls keine Konten anlegen. **Einstellungen > Mitglieder** legt Konten serverseitig an und bleibt davon unberührt. Eine Wegwerf-Testumgebung, die die offene Route braucht, setzt `TALE_ALLOW_OPEN_SIGN_UP=true`; auf einer echten Umgebung niemals.

Eine weitere Organisation darf jede angemeldete Person erstellen, solange du nicht festlegst, wer das darf: Setze `TALE_ORGANIZATION_CREATORS` auf deren Anmeldeadressen, dann verschwindet für alle anderen der Eintrag **Organisation erstellen** aus der Organisationsauswahl, und die API weist sie mit `403 ORGANIZATION_CREATION_FORBIDDEN` ab. Die erste Organisation ist immer erlaubt, die Einrichtung bleibt also unberührt. Ein verwaltetes Deployment deklariert dieselbe Liste als `organizations.creators` in seiner Spezifikation; siehe [Die tale-CLI installieren](/de/self-hosted/install/cli-install#managed-organization-creators) und die [Umgebungsvariablen-Referenz](/de/self-hosted/configuration/environment-reference).

[Mitglieder und Rollen](/de/platform/admin/members-and-roles) hilft bei der Zugriffswahl. [Erstelle danach deinen ersten Agenten](/de/tutorials/editor/first-agent-end-to-end) und teste eine echte Antwort. Ein funktionierendes Dashboard bestätigt den App-Zugriff, aber noch nicht den Anbieter oder jeden Hintergrunddienst.
