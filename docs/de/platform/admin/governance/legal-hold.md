---
title: Legal Hold
description: Bewahre Daten einer Person oder Organisation, ordne Sperren einem Fall zu und prüfe Freigabeanträge.
---

Ein Legal Hold bewahrt die betroffenen Daten, solange ein Fall offen ist. Admins und Inhaber verwalten diese Aufbewahrungssperren unter **Einstellungen > Richtlinien > Legal Hold**. Setze die Sperre, solange die Daten noch vorhanden sind: Bereits endgültig gelöschte Datensätze holt sie nicht zurück.

<Frame caption="Governance > Legal Hold — die Tabelle der aktiven Holds mit der Aktion Legal Hold setzen über der vier-Augen-kontrollierten Warteschlange der Freigabeanträge.">

![Die Governance-Seite Legal Hold zeigt einen aktiven Hold — Typ Benutzer auf marta.vogel, gesetzt von Alex Rivera zum Sachverhalt Northstar contract — neben der Schaltfläche Legal Hold setzen, darunter die Warteschlangen Ausstehende Genehmigung und Genehmigt, die beide Keine Freigabeanträge melden.](/images/platform/governance-legal-hold.webp)

</Frame>

## Eine Sperre setzen

1. Wähle **Legal Hold setzen**.
2. Wähle das Ziel: eine Person als Verwahrer oder die gesamte Organisation. Wähle für eine Person das richtige Mitglied aus.
3. Begründe die Sperre so, dass ein anderer Admin versteht, was erhalten bleiben muss. Verknüpfe sie bei Bedarf mit einem Fall.
4. Bestätige und prüfe Ziel und Begründung in der Liste aktiver Sperren.

Eine gesetzte Sperre gilt sofort. Betroffene Daten sind vor Aufbewahrungsbereinigung und Löschung geschützt. Löschversuche werden abgelehnt. Bestimme den passenden Umfang anhand des Beweissicherungsprozesses deiner Organisation.

## Sperren nach Fall ordnen

Mit **Fall anlegen** bündelst du zusammengehörige Sperren unter einem Namen und Aktenzeichen. Die Zahl verknüpfter Sperren hilft zu prüfen, ob die vorgesehenen Personen abgedeckt sind.

Wenn du einen Fall schließt, werden Freigabeanträge für seine Sperren gestellt. Die Sperren enden dadurch nicht sofort. Jeder Antrag braucht weiterhin die folgende Prüfung.

## Eine Sperre freigeben

1. Wähle bei der aktiven Sperre **Freigabe beantragen** und begründe, warum die Aufbewahrung nicht mehr nötig ist.
2. Ein anderer Admin prüft den Antrag und wählt **Genehmigen** oder **Ablehnen**. Die antragstellende Person kann ihre eigene Freigabe nicht genehmigen.
3. Prüfe nach der Genehmigung die angezeigte Wartezeit in den Freigabeanträgen. Bis sie endet, bleibt die Sperre wirksam.
4. Prüfe das abgeschlossene Ergebnis im Freigabeverlauf und die verbleibenden Sperren in der aktiven Liste.

Für das Setzen genügt ein Admin. Die Freigabe braucht das Vier-Augen-Prinzip und eine Wartezeit. Eine Genehmigung bedeutet deshalb noch keine abgeschlossene Freigabe.

## Blockierte Löschungen verstehen

Eine Sperre kann Löschanfragen für die Person, das Löschen betroffener Chats oder Dokumente und das Löschen eines Ordners mit gesperrten Dateien verhindern. Jede aktive Organisations- oder Mitgliedssperre verhindert außerdem das Löschen der gesamten Organisation.

Scheitert eine Löschung, prüfe die zuständige Sperre, statt die Aktion zu wiederholen. Die Freigabe einer Sperre hebt keine andere überlappende Sperre auf. Nach der Freigabe kann die geltende Aufbewahrungs- oder Löschverarbeitung fortfahren.

## Zugehörige Anfragen prüfen

Unter [Anfragen betroffener Personen](/platform/admin/governance/data-subject-requests) findest du durch Sperren blockierte Löschbelege. In den [Audit-Logs](/platform/admin/governance/audit-logs) untersuchst du protokollierte Sperraktionen. Die [Aufbewahrungsrichtlinie](/platform/admin/governance/policies-and-limits) steuert die normale Bereinigung, sobald die Sperre nicht mehr greift.
