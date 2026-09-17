---
title: Die tale-CLI installieren
description: Installiere die tale-CLI, wähle die richtige Umgebung und finde die Befehle für Bereitstellung, Konfiguration und Wartung.
---

Mit der `tale`-CLI installierst und betreibst du Tale und stellst neue Versionen bereit. Installiere sie dort, wo du deine Betriebsbefehle ausführen möchtest. Danach hilft dir der [lokale Schnellstart](/de/self-hosted/install/quickstart) oder der unten beschriebene Deployment-Ablauf weiter.

Dieselbe CLI übernimmt Container-Operationen im Workspace, verwaltete Deployments aus exakten Quell-Commits und Client-Konfigurations-Releases. Deine Deployment-Automatisierung wählt Ziel, Referenzen und Zugangsdatenverweise und ruft die CLI auf. [Client-Konfigurationen veröffentlichen](/de/self-hosted/configuration/config-releases) behandelt die Inhalte im eigenen Repository des Clients.

## Bevor du beginnst

Du brauchst:

- Einen Rechner mit macOS, Linux oder Windows mit PowerShell.
- Für lokale Container: Docker mit Compose und einen laufenden Docker-Daemon.
- Für einen entfernten Workspace: Zugriff auf dessen Docker-Daemon, üblicherweise über einen SSH-Docker-Kontext. Der Benutzer auf dem Zielhost muss Docker ausführen dürfen.

Der Installer lädt die ausführbare Datei von GitHub herunter. Dafür braucht er Zugriff auf `raw.githubusercontent.com`, `api.github.com`, `github.com` und die Download-Ziele, auf die GitHub weiterleitet.

## install-cli.sh oder install-cli.ps1 ausführen

Auf macOS oder Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh | bash
```

Auf Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.ps1 | iex
```

Der Unix-Installer wählt die Datei für dein Betriebssystem und deine CPU. Er ersetzt standardmäßig eine vorhandene `tale`-Datei im `PATH` oder installiert sie unter `/usr/local/bin`. Nur wenn das Verzeichnis sonst nicht beschreibbar ist, fordert er `sudo` an. Unter Windows nutzt der Installer standardmäßig `%LOCALAPPDATA%\Programs\tale` und ergänzt den `PATH` deines Benutzers.

Fertige Binärdateien gibt es für macOS mit Apple Silicon oder Intel, Linux mit x86_64 oder arm64 sowie Windows x64. Windows ARM benötigt die x64-Emulation. Bei einer nicht unterstützten Unix-Architektur verweist der Installer auf den Build aus dem Quellcode.

Mit `VERSION` legst du eine Release-Version fest, mit `INSTALL_DIR` ein anderes Zielverzeichnis. **Exportiere** diese Variablen in einer Unix-Shell vor dem Aufruf der Pipeline, damit auch `bash` sie erhält. Eine Zuweisung nur vor `curl` erreicht den Installer nicht. In PowerShell nutzt du `$env:VERSION` und `$env:INSTALL_DIR`.

| OS      | Installer-Skript          |
| ------- | ------------------------- |
| macOS   | `scripts/install-cli.sh`  |
| Linux   | `scripts/install-cli.sh`  |
| Windows | `scripts/install-cli.ps1` |

## Verifizieren

```bash
tale --version
```

Die CLI zeigt die installierte Version. Falls der Befehl nicht gefunden wird, prüfe das Zielverzeichnis in der Installer-Ausgabe und ergänze es im `PATH`. Öffne unter Windows nach der Installation ein neues Terminal. Schlägt der Download fehl, prüfe die oben genannten Netzwerkziele. Mit der optionalen Umgebungsvariable `GITHUB_TOKEN` authentifizierst du die Release-Abfrage, falls GitHub anonyme API-Anfragen begrenzt.

## Konfiguration prüfen

Nutze für Container-Befehle den Workspace, den du mit `tale init` im [Schnellstart](/de/self-hosted/install/quickstart) erstellt hast. Die CLI sucht im aktuellen Verzeichnis und seinen Eltern nach `tale.json`. Prüfe das gewählte Projekt, bevor du es veränderst:

```bash
tale config show
```

Konfigurations-Releases und [verwaltete Deployments](#managed-deployments) wählen Quellen und Ziele explizit und gleichen sich nicht an einen benachbarten Workspace an. `config show` behält sein bisheriges Verhalten für lokale Projekte.

Bei Workspace-Deployments liegen Proxy-Host, TLS-Einstellungen und Secrets in der `.env` des Projekts. Ändere `HOST` dort oder übergib `--host` an `tale dev` / `tale deploy`. Für entfernte Workspace-Hosts nutzt du den Docker-Kontext deiner Shell oder `DOCKER_HOST`. Ein verwaltetes Bundle-Deployment läuft dagegen auf dem festgelegten Ziel mit dessen lokalem Docker-Daemon.

## tale deploy ausführen

```bash
tale deploy
```

Ohne `--bundle` stellt `tale deploy` die Version der CLI bereit: Es lädt deren Images, startet betroffene Container in der vorgesehenen Reihenfolge und führt Schema-Migrationen aus. Wähle eine andere Workspace-Version vorher mit `tale update`. Für getrennt festgelegte Runtime- und Client-Quell-Commits nutze [Verwaltete Deployments](#managed-deployments).

## Befehlsreferenz

Die CLI gruppiert ihre Befehle danach, was du gerade tust — genau wie `tale --help`. Jeder Befehl und seine Argumente sind unten aufgeführt. So liest du die Notation:

- Ein positionales Argument in `[eckigen Klammern]` ist **optional**, eines in `<spitzen Klammern>` ist **erforderlich**.
- Pflichtoptionen für Konfigurations-Releases sind ausdrücklich benannt; andere Flags sind optional, sofern die Befehlshilfe sie nicht als erforderlich markiert.
- Ein Flag der Form `--flag <wert>` **erfordert einen Wert**, wenn du es nutzt (z. B. `--port 8443`); ein bloßes Flag wie `--detach` ist ein boolescher Schalter.
- **Standardwerte** stehen in Klammern hinter der Beschreibung. Kein Standard bedeutet, das Flag ist aus oder der Wert wird aus `.env` / Kontext aufgelöst.

Führe `tale <befehl> --help` für die maßgebliche Liste deiner installierten Version aus.

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

`tale deploy` — die aktuelle CLI-Version bereitstellen und Anwendungsrollen per Blue-Green-Verfahren ersetzen. Gemeinsame Ausführungsdienste werden direkt ersetzt; Datenbank und Proxy brauchen dafür `--stop`. Beim ersten Deployment fragt die CLI nach Produktiv-Domain und TLS-E-Mail, soweit nicht vorgegeben. Lies vor Änderungen einer bestehenden Installation [Upgrades](/de/self-hosted/operate/upgrades).

- `--stop` — auch die stop-gebundene Schicht (`db`, `proxy`) aktualisieren — sie wird neu erstellt, also nimm eine kurze Ausfallzeit in Kauf; ohne das Flag bleiben laufende `db`/`proxy` unangetastet.
- `-s, --services <list>` — nur diese kommagetrennten Dienste aktualisieren (Standard: alle rotierbaren Dienste).
- `--host <hostname>` — Host-Alias für den Proxy (Standard: der `HOST`-Wert aus `.env`).
- `--override` — Container-Config aus dem Host-Workspace überschreiben (verschlüsselte `*.secrets.json` und `.history/` bleiben stets erhalten).
- `--override-all` — den Builtin-Katalog serverseitig in jede Organisation zurücksetzen; impliziert `--stop`.
- `-q, --quiet` — Container-Logs während des Deployments unterdrücken.
- `-y, --yes` — destruktive Bestätigungsabfragen automatisch akzeptieren (z. B. `--override-all`).
- `--skip-backup` — den automatischen Pre-Deploy-Snapshot überspringen.
- `--dry-run` — Vorschau ohne Änderungen.

### Verwaltete Deployments {#managed-deployments}

Nutze eine geprüfte Deployment-Deklaration, wenn Runtime und Client-Konfigurationen exakten Quell-Commits folgen sollen. Deine Deployment-Automatisierung wählt Ziel, Zugangsdaten und Referenzen und ruft die Tale-CLI auf. Die CLI beschafft Quellen, ermittelt und prüft Image-Digests, bereitet den Transfer vor, erhält unterstützten Bestandszustand, erstellt erforderliche Wiederherstellungssnapshots, rollt den Stack aus, provisioniert die native Instanz und prüft die Konfiguration. Diese Deployment-Logik bleibt in Tale.

#### Laufzeit und Quellstände vorbereiten

Führe die Vorbereitung unter Linux mit einer kompilierten CLI aus einem sauberen, committeten Tale-Checkout aus. Die Architektur muss zum Ziel passen: `linux/amd64` oder `linux/arm64`. Dasselbe Binary reist für die lokale Provisionierung im Backend mit. Die Vorbereitung braucht Git und Docker zur Quellen- und Image-Prüfung. Anwenden läuft auf dem Ziel mit dessen lokalem Docker-Daemon, erhaltenem Zustandsverzeichnis und Umgebung. Vollständiger CLI-Commit, Runtime-Quell-Commit und Quell-Commit der Client-Konfiguration sind getrennte Referenzen.

Ein verwaltetes Deployment hält seinen Wiederherstellungspunkt fest, bevor es etwas ändert: den Snapshot vor dem Deployment und das Bundle, das gerade angewendet wird, beides im Zustandsverzeichnis, bis der Ready-Beleg geschrieben ist. Ein unterbrochenes Deployment erwartet beim nächsten Versuch deshalb dasselbe Bundle und lehnt ein anderes ab; die Ablehnung nennt den sha256 des ausstehenden Bundles. Kann dieses Bundle nicht mehr abschließen — etwa weil inzwischen eine korrigierte CLI gepinnt ist —, trägst du den genannten sha256 als `supersedesPendingBundle` in die Deployment-Deklaration ein und bereitest erneut vor: Das geprüfte Bundle übernimmt denselben Snapshot, der Ready-Beleg führt es unter `supersededBundles`, und danach nimmst du den Eintrag wieder heraus. Die backendlokalen Phasen (`deploy provision`, `deploy export-client-native`) laufen im Backend unter dessen eigenem Benutzer, dem Eigentümer seines Datenverzeichnisses; schlägt eine fehl, wiederholt das Deploy-Ergebnis die Zusammenfassung der inneren CLI.

Verwaltete Bundle-Befehle sind unter Windows nicht verfügbar, einschließlich `deploy verify-bundle` und des backendlokalen `deploy provision`. Die Integritätsprüfungen benötigen POSIX-Ausführungsrechte. Führe das vollständige verwaltete Deployment auf einem Linux-Host aus. Gewöhnliche Workspace-Befehle sowie eigenständige `config build`, `verify`, `stage`, `deploy` und `verify-native` bleiben unter Windows verfügbar.

Dieses synthetische Beispiel adressiert eine bestehende Organisation und ein Projekt. Ersetze die öffentlichen IDs und setze die benannten Umgebungswerte. `revision` nimmt einen vollständigen Commit-SHA oder einen Umgebungsverweis an. Zugangsdaten bleiben Verweise und werden am Ziel privat aufgelöst. `tlsMode: "external"` nutzt vorhandenes öffentliches TLS am vorgeschalteten Zugang; `letsencrypt` verlangt zusätzlich `tlsEmail`.

Nutze für Linux- oder macOS-ARM64-Jobs in GitHub Actions Tales Composite Action `.github/actions/setup-cli`. Lege die Action und `revision` auf denselben vollständigen Tale-Commit fest. Sie baut mit Bun 1.4.2, prüft das fertige Binary, liefert `executable` und ergänzt den `PATH`. macOS-Builds unterstützen die allgemeine Konfigurationsvorbereitung; ein verwalteter Linux-Stack braucht weiter ein passendes Linux-Binary. Setze auf einem Linux-x64-Runner `linux-baseline: 'true'`, wenn die Ziel-CPU kein AVX2 unterstützt (etwa Intel vor Haswell): Das Standard-Binary bricht dort mit `Illegal instruction` ab, das Baseline-Binary läuft. Andere Runner lehnen die Option ab.

Auch `origin` und einzelne native `redirectUris` akzeptieren Umgebungsverweise. So kann eine Deployment-Registry die öffentlichen Adressen verwalten. Die Vorbereitung löst sie zu geprüften wörtlichen HTTPS-URLs im Bundle auf.

Im Beispiel macht `runtime.containerPrefix` die Umgebung in der Containerliste erkennbar. Die optionale Einstellung wird unten erläutert.

```json
{
  "schemaVersion": 1,
  "name": "example-native",
  "stateDirectory": "/opt/tale-example",
  "composeProject": "tale-example",
  "runtime": {
    "revision": { "env": "TALE_RUNTIME_REF" },
    "platform": "linux/amd64",
    "containerPrefix": "north-desk-prod"
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

#### Containernamen wählen

Setze `runtime.containerPrefix`, wenn in der Containerliste Namen wie `north-desk-prod-db` und `north-desk-prod-backend-api` erscheinen sollen. Das Präfix beginnt mit einem Kleinbuchstaben und besteht aus Kleinbuchstaben, Ziffern und einzelnen Bindestrichen. Es darf höchstens 40 Zeichen lang sein. Leerzeichen, Unterstriche, doppelte Bindestriche und ein Bindestrich am Ende sind nicht erlaubt.

| Einstellung | Zugehörige Identität |
| --- | --- |
| `runtime.containerPrefix` | Sichtbare Containernamen: `<prefix>-<service>` für jeden verwalteten Dienst. |
| `name` und `composeProject` | Das bestehende Deployment und sein Compose-Projekt, einschließlich der Zuordnung der Volumes. |
| `stateDirectory` | Der vorhandene Deployment-Zustand, Zugangsdaten und Wiederherstellungsprotokolle. |

Lass die Werte der letzten beiden Zeilen unverändert, wenn du die Container einer bestehenden Installation umbenennst. Das Präfix verändert die DNS-Namen der Dienste nicht; interne Dienstadressen verwenden weiterhin ihre bisherigen Namen. Ohne Präfix gilt die Benennung aus dem Quellcode.

Wenn du ein Präfix hinzufügst, änderst oder entfernst, werden Container neu erstellt. Dabei kann der Dienst kurz unterbrochen werden. Bereite ein neues Bundle vor, prüfe den Probelauf und wende es über den üblichen Ablauf mit Snapshot und Wiederherstellung an. Wiederhole nach einer Unterbrechung genau dieses Bundle; ein ausstehender Rollout lehnt ein anderes Bundle ab. Sobald der Rollout abgeschlossen ist, kannst du das Präfix mit einem weiteren vorbereiteten Bundle entfernen und so zur Benennung aus dem Quellcode zurückkehren.

Betreibe nur eine vollständige verwaltete Laufzeit pro Docker-Daemon. Ein Namenspräfix vergibt keine separaten Ports, Sandbox-Netzwerke oder Arbeitsverzeichnisse auf dem Host.

#### Zusätzliche Ursprünge bedienen {#managed-additional-origins}

Deklariere `additionalOrigins`, wenn dieselbe Instanz auch unter weiteren HTTPS-Ursprüngen antworten soll, etwa unter einer Partnerdomain oder während eines Umzugs unter dem bisherigen Hostnamen. Jeder Eintrag ist ein reiner HTTPS-Ursprung auf dem Standardport oder eine Umgebungsreferenz, die bei der Vorbereitung zu einem solchen Ursprung aufgelöst wird. Die Liste enthält 1 bis 16 verschiedene Ursprünge; keiner davon darf `origin` wiederholen.

```json
{
  "origin": "https://desk.example.org",
  "additionalOrigins": [
    "https://desk.partner.example",
    { "env": "TALE_EXTRA_ORIGIN" }
  ]
}
```

Die CLI schreibt die Liste in die Laufzeitvariable `ADDITIONAL_SITE_URLS` und verwaltet sie selbst, deshalb kann ein Eintrag unter `environment` sie nicht setzen. Jeder Ursprung ist ein vollwertiger Einstieg mit eigenen Sitzungen, Dateilinks, Anmeldewegen und Connector-Callbacks. Mit `tlsMode: "letsencrypt"` bezieht der Proxy für jeden Ursprung ein Zertifikat; lokale Hostnamen und IP-Adressen werden abgelehnt. Mit `tlsMode: "external"` muss dein TLS-Proxy für jeden Ursprung den ursprünglichen `Host` weiterleiten und `X-Forwarded-Proto: https` von einer Adresse senden, der Tales Proxy vertraut. Ist dieser Adressbereich enger als die privaten Bereiche, setze `TRUSTED_PROXIES` über eine Referenz unter `environment`.

Die native Identität bleibt bei `origin`: Konto- und Organisationsbindungen, Client-Journale, der OIDC-Issuer, Passkeys und E-Mail-Links verwenden nur diesen Ursprung. Ein Eintrag darf `identity.migrateOriginFrom` entsprechen, damit der bisherige Hostname während einer Migration erreichbar bleibt.

Die Vorbereitung lehnt eine Laufzeitrevision ab, deren Proxy einem externen TLS-Terminator nicht vertrauen kann, und meldet `Runtime does not serve additional origins`. Wenn du die Liste hinzufügst, änderst oder entfernst, werden die Dienste neu erstellt, die sie lesen. Entfernst du die Deklaration, entfernt das nächste angewendete Bundle auch die Variable. Registriere die Callback-URLs jedes Ursprungs bei deinen Identitäts- und Connector-Anbietern und plane DNS und Zertifikate mit [TLS und Domains](/de/self-hosted/configuration/tls-and-domains#mehrere-domains-gleichzeitig).

#### Bundle vorbereiten, prüfen und anwenden

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

Die Vorbereitung prüft zuerst jede Konfiguration mit den eigenen Schemas der CLI und lädt und prüft erst danach die Runtime-Images. Dabei nennt sie jede Phase und jedes Image. Ein Paket mit Feldern, die diese CLI nicht kennt, lehnt sie innerhalb von Sekunden mit `native manifest normalization changes release semantics at <fields>` ab. Bereite es dann mit einer CLI vor, die mindestens so neu ist wie das Tale, für das das Paket geschrieben wurde. Einen Fehler, den die CLI bewusst meldet, zeigt sie mit seiner Ursache. Jeder andere Fehler behält eine feste Zusammenfassung, damit weder Zugangsdaten noch Ausgaben der Registry ins Log gelangen.

`deploy verify-bundle` prüft vollständiges Inventar und Datei-Hashes ohne Zielkontakt. `deploy --bundle --dry-run` prüft Konfigurationsartefakte und Zielbedingungen, ohne Änderungen anzuwenden. Verwaltete Deployments akzeptieren keine Workspace-Optionen wie `--services`, `--host` oder `--override-all`. Sie rollen den Stack unter Erhalt seines Zustands mit Zustands- und Herkunftsprüfungen aus. Das oben beschriebene Blue-Green-Verhalten des Workspace ist ein eigener Ablauf.

#### Native Identität bereitstellen

`deploy provision [--bundle <directory>]` ist die lokale Backend-Phase des Bundle-Deployments. Sie liest höchstens 64 KiB privates JSON von stdin, weist das lokale Konto und die ausgewählte Organisation nach und meldet die Sitzung vor der Erfolgsmeldung ab. Die Felder umfassen `origin`, `email`, `password`, `slug`, `name`, `ssoEnabled`, optionale Entra-Zugangsdaten und `nativeClients`. Standardmäßig bleibt das bestehende Konto erforderlich. Explizites `identity.bootstrap: "fresh"` erlaubt die Anlage des ersten lokalen Kontos und der Organisation. Ein Bundle bindet diese Wahl und die vorbereiteten Konfigurationen vor nativen Änderungen. `deploy provision` verweigert Workspace-Flags und `--dry-run`; nutze lesende Bundle- und Konfigurationsprüfungen. Die optionalen Erwartungen `--cli-ref` und `--deployment-ref` erfordern `--bundle` und greifen vor der Anmeldung.

Für einen administrativ geprüften neuen Betreiber deklarierst du ausdrücklich `identity.emailVerification: "operator-attested"`. Damit bestätigst du als Betreiber den Besitz der E-Mail-Adresse des authentifizierten Kontos; eine Postfachzustellung ist damit nicht nachgewiesen. Das Backend verwendet ein kurzlebiges natives Prüftoken für genau dieses Konto und diese Adresse und erhält native Hooks. Es verschickt keine E-Mail, ändert keine Adresse und erstellt keine weitere Sitzung. Die Option ist nur mit `bootstrap: "fresh"` zulässig. Ohne sie bleibt die normale native E-Mail-Prüfung bestehen. Ändert sich der Prüfstatus eines zuvor freigegebenen Kontos, stoppt der Ablauf zur Prüfung.

Ersetze für ein neues Ziel `projectId` einer Konfiguration durch `project: { "key": "NORTH", "name": "Configuration" }`. Native Projektschlüssel haben 2–6 Großbuchstaben, Namen höchstens 80 Zeichen. `skillOwner: "operator"` überträgt eine geprüfte Quellkapsel und kompiliert sie im Backend für den authentifizierten nativen Benutzer; der Host prüft das Ergebnis unabhängig. Explizite bestehende IDs und bereits an Besitzer gebundene Releases behalten ihr Verhalten.

Jeder native Client wählt eine bestehende `clientId` oder explizites `managed: true`. Vor der nativen Anlage speichert die CLI eine private Absicht; danach liefert sie nur einen privaten Übergabepfad und SHA für die Zugangsdaten. Wiederholungen erhalten IDs, Sicherheitsrichtlinie und Secrets. Unklare Annahme ohne passendes natives Objekt stoppt. Bei bestehenden Clients lassen sich nur Anzeigename und HTTPS-Callback-URLs angleichen. Auf unterstützten 0.5-Backends verwenden nötige Anlagen oder Änderungen feste backendlokale Auth-Adapter, deren Verbindungen anschließend schließen. Es entstehen keine öffentliche Registrierungs- oder Update-Route, frei wählbaren Modulpfade oder Secret-Rotationen.

#### Den Hostnamen eines verwalteten Deployments ändern {#managed-origin-migration}

Verwende das bestehende verwaltete Deployment und sein privates Zustandsverzeichnis. Der Ablauf ändert die Origin-Bindungen des vorhandenen Kontos, der Organisation und der Clients. Er verschiebt keine Datenbank und legt keine Ersatzidentitäten an.

1. Setze `origin` in der Deployment-Spezifikation auf die neue HTTPS-Origin und `identity.migrateOriginFrom` auf die genaue bisherige HTTPS-Origin, etwa `https://old.example.org`. Beide müssen verschieden sein. Behalte `identity.bootstrap: "fresh"`, Konto, Organisation und die Schlüssel der verwalteten Clients bei.
2. Prüfe vor der Bundle-Vorbereitung den gespeicherten Zustand. Der Bootstrap muss abgeschlossen sein. Jede deklarierte E-Mail-Bestätigung und jeder verwaltete Client benötigen ihr passendes abgeschlossenes Journal. Fehlende, ausstehende oder fremde Identitäts- und Client-Journale blockieren die Migration.
3. Bereite das Bundle vor, prüfe es, kontrolliere die Vorschau und wende es mit dem oben beschriebenen Ablauf an. Die CLI authentifiziert das bestehende Konto und prüft die Client-Zugangsdaten, bevor sie die Origin-Bindungen aktualisiert. Bei einer Wiederholung akzeptiert sie abgeschlossene Journale an beiden deklarierten Origins und erhält IDs und Secrets.
4. Exportiere nach dem abgeschlossenen Deployment-Beleg die Client-Konfiguration für den neuen Issuer. Entferne `migrateOriginFrom` aus künftigen Deployment-Spezifikationen.

Ist native Konfiguration deklariert, braucht sie ebenfalls ihren gespeicherten Beleg. Die Migration erhält Organisations-ID und Slug und prüft jede Ressource mit dem üblichen Plan- und Rückleseablauf. Eine an der neuen Origin unterbrochene Konfigurationsänderung lässt sich nur mit genau ihrem ausstehenden Plan fortsetzen. Ein ausstehender Konfigurationsbeleg an der alten Origin blockiert die Migration.

Für den Rückweg nach einer abgeschlossenen Migration tauschst du beide Origins ausdrücklich und durchläufst denselben geprüften Ablauf. Plane DNS, Zertifikate, Callback-Registrierungen und Zugriffstests mit [TLS und Domains](/de/self-hosted/configuration/tls-and-domains). Die Änderung der Bundle-Origin erledigt diese externen Schritte nicht.

#### Die Anmeldeadresse des Deploy-Operators ändern {#managed-operator-address-migration}

Ein verwaltetes Deployment meldet sich bei jedem Lauf als sein `identity`-Operator an. Soll dieses Konto eine Maschinenadresse bekommen, damit sich Personen mit eigenen Konten anmelden, behältst du das Konto und änderst nur seine Anmeldeadresse. Seine Benutzer-ID und alles, was daran hängt – verwaltete Clients, Skills im Besitz des Operators, API-Schlüssel und aufbewahrte Journale –, bleibt erhalten.

1. Setze `identity.email` auf die neue Adresse und `identity.migrateEmailFrom` auf die genaue bisherige Adresse. Beide müssen verschieden sein. Behalte `identity.bootstrap: "fresh"` und das Passwort des Kontos bei. Der Bootstrap muss abgeschlossen sein, und eine deklarierte E-Mail-Bestätigung braucht ihr abgeschlossenes Journal.
2. Bereite das Bundle vor, prüfe es, sieh dir die Vorschau an und wende es an. Die CLI liest die aktuelle Adresse des aufbewahrten Kontos im Backend, meldet sich damit an und weist die aufbewahrte Benutzer-ID nach. Sie hält die Änderung im Journal fest, benennt das Konto über den nativen Adapter um, beendet alle Sitzungen des Kontos und meldet sich mit der neuen Adresse erneut an. Die Umbenennung ist an die bisherige Adresse gebunden, sodass eine gleichzeitige Änderung abgelehnt statt überschrieben wird. Eine deklarierte E-Mail-Bestätigung bestätigt danach die neue Adresse.
3. Ein erneuter Lauf nach einer Unterbrechung findet die Adresse bereits geändert vor und schließt die Journale ohne zweite Umbenennung ab. `migrateEmailFrom` danach deklariert zu lassen, schadet nicht; entferne es, sobald der Deployment-Beleg bereit ist.

Hält ein anderes Konto die neue Adresse oder das aufbewahrte Konto keine der beiden Adressen, stoppt das Deployment vor jeder Änderung.

#### Einen Break-Glass-Administrator deklarieren {#managed-break-glass}

`identity.breakGlass` hält einen Administrator für den Fall bereit, dass der Deploy-Operator nicht verfügbar ist, etwa `{ "email": "break-glass@example.org", "passwordHash": { "env": "TALE_BREAK_GLASS_PASSWORD_HASH" } }`. Die Adresse ist ein fester Wert oder eine verpflichtende Umgebungsreferenz und muss sich von der aktuellen und der bisherigen Adresse des Operators unterscheiden. Das Passwort erreicht das Deployment nie: Erzeuge seinen Hash mit `tale auth hash-password` dort, wo das Passwort aufbewahrt wird, und übergib nur den Hash.

Jedes Deployment gleicht das Backend an die Deklaration an. Ein fehlendes Konto wird mit bestätigter Adresse und genau den deklarierten Zugangsdaten angelegt. Ein bestehendes Konto erhält diese Zugangsdaten zurück, und alle seine Sitzungen enden, wenn sie sich ändern. Das Konto wird über die nativen Mitglieder-Endpunkte `admin` der verwalteten Organisation; ein `owner` wird nie verändert. Ein aufbewahrtes Journal bindet die Adresse an eine Konto-ID, sodass ein anderes Konto mit dieser Adresse das Deployment später stoppt. Das Deployment meldet sich nie mit diesem Konto an. Ändere sein Passwort über den deklarierten Hash, nicht in der Anwendung.

#### Erzwungene Zwei-Faktor-Anmeldung

Ein verwaltetes Deployment meldet sich allein mit dem Passwort als sein Operator an. Erzwingt die Organisation `two_factor_policy`, gib dem Operator einen Passkey und nie eine Authenticator-App: Die Passwort-Anmeldung eines Kontos mit Authenticator-App wird mit einer Code-Abfrage beantwortet, und ein Konto ohne beide Faktoren wird nach Ablauf seiner Übergangsfrist zur Einrichtung geschickt. Die CLI stoppt bei beiden Antworten und nennt die erhaltene. Personen melden sich mit eigenen Konten an und können beide Faktoren nutzen.

#### Zugangsdaten nativer Clients exportieren

Um Zugangsdaten eines verwalteten Clients an eine separate Anwendung zu übergeben, setze `NATIVE_CLIENT_KEY` auf den deklarierten Schlüssel und `PRIVATE_EXPORT_DIRECTORY` auf einen neuen privaten Ausgabeordner. Dessen übergeordneter Ordner muss bereits deinem Konto gehören, Modus `0700` haben und unter vertrauenswürdigen Verzeichnissen liegen. Exportiere aus demselben freigegebenen Deployment, ohne Backend-Pfade oder Containernamen auszuwerten:

```bash
tale --json deploy export-client --bundle "$TALE_DEPLOY_BUNDLE" \
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

| Art                   | Konfiguration                                             | Geltungsbereich |
| --------------------- | --------------------------------------------------------- | --------------- |
| `branding`            | Native Branding-Felder                                    | Organisation    |
| `governance`          | Dateibasierte Richtlinie mit `key` und nativer `config`   | Organisation    |
| `provider`            | Eigene Anbieterdefinition und optionale `expectedModels`  | Organisation    |
| `provider-credential` | Metadaten benannter Umgebungszugangsdaten                 | Organisation    |
| `knowledge-embedding` | Anbieter, Modell, Dimensionen, Endpunkt und Servergrenzen | Organisation    |
| `deployment`          | Instanz-Einstellungen einschließlich Sandbox-Runtime      | Instanz         |

Aufbewahrungs- und DSAR-Richtlinien brauchen ihre eigenen nativen Workflows. Pausiere Uploads, Synchronisation und Crawls, bevor du das Embedding-Modell wechselst. Die CLI prüft die Anzahl der Dokumente und Websites der gesamten Organisation; sie sperrt den Import nicht und migriert keine bestehenden Vektoren. Hat die Organisation Dokumente oder registrierte Websites, braucht ein Modellwechsel eine separate native Indexmigration. Eine Änderung, die nur `minSimilarity`, `maxConcurrentRequests` oder `minTokensPerSecond` betrifft, lässt die vorhandenen Vektoren gültig; für sie entfällt diese Prüfung. Instanz-Einstellungen erfordern zusätzlich die native Freigabeliste für Deployment-Editoren. Bei Boot-Einstellungen meldet der einzelne Konfigurationsaufruf `restartRequired`; Speichern allein aktiviert diese Einstellungen noch nicht. Prüfe die Folgen im Plan vor dem Anwenden.

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
            "tags": ["chat"],
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
          "modelAllowlist": ["Example-chat"]
        }
      }
    ]
  }
}
```

Für `envName` gelten das native Präfix `TALE_PROVIDER_KEY_` und die Grenze von 40 Zeichen. Jeder Alias braucht eine verpflichtende `environment`-Referenz. Private Endpunkte erfordern zusätzlich eine explizite Referenz `TALE_ALLOW_PRIVATE_PROVIDER_HOSTS` mit dem Wert `1`; native Host-Regeln gelten weiter. `expectedModels` prüft Tales frisch aufgelösten Katalog beim Rücklesen. Das belegt weder Inferenzkapazität und Latenz noch fachliche Ergebnisse.

Die Bildmodellauswahl nutzt `governance` mit `key: "vision_model"` und den nativen Feldern `providerSlug`/`modelId`. Embedding nutzt `knowledge-embedding` mit `providerSlug`, `model`, `dimensions` und `baseUrl`, dazu die optionalen Einstellungen, die die Plattform neben dem Modell in [`embedding.json`](/de/self-hosted/configuration/data-residency#das-embedding-modell-der-organisation) hält: `minSimilarity`, die Kosinus-Untergrenze des Assistenten für dieses Modell, sowie die Servergrenzen `maxConcurrentRequests` und `minTokensPerSecond` ([Anfragen an einen selbst betriebenen Embedding-Server dosieren](/de/self-hosted/configuration/data-residency#kapazitaet-des-embedding-servers)). Für jede gilt die Regel der Plattform selbst: Ein Wert setzt sie, ein weggelassener Schlüssel lässt stehen, was die Datei hält (ein von Hand gesetzter Wert überlebt ein Release, das ihn nicht erwähnt), und `null` löscht sie — `"minSimilarity": null` etwa ist der einzige Weg, eine Untergrenze über die CLI zu entfernen. Wenn du Standardzugangsdaten ersetzt, deklariere auch die bisherigen Umgebungszugangsdaten mit `isDefault: false`; die CLI wendet diese explizite Änderung zuerst an. Schlüsselwerte stehen weder in der Deklaration noch im Beleg.

Die native Einrichtung folgt auf die Identitätsprüfung und läuft vor den Konfigurations-Releases. Der Beleg `native.configuration` bindet Deklarations- und Bundle-Hashes, Organisation, Ressourcen-Hashes und native Revisionen. Vor der ersten Änderung entsteht ein ausstehender Beleg. Scheitert eine spätere Ressource, können frühere Änderungen bestehen bleiben. Lies den nativen Zustand und den Beleg, bevor du denselben geprüften Plan erneut ausführst. Natives Compare-and-set schützt jede Ressource vor konkurrierenden Admin-Änderungen; eine ressourcenübergreifende Transaktion gibt es nicht. Bewahre Deployment-Zustand, Snapshots und Belege für die Wiederherstellung auf.

Verwaltete Deployments aktivieren auch eine deklarierte `deployment`-Ressource, bevor sie Bereitschaft melden. Die CLI speichert die ausstehende Aktivierung, wartet bis zu fünf Minuten auf das Ende laufender Sitzungen im geprüften Sandbox-Spawner und startet dann diesen Container neu. Laufen noch Sitzungen, bleibt der Vorgang ausstehend. Der Beleg `configurationActivation` erfasst die eingebundene Konfiguration und den beobachteten Container-Start; Bereitschaft setzt erneute Gesundheitsprüfungen voraus. Bei einer Wiederholung prüft die CLI einen bereits angenommenen Neustart. Eine unveränderte Wiederholung nach erfolgreicher Aktivierung startet den Dienst nicht erneut.

#### Einen ausstehenden Konfigurationsplan ersetzen

Kann ein unterbrochener Plan noch abgeschlossen werden, führe denselben Plan erneut aus. Ein ausdrücklicher Ersatz ist nötig, wenn die deklarierten Einstellungen nicht mehr funktionieren können, etwa weil ein Embedding-Endpunkt nicht mehr verfügbar ist. Bewahre den vorhandenen Beleg auf: Er hält fest, welche Änderungen die Plattform bereits erreicht haben können.

1. Lies den ausstehenden Beleg und vergleiche die deklarierten Ressourcen mit dem aktuellen Zustand der Plattform. Speichere die korrigierten Einstellungen in `replacement-configuration.json`. Ziel und Ressourcenkennungen müssen exakt gleich bleiben; Ressourcen lassen sich dabei weder hinzufügen noch weglassen.
2. Berechne den Hash von `plan` im aufbewahrten Beleg, nicht vom gesamten Beleg oder vom Ersatzplan. Der folgende Befehl benötigt Bun. Er verwendet kanonisches JSON: rekursiv sortierte Objektschlüssel, unveränderte Array-Reihenfolge und keine Leerzeichen.

```bash
PENDING_PLAN_SHA=$(bun -e '
  const receipt = await Bun.file(process.argv[1]).json();
  if (receipt.phase !== "pending") throw new Error("Receipt is not pending");
  function canonical(value) {
    if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
    if (value !== null && typeof value === "object") {
      return "{" + Object.keys(value).sort().map(key =>
        JSON.stringify(key) + ":" + canonical(value[key])
      ).join(",") + "}";
    }
    return JSON.stringify(value);
  }
  console.log(new Bun.CryptoHasher("sha256")
    .update(canonical(receipt.plan)).digest("hex"));
' configuration-receipt.json)
```

3. Erstelle aus der Ersatzdeklaration einen neuen Plan und prüfe ihn vor dem Anwenden:

```bash
tale --json config plan --file replacement-configuration.json \
  --url "$TALE_URL" --org "$TALE_ORG_ID" --output replacement-plan.json
```

Wende den geprüften Plan mit dem bisherigen Belegpfad und dem Hash des aufbewahrten Plans an:

```bash
tale --json --yes config apply --file replacement-configuration.json \
  --url "$TALE_URL" --org "$TALE_ORG_ID" \
  --plan replacement-plan.json --receipt configuration-receipt.json \
  --supersedes-pending-plan "$PENDING_PLAN_SHA"
tale --json config read --file replacement-configuration.json \
  --url "$TALE_URL" --org "$TALE_ORG_ID"
```

Jede Ressource muss weiterhin dem ursprünglichen Zustand, der beabsichtigten Änderung oder dem verifizierten Ergebnis des ausstehenden Plans entsprechen. Eine unabhängige Änderung auf der Plattform blockiert den Ersatz vor dem ersten Schreibzugriff. Kläre die Abweichung mit dem zuständigen Administrator; entferne den Beleg nicht, um die Prüfung zu umgehen.

Unter `superseded` bewahrt der Beleg den früheren Plan samt verifizierten Ressourcen auf, auch bei Unterbrechung und Wiederholung. Prüfe, ob der Beleg `phase: "ready"` erreicht und `config read` übereinstimmende Ressourcen meldet. Lass den einmaligen Auswahlparameter bei späteren Vorgängen weg.

Bei einem verwalteten Deployment setzt du `supersedesPendingConfigurationPlan` in der Deployment-Spezifikation auf denselben Hash des aufbewahrten Plans und korrigierst `configuration`. Bereite anschließend ein neues Bundle vor und prüfe es. Ersetzt dieses Bundle auch einen ausstehenden Rollout, gib dessen Hash zusätzlich über `supersedesPendingBundle` an. Dieser Bundle-Parameter allein erlaubt keinen Ersatz des nativen Konfigurationsplans. Entferne beide Wiederherstellungsparameter aus späteren Spezifikationen, sobald der Vorgang bereit ist.

Der öffentliche Nachweis `native.configuration` enthält pro Ressource den beabsichtigten Hash als `configurationSha256` und den Hash des zurückgelesenen Zustands als `observedConfigurationSha256`. Beide können voneinander abweichen, wenn eine Einstellung einen vorhandenen Wert erhält, etwa bei einer ausgelassenen Ähnlichkeitsschwelle oder Servergrenze für Embeddings. Der private Beleg bewahrt den exakt beobachteten Zustand für die Wiederherstellung auf.

### Betrieb

`tale status` — den aktuellen Deployment-Status anzeigen. Keine Argumente.

`tale logs <service>` — Logs eines Dienstes streamen (`service` ist einer der laufenden Dienste; auf einem reinen Dev-Stack ohne Deployment fällt der Befehl auf den Dev-Container zurück).

- `-f, --follow` — der Log-Ausgabe folgen, während sie geschrieben wird.
- `-n, --tail <lines>` — nur die letzten N Zeilen anzeigen.
- `--since <duration>` — Logs seit einer relativen Zeit anzeigen (z. B. `1h`, `30m`).
- `-c, --color <color>` — eine bestimmte Deployment-Farbe ansprechen (`blue` oder `green`).
- `--raw` — die rohe, ungefilterte Log-Ausgabe streamen (keine Klassifizierung).

`tale backup` — unterstützte, vorhandene Projekt-Volumes sichern. Keine Argumente. Externe Datenbanken und Buckets brauchen eigene Backups; siehe [Sicherungsumfang](/de/self-hosted/operate/backups-and-restore).

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

`tale auth hash-password` — den Better-Auth-Hash eines Passworts ausgeben, für einen [Break-Glass-Administrator](#managed-break-glass).

Der Befehl liest das Passwort von stdin oder im interaktiven Terminal aus einer verdeckten Eingabe mit Bestätigung. Er lehnt ein Passwort ab, das die Standard-Passwortrichtlinie der Plattform verletzt, und gibt nur den Hash aus.

`tale auth reset-owner` — die Zugangsdaten des Owner-Kontos zurücksetzen.

Führe den Befehl bei einer manuellen Wiederherstellung ohne Flags im interaktiven Terminal aus. So gibst du das Passwort verdeckt ein, ohne es in Shell-Verlauf oder Argumenten abzulegen. Die Rücksetzung macht bestehende Sitzungen ungültig.

- `-e, --email <email>` — eine neue Owner-E-Mail-Adresse setzen.
- `-p, --password <password>` — ein neues Owner-Passwort setzen.

## Fehlersuche

- **`tale deploy` trifft die falsche Maschine.** Die CLI nutzt den Docker-Kontext / `DOCKER_HOST` deiner Shell. Wechsle mit `docker context use …` (oder setz `DOCKER_HOST`), sodass er auf den gewünschten Host zeigt, und lauf erneut.
- **`tale deploy` nutzt den falschen Host-Alias.** Der Host, auf dem der Proxy antwortet, kommt aus `HOST` im `.env` des Projekts, nicht aus einem separaten CLI-Speicher. Bearbeite `.env` oder übergib `--host`, um ihn für einen Lauf zu überschreiben.
- **Installer scheitert auf macOS, weil das Binary nicht ausführbar ist.** Verweigert das frisch installierte Binary den Start (z. B. weil Gatekeeper es beendet), bricht der Installer mit Hinweisen zur Behebung ab, statt Erfolg zu melden — folg ihnen und lauf den Installer erneut.
- **`tale` nach der Installation auf Linux nicht gefunden.** Der Installer legt das Binary in `/usr/local/bin` ab; verifizier, dass das Verzeichnis im `PATH` des Users ist (`echo $PATH`).

Für den laufenden Betrieb helfen [Upgrades](/de/self-hosted/operate/upgrades), [Backups und Wiederherstellung](/de/self-hosted/operate/backups-and-restore) und [Container-Architektur](/de/self-hosted/operate/container-architecture).
