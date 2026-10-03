---
title: "KI-Agenten selbst hosten: Datenflüsse prüfen"
description: "Prüfe Modelle, Speicher, Tools, Telemetrie und Backups vor dem Selbsthosting von KI-Agenten. Vergleiche Datenwege, Kosten und Betriebsverantwortung."
slug: "self-hosted-ai-agent-platform-data-flow"
topicId: "T06"
reviewed: "2026-10-03"
draft: false
coverAlt: "Ein offener Arbeitsbereich ist mit getrennten externen Diensten verbunden."
---

Wähle eine selbst gehostete Plattform für KI-Agenten, wenn die gewonnene Kontrolle die übernommene Betriebsverantwortung rechtfertigt. Für diese Entscheidung brauchst du drei Arten von Belegen: Wohin gelangen die Daten einer Aufgabe? Was kostet ein brauchbares Ergebnis bei der erwarteten Auslastung? Und kann das Team den Dienst samt Arbeitsergebnissen wiederherstellen?

Der Hostingort der Anwendung beantwortet keine dieser Fragen allein. Du kannst den Arbeitsbereich selbst betreiben und gehostete Modelle nutzen, Texte lokal erzeugen und Embeddings extern berechnen lassen oder beides lokal halten, während ein Tool Projektinhalte an einen anderen Dienst sendet. Beschreibe die geplante Konfiguration genau, bevor du sie mit einem verwalteten Angebot vergleichst.

## Beginne mit einer Aufgabe und einer Datenregel

Betrachten wir ein fiktives Projekt zum Lieferantenvergleich. Ein Agent liest ein internes Anforderungsbriefing, recherchiert öffentliche Lieferantenseiten und erstellt einen Bericht zur Prüfung durch ein Teammitglied. Für dieses Beispiel gilt: Das interne Briefing und daraus extrahierte Passagen müssen in der kontrollierten Umgebung bleiben; öffentliche Lieferanteninformationen dürfen aus dem Web abgerufen werden.

Diese Regel erlaubt eine hybride Architektur. Sie erlaubt jedoch nicht, den gesamten Berichtskontext an ein gehostetes Modell zu senden. Beim Vergleich vermischt der Agent interne und öffentliche Informationen. Klassifiziere die zusammengesetzte Anfrage, nicht nur die Herkunft jeder einzelnen Datei.

Die Regel dient der Veranschaulichung. Sie ist weder eine rechtliche Empfehlung noch die Beschreibung einer beobachteten Tale-Installation. Ersetze sie durch die tatsächlichen Vorgaben und zulässigen Ausnahmen deiner Organisation.

![Eine gewählte Infrastrukturgrenze umfasst Speicher und Agentenausführung. Konfigurierte Verbindungen können zu Modelldiensten, verbundenen Tools und Betriebsdiensten führen. Jede Verbindung braucht einen Eintrag im Datenflussverzeichnis.](/blog/diagrams/de/T06-diagram.svg)

Ein brauchbares Verzeichnis erfasst für jeden Datenfluss den Prozess, das Ziel, die übertragenen Inhalte und den Zweck. Ein Anbietername ist zu ungenau: Modellendpunkt, Analyseendpunkt und Backup-Speicherort sind unterschiedliche Ziele, selbst wenn sie demselben Unternehmen gehören.

| Datenfluss in der Beispielaufgabe | Warum die Grenze relevant ist | Entscheidung nach der Beispielregel |
| --- | --- | --- |
| Briefing → Speicherung und Textextraktion | Original und extrahierte Kopien enthalten interne Anforderungen | Beides innerhalb der kontrollierten Umgebung halten |
| Extrahierte Passagen → Embedding-Dienst | Text kann bereits vor der Generierung offengelegt werden | Einen genehmigten internen Endpunkt verwenden |
| Gemischter Kontext → Generierungsmodell | Öffentliche Fakten machen interne Passagen nicht öffentlich | Diese Anfrage intern halten |
| Agent → öffentliche Lieferantenseite | Suchanfragen und Formularfelder können interne Details enthalten | Nur die nötigen öffentlichen Suchinformationen übermitteln |
| Fehlerbericht → Monitoringdienst | Eine Fehlermeldung kann Aufgabeninhalte enthalten | Tatsächliche Felder prüfen oder den externen Weg deaktivieren |
| Speicher und Schlüssel → Backup-System | Wiederherstellungskopien enthalten dieselben sensiblen Informationen | Vorgesehene Zugriffs- und Standortregeln auch auf Kopien anwenden |

Dieses ausgefüllte Beispiel schließt einige Architekturen aus, bevor der Preis eine Rolle spielt. Erlaubt die Vorgabe später einen ausdrücklich benannten gehosteten Verarbeiter, wird die Generierung wieder zu einer Frage von Kosten, Qualität und Zuverlässigkeit. Dokumentiere diese Änderung; verstecke sie nicht in einer Konfigurationseinstellung.

## Prüfe Ziele und Zugriff getrennt

Eine lokale Adresse beweist keine lokale Inferenz. Ollama dokumentiert sowohl lokale als auch in der Cloud gehostete Modelle; die lokale API verlangt standardmäßig keine Authentifizierung. Eine lokale API kann Anfragen an ein Cloud-Modell weiterleiten. Prüfe deshalb Modellauswahl und Endpunktverhalten ebenso wie die URL. Das sind Beispiele aus Ollama, keine Aussagen über Tales Inferenzimplementierung. [Ollama-FAQ](https://docs.ollama.com/faq) und [Dokumentation zur Authentifizierung](https://docs.ollama.com/api/authentication).

Ebenso sagt eine private Anwendungsadresse wenig darüber aus, ob ein Datenbank- oder Modellport anderswo versehentlich veröffentlicht wurde. Teste die Erreichbarkeit von außerhalb des vorgesehenen Netzwerks. Docker dokumentiert, dass Datenverkehr an veröffentlichte Container die üblichen ufw-Ketten umgehen kann. Die Konfiguration der Host-Firewall allein belegt daher nicht, welche Container erreichbar sind. [Dockers Firewall-Hinweise](https://docs.docker.com/engine/network/packet-filtering-firewalls/).

Ermittle bei ausgehenden Verbindungen den aufrufenden Prozess. Eine Sandbox-Beschränkung belegt nicht, welche Ziele ein separater Backend-Connector oder ein Modell-Gateway erreichen kann. Beobachte eine erfolgreiche Aufgabe und einen kontrollierten Fehler: Optionale Fehlerberichte bleiben im Erfolgsfall möglicherweise unsichtbar. Kennzeichne unbeobachtete Wege als ungeprüft, nicht als nicht vorhanden.

## Vergleiche die Kosten abgenommener Arbeit

Lokale Inferenz kann variable Anbieterkosten durch feste Kapazität und Betriebsaufwand ersetzen. Ob sich das lohnt, hängt von Volumen, Modelleignung, Parallelität und dem Anteil tatsächlich nutzbarer Ergebnisse ab.

Die folgende Rechnung ist vollständig hypothetisch und verwendet US-Dollar. Es sind erfundene Planungswerte, keine Anbieterpreise, Hardwareempfehlungen, Tale-Kosten oder gemessenen Abnahmequoten. Beide Optionen bearbeiten dieselben Lieferantenberichte nach denselben Abnahmeregeln. Für diesen Kostenvergleich nehmen wir an, dass die Organisation einen bestimmten gehosteten Verarbeiter für die internen Inhalte genehmigt hat. Damit sind beide Optionen zulässig. Gilt weiterhin die vorherige Regel „nur intern“, scheidet die gehostete Option unabhängig vom Preis aus.

| Monatliche Annahme | Selbst betriebene Inferenz | Gehostete Inferenz |
| --- | ---: | ---: |
| Zusätzliche Fixkosten F | 2.600 USD | 200 USD |
| Angenommene Verarbeitung und Wiederholungen je gestarteter Aufgabe | 0,10 USD | 0,80 USD |
| Angenommene Prüfung/Korrektur je gestarteter Aufgabe | 2,00 USD | 2,00 USD |
| Gesamte variable Kosten je gestarteter Aufgabe v | 2,10 USD | 2,80 USD |
| Gestartete Aufgaben N | 5.000 | 5.000 |
| Nach erlaubten Wiederholungen abgenommener Anteil a | 90 % | 90 % |
| Geschätzte erfasste Kosten F + v × N | 13.100 USD | 14.200 USD |
| Abgenommene Ergebnisse a × N | 4.500 | 4.500 |
| Geschätzte erfasste Kosten je abgenommenem Ergebnis | 2,91 USD | 3,16 USD |

Die Fixkosten stehen für die der jeweiligen Option zugerechnete zusätzliche Kapazität, Betriebsarbeit und Wiederherstellungsvorsorge. Der Ansatz von 2 USD für Prüfung und Korrektur entspricht zwei Minuten je gestarteter Aufgabe bei 60 USD pro Stunde, einschließlich des durchschnittlichen Aufwands für erfolglose Aufgaben. Ersetze diese Planungsannahme später durch Beobachtungen. Die variablen Verarbeitungskosten umfassen erlaubte Wiederholungen; feste Betriebsarbeit und variable Prüfarbeit sind getrennte Posten. Gemeinsame Anwendungskosten bleiben in diesem Beispiel außen vor. Echte Budgets müssen abweichende Lizenz-, Speicher-, Netzwerk-, Support- und Personalkosten ergänzen. Zähle jedes eigenständige abgenommene Ergebnis genau einmal.

Bei gleicher Abnahmequote liegt der monatliche Kostenschnittpunkt bei `(2600 − 200) / (2.80 − 2.10)`, also ungefähr 3.429 Aufgaben. Unterhalb dieses Volumens ist die gehostete Option nach diesen Annahmen günstiger. Bei 1.000 Aufgaben betragen die erfassten Gesamtkosten 4.700 beziehungsweise 3.000 USD.

Stelle nun das günstige lokale Ergebnis infrage. Sinkt dessen Abnahmequote bei sonst gleichen Annahmen auf 65 %, entstehen 3.250 abgenommene Ergebnisse. Die Kosten steigen auf rund 4,03 USD je Ergebnis und liegen damit über den 3,16 USD der gehosteten Option. Zusätzliche Korrekturarbeit würde den Abstand vergrößern. Diese Änderung beweist keine Überlegenheit gehosteter Modelle. Sie zeigt, weshalb gleiche Qualität eine zu prüfende Annahme ist und keine bereits nachgewiesene Einsparung.

Die Rechnung setzt außerdem voraus, dass die lokale Kapazität die Arbeit rechtzeitig bewältigt. Brauchst du für 5.000 Aufgaben einen weiteren Server, ändern sich die Fixkosten und du musst den Schnittpunkt neu berechnen. Eine geschätzte Einsparung jenseits der nutzbaren Maschinenkapazität rechtfertigt keine Anschaffung.

## Teste Lastspitzen, die den Durchschnitt entwerten

Fünftausend über einen Monat verteilte Aufgaben sind etwas anderes als Hunderte unmittelbar vor einer Frist. Teste mit repräsentativen Eingabe- und Ausgabelängen, Tools und gleichzeitig laufenden Aufgaben. Erfasse Wartezeit, Fertigstellungszeit, fehlgeschlagene Aufgaben oder Zeitüberschreitungen sowie abgenommene Ergebnisse. Tokens pro Sekunde allein sagen Projektverantwortlichen nicht, wann der Bericht fertig ist.

vLLM zeigt einen konkreten Kapazitätskonflikt: Reicht der Attention-Cache nicht aus, kann das System Anfragen unterbrechen und später neu berechnen, was die Gesamtlatenz erhöht. Die Optimierungshinweise beschreiben außerdem Abwägungen zwischen Batching, Latenz und Parallelisierungsaufwand. Das begründet Lasttests der gewählten Inferenzumgebung; es belegt weder, dass Tale vLLM nutzt, noch einen bestimmten Tale-Durchsatz. [vLLM: Optimierung und Abstimmung, Version 0.21.0](https://docs.vllm.ai/en/v0.21.0/configuration/optimization/).

Auch verwaltete Kapazität hat Grenzen. Hugging Face dokumentiert, dass das Herunterskalieren eines Endpunkts auf null ungenutzte Ressourcen spart, aber einen Kaltstart verursacht. Während eine Replik initialisiert wird, können Anfragen eine 503-Antwort erhalten. Bei einem gelegentlichen Nachtbericht ist Warten möglicherweise akzeptabel; für eine interaktive Prüfung kann vorgehaltene Kapazität ihren Preis wert sein. [Hugging Face: automatische Skalierung](https://huggingface.co/docs/inference-endpoints/guides/autoscaling).

Wird eine Frist unter Spitzenlast verfehlt, entscheide, welche Bedingung sich ändern darf: Parallelität, Modell- oder Kontextgröße, Kapazität oder Liefertermin. Prüfe nach einer Kontextverkleinerung oder einem Modellwechsel die Qualität erneut. Leite interne Inhalte nicht unbemerkt an einen externen Ersatzdienst weiter, der die Datenregel verletzt.

## Plane die Wiederherstellung entlang der Abhängigkeiten

Betrachten wir einen weiteren fiktiven Fehler. Die Datenbank lässt sich auf 10:05 Uhr wiederherstellen, das verfügbare Datei-Backup stammt jedoch von 10:00 Uhr. Ein um 10:03 Uhr hochgeladener Bericht erscheint im wiederhergestellten Aufgabeneintrag, während seine Dateiinhalte fehlen. Die Anwendung startet, besteht aber die Wiederherstellungsprüfung aus Nutzersicht trotzdem nicht.

Lass Datenverkehr und geplante Aktionen in der isolierten Wiederherstellungsumgebung angehalten. Sichere den beschädigten Zustand und ermittle die passende Dateiversion oder einen vollständigen, aufeinander abgestimmten Wiederherstellungssatz. Ist der letzte brauchbare Satz von 10:00 Uhr, bedeutet dessen Auswahl, den Verlust späterer Arbeit ausdrücklich zu akzeptieren oder sie in einem dokumentierten Verfahren zu rekonstruieren. Neuere Anwendungsversionen oder eine Neuindizierung können fehlende Quelldateien nicht erzeugen.

Auch die Datenbankwiederherstellung hat Voraussetzungen. PostgreSQL benötigt für die zeitpunktbezogene Wiederherstellung ein Basis-Backup und das lückenlose erforderliche WAL-Archiv. Manuell bearbeitete Konfigurationsdateien werden durch WAL nicht wiederhergestellt. Das ist eine Aussage zur Datenbankwiederherstellung, nicht zur vollständigen Abdeckung aller Anwendungsspeicher. [PostgreSQL 18: kontinuierliche Archivierung](https://www.postgresql.org/docs/18/continuous-archiving.html).

Definiere Erfolg über nutzbare Arbeit: anmelden, ein altes Projekt öffnen, eine bekannte Datei herunterladen, eine bekannte Quelle abrufen und auf die benötigten Zugangsdaten zugreifen, ohne Produktionsbenachrichtigungen zu versenden. Miss das verlorene Datenintervall und die Zeit bis zum nutzbaren Dienst. Ein Datenbank-Gesundheitscheck beantwortet nur einen Teil davon.

## Übertrage diese Entscheidungen auf Tales tatsächliche Grenzen

Tales [Architektur für das Selbsthosting](https://docs.tale.dev/de/self-hosted/overview) trennt die Verantwortlichkeiten für persistente Speicher, Ausführung, ausgehende Verbindungen und Modell-Gateway. Der [Leitfaden zu Datenspeichern](https://docs.tale.dev/de/self-hosted/configuration/data-residency) unterscheidet Anwendungseinträge, Wissen und Originaldateien. Eine geänderte Verbindung migriert keine Historie; berücksichtige vorhandene Daten deshalb im Umstellungsplan.

Der Egress-Proxy der Sandbox erlaubt standardmäßig öffentliche HTTPS-Ziele und beschränkt private sowie Metadatenadressen. Betreiber können die erlaubten Hostnamen weiter eingrenzen. Modellaufrufe über Tales Gateway nutzen einen vom Sandbox-Egress getrennten Weg. Unterstützte Laufzeitumgebungen mit direkter Abonnementanbindung können ihren Anbieter stattdessen außerhalb der Erfassung und Kontrollen des Gateways aufrufen; nimm auch diese Ziele in das Verzeichnis auf. [Zugangsdaten der Laufzeitumgebungen](https://docs.tale.dev/de/platform/agents/harnesses). Prüfe die konfigurierten Wege anhand von [Härtung](https://docs.tale.dev/de/self-hosted/operate/security/hardening) und [Anbieter](https://docs.tale.dev/de/self-hosted/configuration/providers). Optionale Fehlerberichte und Analysen brauchen eine eigene Prüfung: Das Maskieren ausgewählter Header macht nicht jede Fehlermeldung frei von Inhalten. Siehe [Observability](https://docs.tale.dev/de/self-hosted/configuration/observability-config).

Tales CLI-Snapshots sind absturzkonsistente Archive auf Volume-Ebene, kein atomarer Schnappschuss sämtlicher Speicher. Externe Datenbanken und Buckets brauchen abgestimmte Backups; Sandbox-Arbeitsbereiche liegen außerhalb dieses Snapshot-Umfangs. Bewahre die passende Version, Bereitstellungskonfiguration und Entschlüsselungsschlüssel auf und kopiere fertige Backups auf einen anderen Host. Diese Details verändern den Wiederherstellungsplan wesentlich. [Tale: Backups und Wiederherstellung](https://docs.tale.dev/de/self-hosted/operate/backups-and-restore).

## Wähle eine Verantwortung, die du dauerhaft tragen kannst

Ein Selbsthosting-Pilot zeigt, dass eine Konfiguration eine Aufgabe ausführen kann. Er belegt weder bezahlbare Kapazität noch Wiederherstellbarkeit. Das KI-Starterkit von n8n zieht eine ähnliche Grenze: Es beschreibt sich als Ausgangspunkt für einen Machbarkeitsnachweis und nicht als vollständig für den Produktivbetrieb optimierte Installation. [n8n-Starterkit](https://github.com/n8n-io/self-hosted-ai-starter-kit).

Selbst betriebene Inferenz wird attraktiv, wenn ein getestetes Modell die Qualitätsanforderungen erfüllt, die Auslastung die Wirtschaftlichkeit trägt und das Team die erforderliche Umgebung betreiben kann. Gehostete oder verwaltete Komponenten werden interessanter, wenn schwankende Nachfrage, Modellqualität oder begrenzte Betriebskapazität stärker wiegen als die zusätzliche Kontrolle – vorausgesetzt, ihr Umgang mit Daten ist zulässig. Erfüllt keine Option die Anforderungen, verkleinere den Arbeitsumfang oder stelle diesen Anwendungsfall zurück.

Mit dem [Arbeitsblatt für Datenflüsse und Bereitstellungsentscheidungen](/blog/worksheets/de/T06-data-flow-inventory.md) dokumentierst du die Grenze, rechnest die Kostensensitivität nach und planst die Wiederherstellungsübung mit nicht zueinander passenden Speicherständen. Bring den ausgefüllten Entscheidungsnachweis zu einer [Tale-Demo](/de/request-demo) mit. So beginnt das Gespräch mit der Arbeit und den Betriebsbedingungen deines Teams.
