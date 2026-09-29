---
title: Schutzregeln
description: Richte Chatfilter, den Schutz personenbezogener Daten und Moderation ein und prüfe Erkennungen und Fehler.
---

Als Admin oder Inhaber steuerst du unter **Einstellungen > Richtlinien > Guardrails**, wie Chattexte vor und nach einem Modellaufruf geprüft werden. Aktivierte Schichten laufen in dieser Reihenfolge: Inhaltssicherheit, Erkennung personenbezogener Daten und externe Moderation. Beginne mit einer klaren Regel und prüfe ihre Wirkung, bevor du sie ausweitest.

<Frame caption="Richtlinien > Guardrails — die drei Status-Karten der Filterebenen (Inhaltssicherheit, PII-Erkennung, Moderationsanbieter) über dem Log der letzten Ereignisse.">

![Die Einstellungsseite Guardrails zeigt drei Status-Karten — Inhaltssicherheit an mit zwei Kategorien für Ein- und Ausgabe, PII-Erkennung an im Maskierungsmodus, Moderations-Anbieter nicht konfiguriert — über dem Feed der letzten Ereignisse, der noch keine meldet, und den benutzerdefinierten Anweisungen der Organisation.](/images/platform/governance-guardrails.webp)

</Frame>

## Eine Inhaltsregel hinzufügen

1. Lege im Bereich der Inhaltssicherheit fest, ob Benutzereingaben, Modellausgaben oder beide geprüft werden.
2. Wähle die Aktion zum Hinzufügen einer Kategorie, vergib eine erkennbare Bezeichnung und wähle den Modus.
3. Füge die zu erkennenden Wörter oder Ausdrücke einzeln pro Zeile hinzu. Du kannst eine Textliste importieren; prüfe sie vor dem Anwenden.
4. Speichere die Kategorie, aktiviere die gewünschte Kategorie und Schicht und speichere die ausstehenden Seitenänderungen.
5. Teste mit erfundenem Text, der einen Treffer enthält, und mit normalem Text, der passieren soll. Prüfe die aktuellen Ereignisse und das sichtbare Ergebnis im Chat.

| Modus | Was bei einem Treffer passiert |
| --- | --- |
| Markieren | Protokolliert den Treffer und lässt die Nachricht durch. Hilfreich beim Abstimmen einer Regel. |
| Maskieren | Ersetzt den Treffer durch den eingestellten Platzhalter. |
| Blockieren | Lehnt die Nachricht ab. |

Treffen mehrere Kategorien zu, hat Blockieren Vorrang vor Maskieren und Markieren. Die Wortsuche ignoriert Groß- und Kleinschreibung. Prüfe wichtige Sprachvarianten und Fehlalarme. Ein erfolgreicher Test belegt keine vollständige Abdeckung.

## Personenbezogene Daten schützen

Der PII-Schutz erkennt konfigurierte Muster wie E-Mail-Adressen, Telefonnummern und Kennungen. Wähle passende eingebaute Typen und eigene Muster, danach das gewünschte Verhalten.

Maskieren entfernt erkannte Werte aus dem weitergegebenen Text. Im Chat speichert und zeigt Tale auch den maskierten Text als Nachricht; der ursprüngliche Wortlaut bleibt nicht erhalten. Blockieren lehnt einen Treffer ab. Tokenisierung ersetzt die Werte für das Modell durch nummerierte Tokens und stellt sie in der Antwort wieder her. Sie kann die Verarbeitung mit weniger offengelegten Daten unterstützen, verspricht aber keine Antwort ohne personenbezogene Daten.

Eine eingebaute Kennung, die nur aus Ziffern besteht, etwa eine schwedische Passnummer oder eine ukrainische Steuernummer, wird nur neben einem Wort erkannt, das sie benennt, zum Beispiel `passnummer` oder `ІПН`. Bestellnummern, kompakte Datumsangaben und Build-Nummern bleiben unverändert. Jede Erkennung unter **Letzte Ereignisse** nennt das ausgelöste Muster, etwa `se-passport`.

Teste die tatsächlich verwendeten Formate mit erfundenen Werten. Muster können ungewöhnliche Formate übersehen oder normalen Text fälschlich markieren. Prüfe Eingabe und Ausgabe getrennt.

## Externe Moderation ergänzen

Die Moderationsschicht sendet Text an einen konfigurierten Klassifikator, etwa OpenAI, Azure, Perspective oder einen eigenen Endpunkt. Richte Zugangsdaten, Kategorien und Aktionen ein und wähle, welche Richtung geprüft werden soll.

Lege das Verhalten bei Nichterreichbarkeit fest: Fail-open lässt die Nachricht durch, Fail-closed lehnt sie ab. Prüfe Anbieterfehler und Ereignisse einer geöffneten Schutzschaltung bei unerwarteten Ablehnungen oder ungefilterten Nachrichten. Diese Schicht ergänzt einen weiteren Dienst, der den Text verarbeitet. Verwende den für deine Organisation freigegebenen Anbieter und Endpunkt.

## Organisationsanweisungen festlegen

Benutzerdefinierte Organisationsanweisungen werden vor den Anweisungen des Chat-Assistenten und vor den eigenen Anweisungen jedes Agenten eingefügt: bei Projekt-Agenten, die Aufgaben bearbeiten, und bei Agent-Knoten in Automatisierungen. Mitglieder können diese Organisationsrichtlinie nicht bearbeiten. Nutze sie für gemeinsames Verhalten und Begriffe. Für unabhängig durchzusetzende Einschränkungen verwendest du Zugriffsregeln und Filter, statt dich auf die Befolgung von Textanweisungen zu verlassen.

## Prüfen und abstimmen

Die aktuellen Ereignisse zeigen die letzten 50 Erkennungen, Blockierungen und Anbieterfehler. Filtere nach Schicht oder Ergebnis und prüfe Kategorie, Richtung und Zeitpunkt. Der erkannte Originaltext wird in diesen Ereignissen nicht gespeichert. Eine Zeile erklärt den Treffer, ohne seinen sensiblen Inhalt wiederzugeben.

Ist eine Regel zu weit gefasst, passe Kategorie oder Muster an und wiederhole die Tests. Fehlt ein Treffer, prüfe, ob Schicht, Kategorie und gewünschte Richtung aktiv sind. Wie lange Ereignisse erhalten bleiben, hängt von der Kategorie **Chat-Filter-Ereignisse** der [Aufbewahrungsrichtlinie](/de/platform/admin/governance/policies-and-limits) ab. Standardmäßig ist sie aus, und Ereignisse bleiben erhalten, bis ein Admin sie aktiviert. Ist sie aktiv, löscht die geplante Bereinigung Ereignisse, die älter sind als ihr Zeitraum plus die Schonfrist für Löschungen, bis zu 50.000 pro Nacht; ein größerer Rückstand, etwa Ereignisse aus Monaten beim ersten Aktivieren, wird über mehrere Nächte abgebaut. Die letzten Ereignisse und die Guardrail-Zahlen unter **Einstellungen > Metriken > Chat-Zustand** zeigen nur die noch aufbewahrten Ereignisse: Sind Zeitraum und Schonfrist zusammen kürzer als 30 Tage, bleibt der ältere Teil einer 30-Tage-Ansicht leer.

Ein [Legal Hold](/de/platform/admin/governance/legal-hold) schützt Ereignisse vor der Bereinigung: Eine Organisationssperre bewahrt alle Ereignisse, eine Mitgliedssperre die Ereignisse aus den Chats dieses Mitglieds. Ein Ereignis, dessen Chat schon vor der Sperre endgültig gelöscht wurde, hat keinen Besitzer mehr, den die Sperre schützen könnte, und bleibt nicht erhalten.
