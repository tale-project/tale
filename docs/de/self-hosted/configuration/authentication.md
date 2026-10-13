---
title: Authentifizierung einrichten
description: Wähle lokale Konten, Unternehmens-SSO oder einen vertrauenswürdigen Authentifizierungsproxy.
---
Tale unterstützt lokale Konten mit E-Mail und Passwort, Unternehmens-SSO je Organisation und Identitäten aus einem vertrauenswürdigen Reverse Proxy. Entscheidend ist, wo dein Team Identitäten verwaltet und wer Konten bereitstellt. Anmeldung und Bereitstellung sind getrennt: SSO authentifiziert eine Person; Einladungen, Bereitstellung bei der Anmeldung oder SCIM regeln die Mitgliedschaft. Coding-Agents, die Automatisierungen bearbeiten, melden sich getrennt am MCP-Endpunkt an, wie [unten beschrieben](#coding-agent-sign-in).

## Passende Integration wählen

| Umgebung | Einrichtung | Zentrale Voraussetzung |
| --- | --- | --- |
| Tale verwaltet lokale Konten | Lokale Anmeldung und Einladungen | Stabile Bereitstellungsgeheimnisse und eine erreichbare Instanz-URL. |
| Ein Unternehmens-Identitätsanbieter ist vorhanden | Unternehmens-SSO mit Microsoft Entra ID, generischem OIDC, OAuth2 oder SAML 2.0 | Eine IdP-Anwendung mit exakt passenden Callback- oder Metadaten-URLs. |
| Eine Anwendung oder ein Proxy authentifiziert die Nutzer bereits | Vertrauenswürdige Header je Organisation | Ein Schlüssel aus **Einstellungen > Enterprise-SSO** und ein Proxy, der ihn zusammen mit den Identitäts-Headern mitschickt. |
| Personen verbinden Claude Code, Codex, Cursor oder einen anderen Coding-Agent mit dem MCP-Endpunkt | Anmeldung für Coding-Agents, standardmäßig eingeschaltet | Eine öffentliche HTTPS-Adresse und ein Proxy, der die Dokumente unter `/.well-known/` weiterreicht. |

Unternehmens-SSO und vertrauenswürdige Header werden beide je Organisation eingerichtet. Plane und teste die Identitätszuordnung, bevor du bestehende Konten auf ein anderes Verfahren umstellst.

## Zuerst die öffentliche URL festlegen

Setze `SITE_URL` und eine gegebenenfalls unterstützte Basispfad-Konfiguration auf die tatsächlich verwendete Adresse. Schließe [TLS- und Domain-Einrichtung](/de/self-hosted/configuration/tls-and-domains) ab, bevor du Weiterleitungsadressen beim Identitätsanbieter registrierst.

Halte `BETTER_AUTH_SECRET` über alle Backend-Prozesse der Instanz hinweg konstant. Verwende das von der Bereitstellung erzeugte Geheimnis oder lade es aus deinem Secret-Manager. Unterschiedliche Werte können die Anmeldung unterbrechen, obwohl der Identitätsanbieter die Person akzeptiert.

## Lokale Konten verwenden

Die lokale Anmeldung speichert Passwort-Hashes in der Anwendungsdatenbank. Die [Ersteinrichtung](/de/self-hosted/install/first-admin) erstellt den ersten Inhaber; weitere Mitglieder kommen per Einladung hinzu. Richte den E-Mail-Versand ein, wenn Einladung und Passwortwiederherstellung darauf angewiesen sind.

Prüfe mit einem Testkonto Einladung, Anmeldung, Abmeldung und Wiederherstellung. Eine funktionierende Inhabersitzung bestätigt noch nicht, dass neue Mitglieder beitreten können.

Tale verschickt keine Bestätigungsmail. Bestätigt wird eine Adresse deshalb von der Stelle, die das Konto anlegt: der erste Inhaber aus der Ersteinrichtung, eine Person, die eine Administratorin oder ein Administrator unter **Einstellungen > Mitglieder** hinzufügt, und das Konto aus der Bereitstellung gelten als bestätigt und sind sofort nutzbar. Verbundene Anwendungen lesen das als Angabe `email_verified` in der Identität, die Tale ausstellt — neu hinzugefügte Mitglieder können sich dort also sofort anmelden. Konten aus Unternehmens-SSO, SCIM oder vertrauenswürdigen Headern behalten dagegen die Angabe ihres Verzeichnisses.

## Unternehmens-SSO verbinden

Konfiguriere die Organisation unter **Einstellungen > Enterprise-SSO**. Microsoft Entra ID und generisches OIDC lesen die Endpunkte über den Aussteller; OAuth2 verwendet ausdrücklich angegebene Autorisierungs-, Token- und Userinfo-Endpunkte. SAML verwendet Metadaten, eine Assertion-Consumer-URL und Signaturzertifikate.

<Frame caption="Kopiere die URLs aus der laufenden Instanz, damit Domain und Bereitstellungspfad stimmen.">

![Die Seite für Unternehmens-SSO zeigt die Protokollauswahl und die Verbindungsfelder für Microsoft Entra ID.](/images/platform/settings-enterprise-sso.webp)

</Frame>

Verwende die dort angezeigten Callback- und Metadaten-URLs. Aktuelle native OIDC-Callbacks nutzen `/api/sso/callback`; für vorhandene Registrierungen wird auch `/http_api/api/sso/callback` unterstützt. Die Registrierung beim IdP muss zu der im Ablauf verwendeten URL passen.

[Unternehmens-SSO und Bereitstellung](/de/platform/admin/enterprise-sso) beschreibt Protokolle, Claim-Zuordnung, Standardrollen, Team-Synchronisierung und SCIM. Teste die Anmeldung in einer separaten Browsersitzung, bevor du deine Administratorsitzung beendest. Eine gelungene Discovery-Prüfung bestätigt weder Claims und Gruppenrechte noch die vollständige Anmeldung.

## Einem Authentifizierungsproxy vertrauen

Eine Anwendung, die ihre Nutzer bereits anmeldet, kann sie über ihren Reverse-Proxy in eine Organisation weiterreichen. Ein Admin schaltet die Funktion unter **Einstellungen > Enterprise-SSO** in der Karte **Vertrauenswürdige Header** ein: Wähle die höchste Rolle, die der Proxy zuweisen darf, erstelle einen Schlüssel und kopiere ihn, denn er wird nur einmal angezeigt. Leite die Anmeldung des Proxys auf `/api/trusted-headers/authenticate`, mit dem Schlüssel im Header `Remote-Internal-Secret` und den Identitäts-Headern `Remote-Email`, `Remote-Name`, `Remote-Role` und `Remote-Teams`. Die [Umgebungsreferenz](/de/self-hosted/configuration/environment-reference) nennt die Variablen `TRUSTED_*_HEADER` zum Umbenennen dieser Header.

Der Schlüssel bestimmt die Organisation. Ein Mitglied dieser Organisation wird angemeldet; eine Adresse, die die Installation noch nie gesehen hat, wird zum neuen Mitglied mit der zugewiesenen Rolle; ein bestehendes Konto aus einer anderen Organisation wird abgewiesen. Inhaber lässt sich nie zuweisen, und eine Rolle über der Obergrenze der Organisation wird auf diese gesenkt. Bei jeder Anmeldung folgt der Sitz des Mitglieds der zugewiesenen Rolle, sodass **Einstellungen > Mitglieder** zeigt, was der Proxy zugewiesen hat; ein Inhaber-Sitz ändert sich nie. Schaltest du die Karte aus, wird jeder Schlüssel abgewiesen, ohne dass einer widerrufen wird; ein Widerruf beendet die Sitzungen nicht, die der Schlüssel gestartet hat.

<Warning>

Der Proxy muss Identitäts-Header des Clients entfernen, eigene authentifizierte Werte setzen und den Schlüssel nur an die Übergabe-Anfrage anhängen. Wer den Schlüssel besitzt, kann sich als jedes Mitglied anmelden, das der Proxy in dieser Organisation nennt. Behandle ihn wie ein Passwort und rotiere ihn über die Karte.

</Warning>

`Remote-Teams` enthält kommagetrennte Teamnamen, etwa `Finance,Operations`; ein Eintrag im Format `id:name` wie `t-fin:Finance` wird ebenfalls akzeptiert. Teams werden nach Namen zugeordnet und angelegt. Ohne Header bleibt die Teamverwaltung unberührt. Ein vorhandener, aber leerer Header entfernt zuvor von dieser Synchronisierung vergebene Mitgliedschaften. Ungültige Einträge können deshalb synchronisierte Mitgliedschaften entfernen. Manuell vergebene Mitgliedschaften bleiben erhalten.

Wer über den Proxy kommt, wird mit der ersten eigenen Anfrage der App angemeldet: Trägt diese Anfrage den Schlüssel und den Identitäts-Header, aber kein Sitzungs-Cookie, erzeugt das Backend die Sitzung an Ort und Stelle, und die App öffnet sich angemeldet — ohne Anmeldeseite, ohne Weiterleitung. Landet die App dennoch auf ihrer Anmeldeseite (etwa mit einem veralteten Cookie), leitet die Seite den Browser selbst auf die Übergabeadresse weiter, und eine Abweisung kehrt mit ihrem Grund auf diese Seite zurück. Dass der Proxy `/log-in` direkt auf die Übergabeadresse leitet, bleibt möglich; die Adresse antwortet auf Erfolg mit einer Weiterleitung in die App und auf eine Abweisung mit einer Seite samt Statuscode. Da der Proxy die Sitzung besitzt, bietet die App einem so angemeldeten Mitglied keine Abmeldung an; nach einer Abmeldung wegen Inaktivität pausiert die automatische Anmeldung, bis das Mitglied aus dem Hinweis heraus fortfährt.

Soll Tale in der Seite der Anwendung selbst statt in einem Tab erscheinen, trägt ein Admin die Herkunft dieser Seite unter **Einbettung** auf derselben Einstellungsseite ein. Die Seiten von Tale antworten dann mit einer `frame-ancestors`-Richtlinie, die `'self'` und die eingetragenen Herkünfte nennt, statt jeden Frame abzuweisen, und der Header `X-Frame-Options` entfällt. Die Liste gehört einer Organisation, die Anmelde-Shell ist aber ein einziges Dokument für die ganze Installation, sodass eine Herkunft, die irgendeine Organisation zulässt, es laden kann. Der Browser sendet das Sitzungs-Cookie nur dann in einen Frame, wenn die umgebende Seite zur selben Site wie Tale gehört, etwa eine Subdomain des Hosts oder Tale unter der eigenen Domain des Hosts; ein Frame von einer anderen Site zeigt stattdessen die Anmeldeseite.

## Coding-Agents anmelden lassen {#coding-agent-sign-in}

Eine Person verbindet einen Coding-Agent wie Claude Code, Codex oder Cursor mit dem [MCP-Endpunkt](/de/develop/mcp-endpoint), indem sie sich im Agent anmeldet. Ein API-Schlüssel muss dann nicht in dessen Konfiguration kopiert werden. Der Agent schickt den Browser der Person zum Anmeldeserver von Tale. Dort meldet sie sich an wie immer, wählt eine Organisation und legt fest, wie viel der Agent dort darf. Danach arbeitet der Agent als diese Person, nie über ihrer Rolle. Die Anmeldung ist eingeschaltet, solange du sie nicht abschaltest. API-Schlüssel funktionieren weiter, für Skripte und für Werkzeuge, die sich nicht anmelden können.

Das muss deine Bereitstellung leisten:

- **Eine öffentliche Adresse, die Personen öffnen können.** Der Anmeldeserver antwortet unter `SITE_URL` plus `/api/auth`, und jede Adresse in `ADDITIONAL_SITE_URLS` wird als eigener MCP-Endpunkt bekannt gegeben.
- **Erreichbare Discovery-Dokumente.** Ein Agent findet den Anmeldeserver in Dokumenten unter `/.well-known/` auf der obersten Ebene des Hosts. Der Proxy von Tale leitet sie weiter. Ein eigener Proxy muss `/.well-known/oauth-protected-resource*` und `/.well-known/oauth-authorization-server*` an jeder Adresse an das Backend weiterreichen, auch wenn Tale unter einem Basispfad läuft, denn diese Pfade liegen immer auf der obersten Ebene des Hosts. [TLS und Domains](/de/self-hosted/configuration/tls-and-domains#agent-sign-in-domains) listet sie auf.
- **Ausgehendes HTTPS zum Host des Agenten.** Claude Code und Codex weisen sich mit einem Client-Metadatendokument auf dem Host ihres Herstellers aus (`claude.ai`, `chatgpt.com`), das das Backend abruft, wenn sich ein Agent verbindet. Tale lehnt Adressen in privaten Netzen und Dokumente auf den eigenen Adressen ab. Mit `TALE_MCP_CLIENT_METADATA_HOSTS` schränkst du die erlaubten Hosts weiter ein.
- **Grenzen der Selbstregistrierung.** Cursor, VS Code und Gemini CLI veröffentlichen kein solches Dokument und registrieren sich selbst. Tale nimmt zehn Registrierungen pro Stunde von einer Adresse an, 500 pro Tag und 5.000 insgesamt, erlaubt Web-Weiterleitungen nur zu den Hosts in `TALE_MCP_DCR_WEB_REDIRECT_HOSTS`, zeigt eine solche App als **Nicht bestätigt** an und entfernt täglich Registrierungen, die niemand genutzt hat.

Token sind kurzlebig. Ein Zugriffstoken gilt fünf Minuten, und ein Agent, der dreißig Tage lang nicht benutzt wird, muss neu verbunden werden. Die Person selbst oder ein Inhaber oder Admin trennt einen Agent unter **Einstellungen > API > Verbundene Agenten**. Auch das Entfernen der Person aus der Organisation, ein neues Passwort und ein zweimal verwendetes Refresh-Token beenden die Verbindung; bei den beiden letzten findet die Person einen Hinweis in ihren Benachrichtigungen.

Willst du Agents bei API-Schlüsseln halten, setze `TALE_MCP_CLIENT_METADATA_DOCUMENTS=false` und `TALE_MCP_DYNAMIC_CLIENT_REGISTRATION=false` und erstelle das Backend neu. Das Dokument `oauth-protected-resource` des Endpunkts antwortet dann mit `404`, und die Zugriffstoken bereits verbundener Agents funktionieren sofort nicht mehr. [Produktivbetrieb härten](/de/self-hosted/operate/security/hardening#agent-sign-in) nennt, was du prüfen solltest, bevor du die Anmeldung eingeschaltet lässt.

## Anmeldefehler eingrenzen

| Symptom | Erste Prüfung |
| --- | --- |
| Der IdP lehnt eine Weiterleitung ab | Vergleiche registrierte und angezeigte URL einschließlich Schema, Host und Pfad. |
| Die Weiterleitung endet ohne Anmeldung | Prüfe Erreichbarkeit des Callbacks, Cookies und Claim-Namen. |
| Ein Mitglied erhält die falsche Rolle | Prüfe Standardrolle und Zuordnung anhand seiner tatsächlichen Claims. |
| Synchronisierte Teams verschwinden | Prüfe Gruppen-Claim oder `Remote-Teams`; unterscheide fehlende und leere Werte. |
| Die Header-Anmeldung wird abgelehnt | Prüfe, ob die Karte für die Organisation eingeschaltet ist, ob der Schlüssel noch gültig ist, und die Header-Namen im Proxy. |

Teste Zuordnungsänderungen in einer Staging-Organisation und halte einen geprüften administrativen Wiederherstellungsweg bereit. Änderungen können alle Mitglieder betreffen, deren Identität von dieser Verbindung abhängt.
