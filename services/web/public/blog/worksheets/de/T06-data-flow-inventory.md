# Datenflussverzeichnis für den KI-Betrieb

Kopiere dieses Arbeitsblatt für eine konkrete Bereitstellungskonfiguration. Trenne beobachtete Tatsachen von geplanter Konfiguration. „Nicht beobachtet“ bedeutet, dass ein Test einen Datenfluss nicht gesehen hat. Es belegt nicht, dass dieser nicht auftreten kann. Alle Zeilen beginnen ungeprüft.

## Bereitstellung und Entscheidung

| Feld | Eintrag |
| --- | --- |
| Entscheidungsverantwortung und Betrieb | Nicht zugewiesen |
| Installation/Version/Datum/Zeitzone | Nicht erfasst |
| Ablage des Konfigurationsstands ohne Secrets | Nicht erfasst |
| Vorgesehene Teamaufgaben und Datenklassen | Nicht vereinbart |
| Orte für Anwendung/Inferenz/Embeddings | Nicht erfasst |
| Erforderliche Standort-/Zugriffs-/Aufbewahrungsgrenzen | Nicht vereinbart |
| Aktuelle Modell- und Tool-Kennungen | Nicht erfasst |
| Pilotaufgabe mit fiktiven Eingaben | Nicht ausgewählt |

## Ausgefüllte Entscheidung zur Grenze – fiktiv

Aufgabe: Öffentliche Lieferanten mit einem internen Anforderungsbriefing vergleichen. Angenommene Regel: Briefing und abgeleitete Passagen müssen innerhalb einer kontrollierten Umgebung bleiben; öffentliche Lieferanteninformationen dürfen extern abgerufen werden. Das ist eine beispielhafte Organisationsregel, keine Vorschrift oder Tale-Standardeinstellung.

| Weg | Einstufung des Inhalts | Entscheidung | Grund |
| --- | --- | --- | --- |
| Briefing zu Extraktion und Speicherung | Intern | Interne Dienste | Abgeleiteter Text enthält weiterhin geschütztes Material |
| Text zum Embedding-Endpunkt | Intern | Genehmigter interner Endpunkt | Auch die Indexerstellung kann Daten offenlegen |
| Gemischtes Briefing und öffentliche Passagen zur Generierung | Intern | Interne Inferenz | Öffentliche Ergänzungen stufen das Briefing nicht neu ein |
| Lieferantensuche des Agenten | Nur öffentliche Suchbegriffe | Öffentliches Ziel für diese Aufgabe erlaubt | Interne Anforderungen dürfen nicht in die Anfrage kopiert werden |
| Fehlerberichte | Möglicherweise intern | Felder prüfen oder externe Berichte deaktivieren | Ablaufspuren erfolgreicher Aufgaben erproben diesen Weg nicht |

Die Auswahl ändert sich, wenn die Organisation einen bestimmten externen Verarbeiter für die internen Inhalte erlaubt. Dokumentiere Regelverantwortung und genehmigte Änderung, bevor du Routing oder Ersatzwege anpasst.

## Kostenentscheidung nachrechnen – fiktive US-Dollar-Werte

Dies sind erfundene Annahmen, keine Preise, gemessene Arbeit oder Benchmark-Ergebnisse. Umfang: zusätzlicher Inferenzbetrieb für dieselben Aufgaben. Der Vergleich setzt voraus, dass die Organisation einen bestimmten gehosteten Verarbeiter für interne Inhalte genehmigt hat. Beide Optionen erfüllen damit die Datengrenze. Unter der vorherigen Regel „nur intern“ bleibt gehostete Inferenz unabhängig von ihren geschätzten Kosten unzulässig. Gemeinsame Arbeitsbereichskosten bleiben außen vor. Ergänze für eine echte Entscheidung abweichende Lizenz-, Support-, Netzwerk-, Speicher- und Personalkosten.

Definiere **N** als eigenständige gestartete Aufgaben, einschließlich Fehlschlägen und Zeitüberschreitungen. **a** ist der Anteil mit abgenommenem Ergebnis nach der erlaubten Wiederholungs-/Korrekturregel. Zähle ein Ergebnis einmal. **v** umfasst angenommene variable Verarbeitung, sämtliche Wiederholungen sowie Prüf-/Korrekturarbeit je gestarteter Aufgabe. **F** umfasst zugerechnete feste Kapazität, Betriebsarbeit und Wiederherstellungsvorsorge. Zähle Arbeit in F und v nicht doppelt.

| Eingabe oder Rechnung | Selbst betrieben | Gehostet |
| --- | ---: | ---: |
| F pro Monat | 2.600 USD | 200 USD |
| Angenommene Verarbeitung/Wiederholungen je gestarteter Aufgabe | 0,10 USD | 0,80 USD |
| Angenommene Prüfung/Korrektur: 2 Min. × 60 USD/Stunde je gestarteter Aufgabe | 2,00 USD | 2,00 USD |
| Gesamtes v je gestarteter Aufgabe | 2,10 USD | 2,80 USD |
| N | 5.000 | 5.000 |
| a | 0,90 | 0,90 |
| Erfasste Kosten = F + v × N | 13.100 USD | 14.200 USD |
| Abgenommene Ergebnisse = a × N | 4.500 | 4.500 |
| Erfasste Kosten / abgenommenes Ergebnis | 2,91 USD | 3,16 USD |

Bei gleicher Abnahmequote und ausreichender fester Kapazität liegt der Schnittpunkt bei `(2600 − 200) / (2.80 − 2.10) ≈ 3429` Aufgaben pro Monat. Bei N = 1.000 betragen die Gesamtkosten 4.700 und 3.000 USD. Bei N = 5.000, aber einer selbst betriebenen Abnahmequote a = 0,65, liegen deren Kosten bei `13100 / 3250 ≈ 4.03` USD je abgenommenem Ergebnis. Die Empfehlung kehrt sich um. Die Rechnung hält andere Annahmen konstant; tatsächliche Nacharbeit oder zusätzliche Hardware können die Kosten ebenfalls verändern.

Ersetze für deine Entscheidung jede Eingabe durch einen beobachteten Wert oder eine gekennzeichnete Schätzung und verweise auf den Beleg. Dokumentiere einen Unsicherheitsbereich; unbekannte Kosten sind nicht null. Ist a × N gleich null, sind Kosten je abgenommenem Ergebnis nicht definiert: Berichte Kosten mit null Abnahmen. Rechne nie über die getestete Kapazität hinaus, ohne das Kostenmodell anzupassen.

| Deine Annahme | Option A | Option B | Beleg/Schätzung und Unsicherheit |
| --- | --- | --- | --- |
| Monatlicher fixer Umfang und F | Nicht geschätzt | Nicht geschätzt | Nicht erfasst |
| Abdeckung variabler Kosten und v | Nicht geschätzt | Nicht geschätzt | Nicht erfasst |
| N und Ankunfts-/Parallelitätsmuster | Nicht geschätzt | Nicht geschätzt | Nicht erfasst |
| Abnahmeregel, Wiederholungsgrenze und a | Nicht gemessen | Nicht gemessen | Nicht erfasst |
| Spitzenlastfrist bei dieser Kapazität eingehalten? | Nicht getestet | Nicht getestet | Nicht erfasst |
| Kosten- oder Qualitätsänderung, die die Auswahl umkehrt | Nicht berechnet | Nicht berechnet | Nicht erfasst |

## Übung zu Wiederherstellungsabhängigkeiten – fiktiv, nicht ausgeführt

Nimm an, die Datenbank ist auf 10:05 Uhr wiederherstellbar, das Datei-Backup auf 10:00 Uhr, und ein Bericht wurde um 10:03 Uhr hochgeladen. Der wiederhergestellte Eintrag könnte auf fehlende Dateiinhalte zeigen. Eine laufende Anwendung genügt nicht als Abnahmenachweis.

Erwartete Reaktion: Datenverkehr und geplante Aktionen in der isolierten Wiederherstellungsumgebung angehalten lassen, vorhandenen Zustand sichern und eine passende Objektversion oder einen vollständigen abgestimmten Wiederherstellungssatz finden. Stammt der letzte brauchbare Satz von 10:00 Uhr, dokumentiere ausdrücklich, welche spätere Arbeit separat wiederhergestellt oder als verloren akzeptiert werden muss. Unterstelle nicht, dass eine neuere Datenbank, Neuindizierung oder ein aktuelles Anwendungsimage fehlende Dateiinhalte repariert.

| Wiederherstellungsabhängigkeit | Zu erhebende Belege | Status |
| --- | --- | --- |
| Anwendungs- und Wissenszustand | Backup-Kennungen und abgestimmter Wiederherstellungszeitpunkt | Nicht erhoben |
| Originaldateien und generierte Berichte | Objektversionen und Download einer Beispieldatei | Nicht erhoben |
| Konfiguration, Schlüssel, Gateway-Zustand, passende Anwendungsversion | Verweise auf geschützte Kopien; keine Schlüsselwerte | Nicht erhoben |
| Bei Bedarf erhaltener Agentenzustand | Separater Wiederherstellungsplan für Sandbox-Arbeitsbereiche | Nicht erhoben |
| Nutzbarer Dienst | Anmeldung, altes Projekt/Datei, kontrollierte Suche und Prüfung der Zugangsdaten | Nicht ausgeführt |
| Wiederherstellungsziel | Verlorenes Datenintervall und Zeit bis zum abgenommenen Dienst | Nicht gemessen |

Eine isolierte Übung muss Produktionsbenachrichtigungen und schreibende Tool-Aktionen vermeiden. Könnte eine frühere Aktion vor dem Fehler abgeschlossen worden sein, gleiche sie vor einer Wiederholung im empfangenden System ab.

## Zielverzeichnis

Kopiere eine Zeile, wenn ein Datenfluss mehrere Ziele hat. Speichere Verweise auf Secrets oder deren verantwortliche Personen, niemals geheime Werte, in diesem Arbeitsblatt.

| Datenfluss | Tatsächlicher Host/Dienst und Betreiber | Inhalt | Standort-/Regionsbeleg | Zugriffsidentität | Aufbewahrungs-/Backup-Verantwortung | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Browser zur Anwendung | Nicht erfasst | Konto- und Aufgabenanfragen | Nicht geprüft | Nicht erfasst | Nicht erfasst | Ungeprüft |
| Anwendungseinträge | Nicht erfasst | Nutzer, Aufgaben, Chats, Läufe | Nicht geprüft | Nicht erfasst | Nicht erfasst | Ungeprüft |
| Original-/generierte Dateien | Nicht erfasst | Quelldateien und Ergebnisse | Nicht geprüft | Nicht erfasst | Nicht erfasst | Ungeprüft |
| Wissensspeicher | Nicht erfasst | Extrahierter Text, Embeddings, Indizes | Nicht geprüft | Nicht erfasst | Nicht erfasst | Ungeprüft |
| Embedding-Dienst | Nicht erfasst | Ausgewählter Quelltext und Abfragen | Nicht geprüft | Nicht erfasst | Nicht erfasst | Ungeprüft |
| Generierungsdienst über Gateway | Nicht erfasst | Prompts, Kontext, Tool-Ergebnisse | Nicht geprüft | Nicht erfasst | Nicht erfasst | Ungeprüft |
| Direkte Laufzeit-/Anbieteraufrufe einschließlich Abonnements | Nicht erfasst | Prompts, Kontext, Tool-Ergebnisse außerhalb des Gateway-Routings | Nicht geprüft | Nicht erfasst | Nicht erfasst | Ungeprüft |
| Web-/Tool-Verkehr der Sandbox | Nicht erfasst | URLs, Abfragen, ausgewählte Inhalte | Nicht geprüft | Nicht erfasst | Nicht erfasst | Ungeprüft |
| Backend-Connectors | Nicht erfasst | Aktionsspezifische Ein-/Ausgaben | Nicht geprüft | Nicht erfasst | Nicht erfasst | Ungeprüft |
| Moderation | Nicht erfasst | Zur Prüfung ausgewählter Text | Nicht geprüft | Nicht erfasst | Nicht erfasst | Ungeprüft |
| Fehlerberichte/Analysen | Nicht erfasst | Aktivierte Ereignisfelder | Nicht geprüft | Nicht erfasst | Nicht erfasst | Ungeprüft |
| Backups und Kopien | Nicht erfasst | Abgestimmte Wiederherstellungsdaten | Nicht geprüft | Nicht erfasst | Nicht erfasst | Ungeprüft |
| Updates/Modelldownloads | Nicht erfasst | Images, Pakete, Modelldateien | Nicht geprüft | Nicht erfasst | Nicht erfasst | Ungeprüft |

## Kontroll- und Beobachtungsnachweis

| Feld | Eintrag |
| --- | --- |
| Geprüfter Datenfluss und ausführender Prozess | Nicht erfasst |
| Erlaubtes Ziel und Grund | Nicht erfasst |
| Beschränkungsmechanismus und Konfiguration | Nicht erfasst |
| Testziel, das abgelehnt werden soll | Nicht erfasst |
| Beginn/Ende der Beobachtung | Nicht erfasst |
| Instrument und Belegablage | Nicht erfasst |
| Tatsächliches Ergebnis: erlaubt/abgelehnt/nicht entscheidbar | Nicht bewertet |
| Für die Beobachtung unsichtbarer Bereich | Nicht erfasst |
| Prüfung und Nachverfolgung | Nicht zugewiesen |

Teste nur Systeme, zu deren Prüfung du befugt bist, und verwende harmlose fiktive Anfragen. Wähle für Ablehnungstests ein kontrolliertes Ziel. Sende keine sensiblen Inhalte nur zum Nachweis, dass ein Endpunkt sie annimmt.

## Abnahmeprüfungen

| Kennung | Prüfung | Status |
| --- | --- | --- |
| D01 | Tatsächliche Inferenz- und Embedding-Endpunkte der ausgewählten Aufgabe prüfen | Nicht ausgeführt |
| D02 | Authentifizierung und Erreichbarkeit von außerhalb des vertrauenswürdigen Netzwerks prüfen | Nicht ausgeführt |
| D03 | Veröffentlichte Containerports und tatsächliches Firewall-Verhalten prüfen | Nicht ausgeführt |
| D04 | Erlaubte und abgelehnte Sandbox-Ziele testen | Nicht ausgeführt |
| D05 | Generierung über Gateway, direkte Laufzeit-/Anbieteraufrufe und Backend-Connectors getrennt vom Sandbox-Egress prüfen | Nicht ausgeführt |
| D06 | Einen kontrollierten Fehler auslösen, um konfigurierte Berichtsfelder und Ziel zu prüfen | Nicht ausgeführt |
| D07 | Moderations- und Analyseeinstellungen einschließlich aktiviertem/deaktiviertem Zustand prüfen | Nicht ausgeführt |
| D08 | Isolierte Wiederherstellung durchführen und alte Dateien, Konfiguration sowie erforderlichen Secret-Zugriff prüfen | Nicht ausgeführt |
| D09 | Abhängigkeiten von Updates und Modelldownloads erfassen | Nicht ausgeführt |
| D10 | Repräsentative Aufgaben mit erwarteter Parallelität wiederholen und Kapazitätsgrenzen dokumentieren | Nicht ausgeführt |

## Betriebsverantwortung

| Verantwortung | Zuständigkeit | Rhythmus/Auslöser | Belege |
| --- | --- | --- | --- |
| Updates und Rücknahme-/Wiederherstellungsplanung | Nicht zugewiesen | Nicht vereinbart | Nicht erfasst |
| Rotation und Entzug von Zugangsdaten | Nicht zugewiesen | Nicht vereinbart | Nicht erfasst |
| Kapazitäts- und Warteschlangenüberwachung | Nicht zugewiesen | Nicht vereinbart | Nicht erfasst |
| Reaktion auf Warnmeldungen | Nicht zugewiesen | Nicht vereinbart | Nicht erfasst |
| Backups außerhalb des Hosts und externer Speicher | Nicht zugewiesen | Nicht vereinbart | Nicht erfasst |
| Wiederherstellungsübungen | Nicht zugewiesen | Nicht vereinbart | Nicht erfasst |
| Prüfung von Zielen und Konfiguration | Nicht zugewiesen | Nicht vereinbart | Nicht erfasst |

## Entscheidung

Dokumentiere unterstützte Aufgaben/Datenklassen, akzeptierte externe Dienste, offene Risiken, erforderliche Änderungen und den nächsten Prüfauslöser. Bezeichne eine Installation nicht allein wegen dieses ausgefüllten Verzeichnisses als physisch isoliert, vollständig lokal oder regelkonform.

Tale-Referenzen: [Architektur](https://docs.tale.dev/de/self-hosted/overview), [Datenspeicher](https://docs.tale.dev/de/self-hosted/configuration/data-residency), [Härtung](https://docs.tale.dev/de/self-hosted/operate/security/hardening), [Observability](https://docs.tale.dev/de/self-hosted/configuration/observability-config) und [Wiederherstellung](https://docs.tale.dev/de/self-hosted/operate/backups-and-restore).
