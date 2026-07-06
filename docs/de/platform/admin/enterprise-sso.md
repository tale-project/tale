---
title: Enterprise-SSO und Bereitstellung
description: Single Sign-On (OIDC, OAuth2, SAML 2.0) und SCIM-Bereitstellung von Benutzern und Gruppen für Ihre Organisation konfigurieren. Schritt-für-Schritt-Einrichtung für Microsoft Entra ID, Google, generisches OIDC und SAML, plus Rollenzuordnung, Gruppe-zu-Team-Synchronisierung und Deaktivierung. Lesen Sie dies, wenn Sie die Unternehmensidentität für die Organisation einrichten.
---

Mit Enterprise-SSO melden sich Ihre Mitglieder über Ihren Identitätsanbieter (IdP) an, statt mit einem Tale-Passwort, und SCIM lässt den IdP Mitglieder und Gruppen automatisch anlegen, aktualisieren und deaktivieren — ohne manuelle Einladungen. Eine Verbindung pro Organisation trägt das Anmeldeprotokoll, die Bereitstellungsrichtlinie und das SCIM-Token gemeinsam. Alles liegt auf einer Seite: **Einstellungen > Enterprise-SSO** (nur Administratoren).

Tale spricht vier Protokolle: **OIDC**, einfaches **OAuth2**, **SAML 2.0** für die Anmeldung und **SCIM 2.0** für die Bereitstellung. Sie können Anmeldung, Bereitstellung oder beides aktivieren.

## Protokoll wählen

Öffnen Sie **Einstellungen > Enterprise-SSO**, wählen Sie ein **Protokoll** und füllen Sie nur die Felder dieses Protokolls aus — die übrigen bleiben ausgeblendet. Ein **Einrichtungsleitfaden** auf derselben Seite listet die genauen Schritte auf und zeigt die URLs, die Sie in Ihren IdP einfügen. Verwenden Sie **Verbindung testen** vor dem Speichern, um die Konfiguration zu prüfen, und **Speichern**, um die Anmeldung zu aktivieren.

- **Microsoft Entra ID** — Microsofts OIDC, mit Gruppe-zu-Team-Synchronisierung über Microsoft Graph.
- **Generisches OIDC** — jeder OpenID-Connect-Anbieter (Google, Okta, Auth0, Keycloak, …). Endpunkte werden vom Issuer erkannt.
- **OAuth2** — Anbieter ohne OIDC-Discovery; Autorisierungs-, Token- und Userinfo-Endpunkt konfigurieren Sie manuell.
- **SAML 2.0** — XML-basiertes SSO; Sie tauschen Metadaten mit dem IdP aus.

## Microsoft Entra ID

1. Melden Sie sich im [Microsoft Entra Admin Center](https://entra.microsoft.com) mindestens als Anwendungsentwickler an.
2. Gehen Sie zu **Entra ID > App-Registrierungen > Neue Registrierung**, benennen Sie sie und wählen Sie **Einzelner Mandant**.
3. Wählen Sie unter **Umleitungs-URI** die Plattform **Web**, fügen Sie die auf der Tale-Seite angezeigte **Weiterleitungs-URL** ein und klicken Sie auf **Registrieren**.
4. Kopieren Sie auf der **Übersicht** die **Anwendungs-(Client-)ID** und die **Verzeichnis-(Mandanten-)ID**. Ihre Issuer-URL lautet `https://login.microsoftonline.com/{tenant-id}/v2.0`.
5. Öffnen Sie **Zertifikate & Geheimnisse > Neues Clientgeheimnis** und kopieren Sie den **Wert** des Geheimnisses (nicht die Geheimnis-ID).
6. Wählen Sie in Tale **Microsoft Entra ID** und geben Sie Client-ID, Clientgeheimnis und Issuer-URL ein.
7. Für die Gruppe-zu-Team-Synchronisierung fügen Sie unter **API-Berechtigungen** die Microsoft-Graph-Berechtigung **GroupMember.Read.All** hinzu und erteilen Sie die Administratorzustimmung.
8. Für die OneDrive- und SharePoint-Dokumentensynchronisation füge unter **API-Berechtigungen** die Microsoft-Graph-Berechtigungen **Files.Read** und **Sites.Read.All** hinzu und erteile die Administratorzustimmung. Eine neue Verbindung fordert beide standardmäßig an — das SSO-Token dient zugleich als Graph-Token, Mitglieder können also direkt nach der Anmeldung Dateien importieren. Soll die Organisation nur die Anmeldung nutzen, entferne die beiden Scopes aus dem Feld **Scopes**; der Microsoft-365-Eintrag bleibt dann auf der Dokumentenseite verborgen.

## Google

Google wird als generischer OIDC-Anbieter konfiguriert.

1. Öffnen Sie in der [Google Cloud Console](https://console.cloud.google.com) **APIs & Dienste > Anmeldedaten > Anmeldedaten erstellen > OAuth-Client-ID**.
2. Wählen Sie den Anwendungstyp **Webanwendung**.
3. Fügen Sie unter **Autorisierte Weiterleitungs-URIs** die auf der Tale-Seite angezeigte **Weiterleitungs-URL** hinzu und speichern Sie.
4. Kopieren Sie **Client-ID** und **Clientgeheimnis** oben auf der Client-Seite.
5. Wählen Sie in Tale **Generisches OIDC**, geben Sie Client-ID und Geheimnis ein und setzen Sie die Issuer-URL auf `https://accounts.google.com`. Die Endpunkte werden automatisch erkannt.

Das Standard-OIDC von Google liefert **keine** Gruppenmitgliedschaften, daher ist die Gruppe-zu-Team-Synchronisierung mit Google allein nicht verfügbar — sie benötigt das Admin SDK / die Cloud Identity API mit einem Workspace-Administrator. Anmeldung und Rollenzuordnung per Claim funktionieren normal.

## Generisches OIDC und OAuth2

Für jeden anderen OIDC-Anbieter (Okta, Auth0, Keycloak) wählen Sie **Generisches OIDC**, fügen die **Issuer-URL** sowie Client-ID/Geheimnis ein — Tale liest die Autorisierungs-, Token- und Userinfo-Endpunkte aus dem `.well-known/openid-configuration` des Issuers.

Wenn ein Anbieter OAuth2, aber kein Discovery-Dokument bietet, wählen Sie **OAuth2** und geben die URLs für **Autorisierungs-**, **Token-** und **Userinfo**-Endpunkt manuell ein. Verwendet der Anbieter abweichende Claim-Namen, ordnen Sie **E-Mail**, **Name** und **Gruppen** in den erweiterten Feldern der Verbindung zu (Dot-Pfade werden unterstützt, z. B. `realm_access.roles`).

## SAML 2.0

1. Wählen Sie in Tale **SAML 2.0**. Die Seite zeigt Ihre **SP-Metadaten-URL** und **ACS-URL (Antwort)** — kopieren Sie diese.
2. Erstellen Sie in Ihrem IdP eine neue SAML-2.0-Anwendung. Setzen Sie deren **ACS-URL** und **Entity-ID/Audience** auf die angezeigten SP-Werte (oder laden Sie die SP-Metadaten-URL hoch) und das **Name-ID**-Format auf E-Mail-Adresse.
3. Kopieren Sie die **Entity-ID**, die **Anmelde-URL** und das **Signaturzertifikat (PEM)** des IdP nach Tale und speichern Sie.
4. Ordnen Sie die Attribute für **E-Mail**, **Name** und **Gruppe** in Ihrem IdP zu; weichen die Namen von den Standardwerten ab, tragen Sie die passenden Attributnamen in Tales erweiterten Feldern ein.

Tale unterstützt sowohl IdP-initiiertes SAML (der IdP sendet eine Assertion an die ACS-URL) als auch SP-initiiertes SAML (ein Mitglied klickt auf **Mit SSO anmelden** und Tale leitet zum IdP weiter). Signierte Assertions sind erforderlich; verschlüsselte Assertions werden unterstützt, wenn Sie ein SP-Schlüsselpaar bereitstellen.

## Mehrere Organisationen auf einem Deployment

Ein Deployment kann mehrere Organisationen mit jeweils eigener Verbindung beherbergen. Klicke auf der Anmeldeseite auf **Weiter mit SSO** und wähle deine Organisation aus der Liste — jeder Eintrag zeigt den **Anzeigenamen** der Verbindung. Dieser Name ist auf der Anmeldeseite für alle sichtbar; setze in **Einstellungen > Enterprise SSO** pro Verbindung einen klaren Anzeigenamen.

## Bereitstellung: Rollen und Teams

Jedes Protokoll teilt sich eine Bereitstellungsrichtlinie:

- **Standardrolle** — die Rolle, die ein neu bereitgestelltes Mitglied erhält (standardmäßig Mitglied).
- **Rollen automatisch vom IdP zuweisen** — wenn aktiv, ordnen Rollenregeln einen Jobtitel, eine App-Rolle, eine Gruppe oder einen Claim einer Plattformrolle zu; trifft nichts zu, gilt die Standardrolle.
- **IdP-Gruppen mit Teams synchronisieren** — wenn aktiv, wird jede IdP-Gruppe des Benutzers bei der Anmeldung zu einem gleichnamigen Team (oder tritt ihm bei); **Gruppen ausschließen** überspringt störende Gruppen (kommagetrennt).

## SCIM-Bereitstellung (Benutzer und Gruppen)

Mit SCIM überträgt Ihr IdP Änderungen, ohne dass sich jemand anmelden muss. Klicken Sie im Abschnitt **SCIM-Bereitstellung** auf **Token generieren** — kopieren Sie es einmalig (es wird nicht erneut angezeigt) — und fügen Sie es zusammen mit der angezeigten **SCIM-Basis-URL** in die Bereitstellungseinstellungen Ihres IdP ein. Der IdP authentifiziert sich mit dem Token als Bearer-Anmeldedaten; Tale ermittelt die Organisation aus dem Token, das damit die Mandantengrenze bildet.

Tale implementiert SCIM 2.0 **Users** und **Groups**: anlegen, lesen, auflisten (mit `userName`/`displayName`-Filtern), ersetzen, patchen und löschen. Bereitgestellte Benutzer entsprechen Organisationsmitgliedern, Gruppen entsprechen Teams. **Die Deaktivierung ist sanft** — setzt der IdP einen Benutzer inaktiv (`active: false`), wird die Rolle des Mitglieds auf `disabled` gesetzt (was den Zugriff entzieht), und eine Reaktivierung stellt die vorherige Rolle wieder her. Ein SCIM-**Löschen** entfernt die Mitgliedschaft aus der Organisation; das Benutzerkonto selbst bleibt bestehen, und eine erneute Bereitstellung fügt es mit der Standardrolle der Verbindung wieder hinzu. Der Inhaber der Organisation kann über SCIM nie entfernt werden.

## Überprüfung

Verwenden Sie **Verbindung testen** für OIDC/OAuth2, um Discovery und Anmeldedaten vor dem Speichern zu bestätigen. Für SAML laden Sie die SP-Metadaten in Ihren IdP und führen eine Testanmeldung durch. Für SCIM bieten die meisten IdPs eine „Test"- oder „Jetzt bereitstellen"-Aktion, die einen Beispielbenutzer anlegt — prüfen Sie, ob er unter **Einstellungen > Mitglieder** erscheint. Eine End-to-End-SSO-Anmeldung prüfen Sie am besten gegen Ihren echten IdP in einer Staging-Organisation.
