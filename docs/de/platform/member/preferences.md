---
title: Einstellungen
description: Die Mitglieder-Einstellungen, die dir über Organisationen und Chats hinweg folgen — Name und Passwort unter Konto, Theme und Locale im Profilmenü, deine Erinnerungen, und Abmelden.
---

Einstellungen sind die Schrauben, die dir gehören, nicht der Organisation. Dein Name ist das, was Agents und Teamkolleginnen in Chats und Genehmigungen sehen. Deine Locale und dein Theme folgen dir zwischen Geräten. Deine Erinnerungen sind Fakten, die ein Agent über dich vorgeschlagen und du freigegeben hast — getrennt von allem, was Admin oder Redakteur auf Organisationsebene gesetzt hat. Diese Seite zeigt, wo jeder Hebel sitzt und was er ändert.

Die Form ist bewusst zweischichtig: das Profilmenü (überall, einen Klick vom Avatar entfernt) trägt die schnellen Schalter; **Einstellungen > Konto** und **Einstellungen > Personalisierung** tragen die tieferen Kontofelder. Alles hier gehört dir — nichts davon lecken zu anderen Mitgliedern oder anderen Organisationen durch.

## Das Profilmenü

Klick auf deinen Avatar oben rechts. Das Dropdown öffnet sich mit deinem Namen, deiner E-Mail und der aktuellen Build-Version. Unter dem Kopf sitzen vier Schnellschalter, die jedes Mitglied unabhängig von der Rolle sieht: der Theme-Wechsler (**Systemdesign** / **Helles Design** / **Dunkles Design**), das **Sprach**-Untermenü (English, Deutsch, Français), die Zeile **App installieren**, wenn der Browser Tale als PWA installieren kann, und **Abmelden**. Theme und Sprache greifen sofort und bleiben pro Gerät erhalten.

Das Menü trägt außerdem einen Organisationswechsler, wenn du zu mehr als einer Organisation gehörst, und einen Team-Filter, wenn deine aktuelle Organisation Teams hat. Das sind keine Einstellungen — sie ändern, was Tale dir zeigt, nicht wie Tale sich verhält. Unter dem Team-Filter öffnet **Benutzereinstellungen** den Bereich **Einstellungen > Konto**, die nächste Seite hier.

## Konto — Name, E-Mail, Passwort, Zwei-Faktor

Öffne **Einstellungen > Konto**. Drei Abschnitte sitzen auf der Seite: **Profil**, **Sicherheit** und **Zwei-Faktor-Authentifizierung**.

Der Profil-Abschnitt zeigt zuerst deine **E-Mail**, dann deinen **Namen** — die E-Mail legt den Namen nahe, den Tale vorschlägt und den du frei bearbeiten kannst. Der Name ist inline bearbeitbar; die Änderung speichert und schlägt beim nächsten Render in jedem Chat und jeder Genehmigung durch. Die E-Mail ist schreibgeschützt — sie ist das, womit du dich angemeldet hast, und ein Wechsel läuft über den Support. Es gibt kein Avatar-Feld auf der Seite; Tale leitet einen Avatar aus den Initialen deines Namens ab.

Der Sicherheits-Abschnitt hält einen einzelnen Knopf: **Passwort ändern**, wenn du dich mit E-Mail und Passwort registriert hast, **Passwort festlegen**, wenn dein Konto über SSO föderiert ist und du ein Passwort als Rückfall hinzufügen willst. Beide Abläufe erzwingen die Passwort-Richtlinie der Organisation und zeigen die Regeln live, während du tippst, und ein falsches aktuelles Passwort wird direkt am Feld markiert statt als flüchtiger Fehler. Das Ändern deines Passworts meldet dich auf allen Geräten ab — der Dialog warnt dich, bevor du bestätigst, und du meldest dich anschließend mit dem neuen Passwort wieder an. Der Zwei-Faktor-Abschnitt paart das Konto mit einer TOTP-App oder einem Hardware-Schlüssel und zeigt die Backup-Codes einmal bei der Einrichtung.

## Erinnerungen und die Freigabe davor

Eine Erinnerung ist eine kurze Tatsache über dich, die ein Agent vorgeschlagen hat und du behalten hast — eine Vorliebe, die du genannt hast, eine Einschränkung, die du ständig wiederholst, ein Kontext, den mitzunehmen sich lohnt. Erinnerungen sind der einzige Teil deines Kontos, in den ein Agent schreiben kann, und genau deshalb geht der Schreibvorgang zuerst über dich.

Eine vorzuschlagen tut das Modell, indem es ein Tool aufruft — kein Hintergrundprozess liest dabei deine Gespräche mit. Der Aufruf legt den Eintrag als **ausstehend** an und schreibt zugleich eine Audit-Zeile, denn dauerhaftes Wissen über eine Person vorzuschlagen ist protokollierenswert, noch bevor jemand zustimmt. Ein ausstehender Eintrag bewirkt von sich aus nichts: Er wartet als Vorschlag unter **Einstellungen > Personalisierung**, bis du ihn speicherst oder verwirfst, und nur eine gespeicherte Erinnerung lässt sich je wieder lesen.

<Frame caption="Einstellungen > Personalisierung — deine benutzerdefinierten Anweisungen und die Erinnerungen, die der Assistent vorgeschlagen hat, jeweils hinter einem eigenen Schalter über dem Org-Standard.">

![Die Seite Personalisierung mit dem eingeschalteten, ausgefüllten Editor für benutzerdefinierte Anweisungen und darunter dem eingeschalteten Abschnitt Erinnerungen, der noch keine ausstehenden Vorschläge und keine gespeicherten Erinnerungen listet.](/images/platform/settings-preferences.webp)

</Frame>

<Info>

Nichts wandert in deinem Namen in einen Prompt. Eine gespeicherte Erinnerung erreicht eine Antwort nur, wenn das Modell danach sucht und die Suche sie zurückgibt — ein Modell kann sich kein dauerhaftes Wissen über dich verschaffen, indem es es aufschreibt, und es kann einen Vorschlag, den du abgelehnt hast, nicht heimlich nachschlagen.

</Info>

Gespeicherte Erinnerungen stehen auf derselben Seite, jede mit einem Knopf zum Löschen. Eine Erinnerung zu löschen nimmt sie aus dem heraus, was eine Suche zurückgeben kann — mehr Wirkung hat sie nicht, denn es fährt keine zweite Kopie in irgendeinem anderen Prompt mit.

Der Schalter **Erinnerungen** über den Listen gilt für die ganze Funktion, nicht nur für die Seite: Ist er aus, kann der Assistent weder eine Erinnerung vorschlagen noch eine lesen — ein Vorschlag in dieser Zeit wird sofort abgewiesen, nicht für später aufgehoben — und was du schon gespeichert hast, bleibt unangetastet liegen, bis du ihn wieder einschaltest.

## Abmelden

Die Zeile **Abmelden** unten im Profilmenü bestätigt mit einem Dialog, bevor sie die Session löscht. Nach der Bestätigung lädt Tale die Seite zur Anmeldeseite hart neu, damit kein veralteter Zustand im Tab hängenbleibt. Das Abmelden ist pro Gerät — dich auf dem Laptop abzumelden, meldet dich nicht auf dem Handy ab, und umgekehrt.

## Wo das hingehört

Einstellungen sind die Linie zwischen dir und dem Rest der Organisation. Der Org-Admin setzt die Standardwerte — die Passwort-Richtlinie, welche Modelle erlaubt sind, welche Governance für einen Chat gilt — und deine Einstellungen überschreiben sie dort, wo Tale es zulässt. Die nächste Lektüre, die sich lohnt, ist [Mitglieds-Übersicht](/de/platform/member/overview) für die Karte des restlichen Mitglieder-Bereichs, oder [Als App installieren](/de/platform/member/install-as-app), wenn du willst, dass Tale in deinem Dock statt in deinen Browser-Tabs lebt.
