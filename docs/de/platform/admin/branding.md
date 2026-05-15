---
title: Branding
description: App-Name, Logo, Favicon und Markenfarben anpassen, damit die laufende App nach deiner Organisation aussieht und nicht nach Tale.
---

Branding ist die kosmetische Schicht über Tale. Sie ersetzt das Wort „Tale" im Browser-Tab und in der Kopfzeile durch den Namen deiner Organisation, tauscht Logo und Favicon und legt die zwei Farben fest, die App-weit für Schaltflächen und Hervorhebungen verwendet werden. Zielgruppe sind Admins — bei jeder anderen Rolle ist die Schaltfläche ausgeblendet — und der Zweck ist, die Momente zu reduzieren, in denen ein Mitglied Tale öffnet und einen Namen sieht, der nicht der eigene ist. Änderungen gelten organisationsweit, sobald sie gespeichert sind; ein Reload auf anderen Clients ist nicht nötig.

Branding ändert nicht, was das Produkt tut oder welche Modelle verfügbar sind. Dafür sind [KI-Anbieter](/de/platform/admin/providers) und [Richtlinien](/de/platform/admin/governance) die richtigen Seiten.

## Verfügbare Optionen

Das Formular liegt unter **Einstellungen > Branding** und zeigt einen Bildschirm voll Optionen.

| Option          | Beschreibung                                                                                                                                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **App-Name**    | Ersetzt „Tale" im Browser-Tab-Titel und im Seitenkopf. Platzhalter: `z. B. Acme GmbH`.                                                                                                                                   |
| **Text-Logo**   | Optionaler kurzer Text, der neben dem Logo-Bild in der Navigation erscheint — nützlich, wenn das Bild allein den Namen nicht trägt.                                                                                      |
| **Logo**        | Das Bild in der Navigationsleiste. Lade PNG, JPEG oder SVG hoch; SVG empfiehlt sich für scharfes Rendering auf jeder Viewport-Größe. Getrennte Hell- und Dunkel-Modus-Varianten lassen je ein eigenes Logo pro Theme zu. |
| **Favicon**     | Das 64 × 64 Icon, das Tale dem Browser-Tab ausliefert. Wie beim Logo werden Hell- und Dunkel-Varianten angenommen.                                                                                                       |
| **Markenfarbe** | Primärfarbe — verwendet für Schaltflächen, aktive Zustände, Fokus-Ringe.                                                                                                                                                 |
| **Akzentfarbe** | Sekundärfarbe — verwendet für Hervorhebungen und Badges.                                                                                                                                                                 |

Das Formular zeigt eine Live-Branding-Vorschau, sodass Farbe und Logo sichtbar sind, bevor du speicherst.

## Hell- und Dunkel-Varianten

Sowohl Logo als auch Favicon nehmen getrennte Dateien für Hell- und Dunkel-Modus an. Der aktive Modus folgt der Theme-Wahl jedes Nutzers — eingestellt unter [Deine Einstellungen](/de/platform/member/preferences) — wodurch eine einzige Marke zwei visuell unterschiedliche Logos ausliefern kann, ohne einen expliziten Modus-Umschalter im UI. Lädst du nur eine Variante hoch, verwendet Tale sie für beide Modi.

## Farben

Farben werden als Hex-Codes eingegeben. Tale prüft jede gewählte Farbe gegen das Kontrastverhältnis zum Hintergrund und warnt, wenn der Wert unter das 4,5:1-Verhältnis fällt, das WCAG AA für normalen Text verlangt; die Farbwahl schlägt eine nahe Alternative vor, die den Kontrast besteht. Die Warnung blockiert das Speichern nicht — du kannst sie überstimmen, wenn das Markenbuch es verlangt — aber das Audit-Log hält die Überstimmung fest.

## Wo das hingehört

Branding ist die oberflächliche Anpassungs-Schicht. Es ändert, wie Tale sich dem Team und den Empfängern der Team-E-Mails präsentiert; es ändert nicht, was das Produkt tut, welche Modelle existieren oder was Rollen dürfen. Behandle die Einstellungen hier als günstig und reversibel — jedes Feld hat ein Zurücksetzen-Symbol, das die Tale-Voreinstellung mit einem Klick wiederherstellt, sodass du experimentieren kannst, ohne dich festzulegen.

Für die tiefer greifenden Anpassungs-Oberflächen — das Modell-Menü, die Aufbewahrungsrichtlinie, die Rollen-Matrix — sind [KI-Anbieter](/de/platform/admin/providers), [Richtlinien](/de/platform/admin/governance) und [Mitglieder und Rollen](/de/platform/admin/members-and-roles) die richtigen Seiten.
