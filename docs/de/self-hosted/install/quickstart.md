---
title: Self-hosted Quickstart
description: Single-Host-Tale-Instanz auf einem frischen Server in zwanzig Minuten — klonen, zwei Variablen konfigurieren, docker compose up, ersten Admin erstellen.
---

Dieser Quickstart bringt eine funktionierende Single-Host-Tale-Instanz in etwa zwanzig Minuten auf einen frischen Server. Das Ergebnis ist deine eigene Org, die auf deiner eigenen Maschine läuft, erreichbar unter einer URL, die du kontrollierst. Das ist die kleinste Menge an Bewegungen, die dich zu einem Anmelde-Bildschirm bringt; das Produktions-Härten lebt auf der Seite [Linux-Server](/de/self-hosted/install/linux-server).

Du brauchst einen Host mit installiertem Docker und Docker Compose, einen DNS-Namen, der auf den Host zeigt (oder die Bereitschaft, vorerst die IP des Hosts zu nutzen), und die Ports 80 und 443 offen. Der Spaziergang nutzt die mitgelieferten Compose-Dateien unverändert — keine Edits jenseits der beiden Environment-Variablen `HOST` und `SITE_URL`.

## Bevor du beginnst

Verifiziere, dass der Host bereit ist:

```bash
docker --version
docker compose version
```

Beide Befehle müssen Versions-Strings ausgeben. Fehlt einer, installiere Docker Engine plus das Compose-Plugin aus den offiziellen Docker-Docs, bevor du fortfährst. Produktions-Hosts laufen ein aktuelles Ubuntu LTS, ein aktuelles Debian oder ein aktuelles Fedora; andere Container-Runtimes als Docker werden nicht unterstützt.

## Schritt 1 — Klonen und HOST plus SITE_URL setzen

```bash
git clone https://github.com/tale-project/tale.git
cd tale
cp .env.example .env
```

Öffne `.env` in deinem Editor und setze zwei Variablen:

- `HOST` — der Hostname, unter dem User die Instanz erreichen (z.B. `tale.example.com` oder die öffentliche IP des Hosts für lokale Tests).
- `SITE_URL` — die volle URL mit Schema (`https://tale.example.com` oder `http://<host>:80` für lokal).

Lass den Rest vorerst in Ruhe. Die anderen Variablen haben vernünftige Defaults; die [Environment-Referenz](/de/self-hosted/configuration/environment-reference) benennt sie alle.

## Schritt 2 — Secrets generieren

Der erste Boot braucht drei initialisierte Secrets. Die `.env.example` liefert Platzhalter; ersetz sie durch Werte aus `openssl`:

```bash
echo "BETTER_AUTH_SECRET=$(openssl rand -base64 48)" >> .env
echo "ENCRYPTION_SECRET_HEX=$(openssl rand -hex 32)" >> .env
echo "DB_PASSWORD=$(openssl rand -base64 24)" >> .env
echo "INSTANCE_SECRET=$(openssl rand -base64 48)" >> .env
```

Diese werden beim ersten Boot in die Container eingebettet. Bewahr die `.env` an einem sicheren Ort auf; verlierst du `ENCRYPTION_SECRET_HEX` oder `DB_PASSWORD`, kannst du die Daten nicht wiederherstellen.

## Schritt 3 — docker compose up ausführen

```bash
docker compose up -d
```

Der erste Lauf zieht jedes Image und baut den Container-Graph. Rechne mit fünf bis zehn Minuten auf einer frischen Maschine. Zeigt `docker compose ps` jeden Service im Zustand `running` (oder `healthy`), ist die Plattform oben. Die nach aussen freigegebenen Services sind Caddy auf 80 und 443; alles andere ist intern.

## Schritt 4 — Den ersten Admin erstellen

Das erste Konto auf einer brandneuen Instanz braucht einen Bootstrap-Key. Der mitgelieferte Helper generiert einen:

```bash
./scripts/get-admin-key.sh
```

Kopier den Key, den das Skript ausgibt. Besuch `SITE_URL`, klick **Sign up**, füll deinen Namen, deine E-Mail und ein Passwort aus. Auf dem nächsten Bildschirm füg den Admin-Key ein und erstelle die **Organisation**. Du landest im Dashboard mit der Rolle **Owner**.

Für den tieferen Spaziergang zur Bootstrap-Regel siehe [Erster Admin](/de/self-hosted/install/first-admin).

## Schritt 5 — SITE_URL besuchen

Öffne `SITE_URL` in einem Browser. Du solltest das Dashboard deiner Org sehen, die Sidebar und eine leere Agents-Liste. Füg einen Provider unter **Einstellungen > Provider** hinzu, veröffentliche einen Agent (siehe [Agent erstellen](/de/platform/agents/create)), und du machst dasselbe, womit das Cloud-Onboarding endet.

## Fehlersuche

- **`docker compose up` beendet mit einem Port-Konflikt.** Ein anderer Dienst auf dem Host bindet bereits 80 oder 443. Stopp ihn (`sudo systemctl stop nginx` und Konsorten), oder setze `TLS_MODE=external` in `.env` und stell deinen bestehenden Reverse-Proxy vor Tale.
- **Die Sign-up-Seite lädt, aber der Admin-Key wird abgelehnt.** Lauf `./scripts/get-admin-key.sh` erneut — Keys rotieren pro Boot. Bricht das Skript mit „container not running" ab, ist der Platform-Container noch nicht hochgefahren; `docker compose ps` sagt dir, welcher Service unhealthy ist.
- **HTTPS-Fehler beim ersten Besuch.** Let's Encrypt braucht, dass das DNS lebt und Port 80 aus dem öffentlichen Internet erreichbar ist, bevor es ein Zertifikat ausstellen kann. Während die DNS propagiert, browse über `http://`, oder setze `TLS_MODE=selfsigned` in `.env`.
- **Container crash-loopen beim frischen Boot.** Fast immer fehlende Secrets. `docker compose logs platform` benennt die fehlende Variable wörtlich.

## Wo das eingesetzt wird

Du hast jetzt eine funktionierende Tale-Instanz, aber der Host ist nicht für Produktion gehärtet. Der Spaziergang [Linux-Server](/de/self-hosted/install/linux-server) deckt TLS, Firewall, Non-root-User und die operativen Haken ab, die du vor echtem Verkehr willst. Willst du den Host mit der `tale`-CLI verwalten statt mit `docker compose`, ist [CLI installieren](/de/self-hosted/install/cli-install) die nächste Lektüre.
