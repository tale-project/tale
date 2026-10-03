# Arbeitsblatt zur Auswahl einer KI-Agenten-Laufzeitumgebung

Fülle dieses Arbeitsblatt für bestimmte Aufgaben und eine konkrete Bereitstellung aus, nicht für einen abstrakten „besten Agenten“. Die leeren Felder sind für deine Belege vorgesehen. Unterscheide deren Status mit `dokumentiert`, `beobachtet`, `unbekannt` oder `nicht zutreffend`.

## Ausgefülltes Beispiel: die Kombination auswählen, ohne das Modell allgemein einzuordnen

**Fiktives Lehrbeispiel. R1, R2, M1, M2 und alle Ergebnisse sind erfunden. Es handelt sich weder um Anbietertests noch um Tale-Testergebnisse.** Wir nehmen an, dass jede Kombination kompatibel ist und die vorgeschriebenen Zugriffs- und Zugangsdatenprüfungen bestanden hat. Verwendet werden dieselben sechs Fälle, Quellenstände, Skill-Versionen, Bewertungskriterien und angegebenen Betriebsgrenzen, ohne menschliche Korrekturen.

| Abnahme der ersten Ausgabe | M1 | M2 |
| --- | --- | --- |
| R1 | 3/6 | 5/6 |
| R2 | 5/6 | 4/6 |

Ein Vergleich nur zwischen R1/M1 und R2/M2 kann keinen Modelleffekt bestimmen. In der angenommenen vollständigen Matrix hilft M2 in R1, während M1 in R2 besser abschneidet. Halte die einzelnen Konfigurationen eindeutig auseinander.

| Weitere angenommene Belege | R1/M2 | R2/M1 |
| --- | --- | --- |
| Aktive Vorbereitung und Prüfung für sechs Fälle | 48 Minuten | 30 Minuten |
| Erfasste Ausführungskosten | 6 USD | 6 USD |
| Prüfung einer Korrektur während der Aufgabe | Aktualisierte Zielgruppe im endgültigen Briefing | Aktualisierte Zielgruppe im endgültigen Briefing |
| Prüfung einer ausdrücklichen Übergabe | Nächste bearbeitende Instanz prüft die Quellen | Nächste bearbeitende Instanz prüft die Quellen |
| Lieferfrist | Fünf abgenommene Ergebnisse innerhalb der Frist | Fünf abgenommene Ergebnisse innerhalb der Frist |

**Ausgefüllte Entscheidung:** R2/M1 für Recherchebriefings erproben. Die beobachtete Anzahl ist gleich, während der aktive menschliche Aufwand unter diesen Annahmen geringer ist. Das belegt kein allgemein überlegenes Modell. Prüfe den nicht bestandenen Fall und wiederhole repräsentative Versuche. Revidiere die Auswahl, wenn der scheinbare Zeitvorteil verschwindet, ein zwingend benötigter Ausführungsweg nicht mehr funktioniert oder ein wesentlicher Fehler die Konfiguration für diese Aufgaben ungeeignet macht. Pflege- und Bereitstellungskosten bleiben außerhalb dieses Beispiels.

**Wenn sich die Matrix nicht vervollständigen lässt:** Vergleiche kompatible, bereitstellbare Konfigurationen und lasse ausdrücklich offen, welchem Bestandteil ein Unterschied zuzurechnen ist. Ersetze niemals Anbieter oder Zugangsdatenweg, um das Ergebnis anschließend stillschweigend als dieselbe Konfiguration zu behandeln.

## Vergleichsfrage festlegen

| Feld | Wert |
| --- | --- |
| Bereitstellbare Konfigurationen auswählen, einen Bestandteil untersuchen oder beides? | |
| Verglichene vollständige Konfigurationen | |
| Einzelner veränderter Bestandteil für die Ursachendiagnose | |
| Konstant gehaltene weitere Einstellungen | |
| Durch fehlende Kompatibilität ausgeschlossene Vergleiche | |
| Gleiche Betriebsgrenzen: Ausgaben, Frist, erlaubte Korrekturen | |
| Anpassungsbudget je Kandidat | |
| Tatsächliche Wiederholungen / Aufrufe / Tool-Nutzung | |
| Unterschied, dessen Ursache nicht isoliert werden kann | |
| Schlussfolgerung, die dieser Vergleich nicht trägt | |

Gleiche Modellnamen bedeuten keine gleichen Systeme. Gleiche Token-Limits bedeuten nicht automatisch gleiche Kosten oder Möglichkeiten. Trenne tatsächliche Betriebsgrenzen von den Bedingungen, die ein Vergleich zur Ursachendiagnose konstant halten soll.

## Zu unterstützende Arbeit

| Feld | Wert |
| --- | --- |
| Aufgabe und vorgesehenes Ergebnis | |
| Rolle der Person, die die Aufgabe startet | |
| Prüfer und Abnahmekriterien | |
| Eingabetypen und Quellenorte | |
| Erforderliche Lesezugriffe | |
| Erforderliche Schreibzugriffe, falls vorhanden | |
| Verbotene Aktionen | |
| Erwarteter Bedarf an Kurskorrektur und Unterbrechung | |
| Anforderungen an Persistenz und Übergabe | |
| Erlaubte Datenziele | |
| Kosten-, Zeit- und Kapazitätsgrenzen | |

## Tatsächliche Konfiguration vergleichen

| Ebene | Kandidat A | Kandidat B | Nachweis / Datum |
| --- | --- | --- | --- |
| Laufzeitumgebung und Version | | | |
| Modell und bereitstellender Anbieter | | | |
| Zugangsdatenweg; keine geheimen Werte | | | |
| Abdeckung der Abrechnung über Gateway / Abonnement | | | |
| Anweisungsversion | | | |
| Eingerichtete Skills und Paketversionen | | | |
| Tool-Operationen und wirksame Berechtigungen | | | |
| Erforderliche und verfügbare MCP-Fähigkeiten | | | |
| Arbeitsbereich und Isolationsumfang | | | |
| Dateiübernahme und Aufbewahrungsverhalten | | | |
| Hosting und ausgehende Ziele | | | |
| Kapazität und Warteschlangenverhalten | | | |
| Wiederherstellung und Fortsetzung | | | |

Kennzeichne jede Anforderung als zwingend, nützlich oder irrelevant. Vergib keine Punkte für irrelevante Funktionen. Dokumentiere Belege dafür, dass eine zwingende Anforderung in der vorgesehenen Bereitstellung funktioniert. Eine Marketingaussage oder ein kompatibles Dateiformat allein belegt das nicht.

## Kleiner Abnahmetest

| Test | Eingabe und erwartetes Verhalten | Tatsächliche Beobachtung | Ergebnis- / Ausführungsnachweis | Entscheidung |
| --- | --- | --- | --- | --- |
| Die begrenzte Aufgabe abschließen | | | | |
| Den passenden Skill finden | | | | |
| Dessen kennzeichnendes Verfahren befolgen | | | | |
| Unnötige Skill-Aktivierung vermeiden | | | | |
| Eine verbotene Operation unterlassen | | | | |
| Eine Korrektur während der Aufgabe aufnehmen | | | | |
| Nach einer Unterbrechung fortsetzen oder neu beginnen | | | | |
| Erlaubte Dateien in einer späteren Aufgabe verwenden | | | | |
| Ausdrücklich an eine andere bearbeitende Instanz übergeben | | | | |
| Eine Verweigerung oder fehlende Voraussetzung erklären | | | | |

Bewahre Arbeitsergebnisse auf, bevor du wieder mit einer sauberen Testumgebung arbeitest. Unterscheide erhaltene Dateien, fortgesetzte Gespräche und Wissen, das an einen anderen Agenten übergeben wurde. Behandle einen Abbruch nicht als Rücknahme. Teste die Wiederherstellung mit fiktiven Daten und rückgängig zu machenden Änderungen.

## Qualität und Kosten prüfen

Nutze den [Bewertungsbogen](T08-evaluation-scorecard.md) für vergleichbare Versuche. Halte Ergebnisrichtigkeit, menschliche Eingriffe, verstrichene Zeit und die Abdeckung gemessener Kosten getrennt. Eine funktionierende Modellverbindung belegt nicht, dass alle nötigen Tools funktionieren; ein verfügbarer Skill belegt nicht seine Anwendung.

Prüfe für Tale die aktuelle [Matrix der Laufzeitumgebungen und Zugangsdatenwege](https://docs.tale.dev/de/platform/agents/harnesses), die [Konfiguration von Projektagenten](https://docs.tale.dev/de/platform/projects/project-agents) und die [Ausstattung mit Skills](https://docs.tale.dev/de/platform/agents/skills). Unterstützte Abonnementaufrufe umgehen Tales Gateway-Messung und Ausgabenlimits. Gehe nicht von allgemeiner Kompatibilität zwischen Abonnements, Modellen, Laufzeitumgebungen oder MCP-Funktionen aus.

## Auswahl und Pflege

| Punkt | Entscheidung |
| --- | --- |
| Gewählte Konfiguration | |
| Aufgabenbereiche, für die sie genehmigt ist | |
| Belege für die Auswahl | |
| Bekannte Grenzen / fehlende Beobachtungen | |
| Bedingung, die diese Auswahl umkehrt | |
| Durch Spezialisierung gerechtfertigter zusätzlicher Pflegeaufwand | |
| Verantwortung für Zugangsdaten und Nutzungsprüfung | |
| Verantwortung für Änderungen an Anweisungen, Skills und Tools | |
| Bekannte Aufgaben für erneute Tests nach Änderungen | |
| Auslöser einer erneuten Prüfung / nächster Prüftermin | |

Prüfe die Entscheidung nach einer relevanten Änderung an Laufzeitumgebung, Anbieter, Modell, Skill, Tool oder Berechtigung erneut. Bewahre frühere Versuchsprotokolle als datierte Belege auf. Deute sie nicht stillschweigend zu Tests einer neueren Konfiguration um.
