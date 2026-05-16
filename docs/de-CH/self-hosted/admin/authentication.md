---
title: Authentifizierung
description: Wie Authentifizierung in Tale funktioniert — Passwort, Microsoft Entra ID SSO und vertrauenswürdige HTTP-Kopfzeilen.
---

Authentifizierung entscheidet, wer überhaupt in eine Tale-Instanz hineinkommt. Das Produkt liefert drei Methoden — Passwort, Microsoft Entra ID SSO und Integration über vertrauenswürdige HTTP-Kopfzeilen mit einem vorgelagerten Reverse-Proxy — und sie können auf derselben Instanz nebeneinander laufen. Diese Seite ist für den Operator, der Authentifizierung an einen Identitäts-Anbieter verdrahtet; die Rollen-Matrix, die entscheidet, was jeder Nutzer tun darf, sobald er drin ist, lebt unter [Mitglieder und Rollen](/de-CH/platform/admin/members-and-roles).

Tale ist standardmässig offline-first. Es gibt keine öffentliche Registrierung, kein Passwort-Reset über einen "Passwort vergessen"-Link und keine automatische Kontoerstellung. Der erste Nutzer, der die App öffnet, wird Inhaber; jeder andere Nutzer wird von einem Admin in **Einstellungen > Mitglieder** angelegt oder automatisch über SSO oder vertrauenswürdige Kopfzeilen versorgt.

## Passwort (Voreinstellung)

Es ist keine Konfiguration nötig. Admins legen Nutzer mit einer E-Mail, einem Passwort und einer Rolle in **Einstellungen > Mitglieder** an. Nutzer melden sich mit diesen Anmeldedaten auf der Standard-Login-Seite an.

Nutzer, die über SSO oder vertrauenswürdige Kopfzeilen beigetreten sind, können auch über **Konto-Einstellungen** ein Passwort setzen, um direkten Login neben ihrer primären Methode zu aktivieren. Die beiden Pfade existieren nebeneinander — ein Nutzer mit sowohl Passwort als auch SSO-Bindung kann beides nutzen.

## Microsoft Entra ID SSO

Microsoft Entra ID ist der SSO-Pfad für Microsoft-365- oder Azure-AD-Organisationen. Nutzer melden sich mit ihren bestehenden Microsoft-Konten an und werden beim ersten Login automatisch versorgt. Der Ablauf nutzt OIDC darunter; Tale agiert als Relying Party.

### Schritt 1 — Die App in Azure registrieren

Öffne im [Azure Portal](https://portal.azure.com) **Microsoft Entra ID > App-Registrierungen** und erstelle eine neue Registrierung (oder wähle eine bestehende).

Füge eine Weiterleitungs-URI hinzu: `https://yourdomain.com/api/sso/callback`. Notiere die Anwendungs-(Client-)ID und die Verzeichnis-(Mandanten-)ID; beide stehen direkt im **Überblick**-Blade. Erzeuge ein Client-Geheimnis unter **Zertifikate & Geheimnisse** und kopiere den Wert — Azure zeigt das Geheimnis nur einmal.

### Schritt 2 — Tale an Azure binden

Öffne in Tale **Einstellungen > Integrationen** und wähle **Microsoft Entra ID** als SSO-Anbieter. Füge die Client-ID, die Mandanten-ID und das Geheimnis ein. Optionale Schalter aktivieren Gruppen-Sync, Rollen-Mapping, automatische Versorgung neuer Konten und OneDrive-Zugriff für die Wissensdatenbank; aktiviere jeden einzelnen, wenn er zu deinem IdP-Setup passt.

Der SSO-Knopf erscheint auf der Login-Seite, sobald konfiguriert. SSO und Passwort-Login existieren nebeneinander — Nutzer, die vor der SSO-Einrichtung existierten, nutzen weiter ihre Passwörter; neue über SSO erstellte Nutzer können sich später für ein Passwort entscheiden.

Für Infrastructure-as-Code-Installationen, die `.env` der UI vorziehen, sind die drei Werte auch als `AUTH_MICROSOFT_ENTRA_ID_ID`, `AUTH_MICROSOFT_ENTRA_ID_SECRET` und `AUTH_MICROSOFT_ENTRA_ID_TENANT_ID` verfügbar. Die Env-Var-Form und die UI-Form sind gleichwertig; sie zu mischen ist OK, aber wähle eine als Wahrheitsquelle für eine gegebene Instanz.

## Vertrauenswürdige HTTP-Kopfzeilen

Vertrauenswürdige Kopfzeilen decken das Deployment-Muster ab, in dem Tale hinter einem authentifizierenden Reverse-Proxy sitzt — Authelia, Authentik, oauth2-proxy oder irgendetwas anderes, das Nutzer authentifiziert und Identität in HTTP-Kopfzeilen weiterreicht. Mit aktivierten vertrauenswürdigen Kopfzeilen wird die Login-Seite vollständig übersprungen: jede Anfrage wird transparent gegen die Kopfzeilen authentifiziert, die der Proxy setzt, und ein Konto wird beim ersten Kontakt versorgt.

Das ist der richtige Pfad, wenn deine Organisation bereits ein SSO-Portal vor jeder internen App fährt und Tale in dieselbe Auth-Grenze passen soll.

### Den Modus aktivieren

Füge das Flag in `.env` hinzu:

```dotenv
TRUSTED_HEADERS_ENABLED=true
```

Der Modus greift nach `tale deploy` (Produktion) oder `tale start` (lokal) — Convex nimmt die Env beim Prozess-Start auf, also wechselt ein lebendiger Stack erst um, wenn der Container neu startet.

### Standard-Kopfzeilen-Namen

Von Haus aus liest Tale vier Kopfzeilen. Jeder Proxy nutzt andere Namen; die Overrides im nächsten Abschnitt richten Tale am Proxy aus, der davorsteht.

| Kopfzeile   | Erforderlich | Voreingestellter Name | Beschreibung                                                                         |
| ----------- | ------------ | --------------------- | ------------------------------------------------------------------------------------ |
| E-Mail      | Ja           | `Remote-Email`        | E-Mail-Adresse des Nutzers.                                                          |
| Anzeigename | Nein         | `Remote-Name`         | Anzeigename des Nutzers. Fällt auf den Nutzernamen der E-Mail zurück, wenn abwesend. |
| Rolle       | Nein         | `Remote-Role`         | Eines von `admin`, `developer`, `editor` oder `member`. Voreinstellung `member`.     |
| Teams       | Nein         | `Remote-Teams`        | Komma-separierte `id:name`-Liste (z. B. `abc123:Engineering, def456:Design`).        |

### Die Kopfzeilen-Namen überschreiben

Die meisten Proxies liefern kein `Remote-*`. Überschreibe die Voreinstellungen, damit sie zu dem Proxy passen, der davorsteht:

```dotenv
TRUSTED_EMAIL_HEADER=X-Forwarded-Email
TRUSTED_NAME_HEADER=X-Forwarded-User
TRUSTED_ROLE_HEADER=X-Forwarded-Role
TRUSTED_TEAMS_HEADER=X-Forwarded-Teams
```

Häufige Proxies:

| Proxy        | E-Mail-Kopfzeile    | Namens-Kopfzeile   | Gruppen-/Rollen-Kopfzeile |
| ------------ | ------------------- | ------------------ | ------------------------- |
| Authelia     | `Remote-Email`      | `Remote-Name`      | `Remote-Groups`           |
| Authentik    | `X-authentik-email` | `X-authentik-name` | `X-authentik-groups`      |
| oauth2-proxy | `X-Forwarded-Email` | `X-Forwarded-User` | `X-Forwarded-Groups`      |

### Wie eine Anfrage fliesst

Mit aktivierten vertrauenswürdigen Kopfzeilen folgt jede Browser-Anfrage demselben Pfad:

1. Der Reverse-Proxy authentifiziert den Nutzer gegen seinen eigenen Identitäts-Store und setzt die Identitäts-Kopfzeilen auf der weitergeleiteten Anfrage.
2. Tales Login-Seite erkennt den Modus für vertrauenswürdige Kopfzeilen und navigiert den Browser über eine clientseitige Weiterleitung (kein HTTP 302) zu `/api/trusted-headers/authenticate`.
3. Das Tale-Backend liest die Kopfzeilen, findet oder erstellt den Nutzer und setzt ein Session-Cookie, das auf deine Domain begrenzt ist.
4. Der Browser wird zum Dashboard weitergeleitet.

Bei nachfolgenden Anfragen wird das Session-Cookie wiederverwendet. Die Session aktualisiert sich bei jeder Authentifizierung und zieht die Rolle und Teams erneut aus den Kopfzeilen, damit eine Änderung im vorgelagerten Identitäts-Store beim nächsten Seitenaufruf ausbreitet — es gibt keine manuelle Synchronisation.

### Team-Durchreichung

Der externe Identitäts-Anbieter ist die einzige Wahrheitsquelle für Teams; Team-IDs werden direkt durchgereicht, ohne interne Datenbankabfrage. Lass die Teams-Kopfzeile weg, um Teams unverändert zu lassen, oder schicke sie leer, um den Nutzer aus jedem Team zu entfernen.

### Internes Geheimnis (optional)

Für Defense-in-Depth setze ein gemeinsames Geheimnis, das der convex-Endpunkt validiert, bevor er den Kopfzeilen vertraut:

```dotenv
TRUSTED_HEADERS_INTERNAL_SECRET=your-random-secret
```

Das stellt sicher, dass der Authentifizierungs-Endpunkt nur über die vertrauenswürdige Proxy-Kette erreicht werden kann. Ohne das Geheimnis wird jede Anfrage, die mit den richtigen Kopfzeilen auf `/api/trusted-headers/authenticate` landet, akzeptiert; mit dem Geheimnis muss die Anfrage auch den passenden internen Kopfzeilen-Wert tragen.

Aktiviere vertrauenswürdige Kopfzeilen nur, wenn der vorgelagerte Proxy diese Kopfzeilen von externen Anfragen entfernt. Wenn externe Clients die Kopfzeilen direkt setzen können, können sie jeden Nutzer imitieren.

## Wo das einsetzt

Authentifizierung ist die strikteste Version der Frage, die [Mitglieder und Rollen](/de-CH/platform/admin/members-and-roles) beantwortet. Mitglieder und Rollen entscheidet, wer was tun darf, sobald sie drin sind; Authentifizierung entscheidet, wer überhaupt reinkommt. Die drei Methoden — Passwort, Microsoft Entra SSO, vertrauenswürdige Reverse-Proxy-Kopfzeilen — können auf derselben Instanz nebeneinander laufen, sodass eine Organisation SSO für Mitarbeiter und vertrauenswürdige Kopfzeilen für eine Authelia-vorgelagerte öffentliche Oberfläche nutzen kann, wobei dieselbe Tale-Rollen-Matrix für beide gilt.

Für die Zwei-Faktor-Schicht, die oben auf jeder der drei Methoden sitzt, ist [Zwei-Faktor-Authentifizierung](/de-CH/platform/admin/two-factor-authentication) die Seite. Für die Env-Var-Bestandsaufnahme, die vertrauenswürdige Kopfzeilen und Entra SSO ans Deployment bindet, ist die [Umgebungsreferenz](/de-CH/self-hosted/configuration/environment-reference) der Index.
