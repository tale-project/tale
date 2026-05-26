---
title: TLS und Domains
description: Wie der Caddy-Proxy TLS terminiert — selbst signiert für Development, Let's Encrypt für Produktion, external für einen vorgelagerten Proxy — plus Custom-Domain- und Custom-Cert-Setups.
---

Der `tale-proxy`-Container ist Caddy. Er besitzt die TLS-Terminierung, das Host-Routing und das Metric-Auth-Gate; jede Browser-seitige Anfrage landet zuerst hier. Die drei Modi — selbst signiert, Let's Encrypt, external — decken die drei Deployment-Formen ab, nach denen die meisten Operator greifen, und die Variable, die zwischen ihnen umschaltet, ist `TLS_MODE` in deiner `.env`.

Die Env-Var-Referenz-Zeilen leben in [Umgebungsvariablen-Referenz](/de/self-hosted/configuration/environment-reference#tls). Diese Seite ist der per-Modus-Walkthrough und die Rezepte für Custom Domains und Bring-your-own-Zertifikate.

## Selbst signiert (Default)

`TLS_MODE=selfsigned` lässt Caddy mit einem Zertifikat laufen, das es aus seiner internen CA generiert. Der Browser warnt beim ersten Mal, und der Host muss dem Cert vertrauen, um die Warnung zu unterdrücken — das ist für lokale Entwicklung gedacht:

```bash
docker exec tale-proxy caddy trust
```

Das trust-Kommando importiert die CA von Caddy in den System-Trust-Store auf dem Host, der den Docker-Daemon laufen lässt. Andere Maschinen im Netzwerk sehen die Warnung weiter, ausser sie importieren die CA auch. Produktion nutzt diesen Modus nie.

## Let's Encrypt

`TLS_MODE=letsencrypt` lässt Caddy ein echtes öffentliches Zertifikat ausstellen und erneuern. Drei Voraussetzungen müssen gelten, sonst scheitert die Ausstellungs-Schleife:

- Der Hostname in `HOST` und `SITE_URL` löst zur öffentlichen IP des Hosts vom öffentlichen Internet auf.
- Ports 80 und 443 sind vom öffentlichen Internet erreichbar (Port 80 trägt die ACME-HTTP-01-Challenge).
- `TLS_EMAIL` ist auf ein Postfach gesetzt, das du liest — Let's Encrypt warnt dort vor Ablauf.

```bash
# .env
TLS_MODE=letsencrypt
TLS_EMAIL=ops@yourdomain.com
```

Der erste Boot blockiert etwa eine Minute, während die ACME-Challenge läuft. Danach sind Erneuerungen automatisch 30 Tage vor Ablauf; Fehlschläge landen in `docker compose logs proxy`.

## Externer Proxy

`TLS_MODE=external` lässt Caddy intern Klartext-HTTP servieren, und du stellst deinen eigenen Reverse-Proxy davor, der TLS upstream terminiert. Wähl das, wenn:

- Du bereits ein CDN oder einen Load-Balancer betreibst, der Zertifikate handhabt.
- Du TLS einmal am Rand deines VPCs terminieren und intern alles als Klartext laufen lassen willst.
- Deine Compliance-Haltung eine bestimmte Zertifizierungsstelle verlangt, die Caddy nicht unterstützt.

```bash
# .env
TLS_MODE=external
SITE_URL=https://tale.yourdomain.com  # die URL, die deine Benutzer treffen
```

Der vorgelagerte Proxy braucht `X-Forwarded-Proto: https` auf jeder Anfrage, damit Tale korrekte Redirects und absolute URLs generiert. Ohne ihn landen Sign-in-Links auf `http://`, und das `Secure`-Flag des Auth-Cookies weist sie zurück.

## Custom Domain

Die Domain selbst sind nur `HOST` und `SITE_URL`. Dasselbe Caddyfile in `tale-proxy` liest beide beim Boot. Änder sie, erstell den Proxy-Container neu (`docker compose up -d --force-recreate tale-proxy`), und die neue Domain ist innerhalb von Sekunden live. Let's Encrypt stellt für den neuen Namen bei der nächsten Anfrage, die den neuen Hostnamen trifft, neu aus.

```bash
# .env
HOST=tale.example.com
SITE_URL=https://tale.example.com
```

Subpath-Deployments — Tale hinter `https://example.com/app/` — setzen zusätzlich `BASE_PATH=/app`. Der Reverse-Proxy upstream von Caddy strippt nichts; Tale handhabt das Präfix selbst.

## Bring-your-own-Zertifikat

Für eine interne CA oder ein Wildcard-Cert, das du bereits besitzt, mountest du Cert und Schlüssel in `tale-proxy` und fügst eine `tls`-Direktive ins Caddyfile hinzu:

```yaml
# compose.yml override
services:
  proxy:
    volumes:
      - ./certs/fullchain.pem:/etc/tale/cert.pem:ro
      - ./certs/privkey.pem:/etc/tale/key.pem:ro
    environment:
      TLS_MODE: external # umgeht Caddys Auto-Ausstellung
```

Dann bau entweder ein `tale-proxy`-Image mit Custom-Caddyfile vor, oder stell deinen eigenen Reverse-Proxy vor Tale und bleib bei `TLS_MODE=external` — beide Pfade sind unterstützt, und der zweite ist einfacher.

## Wo das hingehört

Die drei Modi decken die drei Deployment-Formen ab, die die meisten Teams treffen; die Env-Var-Zeilen leben in [Umgebungsvariablen-Referenz](/de/self-hosted/configuration/environment-reference#tls). Stellst du gerade einen frischen Produktions-Host auf, walkt [Produktions-Linux-Server-Install](/de/self-hosted/install/linux-server) Let's Encrypt End-to-End mit den Firewall- und DNS-Schritten in der richtigen Reihenfolge.
