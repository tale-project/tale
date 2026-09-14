---
title: Authentifizierung einrichten
description: Wähle lokale Konten, Unternehmens-SSO oder einen vertrauenswürdigen Authentifizierungsproxy.
---
Tale unterstützt lokale Konten mit E-Mail und Passwort, Unternehmens-SSO je Organisation und Identitäten aus einem vertrauenswürdigen Reverse Proxy. Entscheidend ist, wo dein Team Identitäten verwaltet und wer Konten bereitstellt. Anmeldung und Bereitstellung sind getrennt: SSO authentifiziert eine Person; Einladungen, Bereitstellung bei der Anmeldung oder SCIM regeln die Mitgliedschaft.

## Passende Integration wählen

| Umgebung | Einrichtung | Zentrale Voraussetzung |
| --- | --- | --- |
| Tale verwaltet lokale Konten | Lokale Anmeldung und Einladungen | Stabile Bereitstellungsgeheimnisse und eine erreichbare Instanz-URL. |
| Ein Unternehmens-Identitätsanbieter ist vorhanden | Unternehmens-SSO mit Microsoft Entra ID, generischem OIDC, OAuth2 oder SAML 2.0 | Eine IdP-Anwendung mit exakt passenden Callback- oder Metadaten-URLs. |
| Ein vorgeschalteter Proxy authentifiziert jede Anfrage | Vertrauenswürdige Kopfzeilen | Eine private Backend-Verbindung und ein gemeinsames internes Geheimnis. |

Diese Verfahren bilden keinen einzigen Schalter für die gesamte Instanz. Unternehmens-SSO gilt je Organisation, vertrauenswürdige Kopfzeilen werden für die Bereitstellung aktiviert. Plane und teste die Identitätszuordnung, bevor du bestehende Konten auf ein anderes Verfahren umstellst.

## Zuerst die öffentliche URL festlegen

Setze `SITE_URL` und eine gegebenenfalls unterstützte Basispfad-Konfiguration auf die tatsächlich verwendete Adresse. Schließe [TLS- und Domain-Einrichtung](/de/self-hosted/configuration/tls-and-domains) ab, bevor du Weiterleitungsadressen beim Identitätsanbieter registrierst.

Halte `BETTER_AUTH_SECRET` über alle Backend-Prozesse der Instanz hinweg konstant. Verwende das von der Bereitstellung erzeugte Geheimnis oder lade es aus deinem Secret-Manager. Unterschiedliche Werte können die Anmeldung unterbrechen, obwohl der Identitätsanbieter die Person akzeptiert.

## Lokale Konten verwenden

Die lokale Anmeldung speichert Passwort-Hashes in der Anwendungsdatenbank. Die [Ersteinrichtung](/de/self-hosted/install/first-admin) erstellt den ersten Inhaber; weitere Mitglieder kommen per Einladung hinzu. Richte den E-Mail-Versand ein, wenn Einladung und Passwortwiederherstellung darauf angewiesen sind.

Prüfe mit einem Testkonto Einladung, Anmeldung, Abmeldung und Wiederherstellung. Eine funktionierende Inhabersitzung bestätigt noch nicht, dass neue Mitglieder beitreten können.

## Unternehmens-SSO verbinden

Konfiguriere die Organisation unter **Einstellungen > Enterprise-SSO**. Microsoft Entra ID und generisches OIDC lesen die Endpunkte über den Aussteller; OAuth2 verwendet ausdrücklich angegebene Autorisierungs-, Token- und Userinfo-Endpunkte. SAML verwendet Metadaten, eine Assertion-Consumer-URL und Signaturzertifikate.

<Frame caption="Kopiere die URLs aus der laufenden Instanz, damit Domain und Bereitstellungspfad stimmen.">

![Die Seite für Unternehmens-SSO zeigt die Protokollauswahl und die Verbindungsfelder für Microsoft Entra ID.](/images/platform/settings-enterprise-sso.webp)

</Frame>

Verwende die dort angezeigten Callback- und Metadaten-URLs. Aktuelle native OIDC-Callbacks nutzen `/api/sso/callback`; für vorhandene Registrierungen wird auch `/http_api/api/sso/callback` unterstützt. Die Registrierung beim IdP muss zu der im Ablauf verwendeten URL passen.

[Unternehmens-SSO und Bereitstellung](/de/platform/admin/enterprise-sso) beschreibt Protokolle, Claim-Zuordnung, Standardrollen, Team-Synchronisierung und SCIM. Teste die Anmeldung in einer separaten Browsersitzung, bevor du deine Administratorsitzung beendest. Eine gelungene Discovery-Prüfung bestätigt weder Claims und Gruppenrechte noch die vollständige Anmeldung.

## Einem Authentifizierungsproxy vertrauen

Aktiviere vertrauenswürdige Kopfzeilen nur, wenn dein Proxy die Anmeldung übernimmt und die Verbindung zu Tale schützen kann. Die Standardkopfzeilen heißen `Remote-Email`, `Remote-Name`, `Remote-Role` und `Remote-Teams`.

Setze `TRUSTED_HEADERS_ENABLED=true` und übergib `TRUSTED_HEADERS_INTERNAL_SECRET`. Der Proxy muss dieses Geheimnis bei weitergeleiteten Anfragen in `Remote-Internal-Secret` senden. Die [Umgebungsreferenz](/de/self-hosted/configuration/environment-reference) nennt die Variablen `TRUSTED_*_HEADER` zum Ändern dieser Namen.

<Warning>

Der Proxy muss Identitätskopfzeilen des Clients entfernen und eigene authentifizierte Werte setzen. Beschränke den Backend-Zugriff auf diesen Proxy. Wer passende Identitätskopfzeilen und das interne Geheimnis senden kann, kann als die genannte Person auftreten.

</Warning>

`Remote-Teams` enthält kommagetrennte Einträge im Format `id:name`, etwa `t-fin:Finance,t-ops:Operations`. Ohne Kopfzeile bleibt die Teamverwaltung unberührt. Eine vorhandene, aber leere Kopfzeile entfernt zuvor von dieser Synchronisierung vergebene Mitgliedschaften. Ungültige Einträge können deshalb synchronisierte Mitgliedschaften entfernen. Manuell vergebene Mitgliedschaften bleiben erhalten.

## Anmeldefehler eingrenzen

| Symptom | Erste Prüfung |
| --- | --- |
| Der IdP lehnt eine Weiterleitung ab | Vergleiche registrierte und angezeigte URL einschließlich Schema, Host und Pfad. |
| Die Weiterleitung endet ohne Anmeldung | Prüfe Erreichbarkeit des Callbacks, Cookies und Claim-Namen. |
| Ein Mitglied erhält die falsche Rolle | Prüfe Standardrolle und Zuordnung anhand seiner tatsächlichen Claims. |
| Synchronisierte Teams verschwinden | Prüfe Gruppen-Claim oder `Remote-Teams`; unterscheide fehlende und leere Werte. |
| Die Kopfzeilen-Anmeldung wird abgelehnt | Prüfe Aktivierung, gemeinsames Geheimnis und Kopfzeilennamen im Proxy. |

Teste Zuordnungsänderungen in einer Staging-Organisation und halte einen geprüften administrativen Wiederherstellungsweg bereit. Änderungen können alle Mitglieder betreffen, deren Identität von dieser Verbindung abhängt.
