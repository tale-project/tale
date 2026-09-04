---
title: Produktions-Linux-Server-Installation
description: Eine gehärtete Linux-Installation auf einem einzelnen Host — TLS via Let's Encrypt, Firewall, Non-root-User und die operativen Haken, um echten Verkehr darauf zu legen.
---

Dieser Spaziergang nimmt die [Quickstart](/de/self-hosted/install/quickstart)-Form und härtet sie für Produktionsverkehr. Das Ergebnis ist ein einzelner Linux-Host, der Tale hinter echtem TLS betreibt, mit einer Firewall, einem Non-root-Operator-User und den operativen Defaults, die das Team treffen sollte, bevor es User auf die URL zeigt.

Der Spaziergang zielt auf ein aktuelles Ubuntu LTS oder Debian; Befehle übersetzen eins-zu-eins auf RHEL-Familie-Distros mit `dnf` statt `apt`. Spring keinen Schritt — die Reihenfolge zählt, und jeder Schritt setzt voraus, dass der vorherige sauber gelandet ist.

## Bevor du beginnst

Du brauchst:

- Eine VM oder einen Bare-Metal-Host mit mindestens 8 GB RAM, 4 vCPU und 100 GB Disk. Der Speicher wächst mit Anhängen und Wissen.
- Einen DNS-A-Eintrag, der auf die öffentliche IP des Hosts zeigt. Ohne DNS kann Let's Encrypt kein Zertifikat ausstellen.
- Ports 80, 443 aus dem öffentlichen Internet erreichbar für die TLS-Ausstellung; SSH auf welchem Port auch immer deine Operator-Policy sagt.
- Sudo auf dem Host.

## Schritt 1 — Die Box provisionieren

Aktualisiere und installier die Grundlagen:

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git ufw
```

Erstell einen Non-root-Operator-User namens `tale`:

```bash
sudo adduser tale
sudo usermod -aG sudo,docker tale
```

Wechsle zu diesem User (`sudo su - tale`) für den Rest des Spaziergangs. Tale als root zu betreiben holt einen höheren Wirkungsradius für keinen Nutzen; der Rest der Schritte setzt den `tale`-User voraus.

## Schritt 2 — Docker installieren

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo systemctl enable --now docker
```

Verifizier mit `docker run hello-world`. Kann der User Docker nicht ohne sudo laufen lassen, melde dich ab und wieder an, um die `docker`-Gruppen-Mitgliedschaft zu übernehmen.

## Schritt 3 — Firewall und Reverse-Pfad konfigurieren

Erlaub nur, was Tale braucht:

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

Stellst du Tale einen bestehenden Reverse-Proxy auf demselben Host vor (selten bei einer Single-Host-Installation), setze `TLS_MODE=external` in `.env` und passe die Firewall entsprechend an. Der Caddy-Container innerhalb von Tale terminiert TLS standardmässig.

## Schritt 4 — Tale ziehen

```bash
git clone https://github.com/tale-project/tale.git
cd tale
cp .env.example .env
```

Setze `HOST`, `SITE_URL` und generier die vier Secrets wie im [Quickstart](/de/self-hosted/install/quickstart). Der Produktions-Diff gegenüber dem Quickstart lebt in Schritt 5 (TLS) und den operativen Haken am Ende dieses Spaziergangs.

## Schritt 5 — TLS via Let's Encrypt

Öffne `.env` und setze:

| Variable    | Wert                           |
| ----------- | ------------------------------ |
| `TLS_MODE`  | `letsencrypt`                  |
| `TLS_EMAIL` | Ein Ops-Postfach, das du liest |

Caddy stellt das Zertifikat aus und erneuert es automatisch über den DNS-Eintrag aus den Voraussetzungen. Der erste Boot wartet auf das Zertifikat; rechne mit einer Verzögerung von einer Minute beim ersten `docker compose up -d`, während die ACME-Challenge läuft.

## Schritt 6 — Erster Boot

```bash
docker compose up -d
docker compose ps
```

Jeder Service sollte `running` oder `healthy` zeigen. Folg dem **Schritt 4 — Den ersten Admin erstellen** aus dem [Quickstart](/de/self-hosted/install/quickstart), um im Dashboard zu landen. Öffne `SITE_URL` über `https://` — der Browser sollte nicht vor dem Zertifikat warnen.

## Schritt 7 — Operative Haken

Bevor du User auf die URL zeigst, machen dir drei Haken später das Leben leichter:

- **Backups.** `tale backup` snapshottet die Daten-Volumes — Blobs eingeschlossen — ins `backups`-Volume; richte dein Off-Host-Tooling auf dieses Volume plus Projekt-Workspace und `.env` — siehe [Backups und Restore](/de/self-hosted/operate/backups-and-restore).
- **Logs.** Tale loggt auf stdout. Hat der Host journald, trägt `journalctl -u docker` alles; sonst pipe zu deinem Aggregator.
- **Metriken.** Setze `METRICS_BEARER_TOKEN` in `.env` und scrap `/metrics` aus deinem Prometheus — siehe [Observability-Konfiguration](/de/self-hosted/configuration/observability-config).

## Port-Tabelle

| Port | Richtung | Zweck                                    | Erforderlich      |
| ---- | -------- | ---------------------------------------- | ----------------- |
| 22   | inbound  | SSH                                      | ja, eingeschränkt |
| 80   | inbound  | HTTP, genutzt für ACME und 301 auf HTTPS | ja                |
| 443  | inbound  | HTTPS, primärer Verkehr                  | ja                |
| 53   | outbound | DNS                                      | ja                |
| 443  | outbound | Modell-Provider, Image-Pulls             | ja                |

## Fehlersuche

- **Let's-Encrypt-Ausstellung scheitert.** DNS muss auf die öffentliche IP dieses Hosts aus dem öffentlichen Internet auflösen, und Port 80 muss aus dem öffentlichen Internet erreichbar sein. Lauf `curl -I http://$HOST` von einer anderen Maschine; trifft es die Caddy-Challenge, läuft der Pfad.
- **Container können Modell-Provider nicht erreichen.** Die ausgehende Firewall des Hosts blockt vielleicht; verifizier mit `docker compose exec platform curl -I https://api.openai.com`.
- **TLS-Zertifikat-Erneuerungen scheitern später.** Caddy erneuert 30 Tage vor Ablauf; Fehler zeigen sich in `docker compose logs proxy`. Die zwei häufigen Ursachen sind eine abgelaufene `TLS_EMAIL`-Mailbox und eine DNS-Änderung, die den Eintrag gebrochen hat.

## Wo das eingesetzt wird

Du hast jetzt eine produktions-geformte Installation auf einem Host. Zwei Folgeaufgaben gehören in den Kalender — [Backups und Restore](/de/self-hosted/operate/backups-and-restore) und [Härten](/de/self-hosted/operate/security/hardening). Wächst dein Massstab über einen Host hinaus (Faustregel: etwa hundert gleichzeitige User auf der empfohlenen Spec), lebt die Multi-Host-Architektur unter [Container-Architektur](/de/self-hosted/operate/container-architecture).
