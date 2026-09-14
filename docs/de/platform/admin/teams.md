---
title: Teams
description: Gruppiere Personen für gemeinsamen Ressourcenzugriff und zugewiesene Konversationen.
---

Mit Teams gibst du mehreren Personen Zugang zu derselben Arbeit. Die Rolle bestimmt erlaubte Aktionen; die Teammitgliedschaft entscheidet mit, welche Projekte, Dokumente, Skills und Konversationen erreichbar sind. Inhaber und Admins verwalten Teams unter **Einstellungen > Teams**.

<Frame caption="Einstellungen > Teams — jedes Team der Organisation mit seiner Mitgliederzahl, neben der Aktion Team erstellen.">

![Die Teams-Einstellungsseite listet drei Teams — Growth, Platform engineering und Customer success —, jedes mit einem Mitglied und dem Zeitpunkt, an dem es hinzugefügt wurde, neben der Schaltfläche Team erstellen.](/images/platform/settings-teams.webp)

</Frame>

## Ein Team erstellen

1. Wähle **Team erstellen** und fülle das Feld **Teamname** aus, etwa `Kundensupport`.
2. Wähle die Mitglieder der Organisation aus, die dazugehören sollen. Wenn du niemanden auswählst, fügt Tale dich selbst hinzu.
3. Wähle **Team erstellen**. Prüfe den neuen Eintrag und die Mitgliederzahl in der Liste.

Wähle einen Namen, den andere in Freigabe- und Zuweisungsfeldern wiedererkennen. Das Formular erlaubt bis zu 80 Zeichen. Ein neues Team erhält nicht automatisch alle bestehenden Projekte oder Konversationen. Wähle es bei den Ressourcen aus, die es gemeinsam nutzen soll.

## Mitglieder oder Namen ändern

Öffne die Zeile eines Teams, um seine Mitglieder zu sehen. Das Zeilenmenü bietet **Anzeigen**, **Bearbeiten** und **Löschen**. Unter **Bearbeiten** änderst du Namen oder Mitgliedschaft. Speichere und prüfe anschließend die Mitgliederzahl.

Eine Person kann mehreren Teams angehören. Ihr Zugriff kann über weitere Teams oder eine direkte Zuweisung bestehen bleiben. Das Entfernen aus einem Team entzieht daher nicht zwangsläufig jeden Zugriff auf eine Ressource. Prüfe die übrigen Zugangswege, wenn du Rechte entziehen möchtest.

<Tip>

Benenne ein bestehendes Team um, wenn sich sein Zweck ändert, dieselben Personen aber ihren Zugang behalten sollen. Löschen und Neuanlegen erzeugt ein anderes Team und verändert bestehende Ressourcenzuweisungen.

</Tip>

## Arbeit einem Team zuordnen

| Ressource | Bedeutung des Teams |
| --- | --- |
| Projekte | Ein Projekt kann einem Team gehören und mit weiteren Teams geteilt werden. |
| Dokumente und Ordner | Der Teamzugriff begrenzt zusammen mit der Rollenprüfung, wer Inhalte lesen kann. |
| Skills | Teamsichtbarkeit stellt einen Skill den ausgewählten Teams bereit. |
| Konversationen | Die Teamzuweisung legt Arbeit in die Warteschlange dieses Teams. |

Eine Teammitgliedschaft erlaubt keine Aktionen, die die Rolle verbietet. Ein Redakteur und ein Mitglied im selben Team können unterschiedliche Bearbeitungsrechte haben. Inhaber und Admins behalten ihren administrativen Zugriff. Ein Team ist kein Mittel, um Arbeit vor der Administration zu verbergen.

Bei eingehenden Konversationen können [Routing-Regeln](/de/platform/admin/governance/policies-and-limits#konversations-routing) das Team bereits beim Eingang auswählen. Ohne Personen- oder Teamzuweisung bleibt die Konversation bei der Administration zur Sichtung.

## Ein Team geordnet auflösen

Prüfe vor dem Löschen die Projekte des Teams, freigegebene Dokumente, die Konversationswarteschlange und teamgebundene Importe. Weise Arbeit neu zu, deren Zugriff eingeschränkt bleiben muss. Wähle dann **Löschen** im Zeilenmenü und lies die Bestätigung.

<Warning>

Das Löschen eines Teams lässt sich nicht rückgängig machen. Ein eigenes Projekt geht an das erste verbleibende Team, mit dem es geteilt war. Gibt es keines, wird das Projekt organisationsweit zugänglich. Prüfe die Freigaben vorher, da dadurch mehr Personen Zugriff erhalten können.

</Warning>

Dokumente und Ordner verlieren das gelöschte Team aus ihrer Zugriffsliste; andere Teams bleiben erhalten. Eine Konversation verliert ihre Teamzuweisung. Ist auch keine Person zugewiesen, kehrt sie zur Sichtung durch die Administration zurück. Auch Dateiimporte verlieren diesen Teambezug. Die Konten der Teammitglieder werden nicht gelöscht.

Bei Teams aus [Enterprise SSO oder SCIM](/de/platform/admin/enterprise-sso) gelten zusätzlich die Bereitstellungsregeln des Identitätsanbieters. Prüfe diese Quelle, bevor du eine lokale Änderung vornimmst, die dauerhaft gelten soll.
