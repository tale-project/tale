---
title: Richtlinien und Limits
description: Per-Org-Limits für Token-Kosten, Anzahl Anfragen, Upload-Größe, Bildgenerierung und Feature-Zugriff — eingegrenzt nach Benutzer, Team, Rolle oder einzelnem API-Schlüssel. Admins und Inhaber lesen das, wenn eine Last über Budget ist oder wenn ein Feature einen engeren Radius braucht.
---

Richtlinien und Limits ist die Oberfläche, auf der du deckelst, was deine Mitglieder und Agents verbrauchen können. Budgets deckeln Tokens, Kosten und Anfragen pro Abrechnungsperiode; Feature-Kontrollen schalten Web-Suche, Code-Ausführung und Datei-Upload pro Bereich um; Upload-Richtlinie regelt Dateitypen und Größen, die ein Mitglied anhängen darf; Aufbewahrungsrichtlinie entscheidet, wie lange jeder Datentyp lebt, bevor Cleanup eingreift. Admins und Inhaber lesen diese Seite, wenn eine Last über Budget ist, wenn ein Feature für eine Untermenge von Benutzern aus sein soll, oder wenn ein Regulierer ein Aufbewahrungsfenster benennt, das vom Default abweicht.

<Frame caption="Governance > Richtlinien & Limits — die Tabelle der Budget-Regeln über der Upload-Richtlinie und den Aufbewahrungs-Kontrollen.">

![Die Governance-Seite Richtlinien und Limits zeigt drei monatliche Budget-Regeln — eine für die gesamte Organisation, eine als Default für alle Benutzer und eine für die Rolle developer, jede mit Obergrenzen für Tokens, Kosten und Anfragen — über den Feldern der Upload-Richtlinie für erlaubte Dateitypen, Größen und Volumen.](/images/platform/governance-policies-limits.webp)

</Frame>

## Ein durchgespieltes Budget

Um die monatlichen Ausgaben eines Redakteurs zu deckeln, öffne **Einstellungen > Richtlinien > Budgets** und klick auf **Regel hinzufügen**. Wähle **Rolle** als Bereich, **Redakteur** als Ziel, setze die Periode auf **Monatlich** und trage einen Höchstbetrag in USD ein. Speichern, und die nächste Monats-Periode-Anfrage, die einen Redakteur über das Limit drücken würde, wird mit einem Budget-überschritten-Fehler abgelehnt. Eine Warnschwelle unter dem Limit löst eine Warnung aus, bevor das Limit erreicht wird. Engere Bereiche übersteuern weitere — eine Benutzerregel schlägt eine Team-Regel schlägt eine Rollen-Regel — und org-weite Limits wirken immer zusätzlich obendrauf.

## Die vier Richtlinienebenen

**Budgets** sind Token-, Kosten- und Anfragen-Limits pro Bereich und Periode. Bereiche sind Organisation, Rolle, Team, Benutzer oder API-Schlüssel. Jede Regel trägt ein Token-Limit, ein Kosten-Limit in USD, ein optionales Anfragen-Limit und eine Warnschwelle als Prozentwert des Limits. Eine API-Schlüssel-Regel zielt auf einen einzelnen ausgestellten Schlüssel (wähle **API-Schlüssel** als Bereich, dann den Schlüssel aus **Einstellungen > API**) und deckelt nur den mit diesem Schlüssel authentifizierten Traffic — die REST- und OpenAI-kompatible API — sodass du eine einzelne Connector messen kannst, ohne die In-App-Nutzung zu berühren. Bildgenerierung wird nach Kosten und Anzahl Anfragen gemessen, nicht nach Tokens — eine Bild-Anfrage meldet keine Tokens, also deckle Bild-Ausgaben mit dem Kosten- oder Anfragen-Limit, nicht mit dem Token-Limit.

**Feature-Kontrollen** schalten Web-Suche, Code-Ausführung und Datei-Upload pro Bereich um und deckeln die maximalen Kontext-Tokens für AI-Antworten. Ein Feature, das für einen Bereich aus ist, blendet die Schaltfläche im Chat aus und lehnt die Anfrage serverseitig ab.

**Upload-Richtlinie** regelt Dateierweiterungen, MIME-Typen und Größen, die ein Mitglied anhängen darf. Sie deckelt zudem das Gesamtvolumen pro Benutzer — nützlich, wenn Speicher gemessen wird. Schalte die Richtlinie aus für einen permissiven Default; schalte sie ein, um die Listen durchzusetzen.

**Aufbewahrungsrichtlinie** entscheidet, wie lange jeder Datentyp (Chatverlauf, Dokumente, Prompts, Audit-Logs, Nutzungsbuch, Workflow-Läufe und mehr) bleibt, bevor der Cleanup-Lauf die Zeile entfernt. Die Seite zeigt die vom Betreiber gesetzten Grenzen, die Per-Org-Überschreibung innerhalb dieser Grenzen und ein Kulanzfenster vor der harten Löschung.

## Vorrang

Alle vier Ebenen teilen sich dieselbe Bereichsleiter: Benutzer > Team > Rolle > Organisation > Default. Die engste Regel gewinnt. Wo eine Ebene ein org-weites Limit trägt (Budgets), wirkt das Limit als zusätzliche Decke über jeder engeren Regel. Ein API-Schlüssel-Budget steht außerhalb der Leiter als eigener, unabhängiger Topf: Es bindet den Traffic des Schlüssels selbst, unabhängig von den Benutzer-, Team- oder Org-Limits des Inhabers, sodass ein einzelner Schlüssel enger gedeckelt werden kann als die Person, die ihn ausgestellt hat.

## Aufbewahrungs-Grenzen und Freigaben

Die Aufbewahrungsrichtlinie sitzt innerhalb von Grenzen, die der Betreiber gesetzt hat — der Selbsthosting-Betreiber setzt eine Untergrenze und eine Obergrenze pro Kategorie, und der Org-Wert klemmt auf diesen Bereich. Wenn der Betreiber eine engere Untergrenze oder eine niedrigere Obergrenze vorschlägt, erscheint die Änderung als Vorschlag, den Admins anwenden oder ablehnen können. Reduzierungen der Richtlinie landen mit einem Pending-Banner und einem Kulanzfenster, bevor sie wirken — dieselbe Kulanz gibt Admins die Möglichkeit, abzubrechen.

## Sitzungs-Leerlaufzeit

Die Sitzungs-Leerlaufzeit meldet Mitglieder nach einer Phase der Inaktivität ab — die sitzungsgebundene Kontrolle, die Compliance-Rahmenwerke verlangen (SOC 2 CC6.1). Öffne **Einstellungen > Richtlinien > Sicherheit & Überwachung**, schalte **Sitzungs-Leerlaufzeit aktivieren** ein und setze **Leerlaufzeit (Minuten)** (1–1440, Standard 30). Mitglieder sehen kurz vor dem Ablauf eine Warnung; danach meldet sich der aktive Tab ab, und die Anmeldeseite erklärt die Abmeldung, statt nur ein leeres Formular zu zeigen.

Das Fenster kann das installationsweite Limit nur verkürzen, niemals verlängern. Selbsthosting-Betreiber setzen diese harte Obergrenze per Umgebungsvariable (siehe die [Umgebungsreferenz](/de/self-hosted/configuration/environment-reference)); die Org-Richtlinie wirkt obendrauf, und das engere der beiden Fenster gewinnt. Ein Mitglied mehrerer Organisationen bekommt das engste Fenster über alle seine Organisationen.

Die Durchsetzung hat zwei Hälften. Der Watchdog im Browser beendet offene, sichtbare Sitzungen auf die Minute. Geschlossene Tabs und liegen gelassene Geräte fängt serverseitig ein Widerrufs-Lauf ab, der etwa alle fünf Minuten läuft — eine Sitzung kann das Fenster also um einige Minuten überleben; wenn du die Kontrolle gegenüber einem Auditor benennst, rechne mit dem Fenster plus rund einer halben Stunde im schlechtesten Fall. Jeder serverseitige Widerruf landet als `session.idle_revoked` in den [Audit-Logs](/de/platform/admin/governance/audit-logs). Eine Einschränkung für Trusted-Headers-Deployments: dort besitzt der Reverse Proxy die Authentifizierung, eine widerrufene Sitzung entsteht also neu, sobald das Mitglied den Anmelde-Hinweis bestätigt — kombiniere die Richtlinie mit einer Leerlaufzeit auf Proxy- oder IdP-Seite für eine echte Sperre.

## Konversations-Routing

Eingehende Post landet unzugewiesen, sofern keine Routing-Regel sie beansprucht. Unter **Einstellungen > Governance > Richtlinien & Grenzen** öffnest du **Konversations-Routing** und legst eine Regel an, die eine Empfängeradresse einem Team, einer Person oder beiden zuordnet: Die nächste Konversation, die an dieser Adresse eintrifft, wird im Moment ihrer Erstellung zugewiesen, bevor jemand die Inbox öffnet. Eine Regel trifft auf die Adresse zu, an die die absendende Person geschrieben hat — das `An` der Konversation — und zwar unabhängig von Groß- und Kleinschreibung; eine Adresse ohne Regel bleibt unzugewiesen.

Die Sichtbarkeit ist eingebaut: eine einem Team zugewiesene Konversation ist nur für dessen Mitglieder sichtbar, eine einer Person zugewiesene nur für diese Person (bei beiden die Vereinigung). Wirklich unzugewiesene Konversationen — weder Person noch Team — sehen nur Admins und Inhaber, die sie sichten. Mitglieder und Redakteure sehen nur Arbeit, die in ihre Person- oder Team-Warteschlange geroutet oder zugewiesen wurde. Kombiniere Routing mit der Steuerung **Zuständig** in der Kopfzeile, damit eingehende Post in der richtigen Warteschlange landet. Routing weist nur zu; eine Konversation, die bereits eine Inhaberin oder ein Team hat, wird nie neu zugewiesen — eine Antwort, die sich in einen bestehenden Thread einreiht, bleibt also unberührt. Eine Regel, die auf ein zwischenzeitlich gelöschtes Team oder eine gelöschte Person zeigt, wird übersprungen — die Konversation trifft trotzdem ein, nur unzugewiesen für die Admin-Sichtung.

## Wo das hingehört

Richtlinien und Limits ist die Budget- und Schleusen-Ebene, die die Organisation vor entgleitenden Ausgaben und unbeabsichtigtem Zugriff schützt. Paare das mit [Inhalte und Modelle](/de/platform/admin/governance/content-models), sodass das vom Budget gedeckelte Modell auch das ist, das die Zugriffsliste erlaubt, und mit [Aufbewahrungsrichtlinie auf derselben Seite](#aufbewahrungs-grenzen-und-freigaben), sodass die Daten, die die Organisation behält, ebenfalls begrenzt sind. Die Begleitseite ist [Audit-Logs](/de/platform/admin/governance/audit-logs) — jede Richtlinienänderung hier landet dort als dauerhafte Aufzeichnung.
