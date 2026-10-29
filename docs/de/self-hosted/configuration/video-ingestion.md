---
title: Videotranskripte importieren
description: Untersuche Abruffehler, konfiguriere Token-Anbieter oder Proxy und verwalte Browsersitzungen je Organisation.
---

Tale verwendet `yt-dlp`, um Inhalte für den Import von Videolinks abzurufen. Ob das gelingt, hängt vom Video, verfügbaren Untertiteln oder Extraktionsweg und den Zugriffsprüfungen der Plattform ab. Ein Video kann auf deinem Laptop abspielen und trotzdem Netzwerk oder Sitzung des Servers zurückweisen.

Diese Betriebsanleitung behandelt den Transkriptabruf. Beginne mit einem öffentlichen Video, auf das du zugreifen kannst, und lies den Importfehler, bevor du Zugangsdaten ergänzt oder den Netzausgang änderst.

## Die fehlerhafte Phase eingrenzen

| Beobachtung | Zuerst prüfen |
| --- | --- |
| Ein Video scheitert | Unterstützung der URL, Verfügbarkeit des Inhalts und brauchbare Transkript- oder Audioquelle. |
| Viele Videos scheitern von einem Host | Extraktionsfehler im Worker, Antworten der Quellplattform und Netzwerkweg dieses Hosts. |
| Videos stoßen über deine Proxys auf eine Bot-Prüfung | Die Zeilen `[ytdlp] outbound proxy entry` im Worker-Log und ob jeder gelistete Proxy eine feste Adresse behält ([Egress-Proxy](#egress-proxy)). |
| Abruf gelingt, Wissenssuche scheitert | Embedding-Konfiguration der Organisation und Indexierungsstatus. |
| Fehler nach einer zunächst funktionierenden Sitzung | Ablauf, Zustand des Quellkontos und Abkühlung oder Stilllegung im Pool. |

Lies `tale logs backend-worker --tail 200` und den Fehlergrund des Eintrags. Halte URL und Fehlerkategorie fest. Entferne vor dem Teilen Cookies, signierte URLs und Zugangsdaten aus Diagnosen. Ein erneuter Versuch kann bei vorübergehenden Fehlern helfen; gleichbleibende Verweigerungen erfordern eine Untersuchung.

## Mitgelieferten Token-Anbieter prüfen

Das Platform-Image enthält das Token-Plugin. Die mitgelieferte Bereitstellung startet `bgutil-provider` im internen Netzwerk unter `http://bgutil-provider:4416`. Der Dienst liefert Proof-of-Origin-Tokens für unterstützte Extraktionsanfragen. Er gewährt keinen Zugriff auf private Inhalte und garantiert keine Annahme durch die Quellplattform.

Prüfe `tale logs bgutil-provider` und die Erreichbarkeit vom Worker. Der Sidecar ist optional für den Start des Kernsystems: Sein Ausfall blockiert die Bereitstellung nicht, kann den Transkriptabruf aber beeinträchtigen.

`VIDEO_INGEST_POT_PROVIDER_URL` wählt einen anderen Anbieterendpunkt. `VIDEO_INGEST_PO_TOKEN` übergibt ein manuell beschafftes Token. Bewahre Tokens in deiner Geheimniskonfiguration auf. Die [Umgebungsreferenz](/de/self-hosted/configuration/environment-reference) beschreibt auch Extraktions-Client und Plugin-Optionen. Ändere sie passend zum beobachteten Fehler.

## Einen Egress-Proxy konfigurieren {#egress-proxy}

Videoabrufe laufen über die [ausgehenden Proxys](/de/self-hosted/configuration/environment-reference#outbound-proxies) des Deployments, sobald `OUTBOUND_PROXY_URLS` Proxys nennt. Ein Video behält für Metadaten, Untertitel und Audio denselben Proxy. Es beginnt auf dem Proxy, über den seine Plattform zuletzt ein Video ausgeliefert hat, sonst auf dem nächsten in der Reihe. Einen Proxy, über den die Plattform gerade ein Video ausgeliefert hat, lässt sie am ehesten wieder durch.

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

Setze `VIDEO_INGEST_PROXY_URL`, wenn Videoabrufe stattdessen über einen eigenen freigegebenen Proxy laufen sollen. Er ersetzt die ausgehenden Proxys nur für Videos, sodass die ausgehende Liste dann einen rotierenden Endpunkt behalten kann. Als einzelner Proxy wiederholt er keinen abgewiesenen Versuch. Unterstützt werden `http`, `https`, `socks4`, `socks4a`, `socks5` und `socks5h`; die letzte Variante löst DNS am Proxy auf.

```bash
VIDEO_INGEST_PROXY_URL=socks5h://proxy.example.com:1080
```

Ergänze erforderliche Zugangsdaten über deine Geheimnisverwaltung. Eine ungültige URL oder ein nicht unterstütztes Schema wird mit Warnung ignoriert, und der Abruf läuft wie ohne die Variable über die ausgehenden Proxys, falls es welche gibt. Prüfe deshalb die übernommene Konfiguration und einen echten Abruf. Erstelle den Worker nach Änderungen seiner Umgebung neu. Ein Neustart des bestehenden Containers liest eine geänderte `.env` nicht ein.

Ein anderer Netzwerkweg garantiert keinen Zugriff. Prüfe, ob Proxy und Quellkonto für die benötigten Inhalte verwendet werden dürfen. Bleibt die Quelle unerreichbar, importiere ein bereits vorliegendes Transkript als [Wissensdokument](/de/platform/knowledge/documents).

## Eine berechtigte Browsersitzung importieren

Der Server kann Cookies aus einem nach **Organisation und Domain** getrennten Sitzungspool beziehen. Er verschlüsselt Cookie-Dateien mit `ENCRYPTION_SECRET_HEX` und gibt sie in Listen nicht zurück. Der Pool gehört zum serverseitigen Videoimport und exportiert keine Cookies an Agentenskripte.

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
