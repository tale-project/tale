---
title: Agents (Admin-Sicht)
description: Die organisationsweite Agents-Liste — jeder Agent in der Organisation, wer ihn gebaut hat, welches Modell er fährt, welches Wissen er berührt. Admins und Inhaber lesen das, wenn sie Agents organisationsweit steuern, statt selbst einen zu bauen.
---

Die Admin-Sicht auf Agents ist das organisationsweite Verzeichnis jedes Agents, der in Tale existiert, egal wer ihn gebaut hat. Redakteure und Entwickler sehen nur die Agents, auf die sie in ihrem eigenen Bereich Zugriff haben; Admins und Inhaber sehen alle, plus die per-Agent-Steuerungshebel und den per-Agent-Audit-Pfad. Diese Seite behandelt die Admin-Oberfläche — was die Tabelle zeigt, was ein Admin ändern kann und was unter der Kontrolle des Agent-Eigentümers bleibt.

Diese Seite lehrt dich nicht, einen Agent zu bauen. Das ist die Redakteurs-Sicht unter [Agents](/de/platform/agents/concepts). Was folgt, ist die Aufsichtsseite: wie du einen Agent findest, wie du eingreifst, wenn einer Aufmerksamkeit braucht, und wie die Rollengrenzen dabei halten.

<Frame caption="Die organisationsweite Agents-Liste — ein Ordner zu seinen Agent-Zeilen aufgeklappt, jede mit Modell und Kategorie. Ein Admin sieht hier jeden Agent der Organisation.">

![Die Agents-Liste mit einem aufgeklappten Ordner, der Agent-Zeilen zeigt, jede nennt einen Agent samt primärem Modell und Kategorie.](/images/platform/agents-list-expanded.webp)

</Frame>

## Was die Tabelle zeigt

Öffne **Einstellungen > Agenten**, um auf der organisationsweiten Liste zu landen. Jede Zeile nennt einen Agent und zeigt sein primäres Modell, seine Kategorie, das Team, dem er gehört (falls vorhanden), und das Datum der letzten Bearbeitung. Die Liste ist nach Namen suchbar und nach Kategorie, Team und Status (aktiv oder deaktiviert) filterbar. Die Standardsortierung ist „zuletzt bearbeitet zuerst" — nützlich, wenn du sehen willst, was sich seit dem letzten Blick geändert hat.

Ein Klick auf eine Zeile öffnet denselben Agent-Editor, den ein Redakteur oder Entwickler sehen würde, aber mit der Admin-Linse: jeder Tab ist sichtbar, jede Bindung ist editierbar, und der Audit-Log-Tab zeigt den vollen Bearbeitungsverlauf mit dem Akteur und dem Diff pro Speicherung.

## Was ein Admin tun kann, was ein Redakteur nicht kann

Admins erben jede Berechtigung, die Redakteur und Entwickler auf der Agent-Oberfläche tragen. Darüber hinaus fügt die Admin-Sicht drei Steuerungs-Bewegungen hinzu:

- **Agent deaktivieren.** Ein deaktivierter Agent erscheint nicht mehr in Pickern und antwortet nicht mehr auf neue Anfragen, aber seine Konversationen, Ausführungen und der Audit-Pfad bleiben erhalten. Reaktivieren stellt das vorherige Verhalten wieder her. Greif zu Deaktivieren, wenn ein Agent sich falsch verhält und du ihn stoppen musst, ohne den Kontext zu verlieren.
- **Eigentum übertragen.** Der Eigentümer eines Agents ist das Team oder Mitglied, das für ihn verantwortlich ist. Übertragen verschiebt den Agent zu einem anderen Team oder Mitglied; der vorherige Eigentümer verliert Schreibzugriff, außer er teilt das neue Team. Greif zu Übertragen, wenn ein Team reorganisiert wird oder ein Eigentümer geht.
- **Eine Governance-Richtlinie anwenden.** Admins können einem Agent eine Governance-Richtlinie anhängen — erforderliche Genehmigungen bei Schreibvorgängen, erlaubte Tool-Familien, erlaubte Integrationen. Die Richtlinie überschreibt die eigene Konfiguration des Agents bei Konflikten; der Eigentümer sieht die Richtlinie als schreibgeschütztes Badge im Editor.

## Was beim Agent-Eigentümer bleibt

Die meiste tägliche Bearbeitung bleibt bei der Person, die den Agent gebaut hat. Umbenennen, Anweisungen bearbeiten, die Wissensbindungen anpassen, Tools umschalten, Modelle wechseln, neue Versionen veröffentlichen — all das passiert im Agent-Editor unter den Berechtigungen des Eigentümers. Die Admin-Sicht dient dem Eingreifen, nicht der Übernahme. Wenn du regelmäßig fremde Agents bearbeitest, ist die richtige Antwort meist eine Governance-Richtlinie, die das Verhalten eingrenzt, keine manuelle Änderung.

## Audit und Verlauf

Jede Speicherung auf einem Agent landet im Audit-Log mit Akteur, Zeitstempel und dem Feld, das sich geändert hat. Die Admin-Sicht legt den per-Agent-Ausschnitt dieses Logs unter dem **Verlauf**-Tab im Agent-Editor frei. Dieselben Daten sind auch aus dem organisationsweiten Audit-Log unter **Einstellungen > Richtlinien** erreichbar.

## Wo das hingehört

Die Admin-Sicht auf Agents ist das Aufsichts-Pendant zur Bau-Sicht des Redakteurs — gleiche Agents, andere Linse. Greif sie meistens nur, wenn etwas Aufmerksamkeit braucht; die tägliche Arbeit passiert im Agent-Editor unter [Agent-Konzepte](/de/platform/agents/concepts). Wenn die richtige Antwort darin liegt, Verhalten für eine ganze Klasse von Agents einzugrenzen statt für einen einzelnen, ist die nächste Lektüre die Governance-Richtlinien-Oberfläche — siehe [Mitglieder und Rollen](/de/platform/admin/members-and-roles) für die Anbindung der Richtlinien an Rollen.
