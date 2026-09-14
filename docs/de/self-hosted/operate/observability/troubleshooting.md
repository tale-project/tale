---
title: Fehler einer selbst gehosteten Instanz beheben
description: Beginne bei der fehlerhaften Aktion, prüfe den zuständigen Dienst und stelle den Betrieb ohne vorschnelles Löschen wieder her.
---

Halte Zeitpunkt, betroffene Organisation, URL oder Aktion und Fehlercode fest, bevor du etwas neu startest. Prüfe, ob ein einzelner Eintrag, eine Organisation oder die gesamte Bereitstellung betroffen ist. Davon hängt ab, ob du eine Datei, eine Organisationsverbindung oder gemeinsame Infrastruktur untersuchst.

Beginne bei einer Workspace-Bereitstellung mit `tale status` und `tale logs <service> --tail 200`. In deinem eigenen Compose-Projekt verwendest du `docker compose ps` und `docker compose logs --tail=200 <service>`. Dienstnamen wie `platform` und `backend-api` unterscheiden sich von erzeugten Containernamen.

## Öffentliche URL, Zertifikat oder Anmeldung scheitert

| Symptom | Prüfung | Nächster Schritt |
| --- | --- | --- |
| Verbindung scheitert oder TLS warnt | DNS, öffentliche Ports, Hostname und Aussteller des Zertifikats, Proxy-Protokolle. | Behebe die betroffene Ebene. Installiere bei einer internen CA das öffentliche Stammzertifikat auf dem Client; `docker exec ... caddy trust` ändert dessen Vertrauensspeicher nicht. |
| Proxy antwortet mit 502/503 | Ermittle Pfad und Zieldienst. `/api/health` und Webdateien nutzen `platform`, Anwendungsanfragen `backend-api`. | Prüfe Startfehler und Bereitschaft des Dienstes vor Änderungen am Proxy. |
| `400 BODY_LENGTH_MISMATCH` oder `400 BODY_CHUNK_MALFORMED` | Der Anfragekörper endet vor seiner angegebenen Länge oder enthält fehlerhafte HTTP/1.1-Chunk-Grenzen. | Korrigiere Längenangabe oder Übertragungsformat beim Sender und wiederhole dann die korrekt formatierte Anfrage. |
| Anmeldung führt zurück zur Anmeldeseite | Cookies und Callback-Anfragen im Browser; `SITE_URL`, weitere Ursprünge, Basispfad und Anbieterregistrierung. | Korrigiere Ursprung oder Callback und erstelle Dienste nach Umgebungsänderungen neu. |

Eine ladende Oberfläche ohne Daten deutet zunächst auf Anwendungsanfragen, nicht zwingend auf den Webserver. Prüfe fehlgeschlagene Browseranfragen und `backend-api`-Protokolle. Proxy, abgelaufene Sitzung, fehlende Rechte und Backend-Ausfall brauchen unterschiedliche Lösungen. [TLS und Domains](/de/self-hosted/configuration/tls-and-domains) sowie [Authentifizierung](/de/self-hosted/configuration/authentication) erklären die Einrichtung.

## Uploads oder Downloads scheitern

Vergleiche zuerst die Serverantwort mit der Browseranfrage an die vorsignierte URL. Ist nur eine Organisation betroffen, kann ihre eigene Speicherverbindung die Ursache sein, obwohl der Standard-Bucket erreichbar ist.

| Beobachtung | Bedeutung und Reaktion |
| --- | --- |
| `object store (skipped)` beim Start | Das Standard-Zugangsdatenpaar fehlt. Prüfe `OBJECT_STORE_ACCESS_KEY` und `OBJECT_STORE_SECRET_KEY`. Erzeuge für einen vorhandenen Speicher keine Ersatzwerte, ohne dessen Zugangsdaten abzustimmen. |
| `object store (ignored)` | Die Datei wird vom Betreiber verwaltet. Prüfe `default/object-storage/connection.json`; der Umgebungsabgleich lässt sie bewusst unverändert. |
| `seeded` oder `reconciled` | Die Standardverbindung wurde aus der Umgebung geschrieben oder aktualisiert. Das beweist keine vollständigen Objektrechte oder funktionierende Browserroute. |
| Speicherprüfung meldet Ausfall | Prüfe Endpunkt, Verbindung, Zugangsdaten, Bucket-Existenz und den genauen Backend-Fehler. |
| Server-Verbindungstest besteht, Browser-Upload scheitert | Prüfe öffentlichen Endpunkt, Zertifikatsvertrauen und Bucket-CORS für den tatsächlichen Browser-Ursprung. Erlaube die für den Dateifluss nötigen Methoden `GET`, `PUT` und `HEAD`. |

`tale_backend_store_up` erfasst Bereitstellungsstandards und misst Erreichbarkeit, keinen vollständigen Upload. Ein Objektspeicher-`403` kann trotzdem den Wert `1` ergeben. Prüfe nach der Korrektur einen kontrollierten Upload und Download. [Datenresidenz](/de/self-hosted/configuration/data-residency) erklärt Verbindungsänderungen und Dateiumzug.

## Ein Dokument wird nicht indexiert

Prüfe Status und Fehlergrund des Dokuments, dann die `backend-worker`-Protokolle. Kontrolliere Embedding-Modell und Zugangsdaten der Organisation, Vektordimensionen, Wissensdatenbankverbindung und Dateiformat. Ein erfolgreicher Upload belegt nur, dass die Originaldatei gespeichert wurde.

War ein Worker oder eine Abhängigkeit ausgefallen, stelle sie wieder her und prüfe, ob der Job weiterläuft oder **Jetzt indexieren** unter [Wissen](/de/platform/knowledge/documents) nötig ist. Bei beschädigten, verschlüsselten oder nicht unterstützten Dateien korrigierst du die Quelle vor einem neuen Versuch. Lösche ein Dokument nicht als ersten Diagnoseschritt: Identität, Verlauf und Referenzen können wichtig sein.

## Ein Website-Scan meldet einen Zertifikatsfehler

Der Crawl-Fehler `tls_error` bezeichnet einen gescheiterten TLS-Verbindungsaufbau, etwa wegen eines abgelaufenen Zertifikats, eines falschen Hostnamens oder einer nicht vertrauenswürdigen Zertifikatskette. Korrigiere das Website-Zertifikat oder die Vertrauenseinstellungen der Crawler-Laufzeit und starte danach einen neuen Scan. Dieselbe Anfrage erneut zu senden repariert kein Zertifikatsvertrauen. Deaktiviere die Zertifikatsprüfung nicht, um den Fehler zu verdecken.

`network_error` weist dagegen auf einen Verbindungsfehler hin. Lies die zugrunde liegende Ursache und prüfe DNS, Routing und Verfügbarkeit des Dienstes. [Websites crawlen](/de/platform/knowledge/crawling) erklärt Seitenfehler und Scan-Ergebnisse.

## Wissens-Postgres stürzt beim Import ab

Wiederholte Meldungen `PANIC: corrupted page pointers` oder `signal 6` können auf einen beschädigten BM25-Index hinweisen. Prüfe Datenbankprotokolle und das Ergebnis der automatischen Reparatur unter [Container-Architektur](/de/self-hosted/operate/container-architecture). Ermittle die genaue Korpusdatenbank: Im mitgelieferten Stack ist es `tale_knowledge` in `db`; andere Bereitstellungen verwenden einen separaten Dienst oder externen Host.

Diese Abfrage in einer berechtigten SQL-Sitzung auf der richtigen Datenbank prüft nur den genannten Index:

```sql
SELECT * FROM pdb.verify_index('private_knowledge.idx_pk_chunks_bm25');
```

Eine fehlende Funktion, ein Rechtefehler oder ein Timeout bestätigt keinen Indexschaden. Ist der Schaden belegt und die automatische Reparatur erfolglos, sichere den Zustand und plane eine Datenbankwartung. Einen abgeleiteten Index neu aufzubauen ist etwas anderes als Dokumenttabellen zu löschen:

```sql
REINDEX INDEX private_knowledge.idx_pk_chunks_bm25;
```

Dieser nicht nebenläufige Befehl kann Arbeit blockieren. Stimme ihn mit dem Datenbankbetrieb ab, prüfe danach den Index erneut und kontrolliere den Import. Führe keine spekulativen Index- oder Erweiterungsbefehle in der falschen Datenbank aus. Wiederkehrende Schäden erfordern die Prüfung von Plattenzustand und erzwungenen Stopps nach Ablauf der Wartezeit.

## Chat oder Automatisierung stoppt

Prüfe den Chat- oder Lauf-Fehler und die zuständigen API-/Worker-Protokolle. Anbieter-`429`, verweigerte Zugangsdaten, Ausführungs-Timeout, ausstehende Freigabe und unterbrochener Browser-Stream sind verschiedene Zustände. Eine Freigabe braucht eine Entscheidung, keinen Neustart. Hinter einem getrennten Stream kann die Operation weiterlaufen; prüfe ihr gespeichertes Ergebnis vor einer Wiederholung.

Kontrolliere bei Anbieterfehlern Kontingent und Rechte der gewählten Zugangsdaten sowie den Anbieterstatus. Wechsle Modelle nur, wenn der Ersatz erlaubt und für die Aufgabe geeignet ist. Prüfe bei Harness-Fehlern `sandbox`, `sandbox-llm-gateway`, Laufzeit-Image und Sitzungsprotokolle.

## Sandbox-Netzzugriff wird verweigert

Prüfe `sandbox-egress` und die Ziel-URL. Eine konfigurierte `SANDBOX_EGRESS_ALLOWLIST` muss den benötigten Hostnamen enthalten; private Ziele und Cloud-Metadaten bleiben blockiert. Für HTTPS-Tunnel gilt die unterstützte Portregel. Bestätige das gewünschte Ziel, bevor du eine Freigabeliste erweiterst. Erstelle den Egress-Dienst nach Umgebungsänderungen neu.

Ein gesunder Egress-Prozess belegt nicht die Verfügbarkeit von Gegenstelle, DNS, Zertifikat oder Konto. Bewahre den konkreten Anfragefehler im Störungsbericht auf.

## Schreibzugriffe scheitern oder Speicher läuft voll

Prüfe Datenbankverbindung, freien Platz, Verbindungsbelegung und Sperren. Stoppe vermeidbares Wachstum und stelle Kapazität nach deinem Datenbankverfahren wieder her. Lösche keine Volume-Inhalte, setze keine Verschlüsselungsschlüssel zurück und erwarte keine automatische Wiederholung fehlgeschlagener Schreibzugriffe. Prüfe vor einem erneuten Versuch, ob die ursprüngliche Operation bereits gespeichert wurde.

Gib bei einer Hilfsanfrage Versionen, bereinigte Fehler, Zeitraum, betroffenen Umfang und Reproduktionsschritte an. `tale diagnostics` erstellt ein Diagnosepaket. Prüfe es vor dem Teilen, denn Bereitstellungsdetails können weiterhin sensibel sein. Reproduzierbare Fehler gehören in den [Issue-Tracker des Projekts](https://github.com/tale-project/tale/issues).
