---
title: Schutzregeln
description: Richte Chatfilter, den Schutz personenbezogener Daten und Moderation ein und prüfe Erkennungen und Fehler.
---

Als Admin oder Inhaber steuerst du unter **Einstellungen > Richtlinien > Guardrails**, wie Chattexte vor und nach einem Modellaufruf geprüft werden. Aktivierte Schichten laufen in dieser Reihenfolge: Inhaltssicherheit, Erkennung personenbezogener Daten und externe Moderation. Beginne mit einer klaren Regel und prüfe ihre Wirkung, bevor du sie ausweitest.

<Frame caption="Governance > Guardrails — die drei Status-Karten der Filterebenen (Inhaltssicherheit, PII-Erkennung, Moderationsanbieter) über dem Log der letzten Ereignisse.">

![Die Governance-Seite Guardrails zeigt drei Status-Karten — Inhaltssicherheit aus, PII-Erkennung aus, Moderations-Anbieter nicht konfiguriert — über dem Feed der letzten Ereignisse, der noch keine meldet, und den benutzerdefinierten Anweisungen der Organisation.](/images/platform/governance-guardrails.webp)

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

Maskieren entfernt erkannte Werte aus dem weitergegebenen Text. Blockieren lehnt einen Treffer ab. Tokenisierung ersetzt die Werte für das Modell durch nummerierte Tokens und stellt sie in der Antwort wieder her. Sie kann die Verarbeitung mit weniger offengelegten Daten unterstützen, verspricht aber keine Antwort ohne personenbezogene Daten.

Teste die tatsächlich verwendeten Formate mit erfundenen Werten. Muster können ungewöhnliche Formate übersehen oder normalen Text fälschlich markieren. Prüfe Eingabe und Ausgabe getrennt.

## Externe Moderation ergänzen

Die Moderationsschicht sendet Text an einen konfigurierten Klassifikator, etwa OpenAI, Azure, Perspective oder einen eigenen Endpunkt. Richte Zugangsdaten, Kategorien und Aktionen ein und wähle, welche Richtung geprüft werden soll.

Lege das Verhalten bei Nichterreichbarkeit fest: Fail-open lässt die Nachricht durch, Fail-closed lehnt sie ab. Prüfe Anbieterfehler und Ereignisse einer geöffneten Schutzschaltung bei unerwarteten Ablehnungen oder ungefilterten Nachrichten. Diese Schicht ergänzt einen weiteren Dienst, der den Text verarbeitet. Verwende den für deine Organisation freigegebenen Anbieter und Endpunkt.

## Organisationsanweisungen festlegen

Benutzerdefinierte Organisationsanweisungen werden vor den Agentenanweisungen eingefügt. Mitglieder können diese Organisationsrichtlinie nicht bearbeiten. Nutze sie für gemeinsames Verhalten und Begriffe. Für unabhängig durchzusetzende Einschränkungen verwendest du Zugriffsregeln und Filter, statt dich auf die Befolgung von Textanweisungen zu verlassen.

## Prüfen und abstimmen

Die aktuellen Ereignisse zeigen die letzten 50 Erkennungen, Blockierungen und Anbieterfehler. Filtere nach Schicht oder Ergebnis und prüfe Kategorie, Richtung und Zeitpunkt. Der erkannte Originaltext wird in diesen Ereignissen nicht gespeichert. Eine Zeile erklärt den Treffer, ohne seinen sensiblen Inhalt wiederzugeben.

Ist eine Regel zu weit gefasst, passe Kategorie oder Muster an und wiederhole die Tests. Fehlt ein Treffer, prüfe, ob Schicht, Kategorie und gewünschte Richtung aktiv sind. Die Historie hängt von der [Aufbewahrungsrichtlinie](/platform/admin/governance/policies-and-limits) für Chat-Filterereignisse ab. Gehe nicht von einer festen Archivdauer aus.
