---
title: Videotranskripte importieren
description: Untersuche Abruffehler, konfiguriere Token-Anbieter oder Proxy und verwalte Browsersitzungen je Organisation.
---

Tale verwendet `yt-dlp`, um Inhalte für den Import von Videolinks abzurufen. Ob das gelingt, hängt vom Video, verfügbaren Untertiteln oder Extraktionsweg und den Zugriffsprüfungen der Plattform ab. Ein Video kann auf deinem Laptop abspielen und trotzdem Netzwerk oder Sitzung des Servers zurückweisen.

Diese Betriebsanleitung behandelt den Transkriptabruf. Tale führt jeden Abruf in einer eigenen Sandbox-Sitzung aus, getrennt vom Backend; [Wo der Abruf läuft](#where-retrieval-runs) beschreibt, was ein Deployment dafür bereitstellen muss. Beginne mit einem öffentlichen Video, auf das du zugreifen kannst, und lies den Importfehler, bevor du Zugangsdaten ergänzt oder den Netzausgang änderst.

## Die fehlerhafte Phase eingrenzen

| Beobachtung | Zuerst prüfen |
| --- | --- |
| Ein Video scheitert | Unterstützung der URL, Verfügbarkeit des Inhalts und brauchbare Transkript- oder Audioquelle. |
| Viele Videos scheitern von einem Host | Extraktionsfehler im Worker, Antworten der Quellplattform und Netzwerkweg dieses Hosts. |
| Ein YouTube-Link meldet, der Server solle nachweisen, kein Bot zu sein | Den Token-Anbieter, der aus ist, bis du ihn [aktivierst](#token-provider). |
| Videos stoßen über deine Proxys auf eine Bot-Prüfung | Die Zeilen `[ytdlp] outbound proxy entry` im Worker-Log und ob jeder gelistete Proxy eine feste Adresse behält ([Egress-Proxy](#egress-proxy)). |
| Ein Link bleibt minutenlang **In Warteschlange** und scheitert dann als vorübergehender Fehler | Das Limit **Render-Sitzungen** der Organisation und die Kapazität des Sandbox-Hosts ([Wo der Abruf läuft](#where-retrieval-runs)). |
| Jeder Link meldet, die Video-Verarbeitung sei noch nicht aktiviert | Das Sandbox-Runtime-Image: Eines von vor diesem Release enthält kein `yt-dlp`. |
| Ein Link meldet, das Video sei zu groß für die Verarbeitung | Die [Grenzen für Länge und Größe](#limits). |
| Abruf gelingt, Wissenssuche scheitert | Embedding-Konfiguration der Organisation und Indexierungsstatus. |
| Fehler nach einer zunächst funktionierenden Sitzung | Ablauf, Zustand des Quellkontos und Abkühlung oder Stilllegung im Pool. |

Lies `tale logs backend-worker --tail 200` und den Fehlergrund des Eintrags. Halte URL und Fehlerkategorie fest. Entferne vor dem Teilen Cookies, signierte URLs und Zugangsdaten aus Diagnosen. Ein erneuter Versuch kann bei vorübergehenden Fehlern helfen; gleichbleibende Verweigerungen erfordern eine Untersuchung.

## Wo der Abruf läuft {#where-retrieval-runs}

Für jeden Videolink startet der Worker eine Sandbox-Sitzung, führt `yt-dlp` darin aus und entfernt die Sitzung, sobald der Link bereit oder gescheitert ist. `yt-dlp` ruft Seiten von jeder Adresse ab, die ein Mitglied einfügt, und führt das JavaScript der Plattform aus, um an deren Streams zu kommen. In einer Sitzung tut es das als unprivilegierter Benutzer auf einem schreibgeschützten Root-Dateisystem, und seinen Speicher lässt der Sandbox-Host zu, statt dass das Backend ihn trägt.

Ein Deployment muss dafür drei Dinge bereitstellen:

- **Eine laufende Sandbox.** Mitgelieferte Bereitstellungen starten immer eine. Ihr Sitzungs-Image enthält `yt-dlp`, die JavaScript-Laufzeit, die `yt-dlp` braucht, und das Plugin des Token-Anbieters. Ein Link, der mit „Video-Verarbeitung noch nicht aktiviert — Administrator kontaktieren“ scheitert, lief in einem Sitzungs-Image von vor diesem Release: Betreibe das Sandbox-Runtime-Image desselben Release wie das Backend.
- **Eine freie Render-Sitzung.** Jeder Link in Arbeit belegt eine der **Render-Sitzungen** der Organisation, das Limit unter **Einstellungen > Sandboxes**, das auch Website-Scans nutzen. Ist keine frei oder hat der Sandbox-Host keinen Platz für eine weitere Sitzung, bleibt der Link **In Warteschlange** und fragt alle 5 bis 60 Sekunden erneut. Das Warten zählt nicht als Versuch des Links. Hat ein Link 15 Minuten gewartet, scheitert er mit „Vorübergehender Fehler — erneut versuchen“. [Sandbox-Kapazität verwalten](/de/platform/admin/sandboxes) beschreibt das Limit und die Kapazität des Hosts.
- **Einen Weg nach draußen für die Sitzung.** Ohne [Proxy für Videos](#egress-proxy) verlassen Anfragen die Sitzung über den Egress-Proxy der Sandbox, der Tunnel nur zu den Ports 443 und 80 öffnet. Schränkt `SANDBOX_EGRESS_ALLOWLIST` die Ziele der Sandbox ein, ergänze die Videoplattformen, die deine Mitglieder nutzen, und die Hosts, von denen diese Plattformen Medien ausliefern; sonst scheitert jeder Link an seiner ersten Anfrage. [Sandbox-Ziele begrenzen](/de/self-hosted/operate/security/hardening#sandbox-ziele-begrenzen) erklärt die Einstellung.

## Grenzen für Länge und Größe {#limits}

Tale liest Untertitel, die eine Plattform als WebVTT oder SubRip ausliefert. Hat ein Video keine in einem dieser Formate, lädt der Worker sein Audio für das Transkriptionsmodell herunter. Er speichert das Audio so, wie die Plattform es ausliefert, meist als WebM-, M4A- oder MP4-Datei, und bevorzugt einen Stream bis 200 MiB: den besten reinen Audio-Stream, der hineinpasst, oder den kleinsten, wenn keiner passt. Von einer Plattform, die Audio nur zusammen mit einem Bild ausliefert, nimmt er ein Bild mit höchstens 480 Zeilen.

| Grenze | Wert | Darüber |
| --- | --- | --- |
| Länge des Videos | 4 Stunden | Der Link scheitert mit „Video überschreitet das 4-Stunden-Limit“, sobald seine Metadaten gelesen sind und bevor etwas heruntergeladen wird. |
| Audio, wie die Plattform es ausliefert | 1 GiB | Der Link scheitert mit „Video ist zu groß für die Verarbeitung“ und wird nicht wiederholt. Hänge stattdessen die Aufnahme selbst oder ihr Transkript an. |
| Eine Untertitelspur | 5 MiB | Die Spur wird übergangen und das Audio transkribiert. |

## Token-Anbieter aktivieren {#token-provider}

YouTube verlangt von manchen Adressen, vor allem von Rechenzentrumsadressen, den Nachweis, dass eine Anfrage nicht von einem Bot stammt. Ein Link scheitert dann, und das Mitglied liest, YouTube verlange von diesem Server den Nachweis, kein Bot zu sein, und ein Administrator könne den Token-Anbieter aktivieren.

Der Anbieter ist `bgutil-provider`, ein Dienst im internen Netzwerk, der die Proof-of-Origin-Tokens liefert, die eine solche Anfrage braucht. Das Sandbox-Runtime-Image enthält sein Plugin. Eine mitgelieferte Bereitstellung startet ihn nur auf Wunsch: Er ist ein weiterer Container, etwa 60 MiB im Ruhezustand, und nur eine Instanz, die YouTube auf die Probe stellt, hat etwas von ihm. Um ihn zu aktivieren, ergänze diese Zeile in der `.env` des Workspace und führe `tale deploy` aus:

```dotenv
VIDEO_INGEST_POT_PROVIDER=true
```

Der Deploy startet den Anbieter. Von da an fragt ihn die Sitzung eines Videos über das Backend, das ihn unter `http://bgutil-provider:4416` erreicht. Entfernst du die Zeile oder setzt sie auf `false`, entfernt der nächste Deploy den Anbieter wieder. Ein Token gewährt keinen Zugriff auf private Inhalte und garantiert keine Annahme durch die Quellplattform.

Prüfe `tale logs bgutil-provider` und die Erreichbarkeit vom Backend. Der Anbieter ist für den Start des Kernsystems nicht nötig: Sein Ausfall blockiert die Bereitstellung nicht, kann den Transkriptabruf aber beeinträchtigen.

`VIDEO_INGEST_POT_PROVIDER_URL` nennt stattdessen einen eigenen Anbieter und braucht keine weitere Einstellung; das Backend muss ihn erreichen können, eine Sitzung nicht. `VIDEO_INGEST_PO_TOKEN` übergibt ein manuell beschafftes Token. Bewahre Tokens in deiner Geheimniskonfiguration auf. Die [Umgebungsreferenz](/de/self-hosted/configuration/environment-reference) beschreibt auch Extraktions-Client und Plugin-Optionen. Ändere sie passend zum beobachteten Fehler.

## Einen Egress-Proxy konfigurieren {#egress-proxy}

Videoabrufe laufen über die [ausgehenden Proxys](/de/self-hosted/configuration/environment-reference#outbound-proxies) des Deployments, sobald `OUTBOUND_PROXY_URLS` Proxys nennt. Ein Video behält für Metadaten, Untertitel und Audio denselben Proxy. Es beginnt auf dem Proxy, über den seine Plattform zuletzt ein Video ausgeliefert hat, sonst auf dem nächsten in der Reihe. Einen Proxy, über den die Plattform gerade ein Video ausgeliefert hat, lässt sie am ehesten wieder durch.

Die Sitzung eines Videos verbindet sich nie selbst mit einem Proxy. Sie schickt ihre Anfragen an das Backend, das die Verbindung zum Proxy des Videos öffnet und den Verkehr in beide Richtungen durchreicht. Ein Proxy muss deshalb vom Backend aus erreichbar sein, und seine Zugangsdaten gelangen nie in eine Sitzung. Laufen API und Worker als getrennte Dienste, gib beiden dieselben Proxy-Einstellungen: Der Worker wählt den Proxy eines Videos, und der API-Prozess verbindet sich nur mit einem Proxy, den seine eigenen Einstellungen nennen.

Weist die Plattform das Video über diesen Proxy ab, etwa mit einer Bot-Prüfung, einem Rate-Limit oder einer verweigerten Anfrage, oder kann der Proxy die Anfrage nicht weiterleiten, wechselt der Worker zum nächsten Proxy in der Reihe, an dem das Video noch nicht gescheitert ist. Der Abruf der Metadaten, der Untertitel oder des Audios unternimmt höchstens fünf Versuche und wiederholt sich nur in den ersten 90 Sekunden dieses Schritts. Scheitert der Abruf eines Vimeo-Videos über seine Seite, versucht es der Metadaten-Schritt zusätzlich über den eingebetteten Player von Vimeo, der ebenfalls bis zu fünf Versuche unternimmt. Das Worker-Log nennt jeden Wechsel mit der Position des Proxys in der Liste, nie mit seinen Zugangsdaten:

```text
[ytdlp] outbound proxy entry 3 (http://gateway.example:80) failed (botDetection); the video goes on through entry 7 (http://gateway.example:80)
```

Sind die Versuche aufgebraucht, endet der Schritt wie ohne Proxys, mit dem Grund der Plattform. Steht nur ein Proxy in der Liste, wiederholt der Worker keinen abgewiesenen Versuch.

Jeder gelistete Proxy muss eine feste öffentliche Adresse behalten. YouTube signiert seine Medien für die anfragende Adresse und kann den Download von einer anderen verweigern. Auf einen rotierenden Endpunkt, der jeder Verbindung eine neue Adresse gibt, ist für Videos deshalb kein Verlass. Liste stattdessen die Endpunkte deines Anbieters mit fester Adresse. Viele Anbieter stellen sie über ein gemeinsames Gateway bereit und nummerieren sie im Benutzernamen:

```bash
OUTBOUND_PROXY_URLS=http://user-1:password@gateway.example:80,http://user-2:password@gateway.example:80,http://user-3:password@gateway.example:80
```

Anfragen an Websites nehmen diese Proxys weiterhin reihum. Plattformen weisen viele Adressen aus Rechenzentren ab. Zeigt das Log bei den meisten Videos Wechsel, helfen Proxys aus Privatkunden- oder ISP-Netzen: Sie werden seltener abgewiesen.

Um Proxys nur für Videos zu nutzen, etwa Proxys aus Privatkunden- oder ISP-Netzen, die pro Adresse oder pro Gigabyte abgerechnet werden, liste sie stattdessen in `VIDEO_INGEST_PROXY_URLS`. Videoabrufe laufen dann nur über diese Proxys, während Anfragen an Websites und Sandbox-Sitzungen bei den ausgehenden Proxys bleiben, die dann auch einen rotierenden Endpunkt enthalten können. Ein Video wechselt in dieser Liste wie oben beschrieben, und jeder Eintrag muss eine feste öffentliche Adresse behalten. Ist das Video an jedem Proxy der Liste gescheitert, endet der Schritt mit dem Grund der Plattform; er weicht nie auf die ausgehenden Proxys oder eine direkte Verbindung aus. Im Worker-Log erscheint ein Wechsel in dieser Liste als `video proxy entry`, ein Wechsel in der ausgehenden Liste als `outbound proxy entry`.

Trenne die Einträge durch Kommas oder Leerzeichen. Jeder Eintrag hat die Form `scheme://[user:password@]host[:port]` mit einem der Schemata `http`, `https`, `socks4`, `socks4a`, `socks5` und `socks5h`; die letzte Variante löst DNS am Proxy auf. Ein fehlerhafter Eintrag verhindert den Start des Backends; die Meldung nennt den Eintrag nach seiner Position.

```bash
VIDEO_INGEST_PROXY_URLS=socks5h://user-1:password@residential.example:1080,socks5h://user-2:password@residential.example:1080
```

Für einen einzelnen freigegebenen Proxy nur für Videos setze stattdessen `VIDEO_INGEST_PROXY_URL`. Er ersetzt die ausgehenden Proxys nur für Videos und nimmt dieselben Schemata an, wiederholt als einzelner Proxy aber keinen abgewiesenen Versuch. Setze entweder `VIDEO_INGEST_PROXY_URL` oder `VIDEO_INGEST_PROXY_URLS`: Sind beide gesetzt, startet das Backend nicht.

```bash
VIDEO_INGEST_PROXY_URL=socks5h://proxy.example.com:1080
```

Ergänze erforderliche Zugangsdaten über deine Geheimnisverwaltung. Eine ungültige URL oder ein nicht unterstütztes Schema in `VIDEO_INGEST_PROXY_URL` wird mit Warnung ignoriert, und der Abruf läuft wie ohne die Variable über die ausgehenden Proxys, falls es welche gibt. Prüfe deshalb die übernommene Konfiguration und einen echten Abruf. Erstelle den Worker nach Änderungen seiner Umgebung neu. Ein Neustart des bestehenden Containers liest eine geänderte `.env` nicht ein.

Ein anderer Netzwerkweg garantiert keinen Zugriff. Prüfe, ob Proxy und Quellkonto für die benötigten Inhalte verwendet werden dürfen. Bleibt die Quelle unerreichbar, importiere ein bereits vorliegendes Transkript als [Wissensdokument](/de/platform/knowledge/documents).

## Eine berechtigte Browsersitzung importieren

Der Server kann Cookies aus einem nach **Organisation und Domain** getrennten Sitzungspool beziehen. Er verschlüsselt Cookie-Dateien mit `ENCRYPTION_SECRET_HEX` und gibt sie in Listen nicht zurück. Der Pool gehört zum serverseitigen Videoimport und exportiert keine Cookies an Agentenskripte. Für ein Video schreibt der Worker die bezogene Cookie-Datei in die Sandbox-Sitzung dieses Videos, die nichts außer `yt-dlp` ausführt und entfernt wird, sobald der Link fertig ist.

Es gibt kein Importformular in der Anwendung. Der REST-Schreibzugriff braucht einen Schlüssel eines Organisationsadministrators, dessen Konto auf `TALE_DEPLOYMENT_CONFIG_ADMINS` steht. Der Schlüssel muss zudem die Zielorganisation auflösen können. `GET /api/v1/me` zeigt dafür `capabilities.deploymentEditor`. Gib die Organisation mit `X-Organization-Slug` ausdrücklich an, besonders bei mehreren Mitgliedschaften.

1. Exportiere eine Cookie-Datei im Netscape-Format aus einer berechtigten Browsersitzung für die Quelldomain. Behandle sie wie Kontozugangsdaten und halte sie aus der Versionsverwaltung heraus.
2. Setze `TALE_URL`, `TALE_API_KEY` und `TALE_ORG_SLUG` für Instanz und Organisation. Beschränke den Lesezugriff auf `cookies.txt` auf das Betreiberkonto.
3. Importiere die Datei, ohne ihren Inhalt als Befehlsargument zu übergeben:

```bash
jq -n --arg domain youtube.com --rawfile cookiesJar cookies.txt \
  '{domain: $domain, cookiesJar: $cookiesJar, label: "operator-managed session"}' |
  curl --fail-with-body -sS -X POST "$TALE_URL/api/v1/browser-sessions/import" \
    -H "Authorization: Bearer $TALE_API_KEY" \
    -H "X-Organization-Slug: $TALE_ORG_SLUG" \
    -H 'Content-Type: application/json' \
    --data-binary @-
```

Ein erfolgreicher Import liefert HTTP 201 mit `sessionId`. Ungültige Daten führen zur Validierungsverweigerung, fehlende Rechte zu 403. Kläre die genannte Schranke, statt nur für den Aufruf eine weitergehende Rolle zu vergeben.

## Sitzungen prüfen und widerrufen

```bash
curl --fail-with-body -sS "$TALE_URL/api/v1/browser-sessions" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: $TALE_ORG_SLUG"
```

Die Liste zeigt Metadaten wie Status, Ablauf und Fehlerzahl. Die Standardlaufzeit beträgt 14 Tage. Beim Import ist ein positives `ttlMs` bis 180 Tage möglich. Cookies der Quelle können früher ablaufen; ein noch gültiger Pool-Eintrag beweist keine funktionierende Kontositzung.

Ein blockierter Abruf lässt eine Sitzung abkühlen. Wiederholte Blockaden können sie stilllegen; ein geplanter Lauf bereinigt abgekühlte oder abgelaufene Einträge. Ein späterer Versuch kann eine andere gesunde Sitzung derselben Organisation und Domain verwenden. Ohne passende Sitzung kann der Abruf mit den anderen konfigurierten Optionen fortfahren.

Widerrufe eine importierte Sitzung mit `DELETE /api/v1/browser-sessions/<sessionId>` und demselben Organisationsumfang sowie den erforderlichen Schreibrechten. Prüfe die ID zuvor in der Liste. Widerrufe oder erneuere auch die Sitzung beim Quellkonto, wenn ihre Cookies offengelegt wurden. Teste zuletzt ein kontrolliertes Video und prüfe Transkript sowie Indexierung. Der Cookie-Import allein belegt keinen erfolgreichen Videoimport.
