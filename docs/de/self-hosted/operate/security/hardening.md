---
title: Eine Produktionsinstallation absichern
description: Schütze Hostzugriff, Netzwerk, Geheimnisse und Wiederherstellung, bevor du Tale für Benutzer öffnest.
---

Prüfe diese Schutzmaßnahmen vor dem Start und nach Änderungen an Host, Netzwerk oder Anmeldung. Du brauchst Betreiberzugriff und einen Wiederherstellungsweg, der auch während Änderungen an den Zugriffsregeln erreichbar bleibt.

## Den Hostzugriff beschränken

Nutze persönliche Betreiberkonten, SSH-Schlüssel und ein unterstütztes, aktuell gehaltenes Betriebssystem. Beschränke den Zugriff auf Host, Konfigurationsverzeichnis, Backups und Docker-Socket auf die zuständigen Betreiber.

Die Mitgliedschaft in der Gruppe `docker` gewährt über den Docker-Daemon Befugnisse auf Root-Ebene. Die CLI unter einem anderen Konto auszuführen hebt diese Befugnisse nicht auf. Behandle Docker-Zugriff als privilegierte Administration. Die [Docker-Dokumentation](https://docs.docker.com/engine/install/linux-postinstall/) erklärt diesen Zusammenhang.

## Die öffentliche Erreichbarkeit prüfen

Öffne die vorgesehenen Proxy-Ports und beschränke administrative Zugriffe auf vertrauenswürdige Quellen. Datenbank, Speicherverwaltung, interne Backend- und Sandbox-Dienste gehören nicht ins öffentliche Netz, sofern keine gesondert geprüfte Architektur das erfordert.

Prüfe die veröffentlichten Ports deiner tatsächlichen Compose-Konfiguration und teste die Erreichbarkeit von außerhalb des Hosts. Host-Firewallregeln allein können täuschen: Docker verwaltet eigene Regeln für Weiterleitung und veröffentlichte Ports. Beachte die [Docker-Hinweise zu Firewalls](https://docs.docker.com/engine/network/packet-filtering-firewalls/).

Bei Anmeldung über vertrauenswürdige Header darf nur der vorgelagerte Proxy die Anwendung erreichen. Er muss vom Aufrufer gelieferte Identitätsheader entfernen, bevor er eigene setzt. Mehr dazu unter [Authentifizierung](/de/self-hosted/configuration/authentication).

Die `robots.txt` der Plattform rät Crawlern von der Indexierung der Anwendung ab, erlaubt aber öffentliche Entwickler- und Statuspfade wie `/docs`, `/openapi.json`, `/llms.txt`, `/llms-full.txt` und `/status`. Diese Anweisungen ersetzen keine Zugriffskontrolle. Schütze vertrauliche Daten durch Authentifizierung und prüfe, welche Informationen dein öffentlicher Statusbericht zeigt.

## Entscheiden, ob sich Coding-Agents anmelden dürfen {#agent-sign-in}

Die [Anmeldung für Coding-Agents](/de/self-hosted/configuration/authentication#coding-agent-sign-in) lässt eine Person Claude Code, Codex, Cursor oder einen anderen Agent ohne API-Schlüssel mit dem MCP-Endpunkt verbinden, und sie ist eingeschaltet, solange du sie nicht abschaltest. Sie fügt öffentliche Flächen hinzu: die Discovery-Dokumente unter `/.well-known/oauth-*`, die Endpunkte `/api/auth/oauth2/*` des Anmeldeservers (darunter die ratenbegrenzte Selbstregistrierung) und die Seite zum Erlauben des Zugriffs unter `/oauth/consent`. Eine Verbindung darf nie mehr, als die Rolle ihrer Person erlaubt, gehört zu einer Organisation und dem Zugriff, den die Person gewählt hat, und jedes Verbinden, Ändern und Trennen steht im Audit-Log. Das Entfernen der Person, ein neues Passwort oder ein zweimal verwendetes Refresh-Token trennen sie.

Lässt du sie eingeschaltet, prüfe drei Dinge:

- **Erreichbarkeit.** Agents, die auf dem Computer einer Person laufen (Claude Code, Codex, Cursor, VS Code, Gemini CLI), erreichen Tale über den Browser dieser Person und eine Loopback-Weiterleitung. Sie brauchen keine Freigabe über die öffentliche Adresse hinaus, die Personen ohnehin öffnen. claude.ai, Claude Desktop und die mobile App verbinden sich dagegen aus der Cloud von Anthropic. Für sie erlaubst du eingehendes HTTPS aus dem veröffentlichten ausgehenden Adressbereich von Anthropic (derzeit `160.79.104.0/21`, siehe [IP-Adressen von Anthropic](https://platform.claude.com/docs/en/api/ip-addresses)) auf `/.well-known/oauth-protected-resource*`, `/.well-known/oauth-authorization-server*`, `/api/auth/.well-known/openid-configuration`, `/api/auth/oauth2/token`, `/api/auth/oauth2/register` und `/api/v1/mcp`. Eine Bereitstellung, die nur in einem privaten Netz erreichbar ist, lässt sich aus diesen gehosteten Apps nicht nutzen.
- **Ausgehender Verkehr.** Das Backend ruft das Client-Metadatendokument eines Agents vom Host des Agents ab, bei Claude Code von `claude.ai`, bei Codex von `chatgpt.com`. Beschränkst du den ausgehenden Verkehr des Backends, erlaube diese Hosts oder trage die Hosts, die du akzeptierst, in `TALE_MCP_CLIENT_METADATA_HOSTS` ein.
- **Wer sich verbinden darf.** Inhaber, Admins und Entwickler sowie Mitglieder mit einer Kompetenz, die zusammen mit einem API-Schlüssel genutzt wird. Die Person braucht eine bestätigte Adresse und, wo es erzwungen wird, eine abgeschlossene Zwei-Faktor-Einrichtung, und für mehr als Lesen muss die Anmeldung weniger als einen Tag zurückliegen. Prüfe, wer diese Rollen und Kompetenzen hat, wie bei API-Schlüsseln.

Willst du Agents bei API-Schlüsseln halten, setze `TALE_MCP_CLIENT_METADATA_DOCUMENTS=false` und `TALE_MCP_DYNAMIC_CLIENT_REGISTRATION=false` und erstelle das Backend neu.

## TLS an der öffentlichen Adresse prüfen

Nutze ein vertrauenswürdiges Zertifikat für die Adresse, die deine Benutzer öffnen. Wähle `TLS_MODE=letsencrypt` für den mitgelieferten öffentlichen TLS-Zugang oder `TLS_MODE=external`, wenn dein vorgelagerter Proxy TLS terminiert. Ein selbst signiertes lokales Zertifikat schafft kein öffentliches Zertifikatsvertrauen.

Prüfe Zertifikatskette, Ablaufdatum und Erneuerung. Teste danach Anmeldung und Rückleitungen über die öffentliche Adresse. Die Konfiguration erklärt [TLS und Domains](/de/self-hosted/configuration/tls-and-domains).

## Geheimnisse und Schlüssel schützen

Ersetze die Beispielwerte vor dem Produktivbetrieb. Jede Installation braucht ein eigenes Datenbankpasswort, eigene Authentifizierungsgeheimnisse und einen eigenen Verschlüsselungsschlüssel. Beschränke den Zugriff auf `.env` und Geheimnisdateien auf den Betreiber. Bewahre Wiederherstellungskopien in deiner Geheimnisverwaltung auf.

Nutze bei Bedarf [SOPS](/de/self-hosted/configuration/secrets-with-sops) für unterstützte Geheimnisdateien. SOPS verschlüsselt nicht sämtliche Anwendungsdaten oder die ganze Festplatte. Erhalte die passenden Schlüssel für aufbewahrte Backups. Plane Rotationen nach [Kryptografie](/de/self-hosted/operate/security/cryptography); ein beliebiger Schlüsseltausch kann Sitzungen ungültig machen oder gespeicherte Zugangsdaten unlesbar werden lassen.

Setze `TALE_AUDIT_PEPPER`, um Daten fehlgeschlagener Anmeldungen zu pseudonymisieren. Die Audit-Aufbewahrung gilt pro Organisation. Prüfe deren angewandte Regeln und den benötigten Nachweiszeitraum anhand der [Aufbewahrungsreferenz](/de/self-hosted/configuration/retention).

## Die Wiederherstellung erproben

Wähle Backup-Häufigkeit und Aufbewahrung danach, welchen Datenverlust deine Organisation verkraften kann. Sichere Datenbank, Konfiguration, Objektspeicher und die zur Wiederherstellung nötigen Geheimnisse. Externe Speicher benötigen eine eigene abgestimmte Sicherung.

Bewahre geschützte Kopien außerhalb des Deployment-Hosts auf und stelle sie regelmäßig an einem isolierten Ziel wieder her. Prüfe danach Anmeldung, Dateien und wichtige Abläufe. [Backups und Wiederherstellung](/de/self-hosted/operate/backups-and-restore) erklärt den Umfang der CLI-Snapshots und die Dienstunterbrechungen.

## Sandbox-Ziele begrenzen

Der Egress-Proxy der Sandbox erlaubt standardmäßig öffentliche HTTPS-Ziele und blockiert private Adressen sowie Metadatenadressen. Mit `SANDBOX_EGRESS_ALLOWLIST` begrenzt du zusätzlich die Hostnamen. Dieses Beispiel gehört in die `.env` des Projekts und erlaubt zwei Python-Pakethosts:

```dotenv .env
SANDBOX_EGRESS_ALLOWLIST=^pypi\.org$|^files\.pythonhosted\.org$
```

Erstelle den Egress-Dienst mit der geänderten Umgebung neu. Prüfe, ob benötigte Ziele erreichbar sind und ein nicht aufgeführtes Ziel abgelehnt wird. Ergänze weitere Registries oder Quellcode-Hosts nur bei Bedarf. Die integrierten Dokument-Skills brauchen keine, um Word-, PowerPoint-, Excel- und PDF-Dateien zu erstellen und zu lesen, denn ihre Bibliotheken sind im Sandbox-Image enthalten. Texterkennung (OCR) für gescannte PDFs ist nicht enthalten. Modellanfragen laufen über das getrennte Modell-Gateway der Sandbox. Die Liste regelt daher nicht alle ausgehenden Verbindungen von Tale.

Prüfe Freigaben privater Netze getrennt. `TALE_ALLOW_PRIVATE_PROVIDER_HOSTS=1` erlaubt Modellanbieterziele einschließlich des Sandbox-Modellgateways, öffnet aber keinen allgemeinen Sandbox-Netzzugriff. `TALE_ALLOW_PRIVATE_CRAWL_HOSTS=1` erlaubt Intranet-Crawl-Ziele und private Produktbild-URLs. Aktiviere nur den benötigten Zugriff und behalte die Konfiguration unter Betreiberkontrolle. [Anbieter](/de/self-hosted/configuration/providers) beschreibt die Modellprüfungen; die [Umgebungsreferenz](/de/self-hosted/configuration/environment-reference) unterscheidet beide Variablen.

## Überwachen und untersuchen

Richte mit `METRICS_BEARER_TOKEN` authentifizierten Metrikzugriff ein und verbinde deine Überwachung. Prüfe, ob eine Warnung den zuständigen Betreiber erreicht. [Betriebsüberwachung](/de/self-hosted/operate/observability/operations) beschreibt hilfreiche Signale.

Ein täglicher Job prüft die erhaltenen Audit-Zeilen schrittweise und meldet erkannte Hash-Brüche an Admins. **Jetzt prüfen** unter **Einstellungen > Richtlinien > Protokolle > Ketten-Integrität** prüft höchstens 1.000 Einträge. Grenzen und Beweissicherung erklärt [Audit-Protokollintegrität](/de/self-hosted/operate/security/audit-log-integrity).

## Die bereitgestellte Antwort prüfen

Prüfe die Sicherheitsheader an der öffentlichen Adresse nach Proxy-Änderungen. Ein Proxy kann die von Tale gelieferten Header verändern; die Quellkonfiguration allein reicht als Nachweis nicht aus. Prüfe die Content-Security-Policy, Einbettungsbeschränkungen, HTTPS-Transportregeln und Inhaltstypbehandlung sowie den tatsächlichen Anmeldeablauf.

Übernimm Regeln für Cross-Origin-Isolation oder HSTS-Preload nicht ungeprüft von einer anderen Installation. Berücksichtige Rückleitungen, externe Dateien und Subdomains. Bewahre die Ergebnisse beim Deployment-Protokoll auf und wiederhole die Prüfung nach Upgrades.
