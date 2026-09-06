---
title: Authentifizierung
description: Die vier Sign-in-Modi, die Tale mitbringt — lokales Passwort, Microsoft Entra, generisches OIDC und trusted Headers — und wie ein Operator zwischen ihnen umschaltet.
---

Tale bringt vier Sign-in-Modi mit, die ein Operator pro Instanz wählt. Der Default ist lokales Passwort, mit einem Benutzer pro E-Mail; Microsoft Entra und generisches OIDC delegieren die Identität an einen externen Anbieter; trusted Headers übergibt die Verantwortung an einen Reverse-Proxy, der SSO upstream bereits terminiert. Die Entscheidung ist insofern dauerhaft, als sie prägt, wie Benutzer provisioniert werden — Modi nach Rollout zu wechseln ist möglich, aber jeder bestehende Benutzer muss auf die neue Identitätsquelle umgemappt werden.

Lokales Passwort und trusted Headers schalten Env-Vars um ([Umgebungsvariablen-Referenz](/de/self-hosted/configuration/environment-reference)); Microsoft Entra und generisches OIDC werden pro Organisation in der laufenden App konfiguriert. Diese Seite ist der Modus-für-Modus-Durchgang — wann du jeden wählst, was er für den Benutzer verändert, was bricht, wenn er fehlkonfiguriert ist.

## Lokales Passwort (Default)

Lokales Passwort ist der Modus, den du bekommst, wenn du nichts setzt. Die Plattform speichert einen bcrypt-Hash in Postgres, signiert die Session mit `BETTER_AUTH_SECRET`, und der Benutzer meldet sich mit einer E-Mail und einem Passwort an, mit dem der Admin ihn eingeladen hat. Kein externer Identitäts-Anbieter ist beteiligt.

Greif danach auf kleinen Instanzen und Air-gapped-Deployments, wo das Hinzufügen eines IdP mehr Reibung erzeugt als es löst. Der Preis: Passwort-Reset läuft über den Admin (oder über E-Mail, wenn `SMTP_*` konfiguriert ist), und es gibt keine SSO-Story.

```bash
# .env — keine Flags für lokales Passwort nötig
HOST=localhost
SITE_URL=https://localhost
BETTER_AUTH_SECRET=...
```

## Microsoft Entra

Der Microsoft-Entra-Modus fügt einen **Weiter mit SSO**-Button zum Sign-in-Bildschirm hinzu und nimmt Benutzer aus einem Tenant an, den du kontrollierst. Es gibt keinen Env-Var-Schalter: Die Verbindung wird pro Organisation unter **Einstellungen > Enterprise-SSO** konfiguriert, sobald die Plattform läuft — wähle das Protokoll **Microsoft Entra ID** und trage Client-ID, Client-Secret und Issuer-URL aus deiner App-Registrierung ein. Der vollständige Durchgang, inklusive Rollen-Mapping und Gruppen-zu-Teams-Sync, ist [Enterprise-SSO und Bereitstellung](/de/platform/admin/enterprise-sso).

Zwei Deployment-Werte müssen stimmen, bevor der Flow funktionieren kann: `SITE_URL`, weil die Sign-in-Redirect-URL daraus abgeleitet wird, und `BETTER_AUTH_SECRET`, das den OAuth-State signiert. Der Redirect-URI, den du in Entra registrierst, ist `${SITE_URL}${BASE_PATH}/http_api/api/sso/callback` — die Einstellungsseite zeigt die exakte URL zum Kopieren, und sie muss Byte für Byte übereinstimmen, sonst lehnt Entra den Sign-in mit `AADSTS50011` ab. Die Tenant-ID in der Entra-App-Registrierung grenzt ein, wer sich anmelden kann; eine Multi-Tenant-Registrierung akzeptiert jeden mit einem Microsoft-Konto, was selten ist, was du willst.

## Generisches OIDC

Generisches OIDC akzeptiert jeden spec-konformen Identitäts-Anbieter — Keycloak, Authentik, Okta, Google Workspace. Die Konfiguration lebt auf der **Single Sign-On**-Karte unter **Einstellungen > Connectors**: Wähle den Anbietertyp **Generisches OIDC**, trag Aussteller-URL, Client-ID und Client-Secret ein, und Tale liest die Authorization-, Token- und Userinfo-Endpunkte aus dem `.well-known/openid-configuration`-Dokument des Ausstellers. Der Flow nutzt den Standard Authorization-Code-Grant mit PKCE (S256). Tale speichert kein Secret auf Platte für OIDC; Client-ID und Client-Secret liegen im verschlüsselten Credential-Store. Der Redirect-URI, den du bei deinem Anbieter registrierst, ist `${SITE_URL}/http_api/api/sso/callback`.

Identitäts-Anbieter sind sich uneins, wo Claims liegen, also lässt dich die Karte auf deine zeigen. Die Felder **E-Mail-Claim**, **Namens-Claim** und **Gruppen-Claim** nehmen einen Claim-Namen oder einen Punktpfad in die Userinfo-Antwort — Keycloaks Realm-Rollen liegen zum Beispiel unter `realm_access.roles`. Rollenzuordnungsregeln weisen Plattformrollen beim Sign-in zu: Eine **Gruppe**-Regel matcht die Gruppen des Benutzers gegen ein Platzhalter-Muster (`platform-admin*` → Admin), eine **Claim**-Regel matcht einen beliebigen per Punktpfad aufgelösten Claim. **Teams automatisch bereitstellen** spiegelt die Gruppen, die dein Anbieter zurückgibt, bei jedem Sign-in als Tale-Teams — abzüglich der Gruppen, die du ausschließt.

Ein durchgerechnetes Keycloak-Beispiel: Lege einen Confidential Client `tale-platform` mit dem Redirect-URI oben an, ergänze einen Group-Membership-Mapper, damit der Client `groups` in Userinfo ausgibt, setze dann in Tale den Aussteller auf `https://keycloak.example.com/realms/<realm>`, füge eine Gruppen-Regel `platform-admin*` → Admin hinzu und klicke **Verbindung testen** — das validiert die Discovery, bevor irgendetwas gespeichert wird.

Das ist der Modus für Teams, die bereits einen IdP betreiben und ihre bestehende Identitäts-Oberfläche in Tale haben wollen.

## Trusted Headers

Trusted Headers ist der Modus für Sites, die SSO an einem vorgelagerten Reverse-Proxy terminieren — oauth2-proxy, Pomerium, Authelia. Der Proxy authentifiziert den Benutzer und leitet Identitäts-Header weiter; Tale liest standardmäßig `Remote-Email`, `Remote-Name`, `Remote-Role` und `Remote-Teams`, vertraut ihnen und legt den Benutzer-Datensatz on-the-fly an oder aktualisiert ihn. Nennt dein Proxy seine Header anders (oauth2-proxy schickt `X-Auth-Request-Email`), bildest du sie mit den `TRUSTED_*_HEADER`-Variablen aus der [Umgebungsvariablen-Referenz](/de/self-hosted/configuration/environment-reference) ab.

```bash
# .env
TRUSTED_HEADERS_ENABLED=true
TRUSTED_HEADERS_INTERNAL_SECRET=<langer zufälliger Wert>
```

Das Secret ist keine Option: Die Identitäts-Header kann jeder fälschen, der das Backend erreicht — deshalb verweigert der Endpunkt den Dienst, bis `TRUSTED_HEADERS_INTERNAL_SECRET` gesetzt ist. Konfiguriere den authentifizierenden Proxy so, dass er denselben Wert bei jeder Anfrage an Tale im Header `Remote-Internal-Secret` mitschickt (der Header-Name lässt sich über `TRUSTED_SECRET_HEADER` umbenennen, falls dein Proxy eigene Namen vorgibt) — eine Anfrage ohne den passenden Wert wird abgewiesen, bevor irgendein Benutzer nachgeschlagen wird.

`Remote-Teams` trägt Team-Zugehörigkeiten als kommagetrennte `id:name`-Einträge — `t-fin:Finance, t-ops:Operations`. Bei jeder Anmeldung legt Tale jedes genannte Team in der Organisation an, falls es noch fehlt, und nimmt den Benutzer auf; ein Team, das der Header nicht mehr nennt, verlässt er wieder. Der Abgleich fasst nur Zugehörigkeiten an, die er selbst vergeben hat — was ein Admin von Hand zugewiesen hat, bleibt. Lass den Header weg, wenn Tale sich aus der Team-Verwaltung heraushalten soll; schick ihn gesetzt, aber leer, um alle vom Proxy vergebenen Zugehörigkeiten zu entziehen. Ein gesetzter Wert ohne einen einzigen `id:name`-Eintrag (etwa bloße Namen) zählt als leer und hinterlässt eine Warnung im Log des Plattform-Containers — schau dort nach, wenn Benutzer nach einer Proxy-Änderung ihre Teams verlieren.

Das Bedrohungsmodell bleibt heikel. Alles, was den Plattform-Container mit diesen Headern **und** dem Secret erreichen kann, wird zum Benutzer, der in ihnen genannt ist. Beschränke den Plattform-Port so, dass nur der Proxy mit ihm sprechen kann (ein Docker-Netzwerk oder eine Host-Firewall-Regel), und exponier den Plattform-Container nie direkt zum Internet, wenn dieser Modus an ist.

## Wo das hingehört

Die vier Modi sind im Geist gegenseitig ausschliessend, aber technisch additiv — Microsoft Entra und trusted Headers können auf derselben Instanz koexistieren, wenn deine IdP-Story mitten in der Migration steckt. Die volle per-Modus-Abwägungstabelle lebt in [Mitglieder und Rollen](/de/platform/admin/members-and-roles) auf der Benutzerseite; diese Seite deckt den Schalter des Operators ab. Die nächste Konfigurationsseite, die zu lesen sich lohnt, ist [Anbieter](/de/self-hosted/configuration/providers) — sobald Benutzer sich anmelden können, brauchst du immer noch mindestens einen Modell-Anbieter verdrahtet, bevor sie irgendetwas tun können.
