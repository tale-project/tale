---
title: Authentifizierung
description: Die vier Sign-in-Modi, die Tale mitbringt — lokales Passwort, Microsoft Entra, generisches OIDC und trusted Headers — und welche Env-Vars zwischen ihnen umschalten.
---

Tale bringt vier Sign-in-Modi mit, die ein Operator pro Instanz wählt. Der Default ist lokales Passwort, mit einem Benutzer pro E-Mail; Microsoft Entra und generisches OIDC delegieren die Identität an einen externen Anbieter; trusted Headers übergibt die Verantwortung an einen Reverse-Proxy, der SSO upstream bereits terminiert. Die Entscheidung ist insofern dauerhaft, als sie prägt, wie Benutzer provisioniert werden — Modi nach Rollout zu wechseln ist möglich, aber jeder bestehende Benutzer muss auf die neue Identitätsquelle umgemappt werden.

Die Env-Vars, die jeden Modus aktivieren, leben in der [Umgebungsvariablen-Referenz](/de/self-hosted/configuration/environment-reference). Diese Seite ist der Modus-für-Modus-Durchgang — wann du jeden wählst, was er für den Benutzer verändert, was bricht, wenn er fehlkonfiguriert ist.

## Lokales Passwort (Default)

Lokales Passwort ist der Modus, den du bekommst, wenn du nichts setzt. Die Plattform speichert einen bcrypt-Hash in Postgres, signiert die Session mit `BETTER_AUTH_SECRET`, und der Benutzer meldet sich mit einer E-Mail und einem Passwort an, mit dem der Admin ihn eingeladen hat. Kein externer Identitäts-Anbieter ist beteiligt.

Greif danach auf kleinen Instanzen und Air-gapped-Deployments, wo das Hinzufügen eines IdP mehr Reibung erzeugt als es löst. Der Preis: Passwort-Reset läuft über den Admin (oder über E-Mail, wenn `SMTP_*` konfiguriert ist), und es gibt keine SSO-Story.

```bash
# .env — keine Flags für lokales Passwort nötig
HOST=tale.local
SITE_URL=https://tale.local
BETTER_AUTH_SECRET=...
```

## Microsoft Entra

Der Microsoft-Entra-Modus fügt einen OAuth/OIDC-Button zum Sign-in-Bildschirm hinzu und nimmt Benutzer aus einem Tenant an, den du kontrollierst. Setze `MICROSOFT_AUTH_ENABLED=true`, um den Button zu aktivieren; die per-Tenant Client-ID, der Client-Secret und der Redirect-URI werden in **Einstellungen > Authentifizierung** konfiguriert, sobald die Plattform läuft.

```bash
# .env
MICROSOFT_AUTH_ENABLED=true
```

Der Redirect-URI, den Entra braucht, ist `${SITE_URL}/api/auth/callback/microsoft`. Die Tenant-ID in der Entra-App-Registrierung grenzt ein, wer sich anmelden kann; eine Multi-Tenant-Registrierung akzeptiert jeden mit einem Microsoft-Konto, was selten ist, was du willst.

## Generisches OIDC

Generisches OIDC akzeptiert jeden spec-konformen Identitäts-Anbieter — Keycloak, Authentik, Okta, Google Workspace. Der Button-Text ist in **Einstellungen > Authentifizierung** konfigurierbar, und der Flow nutzt den Standard Authorization-Code-Grant mit PKCE. Tale speichert kein Secret auf Platte für OIDC; die Client-ID und die Discovery-URL gehen durch die UI, der Client-Secret durch den verschlüsselten Credential-Store.

Das ist der Modus für Teams, die bereits einen IdP betreiben und ihre bestehende Identitäts-Oberfläche in Tale haben wollen.

## Trusted Headers

Trusted Headers ist der Modus für Sites, die SSO an einem vorgelagerten Reverse-Proxy terminieren — oauth2-proxy, Pomerium, Authelia. Der Proxy authentifiziert den Benutzer und leitet identifizierende Header weiter (`X-Auth-Request-Email`, `X-Auth-Request-Preferred-Username`); Tale vertraut diesen Headern und legt den Benutzer-Datensatz on-the-fly an oder aktualisiert ihn.

```bash
# .env
TRUSTED_HEADERS_ENABLED=true
```

Das Bedrohungsmodell ist heikel. Alles, was den Plattform-Container mit diesen Headern erreichen kann, wird zum Benutzer, der in ihnen genannt ist. Beschränke den Plattform-Port so, dass nur der Proxy mit ihm sprechen kann (ein Docker-Netzwerk oder eine Host-Firewall-Regel), und exponier den Plattform-Container nie direkt zum Internet, wenn dieser Modus an ist.

## Wo das hingehört

Die vier Modi sind im Geist gegenseitig ausschliessend, aber technisch additiv — Microsoft Entra und trusted Headers können auf derselben Instanz koexistieren, wenn deine IdP-Story mitten in der Migration steckt. Die volle per-Modus-Abwägungstabelle lebt in [Mitglieder und Rollen](/de/platform/admin/members-and-roles) auf der Benutzerseite; diese Seite deckt den Schalter des Operators ab. Die nächste Konfigurationsseite, die zu lesen sich lohnt, ist [Anbieter](/de/self-hosted/configuration/providers) — sobald Benutzer sich anmelden können, brauchst du immer noch mindestens einen Modell-Anbieter verdrahtet, bevor sie irgendetwas tun können.
