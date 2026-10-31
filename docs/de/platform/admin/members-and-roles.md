---
title: Mitglieder und Rollen
description: Füge Personen hinzu, wähle ihre Rechte und verwalte den Kontozugriff.
---

Unter **Einstellungen > Mitglieder** fügst du Personen hinzu und wählst die passende Rolle für ihre Arbeit. Die Rolle bestimmt erlaubte Aktionen. Projektzugriff, Teams und Zuweisungen von Konversationen bestimmen, welche Ressourcen jemand erreichen kann.

<Video src="/videos/de/tutorials/ep8-people/ep8-people.de.mp4" poster="/videos/de/tutorials/ep8-people/ep8-people.de.webp" captions="/videos/de/tutorials/ep8-people/ep8-people.de.vtt" lang="de" title="Episode 8 — Menschen, Rollen & Teams" caption="Episode 8 — Menschen, Rollen & Teams (2:35)">

</Video>

<Frame caption="Einstellungen > Mitglieder — jeder Account und die Rolle, die ihn begrenzt.">

![Die Einstellungsseite Mitglieder, die den Inhaber des Arbeitsbereichs und vier weitere Personen mit je einem Rollen-Badge listet, neben der Schaltfläche Mitglied hinzufügen.](/images/get-started/settings-organization-members.webp)

</Frame>

## Eine Person hinzufügen

Zum Verwalten von Mitgliedern brauchst du ein Konto mit der Rolle Inhaber oder Admin.

1. Öffne **Einstellungen > Mitglieder** und wähle **Mitglied hinzufügen**.
2. Gib die **E-Mail**-Adresse ein. Das Feld **Name** ist optional.
3. Wähle eine **Rolle**. Für die tägliche Nutzung eignet sich Mitglied; die Tabelle unten zeigt, wann mehr Rechte sinnvoll sind.
4. Lege für ein neues Tale-Konto ein **Passwort** fest, das die angezeigten Anforderungen erfüllt. Gehört die Adresse bereits zu einem Konto, verwendet Tale dessen Zugangsdaten und blendet das Passwortfeld aus.
5. Wähle **Mitglied hinzufügen**. Sichere bei einem neuen Konto die Zugangsdaten aus der Bestätigung, bevor du sie schließt. Gib sie über den dafür vorgesehenen Kanal deiner Organisation weiter.

Die Person erscheint in der Mitgliederliste. Tale verschickt in diesem Ablauf weder eine Einladung noch eine E-Mail zum Zurücksetzen des Passworts: Dass du jemanden hinzufügst, ist die Bestätigung der Adresse. Das Konto funktioniert deshalb sofort überall — auch in Anwendungen, bei denen man sich mit dem Tale-Konto anmeldet. Ist die Adresse bereits Mitglied dieser Organisation, zeigt das Formular einen Hinweis und legt keinen zweiten Eintrag an.

Ein von einem Administrator festgelegtes oder zurückgesetztes Passwort sowie ein nach der Rotationsrichtlinie abgelaufenes Passwort erfordern die Änderung bei der Anmeldung. Siehe [die Schritte zur Passwortänderung für Mitglieder](/de/platform/member/preferences#wenn-eine-passwortaenderung-erforderlich-ist).


<Tip>

Ordne die Person nach dem Hinzufügen den benötigten Teams zu. Eine Rolle allein gewährt weder den Projektzugriff eines Teams noch Zugang zu dessen Konversationen.

</Tip>

## Eine Rolle wählen

| Rolle | Typische Aufgaben | Organisationsverwaltung |
| --- | --- | --- |
| **Inhaber** | Alle Produkt- und Verwaltungsaufgaben | Darf auch die Inhaberschaft übertragen und [die Organisation löschen](/de/platform/admin/organization#delete-the-organization), wobei ihre Sandboxes samt Dateien mitgelöscht werden; beim Löschen musst du zuerst den Namen der Organisation eintippen, bevor die Schaltfläche aktiv wird. |
| **Admin** | Personen, Dienste, Richtlinien und die Arbeit des Teams verwalten | Voller Zugriff auf Organisationseinstellungen; keine Übertragung der Inhaberschaft. |
| **Entwickler** | Agenten, Automatisierungen und Integrationen erstellen | Technische Einstellungen wie Anbieter, Connectors und API-Zugriff; keine Mitgliederverwaltung. |
| **Redakteur** | Inhalte pflegen und die tägliche Arbeit bearbeiten | Inhalte bearbeiten; kein Zugriff auf **Automatisierungen**; Connector-Ressourcen nur lesen. |
| **Mitglied** | Chat nutzen, freigegebene Ressourcen lesen und Projektaufgaben erstellen, die eigenen auch mit Projektagenten bearbeiten | Keine Organisationsverwaltung; darf Nachrichtenfeedback abgeben. |
| **Deaktiviert** | Kein aktiver Zugriff | Der Mitgliedschaftseintrag bleibt bestehen, ohne Rechte zu gewähren. |

**Automatisierungen** sehen nur Inhaber, Admins und Entwickler, in der Navigation wie in Projekten; alle anderen sehen über einen Link zu einer Automatisierung **Zugriff verweigert**.

Wer weder Inhaber noch Admin ist, kann **Einstellungen > Mitglieder** nicht öffnen und sieht die eigene Rolle unter [**Einstellungen > Konto > Deine Rolle**](/de/platform/member/preferences#role).

Für Projektaufgaben gilt eine eigene Regel: Wer ein Projekt öffnen kann, erstellt darin Aufgaben und ändert die eigenen, also die selbst erstellten und die zugewiesenen. Redakteure und höhere Rollen ändern jede Aufgabe. Einstellungen, Agenten und Dateien des Projekts bleiben bei den Redakteuren. [Aufgaben auf dem Projektboard verwalten](/de/platform/projects/tasks#wer-aufgaben-erstellen-und-aendern-darf) zählt auf, was Mitglieder mit ihren eigenen Aufgaben tun können.

Die Rolle beschreibt Befugnisse, nicht die Sichtbarkeit jedes Datensatzes. Konversationen folgen ihrer Zuweisung: Eine Person sieht Arbeit, die ihr oder ihren Teams zugewiesen ist. Nicht zugewiesene Konversationen bleiben Inhabern und Admins zur Sichtung vorbehalten. Siehe [Konversationen zuweisen](/de/platform/admin/governance/policies-and-limits#konversations-routing).

Nur Inhaber und Admins können Audit-Protokolle lesen. Aktionen anderer Rollen können trotzdem Einträge erzeugen. Einen Eintrag auszulösen berechtigt nicht dazu, das Protokoll zu öffnen.

## Rolle ändern oder Passwort zurücksetzen

Öffne das Zeilenmenü der Person, wähle **Bearbeiten** und ändere die **Rolle**. Wähle **Speichern** und prüfe anschließend die Rolle in der Liste. Um ein deaktiviertes Mitglied wieder freizuschalten, wählst du ausdrücklich die gewünschte Rolle.

Im Dialog kannst du auch den Anzeigenamen ändern. Die E-Mail-Adresse ist schreibgeschützt. Für ein neues Passwort aktivierst du **Passwort aktualisieren**, gibst ein Passwort gemäß den angezeigten Anforderungen ein und speicherst. Das Mitglied muss bei der nächsten Anmeldung ein neues Passwort wählen; ein Zurücksetzen meldet das Mitglied von allen Sitzungen ab. Prüfe die Identität der Person nach dem Verfahren deiner Organisation, bevor du ihr Konto zurücksetzt.

Deine eigene Rolle lässt sich über dieses Menü nicht ändern. Inhaber lässt sich nicht im Rollenfeld vergeben, und der letzte Administrator darf nicht herabgestuft werden. Auch bestehende Inhaber und der Ersteller der Organisation haben geschützte Rollen. Prüfe bei einer Ablehnung das betroffene Konto, bevor du eine andere Rolle versuchst.

## Die Rechte eines Mitglieds prüfen {#member-rights}

Vier Plattform-Rechte erlauben einem Mitglied je eine eng begrenzte Aktion, für die sonst eine höhere Rolle nötig wäre: **Modelle über die API aufrufen**, **Benachrichtigungen exportieren**, **Für ein anderes Mitglied handeln** und **Skills für die Organisation veröffentlichen**. Um zu sehen, was eine Person darf und warum, öffne ihr Zeilenmenü und wähle **Rechte**. Diese Aktion sehen nur Inhaber und Admins, in jeder Zeile, auch in der eigenen und in der des Inhabers.

Der Dialog listet die vier Rechte. Jedes zeigt **Erlaubt** oder **Nicht erlaubt**, also dieselbe Antwort, die Tale gibt, wenn die Person das Recht nutzt, und darunter die Gründe dafür:

- **Die Einstellung der Organisation.** Bei **Modelle über die API aufrufen**, ob die [Modell-Endpunkte für API-Schlüssel](/de/platform/admin/governance/content-models#model-endpoints) aktiviert sind. Solange sie aus sind, hat niemand dieses Recht, unabhängig von Rolle und Zuweisung; lässt sich die Einstellung nicht lesen, gelten die Endpunkte als aus. Bei **Skills für die Organisation veröffentlichen** die Stufe der [Richtlinie zur Skill-Freigabe](/de/platform/admin/governance/policies-and-limits#skill-sharing); lässt sich die Richtlinie nicht lesen, gilt **Nur Inhaber und Admins**.
- **Die Rolle.** Sie umfasst das Recht, braucht dafür eine Zuweisung oder schließt bei **Deaktiviert** jedes Recht aus, auch ein zugewiesenes.
- **Die Zuweisung.** Wer das Recht wann zugewiesen hat und bis wann, falls die Zuweisung abläuft, oder wann eine abgelaufene Zuweisung geendet hat. Hat die Person, die zugewiesen hat, die Organisation verlassen, erscheint sie als **Ehemaliges Mitglied**.
- **Die Zuweisung an ein Team.** Ist das Recht einem [Team](/de/platform/admin/governance/competences#grant-a-capability-to-a-team) zugewiesen, dem ein Inhaber oder Admin die Person hinzugefügt hat: das Team, wer das Recht wann zugewiesen hat und bis wann, eine Zeile je Team. Die Person hat das Recht über das Team, solange sie ihm angehört. Ein Team, dem sie über deinen Identitätsanbieter angehört, gibt ihr keine Zuweisung und erscheint deshalb nicht.

Braucht die Rolle eine Zuweisung und hat weder die Person noch eines ihrer Teams eine, steht dort, dass das Recht nicht zugewiesen ist.

Der Schalter neben jedem Recht steht für die eigene Zuweisung der Person im [Kompetenzregister](/de/platform/admin/governance/competences), nicht für die Antwort: Er ist an, solange die Person selbst eine aktive Zuweisung hat. Ein Schalter kann also an sein, während das Recht **Nicht erlaubt** zeigt, etwa solange die Modell-Endpunkte aus sind oder wenn das Mitglied die Rolle **Deaktiviert** hat. Umfasst die Rolle das Recht oder gilt eine Zuweisung an ein Team, zeigt es **Erlaubt** bei ausgeschaltetem Schalter. Die Zuweisung an ein Team hat hier keinen Schalter: Widerrufe sie unter [Kompetenzen](/de/platform/admin/governance/competences) oder entferne die Person aus dem Team.

- Um ein Recht zuzuweisen, aktiviere seinen Schalter. **Kompetenz zuweisen** öffnet sich mit Person und Recht bereits gewählt: Lege unter **Läuft ab** fest, wann die Zuweisung endet, halte bei Bedarf einen **Nachweis** fest und wähle **Zuweisen**.
- Um die Zuweisung zu widerrufen, deaktiviere den Schalter und bestätige mit **Widerrufen**.

Beides wirkt wie Zuweisen und Widerrufen unter [Kompetenzen](/de/platform/admin/governance/competences), mit denselben Prüfungen, und jede Änderung steht im Register und im Audit-Log. Der Dialog liest die Rechte bei jedem Öffnen neu; lassen sie sich nicht laden, wähle **Erneut versuchen**.

## Inhaberschaft übertragen

Als Inhaber kannst du im Zeilenmenü eines anderen Mitglieds **Inhaberschaft übertragen** wählen. Lies die Bestätigung sorgfältig: Die gewählte Person wird Inhaber, du selbst wirst Admin. Verwende diese Aktion für eine Übergabe der Verantwortung, nicht für eine normale Rollenänderung.

## Zugriff entziehen oder wiederherstellen

Wähle **Deaktiviert**, wenn der Zugriff enden, die Mitgliedschaft aber bestehen bleiben soll. **Löschen** im Zeilenmenü entfernt die Mitgliedschaft aus dieser Organisation und löscht dabei auch die getrennten Sandbox-Arbeitsbereiche der [Agentenläufe, die die Person gestartet hat](/de/platform/projects/tasks#agentenlaeufe-die-ein-mitglied-startet), samt Dateien; mit **Deaktiviert** bleiben diese Arbeitsbereiche erhalten. Außerdem widerruft es die [API-Schlüssel](/de/platform/admin/api-keys#create-a-key-for-someone-else), die ein Inhaber oder Admin hier für die Person erstellt hat, und die Schlüssel, die die Person hier für andere Mitglieder erstellt hat. In beiden Fällen gehen Reviews, die auf die Person warten, an den nächsten [Reviewer](/de/platform/projects/tasks#zustaendigkeit-und-pruefung-festlegen). Nach dem Entfernen behalten Aufgaben die Kommentare, Aktivitäten und Zuständigkeiten der Person und zeigen **Ehemaliges Mitglied**, wo vorher ihr Name stand. Prüfe vorher geteilte Arbeit und Teamverantwortungen. Eine Mitgliedschaft zu entfernen ist keine [Löschanfrage einer betroffenen Person](/de/platform/admin/governance/data-subject-requests).

Hat ein Mitglied seinen Authenticator oder Passkey verloren, öffne **Bearbeiten** und nutze die jeweiligen Sicherheitsfunktionen. [Zwei-Faktor-Authentifizierung](/de/platform/admin/two-factor-authentication) erklärt Wiederherstellung, Zurücksetzen und die Folgen für aktive Sitzungen.
