---
title: Enterprise-SSO und Bereitstellung
description: Single Sign-On (OIDC, OAuth2, SAML 2.0) und SCIM-Bereitstellung von Benutzern und Gruppen für deine Organisation konfigurieren. Schritt-für-Schritt-Einrichtung für Microsoft Entra ID, Google, generisches OIDC und SAML, plus Rollenzuordnung, Gruppe-zu-Team-Synchronisierung und Deaktivierung. Lies dies, wenn du die Unternehmensidentität für die Organisation einrichtest.
---

Mit Enterprise-SSO melden sich deine Mitglieder über deinen Identitätsanbieter (IdP) an, statt mit einem Tale-Passwort, und SCIM lässt den IdP Mitglieder und Gruppen automatisch anlegen, aktualisieren und deaktivieren — ohne manuelle Einladungen. Eine Verbindung pro Organisation trägt das Anmeldeprotokoll, die Bereitstellungsrichtlinie und das SCIM-Token gemeinsam. Alles liegt auf einer Seite: **Einstellungen > Enterprise-SSO** (nur Administratoren).

Tale spricht vier Protokolle: **OIDC**, einfaches **OAuth2**, **SAML 2.0** für die Anmeldung und **SCIM 2.0** für die Bereitstellung. Du kannst Anmeldung, Bereitstellung oder beides aktivieren.

<Frame caption="Einstellungen > Enterprise-SSO — Protokoll-Auswähler und Anmeldefelder auf einer Seite; die Redirect-URL zum Registrieren im IdP steht bereit zum Kopieren.">

![Die Einstellungsseite Enterprise-SSO mit dem Protokoll-Dropdown auf Microsoft Entra ID und passendem Anzeigename, dazu ein Anmeldebereich mit der zu registrierenden Redirect-URL, einer Issuer-URL und einer Client-ID aus der App-Registrierung, einem leeren Client-Secret und den angeforderten Scopes.](/images/platform/settings-enterprise-sso.webp)

</Frame>

## Protokoll wählen

Öffne **Einstellungen > Enterprise-SSO**, wähle ein **Protokoll** und fülle nur die Felder dieses Protokolls aus — die übrigen bleiben ausgeblendet. Ein **Einrichtungsleitfaden** auf derselben Seite listet die genauen Schritte auf und zeigt die URLs, die du in deinen IdP einfügst. Verwende **Verbindung testen** vor dem Speichern, um die Konfiguration zu prüfen, und **Speichern**, um die Anmeldung zu aktivieren.

- **Microsoft Entra ID** — Microsofts OIDC, mit Gruppe-zu-Team-Synchronisierung über Microsoft Graph.
- **Generisches OIDC** — jeder OpenID-Connect-Anbieter (Google, Okta, Auth0, Keycloak, …). Endpunkte werden vom Issuer erkannt.
- **OAuth2** — Anbieter ohne OIDC-Discovery; Autorisierungs-, Token- und Userinfo-Endpunkt konfigurierst du manuell.
- **SAML 2.0** — XML-basiertes SSO; du tauschst Metadaten mit dem IdP aus.

## Microsoft Entra ID

1. Melde dich im [Microsoft Entra Admin Center](https://entra.microsoft.com) mindestens als Anwendungsentwickler an.
2. Geh zu **Entra ID > App-Registrierungen > Neue Registrierung**, benenne sie und wähle **Einzelner Mandant**.
3. Wähle unter **Umleitungs-URI** die Plattform **Web**, füge die auf der Tale-Seite angezeigte **Weiterleitungs-URL** ein und klicke auf **Registrieren**.
4. Kopiere auf der **Übersicht** die **Anwendungs-(Client-)ID** und die **Verzeichnis-(Mandanten-)ID**. Deine Issuer-URL lautet `https://login.microsoftonline.com/{tenant-id}/v2.0`.
5. Öffne **Zertifikate & Geheimnisse > Neues Clientgeheimnis** und kopiere den **Wert** des Geheimnisses (nicht die Geheimnis-ID).
6. Wähle in Tale **Microsoft Entra ID** und gib Client-ID, Clientgeheimnis und Issuer-URL ein.
7. Für die Gruppe-zu-Team-Synchronisierung füge unter **API-Berechtigungen** die Microsoft-Graph-Berechtigung **GroupMember.Read.All** hinzu und erteile die Administratorzustimmung.
8. OneDrive- und SharePoint-Dateiimport gehört **nicht** zum SSO. Mitglieder autorisieren ihn unter **Wissen → Dokumente → Von Microsoft 365 → Microsoft 365 verbinden** — dort fragt Tale Graph **Files.Read** und **Sites.Read.All** an. Trage diese Scopes nicht in das SSO-Feld **Scopes** ein.

## Google

Google wird als generischer OIDC-Anbieter konfiguriert.

1. Öffne in der [Google Cloud Console](https://console.cloud.google.com) **APIs & Dienste > Anmeldedaten > Anmeldedaten erstellen > OAuth-Client-ID**.
2. Wähle den Anwendungstyp **Webanwendung**.
3. Füge unter **Autorisierte Weiterleitungs-URIs** die auf der Tale-Seite angezeigte **Weiterleitungs-URL** hinzu und speichere.
4. Kopiere **Client-ID** und **Clientgeheimnis** oben auf der Client-Seite.
5. Wähle in Tale **Generisches OIDC**, gib Client-ID und Geheimnis ein und setze die Issuer-URL auf `https://accounts.google.com`. Die Endpunkte werden automatisch erkannt.

Das Standard-OIDC von Google liefert **keine** Gruppenmitgliedschaften, daher ist die Gruppe-zu-Team-Synchronisierung mit Google allein nicht verfügbar — sie benötigt das Admin SDK / die Cloud Identity API mit einem Workspace-Administrator. Anmeldung und Rollenzuordnung per Claim funktionieren normal.

## Generisches OIDC und OAuth2

Für jeden anderen OIDC-Anbieter (Okta, Auth0, Keycloak) wähle **Generisches OIDC**, füge die **Issuer-URL** sowie Client-ID/Geheimnis ein — Tale liest die Autorisierungs-, Token- und Userinfo-Endpunkte aus dem `.well-known/openid-configuration` des Issuers.

Wenn ein Anbieter OAuth2, aber kein Discovery-Dokument bietet, wähle **OAuth2** und gib die URLs für **Autorisierungs-**, **Token-** und **Userinfo**-Endpunkt manuell ein. Verwendet der Anbieter abweichende Claim-Namen, ordne **E-Mail**, **Name** und **Gruppen** in den erweiterten Feldern der Verbindung zu (Dot-Pfade werden unterstützt, z. B. `realm_access.roles`).

## SAML 2.0

1. Wähle in Tale **SAML 2.0**. Die Seite zeigt deine **SP-Metadaten-URL** und **ACS-URL (Antwort)** — kopiere diese.
2. Erstelle in deinem IdP eine neue SAML-2.0-Anwendung. Setze deren **ACS-URL** und **Entity-ID/Audience** auf die angezeigten SP-Werte (oder lade die SP-Metadaten-URL hoch) und das **Name-ID**-Format auf E-Mail-Adresse.
3. Füge unter **IdP-Metadaten importieren** die Föderations-Metadaten-URL deines IdP ein und klick auf **Importieren** — oder klick auf **XML hochladen**, falls dein IdP nur eine Datei zum Herunterladen anbietet. Tale liest die Metadaten aus und füllt Entity-ID, Anmelde-URL und Signaturzertifikat in den Feldern darunter, ohne dass du etwas abtippen musst. Alle drei Felder bleiben bearbeitbar — prüfe die importierten Werte (oder trag sie von Hand ein, falls dein IdP keine Metadaten veröffentlicht), bevor du speicherst.
4. Ordne die Attribute für **E-Mail**, **Name** und **Gruppe** in deinem IdP zu; weichen die Namen von den Standardwerten ab, trage die passenden Attributnamen in Tales erweiterten Feldern ein.

Tale unterstützt sowohl IdP-initiiertes SAML (der IdP sendet eine Assertion an die ACS-URL) als auch SP-initiiertes SAML (ein Mitglied klickt auf **Mit SSO anmelden** und Tale leitet zum IdP weiter). Signierte Assertions sind erforderlich; verschlüsselte Assertions werden unterstützt, wenn du ein SP-Schlüsselpaar bereitstellst.

## Mehrere Organisationen auf einem Deployment

Ein Deployment kann mehrere Organisationen mit jeweils eigener Verbindung beherbergen. Klicke auf der Anmeldeseite auf **Weiter mit SSO** und wähle deine Organisation aus der Liste — jeder Eintrag zeigt den **Anzeigenamen** der Verbindung. Dieser Name ist auf der Anmeldeseite für alle sichtbar; setze in **Einstellungen > Enterprise-SSO** pro Verbindung einen klaren Anzeigenamen.

## Bereitstellung: Rollen und Teams

Jedes Protokoll teilt sich eine Bereitstellungsrichtlinie:

- **Standardrolle** — die Rolle, die ein neu bereitgestelltes Mitglied erhält (standardmäßig Mitglied).
- **Rollen automatisch vom IdP zuweisen** — wenn aktiv, ordnen Rollenregeln einen Jobtitel, eine App-Rolle, eine Gruppe oder einen Claim einer Plattformrolle zu; trifft nichts zu, gilt die Standardrolle.
- **IdP-Gruppen mit Teams synchronisieren** — wenn aktiv, wird jede IdP-Gruppe des Benutzers bei der Anmeldung zu einem gleichnamigen Team (oder tritt ihm bei); **Gruppen ausschließen** überspringt störende Gruppen (kommagetrennt). Die Synchronisierung nimmt nur zurück, was sie selbst hinzugefügt hat: Verschwindet eine Gruppe aus dem Claim des Benutzers, entfernt sie die Mitgliedschaft, die sie vergeben hat, und löscht ein Team, das sie selbst angelegt hat, sobald es leer ist. Teams und Mitgliedschaften, die Admins oder SCIM angelegt haben, bleiben unangetastet; ausgeschlossene Gruppen lässt sie vollständig in Ruhe.

## SCIM-Bereitstellung (Benutzer und Gruppen)

Mit SCIM überträgt dein IdP Änderungen, ohne dass sich jemand anmelden muss. Klicke im Abschnitt **SCIM-Bereitstellung** auf **Token generieren** — kopiere es einmalig (es wird nicht erneut angezeigt) — und füge es zusammen mit der angezeigten **SCIM-Basis-URL** in die Bereitstellungseinstellungen deines IdP ein. Der IdP authentifiziert sich mit dem Token als Bearer-Anmeldedaten; Tale ermittelt die Organisation aus dem Token, das damit die Mandantengrenze bildet.

Tale implementiert SCIM 2.0 **Users** und **Groups**: anlegen, lesen, auflisten (mit `userName`/`displayName`-Filtern), ersetzen, patchen und löschen. Bereitgestellte Benutzer entsprechen Organisationsmitgliedern, Gruppen entsprechen Teams. **Die Deaktivierung ist sanft** — setzt der IdP einen Benutzer inaktiv (`active: false`), wird die Rolle des Mitglieds auf `disabled` gesetzt (was den Zugriff entzieht), und eine Reaktivierung stellt die vorherige Rolle wieder her. Ein SCIM-**Löschen** entfernt die Mitgliedschaft aus der Organisation; das Benutzerkonto selbst bleibt bestehen, und eine erneute Bereitstellung fügt es mit der Standardrolle der Verbindung wieder hinzu. Der Inhaber der Organisation kann über SCIM nie entfernt oder deaktiviert werden. Gruppenmitglieder müssen Mitglieder der Organisation sein — einen Benutzer aus einer anderen Organisation weist Tale ab. Eine Änderung des `userName` greift nur, wenn die Adresse frei ist und das Konto ausschließlich zu dieser Organisation gehört; ein Konto, das auch anderswo Mitglied ist, behält die Adresse, mit der es sich anmeldet, und der IdP erhält stattdessen eine Ablehnung.

## Überprüfung

Verwende **Verbindung testen** für OIDC/OAuth2, um Discovery und Anmeldedaten vor dem Speichern zu bestätigen. Für SAML lade die SP-Metadaten in deinen IdP und führe eine Testanmeldung durch. Für SCIM bieten die meisten IdPs eine „Test"- oder „Jetzt bereitstellen"-Aktion, die einen Beispielbenutzer anlegt — prüfe, ob er unter **Einstellungen > Mitglieder** erscheint. Eine End-to-End-SSO-Anmeldung prüfst du am besten gegen deinen echten IdP in einer Staging-Organisation.
