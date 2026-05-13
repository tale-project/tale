---
title: Authentifizierung
description: Wie Authentifizierung in Tale funktioniert — Passwort, Microsoft Entra ID SSO und Trusted Headers.
---

Tale ist eine Offline-First-Plattform. Es gibt keine Selbst-Registrierung und kein Passwort-Zurücksetzen. Der erste Nutzer, der die App öffnet, erstellt das Inhaber-Konto. Alle weiteren Nutzer werden von einem Admin unter **Einstellungen > Mitglieder** angelegt.

Für Self-Service-Login und automatisches Bereitstellen von Konten verbinde Tale mit einem SSO-Anbieter oder konfiguriere Trusted Headers.

## Passwort (Standard)

Keine Konfiguration nötig. Admins legen Nutzer mit Email, Passwort und Rolle unter **Einstellungen > Mitglieder** an. Nutzer melden sich auf der Login-Seite mit ihren Credentials an.

Nutzer, die per SSO oder Trusted Headers hinzugekommen sind, können auch unter **Account-Einstellungen** ein Passwort setzen, um direkt anmelden zu können.

## Microsoft Entra ID (SSO)

Single Sign-on mit Microsoft 365 / Azure AD. Nutzer melden sich mit ihren bestehenden Microsoft-Konten an und werden beim ersten Sign-in automatisch angelegt.

### Azure-Einrichtung

1. Gehe im [Azure Portal](https://portal.azure.com) zu Microsoft Entra ID > App registrations.
2. Lege eine neue Registrierung an (oder nutze eine bestehende).
3. Ergänze eine Redirect URI: `https://yourdomain.com/api/sso/callback`.
4. Notiere Application (client) ID, Directory (tenant) ID und erzeuge ein Client Secret.

### Tale-Einrichtung

1. Gehe im Admin-Panel zu **Einstellungen > Integrationen**.
2. Wähle **Microsoft Entra ID** als SSO-Anbieter.
3. Gib Client-ID, Client-Secret und Issuer-URL ein.
4. Optional Gruppen-Sync, Rollen-Mapping, Auto-Provisioning und OneDrive-Zugriff aktivieren.

Der SSO-Button erscheint nach der Konfiguration auf der Login-Seite.

> **Hinweis:** SSO und Passwort-Login lassen sich gleichzeitig nutzen. Nutzer, die es vor der SSO-Einrichtung gab, nutzen weiter ihr Passwort.

## Trusted Headers

Für Deployments hinter einem authentifizierenden Reverse-Proxy wie Authelia, Authentik oder oauth2-proxy. Der Proxy authentifiziert die Nutzer extern; Tale liest die Identität aus den gesetzten HTTP-Headern und legt Konten bei der ersten Anfrage automatisch an.

Wenn Trusted Headers aktiv sind, wird die Login-Seite übersprungen — Nutzer sind bei jeder Anfrage transparent authentifiziert.

### Konfiguration

Ergänze diese Variable in deiner `.env`-Datei:

```dotenv
TRUSTED_HEADERS_ENABLED=true
```

### Header-Namen

Standardmäßig liest Tale diese Header:

| Header      | Pflicht | Standard-Name  | Beschreibung                                                                           |
| ----------- | ------- | -------------- | -------------------------------------------------------------------------------------- |
| Email       | Ja      | `Remote-Email` | Email-Adresse des Nutzers.                                                             |
| Anzeigename | Nein    | `Remote-Name`  | Anzeigename des Nutzers (fällt auf den Mail-Teil vor dem @ zurück).                    |
| Rolle       | Nein    | `Remote-Role`  | Eine von `admin`, `developer`, `editor` oder `member` (Standard: `member`).            |
| Teams       | Nein    | `Remote-Teams` | Komma-getrennte Liste im Format `id:name` (z. B. `abc123:Engineering, def456:Design`). |

Jeder Proxy nutzt andere Header-Namen. Überschreibe die Defaults mit Environment-Variablen passend zu deinem Proxy:

```dotenv
TRUSTED_EMAIL_HEADER=X-Forwarded-Email
TRUSTED_NAME_HEADER=X-Forwarded-User
TRUSTED_ROLE_HEADER=X-Forwarded-Role
TRUSTED_TEAMS_HEADER=X-Forwarded-Teams
```

Gängige Proxy-Konfigurationen:

| Proxy        | Email-Header        | Name-Header        | Groups/Role-Header   |
| ------------ | ------------------- | ------------------ | -------------------- |
| Authelia     | `Remote-Email`      | `Remote-Name`      | `Remote-Groups`      |
| Authentik    | `X-authentik-email` | `X-authentik-name` | `X-authentik-groups` |
| oauth2-proxy | `X-Forwarded-Email` | `X-Forwarded-User` | `X-Forwarded-Groups` |

### So funktioniert es

1. Der Reverse-Proxy authentifiziert den Nutzer und setzt Identitäts-Header.
2. Die Login-Seite erkennt den Trusted-Headers-Modus und navigiert den Browser per `window.location.href` an `/api/trusted-headers/authenticate` (Client-Side-Navigation, kein HTTP-Redirect).
3. Tale liest die Header, findet oder erstellt den Nutzer und setzt ein Session-Cookie.
4. Der Browser wird ans Dashboard weitergeleitet.

Bei folgenden Anfragen wird das bestehende Session-Cookie wiederverwendet. Die Session wird aktualisiert und Header-Werte (Rolle, Teams) bei jeder Authentifizierung frisch übernommen.

### Teams

Der externe IdP ist die einzige Quelle der Wahrheit für Teams — Team-IDs werden direkt durchgereicht, ohne interne Datenbank-Lookups. Lasse den Teams-Header weg, um Teams unverändert zu lassen; sende ihn leer, um den Nutzer aus allen Teams zu entfernen.

### Internes Secret (optional)

Für Defense-in-Depth kannst du ein gemeinsames Secret setzen, das der Convex-Endpoint prüft:

```dotenv
TRUSTED_HEADERS_INTERNAL_SECRET=your-random-secret
```

So ist sichergestellt, dass der Auth-Endpoint nur über die Trusted-Proxy-Chain erreichbar ist.

> **Sicherheit:** Aktiviere Trusted Headers nur, wenn Tale hinter einem vertrauenswürdigen Proxy läuft, der diese Header aus externen Anfragen entfernt. Können externe Clients die Header setzen, lassen sie sich als beliebige Nutzer ausgeben.
