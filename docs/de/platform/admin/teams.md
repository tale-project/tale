---
title: Teams
description: Mitglieder in Teams gruppieren, um zu steuern, welche Dokumente, Konversationen und Agent-Wissen jede Gruppe standardmäßig sieht.
---

Teams sind die Art, eine Organisation in Engineering, Sales, Support, Legal — oder welche Form deine Firma tatsächlich hat — zu schneiden und zu entscheiden, welches Wissen jede Scheibe standardmäßig sieht. Ein Team ist eine weiche Gruppierung: Es ändert keine Rollen, keine Berechtigungen und nichts an der Anmeldung. Was es ändert, ist, welche Dokumente und Konversationen in den gefilterten Ansichten jedes Mitglieds auftauchen, welches Wissen ein Agent durchsucht und auf welchen Geltungsbereich eine Richtlinien-Regel (ein Budget, ein Standard-Modell, ein Feature-Flag) anschlägt. Die Seite liegt unter **Einstellungen > Teams** und ist Admin-only.

Dasselbe Mitglied darf in beliebig vielen Teams sein. Die meisten Organisationen landen bei drei bis zehn — mehr wird mühsam zu pflegen, weil jeder Filter und jede team-skopierte Richtlinien-Regel gegen mehr Scheiben verfasst werden muss, als irgendwer im Kopf hat.

## Ein Team anlegen

Öffne **Einstellungen > Teams** und klicke **Team erstellen**. Der Dialog fragt zwei Felder ab:

1. **Team-Name** — kurz halten, denn er erscheint in Filter-Menüs durch die UI. Pflicht.
2. **Mitglieder** — die Checkliste unter dem Namen wählt, wer dem Team beitritt. Ein Mitglied darf in beliebig vielen Teams sein; lässt du die Checkliste leer, wird der Admin, der das Team erstellt hat, automatisch hinzugefügt, damit das Team mindestens eine Person hat.

Klicke **Team erstellen**. Das Team erscheint in der Tabelle mit Name, Mitgliederzahl und Erstellungs-Datum. Mitglieder lassen sich später aus der Detail-Zeile des Teams über **Mitglieder** hinzufügen oder entfernen.

## Was Teams tatsächlich beschränken

| Oberfläche             | Was die Team-Mitgliedschaft steuert                                                                                                                                                                       |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Dokumente**          | Ein Dokument lässt sich beim Upload einem oder mehreren Teams taggen. Mitglieder sehen nur Dokumente, die ihren Teams getaggt sind, wenn ein Team-Filter aktiv ist.                                       |
| **Konversationen**     | Eine Konversation lässt sich einem Team zuweisen. Team-skopierte Eingänge lassen Support nur Support-Threads und Sales nur Sales-Threads sehen, ohne Vermischung.                                         |
| **Agents**             | Die **Wissen**-Registerkarte eines Agents lässt sich auf team-getaggtes Wissen einschränken, sodass ein Support-Agent nur Support-getaggte Inhalte durchsucht.                                            |
| **Richtlinien-Regeln** | Budgets, Standard-Modelle, Modell-Zugriff und Funktionssteuerung (siehe [Richtlinien](/de/platform/admin/governance)) lassen sich je Team konfigurieren. Vorrang: Nutzer > Team > Rolle > Voreinstellung. |

Teams steuern _nicht_, ob jemand die Oberfläche überhaupt _sieht_ — das ist Aufgabe der Rolle. Ein Redakteur kann immer Konversationen erreichen; Teams entscheiden lediglich, welche Konversationen standardmäßig in den Filter rutschen.

## Mitglieder eines Teams verwalten

Öffne die Team-Zeile und klicke **Mitglieder**. Die Schublade zeigt die aktuelle Mitgliederliste mit einer Checkliste der Organisationsmitglieder zum Hinzufügen oder Entfernen. Der Mitglieder-Checklisten-Hinweis erinnert den Admin, dass ein Mitglied in mehreren Teams sein darf und dass das Team mit dem Admin selbst endet, wenn niemand sonst gewählt wurde.

## Team-Manager

Teams haben keine formellen Manager-Rollen — jedes Organisationsmitglied trägt in jedem Team, dem es angehört, dieselbe Rolle. Für delegierte Team-Administration nutze die org-weite **Redakteur**-Rolle und beschränke deren Wissens- und Agent-Zugriff über dieselbe Skopierungs-Tabelle oben auf das Team. Das hält die Rollen-Matrix in [Mitglieder und Rollen](/de/platform/admin/members-and-roles) maßgeblich und vermeidet ein paralleles Berechtigungs-System.

## Externe Identitätsanbieter

Sind SSO oder vertrauenswürdige Kopfzeilen aktiv, ist der externe Identitätsanbieter die alleinige Quelle der Wahrheit für die Team-Mitgliedschaft. Tale liest die Teams-Kopfzeile (oder den IdP-Group-Claim) bei jeder Anmeldung und aktualisiert die Team-Liste des Nutzers entsprechend. Edits an diesen Nutzern unter **Einstellungen > Teams** werden bei der nächsten Anmeldung überschrieben. Siehe [Authentifizierung](/de/self-hosted/admin/authentication) für die Kopfzeilen-Namen und die Group-Mapping-Konfiguration.

## Wo das hingehört

Teams sind die Skopierungs-Schicht für Wissen und Konversationen. Sie ändern keine Rollen oder Berechtigungen — die leben auf [Mitglieder und Rollen](/de/platform/admin/members-and-roles). Nutze Teams, um zu entscheiden, wer welche Dokumente und welche Konversations-Kanäle standardmäßig sieht; nutze Rollen, um zu entscheiden, was jedes Mitglied darf. Eine team-skopierte Richtlinien-Regel (ein engeres Budget, ein günstigeres Standard-Modell, ein Feature-Toggle) ist die Art, beide Systeme ohne Überlappung zu komponieren.

Wenn ein Team über das hinauswächst, was ein einzelner Redakteur allein kuratiert, ist der natürliche nächste Schritt, es zu splitten; wenn es so klein wird, dass zwei Teams dieselben Mitglieder haben, lege sie zusammen. Beide Edits sind aus dieser Seite günstig.
