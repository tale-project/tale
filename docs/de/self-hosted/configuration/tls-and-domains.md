---
title: TLS und Domains
description: Wähle die Zertifikatsverwaltung, richte öffentliche Ursprünge ein und prüfe Browser- und SSO-Zugriffe nach einem Domainwechsel.
---

Lege vor der Anmeldungskonfiguration und vor Einladungen fest, welche URL Nutzer öffnen und welcher Dienst TLS beendet. Tales Caddy-Proxy kann eine interne Zertifizierungsstelle nutzen, öffentliche Zertifikate beziehen oder HTTP hinter deinem eigenen TLS-Proxy bereitstellen.

## TLS-Modus wählen

| `TLS_MODE` | Geeignet für | Deine Aufgabe |
| --- | --- | --- |
| `selfsigned` | Lokale Entwicklung oder private Umgebungen, deren Clients deiner CA vertrauen. | Caddys Stammzertifikat in den Vertrauensspeicher jedes Clients aufnehmen. |
| `letsencrypt` | Einen öffentlichen Hostnamen über Tales Proxy. | Öffentliches DNS, erreichbare Ports 80/443 und dauerhaften Caddy-Zertifikatsspeicher bereitstellen. |
| `external` | Einen vorgeschalteten Load-Balancer oder Reverse-Proxy mit TLS. | Dessen Zertifikat, vertrauenswürdige Weiterleitung und private HTTP-Verbindung zu Tale betreiben. |

`SITE_URL` bleibt die öffentliche URL, `HOST` ihr Hostname. Neue Umgebungswerte erfordern das Neuerstellen betroffener Dienste. Nutze bei der Workspace-CLI den Bereitstellungsablauf und `--stop`, wenn der Proxy neu erstellt werden muss. Prüfe die Vorschau und plane die Unterbrechung ein. In deiner eigenen Compose-Datei heißt der Dienst `proxy`, nicht wie der erzeugte Container.

## Einem privaten Entwicklungszertifikat vertrauen

Mit `TLS_MODE=selfsigned` stellt Caddy Zertifikate seiner internen CA aus. Eine Browserwarnung kann bedeuten, dass der Client dieser CA nicht vertraut oder der Hostname nicht passt. Prüfe beides.

Kopiere das **öffentliche Stammzertifikat** aus dem laufenden Proxy-Container. Setze `TALE_PROXY_CONTAINER` auf dessen tatsächlichen Namen:

```bash
docker cp "$TALE_PROXY_CONTAINER:/data/caddy/pki/authorities/local/root.crt" ./tale-local-root.crt
```

Prüfe die Herkunft aus deiner eigenen Instanz. Installiere es dann auf jedem benötigten Client über die Zertifikatseinstellungen des Betriebssystems oder Browsers. Verteile niemals den privaten CA-Schlüssel. `caddy trust` über `docker exec` ändert den Vertrauensspeicher des Containers, nicht den deines Arbeitsplatzrechners. [Caddys Anleitung für lokales HTTPS](https://caddyserver.com/docs/automatic-https#local-https) erklärt diese Grenze.

## Ein öffentliches Zertifikat beziehen

1. Richte die öffentlichen DNS-Einträge auf den vorgesehenen Host. Prüfe bei IPv6 sowohl A- als auch AAAA-Einträge.
2. Mache Ports 80 und 443 an diesem Proxy erreichbar und erhalte sein Volume `caddy-data` beim Ersetzen.
3. Konfiguriere öffentliche URL und Zertifikatsmodus:

```bash
HOST=tale.example.com
SITE_URL=https://tale.example.com
TLS_MODE=letsencrypt
TLS_EMAIL=ops@example.com
```

4. Übernimm die Konfiguration, prüfe `tale logs proxy` und öffne die öffentliche URL von einem anderen Rechner. Kontrolliere Hostname und Zertifikatskette im Browser.

Caddy übernimmt Ausstellung und Erneuerung. DNS-, Firewall-, ACME- oder Speicherprobleme können beides verzögern oder verhindern. Überwache daher Ablaufdatum und Proxy-Fehler, statt eine feste Ausstellungsdauer anzunehmen. `TLS_EMAIL` ist die ACME-Kontaktadresse und ersetzt keine Ablaufüberwachung. [Caddys HTTPS-Voraussetzungen](https://caddyserver.com/docs/automatic-https) beschreiben die öffentlichen Netzwerkbedingungen.

## Einen vorgeschalteten TLS-Proxy oder ein eigenes Zertifikat verwenden

Setze `TLS_MODE=external`, wenn ein anderer Proxy TLS beendet. Behalte die öffentliche HTTPS-URL bei:

```bash
HOST=tale.example.com
SITE_URL=https://tale.example.com
TLS_MODE=external
```

Tales Caddy-Instanz stellt in diesem Aufbau intern HTTP bereit. Halte diese Verbindung privat, erhalte den vorgesehenen Host und akzeptiere weitergeleitete Client-Informationen nur von vertrauenswürdigen Proxys. Prüfe Anmeldung, sichere Cookies, Uploads und Streaming über den vollständigen Weg. Ein Zertifikat auf dem vorgeschalteten Proxy ist unabhängig von Tales TLS-Modus.

Wenn du stattdessen ein eigenes Tale-Proxy-Image mit eigener Caddyfile verwaltest, binde Zertifikat und privaten Schlüssel nur lesbar ein und konfiguriere Caddys Direktive `tls <cert-file> <key-file>`. Ein Mount oder `TLS_MODE=external` allein lädt die Dateien nicht. Die eigene Konfiguration muss Tales Routen, Zustandsprüfungen und Metrikschutz erhalten.

## Öffentliche Domain oder Basispfad ändern

Ändere `HOST` und `SITE_URL` gemeinsam. Prüfe auch öffentliche Speicherendpunkte und Callback-Registrierungen beim Identitätsanbieter, die den alten Ursprung verwenden. Erstelle betroffene Anwendungs- und Proxy-Dienste neu. Teste anschließend Anmeldung, Download einer vorhandenen Datei, Upload und eine live aktualisierte Seite unter der neuen URL.

Bei einem verwalteten Deployment mit `identity.bootstrap: "fresh"` gehört die [Migration des verwalteten Hostnamens](/de/self-hosted/install/cli-install#managed-origin-migration) zu diesem Wechsel. Sie benötigt den gespeicherten Deployment-Zustand und ein ausdrückliches `identity.migrateOriginFrom`. Nur `HOST` und `SITE_URL` zu ändern aktualisiert die verwalteten Identitäts- und Client-Journale nicht. Behalte Konto, Organisation und Client-Zugangsdaten bei und exportiere nach dem abgeschlossenen Deployment die Client-Konfiguration für den neuen Issuer.

Setze für einen Unterpfad wie `https://example.com/app` zusätzlich `BASE_PATH=/app`. Erhalte dieses Präfix bei Anfragen an Tales Proxy: Seine erzeugten Routen entfernen es intern. Prüfe absolute Links und Callbacks, nicht nur die Startseite. Halte bei einem geplanten Übergang die alte Domain erreichbar, solange Nutzer deren Links oder Sitzungen benötigen.

## Mehrere Domains bedienen {#mehrere-domains-gleichzeitig}

Trage zusätzliche reine Ursprünge, durch Komma oder Leerraum getrennt, in `ADDITIONAL_SITE_URLS` ein:

```bash
HOST=tale.example.com
SITE_URL=https://tale.example.com
ADDITIONAL_SITE_URLS=https://tale.partner.example,https://app.example.org
```

Ein Ursprung besteht aus Schema, Host und optionalem Port, aber keinem Pfad. Caddy bedient diese Ursprünge und fordert im Modus `letsencrypt` öffentliche Zertifikate an. Richte DNS und Erreichbarkeit für jeden ein. Es sind eigene Einstiegspunkte; Cookies gelten für die Domain der jeweiligen Anmeldung.

Beim Ableiten öffentlicher URLs akzeptiert Tale nur konfigurierte Ursprünge. Ein unbekannter Host fällt auf `SITE_URL` zurück. Verwende diesen Rückfall nicht als Ersatz für die Domainkonfiguration.

### Kanonische Einstellungen stabil halten

| Einstellung | Warum die Hauptdomain wichtig ist |
| --- | --- |
| E-Mail-Links und Benachrichtigungen | Hintergrundarbeit hat keinen Browser-Ursprung. |
| SAML-SP-Entity-ID | Der Identitätsanbieter kennt einen stabilen Dienstanbieter. |
| SCIM-Ressourcenadressen | Verzeichnissynchronisierung braucht stabile URLs. |
| Passkeys | Zugangsdaten sind an eine Relying-Party-Domain gebunden und wechseln nicht automatisch zwischen Domains. |
| Öffentlicher Objektspeicher-Endpunkt | Vorsignierte URLs nutzen dessen konfigurierten Ursprung; prüfe ihn beim Domainwechsel. |

### Alle Anbieter-Callbacks registrieren

Kopiere unter **Einstellungen > Enterprise-SSO** die OIDC-Weiterleitungs- oder SAML-ACS-URL jeder Domain. Die SAML-Metadaten enthalten die konfigurierten ACS-Einträge. Für Konnektoren findest du die Weiterleitungs-URLs je Domain unter **Einstellungen > Connectors > OAuth-Apps**. Registriere die benötigten URLs bei jedem Anbieter und teste eine neue Anmeldung von jedem unterstützten Ursprung.
