---
title: Mitglieder und Rollen
description: Füge Personen hinzu, wähle ihre Rechte und verwalte den Kontozugriff.
---

Unter **Einstellungen > Mitglieder** fügst du Personen hinzu und wählst die passende Rolle für ihre Arbeit. Die Rolle bestimmt erlaubte Aktionen. Projektzugriff, Teams und Zuweisungen von Konversationen bestimmen, welche Ressourcen jemand erreichen kann.

<Video src="/videos/de/tutorials/ep8-people/ep8-people.de.mp4" poster="/videos/de/tutorials/ep8-people/ep8-people.de.webp" captions="/videos/de/tutorials/ep8-people/ep8-people.de.vtt" lang="de" title="Episode 8 — Menschen, Rollen & Teams" caption="Episode 8 — Menschen, Rollen & Teams (2:35)">

</Video>

<Frame caption="Einstellungen > Mitglieder — jeder Account und die Rolle, die ihn begrenzt.">

![Die Einstellungsseite Mitglieder, die den Inhaber des Workspace und vier weitere Personen mit je einem Rollen-Badge listet, neben der Schaltfläche Mitglied hinzufügen.](/images/get-started/settings-organization-members.webp)

</Frame>

## Eine Person hinzufügen

Zum Verwalten von Mitgliedern brauchst du ein Konto mit der Rolle Inhaber oder Admin.

1. Öffne **Einstellungen > Mitglieder** und wähle **Mitglied hinzufügen**.
2. Gib die **E-Mail**-Adresse ein. Das Feld **Name** ist optional.
3. Wähle eine **Rolle**. Für die tägliche Nutzung eignet sich Mitglied; die Tabelle unten zeigt, wann mehr Rechte sinnvoll sind.
4. Lege für ein neues Tale-Konto ein **Passwort** fest, das die angezeigten Anforderungen erfüllt. Gehört die Adresse bereits zu einem Konto, verwendet Tale dessen Zugangsdaten und blendet das Passwortfeld aus.
5. Wähle **Mitglied hinzufügen**. Sichere bei einem neuen Konto die Zugangsdaten aus der Bestätigung, bevor du sie schließt. Gib sie über den dafür vorgesehenen Kanal deiner Organisation weiter.

Die Person erscheint in der Mitgliederliste. Tale verschickt in diesem Ablauf weder eine Einladung noch eine E-Mail zum Zurücksetzen des Passworts: Dass du jemanden hinzufügst, ist die Bestätigung der Adresse. Das Konto funktioniert deshalb sofort überall — auch in Anwendungen, bei denen man sich mit dem Tale-Konto anmeldet. Ist die Adresse bereits Mitglied dieser Organisation, zeigt das Formular einen Hinweis und legt keinen zweiten Eintrag an.

<Tip>

Ordne die Person nach dem Hinzufügen den benötigten Teams zu. Eine Rolle allein gewährt weder den Projektzugriff eines Teams noch Zugang zu dessen Konversationen.

</Tip>

## Eine Rolle wählen

| Rolle | Typische Aufgaben | Organisationsverwaltung |
| --- | --- | --- |
| **Inhaber** | Alle Produkt- und Verwaltungsaufgaben | Darf auch die Inhaberschaft übertragen und die Organisation löschen. |
| **Admin** | Personen, Dienste, Richtlinien und die Arbeit des Teams verwalten | Voller Zugriff auf Organisationseinstellungen; keine Übertragung der Inhaberschaft. |
| **Entwickler** | Agenten, Automatisierungen und Integrationen erstellen | Technische Einstellungen wie Anbieter, Connectors und API-Zugriff; keine Mitgliederverwaltung. |
| **Redakteur** | Inhalte pflegen und die tägliche Arbeit bearbeiten | Inhalte bearbeiten; Workflow- und Connector-Ressourcen nur lesen. |
| **Mitglied** | Chat nutzen und freigegebene Ressourcen lesen | Keine Organisationsverwaltung; darf Nachrichtenfeedback abgeben. |
| **Deaktiviert** | Kein aktiver Zugriff | Der Mitgliedschaftseintrag bleibt bestehen, ohne Rechte zu gewähren. |

Die Rolle beschreibt Befugnisse, nicht die Sichtbarkeit jedes Datensatzes. Konversationen folgen ihrer Zuweisung: Eine Person sieht Arbeit, die ihr oder ihren Teams zugewiesen ist. Nicht zugewiesene Konversationen bleiben Inhabern und Admins zur Sichtung vorbehalten. Siehe [Konversationen zuweisen](/de/platform/admin/governance/policies-and-limits#konversations-routing).

Nur Inhaber und Admins können Audit-Protokolle lesen. Aktionen anderer Rollen können trotzdem Einträge erzeugen. Einen Eintrag auszulösen berechtigt nicht dazu, das Protokoll zu öffnen.

## Rolle ändern oder Passwort zurücksetzen

Öffne das Zeilenmenü der Person, wähle **Bearbeiten** und ändere die **Rolle**. Wähle **Speichern** und prüfe anschließend die Rolle in der Liste. Um ein deaktiviertes Mitglied wieder freizuschalten, wählst du ausdrücklich die gewünschte Rolle.

Im Dialog kannst du auch den Anzeigenamen ändern. Die E-Mail-Adresse ist schreibgeschützt. Für ein neues Passwort aktivierst du **Passwort aktualisieren**, gibst ein Passwort gemäß den angezeigten Anforderungen ein und speicherst. Prüfe die Identität der Person nach dem Verfahren deiner Organisation, bevor du ihr Konto zurücksetzt.

Deine eigene Rolle lässt sich über dieses Menü nicht ändern. Inhaber lässt sich nicht im Rollenfeld vergeben, und der letzte Administrator darf nicht herabgestuft werden. Auch bestehende Inhaber und der Ersteller der Organisation haben geschützte Rollen. Prüfe bei einer Ablehnung das betroffene Konto, bevor du eine andere Rolle versuchst.

## Inhaberschaft übertragen

Als Inhaber kannst du im Zeilenmenü eines anderen Mitglieds **Inhaberschaft übertragen** wählen. Lies die Bestätigung sorgfältig: Die gewählte Person wird Inhaber, du selbst wirst Admin. Verwende diese Aktion für eine Übergabe der Verantwortung, nicht für eine normale Rollenänderung.

## Zugriff entziehen oder wiederherstellen

Wähle **Deaktiviert**, wenn der Zugriff enden, die Mitgliedschaft aber bestehen bleiben soll. **Löschen** im Zeilenmenü entfernt die Mitgliedschaft aus dieser Organisation. Prüfe vorher geteilte Arbeit und Teamverantwortungen. Eine Mitgliedschaft zu entfernen ist keine [Löschanfrage einer betroffenen Person](/de/platform/admin/governance/data-subject-requests).

Hat ein Mitglied seinen Authenticator oder Passkey verloren, öffne **Bearbeiten** und nutze die jeweiligen Sicherheitsfunktionen. [Zwei-Faktor-Authentifizierung](/de/platform/admin/two-factor-authentication) erklärt Wiederherstellung, Zurücksetzen und die Folgen für aktive Sitzungen.
