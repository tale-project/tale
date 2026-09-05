---
title: Video-Ingestion
description: Konfiguriere, wie eine selbst gehostete Bereitstellung Video-Transkripte an YouTubes Bot-Abfrage vorbei abruft — der eingebaute PO-Token-Provider, ein Egress-Proxy und der vorgewärmte Browser-Session-Pool.
---

Liest Tale einen Videolink ein, ruft es das Transkript des Videos mit `yt-dlp` ab. Video-Plattformen — YouTube am aggressivsten — fordern Anfragen von Rechenzentrums- und Server-IPs mit einer „Bist du ein Mensch?"-Abfrage heraus, sodass eine frische, selbst gehostete Bereitstellung auf einer Cloud-VM beim Einlesen scheitern kann, wo ein Laptop an einem Heimanschluss durchkäme. Diese Seite behandelt die drei Ebenen, die Tale mitbringt, um daran vorbeizukommen — von der, die keine Konfiguration braucht, bis zu der, die am meisten verlangt.

<Info>

Verwaltete **Cloud**-Bereitstellungen führen diese Maßnahmen für dich aus — diese Seite richtet sich an Betreiber, die Tale auf eigener Infrastruktur betreiben.

</Info>

## Ebene 1 — der PO-Token-Provider (Standard, keine Konfiguration)

Die wirksamste Einzelmaßnahme ist ein **Proof-of-Origin-(PO-)Token**: ein signierter Wert, der eine Anfrage so aussehen lässt, als käme sie aus einer echten Browser-Session. Tale bringt einen fertig verdrahteten Token-Provider mit — das `yt-dlp`-Plugin ist ins Image eingebacken, und ein `bgutil-provider`-Sidecar liefert die Tokens über das interne Netz. Keine Umgebungsvariable ist nötig; ein frisches `docker compose up` oder `tale deploy` hat ihn am Laufen.

Du kannst `yt-dlp` mit `VIDEO_INGEST_POT_PROVIDER_URL` auf einen Provider auf einem anderen Host verweisen oder mit `VIDEO_INGEST_PO_TOKEN` ein manuell erstelltes Token übergeben — beides ist in der [Umgebungsreferenz](/de/self-hosted/configuration/environment-reference) dokumentiert. Ein ausgefallenes Sidecar bricht den Stack nie: Das Einlesen fällt auf kein Token zurück, genau so, als gäbe es die Ebene nicht.

## Ebene 2 — ein Egress-Proxy

Reicht das Token allein nicht — manche IP-Bereiche sind ohnehin markiert —, leite den Abruf über einen **Egress-Proxy** auf einer IP, der die Plattform vertraut. Residential- und ISP-gehostete Proxys funktionieren am besten; Rechenzentrums- und kommerzielle Proxys sind oft genauso markiert wie der Server selbst.

Setz `VIDEO_INGEST_PROXY_URL` auf die Proxy-URL. Ein `socks5h://`-Schema löst DNS am Proxy auf (die sicherste Wahl); `http`, `https`, `socks4`, `socks4a`, `socks5` und `socks5h` werden alle akzeptiert. Der Wert darf Zugangsdaten enthalten — Tale entfernt sie aus jeder Log-Zeile.

```bash .env
VIDEO_INGEST_PROXY_URL=socks5h://user:pass@residential.example:1080
```

Der Proxy gilt für jede Phase eines Abrufs — Metadaten, Untertitel und Audio —, sodass das gesamte Einlesen einen vertrauenswürdigen Ausgangspfad teilt.

## Ebene 3 — der vorgewärmte Browser-Session-Pool

Die stärkste Maßnahme präsentiert Cookies aus einer **echten Browser-Session, die die Bot-Abfrage bereits bestanden hat**. Tale hält einen Pool solcher Sessions, nach Domain geschlüsselt, und gibt jedem Abruf eine davon, sodass die Plattform einen wiederkehrenden Besucher statt eines erstmaligen Servers sieht.

Sessions werden verschlüsselt gespeichert (der Cookie-Jar wird mit dem `ENCRYPTION_SECRET_HEX` der Bereitstellung versiegelt) und werden nie an vom Agent ausgeführten Code weitergegeben — sie leben nur in der serverseitigen Abruf-Ebene. Eine Session, die blockiert zu werden beginnt, wird automatisch abgekühlt und dann stillgelegt, und abgelaufene Sessions werden planmäßig aufgeräumt.

Den Pool zu füllen ist ein fortgeschrittener, händischer Schritt, und er läuft über die [REST-API](/de/develop/api-reference) — ein Formular dafür gibt es im Produkt nicht. Erfasse einen Netscape-Cookie-Jar aus einem Browser, der die Abfrage für die Zielplattform gelöst hat, und importier ihn dann für die Domain dieser Plattform:

```bash
curl -sS -X POST "https://your-host.example.com/api/v1/browser-sessions/import" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg domain youtube.com --rawfile cookiesJar cookies.txt \
        '{ domain: $domain, cookiesJar: $cookiesJar, label: "warmed 2026-09-05" }')"
# → 201 { "sessionId": "..." }
```

Der Import ist der heikelste Schreibzugriff der Bereitstellung und deshalb doppelt abgesichert: Der Schlüssel muss einem Administrator der Organisation gehören, und dessen E-Mail-Adresse muss auf der Allowlist `TALE_DEPLOYMENT_CONFIG_ADMINS` stehen — derselben Liste, die die [Datenresidenz](/de/self-hosted/configuration/data-residency) schützt. Alle anderen bekommen **403** mit einem `code`, der die verweigernde Hürde nennt. `GET /api/v1/browser-sessions` listet den Pool mit Status, Ablauf und Fehlschlagzähler jeder Session — nie die Cookies selbst. Eine Session lebt 14 Tage, sofern `ttlMs` nichts anderes sagt, und nur das Einlesen von Videolinks schöpft aus dem Pool.

<Warning>

Konto-Cookies schalten gesperrte Inhalte frei, setzen das Konto aber aufs Spiel, wenn die Plattform automatisierte Nutzung markiert. Nutze bevorzugt Cookies aus einem Wegwerf- oder eigens angelegten Konto und checke einen Cookie-Jar niemals in die Versionsverwaltung ein.

</Warning>

## Welche Ebene brauche ich?

<CardGroup cols="2">

<Card title="Gerade deployt, einige Videos schlagen fehl" icon="circle-play">

Ebene 1 ist bereits aktiv. Versuch es erneut — viele Blockaden sind vorübergehend. Geh nur zu Ebene 2 über, wenn die Fehler anhalten.

</Card>

<Card title="Die meisten Videos schlagen auf diesem Host fehl" icon="globe">

Die IP der Bereitstellung ist wahrscheinlich markiert. Ergänze einen Egress-Proxy (Ebene 2) auf einer Residential-IP.

</Card>

<Card title="Eine bestimmte Plattform blockiert dich weiterhin" icon="key-round">

Wärme eine Browser-Session für diese Plattform vor (Ebene 3), damit der Abruf Cookies vorzeigt, die die Bot-Abfrage bestanden haben.

</Card>

<Card title="Vollständige Variablenreferenz" icon="settings">

Jeder `VIDEO_INGEST_*`-Regler, mit Standardwerten, steht in der [Umgebungsreferenz](/de/self-hosted/configuration/environment-reference).

</Card>

</CardGroup>

## Eine ehrliche Erwartung

Keine dieser Ebenen kann das Einlesen gegen eine Plattform garantieren, die aktiv daran arbeitet, automatisierten Zugriff von beliebigen IPs zu blockieren. Zusammen bringen sie das Einlesen überall dort zum Erfolg, wo dein Ausgang vertrauenswürdig ist, und jede Bereitstellung hat einen unterstützten Weg zu eskalieren. Blockiert eine Plattform deinen Server hart, lässt sich das Transkript trotzdem von Hand hereinholen — füg es in ein [Wissen](/de/platform/knowledge/documents)-Dokument ein.
