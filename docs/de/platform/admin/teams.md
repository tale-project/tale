---
title: Teams
description: Teams sind benannte Gruppen von Mitgliedern, die sich Zugriff auf Agents, Prompts, Projekte und Integrationen teilen. Admins erstellen und verwalten Teams unter Einstellungen > Teams; die Grenze, die sie ziehen, greift überall unterhalb der Rollen-Ebene.
---

Ein Team ist eine benannte Gruppe von Mitgliedern, die sich Zugriff auf Agents, Prompts, Projekte, Integrationen und Konversationen teilt. Wo Rollen definieren, was eine Person tun _kann_, definieren Teams, in welchem Ausschnitt der Organisationsdaten diese Person arbeitet. Die meisten Organisationen landen bei einer Handvoll Teams — Support, Vertrieb, Betrieb — und die meisten alltäglichen Berechtigungs-Entscheidungen liegen auf der Team-Grenze, nicht auf der Rollen-Grenze. Admins verwalten Teams unter **Einstellungen > Teams**.

Diese Seite ist die Referenz dafür, was ein Team besitzt, wie Mitgliedschaft funktioniert und wie die Team-Grenze mit den rollenbasierten Berechtigungen aus [Mitglieder und Rollen](/de/platform/admin/members-and-roles) zusammenspielt. Lies sie einmal, wenn du die Teams der Organisation aufsetzt; komm wieder, wenn du umorganisierst.

<Frame caption="Einstellungen > Teams — jedes Team der Organisation mit seiner Mitgliederzahl, neben der Aktion Team erstellen.">

![Die Teams-Einstellungsseite listet drei Teams — Growth, Platform engineering und Customer success —, jedes mit einem Mitglied und dem Zeitpunkt, an dem es hinzugefügt wurde, neben der Schaltfläche Team erstellen.](/images/platform/settings-teams.webp)

</Frame>

## Was ein Team besitzt

Ein Team hält Mitgliedschaft und eine Menge ihm zugeordneter Ressourcen. Die Ressourcen sind:

- **Agents** — Agents, die mit Team-Scope erstellt wurden, sind nur für Mitglieder dieses Teams sichtbar und editierbar. Organisationsweite Agents bleiben für alle mit passender Rolle sichtbar.
- **Prompts** — gespeicherte Prompts mit Sichtbarkeit `Team` erscheinen nur für die Mitglieder dieses Teams. Persönliche Prompts bleiben privat beim Eigentümer; Globale Prompts sind organisationsweit sichtbar.
- **Projekte** — Projekte können einem Team zugewiesen werden; die Mitglieder des Teams erben den Projekt-Zugriff, ohne einzeln hinzugefügt zu werden.
- **Integrationen** — Integrationen, die auf bestimmte Teams beschränkt sind (über den Hebel **Erlaubte Teams** unter **Einstellungen > Integrationen**), erscheinen nur in Pickern dieser Teams.
- **Konversationen** — eine Konversation kann zusätzlich zu einer zuständigen Person auch einem Team zugewiesen werden, über die Zuweisungs-Auswahl in ihrer Kopfzeile. Ob diese Zuweisung auch _einschränkt_, wer die Konversation sehen kann, regelt die optionale Richtlinie **Konversationszugriff** unter [Governance](/de/platform/admin/governance/policies-and-limits); ist sie aus, bleiben Konversationen organisationsweit sichtbar.

Eine Ressource ohne Team-Scope bleibt für alle sichtbar, deren Rolle es erlaubt. Teams sind eine _zusätzliche_ Eingrenzungsebene — sie engen Sichtbarkeit ein, weiten sie nie aus.

## Ein Team erstellen

Öffne **Einstellungen > Teams** und klick auf **Team erstellen**. Gib dem Team einen Namen (`Support`, `Vertrieb`, `Betrieb`) und eine optionale Beschreibung; der Name erscheint überall, wo das Team auftaucht — Picker, Badges, team-eingegrenzter Dokumentzugriff und das Zuweisungsfeld eines Projekts. Speichern erstellt ein leeres Team, das du aus der Team-Zeile mit Mitgliedern füllen kannst.

Die Team-Zeile trägt drei Untersichten: **Mitglieder** (wer im Team ist), **Ressourcen** (was das Team besitzt) und **Einstellungen** (Name, Beschreibung und Lebenszyklus des Teams). Die Ressourcen-Sicht ist der einfachste Weg, zu sehen, wohin ein Team reicht; sie dient zusätzlich als Audit-Oberfläche, wenn jemand fragt, warum ein Team einen bestimmten Agent sieht.

## Mitglieder hinzufügen und entfernen

Öffne die Team-Zeile und klick auf **Mitglieder hinzufügen**. Der Picker listet die Mitglieder der Organisation; eines anzuhaken fügt es dem Team hinzu. Ein Mitglied kann mehreren Teams angehören; sein Zugriff ist die Vereinigung jedes Teams, in dem es ist, plus der organisationsweiten Reichweite seiner Rolle. Ein Mitglied aus einem Team zu entfernen, entzieht beim nächsten Request die team-gebundene Sichtbarkeit; laufende Chats werden fertig, aber der nächste Thread sieht die Ressourcen des Teams nicht mehr.

## Team versus Rolle

Die Rolle entscheidet, was eine Person tun darf; das Team entscheidet, woran. Ein Mitglied-Rollen-Benutzer im Support-Team kann die Agents des Support-Teams lesen, aber nicht bearbeiten; ein Entwickler-Rollen-Benutzer im Support-Team kann die Agents des Support-Teams lesen und schreiben, aber die des Vertriebs nicht sehen. Teams gewähren nie Fähigkeiten, die der Rolle fehlen; Rollen weiten Sichtbarkeit nie über den Team-Scope hinaus.

Wenn du eine Berechtigungs-Entscheidung brauchst, die bestehende Rollen und Teams nicht ausdrücken können, ist der nächste Hebel eine Governance-Richtlinie — siehe [Mitglieder und Rollen](/de/platform/admin/members-and-roles) dafür, wie Richtlinien sich an Rollen heften, und den Governance-Bereich für die Richtlinien-Felder selbst.

## Ein Team löschen

Klick auf die Team-Zeile, dann auf **Team löschen**. Löschen ist Hard-Stop — das Team ist weg, jede team-gebundene Ressource, die es besaß, wechselt auf organisationsweite Sichtbarkeit, und Mitglieder verlieren den team-gebundenen Ausschnitt ihres Zugriffs. Es gibt kein Undo; verwaiste Ressourcen bleiben für alle erreichbar, deren Rolle es erlaubt, was selten das richtige Ergebnis ist. Greif zu Löschen, wenn ein Team wirklich aufgelöst wird, nicht wenn es umorganisiert wird.

## Wo das hingehört

Teams sind die Eingrenzungsebene direkt unter Rollen — Rollen sagen _was_, Teams sagen _wo_. Die natürliche nächste Lektüre hängt von der Ressource ab, die du eingrenzt: [Skill-Bibliothek](/de/platform/workspace/skills) dafür, wie eine geteilte Anleitung alle erreicht, [Integrationen (Admin-Sicht)](/de/platform/admin/integrations) für die Zugangsdaten, die die Automatisierungen eines Teams aufrufen, und [Projekte](/de/platform/projects/overview) für die Projekt-zu-Team-Zuweisung.
