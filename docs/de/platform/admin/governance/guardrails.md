---
title: Guardrails
description: Die drei Filterebenen — Inhaltssicherheit, PII-Erkennung und ein Moderationsanbieter — die Chat-Eingaben und -Ausgaben vor und nach dem Modell prüfen. Admins und Inhaber lesen das, wenn ein Regulierer eine Inhaltsregel benennt oder wenn ein Leck eine strengere Richtlinie rechtfertigt.
---

Guardrails ist die Oberfläche, auf der du die drei Filterebenen konfigurierst, die Tale auf jede Chat-Nachricht in deiner Organisation anwendet. Jede Nachricht durchläuft Inhaltssicherheit (Wortlisten und Admin-Regex), dann PII-Erkennung (eingebaute Muster plus eigene), dann einen optionalen externen Moderationsanbieter — in dieser festen Reihenfolge, auf dem Weg hinein und auf dem Weg hinaus. Admins und Inhaber lesen diese Seite, wenn ein Regulierer eine Inhaltsregel benennt, wenn ein Leck eine strengere Richtlinie rechtfertigt, oder wenn die Antworten eines Agents bereinigt werden müssen, bevor sie das Modell verlassen.

<Frame caption="Governance > Guardrails — die drei Status-Karten der Filterebenen (Inhaltssicherheit, PII-Erkennung, Moderationsanbieter) über dem Log der letzten Ereignisse.">

![Die Governance-Seite Guardrails zeigt drei Status-Karten — Inhaltssicherheit greift auf Ein- und Ausgabe über zwei Kategorien, die PII-Erkennung läuft im Modus mask über vier eingebaute Muster, und der Moderationsanbieter steht auf Deaktiviert, ohne konfigurierte externe API — über dem Feed der letzten Ereignisse, der noch keine Ereignisse meldet.](/images/platform/governance-guardrails.webp)

</Frame>

## Eine durchgespielte Schichtung

Um die Ebenen zu konfigurieren, öffne **Einstellungen > Richtlinien > Guardrails**. Die Übersicht zeigt drei Status-Karten, eine pro Ebene — Inhaltssicherheit, PII-Erkennung, Moderation — und der Editor jeder Ebene sitzt weiter unten auf derselben Seite; dort wählst du, ob die Ebene auf Eingaben, Ausgaben oder beidem läuft und was sie bei einem Treffer tut. Auch die verpflichtenden Custom-Anweisungen der Organisation leben hier — sie binden jeden Agent und gehören darum zu den Inhalts-Kontrollen. Die Tabelle der letzten Ereignisse unter der Übersicht zeigt die letzten 50 Erkennungen, Blockaden und Anbieter-Fehler mit ihrer Ebene, ihrer Richtung und ihrer Treffer-Kategorie.

## Inhaltssicherheit

Inhaltssicherheit ist die Ebene, die du selbst besitzt. Definiere eine oder mehrere Kategorien — Hassrede, Profanität, eine eigene Regex für einen internen Codenamen — und wähle einen Modus pro Kategorie: **Blockieren** lehnt die Nachricht ab, **Maskieren** ersetzt Treffer durch einen Platzhalter, **Markieren** vermerkt die Erkennung, ohne die Nachricht zu ändern. Blockieren schlägt Maskieren schlägt Markieren, wenn mehr als eine Kategorie greift.

Die Wortlisten und Muster dieser Ebene verlassen das Deployment nie. Getroffener Text wird nicht gespeichert — nur die Kategorie, die Richtung (Eingabe oder Ausgabe) und die Trefferanzahl landen im Audit-Ereignis.

## PII-Erkennung

PII-Erkennung bringt Muster für E-Mails, Telefonnummern, Behörden-IDs, Zahlungsnummern und eine lange Liste regionaler Formate mit. Füge eigene Muster hinzu, wenn dein Regulierer ein Format benennt, das die eingebauten verfehlen. Wähle einen Modus — Blockieren, Maskieren mit einem Platzhalter, oder Tokenisieren, das PII auf dem Hinweg gegen indizierte Token tauscht und sie in der Antwort des Modells wiederherstellt. Maskieren ist die typische Wahl, wenn das Modell Zugriff auf Datensätze mit PII bekommen hat, die es nicht zurückspielen soll.

## Moderationsanbieter

Die Moderationsebene ist ein externer Klassifikator — OpenAI Moderation, Azure Content Safety, Perspective API oder ein eigener HTTP-Endpunkt. Konfiguriere den Endpunkt des Anbieters, einen API-Key und das Kategorie-zu-Aktion-Mapping (jeder Anbieter liefert seine eigene Taxonomie zurück; das Mapping entscheidet, welche Kategorien blockieren, maskieren oder markieren). Die Ebene ist optional — lass sie deaktiviert und nur die ersten zwei Ebenen laufen.

Der Anbieter sitzt auf dem Egress-Netzwerkpfad. Ausfälle sind pro Richtung konfigurierbar: Fail-open lässt die Nachricht durch, Fail-closed lehnt sie ab. Die Ansicht der letzten Ereignisse zeigt Anbieter-Fehler, HTTP-Statuscodes und Circuit-Open-Ereignisse, wenn die Ebene gerate-limited ist.

## Letzte Ereignisse

Jede Erkennung, Blockade und jeder Anbieter-Fehler landet in der Tabelle der letzten Ereignisse — standardmäßig 90 Tage aufbewahrt, einstellbar auf der Seite zur Aufbewahrungsrichtlinie. Filtere nach Ebene oder nach Art; jede Zeile trägt die getroffenen Kategorien, den Akteur und den Zeitstempel. Getroffener Roh-Text wird nie gespeichert — die Ereignisse sind eine Tuning-Oberfläche, kein Inhalts-Archiv.

## Wo das hingehört

Guardrails ist der Laufzeit-Filter zwischen Benutzer und Modell in beide Richtungen. Paare das mit [Inhalte und Modelle](/de/platform/admin/governance/content-models), sodass ein freigegebenes Modell auch den freigegebenen Inhaltsregeln unterliegt. Die Begleitseite ist das [Audit-Log](/de/platform/admin/governance/audit-logs) — jede Blockade und jede Maskierung der Guardrail-Ebenen landet dort als dauerhafte Aufzeichnung.
