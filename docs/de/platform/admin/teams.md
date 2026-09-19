---
title: Teams
description: Gruppiere Personen und lege fest, wer Team-Dokumente, Projekte und Posteingangs-Warteschlangen sieht.
---

Ein Team ist eine Markierung an der Arbeit, kein Ort, in den du wechselst. Ein Dokument, ein Ordner oder ein Projekt trägt die Teams, die es sehen dürfen, und eine Konversation kann in der Warteschlange eines Teams warten. Die Rolle bestimmt, was jemand tun darf; die Teams entscheiden, welche eingeschränkte Arbeit die Person erreicht. Inhaber und Admins verwalten Teams unter **Einstellungen > Teams**.

<Frame caption="Einstellungen > Teams — jedes Team der Organisation mit seiner Mitgliederzahl, neben der Aktion Team erstellen.">

![Die Teams-Einstellungsseite listet drei Teams — Growth, Platform engineering und Customer success —, jedes mit einem Mitglied und dem Zeitpunkt, an dem es hinzugefügt wurde, neben der Schaltfläche Team erstellen.](/images/platform/settings-teams.webp)

</Frame>

## Ein Team erstellen

1. Wähle **Team erstellen** und fülle das Feld **Teamname** aus, etwa `Kundensupport`.
2. Wähle die Mitglieder der Organisation aus, die dazugehören sollen. Wenn du niemanden auswählst, fügt Tale dich selbst hinzu.
3. Wähle **Team erstellen**. Prüfe den neuen Eintrag und die Mitgliederzahl in der Liste.

Wähle einen Namen, den andere überall wiedererkennen, wo Teams erscheinen: in der Reichweite eines Dokuments oder Projekts, als Warteschlange im Posteingang, in einem Listenfilter. Das Formular erlaubt bis zu 80 Zeichen. Ein neues Team erhält nicht automatisch bestehende Arbeit. Wähle es bei den Dokumenten, Projekten und Konversationen aus, die es abdecken soll.

## Mitglieder oder Namen ändern

Öffne die Zeile eines Teams, um seine Mitglieder zu sehen. Das Zeilenmenü bietet **Anzeigen**, **Bearbeiten** und **Löschen**. Unter **Bearbeiten** änderst du Namen oder Mitgliedschaft. Speichere und prüfe anschließend die Mitgliederzahl.

Ein Team behält mindestens ein Mitglied. Um das letzte zu entfernen, lösche stattdessen das Team.

Eine Person kann mehreren Teams angehören. Ihr Zugriff kann über weitere Teams oder eine direkte Zuweisung bestehen bleiben. Das Entfernen aus einem Team entzieht daher nicht zwangsläufig jeden Zugriff auf eine Ressource. Prüfe die übrigen Zugangswege, wenn du Rechte entziehen möchtest.

Ein Team, das dein Identity Provider bereitstellt, trägt in der Liste die Markierung **Synchronisiert**. Name und Mitglieder gehören dem Anbieter: Der Bearbeitungsdialog zeigt sie nur an, weil der nächste Abgleich eine lokale Änderung zurücksetzen würde. Löschen kannst du ein solches Team trotzdem; der Anbieter kann es erneut anlegen.

<Tip>

Benenne ein bestehendes Team um, wenn sich sein Zweck ändert, dieselben Personen aber ihren Zugang behalten sollen. Löschen und Neuanlegen erzeugt ein anderes Team und verändert bestehende Ressourcenzuweisungen.

</Tip>

## Was ein Team entscheidet

Für jede teamgebundene Ressource gilt dieselbe Regel. Eine Ressource ohne Team sehen alle in der Organisation. Eine Ressource mit Teams sehen die Mitglieder eines dieser Teams. Inhaber und Admins sehen in beiden Fällen alles; ein Team ist deshalb kein Mittel, um Arbeit vor der Administration zu verbergen.

| Ressource | Bedeutung des Teams |
| --- | --- |
| Projekte | **Reichweite** unter **Allgemein** nennt die Teams, die das Projekt öffnen können; leer bedeutet die ganze Organisation. |
| Dokumente und Ordner | Ein Dokument oder Ordner trägt die Teams, die es lesen dürfen. Was in einem Team-Ordner abgelegt wird, übernimmt dessen Teams und kann kein Team außerhalb davon nennen. |
| Skills | Teamsichtbarkeit stellt einen Skill den ausgewählten Teams bereit. |
| Konversationen | Die Teamzuweisung legt die Konversation in die Warteschlange dieses Teams. |

Wenn du Arbeit auf Teams beschränkst, kannst du nur Teams wählen, denen du selbst angehörst; Inhaber und Admins wählen jedes Team der Organisation. Eine Teammitgliedschaft erlaubt keine Aktionen, die die Rolle verbietet: Ein Redakteur und ein Mitglied im selben Team können unterschiedliche Bearbeitungsrechte haben.

Mitglieder sehen ihre eigenen Teams unter **Einstellungen > Konto > Deine Teams** und in der Zeile **Teams** des Profilmenüs. Um eine Liste auf bestimmte Arbeit einzugrenzen, bietet jede Liste einen Filter **Teams** mit **Organisationsweit**, **Meine Teams** und jedem Team nach Namen; der Posteingang filtert stattdessen nach Warteschlange. Siehe [Konto verwalten](/de/platform/member/preferences#teams).

Bei eingehenden Konversationen können [Routing-Regeln](/de/platform/admin/governance/policies-and-limits#konversations-routing) das Team bereits beim Eingang auswählen. Ohne Personen- oder Teamzuweisung bleibt die Konversation bei der Administration zur Sichtung.

## Ein Team geordnet auflösen

Wähle **Löschen** im Zeilenmenü. Die Bestätigung zählt die Mitglieder des Teams, die Projekte, Ordner und Dokumente, zu deren Reichweite es gehört, und die Konversationen in seiner Warteschlange. Sie nennt außerdem, wie viele dieser Elemente kein weiteres Team haben und für alle in der Organisation sichtbar werden. Weise Arbeit, deren Zugriff eingeschränkt bleiben muss, vor dem Bestätigen neu zu.

<Warning>

Das Löschen eines Teams lässt sich nicht rückgängig machen. Jedes Projekt, jeder Ordner und jedes Dokument verliert das Team und behält seine übrigen Teams. Ein Element, dessen einziges Team es war, wird organisationsweit sichtbar. Dadurch können mehr Personen Zugriff erhalten.

</Warning>

Das Team, seine Mitgliedschaften, seine Einträge an jeder Ressource und eine Verknüpfung zum Identity Provider verschwinden in einem Schritt; ein halb gelöschtes Team kann nicht zurückbleiben. Eine Konversation verliert ihre Teamzuweisung. Ist auch keine Person zugewiesen, kehrt sie zur Sichtung durch die Administration zurück. Auch Dateiimporte verlieren diesen Teambezug. Die Konten der Teammitglieder werden nicht gelöscht.

Bei Teams aus [Enterprise SSO oder SCIM](/de/platform/admin/enterprise-sso) gelten zusätzlich die Bereitstellungsregeln des Identitätsanbieters. Prüfe diese Quelle, bevor du eine lokale Änderung vornimmst, die dauerhaft gelten soll.
