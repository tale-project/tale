---
title: Richtlinien und Limits
description: Lege Budgets, Uploadregeln, Aufbewahrung, Funktionskontrollen, einen Vertraulichkeitshinweis im Chat und die Zuordnung eingehender Konversationen fest.
---

Als Admin oder Inhaber steuerst du unter **Einstellungen > Richtlinien > Richtlinien & Limits** Ressourcenverbrauch und Datenverarbeitung. Wähle den Bereich für dein Anliegen: Ausgaben, Uploads, Aufbewahrung, Funktionsverfügbarkeit, den Hinweis im Chat oder die Zuständigkeit für eingehende Konversationen.

<Frame caption="Richtlinien > Richtlinien & Limits — die Tabelle der Budget-Regeln über der Upload-Richtlinie und den Aufbewahrungs-Kontrollen.">

![Die Einstellungsseite Richtlinien und Limits zeigt drei monatliche Budget-Regeln — eine für die gesamte Organisation, eine als Standard für alle Benutzer und eine für die Rolle Entwickler, jede mit Obergrenzen für Tokens, Kosten und Anfragen — über den Feldern der Upload-Richtlinie für erlaubte Dateitypen, Größen und Volumen.](/images/platform/governance-policies-limits.webp)

</Frame>

## Ein Ausgabenbudget hinzufügen

1. Wähle unter **Budgetregeln** die Aktion **Regel hinzufügen**.
2. Wähle Bereich und Ziel. Nutze eine Rolle für eine Gruppe wie Redakteure, ein Team für gemeinsame Arbeit, eine Person für ein individuelles Limit, einen API-Schlüssel für einzelne Zugangsdaten oder die Organisation für eine gemeinsame Obergrenze.
3. Wähle einen täglichen, wöchentlichen oder monatlichen Zeitraum. Setze mindestens ein positives Token-, Kosten- oder Anfragelimit. Kosten gibst du in USD an; ein leeres Feld begrenzt diese Größe durch die Regel nicht.
4. Setze bei Bedarf **Warnschwelle (%)** zwischen 0 und 100, um vor Erreichen des Limits zu warnen.
5. Wähle **Bestätigen**, speichere die ausstehenden Seitenänderungen und prüfe Bereich, Ziel, Zeitraum und Limits der gespeicherten Regel.

Eine monatliche Rollenregel könnte Redakteuren beispielsweise ein persönliches Ausgabenlimit von 50 USD geben, während eine Organisationsregel die gemeinsamen Ausgaben auf 500 USD begrenzt. Das sind Beispielbeträge, keine empfohlenen Standardwerte.

Budgets gelten für neue kostenpflichtige Arbeit, einschließlich Chat und verwalteter Agentenläufe. Bilderzeugung braucht Kosten- oder Anfragelimits, weil ihre Nutzung nicht in Texttokens gemessen wird. Untersuche Warnungen in der [Nutzungsanalyse](/de/platform/admin/governance/usage-analytics).

## Verstehen, welche Grenzen gelten

Persönliche Limits werden für jede Größe aus der spezifischsten Regel ermittelt, die sie festlegt: zuerst Person, dann Team, Rolle und Standard. Organisationslimits gelten zusätzlich. Ein Teambudget begrenzt auch die gemeinsame Nutzung des Teams, selbst wenn ein Mitglied eine spezifischere persönliche Regel hat. API-Schlüssellimits begrenzen unabhängig die mit diesem Schlüssel authentifizierten Anfragen, nicht andere Arbeit in der Oberfläche.

Wird eine Anfrage unerwartet abgelehnt, prüfe alle passenden Grenzen und Zeiträume. Ein höheres persönliches Limit hebt keine Organisations-, Team- oder API-Schlüsselgrenze auf.

Mitglieder sehen ihren eigenen Stand unter [Einstellungen > Nutzung](/de/platform/member/preferences#usage-limits). Dort steht jede persönliche, Team- und Organisationsgrenze, die für sie gilt, mit aktueller Nutzung und nächstem Zurücksetzen. Die Regeln selbst sehen sie dort nicht.

## Uploads steuern

Die Uploadrichtlinie legt erlaubte und gesperrte Dateiendungen, erlaubte MIME-Typen, die maximale Dateigröße in MB und das Gesamtvolumen pro Person in GB fest. Wähle die benötigten Typen und teste nach dem Speichern eine erlaubte und eine abgelehnte Datei.

Dateiendung, Inhaltstyp und Größe sind getrennte Prüfungen. Vergleiche bei einem Fehler alle drei mit der Richtlinie. Prüfe den schon belegten Speicher der Person, wenn einzelne Dateien passen, weitere Uploads aber scheitern.

## Aufbewahrung und Wiederherstellung festlegen

Wähle im Bereich der Aufbewahrungsrichtlinie **Bearbeiten** und richte die benötigten Kategorien ein. Die Übersicht zeigt wirksame Werte, deaktivierte Kategorien und die Bereinigung temporärer Dateien. Eine deaktivierte geplante Aufbewahrung verhindert keine ausdrückliche Löschung oder Löschanfrage.

Prüfe vor einer Änderung die Mindest- und Höchstgrenzen des Deployments. Änderungen mit Prüfung oder Wartezeit erscheinen als Vorschläge oder vorgemerkte Änderungen. Lies ihren Wirksamkeitszeitpunkt, statt von einer sofortigen Anwendung auszugehen.

Die Schonfrist für Löschungen ist das Wiederherstellungsfenster unterstützter vorläufig gelöschter Datensätze. Ein positiver Wert lässt Zeit für die Wiederherstellung im [Papierkorb](/de/platform/admin/governance/trash); null erlaubt die sofortige endgültige Bereinigung. Nicht jede Kategorie lässt sich wiederherstellen. Ein [Legal Hold](/de/platform/admin/governance/legal-hold) schützt betroffene Daten vor Bereinigung.

Für selbst gehostete Deployments beschreibt die [Aufbewahrungskonfiguration](/de/self-hosted/configuration/retention) Betreiberkontrollen und Unterschiede zwischen Kategorien. Leite aus einer deaktivierten Richtlinie oder einem angezeigten Zeitraum allein keine Archivgarantie ab.

## Funktionskontrollen prüfen

Funktionskontrollen umfassen bereichsspezifische Kontextlimits und den organisationsweiten Schalter für Sprachausgabe. Ein Kontextlimit bestimmt, wie viel Kontext eine KI-Antwort erreicht. Es ist etwas anderes als ein Ausgabenbudget. Ist die Sprachausgabe ausgeschaltet, können Mitglieder sie weder über eigene Standardwerte noch einzelne Konversationen aktivieren.

Die Standardschalter für benutzerdefinierte Anweisungen und Erinnerungen speichern Organisationsvorgaben. Ihre Anzeige bedeutet nicht, dass persönliche Anweisungen oder das Erzeugen von Erinnerungen bereits im Chat aktiv sind. Verbindliche Organisationsanweisungen stehen separat unter [Guardrails](/de/platform/admin/governance/guardrails).

## Einen Vertraulichkeitshinweis im Chat anzeigen

**Vertraulichkeitshinweis** blendet für alle Mitglieder deiner Organisation eine kurze Zeile unter dem Nachrichtenfeld im Chat ein, etwa die Erinnerung, keine sensiblen Daten zu teilen. Der Hinweis bleibt aus, bis du ihn einschaltest.

1. Schalte **Vertraulichkeitshinweis** ein. Mitglieder sehen den Hinweis sofort im Chat, in ihrer Sprache; geöffnete Chats aktualisieren sich ohne Neuladen.
2. Gib bei Bedarf in den Sprach-Tabs **English**, **Deutsch** und **Français** eigene Texte mit jeweils höchstens 280 Zeichen ein. Speichere danach die ausstehenden Seitenänderungen.

<Frame caption="Richtlinien > Richtlinien & Limits — der Vertraulichkeitshinweis ist eingeschaltet, mit englischem Text, deutscher Übersetzung und noch nicht übersetztem Französisch.">

![Der Bereich Vertraulichkeitshinweis mit eingeschaltetem Schalter und gewähltem Tab English: Der Hinweis fordert dazu auf, keine Kundennamen, Vertragswerte oder Codenamen unveröffentlichter Projekte in den Chat einzufügen; der Tab Français ist als nicht übersetzt markiert.](/images/platform/governance-confidentiality-notice.webp)

</Frame>

Mitglieder sehen den Text in ihrer Sprache. Ein Tab mit der Markierung **nicht übersetzt** hat keinen eigenen Text: Mitglieder mit dieser Sprache sehen deinen englischen Text oder, wenn auch dieser fehlt, den Standardhinweis, und das leere Feld zeigt diesen Text als Vorschau. Ein roter Punkt markiert eine Sprache mit zu langem Text; Speichern ist erst wieder möglich, wenn du ihn kürzt. Schaltest du den Hinweis aus, bleiben deine Texte für das nächste Einschalten erhalten.

Der Hinweis ist nur eine Erinnerung. Er prüft, blockiert oder verändert keine Nachrichten. Um auf sensible Inhalte zu reagieren, richte [Guardrails](/de/platform/admin/governance/guardrails) ein.

## Konversations-Routing

Mit dem Konversations-Routing ordnest du neue eingehende Konversationen anhand der Empfängeradresse zu. Füge eine Regel hinzu, wähle ein Team, eine Person oder beides und speichere. Die Adressprüfung ignoriert Groß- und Kleinschreibung.

Bei Teamzuordnung sehen die Teammitglieder die Konversation, bei Personenzuordnung diese Person. Sind beide gesetzt, genügt eine der Zuordnungen für den Zugriff. Nicht zugewiesene Konversationen sortieren Admins und Inhaber ein.

Regeln greifen beim Eintreffen einer neuen Konversation. Sie ändern keine bestehende Zuordnung, wenn eine Antwort hinzugefügt wird. Verweist eine Regel auf eine gelöschte Person oder ein gelöschtes Team, kommt die Konversation trotzdem ohne diese Routing-Zuordnung an. Teste mit einer neuen Nachricht an die Empfängeradresse und prüfe die entstandene Zuständigkeit.

## Anmeldelimits separat einrichten

Passwortanforderungen, Anmeldeversuchslimits, Sitzungs-Inaktivitätslimit und [Zwei-Faktor-Richtlinie](/de/platform/admin/two-factor-authentication) stehen unter **Einstellungen > Richtlinien > Sicherheit**. Ein Organisations-Inaktivitätslimit kann die Deployment-Grenze verschärfen. Bei Trusted-Header-Authentifizierung stimme das Sitzungsende mit Proxy oder Identitätsanbieter ab, da diese das Mitglied erneut authentifizieren können.
