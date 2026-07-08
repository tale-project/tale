---
title: Mitgelieferte Automatisierungen
description: Was jede der drei mitgelieferten E-Mail-Automatisierungen tut, welche Integration sie braucht, und wie das Bundle GitHub-Issues lösen synchronisierte Issues Ende zu Ende in gemergte Pull Requests verwandelt.
---

Tale liefert Automatisierungen von Haus aus mit: drei einzweckige, die ein Postfach in einen geteilten Posteingang verwandeln, und ein Bundle, das GitHub-Issues von Anfang bis Ende löst. Redakteure und Mitglieder nutzen, was eine installierte Automatisierung mitbringt — einen Posteingang-Tab, einen Backlog-Eintrag —, ohne selbst etwas zu installieren; das Installieren ist eine Aktion für Inhaber, Admin oder Entwickler, die [Automatisierungen durchsuchen und installieren](/de/platform/automations/catalog) behandelt. Diese Seite benennt, was jede einzelne tut, und welche Integration zuerst verbunden sein muss.

## Auf Gmail, Outlook und E-Mail über IMAP antworten

**Auf Gmail-E-Mails antworten**, **Auf Outlook-E-Mails antworten** und **Auf E-Mails über SMTP/IMAP antworten** sind dieselbe Automatisierung dreimal, je einmal pro Postfach-Art: Jede braucht genau die Integration, die ihr Name sagt, und jede installiert dieselbe kanalunabhängige mitgelieferte Ansicht **Posteingang**. Eine Organisation, die Mail auf mehr als einer Postfach-Art empfängt, installiert mehr als eine davon; jeder Posteingang zeigt nur den Verkehr seines eigenen Postfachs.

| Automatisierung                      | Braucht   | Postfach                                  |
| ------------------------------------ | --------- | ----------------------------------------- |
| Auf Gmail-E-Mails antworten          | Gmail     | Ein Gmail-Postfach                        |
| Auf Outlook-E-Mails antworten        | Outlook   | Ein Microsoft-Outlook-Postfach            |
| Auf E-Mails über SMTP/IMAP antworten | IMAP/SMTP | Jedes private Postfach über IMAP und SMTP |

## Der Posteingang-Tab

Jede der drei öffnet auf ihrem Tab **Posteingang**: vier Unter-Tabs — **Offen**, **Geschlossen**, **Spam**, **Archiviert** — jeder eine geteilte Ansicht mit der Konversationsliste links und dem ausgewählten Thread rechts. Eine Konversation zu öffnen füllt die rechte Seite mit ihrem vollständigen Nachrichtenverlauf; solange du keine auswählst, steht dort **Wähle eine Konversation, um Details anzuzeigen**.

Der Composer sitzt unter dem Thread im Tab **Offen** — Antworten gehören zu aktiven Konversationen, deshalb sind die anderen drei Tabs reine Leseansichten. Schreib in **Nachricht eingeben** und klick auf Senden; die Antwort geht über das Postfach hinaus, über das die Konversation ankam, mit Empfänger und Betreffzeile aus dem Thread abgeleitet — du adressierst nichts von Hand. **Verbessern** überarbeitet deinen Entwurf mit AI, bevor du sendest.

Der Thread-Kopf trägt die Status-Verben für die ausgewählte Konversation — **Konversation schließen** und **Als Spam markieren** auf einem offenen Thread, **Konversation erneut öffnen** auf einem geschlossenen oder archivierten, **Kein Spam** und das destruktive **Löschen** auf Spam. Mehrere Zeilen in der Liste auszuwählen, bringt dieselben Verben als Massenaktionen hervor.

## GitHub-Issues lösen

**GitHub-Issues lösen** ist ein Bundle, keine einzelne Automatisierung: Es installiert über einen gebündelten Assistenten vier versteckte Automatisierungen auf einmal, gebunden an das Projekt, das du wählst, und braucht die GitHub-Integration. Jedes Mitglied übernimmt eine Etappe der Schleife.

**GitHub-Issues sichten** bewertet die offenen GitHub-Issues eines Repositorys und schlägt die umsetzbaren als Vorschlag im Projekt-Backlog vor — ein Mensch startet sie von dort. Die vorgeschlagene Aufgabe trägt den Titel `#<Nummer> <Titel>` und übernimmt die Labels des GitHub-Issues.

**GitHub-Issues abgleichen** schließt eine Board-Aufgabe, wenn ihr GitHub-Issue geschlossen wurde. Prüft die offenen Aufgaben des Boards selbst und übersieht so keine. Nur Aktualisierung — legt nie neue Aufgaben an. Das gilt unabhängig davon, ob die Lösungskette den Fix gemergt hat oder jemand das Issue direkt auf GitHub geschlossen hat.

**GitHub-Pull-Requests erstellen** liefert den PR-Creator-Agent: Sobald ein Mensch eine vorgeschlagene Aufgabe startet, klont er das Repository, öffnet oder übernimmt den Pull Request für das Issue, implementiert den Fix, prüft ihn gegen die eigenen Tests des Projekts und wartet, bis CI grün wird.

**GitHub-Pull-Requests prüfen** liefert den PR-Reviewer-Agent: Er testet den Branch des PR-Creators erneut, bestätigt CI, und ein werkzeugloser Richter entscheidet über die Merge-Fähigkeit — genehmigt parkt die Aufgabe bei **In Prüfung** für einen Menschen, der auf GitHub merged; nicht genehmigt schickt sie mit Feedback zurück an den PR-Creator, bis zu einer kleinen Nacharbeits-Obergrenze.

An zwei Stellen bleibt ein Mensch in der Schleife: beim Starten einer vorgeschlagenen Aufgabe aus dem Backlog, und beim Mergen des Pull Requests auf GitHub selbst — nichts im Bundle merged in deinem Namen.

## Wo das hineinpasst

Die drei Posteingangs-Automatisierungen und das Bundle GitHub-Issues lösen sind das, was heute mitgeliefert wird; eine private Automatisierung, die deine Organisation baut oder hochlädt, taucht im selben Katalog gleich daneben auf. [Automatisierungen durchsuchen und installieren](/de/platform/automations/catalog) deckt die Katalog-Mechanik ab; [Projekt-Backlog](/de/platform/projects/backlog) ist die nächste Lektüre dafür, was mit einer Aufgabe passiert, nachdem GitHub-Issues sichten sie vorgeschlagen hat.
