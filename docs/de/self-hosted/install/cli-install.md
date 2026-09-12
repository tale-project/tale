---
title: Die tale-CLI installieren
description: Die tale-CLI auf macOS, Linux oder Windows installieren — und sie gegen deine self-hosted Instanz für Deploys und Upgrades konfigurieren.
---

Die `tale`-CLI ist der empfohlene Weg, Tale zu betreiben und zu bedienen. Der [Quickstart](/de/self-hosted/install/quickstart) nutzt sie bereits, um eine Instanz lokal mit `tale init` und `tale dev` aufzustellen; diese Seite ist die andere Hälfte — die CLI auf einer Workstation installieren, damit sie eine _entfernte_ Instanz fahren kann: neue Versionen deployen, Migrationen ausführen und Diagnostiken einfangen, ohne dass du dir jede `docker compose`-Invokation merken musst.

Dieselbe CLI übernimmt Container-Operationen im Workspace, verwaltete Deployments aus exakten Quell-Commits und Client-Konfigurations-Releases. Deine Deployment-Automatisierung wählt Ziel, Referenzen und Zugangsdatenverweise und ruft die CLI auf. [Client-Konfigurationen veröffentlichen](/de/self-hosted/configuration/config-releases) behandelt die Inhalte im eigenen Repository des Clients.

## Bevor du beginnst

Du brauchst:

- Eine Workstation mit macOS, Linux oder Windows 10+.
- SSH-Zugriff auf den Host, auf dem deine Tale-Instanz läuft, mit einem Operator-User, der `docker compose` ausführen kann.

Der Installer lädt ein Release-Binary von GitHub. Unternehmensnetzwerke, die Raw-Content-Downloads blockieren, müssen `raw.githubusercontent.com` und `github.com` zulassen.

## Schritt 1 — install-cli.sh oder install-cli.ps1 ausführen

Auf macOS oder Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh | bash
```

Auf Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.ps1 | iex
```

Beide Installer erkennen Betriebssystem und CPU-Architektur, ziehen das passende Release-Binary aus dem neuesten GitHub-Release und legen es im `PATH` ab (`/usr/local/bin/tale` oder `%LOCALAPPDATA%\Programs\tale\tale.exe`) — ist das Installationsverzeichnis nicht beschreibbar, fragt der Installer nach `sudo`. Release-Binaries gibt es für macOS auf Apple Silicon und Intel sowie für Linux auf x86_64 und arm64; Windows-on-ARM-Maschinen führen das x64-Binary über die eingebaute Emulation aus. Auf einer Architektur ohne Release-Binary bricht der Installer mit einer klaren Meldung ab und verweist auf den Build aus dem Quellcode. Um eine Version festzuhalten, setze die Environment-Variable `VERSION`, bevor du in den Installer pipest; das Installationsverzeichnis wählst du mit `INSTALL_DIR` selbst.

| OS      | Installer-Skript          |
| ------- | ------------------------- |
| macOS   | `scripts/install-cli.sh`  |
| Linux   | `scripts/install-cli.sh`  |
| Windows | `scripts/install-cli.ps1` |

## Schritt 2 — Verifizieren

```bash
tale --version
```

Die CLI gibt ihre Version aus. Wird der Befehl nicht gefunden, hat der Installer das Binary ausserhalb des `PATH` abgelegt — die Installer-Ausgabe benennt das Zielverzeichnis.

## Schritt 3 — Konfiguration prüfen

Nutze für Container-Befehle im Workspace das Projekt aus `tale init`. Die CLI sucht im aktuellen Verzeichnis und seinen Eltern nach `tale.json`; prüfe das aufgelöste Projekt mit:

```bash
tale config show
```

Konfigurations-Releases und [verwaltete Deployments](#verwaltete-deployments) wählen Quellen und Ziele explizit und gleichen sich nicht an einen benachbarten Workspace an. `config show` behält sein bisheriges Verhalten für lokale Projekte.

Bei Workspace-Deployments liegen Proxy-Host, TLS-Einstellungen und Secrets in der `.env` des Projekts. Ändere `HOST` dort oder übergib `--host` an `tale dev` / `tale deploy`. Für entfernte Workspace-Hosts nutzt du den Docker-Kontext deiner Shell oder `DOCKER_HOST`. Ein verwaltetes Bundle-Deployment läuft dagegen auf dem festgelegten Ziel mit dessen lokalem Docker-Daemon.

## Schritt 4 — tale deploy ausführen

```bash
tale deploy
```

Ohne `--bundle` stellt `tale deploy` die Version der CLI bereit: Es lädt deren Images, startet betroffene Container in der vorgesehenen Reihenfolge und führt Schema-Migrationen aus. Wähle eine andere Workspace-Version vorher mit `tale update`. Für getrennt festgelegte Runtime- und Client-Quell-Commits nutze [Verwaltete Deployments](#verwaltete-deployments).

## Befehlsreferenz

Die CLI gruppiert ihre Befehle danach, was du gerade tust — genau wie `tale --help`. Jeder Befehl und seine Argumente sind unten aufgeführt. So liest du die Notation:

- Ein positionales Argument in `[eckigen Klammern]` ist **optional**, eines in `<spitzen Klammern>` ist **erforderlich**.
- Pflichtoptionen für Konfigurations-Releases sind ausdrücklich benannt; andere Flags sind optional, sofern die Befehlshilfe sie nicht als erforderlich markiert.
- Ein Flag der Form `--flag <wert>` **erfordert einen Wert**, wenn du es nutzt (z. B. `--port 8443`); ein blosses Flag wie `--detach` ist ein boolescher Schalter.
- **Standardwerte** stehen in Klammern hinter der Beschreibung. Kein Standard bedeutet, das Flag ist aus oder der Wert wird aus `.env` / Kontext aufgelöst.

Führe `tale <befehl> --help` für die massgebliche Liste deiner installierten Version aus.

**Globale Flags** funktionieren bei jedem Befehl:

- `--verbose` — ausführliche Ausgabe: Debug-Logs und der rohe Subprozess-Stream (nur die Langform; ein `-v` gibt es nicht).
- `-q, --quiet` — nur Warnungen und Fehler.
- `-y, --yes` — bei allen Rückfragen «ja» annehmen (nicht-interaktiv).
- `--no-color` — ANSI-Farben deaktivieren (berücksichtigt auch `NO_COLOR` / `FORCE_COLOR`).
- `--json` — maschinenlesbares JSON auf stdout; unterstützt von `status`, allen `config`-Unterbefehlen und verwalteten Deployment-Befehlen.
- `--ci` — erzwingt nicht-interaktive, rein anhängende Ausgabe (keine Cursor-Steuerung).

Befehle beenden mit `0` bei Erfolg, `2` bei einem Nutzungsfehler, `3` bei einer nicht erfüllten Voraussetzung (kein Projekt, Docker läuft nicht, Port belegt), `4` bei einem Abbruch durch dich (Ctrl-C oder eine erforderliche Rückfrage ohne Terminal) und `5` beim Fehler einer externen Abhängigkeit — so können Skripte anhand der Ursache verzweigen.

### Einrichtung

`tale init [directory]` — ein Projekt anlegen: erzeugt die Beispiel-Configs, `AGENTS.md` + einen `CLAUDE.md`-Verweis sowie eine lokale Standard-`.env` (localhost, selbstsigniertes Zertifikat, generierte Secrets). Docker braucht es nicht; Produktiv-Domain und TLS werden später bei `tale deploy` gewählt. Im Terminal fragt es nach einem Projektnamen, wenn `directory` fehlt, bestätigt vor dem Überschreiben eines bestehenden Projekts und fragt einmal, ob Agents in Sandboxes `docker` ausführen dürfen (Standard: nein — die Freigabe startet einen privilegierten inneren Docker); nicht-interaktive Läufe überspringen alle Rückfragen. `directory` ist optional (Standard: das aktuelle Verzeichnis).

- `-f, --force` — eine vorhandene `tale.json` überschreiben statt abzubrechen.
- `--no-env` — das Projekt anlegen, aber die `.env`-Generierung überspringen.

`tale dev` — alle Dienste lokal mit selbstsigniertem Zertifikat starten.

- `-d, --detach` — im Hintergrund laufen statt Logs zu streamen.
- `-p, --port <port>` — auszugebender HTTPS-Port (Standard `443`).
- `--host <hostname>` — Host-Alias für den Proxy (Standard `localhost`).
- `-y, --yes` — nicht-interaktiv: Abfragen automatisch akzeptieren (z. B. Docker installieren oder starten).

`tale deploy` — Blue-Green-Deployment ohne Ausfallzeit der aktuellen CLI-Version. Beim ersten Deploy fragt es nach deiner Produktiv-Domain und der Let's-Encrypt-E-Mail (oder übergib `--host`).

- `--stop` — auch die stop-gebundene Schicht (`db`, `proxy`) aktualisieren — sie wird neu erstellt, also nimm eine kurze Ausfallzeit in Kauf; ohne das Flag bleiben laufende `db`/`proxy` unangetastet.
- `-s, --services <list>` — nur diese kommagetrennten Dienste aktualisieren (Standard: alle rotierbaren Dienste).
- `--host <hostname>` — Host-Alias für den Proxy (Standard: der `HOST`-Wert aus `.env`).
- `--override` — Container-Config aus dem Host-Workspace überschreiben (verschlüsselte `*.secrets.json` und `.history/` bleiben stets erhalten).
- `--override-all` — den Builtin-Katalog serverseitig in jede Organisation zurücksetzen; impliziert `--stop`.
- `-q, --quiet` — Container-Logs während des Deployments unterdrücken.
- `-y, --yes` — destruktive Bestätigungsabfragen automatisch akzeptieren (z. B. `--override-all`).
- `--skip-backup` — den automatischen Pre-Deploy-Snapshot überspringen.
- `--dry-run` — Vorschau ohne Änderungen.

### Verwaltete Deployments

Nutze eine geprüfte Deployment-Deklaration, wenn Runtime und Client-Konfigurationen exakten Quell-Commits folgen sollen. Deine Deployment-Automatisierung wählt Ziel, Zugangsdaten und Referenzen und ruft die Tale-CLI auf. Die CLI beschafft Quellen, ermittelt und prüft Image-Digests, bereitet den Transfer vor, erhält unterstützten Bestandszustand, erstellt erforderliche Wiederherstellungssnapshots, rollt den Stack aus, provisioniert die native Instanz und prüft die Konfiguration. Diese Deployment-Logik bleibt in Tale.

Führe die Vorbereitung unter Linux mit einer kompilierten CLI aus einem sauberen, committeten Tale-Checkout aus. Die Architektur muss zum Ziel passen: `linux/amd64` oder `linux/arm64`. Dasselbe Binary reist für die lokale Provisionierung im Backend mit. Die Vorbereitung braucht Git und Docker zur Quellen- und Image-Prüfung. Anwenden läuft auf dem Ziel mit dessen lokalem Docker-Daemon, erhaltenem Zustandsverzeichnis und Umgebung. Vollständiger CLI-Commit, Runtime-Quell-Commit und Quell-Commit der Client-Konfiguration sind getrennte Referenzen.

Ein verwaltetes Deployment hält seinen Wiederherstellungspunkt fest, bevor es etwas ändert: den Snapshot vor dem Deployment und das Bundle, das gerade angewendet wird, beides im Zustandsverzeichnis, bis der Ready-Beleg geschrieben ist. Ein unterbrochenes Deployment erwartet beim nächsten Versuch deshalb dasselbe Bundle und lehnt ein anderes ab; die Ablehnung nennt den sha256 des ausstehenden Bundles. Kann dieses Bundle nicht mehr abschließen — etwa weil inzwischen eine korrigierte CLI gepinnt ist —, trägst du den genannten sha256 als `supersedesPendingBundle` in die Deployment-Deklaration ein und bereitest erneut vor: Das geprüfte Bundle übernimmt denselben Snapshot, der Ready-Beleg führt es unter `supersededBundles`, und danach nimmst du den Eintrag wieder heraus. Die backendlokalen Phasen (`deploy provision`, `deploy export-client-native`) laufen im Backend unter dessen eigenem Benutzer, dem Eigentümer seines Datenverzeichnisses; schlägt eine fehl, wiederholt das Deploy-Ergebnis die Zusammenfassung der inneren CLI.

Verwaltete Bundle-Befehle sind unter Windows nicht verfügbar, einschließlich `deploy verify-bundle` und des backendlokalen `deploy provision`. Die Integritätsprüfungen benötigen POSIX-Ausführungsrechte. Führe das vollständige verwaltete Deployment auf einem Linux-Host aus. Gewöhnliche Workspace-Befehle sowie eigenständige `config build`, `verify`, `stage`, `deploy` und `verify-native` bleiben unter Windows verfügbar.

Dieses synthetische Beispiel adressiert eine bestehende Organisation und ein Projekt. Ersetze die öffentlichen IDs und setze die benannten Umgebungswerte. `revision` nimmt einen vollständigen Commit-SHA oder einen Umgebungsverweis an. Zugangsdaten bleiben Verweise und werden am Ziel privat aufgelöst. `tlsMode: "external"` nutzt vorhandenes öffentliches TLS am vorgeschalteten Zugang; `letsencrypt` verlangt zusätzlich `tlsEmail`.

Nutze für Linux- oder macOS-ARM64-Jobs in GitHub Actions Tales Composite Action `.github/actions/setup-cli`. Lege die Action und `revision` auf denselben vollständigen Tale-Commit fest. Sie baut mit Bun 1.4.2, prüft das fertige Binary, liefert `executable` und ergänzt den `PATH`. macOS-Builds unterstützen die allgemeine Konfigurationsvorbereitung; ein verwalteter Linux-Stack braucht weiter ein passendes Linux-Binary.

Auch `origin` und einzelne native `redirectUris` akzeptieren Umgebungsverweise. So kann eine Deployment-Registry die öffentlichen Adressen verwalten. Die Vorbereitung löst sie zu geprüften wörtlichen HTTPS-URLs im Bundle auf.

```json
{
  "schemaVersion": 1,
  "name": "example-native",
  "stateDirectory": "/opt/tale-example",
  "composeProject": "tale-example",
  "runtime": {
    "revision": { "env": "TALE_RUNTIME_REF" },
    "platform": "linux/amd64"
  },
  "origin": { "env": "TALE_PUBLIC_ORIGIN" },
  "tlsMode": "external",
  "identity": {
    "email": { "env": "EXAMPLE_OPERATOR_EMAIL" },
    "password": { "env": "EXAMPLE_OPERATOR_PASSWORD" },
    "slug": "example-team",
    "name": "Example team",
    "ssoEnabled": false,
    "nativeClients": [
      {
        "key": "example-portal",
        "name": "Example portal",
        "clientId": { "env": "EXAMPLE_NATIVE_CLIENT_ID" },
        "redirectUris": [{ "env": "EXAMPLE_PORTAL_CALLBACK" }]
      }
    ]
  },
  "configs": [
    {
      "repository": "https://github.com/example-team/client-app",
      "revision": { "env": "EXAMPLE_CONFIG_REF" },
      "client": "example-team",
      "descriptor": "tale/client.json",
      "automation": "document-review",
      "projectId": "existing-project-id",
      "skillOwner": "native-operator-id"
    }
  ]
}
```

Setze `TALE_DEPLOY_SPEC` auf die JSON-Datei, `TALE_DEPLOY_BUNDLE` auf ein neues absolutes Ausgabeverzeichnis und `TALE_CLI_COMMIT` auf den vollständigen Commit des Binaries. `DEPLOYMENT_COMMIT` ist ein optionaler Herkunftsvermerk für die Orchestrierung; lass die zugehörigen Flags bei Nichtgebrauch weg. Bereite vor und prüfe, übertrage das vollständige Verzeichnis und führe Vorschau und Deployment auf dem Ziel mit derselben festgelegten CLI aus.

```bash
tale --json deploy prepare \
  --spec "$TALE_DEPLOY_SPEC" \
  --deployment-ref "$DEPLOYMENT_COMMIT" \
  --output "$TALE_DEPLOY_BUNDLE"

tale --json deploy verify-bundle \
  --bundle "$TALE_DEPLOY_BUNDLE" \
  --cli-ref "$TALE_CLI_COMMIT" \
  --deployment-ref "$DEPLOYMENT_COMMIT"

tale --json deploy --bundle "$TALE_DEPLOY_BUNDLE" \
  --cli-ref "$TALE_CLI_COMMIT" \
  --deployment-ref "$DEPLOYMENT_COMMIT" --dry-run

tale --json --yes deploy --bundle "$TALE_DEPLOY_BUNDLE" \
  --cli-ref "$TALE_CLI_COMMIT" \
  --deployment-ref "$DEPLOYMENT_COMMIT"
```

`deploy prepare` akzeptiert optional `--sources-file <file>` mit einer Zuordnung von `repository@fullSHA` zu vorhandenen exakten Checkouts. Sonst lädt die CLI kanonische GitHub-Repositories. Übergib den Inhalt eines nur lesenden SSH-Schlüssels für private Client-Repositories während der Vorbereitung über `TALE_SOURCE_SSH_KEY`. Die CLI prüft GitHubs SSH-Hostschlüssel über HTTPS und hält den Schlüssel aus Paket und Runtime heraus. Docker braucht bereits Zugriff auf die Registry.

`deploy verify-bundle` prüft vollständiges Inventar und Datei-Hashes ohne Zielkontakt. `deploy --bundle --dry-run` prüft Konfigurationsartefakte und Zielbedingungen, ohne Änderungen anzuwenden. Verwaltete Deployments akzeptieren keine Workspace-Optionen wie `--services`, `--host` oder `--override-all`. Sie rollen den Stack unter Erhalt seines Zustands mit Zustands- und Herkunftsprüfungen aus. Das oben beschriebene Blue-Green-Verhalten des Workspace ist ein eigener Ablauf.

`deploy provision [--bundle <directory>]` ist die lokale Backend-Phase des Bundle-Deployments. Sie liest höchstens 64 KiB privates JSON von stdin, weist das lokale Konto und die ausgewählte Organisation nach und meldet die Sitzung vor der Erfolgsmeldung ab. Die Felder umfassen `origin`, `email`, `password`, `slug`, `name`, `ssoEnabled`, optionale Entra-Zugangsdaten und `nativeClients`. Standardmäßig bleibt das bestehende Konto erforderlich. Explizites `identity.bootstrap: "fresh"` erlaubt die Anlage des ersten lokalen Kontos und der Organisation. Ein Bundle bindet diese Wahl und die vorbereiteten Konfigurationen vor nativen Änderungen. `deploy provision` verweigert Workspace-Flags und `--dry-run`; nutze lesende Bundle- und Konfigurationsprüfungen. Die optionalen Erwartungen `--cli-ref` und `--deployment-ref` erfordern `--bundle` und greifen vor der Anmeldung.

Für einen administrativ geprüften neuen Betreiber deklarierst du ausdrücklich `identity.emailVerification: "operator-attested"`. Damit bestätigst du als Betreiber den Besitz der E-Mail-Adresse des authentifizierten Kontos; eine Postfachzustellung ist damit nicht nachgewiesen. Das Backend verwendet ein kurzlebiges natives Prüftoken für genau dieses Konto und diese Adresse und erhält native Hooks. Es verschickt keine E-Mail, ändert keine Adresse und erstellt keine weitere Sitzung. Die Option ist nur mit `bootstrap: "fresh"` zulässig. Ohne sie bleibt die normale native E-Mail-Prüfung bestehen. Ändert sich der Prüfstatus eines zuvor freigegebenen Kontos, stoppt der Ablauf zur Prüfung.

Ersetze für ein neues Ziel `projectId` einer Konfiguration durch `project: { "key": "NORTH", "name": "Configuration" }`. Native Projektschlüssel haben 2–6 Großbuchstaben, Namen höchstens 80 Zeichen. `skillOwner: "operator"` überträgt eine geprüfte Quellkapsel und kompiliert sie im Backend für den authentifizierten nativen Benutzer; der Host prüft das Ergebnis unabhängig. Explizite bestehende IDs und bereits an Besitzer gebundene Releases behalten ihr Verhalten.

Jeder native Client wählt eine bestehende `clientId` oder explizites `managed: true`. Vor der nativen Anlage speichert die CLI eine private Absicht; danach liefert sie nur einen privaten Übergabepfad und SHA für die Zugangsdaten. Wiederholungen erhalten IDs, Sicherheitsrichtlinie und Secrets. Unklare Annahme ohne passendes natives Objekt stoppt. Bei bestehenden Clients lassen sich nur Anzeigename und HTTPS-Callback-URLs angleichen. Auf unterstützten 0.5-Backends verwenden nötige Anlagen oder Änderungen feste backendlokale Auth-Adapter, deren Verbindungen anschließend schließen. Es entstehen keine öffentliche Registrierungs- oder Update-Route, frei wählbaren Modulpfade oder Secret-Rotationen.

Um Zugangsdaten eines verwalteten Clients an eine separate Anwendung zu übergeben, setze `NATIVE_CLIENT_KEY` auf den deklarierten Schlüssel und `PRIVATE_EXPORT_DIRECTORY` auf einen neuen privaten Ausgabeordner. Dessen übergeordneter Ordner muss bereits deinem Konto gehören, Modus `0700` haben und unter vertrauenswürdigen Verzeichnissen liegen. Exportiere aus demselben freigegebenen Deployment, ohne Backend-Pfade oder Containernamen auszuwerten:

```bash
tale --json deploy export-client --bundle "$DEPLOYMENT_BUNDLE" \
  --client "$NATIVE_CLIENT_KEY" --output "$PRIVATE_EXPORT_DIRECTORY" \
  --env-prefix TALE_OIDC --cli-ref "$TALE_CLI_COMMIT" \
  --deployment-ref "$DEPLOYMENT_COMMIT"
```

Der Ausgabeordner hat Modus `0700`. Seine regulären Dateien `client.json`, `receipt.json` und optional `consumer-env.json` haben Modus `0600`. Mit `--env-prefix` entsteht die letzte Datei als wörtliche Zuordnung der vier Zeichenketten `TALE_OIDC_ISSUER`, `TALE_OIDC_CLIENT_ID`, `TALE_OIDC_CLIENT_SECRET` und `TALE_OIDC_ORG_SLUG`. Der Issuer besteht aus der Tale-Origin und `/api/auth`. Übertrage die Bytes über deinen privaten Zugangsdatenkanal und lass die Anwendung JSON lesen; führe die Datei nicht als Shell aus und veröffentliche sie nicht als CI-Artefakt. Stdout enthält nur unkritische Metadaten, Pfade, Größen und Hashes. Eine identische Ausgabe wird erst nach erneuter Zustands- und vollständiger Artefaktprüfung wiederverwendet. Unvollständige, veraltete oder fremde Ausgaben stoppen ohne Überschreiben.

### Plattform konfigurieren

Mit `tale config` verwaltest du bestehende Plattform-Einstellungen über die nativen APIs. Speichere diese Deklaration als `configuration.json`, um Akzentfarbe und ein Inaktivitätslimit von 45 Minuten festzulegen:

```json
{
  "schemaVersion": 1,
  "resources": [
    {
      "kind": "branding",
      "config": {
        "accentColor": "#336699"
      }
    },
    {
      "kind": "governance",
      "key": "session_idle_timeout",
      "config": {
        "enabled": true,
        "idleTimeoutMinutes": 45
      }
    }
  ]
}
```

Setze `TALE_URL` auf die HTTPS-Origin der Instanz und `TALE_ORG_ID` auf die native Organisations-ID. Übergib ein berechtigtes Sitzungscookie über `TALE_CONFIG_COOKIE`; es gehört weder in Argumente noch in versionierte Dateien. Prüfe die Deklaration lokal, speichere und prüfe den Plan, wende ihn an und vergleiche den nativen Zustand:

```bash
tale --json config validate --file configuration.json
tale --json config plan --file configuration.json \
  --url "$TALE_URL" --org "$TALE_ORG_ID" --output configuration-plan.json
tale --json --yes config apply --file configuration.json \
  --url "$TALE_URL" --org "$TALE_ORG_ID" \
  --plan configuration-plan.json --receipt configuration-receipt.json
tale --json config read --file configuration.json \
  --url "$TALE_URL" --org "$TALE_ORG_ID"
```

Die Ausgabe- und Belegordner müssen bereits existieren. Eine HTTP-Verbindung über Loopback braucht zusätzlich `--origin` mit der öffentlichen HTTPS-Origin. `read` meldet für jede deklarierte Ressource `matches`. Der Plan zeigt Organisations- oder Instanzumfang, aktuelle und gewünschte Hashes sowie native Folgewirkungen. Zum Anwenden müssen Deklaration und Ziel exakt stimmen. Eine konkurrierende native Änderung stoppt den Schreibvorgang. Nicht deklarierte Ressourcen bleiben bestehen. Die CLI bietet weder Löschbefehle noch beliebige Dateizugriffe.

Diese Ressourcenarten nutzen die gemeinsamen Plattform-Schemas und nativen Berechtigungen:

| Art | Konfiguration | Geltungsbereich |
| --- | --- | --- |
| `branding` | Native Branding-Felder | Organisation |
| `governance` | Dateibasierte Richtlinie mit `key` und nativer `config` | Organisation |
| `provider` | Eigene Anbieterdefinition und optionale `expectedModels` | Organisation |
| `provider-credential` | Metadaten benannter Umgebungszugangsdaten | Organisation |
| `knowledge-embedding` | Anbieter, Modell, Dimensionen und Endpunkt | Organisation |
| `deployment` | Instanz-Einstellungen einschließlich Sandbox-Runtime | Instanz |

Aufbewahrungs- und DSAR-Richtlinien brauchen ihre eigenen nativen Workflows. Pausiere Uploads, Synchronisation und Crawls, bevor du die Embedding-Konfiguration änderst. Die CLI prüft die Anzahl der Dokumente und Websites der gesamten Organisation; sie sperrt den Import nicht und migriert keine bestehenden Vektoren. Hat die Organisation Dokumente oder registrierte Websites, braucht sie eine separate native Indexmigration. Instanz-Einstellungen erfordern zusätzlich die native Freigabeliste für Deployment-Editoren. Bei Boot-Einstellungen meldet der einzelne Konfigurationsaufruf `restartRequired`; Speichern allein aktiviert diese Einstellungen noch nicht. Prüfe die Folgen im Plan vor dem Anwenden.

Verwaltete Deployments nutzen denselben Ablauf über `configuration`. Ergänze die Deployment-Deklaration um dieses Beispiel, wenn ein externer Betreiber den Anbieter bereits bereitstellt. Ersetze den synthetischen Endpunkt und Katalog durch geprüfte Werte und übergib `EXTERNAL_PROVIDER_SECRET` aus deinem Secret Manager:

```json
{
  "environment": {
    "TALE_PROVIDER_KEY_EXTERNAL": {
      "env": "EXTERNAL_PROVIDER_SECRET"
    }
  },
  "configuration": {
    "schemaVersion": 1,
    "resources": [
      {
        "kind": "provider",
        "config": {
          "name": "external-chat",
          "displayName": "External chat",
          "apiFormat": "openai",
          "baseUrl": "https://models.example.invalid/v1",
          "catalog": {
            "source": "models-endpoint"
          },
          "embedding": "unknown",
          "auth": [
            {
              "method": "env"
            }
          ]
        },
        "expectedModels": [
          {
            "id": "Example-chat",
            "provider": "external-chat",
            "tags": [
              "chat"
            ],
            "supportsTools": true,
            "supportsVision": false,
            "contextWindow": 131072
          }
        ]
      },
      {
        "kind": "provider-credential",
        "config": {
          "providerSlug": "external-chat",
          "authMethod": "env",
          "name": "Managed external provider",
          "envName": "TALE_PROVIDER_KEY_EXTERNAL",
          "modelAllowlist": [
            "Example-chat"
          ]
        }
      }
    ]
  }
}
```

Für `envName` gelten das native Präfix `TALE_PROVIDER_KEY_` und die Grenze von 40 Zeichen. Jeder Alias braucht eine verpflichtende `environment`-Referenz. Private Endpunkte erfordern zusätzlich eine explizite Referenz `TALE_ALLOW_PRIVATE_PROVIDER_HOSTS` mit dem Wert `1`; native Host-Regeln gelten weiter. `expectedModels` prüft Tales frisch aufgelösten Katalog beim Rücklesen. Das belegt weder Inferenzkapazität und Latenz noch fachliche Ergebnisse.

Die Bildmodellauswahl nutzt `governance` mit `key: "vision_model"` und den nativen Feldern `providerSlug`/`modelId`. Embedding nutzt `knowledge-embedding` mit `providerSlug`, `model`, `dimensions` und `baseUrl`. Wenn du Standardzugangsdaten ersetzt, deklariere auch die bisherigen Umgebungszugangsdaten mit `isDefault: false`; die CLI wendet diese explizite Änderung zuerst an. Schlüsselwerte stehen weder in der Deklaration noch im Beleg.

Die native Einrichtung folgt auf die Identitätsprüfung und läuft vor den Konfigurations-Releases. Der Beleg `native.configuration` bindet Deklarations- und Bundle-Hashes, Organisation, Ressourcen-Hashes und native Revisionen. Vor der ersten Änderung entsteht ein ausstehender Beleg. Scheitert eine spätere Ressource, können frühere Änderungen bestehen bleiben. Lies den nativen Zustand und den Beleg, bevor du denselben geprüften Plan erneut ausführst. Natives Compare-and-set schützt jede Ressource vor konkurrierenden Admin-Änderungen; eine ressourcenübergreifende Transaktion gibt es nicht. Bewahre Deployment-Zustand, Snapshots und Belege für die Wiederherstellung auf.

Verwaltete Deployments aktivieren auch eine deklarierte `deployment`-Ressource, bevor sie Bereitschaft melden. Die CLI speichert die ausstehende Aktivierung, wartet bis zu fünf Minuten auf das Ende laufender Sitzungen im geprüften Sandbox-Spawner und startet dann diesen Container neu. Laufen noch Sitzungen, bleibt der Vorgang ausstehend. Der Beleg `configurationActivation` erfasst die eingebundene Konfiguration und den beobachteten Container-Start; Bereitschaft setzt erneute Gesundheitsprüfungen voraus. Bei einer Wiederholung prüft die CLI einen bereits angenommenen Neustart. Eine unveränderte Wiederholung nach erfolgreicher Aktivierung startet den Dienst nicht erneut.

### Betrieb

`tale status` — den aktuellen Deployment-Status anzeigen. Keine Argumente.

`tale logs <service>` — Logs eines Dienstes streamen (`service` ist einer der laufenden Dienste; auf einem reinen Dev-Stack ohne Deployment fällt der Befehl auf den Dev-Container zurück).

- `-f, --follow` — der Log-Ausgabe folgen, während sie geschrieben wird.
- `-n, --tail <lines>` — nur die letzten N Zeilen anzeigen.
- `--since <duration>` — Logs seit einer relativen Zeit anzeigen (z. B. `1h`, `30m`).
- `-c, --color <color>` — eine bestimmte Deployment-Farbe ansprechen (`blue` oder `green`).
- `--raw` — die rohe, ungefilterte Log-Ausgabe streamen (keine Klassifizierung).

`tale backup` — Snapshot aller Daten-Volumes in das Projekt-Backups-Volume. Keine Argumente.

`tale restore [snapshot-id]` — einen Snapshot wiederherstellen; ohne ID werden die verfügbaren Snapshots aufgelistet.

- `--stop` — laufende Projekt-Container vor dem Wiederherstellen stoppen.
- `-y, --yes` — die Bestätigungsabfrage überspringen.

`tale rollback` — auf die vorherige Patch-Version zurückrollen (nur Patch-Ebene). Fragt vorher nach Bestätigung.

- `-y, --yes` — die Bestätigungsabfrage überspringen (im nicht-interaktiven Betrieb erforderlich).

### Wartung

`tale update` — eine Workspace-Instanz auf eine neue Version bringen: CLI-Binary aktualisieren und Projektdateien synchronisieren, danach `tale deploy` ausführen. Workspace-Befehle gleichen sich an diese Version an. Verwaltete Bundles und Konfigurations-Releases behalten ihre separat festgelegte CLI-Revision.

- `-v, --version <version>` — auf genau diese Version aktualisieren (z. B. `0.9.0`) statt der neuesten; erlaubt Downgrades.
- `-f, --force` — Re-Sync erzwingen und lokal geänderte Projektdateien überschreiben.
- `--dry-run` — anzeigen, was sich ändern würde, ohne etwas zu ändern.

`tale migrate` — die mitgelieferten Defaults für jede Organisation auf dem laufenden Deployment neu provisionieren — derselbe idempotente Schritt, den jeder Deploy ausführt, nur auf Zuruf. Schema-Migrationen sind kein Command: Das Backend wendet sie beim Start an, ein deployter Container ist also immer auf seinem eigenen Schema.

- `--dry-run` — zeigen, was laufen würde, ohne es auszuführen.

`tale cleanup` — inaktive (nicht-aktuelle) Container entfernen. Keine Argumente.

`tale reset` — alle Blue-Green-Container entfernen.

- `-f, --force` — die Bestätigungsabfrage überspringen.
- `-a, --all` — auch die zustandsbehafteten Infrastruktur-Container entfernen.
- `--dry-run` — den Reset vorab anzeigen, ohne Änderungen.

`tale uninstall` — das `tale`-CLI-Binary von diesem System entfernen. Fragt nach, bevor etwas gelöscht wird, und _bietet an_, zusätzlich die benutzereigene Konfiguration (`~/.tale-daemon`) zu entfernen und die Docker-Ressourcen und Dateien eines Projekts abzubauen. Ohne `--purge` bleiben ein Projekt und seine Container unangetastet — führ darin `tale reset --all` aus, um sie zu entfernen.

- `-f, --force` — die Bestätigungsabfrage überspringen (entfernt nur das Binary; die optionalen Aufräumschritte brauchen weiterhin `--purge`).
- `--purge` — zusätzlich `~/.tale-daemon` entfernen und, für ein vom aktuellen Verzeichnis aus gefundenes Projekt, dessen Docker-Ressourcen abbauen und seine Dateien löschen. Nicht umkehrbar.
- `--dry-run` — anzeigen, was entfernt würde, ohne etwas zu entfernen.

`tale config show` — das aufgelöste lokale Projektverzeichnis und die CLI-Version ausgeben. Außerhalb eines Projekts meldet der Befehl, dass er keines gefunden hat, und endet ohne Fehler.

### Konfigurations-Releases

Diese Befehle nutzen die gewählte CLI-Revision ohne Instanzangleichung oder Docker-Operationen. [Client-Konfigurationen veröffentlichen](/de/self-hosted/configuration/config-releases) beschreibt Deskriptoren, Quell-Commits, Zugangsdaten und Wiederherstellung. Standardmäßig kennzeichnet der vollständige Quell-SHA das Release: Manifest-Schema 4/Compiler 3 mit `releaseRef === sourceCommit`. Native ganzzahlige Automatisierungsversionen bleiben davon getrennt.

`build`, `verify` und `stage` verlangen `--repo <directory>`, `--descriptor <path>` und `--automation <name>`. Der Deskriptorpfad ist repositoryrelativ. Ein Prüfmanifest darf absolut oder repositoryrelativ angegeben werden.

| Befehl               | Pflichtoptionen                              | Optionale Angaben                                                                                                            |
| -------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `tale config build`  | `--source-commit <sha>`                      | `--skill-owner <user-id>` (bei eigenen Skills erforderlich), `--output <directory>`, kompatibel `--config-version <version>` |
| `tale config verify` | `--manifest <path>`                          | `--rebuild` für exakte Offline-Rekonstruktion                                                                                |
| `tale config stage`  | `--config-ref <sha>`, `--output <directory>` | `--skill-owner <user-id>`, `--client <name>`, `--deployment-ref <sha>`                                                       |

Die Quellvorbereitung verlangt Checkout-`HEAD` auf diesem vollständigen Commit und ein Ausgabeziel außerhalb des Checkouts. Sie baut committete Inhalte ohne zusätzlichen Katalog-Commit. Explizites `stage --config-version` wählt stattdessen den kompatiblen Katalogweg und verlangt `--catalogue-commit`, `--catalogue-repository`, `--client` und `--ops-commit`. Kombiniere `--config-ref` und `--config-version` nicht.

Native Befehle verlangen `--stage <directory>`, `--url <origin>`, `--org <id>` und `--project <id>`. Außer lokalem HTTP ist HTTPS Pflicht. Nutze `--origin <origin>` für die kanonische Browser-Origin hinter einem Proxy. Beide lesen `TALE_CONFIG_COOKIE` ausschließlich aus der Umgebung.

| Befehl                      | Pflichtoptionen                | Optionale Angaben                                                   |
| --------------------------- | ------------------------------ | ------------------------------------------------------------------- |
| `tale config deploy`        | `--receipt <path>`             | Globales `--yes` für ein autorisiertes unbeaufsichtigtes Deployment |
| `tale config verify-native` | Keine weiteren Pflichtoptionen | `--native-version <number>`, `--allow-retained`                     |

Beide nativen Befehle nehmen exakte Erwartungen über `--config-ref`, `--source-repository`, `--artifact-sha256`, `--deployment-ref`, `--client` und `--automation` entgegen. Historische Katalog-Flags bleiben kompatibel. `verify-native` liest nur; `--allow-retained` prüft eine explizit gewählte aufbewahrte Version, ohne sie als bereitgestellt auszuweisen. Ohne `--native-version` wählt die Prüfung die zuletzt gespeicherte Version. Die native API zeigt den Aufgabenvertrag nur für die bereitgestellte Version; eine Prüfung aufbewahrter Versionen kann dieses Feld nicht bestätigen.

Konfigurationsbefehle haben kein `--dry-run`: Nutze `stage`, `verify --rebuild` und `verify-native`. Erfolgs-JSON hat die Form `{ok:true,command:"config <verb>",data}`. Build- und Prüfdaten enthalten `automationName`, `releaseRef`, `sourceCommit`, `artifactSha256`, `artifactPath` und `verified`; kompatible Ausgaben verwenden `configVersion` statt `releaseRef`. SHA-Transferbelege und native Belege nutzen Schema 2. Ein Deployment-Ergebnis enthält `automationVersion` und `unchanged`; das explizite Feld `verified` gehört zur Prüfausgabe.

### Erweitert

`tale auth reset-owner` — die Zugangsdaten des Owner-Kontos zurücksetzen.

- `-e, --email <email>` — eine neue Owner-E-Mail-Adresse setzen.
- `-p, --password <password>` — ein neues Owner-Passwort setzen.

## Fehlersuche

- **`tale deploy` trifft die falsche Maschine.** Die CLI nutzt den Docker-Kontext / `DOCKER_HOST` deiner Shell. Wechsle mit `docker context use …` (oder setz `DOCKER_HOST`), sodass er auf den gewünschten Host zeigt, und lauf erneut.
- **`tale deploy` nutzt den falschen Host-Alias.** Der Host, auf dem der Proxy antwortet, kommt aus `HOST` im `.env` des Projekts, nicht aus einem separaten CLI-Speicher. Bearbeite `.env` oder übergib `--host`, um ihn für einen Lauf zu überschreiben.
- **Installer scheitert auf macOS, weil das Binary nicht ausführbar ist.** Verweigert das frisch installierte Binary den Start (z. B. weil Gatekeeper es beendet), bricht der Installer mit Hinweisen zur Behebung ab, statt Erfolg zu melden — folg ihnen und lauf den Installer erneut.
- **`tale` nach der Installation auf Linux nicht gefunden.** Der Installer legt das Binary in `/usr/local/bin` ab; verifizier, dass das Verzeichnis im `PATH` des Users ist (`echo $PATH`).

## Wo das eingesetzt wird

Sobald die CLI verdrahtet ist, schrumpft die tägliche Oberfläche des Betreibers auf eine Handvoll Subbefehle. Welche Seiten du als Nächstes liest, hängt davon ab, wozu du gekommen bist — [Upgrades](/de/self-hosted/operate/upgrades) für Versionsbumps, [Backups und Restore](/de/self-hosted/operate/backups-and-restore) für Snapshot-Übungen, [Container-Architektur](/de/self-hosted/operate/container-architecture) dafür, was die CLI beim Deploy restartet.
