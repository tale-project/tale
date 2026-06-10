---
title: Branding
description: Logo, Favicon, App-Name und Markenfarben, die deine Organisation ihren Mitgliedern zeigt. Admins lesen das, wenn sie eine selbst gehostete Instanz whitelabeln oder die In-Produkt-Chrome an die Firmenpalette angleichen.
---

Branding ist die Oberfläche, die Tales Standard-Chrome gegen die deiner Organisation tauscht. Die Seite deckt die vier Assets ab, die die Plattform überzieht — App-Name, Logo, Favicon, Marken- und Akzentfarbe — und erklärt, wo jedes davon erscheint, damit du vor dem Speichern eine Vorschau hast. Admins greifen zu Branding, wenn eine selbst gehostete Instanz an ein externes Publikum geht oder wenn ein internes Rollout sich nativ für die Firma anfühlen soll.

Nur Admins und Inhaber können Branding bearbeiten. Alle anderen sehen das Ergebnis; das Formular selbst ist für Redakteure, Entwickler und Mitglieder ausgeblendet.

## Wo Branding lebt

Öffne **Einstellungen > Branding**. Das Formular hat vier Abschnitte (App-Name und Text-Logo, Logo-Upload, Favicon-Upload, Farben) und eine Live-Vorschau, die die Sidebar mit den Werten spiegelt, die du gerade bearbeitest. Speichern setzt die Änderung beim nächsten Seitenaufruf für jedes Mitglied _dieser_ Organisation um — eine Pro-Benutzer-Überschreibung gibt es nicht.

Branding ist auf eine Organisation beschränkt. Jede Organisation behält ihr eigenes Logo, Favicon, ihren App-Namen und ihre Farben, sodass ein Wechsel der Organisation die Chrome auf das Branding dieser Organisation umstellt, statt das der vorherigen mitzunehmen. Bearbeitungen hier ändern nur die Organisation, in der du dich gerade befindest.

## Die vier Assets

**App-Name** ersetzt das Wort `Tale` im Sidebar-Kopf, im Browser-Tab-Titel und in ausgehenden E-Mails. Wähl einen kurzen String, der so liest, wie deine Organisation das Tool intern nennt.

**Text-Logo** ist eine optionale Kurzform für enge Stellen — die eingeklappte Sidebar, der favicon-nahe Kopf. Lass es leer, um auf die ersten Buchstaben des App-Namens zurückzufallen.

**Logo** ist ein Bild — PNG, SVG oder JPG. Die Plattform rendert es in Sidebar-Höhe; ziel auf transparenten Hintergrund und eine Wortmarke, die bei etwa 32 Pixel Höhe lesbar ist. Lade eine helle und eine dunkle Variante separat hoch, falls deine Wortmarke im dunklen Theme invertieren muss.

**Favicon** ist das 64 mal 64 Pixel Tab-Icon. Lade eine helle und eine dunkle Variante hoch, damit das Icon lesbar bleibt, egal welches Theme das Betriebssystem für die Browser-Chrome gewählt hat.

**Markenfarbe** ist der primäre Akzent — Buttons, Fokusringe, die aktive Zeile in der Sidebar. **Akzentfarbe** ist der zweite Ton für Hover- und Auswahlzustände. Beide akzeptieren jeden Hex-Wert; die Vorschau zeigt den Kontrast gegen helle und dunkle Hintergründe.

## Ein durchgespieltes Rebranding

Um eine Instanz für `Acme Corp` umzubranden, öffne **Einstellungen > Branding** und fülle das Formular von oben nach unten. Setz den App-Namen auf `Acme AI`, lade die Firmen-Wortmarke als Logo hoch (helle und dunkle Variante), lade die quadratische Acme-Marke als Favicon hoch und füge den Marken-Hex (`#3B82F6` im Beispiel) ins Feld für die Markenfarbe ein. Das Vorschaufeld rechts aktualisiert sich während du tippst. Speichern setzt die Änderung um; die Sidebar, der Browser-Tab und die nächste ausgehende E-Mail spiegeln das neue Branding sofort.

## Der eigene Login-Screen

Die Anmelde-, Registrierungs- und Passwort-Reset-Screens werden gerendert, bevor du eine Organisation gewählt hast — es gibt also keine Organisation im Kontext, mit der sie gebrandet werden könnten. Sie zeigen das Standard-Branding der Plattform statt das einer einzelnen Organisation; das Branding pro Organisation übernimmt, sobald du im Arbeitsbereich dieser Organisation landest. Melde dich ab und lade die Login-URL neu, um zu prüfen, welche Assets die Pre-Auth-Screens verwenden.

## Wo das hingehört

Branding ist die visuelle Schicht über jeder anderen Admin-Oberfläche; SSO, E-Mail und Audit-Logs tragen die gebrandete Chrome zu deinen Mitgliedern. Paar es mit [Anbieter](/de/platform/admin/providers), damit die Modellnamen im Chat-Header zur Chrome drumherum passen, und mit [Mitglieder und Rollen](/de/platform/admin/members-and-roles), damit die Personen, die Branding bearbeiten dürfen, dieselben sind, denen der Rest der Org-Chrome gehört.
