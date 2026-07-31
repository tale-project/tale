---
title: Umgebungsvariablen & Geheimnisse
description: Deine persönlichen Umgebungsvariablen und Geheimnisse, die Tale in jede Sandbox einspeist, die du in einer Organisation startest, und die sonst niemand lesen kann.
---

Umgebungsvariablen & Geheimnisse ist dein persönlicher Speicher für Variablen, die Tale in jede Sandbox einspeist, die du in dieser Organisation startest. Startet ein [Projekt-Agent oder Automation-Agent-Knoten](/de/platform/agents/harnesses) einen Harness-Zug, setzt Tale jeden hier gespeicherten Eintrag in die Umgebung, bevor der Agent läuft — ein Befehl, den der Agent absetzt, oder der Agent selbst kann ihn dann lesen. Greif dazu, wenn die Arbeit etwas von dir braucht, das sonst niemand halten soll: ein persönliches API-Token für einen Dienst, den die Organisation nicht angebunden hat, einen Endpunkt, der bei dir anders ist, einen Schlüssel, der an dein eigenes Konto hängt. Es ist eine Seite auf Mitglieds-Ebene, die jede Rolle erreicht, und die Einträge sind auf dich und die aktuelle Organisation begrenzt — sie dringen nie zu Teamkolleginnen durch und folgen dir nie in eine andere Organisation.

Diese Seite zeigt die zwei Arten von Eintrag, wie Geheimnisse geschützt werden, welche Regeln Name und Wert erfüllen müssen, und wo die Werte landen.

<Frame caption="Einstellungen > Umgebung — die gespeicherten Einträge, jeder mit dem Schalter Geheim, der entscheidet, ob sein Wert zurückgelesen werden kann.">

![Die Umgebungs-Einstellungsseite listet drei gespeicherte Einträge — ANALYTICS_ORG und CRM_BASE_URL mit offen sichtbaren Werten und CRM_API_TOKEN als Punkte maskiert, mit angehaktem Kästchen Geheim — über der Aktion Variable hinzufügen.](/images/platform/settings-environment.webp)

</Frame>

## Variablen und Geheimnisse

Öffne **Einstellungen > Umgebung**. **Variable hinzufügen** öffnet einen Dialog für einen neuen Eintrag, darunter steht die Liste dessen, was du gespeichert hast. Jeder Eintrag hat einen **Name** und einen **Wert**, dazu einen **Geheimnis**-Schalter, der entscheidet, wie der Wert gespeichert und angezeigt wird.

Eine einfache Variable wird unverändert gespeichert und in der Liste in voller Länge zurückgezeigt — nimm sie für unkritische Konfiguration, die der Agent erwartet, einen Regionsnamen oder einen Endpunkt. Ein **Geheimnis** wird im Moment des Speicherns verschlüsselt und ist von da an schreibgeschützt: Die Liste zeigt `••••••••` statt des Werts, und es gibt keinen Weg, ihn zurückzulesen. Schalt den Schalter für alles Sensible ein — einen API-Schlüssel, einen OAuth-Token, ein Passwort. Der Preis dafür ist, dass du den Wert eines Geheimnisses später nicht mehr prüfen kannst: Bist du dir unsicher, ob er stimmt, lösch ihn und füg ihn neu hinzu, statt nach einem Anzeigen-Knopf zu suchen, den es nicht gibt.

Jede Zeile trägt den Namen, den Wert oder seine Maske, und wann er zuletzt aktualisiert wurde. Das Papierkorb-Symbol fragt vor dem Entfernen nach Bestätigung, denn einen Eintrag zu löschen nimmt ihn beim nächsten Lauf aus jeder deiner Sandboxes.

## Namen, Werte und Grenzen

Ein **Name** muss mit einem Buchstaben oder Unterstrich beginnen und darf nur Buchstaben, Ziffern und Unterstriche enthalten — die Form einer gewöhnlichen Umgebungsvariable, `MY_API_KEY` statt `my-api.key`. Namen sind auf 128 Zeichen begrenzt, Werte auf 8.192 — Platz für einen langen Token oder einen mehrzeiligen Schlüssel, aber nicht für eine Datei. Du kannst bis zu 100 Einträge halten.

Tale schneidet Leerzeichen am Anfang und Ende eines Werts beim Speichern ab, denn ein versehentlicher Zeilenumbruch aus dem Kopieren ist der häufigste Grund, warum ein Token still fehlschlägt. Leerzeichen oder Zeilenumbrüche _innerhalb_ des Werts bleiben unangetastet, aber Tale warnt, wenn es welche findet: Anmeldedaten haben normalerweise keine, also bedeutet Leerraum im Inneren meist, dass ein Token beim Einfügen über mehrere Zeilen in deinem Terminal umbrochen wurde. Die Warnung blockiert das Speichern nicht — ein echt mehrzeiliges Geheimnis wie ein privater PEM-Schlüssel behält seine Zeilenumbrüche —, also lies sie und entscheide selbst.

## Wie die Werte in die Sandbox kommen

Ein Geheimnis reist nie im Klartext, außer in deine eigene Sandbox. In Ruhe liegt es im Backend von Tale verschlüsselt, unter einem Schlüssel, den die Plattform hält, und die Listen-Abfrage liefert nur die Maske zurück, nie den Klartext. Beginnt ein Turn, entschlüsselt die Plattform deine Geheimnisse und setzt sie, neben deinen einfachen Variablen, in die Umgebung deiner Sandbox für diesen Lauf. Wird ein Geheimnis für einen Turn eingespeist, hält das Audit-Log diesen Zugriff fest.

Dieser letzte Schritt ist die Grenze, die es zu verstehen lohnt: Die Werte landen in deinem Sandbox-Container, also ist die Isolation der Sandbox — nicht der Geheimnis-Speicher —, was zwischen deinen Anmeldedaten und allem anderen steht, das dort läuft. Das deckt sich damit, wie der GitHub-Token in der Sandbox funktioniert, und ist der Grund, warum diese Einträge nur auf dich begrenzt sind statt mit der Organisation geteilt.

Was nicht von hier kommt, ist der Zugang, mit dem ein Zug sein Modell erreicht. Der gehört zu den Provider-Einträgen der Organisation unter [Provider](/de/platform/admin/providers), wo er an einer Stelle rotiert und geprüft wird — ein Agent hält keine eigenen Schlüssel, und diese Seite auch nicht an seiner Stelle. Behalte diese Einträge für das, was deine eigene Arbeit braucht, und lass den Modell-Zugang dort, wo die Organisation ihn steuern kann.

## Wo das hingehört

Umgebungsvariablen & Geheimnisse ist die eine Seite auf Mitglieds-Ebene, die in die Sandbox reicht statt in den Chat — so kommen deine eigenen Schlüssel und deine Konfiguration zu der Arbeit, die du startest, ohne dass ein Redakteur oder Admin sie für dich setzt. Lies sie neben [Harnesses](/de/platform/agents/harnesses), wo steht, was der Container sonst noch hält und was er erreichen darf. Für den Rest deiner persönlichen Einstellungen — Anzeigename, Passwort, eigene Anweisungen — siehe [Einstellungen](/de/platform/member/preferences).
