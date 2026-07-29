---
title: Agents (Admin-Sicht)
description: Die organisationsweite Agenten-Liste — jeder Agent der Organisation, wem er gehört, wer an ihn herankommt und was er berühren darf.
---

Die Admin-Sicht auf Agenten ist das organisationsweite Verzeichnis jedes Agenten, der in Tale existiert, unabhängig davon, wer ihn gebaut hat. Editoren und Developer sehen die Agenten, auf die sie in ihrem eigenen Bereich Zugriff haben; Admins und Inhaber sehen alle, dazu die Steuerungshebel pro Agent und die Prüfspur pro Agent. Diese Seite behandelt diese aufsichtführende Oberfläche — was die Tabelle zeigt, was eine Administratorin ändern kann und was in der Hand des Agenten-Besitzers bleibt.

Wie man einen Agenten baut, lehrt diese Seite nicht. Das ist die Editor-Sicht unter [Agent-Konzepte](/de/platform/agents/concepts). Hier geht es um die andere Seite: einen Agenten finden, eingreifen, wenn einer Aufmerksamkeit braucht, und wie die Rollengrenzen dabei halten.

## Was die Tabelle zeigt

Öffne **Einstellungen > Agents** und du landest auf der organisationsweiten Liste. Jede Zeile nennt einen Agenten und zeigt, wem er gehört, ob er für die Organisation freigegeben oder privat gehalten ist und wann er zuletzt bearbeitet wurde. Die Liste ist nach Namen durchsuchbar, und die Voreinstellung sortiert zuletzt Bearbeitetes zuerst — praktisch, um zu sehen, was sich seit deinem letzten Blick geändert hat.

Ein Klick auf eine Zeile öffnet denselben Agenten-Editor, den auch ein Editor oder Developer sähe, aber mit der Admin-Linse: Jeder Tab ist sichtbar, jede Bindung bearbeitbar, und der Verlauf zeigt die volle Bearbeitungsspur mit der handelnden Person und dem Diff jeder Speicherung.

## Was eine Administratorin kann, ein Editor nicht

Admins erben jede Berechtigung, die Editoren und Developer auf der Agenten-Oberfläche tragen. Darüber hinaus bringt die Admin-Sicht drei Steuerungsschritte mit.

- **Die Reichweite eines Agenten verengen.** Einen freigegebenen Agenten wieder auf privat zu stellen nimmt ihn aus der Auswahl jedes Mitglieds, ohne etwas zu löschen — seine Gespräche und sein Verlauf bleiben unversehrt, und eine erneute Freigabe stellt das vorige Verhalten wieder her. Greif dazu, wenn ein Agent aus der Reihe tanzt und du seine Nutzung stoppen willst, während du der Ursache nachgehst.
- **Den Besitz übertragen.** Der Besitzer eines Agenten ist das Mitglied, das für ihn verantwortlich ist, und ein privater Agent muss immer eines haben. Ein Übertrag gibt den Agenten an jemand anderen; der bisherige Besitzer behält nur, was seine Rolle ihm gibt. Greif dazu, wenn ein Besitzer das Team wechselt oder geht.
- **Eine Governance-Policy anlegen.** Admins können einem Agenten eine Policy anheften — verlangte Freigaben bei Schreibvorgängen, welche Tool-Familien erlaubt sind, welche Connectors erreichbar. Wo beide sich widersprechen, gewinnt die Policy über die eigene Konfiguration des Agenten, und dessen Besitzer sieht sie im Editor als schreibgeschütztes Abzeichen.

## Was beim Agenten-Besitzer bleibt

Das meiste tägliche Bearbeiten bleibt bei dem, der den Agenten gebaut hat: umbenennen, Anweisungen umschreiben, den Wissensbereich anpassen, Tools gewähren oder entziehen, Skills binden und lösen, neue Versionen speichern. Die Admin-Sicht ist zum Eingreifen da, nicht zum Übernehmen. Wenn du dich dabei ertappst, regelmäßig fremde Agenten zu bearbeiten, ist die richtige Antwort meist eine Governance-Policy, die das Verhalten für eine Klasse von Agenten festlegt, und keine Handänderung an einem einzelnen.

Eines liegt außerhalb beider Rollen: Niemand nagelt einem Agenten ein Modell fest. Das Modell wählt pro Zug, wer die Nachricht abschickt; welche Modelle benutzt werden dürfen, ist damit eine Frage der [Provider](/de/platform/admin/providers) und der [Richtlinien und Limits](/de/platform/admin/governance/policies-and-limits), nie eine von Agent zu Agent.

## Prüfung und Verlauf

Jede Speicherung an einem Agenten landet im Prüfprotokoll mit der handelnden Person, dem Zeitstempel und dem geänderten Feld. Die Admin-Sicht zeigt den Ausschnitt pro Agent über den Verlauf im Agenten-Editor; dieselben Daten sind organisationsweit unter **Einstellungen > Governance** erreichbar. Bindungen liest man mit diesem Wissen im Kopf — die Konfiguration eines Agenten kann unverändert bleiben, während ein von ihm gebundenes Skill-Bundle darunter ersetzt wird, und das zeigt sich in der eigenen Prüfspur des Bundles.

## Wo das hingehört

Die Admin-Sicht auf Agenten ist das aufsichtführende Gegenstück zur Bau-Sicht des Editors — dieselben Agenten, eine andere Linse. Meist solltest du erst dazu greifen, wenn etwas Aufmerksamkeit braucht; die tägliche Arbeit läuft im Agenten-Editor unter [Agent-Konzepte](/de/platform/agents/concepts). Wenn die richtige Antwort ist, das Verhalten für eine Klasse von Agenten festzulegen statt für einen, ist der nächste Schritt [Mitglieder und Rollen](/de/platform/admin/members-and-roles) — dort steht, wie Policies an Rollen hängen.
