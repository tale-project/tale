---
title: Enterprise-SSO und Bereitstellung
description: Verbinde deinen Identitätsanbieter, teste die Anmeldung und verwalte Rollen und Teams über SSO, SCIM oder einen vertrauenswürdigen Proxy.
---

Mit Enterprise-SSO melden sich Mitglieder über deinen Identitätsanbieter (IdP) an. Über SCIM kann er Mitglieder anlegen, aktualisieren und deaktivieren, ohne auf deren Anmeldung zu warten. Jede Organisation hat eine Verbindung. Als Admin oder Inhaber kannst du unter **Einstellungen > Enterprise-SSO** die Anmeldung, die Bereitstellung oder beides aktivieren.

## Bevor du beginnst

Du brauchst die Berechtigung, beim IdP eine Anwendung zu registrieren, deren Client-Zugangsdaten oder SAML-Metadaten sowie die öffentliche Tale-Adresse deiner Mitglieder. Lass während der Tests eine funktionierende Admin-Sitzung offen, damit du die Verbindung bei einem Anmeldefehler korrigieren kannst.

Trage unter **Anzeigename** einen Namen ein, den Mitglieder erkennen. Er erscheint in der Organisationsauswahl auf der öffentlichen Anmeldeseite. Verwende dafür keine vertraulichen oder rein internen Angaben.

<Frame caption="Wähle zuerst das Protokoll. Tale zeigt die passenden Felder und die Callback-Adresse für deinen Identitätsanbieter.">

![Enterprise-SSO-Einstellungen mit Microsoft Entra ID, Weiterleitungs-URL sowie Feldern für Issuer und Client-Zugangsdaten.](/images/platform/settings-enterprise-sso.webp)

</Frame>

## Das Protokoll wählen

| Protokoll | Wann es passt | Was du vorbereitest |
| --- | --- | --- |
| **Microsoft Entra ID** | Deine Organisation nutzt Entra; die optionale Team-Synchronisierung verwendet Microsoft Graph. | Tenant-spezifische Issuer-URL, Client-ID, Client-Secret. |
| **Generisches OIDC** | Dein Anbieter unterstützt OpenID-Connect-Discovery. | Issuer-URL, Client-ID, Client-Secret. |
| **OAuth2** | Dein Anbieter hat kein OIDC-Discovery-Dokument. | Client-Zugangsdaten und URLs für Autorisierung, Token und Userinfo. |
| **SAML 2.0** | Dein IdP verwendet SAML-Assertions. | IdP-Metadaten oder Entity-ID, Anmelde-URL und Signaturzertifikat. |

## Einen OIDC- oder OAuth2-Anbieter verbinden

1. Wähle das Protokoll in Tale und öffne den **Einrichtungsleitfaden**, um die Callback-URL zu finden.
2. Registriere beim IdP eine Webanwendung. Kopiere die Callback-URL exakt, einschließlich Schema, Host und Pfad. Registriere auch jede zusätzliche Callback-URL, die Tale für weitere Deployment-Domains anzeigt.
3. Trage Client-ID und Client-Secret in Tale ein. Bei OIDC gibst du die Issuer-URL an; Tale ermittelt die Endpunkte. Bei OAuth2 trägst du die drei Endpunkt-URLs selbst ein.
4. Prüfe **Scopes** und **Erweitert**. Fordere die Identitäts-Claims an, die deine Bereitstellungsregeln brauchen. Ordne abweichende Claim-Namen bei Bedarf zu. Claim-Pfade können Punkte enthalten, etwa `realm_access.roles`.
5. Wähle **Verbindung testen**, behebe mögliche Fehler und wähle oben **Speichern**. Teste danach eine echte Anmeldung wie unten beschrieben.

Verwende für Entra eine Tenant-spezifische Issuer-URL wie `https://login.microsoftonline.com/{tenant-id}/v2.0`, registriere den Callback als Web-Weiterleitungs-URI und kopiere den Wert des Client-Secrets statt seiner ID. Microsoft erklärt die Einrichtung in der [Anleitung zur App-Registrierung](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app). Die Gruppen-Team-Synchronisierung braucht die Microsoft-Graph-Berechtigung `GroupMember.Read.All` und Admin-Zustimmung.

Wähle für Google **Generisches OIDC** mit dem Issuer `https://accounts.google.com`; siehe Googles [OpenID-Connect-Einrichtung](https://developers.google.com/identity/openid-connect/openid-connect). Googles Standard-OIDC liefert keine Gruppenmitgliedschaften. Eine Google-Anmeldung allein ermöglicht deshalb keine Gruppen-Team-Synchronisierung.

<Note>
Der Microsoft-365-Dateiimport hat einen eigenen Zustimmungsablauf im Wissensbereich. Füge `Files.Read` oder `Sites.Read.All` nicht zu den SSO-Scopes hinzu, wenn Mitglieder sich nur anmelden sollen. Richte den Import über [OAuth-Apps für Konnektoren](/de/platform/admin/connectors) ein.
</Note>

## Einen SAML-Anbieter verbinden

1. Wähle **SAML 2.0**. Übernimm **SP-Metadaten-URL** und **ACS-URL (Antwort)** in die SAML-Anwendung deines IdP. Verwende die Service-Provider-Metadaten für Entity-ID/Audience und die E-Mail-Adresse als Name-ID-Format.
2. Importiere unter **IdP-Metadaten importieren** die Metadaten-URL des IdP oder wähle **XML hochladen**. Prüfe die übernommenen Werte für Entity-ID, Anmelde-URL und Signaturzertifikat. Du kannst sie auch manuell eintragen.
3. Ordne unter **Erweitert** E-Mail, Name und Gruppen zu, falls der IdP andere Attributnamen nutzt. Lass **Signierte Assertions verlangen** aktiviert.
4. Speichere die Verbindung und teste eine Anmeldung über den IdP.

Verschlüsselt dein IdP Assertions, ergänze unter **Erweitert** ein passendes **SP-Zertifikat (PEM)** und **Privater SP-Schlüssel (PEM)**. Das Zertifikat erscheint in den SP-Metadaten; der private Schlüssel wird als Secret gespeichert und nicht erneut angezeigt. Richte die Verschlüsselung im IdP ein, bevor du **Verschlüsselte Assertions verlangen** aktivierst. Tale akzeptiert diese Einstellung nur mit einem Entschlüsselungsschlüssel und weist danach unverschlüsselte Assertions ab.

SAML kann vom IdP oder von Tale aus gestartet werden. Wenn du in Tale beginnst, schließe die Anmeldung im selben Browser ab. So kann der Callback das zu Beginn angelegte Cookie prüfen.

## Rollen und Teams bei der Anmeldung zuweisen

| Einstellung | Was sie steuert |
| --- | --- |
| **Standardrolle** | Rolle für neu angelegte Mitglieder, wenn keine Rollenregel passt; anfangs Mitglied. |
| **Rollen automatisch vom IdP zuweisen** | Ordnet Gruppen, App-Rollen, Jobtitel oder Claims Tale-Rollen zu. Prüfe vor dem Aktivieren, wer eine Admin-Regel erfüllen könnte. |
| **IdP-Gruppen mit Teams synchronisieren** | Erstellt Teams oder fügt Mitglieder bei der Anmeldung anhand ihrer Gruppen hinzu. |
| **Gruppen ausschließen** | Kommagetrennte Gruppennamen, die die Team-Synchronisierung auslässt. |

Verschwinden Gruppen, entfernt die Synchronisierung die zuvor von ihr vergebenen Mitgliedschaften. Von ihr erstellte Teams löscht sie, sobald diese leer sind. Manuell oder über SCIM angelegte Mitgliedschaften bleiben erhalten; ausgeschlossene Gruppen bleiben unberührt. Die manuelle Verwaltung beschreibt [Teams](/de/platform/admin/teams).

## Mitglieder über SCIM bereitstellen

1. Wähle unter **SCIM-Bereitstellung** die Aktion **Token generieren** und kopiere das Token sofort. Es wird nur einmal angezeigt.
2. Hinterlege das Token als Bearer-Zugangsdaten und die angezeigte **SCIM-Basis-URL** in der Bereitstellungskonfiguration deines IdP.
3. Stelle einen Testbenutzer und eine Testgruppe bereit. Prüfe, ob Mitglied und Team in Tale erscheinen, und teste Aktualisierung und Deaktivierung, bevor du weitere Personen einbeziehst.

SCIM-Users werden zu Mitgliedern, Groups zu Teams. Eine Deaktivierung (`active: false`) sperrt den Zugang des Mitglieds; die Reaktivierung stellt seine vorherige Rolle wieder her. Das Löschen eines SCIM-Users entfernt seine Organisationsmitgliedschaft, erhält aber sein Konto. Bei erneuter Bereitstellung gilt die Standardrolle der Verbindung.

Der Inhaber lässt sich über SCIM weder deaktivieren noch entfernen. Gruppen dürfen nur Mitglieder dieser Organisation enthalten. Eine Änderung des Benutzernamens wird abgelehnt, wenn die neue E-Mail-Adresse schon vergeben ist oder das Konto mehreren Organisationen angehört. So bleibt seine gemeinsame Anmeldeidentität geschützt.

## Mitglieder über einen Authentifizierungsproxy anmelden

Eine Anwendung, die ihre Nutzer bereits authentifiziert, kann sie über ihren Reverse-Proxy in diese Organisation weiterreichen, sodass Mitglieder das Anmeldeformular von Tale nie sehen. Die Karte **Vertrauenswürdige Header** auf derselben Seite enthält den Schalter, die Rollen-Obergrenze und die Schlüssel, die der Proxy vorlegt.

1. Schalte **Anmeldungen über einen vertrauenswürdigen Proxy annehmen** ein und wähle die **Höchste Rolle, die ein Proxy zuweisen darf**. Der Rollen-Header wird auf diese Rolle begrenzt; Inhaber lässt sich nie zuweisen. Bei jeder Anmeldung folgt der Sitz des Mitglieds der zugewiesenen Rolle; ein Inhaber-Sitz ändert sich nie.
2. Wähle **Schlüssel erstellen**, benenne ihn nach dem Proxy, der ihn erhält, und kopiere den Schlüssel sofort, denn er wird nur einmal angezeigt. Eine Organisation hält höchstens 10 gültige Schlüssel.
3. Richte den Proxy so ein, dass er Anmeldungen an die **Übergabe-URL** sendet, mit dem Schlüssel im Schlüssel-Header und den Identitäts-Headern unter **Header-Namen**. Ein Mitglied, das über den Proxy kommt, wird mit der ersten Anfrage der App angemeldet und sieht nie eine Anmeldeseite; die App bietet ihm keine Abmeldung an, da der Proxy diese Sitzung besitzt. Dass der Proxy `/log-in` auf dieselbe Adresse leitet, bleibt möglich.

Sollen die Seiten in der Seite der Anwendung selbst erscheinen, schalte unter **Einbettung** die Option **Einbettung in einem Frame erlauben** ein und trage die Herkunft der Seite unter **Erlaubte Herkünfte** ein; Tale lässt diese Herkunft dann als Frame-Vorfahren zu. Ein Frame trägt die angemeldete Sitzung nur, wenn die umgebende Seite zur selben Site wie Tale gehört.

Der Schlüssel bestimmt die Organisation: Ein Mitglied wird angemeldet, eine Adresse, die Tale noch nie gesehen hat, wird zum neuen Mitglied mit der zugewiesenen Rolle, und ein bestehendes Konto aus einer anderen Organisation wird abgewiesen. Schaltest du den Schalter aus, wird jeder Schlüssel abgewiesen, ohne dass einer widerrufen wird. **Widerrufen** stempelt einen Schlüssel, sodass der Proxy niemanden mehr anmelden kann; bereits gestartete Sitzungen bleiben angemeldet. Die [Authentifizierungskonfiguration](/de/self-hosted/configuration/authentication) des Betreibers beschreibt Header-Namen und Anforderungen an den Proxy.

## Prüfen und Fehler beheben

Öffne eine separate Browsersitzung, wähle **Weiter mit SSO** und dann die Organisation anhand ihres Anzeigenamens. Melde dich an und prüfe Rolle und Teammitgliedschaften. **Verbindung testen** prüft die Verbindungsdaten, aber nicht, ob eine echte Person die vorgesehenen Zugriffsrechte erhält.

| Symptom | Was du prüfst |
| --- | --- |
| Abweichende Weiterleitung, etwa `AADSTS50011` | Vergleiche den registrierten Callback exakt mit Tales URL: Domain, Schema, Pfad und abschließender Schrägstrich. |
| Verbindungstest schlägt fehl | Prüfe Issuer/Endpunkte, Client-ID, Wert und Ablaufdatum des Secrets sowie nötige Zustimmungen beim Anbieter. |
| Fehler bei der Browserbindung | Starte die Anmeldung im selben Browser neu und erlaube die bei Weiterleitungen benötigten Cookies. |
| Falsche Rolle oder fehlendes Team | Prüfe die tatsächlichen IdP-Claims, Rollenregeln, Ausschlüsse und Gruppenberechtigungen. |
| SCIM kann sich nicht verbinden | Prüfe Basis-URL, Bearer-Token und ob die Bereitstellung aktiviert ist. |
| Die Proxy-Anmeldung wird abgelehnt | Prüfe, ob die Karte eingeschaltet ist, der Schlüssel nicht widerrufen wurde und der Proxy E-Mail-Header und Schlüssel bei der Übergabe-Anfrage sendet. |
| Fehlende Callback-URL oder Server-Konfigurationswarnung | Bitte den Betreiber, die [Authentifizierungskonfiguration](/de/self-hosted/configuration/authentication) zu prüfen. |

**Anmeldung deaktivieren** stoppt neue SSO-Anmeldungen; aktive Sitzungen bleiben bestehen. **Entfernen** löscht die Verbindungskonfiguration samt Zugangsdaten. Sorge vor beiden Aktionen für eine andere funktionierende Anmeldemethode.
