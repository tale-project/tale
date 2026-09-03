---
title: Umgebungsvariablen & Geheimnisse
description: Dein persönlicher Speicher für Variablen und Geheimnisse unter Einstellungen > Umgebung — was er hält, wie Geheimnisse geschützt sind, und dass in dieser Version kein Lauf ihn liest.
---

Umgebungsvariablen & Geheimnisse ist ein persönlicher Speicher unter **Einstellungen > Umgebung**: benannte Werte, begrenzt auf dich und die aktuelle Organisation, mit einem Schalter **Geheim**, der einen Wert nur noch beschreibbar macht. Jede Rolle kann die Seite öffnen, und niemand sonst in der Organisation kann deine Einträge lesen. Was die Seite in dieser Version nicht tut, ist der Teil, den du kennen solltest, bevor du sie füllst: Nichts speist diese Einträge in einen Lauf ein. Kein Zug eines Projekt-Agents, keine Automation-Agent-Node und kein Skript liest sie — der Speicher bleibt erhalten, aber die Strecke, die sie in die Umgebung einer Sandbox setzen würde, ist nicht verdrahtet.

Diese Seite behandelt, was du speichern kannst, welche Regeln Name und Wert erfüllen müssen, und woher die Werte stattdessen kommen, die ein Lauf tatsächlich bekommt.

<Note>

Persönliche Umgebungsvariablen werden in dieser Version gespeichert, aber in keine Sandbox eingespeist. Die Beschreibung der Seite spricht noch von Einspeisung; behandle den Speicher als wirkungslos, bis eine Release-Notiz etwas anderes sagt. Ein Wert, den ein Projekt-Agent braucht, gehört in seine **Secrets** — siehe unten.

</Note>

<Frame caption="Einstellungen > Umgebung — die gespeicherten Einträge, jeder mit dem Schalter Geheim, der entscheidet, ob sein Wert zurückgelesen werden kann.">

![Die Umgebungs-Einstellungsseite listet drei gespeicherte Einträge — ANALYTICS_ORG und CRM_BASE_URL mit offen sichtbaren Werten und CRM_API_TOKEN als Punkte maskiert, mit angehaktem Kästchen Geheim — über der Aktion Variable hinzufügen.](/images/platform/settings-environment.webp)

</Frame>

## Variablen und Geheimnisse

Öffne **Einstellungen > Umgebung**. **Variable hinzufügen** fügt der Liste eine Zeile hinzu — Name, Wert und der Schalter **Geheim** —, und **Speichern** auf der Seite schreibt alle offenen Änderungen auf einmal. Eine einfache Variable wird unverändert gespeichert und in voller Länge zurückgezeigt. Ein Geheimnis wird im Moment des Speicherns verschlüsselt und ist von da an nur noch beschreibbar: Die Liste zeigt `••••••••` an seiner Stelle, und es gibt keinen Weg, den Wert zurückzulesen. Bist du dir unsicher, ob ein Geheimnis stimmt, ersetz es, statt nach einem Anzeigen-Knopf zu suchen, den es nicht gibt. **Entfernen** an einer Zeile fragt nach — _Variable entfernen?_ — und greift, wenn du speicherst.

## Namen, Werte und Grenzen

Ein Name muss mit einem Buchstaben oder Unterstrich beginnen und darf nur Buchstaben, Ziffern und Unterstriche enthalten — die Form einer gewöhnlichen Umgebungsvariable, `MY_API_KEY` statt `my-api.key`. Ein Name, der die Regel bricht, wird beim Speichern abgewiesen, ein doppelter ebenso. Namen sind auf 128 Zeichen begrenzt, Werte auf 8.192, und du kannst bis zu 100 Einträge halten. Werte werden genau so gespeichert, wie du sie eingibst: Nichts schneidet ein verirrtes Leerzeichen oder einen Zeilenumbruch aus einem eingefügten Token heraus — prüf das Eingefügte, bevor du speicherst.

## Was ein Lauf stattdessen bekommt

Die Werte, die eine Sandbox tatsächlich hält, kommen aus drei Quellen, und keine davon ist diese Seite. Ein **Projekt-Agent** trägt die **Secrets** der Organisation — einen API-Schlüssel, den der Agent als Umgebungsvariable bekommt, pro Lauf eingespeist und danach weg; das ist der Weg für ein Token, das ein Dienst ohne Connector braucht, und [Projekt-Agenten](/de/platform/projects/project-agents) beschreibt ihn. Ein GitHub-Token kommt pro Lauf, solange der Agent den GitHub-Connector ausgerüstet hat. Und der Zugang, mit dem ein Zug sein Modell erreicht, gehört zu den Provider-Einträgen der Organisation unter [KI-Anbieter](/de/platform/admin/providers), wo er an einer Stelle rotiert und geprüft wird — ein Agent hält keine eigenen Schlüssel.

## Wo das hingehört

Umgebungsvariablen & Geheimnisse ist in dieser Version ein Speicher ohne Abnehmer: Einträge liegen pro Mitglied und pro Organisation, Geheimnisse sind verschlüsselt und nur beschreibbar, und kein Lauf liest sie. Leg, was ein Projekt-Agent braucht, in seine **Secrets**, und lies [Harnesses](/de/platform/agents/harnesses), wo steht, was der Container sonst noch hält und was er erreichen darf. Für den Rest deiner persönlichen Einstellungen — Anzeigename, Passwort, eigene Anweisungen — siehe [Einstellungen](/de/platform/member/preferences).
