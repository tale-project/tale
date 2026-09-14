---
title: Projektagenten verwalten und prüfen
description: Prüfe Bearbeitungsrechte, erlaubte Ressourcen und die Folgen von Secret-Zuordnungen für Agentenläufe.
---

Verwalte einen Agenten über sein Projekt und die Ressourcen der Organisation. Es gibt keine zusätzliche organisationsweite Agentenliste zum Konfigurieren. Öffne **Projekte**, wähle das Projekt und dann **Agenten**, um seine Agenten zu prüfen oder zu bearbeiten.

## Die Bearbeitungsrechte klären

Wer das Projekt lesen darf, sieht seine Agenten. Personen mit Bearbeitungszugriff können sie im aktiven Projekt erstellen, ändern und löschen. Archivierte Projekte bleiben lesbar. Prüfe [Mitgliederrollen](/de/platform/admin/members-and-roles) und [Team-Zugriff](/de/platform/admin/teams), wenn eine Person unerwartet Zugriff hat oder ihr der Zugriff fehlt.

Ein Agent gehört genau einem Projekt. Seine ID und der Zugriff auf ein zweites Projekt erlauben einer Integration nicht, ihn als Agenten dieses zweiten Projekts zu verwenden. Pro Projekt sind bis zu 50 Agenten möglich, mit jeweils eindeutigen Namen.

## Vor dem Start die Ressourcen prüfen

Öffne den Bearbeitungsdialog des Agenten und prüfe das Zusammenspiel der Einstellungen, nicht nur das Modell:

| Prüfung | Warum sie nötig ist | Wo du ein Problem klärst |
| --- | --- | --- |
| Harness, Modell und Provider | Die Zugangsdaten müssen diesen Ausführungsweg unterstützen. | [KI-Provider](/de/platform/admin/providers). |
| Skills und ihre Freigabe | Der Team-Zugriff des Projekts bestimmt die verfügbaren Bundles. | [Skill-Bibliothek](/de/platform/workspace/skills) und Projektzugriff. |
| Connectors und Plattform-Tools | Sie erlauben Dienste und unterstützte Datenoperationen. | [Connector-Zugangsdaten](/de/platform/admin/connectors) und Ausstattung des Agenten. |
| Secrets | Die laufende Sitzung kann die zugeordneten Werte lesen. | **Secrets** im Agentendialog, für Inhaber und Admins. |
| Sandbox-Kapazität und Ausgaben | Die Arbeit braucht eine verfügbare Umgebung und ein zulässiges Budget. | [Sandboxes](/de/platform/admin/sandboxes) und [Richtlinien und Limits](/de/platform/admin/governance/policies-and-limits). |

Für einen Review-Agenten können Repository-Lesezugriff und Werkzeuge zum Berichten genügen. Ein freigegebenes Schreib-Tool darf seine Operationen innerhalb der Zugriffsregeln ausführen. Eine dauerhafte Anweisung, zuerst nachzufragen, ersetzt nicht das Entfernen einer unnötigen Berechtigung.

## Secret-Änderungen gezielt vornehmen

Nur Inhaber und Admins dürfen Secret-Zuordnungen ändern. Ein Editor kann andere Felder bearbeiten und die vorhandenen Zuordnungen erhalten. Secret-Werte liegen verschlüsselt im Speicher der Organisation und werden nicht mit der Agentenkonfiguration zurückgegeben. Der laufende Agent erhält jedoch die ihm zugeordneten Werte.

Verwende eng begrenzte und austauschbare Zugangsdaten. Mehrere Agenten oder Automatisierungs-Nodes können denselben Secret-Namen nutzen. Austausch oder Löschung des Werts betrifft dann jeden künftigen Lauf, der darauf verweist. Prüfe diese Verwendungen vorher.

## API-Clients nach denselben Regeln prüfen

Die öffentliche API liest und schreibt dieselbe Agentenliste und prüft den Projektzugriff des Schlüsselinhabers. Jede Operation enthält eine Projekt-ID. Eine Aktualisierung übergibt die vollständige Konfiguration einschließlich der Secret-Zuordnungen, die erhalten bleiben sollen. Fehlende Zuordnungen bedeuten ihre Entfernung und benötigen deshalb administrative Rechte.

Das [API-Beispiel für Projektagenten](/de/develop/api-reference#agenten-eines-projekts-verwalten) beschreibt die Integration. Öffne nach einer Änderung den Agenten erneut und prüfe das gespeicherte Modell, die Ausstattung und die Zuordnungen. Gib ihm danach eine kleine Aufgabe mit einem von Menschen prüfbaren Ergebnis. [Projektagenten](/de/platform/projects/project-agents) führt durch diesen Ablauf.
