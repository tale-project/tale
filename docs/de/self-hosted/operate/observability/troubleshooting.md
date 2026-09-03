---
title: Troubleshooting
description: Symptomorientierter Index für die Probleme, die Operator auf Tale-Instanzen tatsächlich getroffen haben — was der Benutzer meldet, was kaputt ist und was zu tun ist.
---

Diese Seite ist das symptomorientierte Nachschlagen, wenn jetzt gerade etwas falsch ist. Jeder Abschnitt fängt mit dem an, was der Benutzer tatsächlich meldet — was der Browser zeigt, woran der Agent scheitert, was der Upload-Bildschirm sagt — und geht zurück zur Ursache und zum Fix. Alles, was hier nicht gelistet ist, ist ein Kandidat für einen neuen Abschnitt, sobald es zweimal aufgetaucht ist.

Die proaktive Seite — Signale, auf die zu alarmieren sich lohnt, was in Prometheus zu verdrahten ist — lebt in [Operations](/de/self-hosted/operate/observability/operations). Diese Seite ist für den Moment, nachdem die Page gefeuert hat.

## Browser sieht 502 oder „Bad Gateway"

Der `tale-proxy`-Container hat die Plattform erreicht, aber die Plattform hat nicht geantwortet. Entweder ist `tale-platform` down oder sein Health-Endpoint unerreichbar. Prüf zuerst den Container-Zustand:

```bash
docker compose ps tale-platform
docker compose logs --tail=200 tale-platform
```

Startet der Container neu, zeigen die Logs am Boden den Crash-Grund — meist eine fehlkonfigurierte Env-Var (`SITE_URL`-Mismatch, fehlender `BETTER_AUTH_SECRET`) oder ein Postgres-Verbindungsfehler. Fix die Env, starte neu, versuche es erneut. Ist der Container healthy, aber der Browser sieht immer noch 502, ist der Proxy der Verdächtige — `docker compose restart tale-proxy` räumt die meisten davon weg.

## Browser sieht eine TLS-Warnung

`TLS_MODE=selfsigned` ist die häufigste Ursache — der Browser vertraut der internen CA von Caddy beim ersten Besuch nicht. Vertrau entweder der CA auf dem Host (`docker exec tale-proxy caddy trust`) oder wechsel zu `TLS_MODE=letsencrypt` für ein echtes Zertifikat. Der vollständige Modus-Walk lebt in [TLS und Domains](/de/self-hosted/configuration/tls-and-domains).

Ist der Modus bereits `letsencrypt`, prüf die Proxy-Logs auf ACME-Fehlschläge — DNS löst nicht auf die öffentliche IP des Hosts und Port 80 ist vom öffentlichen Internet nicht erreichbar sind die zwei häufigen Ursachen.

## UI lädt, aber keine Daten erscheinen

Die UI-Shell sind statische Assets, von `tale-platform` serviert; alles andere fliesst durch `tale-backend-api` — die App-API über HTTP und der Live-Update-SSE-Stream auf `/events`. Wenn das Backend nicht erreichbar ist, lädt die Shell und bleibt leer. Symptome: Spinner, die nie auflösen, „reconnecting"-Toasts, der Chat-Input, der nie eine Nachricht annimmt.

```bash
docker compose logs --tail=200 backend-api
```

Der backend-api-Container startet wahrscheinlich neu (such nach einem Crash in den Logs) oder ist vom Proxy unerreichbar. Starte mit `docker compose restart backend-api` neu — Sessions sind serverseitig, und Clients verbinden den SSE-Stream neu, also ist der Restart sicher.

## Uploads stecken in „indexing"

Die Dokument-Ingestion läuft im Backend-Worker und schreibt die extrahierten Chunks und Embeddings in die Datenbank des Wissens-Korpus. Ein langer „indexing"-Zustand bedeutet entweder, dass der Worker die Korpus-Datenbank nicht erreicht oder dass die Datei selbst nicht extrahiert werden konnte. Prüf zuerst die Worker-Logs und die Korpus-Datenbank:

```bash
docker compose logs --tail=200 backend-worker | grep -iE "knowledge|ingest|embed"
docker compose ps db
```

Zeigen die Logs Verbindungsfehler zur Korpus-Datenbank (`knowledge-db` im Netz, auf einem Single-Host-Deploy in `db` gefaltet), starte sie neu (`docker compose restart db`); die Ingestion versucht es beim nächsten Durchlauf erneut, Uploads müssen also nicht erneut eingereicht werden. Ist die Datenbank healthy, aber ein bestimmter Upload steckt, ist die Datei selbst der Verdächtige — beschädigte PDFs und passwortgeschützte Dokumente landen in einem Fehlzustand und brauchen Löschung und Re-Upload.

## Chat-Antworten hören mitten im Stream auf

Der Token-Stream vom Upstream-Anbieter ist abgefallen — entweder hat der Anbieter rate-limited, die Verbindung ist getimeoutet, oder der Service des Anbieters ist degradiert. Prüf zuerst die Status-Seite des Anbieters; schau dann in die Plattform-Logs:

```bash
docker compose logs --tail=200 tale-platform | grep -E "429|503|stream"
```

Ein `429` ist der häufige Fall. Entweder trifft das Budget der Org das Rate-Limit des Anbieters, oder der Anbieter-Schlüssel selbst ist gedrosselt. Das Default-Modell der Org auf einen weniger ausgelasteten Anbieter umzuschalten räumt das Symptom weg, während das Upstream abkühlt.

## Speichern scheitert mit „saving failed"-Toast

Das Backend konnte nicht in Postgres schreiben. Entweder ist `tale-db` down oder seine Platte ist voll:

```bash
docker compose ps tale-db
docker compose exec db df -h /var/lib/postgresql/data
```

Eine Platte bei 100 % ist der Fehler, der die meisten überraschten Gesichter erzeugt. Schaff Platz, starte `tale-db` neu, und die gepufferten Writes flushen. Hat die Platte Platz, ist der Verdächtige Verbindungs-Pool-Erschöpfung oder ein Lock — starte `backend-api` neu, um den Pool zu räumen.

## „Run code"-Tool scheitert mit „egress denied"

Der `tale-sandbox-egress`-Container ist der einzige ausgehende Netzwerk-Pfad für sandboxierten Code; ist er down oder fehlkonfiguriert, scheitert jede ausgehende Anfrage aus der Sandbox geschlossen. Prüf zuerst den Egress-Container:

```bash
docker compose ps tale-sandbox-egress
docker compose logs --tail=100 tale-sandbox-egress
```

Ist der Container healthy und du hast `SANDBOX_EGRESS_ALLOWLIST` gesetzt, hat die Anfrage die Allowlist getroffen — erweitere die Variable in `.env` und erzeuge `tale-sandbox-egress` neu. Ohne Allowlist ist der Proxy auf Hostname-Ebene offen; prüf stattdessen das Ziel: für HTTPS wird nur Port 443 getunnelt, und Cloud-Metadaten-Adressen sowie private Adressbereiche sind auf IP-Ebene immer blockiert.

## Sign-in läuft zurück in die Sign-in-Seite

`SITE_URL` passt nicht zu dem, was der Browser tatsächlich angefragt hat. Auth-Cookies sind auf die URL gescopt, auf der die Anfrage landete; ein Mismatch (Trailing Slash, fehlender Port, `http` vs `https`, Base-Path-Präfix) bedeutet, dass das beim Callback gesetzte Cookie bei der nächsten Anfrage nicht mitgeschickt wird.

Fix `.env`:

```bash
SITE_URL=https://tale.example.com  # exakt, was der Benutzer tippt
```

Erstell den Plattform-Container neu (`docker compose up -d --force-recreate tale-platform`), damit die Änderung im gerenderten HTML landet.

## Wo du Hilfe bekommst

Self-hosted-Instanzen telefonieren nicht heim, also fängt Support bei dir an. Die zwei Kanäle:

- **GitHub Issues** — Bugs und reproduzierbare Probleme. Der [tale-project/tale](https://github.com/tale-project/tale/issues)-Tracker hat ein Template, das nach dem Diagnose-Bundle fragt, das `tale diagnostics` produziert.
- **Discord** — Fragen, Konfigurations-Debatten, „ist das ein Bug"-Triage. Die Einladung lebt im Repo-README.

Reproduzierbare Diagnose macht jeden Kanal schneller. `tale diagnostics` sammelt sanitised Logs, Env-Vars (Secrets redigiert) und Container-Health in ein einzelnes Archiv, das es wert ist, angehängt zu werden.
