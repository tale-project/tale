---
title: Branding
description: Logo, Favicon und die Akzentfarbe, die deine Organisation ihren Mitgliedern zeigt. Admins lesen das, wenn sie eine selbst gehostete Instanz whitelabeln oder die In-Produkt-Chrome an die Firmenpalette angleichen.
---

Branding ist die Oberfläche, die Tales Standard-Chrome gegen die deiner Organisation tauscht. Die Seite deckt die Assets ab, die die Plattform überzieht — Logo, Favicon und die Akzentfarbe, aus der sich die Palette ableitet — und erklärt, wo jedes davon erscheint, damit du vor dem Speichern eine Vorschau hast. Der Produktname selbst folgt automatisch dem Namen deiner Organisation, es gibt also kein separates Feld dafür. Admins greifen zu Branding, wenn eine selbst gehostete Instanz an ein externes Publikum geht oder wenn ein internes Rollout sich nativ für die Firma anfühlen soll.

Nur Admins und Inhaber können Branding bearbeiten. Alle anderen sehen das Ergebnis; das Formular selbst ist für Redakteure, Entwickler und Mitglieder ausgeblendet.

<Frame caption="Einstellungen > Branding — die Logo-, Favicon- und Farb-Steuerungen neben einer Live-Vorschau der Sidebar.">

![Die Branding-Einstellungsseite mit Logo- und Favicon-Uploads, einem Feld für die Akzentfarbe und einem Live-Vorschaubereich rechts.](/images/platform/settings-branding.webp)

</Frame>

## Wo Branding lebt

Öffne **Einstellungen > Branding**. Das Formular hat drei Abschnitte (Logo-Upload, Favicon-Upload, Akzentfarbe) und eine Live-Vorschau, die die Sidebar mit den Werten spiegelt, die du gerade bearbeitest. Speichern setzt die Änderung beim nächsten Seitenaufruf für jedes Mitglied _dieser_ Organisation um — eine Pro-Benutzer-Überschreibung gibt es nicht.

Branding ist auf eine Organisation beschränkt. Jede Organisation behält ihr eigenes Logo, Favicon und ihre Akzentfarbe, sodass ein Wechsel der Organisation die Chrome auf das Branding dieser Organisation umstellt, statt das der vorherigen mitzunehmen. Bearbeitungen hier ändern nur die Organisation, in der du dich gerade befindest.

## Der Produktname

Es gibt kein Feld für „App-Name" oder „Text-Logo". Die Wortmarke im Sidebar-Kopf und der Name im Browser-Tab-Titel sind der eigene Name deiner Organisation, den du auf der Seite **Einstellungen > Organisation** setzt. Benenn die Organisation um, und die Chrome folgt beim nächsten Seitenaufruf. Lade ein Logo-Bild hoch (siehe unten), und es nimmt den Platz der Wortmarke ein; ohne Logo wird der Organisationsname als Text-Wortmarke gerendert.

## Die Assets

**Logo** ist ein Bild — PNG, SVG, JPG, WebP oder ICO. Die Plattform rendert es in Sidebar-Höhe; ziel auf transparenten Hintergrund und eine Wortmarke, die bei etwa 32 Pixel Höhe lesbar ist. Das Logo ist ein einzelner Upload für beide Themes — wähl eine Marke, die auf hellem wie dunklem Hintergrund lesbar ist. Ohne Logo fällt die Chrome auf den Namen deiner Organisation als Text-Wortmarke zurück.

**Favicon** ist das Tab-Icon. Lade eine helle und eine dunkle Variante hoch, damit das Icon lesbar bleibt, egal welches Theme das Betriebssystem gewählt hat — oder lass es leer, und Tale leitet eines aus deinem Logo ab, sobald du es hochlädst, sodass ein einziger Upload sowohl die Sidebar als auch den Browser-Tab überzieht. Ein explizit gesetztes Favicon gewinnt immer gegen das automatisch abgeleitete.

**Akzentfarbe** ist die eine Farbe, aus der sich die Marken-Palette ableitet — Buttons, Fokusringe, Auswahlzustände und die aktive Zeile in der Sidebar nehmen ihren Ton von ihr. Sie akzeptiert jeden Hex-Wert, einmal gewählt für hell wie dunkel; Tale leitet pro Theme eine lesbare Palette ab — wäre die gewählte Farbe gegen den Hintergrund eines Themes schwer lesbar, wird sie nur für dieses Theme in den Kontrast geschoben, das andere bleibt unangetastet, und dieselbe Marke liest sich auf beiden sauber. Die Vorschau zeigt die abgeleitete Palette für das Theme, das du gerade ansiehst.

## Ein durchgespieltes Rebranding

Um eine Instanz für `Acme Corp` umzubranden, setz zuerst den Namen der Organisation auf `Acme Corp` auf der Seite **Einstellungen > Organisation** — dieser Name wird zur Sidebar-Wortmarke und zum Browser-Tab-Titel. Öffne dann **Einstellungen > Branding**, lade die Firmen-Wortmarke als Logo hoch und füge den Marken-Hex (`#3B82F6` im Beispiel) ins Feld für die Akzentfarbe ein. Lass das Favicon leer, und Tale erzeugt eines aus dem Logo. Das Vorschaufeld rechts aktualisiert sich, während du tippst. Speichern setzt die Änderung um; die Sidebar, der Browser-Tab und das Favicon spiegeln das neue Branding sofort.

## Der eigene Login-Screen

Die Anmelde-, Registrierungs- und Passwort-Reset-Screens werden gerendert, bevor du eine Organisation gewählt hast — es gibt also keine Organisation im Kontext, mit der sie gebrandet werden könnten. Sie zeigen das Standard-Branding der Plattform statt das einer einzelnen Organisation; das Branding pro Organisation übernimmt, sobald du im Arbeitsbereich dieser Organisation landest. Melde dich ab und lade die Login-URL neu, um zu prüfen, welche Assets die Pre-Auth-Screens verwenden.

## Wo das hingehört

Branding ist die visuelle Schicht über jeder anderen Admin-Oberfläche; SSO, E-Mail und Audit-Logs tragen die gebrandete Chrome zu deinen Mitgliedern. Weil der Produktname der eigene Name der Organisation ist, halt ihn bei [Mitglieder und Rollen](/de/platform/admin/members-and-roles) scharf. Paar Branding mit [Anbieter](/de/platform/admin/providers), damit die Modellnamen im Chat-Header zur Chrome drumherum passen, und mit [Mitglieder und Rollen](/de/platform/admin/members-and-roles), damit die Personen, die Branding bearbeiten dürfen, dieselben sind, denen der Rest der Org-Chrome gehört.
