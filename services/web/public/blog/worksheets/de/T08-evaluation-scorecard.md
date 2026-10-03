# Bewertungsbogen für KI-Agenten

Kopiere diese Vorlage für einen Vergleich. Die leeren Zellen sind beabsichtigt: Trage Beobachtungen ein, keine Beispielergebnisse. Verwende `unbekannt` für fehlende Messwerte und `nicht zutreffend` nur mit Begründung. Eine eingetragene Null bedeutet eine gemessene Null.

## Ausgefülltes Beispiel: der günstigere Lauf liefert das teurere abgenommene Ergebnis

**Fiktives Lehrbeispiel. Alle folgenden Anzahlen, Gebühren, Zeiten und Stundensätze sind angenommen. Diese Zahlen stammen aus keiner Agentenausführung.** Zwei Konfigurationen erhalten dieselben sechs Fälle. Jeder Fall wird zweimal unter sauberen Ausgangsbedingungen ausgeführt; eine Korrekturrunde ist erlaubt. Pro Konfiguration gibt es zwölf gültige gestartete Versuche, sechs unterschiedliche Fälle, keine ungültigen Tests, keine unbewerteten Ergebnisse, keine Startfehler und keine verbotenen Wirkungen. Die menschliche Zeit umfasst sämtliche Vorbereitung, Begleitung, Prüfung und Korrektur in der gesamten Versuchsgruppe einschließlich fehlgeschlagener Versuche.

| Kennzahl | Konfiguration A | Konfiguration B |
| --- | --- | --- |
| Gültige gestartete Versuche N | 12 | 12 |
| Mit erster Ausgabe abgenommen F | 8 | 10 |
| Innerhalb der erlaubten Korrekturen abgenommen A, einschließlich sofort bestandener Ergebnisse | 10 | 11 |
| Am Ende nicht abgenommene Versuche | 2 | 1 |
| Abnahmequote der ersten Ausgabe F/N | 66,7 % | 83,3 % |
| Abnahmequote mit erlaubter Hilfe A/N | 83,3 % | 91,7 % |
| Erfasste Modell- und Tool-Gebühren | 6 USD | 18 USD |
| Menschliche Arbeit in der gesamten Versuchsgruppe | 180 Minuten = 3 Stunden | 120 Minuten = 2 Stunden |
| Angenommener Stundensatz | 60 USD | 60 USD |
| Geschätzte Personalkosten | 180 USD | 120 USD |
| Geschätzte Zwischensumme der erfassten Kosten | 186 USD | 138 USD |
| Zwischensumme je abgenommenem Ergebnis | 18,60 USD | 12,55 USD, gerundet |

Infrastruktur, Abonnements und Bereitstellungsaufwand sind ungemessen, nicht null. Dies ist eine geschätzte Zwischensumme der erfassten Kosten, keine Aussage über vollständige Kosten oder eine gemessene Gesamtsumme. Hier werden keine Ergebnisse zur Lieferzeit angenommen. Die Frist einzuhalten ist eine zusätzliche Bedingung der Entscheidung.

**Rechnung:** A: `(6 + 3 × 60) / 10 = 18,60`. B: `(18 + 2 × 60) / 11 = 12,545...`. Bei Stundensatz `r` lautet der Vergleich `(6 + 3r)/10` gegenüber `(18 + 2r)/11`. Gleichheit verlangt `66 + 33r = 180 + 20r`, also `r = 114/13`, ungefähr 8,77 USD/Stunde. Weitere fehlende Kosten können den Schnittpunkt verschieben.

**Ausgefüllte Entscheidung:** B in einem begrenzten beaufsichtigten Pilotversuch weiter prüfen, sofern der verbleibende Fehler akzeptabel ist und B die Frist einhält. Oberhalb des Schnittpunkts beim Stundensatz hat B unter diesen Annahmen das niedrigere erfasste Kostenverhältnis. Untersuche einzelne Fehlschläge und wiederhole repräsentative Fälle, bevor du verallgemeinerst. Unterhalb des Schnittpunkts hat A das niedrigere Verhältnis. Eine disqualifizierende Wirkung würde jeden der beiden wirtschaftlichen Vorteile aufheben.

## Bewertung kalibrieren

Nutze bewusst gegensätzliche Ergebnisse, bevor du Kandidatenkonfigurationen bewertest. Lass qualifizierte Prüfer sie anhand der Quellenbelege einordnen, kläre Meinungsverschiedenheiten und lege die Kriterien verbindlich fest. Ein bewertendes Modell kann helfen, doch auch seine Erklärungen müssen geprüft werden.

| Kalibrierungsfall | Erwartete Unterscheidung | Tatsächliches Urteil / Beleg | Nötige Änderung |
| --- | --- | --- | --- |
| Knappes, korrektes Ergebnis | Trotz schlichtem Stil bestanden | | |
| Flüssiger Text verändert die Bedeutung einer Quelle | Wesentlicher Fehler trotz ausgefeilter Sprache | | |
| Korrekte Benennung fehlender Informationen | Erfundenen Anschein von Vollständigkeit nicht belohnen | | |
| Harmloser Stilfehler | Geschmack von einem disqualifizierenden Fehler trennen | | |
| Dasselbe Paar in umgekehrter Reihenfolge | Eine geänderte Präferenz untersuchen | | |

Prüfe einige abgenommene Ergebnisse und nicht nur abgelehnte, um fälschlich bestandene Prüfungen zu erkennen. Bewahre die Kalibrierungsbeispiele getrennt von den zurückgehaltenen Aufgabenfällen für die abschließende Bewertung auf.

## Evaluationsauftrag

| Feld | Wert |
| --- | --- |
| Entscheidung, die diese Evaluation unterstützt | |
| Aufgabenbereich und vorgesehene Nutzer | |
| Evaluationsverantwortung / Prüfer | |
| Evaluationszeitraum und Zeitzone | |
| Version des Aufgabensatzes und Eingabestand | |
| Entwicklungsfälle / zurückgehaltene Fälle | |
| Kandidatenkonfigurationen | |
| Anzahl unterschiedlicher Fälle / Versuche je Fall / Versuche insgesamt | |
| Fragestellung zur Wiederholbarkeit und Wiederholungsplan | |
| Bewertungsverfahren / Kalibrierungsnachweis | |
| Erlaubte Unterstützung | |
| Höchstzahl der Korrekturrunden / Zeit / Ausgaben | |
| Einordnung von Zeitüberschreitungen und Verweigerungen | |
| Bedingungen, die einen Test ungültig machen | |
| Disqualifizierende Grenzverletzungen | |
| Vor den Läufen festgelegte Abnahmeschwellen | |

Ein unabhängiger Versuch beginnt unter gleichwertigen Ausgangsbedingungen. Korrekturen gehören zu diesem Versuch; zähle nicht jede Korrektur als neues abgenommenes Ergebnis. Fehlgeschlagene Ausgaben bleiben in der Versuchsgruppe. Erfasse einen ungültigen Test mit Grund und Kosten separat und wende Ausschlussregeln bei allen Kandidaten gleich an. Berichte betriebliche Startfehler getrennt von der Ausgabequalität, ohne sie für die Leser verschwinden zu lassen.

## Konfigurationsnachweis

| Konfigurations-ID | Laufzeitumgebung / Version | Modell / Anbieter | Anweisungsversion | Skills / Versionen | Tools / Zugriff | Rolle der startenden Person | Grenzen |
| --- | --- | --- | --- | --- | --- | --- | --- |
| | | | | | | | |
| | | | | | | | |

Erfasse Zugangsdatenart und Messgrenze, niemals einen geheimen Wert. Bewahre die relevanten Anbieter- und Modellkennungen sowie das Konfigurationsdatum auf, auch wenn genaue Versionen nicht verfügbar sind.

## Abnahmekriterien

| Kriterium | Pflicht oder Präferenz | Zu prüfende Belege | Bedingung zum Bestehen | Disqualifizierend? |
| --- | --- | --- | --- | --- |
| | | | | |
| | | | | |
| | | | | |
| | | | | |

Bewerte Arbeitsergebnisse anhand der festgelegten Kriterien. Nutze Ausführungsnachweise, wenn eine Aktion oder ein Verbot relevant ist. Eine spätere Korrektur beseitigt keine verbotene Wirkung. Lege unterschiedliche Bewertungen und ihre Klärung offen. Halte das Ergebnis der ersten Ausgabe von jedem mit Hilfe abgenommenen Ergebnis getrennt.

## Leeres Versuchsprotokoll

| Versuchs-ID | Fall-ID | Konfiguration | Erste Ausgabe abgenommen? | Abschließendes Ergebnis mit Hilfe abgenommen? | Korrekturrunden | Grenzverletzung | Ergebnis- / Urteilsnachweis |
| --- | --- | --- | --- | --- | --- | --- | --- |
| | | | | | | | |
| | | | | | | | |
| | | | | | | | |
| | | | | | | | |

Zulässige Werte: `ja`, `nein` oder `unbewertet`. Behandle `unbewertet` nicht als bestanden. Benenne Zeitüberschreitungen, abgebrochene Versuche und Startfehler ausdrücklich, statt sie in einer bequemen Sammelkategorie zu verbergen.

## Fallabdeckung und Beständigkeit

| Fall-ID | Aufgabenart / Schwierigkeit | Konfiguration | Gültige Wiederholungen | Folge der Urteile zur ersten Ausgabe | Wiederkehrendes Fehlermuster |
| --- | --- | --- | --- | --- | --- |
| | | | | | |
| | | | | | |

Berichte unterschiedliche Fälle und Wiederholungen getrennt. Mindestens ein Erfolg unter mehreren Versuchen und Erfolg in allen Wiederholungen beantworten unterschiedliche Fragen. Benenne, welcher Nachweis deinen Betriebsplan stützt. Wiederholte Fälle belegen keine Abdeckung neuer Aufgabenarten. Leite `p^k` nicht aus einer zusammengefassten Abnahmequote ab, ohne die nötige Unabhängigkeit und gleichbleibende Erfolgswahrscheinlichkeit voraussetzen zu können.

## Zeit und Aufwand

| Versuchs-ID | Eingereicht am | Ausführung begonnen | Erste Ausgabe bereit | Abgenommen am / endgültiger Stopp | Vorbereitung in Min. | Begleitung in Min. | Prüfung in Min. | Menschliche Korrektur in Min. |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| | | | | | | | | |
| | | | | | | | | |
| | | | | | | | | |

Verwende eine einheitliche Zeitzone. Miss menschliche Arbeitsintervalle; zähle passives Warten nicht als Arbeit. Erfasse alle Beteiligten, ohne überlappende Intervalle derselben Person doppelt zu zählen. Die Laufzeiten paralleler Agenten ergeben addiert keine verstrichene Gesamtzeit. Bewahre für einen nicht abgenommenen Versuch Dauer bis zum Ende und Abbruchgrund auf, aber erfinde keinen Abnahmezeitpunkt.

## Kostenabdeckung

| Versuchs- / Gruppen-ID | Kategorie | Betrag | Währung | Beobachtet / geschätzt / unbekannt | Nachweis oder Umlageregel | Grenze der Abdeckung |
| --- | --- | --- | --- | --- | --- | --- |
| | Modellgebühren | | | | | |
| | Tool- / Dienstgebühren | | | | | |
| | Zugerechneter Abonnementanteil | | | | | |
| | Zugerechneter Infrastrukturanteil | | | | | |
| | Menschliche Arbeit | | | | | |
| | Sonstiges | | | | | |

Zähle dieselbe Anbietergebühr nicht doppelt aus Gateway-Eintrag und Rechnung. Verwende für Summen eine Währung und lege Umrechnungsdatum und -kurs offen. Eine unbekannte Kategorie bleibt unbekannt; ein zugerechneter Anbieterabonnementanteil ist keine gemessene Gebühr pro Lauf. Tales aufgezeichnete Nutzung ist weder eine vollständige Rechnung noch eine garantierte Gesamtsumme pro Aufgabe. Lies die [Nutzungsanalyse](https://docs.tale.dev/de/platform/admin/governance/usage-analytics) und die [Zugangsdatenwege der Laufzeitumgebungen](https://docs.tale.dev/de/platform/agents/harnesses).

## Formeln

`N` umfasst alle gültigen gestarteten Versuche der angegebenen Gruppe, einschließlich Versuchen mit Zeitüberschreitung oder ohne Ausgabe; bewerte diese als Fehlschläge. `F` bezeichnet Versuche, deren erste Ausgabe abgenommen wurde. `A` umfasst alle innerhalb des erlaubten Korrekturverfahrens abgenommenen Versuche, einschließlich sofortiger Abnahmen ohne Korrekturrunde. Berichte ungültige Tests und noch unbewertete Versuche getrennt; kläre fehlende Bewertungen vor dem Vergleich der Abnahmequoten. Berichte betriebliche Fehler nach Ursache, ohne gültige fehlgeschlagene Versuche aus `N` zu entfernen.

- Abnahmequote der ersten Ausgabe = `F / N`.
- Abnahmequote mit erlaubter Hilfe = `A / N`.
- Menschliche Arbeitsstunden = `(Minuten für Vorbereitung + Begleitung + Prüfung + Korrektur) / 60`, über die gesamte Versuchsgruppe einschließlich Fehlschlägen summiert.
- Geschätzte Personalkosten = `Summe (gemessene Stunden je Person × offengelegter Stundensatz dieser Person)`.
- Geschätzte Kosten der Versuchsgruppe = `nicht doppelt gezählte beobachtete Gebühren + offengelegte Umlagen + geschätzte Personalkosten`.
- Geschätzte Kosten je abgenommenem Ergebnis = `geschätzte Kosten der Versuchsgruppe / A`.
- Menschliche Arbeitsstunden je abgenommenem Ergebnis = `Arbeitsstunden der gesamten Versuchsgruppe / A`.
- Verstrichene Zeit eines abgenommenen Versuchs = `Abnahmezeitpunkt − Einreichungszeitpunkt`.
- Wartezeit in der Warteschlange, soweit beobachtbar = `Ausführungsbeginn − Einreichungszeitpunkt`.

Bei `N = 0` sind beide Abnahmequoten **nicht definiert**, nicht null. Bei `A = 0` sind beide Verhältnisse je abgenommenem Ergebnis **nicht definiert**; zeige Ausgaben und Aufwand der Gruppe sowie null abgenommene Ergebnisse. Bei wesentlichen unbekannten Kosten nenne das Kostenverhältnis „geschätzte Zwischensumme der erfassten Kosten je abgenommenem Ergebnis“, wenn es Umlagen oder Arbeitsschätzungen enthält, und lege Auslassungen offen. Verwende „gemessene Zwischensumme“ nur für beobachtete Gebühren; bezeichne sie nicht als vollständige Kosten. Berichte zusammengefasste Zeiten bis zur Abnahme nur für abgenommene Versuche und daneben die Anzahlen von Fehlschlägen und Zeitüberschreitungen. Stelle die Dauer eines schnellen Fehlschlags niemals als schnelle erfolgreiche Lieferung dar.

## Entscheidungsnachweis

| Punkt | Befund |
| --- | --- |
| Beobachtete Stärken je Aufgabenart | |
| Fehlermuster und Schweregrade | |
| Abwägung zwischen Prüfaufwand und Lieferzeit | |
| Kostenabdeckung und Empfindlichkeit gegenüber Schätzannahmen | |
| Durch die Belege gestützte Einsatzbedingungen | |
| Nicht getestete Bedingungen | |
| Beobachtete Verfügbarkeit / Gründe für Startfehler | |
| Bedingung, die die Entscheidung umkehren würde | |
| Gewählte Konfiguration / engerer Pilot / keine Einführung | |
| Verantwortung und nächster Prüfauslöser | |

Bewahre Aufgabenergebnisse und Urteilsbelege bei diesem Nachweis auf. Ein einzelner Vergleich trägt eine begrenzte Entscheidung, keine allgemeine Rangfolge von Modellen oder Laufzeitumgebungen.
