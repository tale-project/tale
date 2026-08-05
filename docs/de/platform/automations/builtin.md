---
title: Mitgelieferte Automatisierungen
description: Was jede mitgelieferte Automatisierung tut — das Posteingangs-Trio, das Bundle GitHub-Issues lösen, die Sync- und Pflege-Vorlagen und die vorinstallierten Pakete, die Boards und Erwähnungen am Laufen halten.
---

Tale liefert Automatisierungen von Haus aus mit: drei, die ein Postfach in einen geteilten Posteingang verwandeln, ein Bundle, das GitHub-Issues von Anfang bis Ende löst, eine Reihe von Sync- und Pflege-Vorlagen zum Installieren bei Bedarf, und die vorinstallierten Pakete, die Aufgaben-Boards und Erwähnungen für jede Organisation am Laufen halten. Redakteure und Mitglieder nutzen, was eine installierte Automatisierung mitbringt — einen Posteingang-Tab, einen Backlog-Eintrag —, ohne selbst etwas zu installieren; das Installieren ist eine Aktion für Inhaber, Admin oder Entwickler, die [Automatisierungen durchsuchen und installieren](/de/platform/automations/catalog) behandelt. Diese Seite benennt, was jede einzelne tut, und welche Connector zuerst verbunden sein muss.

<Frame caption="Der Automatisierungs-Katalog — jede Karte ist eine Installation entfernt; versteckte Paket-Mitglieder und Bundle-Interna bleiben aus der Liste heraus.">

![Der Automatisierungs-Katalog auf dem Tab Alle Automatisierungen, mit Karten für die E-Mail-Automatisierungen und das Bundle GitHub-Issues lösen, jede mit Icon und Beschreibung.](/images/platform/automations-catalog.webp)

</Frame>

## Gmail, Outlook und E-Mail über IMAP synchronisieren

**Gmail-E-Mails synchronisieren**, **Outlook-E-Mails synchronisieren** und **E-Mails über SMTP/IMAP synchronisieren** sind dieselbe Automatisierung dreimal, je einmal pro Postfach-Art: Jede braucht genau die Connector, die ihr Name sagt, jede installiert dieselbe kanalunabhängige mitgelieferte Ansicht **Posteingang**, und jede bringt den Mail-Sync-Workflow mit, der das Postfach nach Zeitplan in Konversationen holt, ab Werk alle fünf Minuten — ändere den [Zeitplan-Trigger](/de/platform/automations/triggers), wenn du seltener abholen willst. Eine Organisation, die Mail auf mehr als einer Postfach-Art empfängt, installiert mehr als eine davon; jeder Posteingang zeigt nur den Verkehr seines eigenen Postfachs. Hat ein Connector mehrere Einträge — zwei IMAP-Postfächer, zwei Gmail-Konten — deckt ein Sync-Lauf jeden aktiven Eintrag ab, und jedes Postfach merkt sich seine eigene Position in seinem eigenen Verkehr: Ein später ergänztes Postfach überspringt also nicht alles, was älter ist als der Stand des ersten. Ein Postfach, das gerade nicht erreichbar ist, lässt der Lauf aus und nimmt es beim nächsten Mal wieder mit, ohne die anderen aufzuhalten. Die passenden **…-Posteingang sichten**-Automatisierungen verteilen sich genauso und schreiben danach eine Zusammenfassung über jedes verbundene Postfach.

| Automatisierung                        | Braucht   | Postfach                                  |
| -------------------------------------- | --------- | ----------------------------------------- |
| Gmail-E-Mails synchronisieren          | Gmail     | Ein Gmail-Postfach                        |
| Outlook-E-Mails synchronisieren        | Outlook   | Ein Microsoft-Outlook-Postfach            |
| E-Mails über SMTP/IMAP synchronisieren | IMAP/SMTP | Jedes private Postfach über IMAP und SMTP |

## Der Posteingang-Tab

Jede der drei öffnet auf ihrem Tab **Posteingang**: vier Unter-Tabs — **Offen**, **Geschlossen**, **Spam**, **Archiviert** — jeder eine geteilte Ansicht mit der Konversationsliste links und dem ausgewählten Thread rechts. Eine Konversation zu öffnen füllt die rechte Seite mit ihrem vollständigen Nachrichtenverlauf; solange du keine auswählst, steht dort **Wähle eine Konversation, um Details anzuzeigen**.

Das Nachrichtenfeld sitzt unter dem Thread im Tab **Offen** — Antworten gehören zu aktiven Konversationen, deshalb sind die anderen drei Tabs reine Leseansichten. Schreib in **Nachricht eingeben** und klick auf **Senden**; die Antwort geht über das Postfach hinaus, über das die Konversation ankam, mit Empfänger und Betreffzeile aus dem Thread abgeleitet — du adressierst nichts von Hand. Der Thread-Kopf zeigt den echten **Absender** dieser Konversation — die Adresse, an die der Kontakt geschrieben hat, oder den Absender, den du beim Verfassen wählst —, damit das, was du siehst, dem entspricht, was eine Antwort wirklich als Absender trägt. Bei einer Gmail- oder Outlook-Verbindung ist der **Absender** beim Verfassen die Adresse des verbundenen Kontos; bei IMAP/SMTP bearbeitest du nur den lokalen Teil von **Absender**, und die verifizierte Domain bleibt als Badge fixiert, damit du sie nicht verlässt. **Verbessern** überarbeitet deinen Entwurf mit AI, bevor du sendest. Bei der IMAP-Automatisierung landen auch Antworten, die direkt aus dem Postfach gesendet wurden — egal aus welchem Mail-Programm —, in der Konversation, eingeordnet in den übrigen Verlauf.

Der Thread-Kopf trägt die Status-Verben für die ausgewählte Konversation — **Konversation schließen** und **Als Spam markieren** auf einem offenen Thread, **Konversation erneut öffnen** auf einem geschlossenen oder archivierten, **Kein Spam** und das destruktive **Löschen** auf Spam. Mehrere Zeilen in der Liste auszuwählen, bringt dieselben Verben als Massenaktionen hervor.

Admins und Inhaber nutzen im Kopf außerdem die Steuerung **Zuständig**, um Arbeit zu verteilen. Öffne sie und wähl unter **Personen** und **Team** — die beiden Dimensionen sind unabhängig, eine Konversation kann also in der Warteschlange eines Teams liegen und trotzdem einer Person zugewiesen sein. Wechselt die Person, bekommt sie eine Benachrichtigung in der App und per E-Mail; weist du einem Team zu, bekommen dessen Mitglieder Bescheid (der Handelnde bleibt jeweils draußen). Selbstzuweisung, die Person freigeben (**Zuweisung aufheben**) und das Team entfernen (**Team entfernen**) benachrichtigen niemanden. Nicht-Admins sehen die aktuelle Zuweisung nur lesend. Kombiniere die Zuweisung mit [Konversations-Routing](/de/platform/admin/governance/policies-and-limits#konversations-routing), wenn eingehende Adressen automatisch in eine Warteschlange sollen, und mit [Konversationssteuerung nach Zuständigkeit](/de/platform/admin/governance/policies-and-limits#konversationssteuerung-nach-zustaendigkeit), wenn ein zugewiesener Thread nur für dieses Team oder diese Person sichtbar sein soll.

## GitHub-Issues lösen

**GitHub-Issues lösen** ist ein Bundle, keine einzelne Automatisierung: Es installiert über einen gebündelten Assistenten vier versteckte Automatisierungen auf einmal, gebunden an das Projekt, das du wählst, und braucht die GitHub-Connector. Jedes Mitglied übernimmt eine Etappe der Schleife.

**GitHub-Issues sichten** bewertet die offenen GitHub-Issues eines Repositorys und schlägt die umsetzbaren als Vorschlag im Projekt-Backlog vor — ein Mensch startet sie von dort. Die vorgeschlagene Aufgabe trägt den Titel `#<Nummer> <Titel>` und übernimmt die Labels des GitHub-Issues.

**GitHub-Issues abgleichen** schließt eine Board-Aufgabe, wenn ihr GitHub-Issue geschlossen wurde. Prüft die offenen Aufgaben des Boards selbst und übersieht so keine. Nur Aktualisierung — legt nie neue Aufgaben an. Das gilt unabhängig davon, ob die Lösungskette den Fix gemergt hat oder jemand das Issue direkt auf GitHub geschlossen hat.

**GitHub-Pull-Requests erstellen** liefert den PR-Creator-Agent: Sobald ein Mensch eine vorgeschlagene Aufgabe startet, klont er das Repository, öffnet oder übernimmt den Pull Request für das Issue, implementiert den Fix, prüft ihn gegen die eigenen Tests des Projekts und wartet, bis CI grün wird.

**GitHub-Pull-Requests prüfen** liefert den PR-Reviewer-Agent: Er testet den Branch des PR-Creators erneut, bestätigt CI, und ein werkzeugloser Richter entscheidet über die Merge-Fähigkeit — genehmigt parkt die Aufgabe bei **In Prüfung** für einen Menschen, der auf GitHub merged; nicht genehmigt schickt sie mit Feedback zurück an den PR-Creator, bis zu einer kleinen Nacharbeits-Obergrenze.

An zwei Stellen bleibt ein Mensch in der Schleife: beim Starten einer vorgeschlagenen Aufgabe aus dem Backlog, und beim Mergen des Pull Requests auf GitHub selbst — nichts im Bundle merged in deinem Namen.

## Sync- und Pflege-Vorlagen

Acht weitere Automatisierungen liegen im Katalog für den Moment, in dem du sie brauchst. Jede ist ein einzelner Workflow: installieren, auf die eigenen Daten richten — die Sync-Vorlagen fragen ihre Quelle über den Zeitplan ab, den sie anlegen — und danach jederzeit auf der eigenen Seite der Automatisierung anpassbar, wo eine Änderung zu einer neuen Version wird, die du live schaltest, wenn du bereit bist.

| Automatisierung                                        | Braucht      | Was sie tut                                                                                          |
| ------------------------------------------------------ | ------------ | ---------------------------------------------------------------------------------------------------- |
| Confluence-Seiten synchronisieren                      | Confluence   | Importiert die Seiten eines Confluence-Bereichs nach Zeitplan in die Wissensbibliothek               |
| Google-Drive-Dateien synchronisieren                   | Google Drive | Importiert die Dokumente eines Drive-Ordners in die Wissensbibliothek                                |
| Shopify-Kunden synchronisieren                         | Shopify      | Importiert die Kundinnen und Kunden des Shops in die Kontaktdaten der Organisation                   |
| Shopify-Produkte synchronisieren                       | Shopify      | Importiert den Produktkatalog des Shops in die Produktdaten der Organisation                         |
| Produktbeziehungen analysieren                         | —            | Durchsucht den Produktkatalog und erfasst Zubehör, Varianten und Ergänzungen                         |
| Dokumente für die Suche indexieren                     | —            | Indexiert neu hochgeladene Dokumente, damit Agenten sie durchsuchen und zitieren können              |
| Inaktive Konversationen archivieren                    | —            | Schließt Konversationen, die über ihr Inaktivitätsfenster hinaus still geblieben sind                |
| Mitglieder bei eingehenden Nachrichten benachrichtigen | —            | Informiert Mitglieder, sobald eine neue eingehende Nachricht in einer offenen Konversation eintrifft |

## Die vorinstallierten Pakete

Auch die Mechanik, die die Boards jeder Organisation antreibt, ist als Automatisierungen gebaut — bei der Erstellung automatisch installiert, im Katalog versteckt, auf dem Tab **Installiert** aber sichtbar wie alles andere. Das **Aufgaben-Paket** startet einen zugewiesenen Agenten, sobald eine Aufgabe bei ihm landet, sichtet unzugewiesene Arbeit, reagiert auf @-Erwähnungen, schickt erledigte Arbeit durch die Prüfung, räumt hängende Läufe auf, setzt SLAs durch und hält abhängige Aufgaben, Unteraufgaben und Archive in Bewegung; ein Schwesterpaket hält OneDrive-Dateien synchron. Jedes ist eine normale Automatisierung — öffne eine, um ihr Dokument auf dem Canvas zu lesen, in ihrer [Liste der Läufe](/de/platform/automations/execution-logs) zu verfolgen, was sie getan hat, oder einen [Trigger](/de/platform/automations/triggers) abzuschalten, damit sie nicht mehr feuert; eine Deinstallation bleibt bestehen und wird nie hinter deinem Rücken rückgängig gemacht.

## Wo das hineinpasst

Die Posteingangs-Automatisierungen, das Bundle GitHub-Issues lösen und die Sync-Vorlagen sind das, was heute mitgeliefert wird; eine private Automatisierung, die deine Organisation baut oder hochlädt, taucht im selben Katalog gleich daneben auf. [Automatisierungen durchsuchen und installieren](/de/platform/automations/catalog) deckt die Katalog-Mechanik ab; [Projekt-Backlog](/de/platform/projects/backlog) ist die nächste Lektüre dafür, was mit einer Aufgabe passiert, nachdem GitHub-Issues sichten sie vorgeschlagen hat.
