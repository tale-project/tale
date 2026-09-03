---
title: Teams
description: Teams sind benannte Gruppen von Mitgliedern, die sich Zugriff auf Dokumente, Projekte, Skills und Konversationen teilen. Admins erstellen und verwalten Teams unter Einstellungen > Teams; die Grenze, die sie ziehen, greift überall unterhalb der Rollen-Ebene.
---

Ein Team ist eine benannte Gruppe von Mitgliedern, die sich Zugriff auf Dokumente, Projekte, Skills und Konversationen teilt. Wo Rollen definieren, was eine Person tun _kann_, definieren Teams, in welchem Ausschnitt der Organisationsdaten diese Person arbeitet. Die meisten Organisationen landen bei einer Handvoll Teams — Support, Vertrieb, Betrieb — und die meisten alltäglichen Berechtigungs-Entscheidungen liegen auf der Team-Grenze, nicht auf der Rollen-Grenze. Admins verwalten Teams unter **Einstellungen > Teams**.

Diese Seite ist die Referenz dafür, was ein Team besitzt, wie Mitgliedschaft funktioniert und wie die Team-Grenze mit den rollenbasierten Berechtigungen aus [Mitglieder und Rollen](/de/platform/admin/members-and-roles) zusammenspielt. Lies sie einmal, wenn du die Teams der Organisation aufsetzt; komm wieder, wenn du umorganisierst.

<Frame caption="Einstellungen > Teams — jedes Team der Organisation mit seiner Mitgliederzahl, neben der Aktion Team erstellen.">

![Die Teams-Einstellungsseite listet drei Teams — Growth, Platform engineering und Customer success —, jedes mit einem Mitglied und dem Zeitpunkt, an dem es hinzugefügt wurde, neben der Schaltfläche Team erstellen.](/images/platform/settings-teams.webp)

</Frame>

## Was ein Team besitzt

Ein Team hält Mitgliedschaft und eine Menge ihm zugeordneter Ressourcen. Die Ressourcen sind:

- **Dokumente und Ordner** — ein Dokument oder Ordner mit Team-Scope ist nur für die Mitglieder dieses Teams sichtbar und editierbar. Organisationsweite Dokumente bleiben für alle mit passender Rolle sichtbar.
- **Projekte** — ein Projekt kann einem Team zugewiesen und mit weiteren Teams geteilt werden; die Mitglieder der Teams erben den Projekt-Zugriff, ohne einzeln hinzugefügt zu werden.
- **Skills** — ein Skill mit Team-Sichtbarkeit erscheint nur für die Mitglieder dieser Teams; die Tabs der Skill-Bibliothek trennen **Organisation**, **Teams** und **Persönlich**.
- **Konversationen** — eine Konversation kann zusätzlich zu einer zuständigen Person auch einem Team zugewiesen werden, über die Zuweisungs-Auswahl in ihrer Kopfzeile. Die Sichtbarkeit folgt dieser Zuweisung: eine Team-Warteschlange ist für die Mitglieder dieses Teams sichtbar, eine Personenzuweisung für diese Person, und Admins sowie Inhaber sehen alles. Wirklich unzugewiesene Konversationen (weder Person noch Team) bleiben bei Admins zur Sichtung — kombiniere das mit [Konversations-Routing](/de/platform/admin/governance/policies-and-limits#konversations-routing), damit eingehende Post beim Eintreffen in ein Team landet.

Eine Ressource ohne Team-Scope bleibt für alle sichtbar, deren Rolle es erlaubt. Teams sind eine _zusätzliche_ Eingrenzungsebene — sie engen Sichtbarkeit ein, weiten sie nie aus.

## Ein Team erstellen

Öffne **Einstellungen > Teams** und klick auf **Team erstellen**. Gib dem Team einen Namen (`Support`, `Vertrieb`, `Betrieb`) und hake seine ersten Mitglieder in der Liste an — bleibt sie leer, wirst du automatisch hinzugefügt, denn ein Team muss mindestens ein Mitglied behalten. Der Name erscheint überall, wo das Team auftaucht: Picker, Badges, team-eingegrenzter Dokumentzugriff und das Zuweisungsfeld eines Projekts.

Die Team-Zeile trägt die Alltags-Aktionen: **Mitglieder** verwaltet, wer im Team ist, **Team bearbeiten** benennt es um, **Team löschen** legt es still. Wohin ein Team reicht, ergibt sich daraus, wo das Team gewählt ist — im Zugriffs-Scope eines Dokuments, in der Zuweisung eines Projekts, in der Sichtbarkeit eines Skills.

## Mitglieder hinzufügen und entfernen

Öffne die Team-Zeile und klick auf **Mitglieder hinzufügen**. Der Picker listet die Mitglieder der Organisation; eines anzuhaken fügt es dem Team hinzu. Ein Mitglied kann mehreren Teams angehören; sein Zugriff ist die Vereinigung jedes Teams, in dem es ist, plus der organisationsweiten Reichweite seiner Rolle. Ein Mitglied aus einem Team zu entfernen, entzieht beim nächsten Request die team-gebundene Sichtbarkeit; laufende Chats werden fertig, aber der nächste Thread sieht die Ressourcen des Teams nicht mehr.

## Team versus Rolle

Die Rolle entscheidet, was eine Person tun darf; das Team entscheidet, woran. Ein Mitglied-Rollen-Benutzer im Support-Team kann die Dokumente des Support-Teams lesen, aber nicht bearbeiten; ein Redakteur-Rollen-Benutzer im Support-Team kann sie lesen und schreiben, aber die des Vertriebs nicht sehen. Teams gewähren nie Fähigkeiten, die der Rolle fehlen; Rollen weiten Sichtbarkeit nie über den Team-Scope hinaus.

Wenn du eine Berechtigungs-Entscheidung brauchst, die bestehende Rollen und Teams nicht ausdrücken können, ist der nächste Hebel eine Governance-Richtlinie — siehe [Mitglieder und Rollen](/de/platform/admin/members-and-roles) dafür, wie Richtlinien sich an Rollen heften, und den Governance-Bereich für die Richtlinien-Felder selbst.

## Ein Team löschen

Klick auf die Team-Zeile, dann auf **Team löschen**. Löschen ist Hard-Stop — das Team ist weg, alle Mitglieder werden daraus entfernt, und sie verlieren den team-gebundenen Ausschnitt ihres Zugriffs. Es gibt kein Undo. Greif zu Löschen, wenn ein Team wirklich aufgelöst wird, nicht wenn es umorganisiert wird.

## Wo das hingehört

Teams sind die Eingrenzungsebene direkt unter Rollen — Rollen sagen _was_, Teams sagen _wo_. Die natürliche nächste Lektüre hängt von der Ressource ab, die du eingrenzt: [Skill-Bibliothek](/de/platform/workspace/skills) dafür, wie eine geteilte Anleitung alle erreicht, [Connectors (Admin-Sicht)](/de/platform/admin/connectors) für die Zugangsdaten, die die Automatisierungen eines Teams aufrufen, und [Projekte](/de/platform/projects/overview) für die Projekt-zu-Team-Zuweisung.
