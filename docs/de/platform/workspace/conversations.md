---
title: Konversationen
description: Der gemeinsame Kunden-Posteingang — E-Mail-Threads landen hier, das Team antwortet, und die KI hilft bei Entwürfen, Triage und Follow-ups.
---

Konversationen ist der gemeinsame Posteingang für kundenseitige Kanäle. Wenn eine Nachricht über einen angebundenen Kanal eintrifft — heute ein E-Mail-Postfach, später weitere Kanäle —, erscheint sie hier als Thread; das Team liest, antwortet, schliesst und prüft, ohne die Plattform zu verlassen. Die Seite ist für Redakteure, die eingehenden Verkehr bearbeiten, und für Admins, die Kanal-Verbindungen konfigurieren; Mitglieder sehen den Posteingang im Nur-Lese-Modus, wenn ihre Rolle es zulässt.

Diese Seite behandelt die Laufzeit: einen E-Mail-Kanal anbinden, die vier Thread-Status, den Antwort-Composer mit KI-Verbesserung, Sammelaktionen und Filtern. Die Agent-Seite — wie ein Agent einen Antwort-Entwurf schreibt, wann eine Genehmigungs-Karte auftaucht — liegt im Agent-Bau-Flow unter [Agent erstellen](/de/platform/agents/create).

## Einen E-Mail-Kanal anbinden

Damit ein Postfach in den Posteingang einfliesst, fügt ein Admin oder Entwickler es einmalig unter **Einstellungen > Integrationen** hinzu. Die leere Konversationen-Seite bringt einen Button **E-Mail anbinden** in den Vordergrund, der direkt in den Integrationen-Tab springt. Die Verbindung ist kein generischer `rest_api`-Konnektor — E-Mail hat eine eigene Konfigurationsoberfläche, abgestimmt auf IMAP+SMTP-Zugangsdaten und die OAuth-Abläufe der grossen Mail-Anbieter.

Für OAuth-basierte E-Mail-Anbieter (Microsoft 365, Gmail) nimm den dedizierten OAuth-Flow auf der Integrationen-Karte des Anbieters — passwort-basiertes IMAP ist bei diesen Anbietern standardmässig deaktiviert. Für selbst gehostete oder generische IMAP+SMTP-Postfächer trägst du die Verbindungsfelder direkt ein:

| Feld            | Was rein muss                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------------ |
| Anzeigename     | Der Name, der auf Konversationen aus diesem Postfach erscheint.                                                    |
| Eingang (IMAP)  | Hostname, Port, Verschlüsselung (`SSL/TLS`, `STARTTLS` oder `None`), Benutzername, Passwort.                       |
| Ausgang (SMTP)  | Hostname, Port, Verschlüsselung, Benutzername, Passwort (oft dieselben Zugangsdaten wie IMAP).                     |
| Absenderadresse | Die Adresse, von der Antworten gesendet werden. Muss dem entsprechen, was der SMTP-Server als Absender akzeptiert. |
| Sync-Intervall  | Wie oft Tale neue Mails abruft (Voreinstellung: eine Minute).                                                      |

Nach dem Speichern ruft Tale den Posteingang im konfigurierten Intervall ab. Eingehende Mail wird zu Konversationen-Threads — jede eindeutige Antwortkette ist ein Thread; aus der Plattform gesendete Antworten gehen als normale E-Mails über SMTP raus und werden im Mail-Client des Kunden über die Standard-`In-Reply-To`-Kopfzeilen zurück eingefädelt. Das Postfach bleibt verbunden, bis die Integration entfernt wird; Löschen stoppt die Synchronisation, lässt aber die Threads, die schon im Posteingang sind, stehen.

## Thread-Status

Jeder Thread trägt einen von vier Status, einstellbar aus der Konversations-Kopfzeile oder per Sammelaktion:

| Status      | Bedeutung                                                                     |
| ----------- | ----------------------------------------------------------------------------- |
| Offen       | Aktiver Thread, der eine Antwort braucht oder in Bearbeitung ist.             |
| Geschlossen | Gelöst und als erledigt markiert. Geschlossene Threads bleiben durchsuchbar.  |
| Spam        | Als unerwünscht oder irrelevant markiert. Aus der Standardliste ausgeblendet. |
| Archiviert  | Zur Referenz aufbewahrt, aber aus dem aktiven Posteingang entfernt.           |

Eine neue eingehende Nachricht in einem geschlossenen oder archivierten Thread öffnet ihn automatisch wieder — die Folge-Nachricht des Kunden geht nicht hinter einem Status-Flag verloren.

## Auf eine Konversation antworten

Um zu antworten, öffne die Konversation aus der Liste — der Composer lädt am unteren Rand des rechten Panels. Der Composer ist ein Rich-Text-Editor mit Fett, Kursiv, Listen, Links und Code-Block-Formatierung. Klicke auf das Büroklammer-Icon in der Toolbar, um ein Logo, einen Screenshot oder ein Dokument vom Gerät anzuhängen. Damit die KI den Entwurf vor dem Versand schärft, klicke auf **Mit KI verbessern**, falls der Agent das aktiviert hat; die KI schreibt den Entwurf in einem Vorschau-Bereich um, und du nimmst die Änderungen vor dem Senden an oder lehnst sie ab.

Klicke auf **Senden**, um die Nachricht über den Kanal zu schicken, den der Kunde ursprünglich genutzt hat. Antworten werden automatisch eingefädelt — der Kunde sieht eine durchgehende Konversation in seinem Mail-Client, nicht jedes Mal eine separate Nachricht.

## Sammelaktionen

Um auf mehrere Threads gleichzeitig zu wirken, setze die Kontrollkästchen in der Konversations-Liste. Die Toolbar zeigt die verfügbaren Sammelaktionen: Status ändern (schliessen, wieder öffnen, archivieren, als Spam markieren) oder eine einzelne Antwort an alle ausgewählten Threads als Broadcast schicken. Sammelaktionen werden genauso tief geprüft wie Einzel-Thread-Aktionen; jede Änderung trägt Akteur und Zeitstempel im [Audit-Log](/de/platform/admin/governance) ein.

## Filtern und suchen

Das Filter-Dropdown in der Toolbar engt die Liste nach Lesestatus ein (alle, gelesen, ungelesen). Das Tastaturkürzel `Ctrl + K` (oder `Cmd + K` auf macOS) öffnet die Suche über alle Threads — Betreff, Text und Kunden-E-Mail sind indiziert.

## Wo das einsetzt

Konversationen ist Tales Kunden-Posteingang. Er existiert, weil Antwortarbeit am Kunden nicht in den Chat mit KI passt: Antworten brauchen einen Menschen in der Schleife, einen einzelnen Thread pro Kunde quer durch Kanäle und ein Protokoll, das Prüfer einsehen können. Der Agent, der die KI-Seite bedient, ist derselbe Agent, den der Rest des Arbeitsbereichs nutzt — was sich ändert, ist die Oberfläche.

Um zu konfigurieren, welche Konversationen automatisch entworfene Antworten bekommen, öffne den Agent unter [Agent erstellen](/de/platform/agents/create) und verdrahte das Konversations-Tool. Für Genehmigungen, die aus Kunden-Threads herausfallen — ein Antwort-Entwurf, der auf Prüfung wartet, ein Integrationen-Aufruf, der auf Freigabe wartet —, ist [Genehmigungen](/de/platform/workspace/approvals) die Oberfläche.
