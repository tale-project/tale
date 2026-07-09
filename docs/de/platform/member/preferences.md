---
title: Einstellungen
description: Die Mitglieder-Einstellungen, die dir über Organisationen und Chats hinweg folgen — Name und Passwort unter Konto, Theme und Locale im Profilmenü, benutzerdefinierte Anweisungen und Erinnerungen unter Personalisierung, und Abmelden.
---

Einstellungen sind die Schrauben, die dir gehören, nicht der Organisation. Dein Name ist das, was Agents und Teamkolleginnen in Chats und Genehmigungen sehen. Deine Locale und dein Theme folgen dir zwischen Geräten. Deine eigenen Anweisungen und Erinnerungen prägen, wie Agents speziell dir antworten — getrennt von allem, was Admin oder Redakteur auf Organisationsebene gesetzt hat. Diese Seite zeigt, wo jeder Hebel sitzt und was er ändert.

Die Form ist bewusst zweischichtig: das Profilmenü (überall, einen Klick vom Avatar entfernt) trägt die schnellen Schalter; **Einstellungen > Konto** und **Einstellungen > Personalisierung** tragen die tieferen Kontofelder. Alles hier gehört dir — nichts davon lecken zu anderen Mitgliedern oder anderen Organisationen durch.

## Das Profilmenü

Klick auf deinen Avatar oben rechts. Das Dropdown öffnet sich mit deinem Namen, deiner E-Mail und der aktuellen Build-Version. Unter dem Kopf sitzen vier Schnellschalter, die jedes Mitglied unabhängig von der Rolle sieht: der Theme-Wechsler (**Systemdesign** / **Helles Design** / **Dunkles Design**), das **Sprach**-Untermenü (English, Deutsch, Français), die Zeile **App installieren**, wenn der Browser Tale als PWA installieren kann, und **Abmelden**. Theme und Sprache greifen sofort und bleiben pro Gerät erhalten.

Das Menü trägt außerdem einen Organisationswechsler, wenn du zu mehr als einer Organisation gehörst, und einen Team-Filter, wenn deine aktuelle Organisation Teams hat. Das sind keine Einstellungen — sie ändern, was Tale dir zeigt, nicht wie Tale sich verhält. Unter dem Team-Filter öffnet **Benutzereinstellungen** den Bereich **Einstellungen > Konto**, die nächste Seite hier.

## Konto — Name, E-Mail, Passwort, Zwei-Faktor

Öffne **Einstellungen > Konto**. Drei Abschnitte sitzen auf der Seite: **Profil**, **Sicherheit** und **Zwei-Faktor-Authentifizierung**.

Der Profil-Abschnitt zeigt zuerst deine **E-Mail**, dann deinen **Namen** — die E-Mail legt den Namen nahe, den Tale vorschlägt und den du frei bearbeiten kannst. Der Name ist inline bearbeitbar; die Änderung speichert und schlägt beim nächsten Render in jedem Chat und jeder Genehmigung durch. Die E-Mail ist schreibgeschützt — sie ist das, womit du dich angemeldet hast, und ein Wechsel läuft über den Support. Es gibt kein Avatar-Feld auf der Seite; Tale leitet einen Avatar aus den Initialen deines Namens ab.

Der Sicherheits-Abschnitt hält einen einzelnen Knopf: **Passwort ändern**, wenn du dich mit E-Mail und Passwort registriert hast, **Passwort festlegen**, wenn dein Konto über SSO föderiert ist und du ein Passwort als Rückfall hinzufügen willst. Beide Abläufe erzwingen die Passwort-Richtlinie der Organisation und zeigen die Regeln live, während du tippst, und ein falsches aktuelles Passwort wird direkt am Feld markiert statt als flüchtiger Fehler. Das Ändern deines Passworts meldet dich auf allen Geräten ab — der Dialog warnt dich, bevor du bestätigst, und du meldest dich anschließend mit dem neuen Passwort wieder an. Der Zwei-Faktor-Abschnitt paart das Konto mit einer TOTP-App oder einem Hardware-Schlüssel und zeigt die Backup-Codes einmal bei der Einrichtung.

## Personalisierung — benutzerdefinierte Anweisungen, Erinnerungen, Sprachausgabe

Öffne **Einstellungen > Personalisierung**. Die Seite öffnet jede Funktion mit einem An/Aus-Schalter, der dem Org-Standard folgt, bis du ihn überschreibst.

<Frame caption="Einstellungen > Personalisierung — die Schalter je Funktion über dem Feld für benutzerdefinierte Anweisungen, der Erinnerungs-Liste und dem Sprachausgabe-Picker.">

![Die Personalisierungs-Einstellungsseite, mit An/Aus-Schaltern für benutzerdefinierte Anweisungen, Erinnerungen und Sprachausgabe, darunter das Textfeld für benutzerdefinierte Anweisungen und die Liste gespeicherter Erinnerungen.](/images/platform/settings-preferences.webp)

</Frame>

**Benutzerdefinierte Anweisungen** ist ein freies Textfeld — bis zu 4.000 Zeichen —, das jeder Agent speziell für deine Konversationen als zusätzlichen Kontext erhält. Nutz es für das, was du sonst oben in jeden Chat schreiben würdest: deine Rolle, deinen bevorzugten Antwortstil, die Projekte, an denen du arbeitest, die Einschränkungen, die der Agent achten soll. Der Org-Standard entscheidet, ob die Funktion für neue Mitglieder an ist; dein Schalter überschreibt ihn für dein eigenes Konto.

**Erinnerungen** sind kurze Fakten, die der Agent zwischen Chats über dich speichert — ein Thema, nach dem du gefragt hast, eine Vorliebe, die du genannt hast, ein Kontext, den du nicht wiederholen willst. Gespeicherte Erinnerungen erscheinen in einer Liste mit einem Lösch-Knopf je Zeile; ausstehende Erinnerungen tauchen in einem eigenen Abschnitt mit **Genehmigen** und **Verwerfen** auf, damit nichts in deinem Profil landet, ohne dass du es siehst. Schalte die Funktion ab, und bestehende Erinnerungen werden nicht mehr genutzt, bis du sie wieder einschaltest.

**Sprachausgabe** wählt die Stimme, die ein Agent im Voice-Modus benutzt. Die Einstellung greift nur, wenn die Organisation einen Voice-Anbieter konfiguriert hat; sonst erklärt der Abschnitt die Lücke und verweist auf den Admin.

## Abmelden

Die Zeile **Abmelden** unten im Profilmenü bestätigt mit einem Dialog, bevor sie die Session löscht. Nach der Bestätigung lädt Tale die Seite zur Anmeldeseite hart neu, damit kein veralteter Zustand im Tab hängenbleibt. Das Abmelden ist pro Gerät — dich auf dem Laptop abzumelden, meldet dich nicht auf dem Handy ab, und umgekehrt.

## Wo das hingehört

Einstellungen sind die Linie zwischen dir und dem Rest der Organisation. Der Org-Admin setzt Standardwerte — inklusive ob Personalisierung für neue Mitglieder an ist, was die Passwort-Richtlinie ist, welche Modelle erlaubt sind — und deine Einstellungen überschreiben die Standardwerte dort, wo Tale es zulässt. Eine persönliche Seite steht abseits dieses Sets: [Umgebungsvariablen & Geheimnisse](/de/platform/member/environment) hält Variablen und Anmeldedaten, die innerhalb einer einzelnen Organisation auf dich begrenzt sind, statt dir über Organisationen hinweg zu folgen — der Ort für den Provider-Schlüssel, den ein BYO-Agent benutzt. Die nächste Lektüre, die sich lohnt, ist [Mitglieds-Übersicht](/de/platform/member/overview) für die Karte des restlichen Mitglieder-Bereichs, oder [Als App installieren](/de/platform/member/install-as-app), wenn du willst, dass Tale in deinem Dock statt in deinen Browser-Tabs lebt.
