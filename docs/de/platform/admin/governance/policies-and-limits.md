---
title: Richtlinien und Limits
description: Per-Org-Limits für Token-Kosten, Anzahl Anfragen, Upload-Größe, Bildgenerierung und Feature-Zugriff — skopiert nach Benutzer, Team oder Rolle. Admins und Inhaber lesen das, wenn eine Last über Budget ist oder wenn ein Feature einen engeren Radius braucht.
---

Richtlinien und Limits ist die Oberfläche, auf der du deckelst, was deine Mitglieder und Agents verbrauchen können. Budgets deckeln Tokens, Kosten und Anfragen pro Abrechnungsperiode; Feature-Kontrollen schalten Web-Suche, Code-Ausführung und Datei-Upload pro Bereich um; Upload-Richtlinie regelt Dateitypen und Größen, die ein Mitglied anhängen darf; Aufbewahrungsrichtlinie entscheidet, wie lange jeder Datentyp lebt, bevor Cleanup eingreift. Admins und Inhaber lesen diese Seite, wenn eine Last über Budget ist, wenn ein Feature für eine Untermenge von Benutzern aus sein soll, oder wenn ein Regulierer ein Aufbewahrungsfenster benennt, das vom Default abweicht.

## Ein durchgespieltes Budget

Um die monatlichen Ausgaben eines Redakteurs zu deckeln, öffne **Einstellungen > Governance > Budgets** und klick auf **Regel hinzufügen**. Wähle **Rolle** als Bereich, **Redakteur** als Ziel, setze die Periode auf **Monatlich** und trage einen Höchstbetrag in USD ein. Speichern, und die nächste Monats-Periode-Anfrage, die einen Redakteur über das Limit drücken würde, wird mit einem Budget-überschritten-Fehler abgelehnt. Eine Warnschwelle unter dem Limit löst eine Warnung aus, bevor das Limit erreicht wird. Engere Bereiche übersteuern weitere — eine Benutzerregel schlägt eine Team-Regel schlägt eine Rollen-Regel — und org-weite Limits wirken immer zusätzlich obendrauf.

## Die vier Richtlinienebenen

**Budgets** sind Token-, Kosten- und Anfragen-Limits pro Bereich und Periode. Bereiche sind Organisation, Rolle, Team oder Benutzer. Jede Regel trägt ein Token-Limit, ein Kosten-Limit in USD, ein optionales Anfragen-Limit und eine Warnschwelle als Prozentwert des Limits.

**Feature-Kontrollen** schalten Web-Suche, Code-Ausführung und Datei-Upload pro Bereich um und deckeln die maximalen Kontext-Tokens für AI-Antworten. Ein Feature, das für einen Bereich aus ist, blendet die Schaltfläche im Chat aus und lehnt die Anfrage serverseitig ab.

**Upload-Richtlinie** regelt Dateierweiterungen, MIME-Typen und Größen, die ein Mitglied anhängen darf. Sie deckelt zudem das Gesamtvolumen pro Benutzer — nützlich, wenn Speicher gemessen wird. Schalte die Richtlinie aus für einen permissiven Default; schalte sie ein, um die Listen durchzusetzen.

**Aufbewahrungsrichtlinie** entscheidet, wie lange jeder Datentyp (Chatverlauf, Dokumente, Prompts, Audit-Logs, Nutzungsbuch, Workflow-Läufe und mehr) bleibt, bevor der Cleanup-Lauf die Zeile entfernt. Die Seite zeigt die vom Betreiber gesetzten Grenzen, die Per-Org-Überschreibung innerhalb dieser Grenzen und ein Kulanzfenster vor der harten Löschung.

## Vorrang

Alle vier Ebenen teilen sich dieselbe Bereichsleiter: Benutzer > Team > Rolle > Organisation > Default. Die engste Regel gewinnt. Wo eine Ebene ein org-weites Limit trägt (Budgets), wirkt das Limit als zusätzliche Decke über jeder engeren Regel.

## Aufbewahrungs-Grenzen und Freigaben

Die Aufbewahrungsrichtlinie sitzt innerhalb von Grenzen, die der Betreiber gesetzt hat — der Selbsthosting-Betreiber setzt eine Untergrenze und eine Obergrenze pro Kategorie, und der Org-Wert klemmt auf diesen Bereich. Wenn der Betreiber eine engere Untergrenze oder eine niedrigere Obergrenze vorschlägt, erscheint die Änderung als Vorschlag, den Admins anwenden oder ablehnen können. Reduzierungen der Richtlinie landen mit einem Pending-Banner und einem Kulanzfenster, bevor sie wirken — dieselbe Kulanz gibt Admins die Möglichkeit, abzubrechen.

## Wo das hingehört

Richtlinien und Limits ist die Budget- und Schleusen-Ebene, die die Organisation vor entgleitenden Ausgaben und unbeabsichtigtem Zugriff schützt. Paare das mit [Inhalte und Modelle](/de/platform/admin/governance/content-models), sodass das vom Budget gedeckelte Modell auch das ist, das die Zugriffsliste erlaubt, und mit [Aufbewahrungsrichtlinie auf derselben Seite](#aufbewahrungs-grenzen-und-freigaben), sodass die Daten, die die Organisation behält, ebenfalls begrenzt sind. Die Begleitseite ist [Audit-Logs](/de/platform/admin/governance/audit-logs) — jede Richtlinienänderung hier landet dort als dauerhafte Aufzeichnung.
