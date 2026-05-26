---
title: Security-Advisory-Prozess
description: Wie Tale sicherheitsrelevante Behebungen koordiniert, einreicht und veröffentlicht.
---

Diese Seite dokumentiert, wie Tale sicherheitsrelevante Behebungen vom ersten Bericht bis zum veröffentlichten Advisory handhabt. Die Form ist konventionell: ein privater Entwurf auf GitHub, ein gepatchtes Release, dann ein öffentliches Advisory mit CVE-Verlinkung und einer Quer-Referenz in den Release-Notes. Die Seite existiert, damit Operatoren wissen, wonach Ausschau zu halten ist, und damit Berichtende wissen, was sie von einer Offenlegung erwarten können.

Der operator-seitige Take ist kurz — abonniere GitHub-Security-Advisories auf `tale-project/tale` und lies den `## 🔒 Security`-Abschnitt jedes Releases. Alles, was ein CVE verdient, taucht an beiden Orten auf, mit dem Upgrade-Pfad und den Workarounds explizit benannt.

## Wo Advisories leben

Der **primäre Kanal** sind [GitHub-Security-Advisories](https://github.com/tale-project/tale/security/advisories) auf `tale-project/tale`. Advisories werden privat entworfen, bei entsprechender Schwere mit einem CVE verlinkt und erst veröffentlicht, nachdem ein gepatchtes Release verfügbar ist. Der Advisory-Body benennt jeden betroffenen Versionsbereich, den gepatchten Versions-Tag, die Auswirkungs-Zusammenfassung und den Upgrade-Pfad.

Jedes Advisory wird in den entsprechenden GitHub-Release-Notes unter dem `## 🔒 Security`-Abschnitt **quer-referenziert** — siehe [Release-Notes-Format](/de/self-hosted/operate/release-notes/format) für die kanonische Form. Ein Operator, der ein Release auf Sicherheitsrelevanz überfliegt, muss die Notes nie verlassen; der Punkt dort benennt das CVE und verlinkt aufs Advisory.

Für die **direkte Benachrichtigung** über kritische Advisories sendet Ruler GmbH bekannten Deployment-Operatoren vor der öffentlichen Offenlegung E-Mails. Es gibt noch keine automatisierte Operator-E-Mail-Liste — das ist ein künftiger Arbeitspunkt. Das Abonnieren von GitHub-Security-Advisories auf dem Repo (`GitHub → Watch → Custom → Security advisories`) ist der unmittelbare Ersatz, kostenlos und funktioniert heute.

## Wann ein Advisory einzureichen ist

Reiche ein GitHub-Security-Advisory ein, wann immer eines davon zutrifft:

- CVSS v3.1-Score von 4,0 oder höher (Medium und darüber).
- Ein Bug, der Geheimnisse über Mandanten hinweg leaken, Session-Tokens leaken oder Privilegien eskalieren könnte.
- Eine Behebung in Authentifizierung, Session-Handling, Organisations-Scoping, Kryptographie oder Geheimnis-Storage — auch wenn kein externer Bericht sie auslöste.
- Ein erreichbarer Abhängigkeits-CVE — also wenn der verwundbare Code-Pfad tatsächlich von Tale durchtrainiert wird.

Reiche **kein** Advisory für Abhängigkeits-CVEs ein, deren Code-Pfade nachweislich von Tale nicht erreichbar sind. Dokumentiere die im normalen `## 🔒 Security`-Release-Notes-Abschnitt mit einer Notiz, warum sie hier nicht ausgenutzt werden können. Advisory-Inflation schadet dem Operator-Signal mehr, als sie hilft.

## Schwere-zu-Eskalations-Matrix

| CVSS             | Advisory     | Release-Notes                | Direkte E-Mail an Operatoren                                               |
| ---------------- | ------------ | ---------------------------- | -------------------------------------------------------------------------- |
| Critical (9,0+)  | Erforderlich | Erforderlich, prominent oben | Ja — vor öffentlicher Offenlegung bei Koordination, sonst beim Publizieren |
| High (7,0–8,9)   | Erforderlich | Erforderlich                 | Nur, wenn die Ausnutzung keine Nutzeraktion verlangt                       |
| Medium (4,0–6,9) | Erforderlich | Erforderlich                 | Nein                                                                       |
| Low (<4,0)       | Optional     | Erforderlich                 | Nein                                                                       |

Die Matrix ist die Bodenwahrheit — alles, was dort nicht gelistet ist, ist redaktionelles Ermessen im Advisory-Body.

## Offenlegungs-Zeitplan

Eine Sicherheits-Behebung bewegt sich durch sechs Schritte vom Bericht bis zur Veröffentlichung.

1. **Privater Entwurf** in GitHub-Security-Advisories eingereicht. Der Entwurf enthält betroffene Versionen, Beschreibung und eine Schwere-Schätzung.
2. **CVE angefordert** über die Advisory-UI von GitHub, wenn die Schwere Medium erreicht.
3. **Gepatchtes Release vorbereitet** auf einem privaten Branch. Patches pushen nicht nach `main`, bevor das Advisory zur Veröffentlichung bereit ist.
4. **Koordinierte Offenlegung** mit dem Berichtenden bei externer Meldung — typisch ein Maximum-Embargo von 90 Tagen, kürzer für aktiv ausgenutzte Probleme.
5. **Advisory veröffentlicht** gleichzeitig mit der Verfügbarkeit des gepatchten `tale upgrade`. Das veröffentlichte Advisory referenziert das CVE und den Release-Tag.
6. **Quer-Link** in den Release-Notes der gepatchten Version.

Die Reihenfolge ist bewusst: der Patch landet vor dem Advisory, damit ein Operator, der das Advisory zur Veröffentlichungszeit liest, sofort auf die behobene Version upgraden kann.

## Was ein Advisory enthält

Jedes veröffentlichte Advisory benennt sechs Dinge:

- Die betroffenen Versionen (Bereich oder Liste).
- Die gepatchte Version (genauer Tag, z. B. `v1.6.1`).
- Eine Zusammenfassung der Auswirkung — was ein Angreifer tun könnte.
- Voraussetzungen für die Ausnutzung — Netzwerk-Position, Auth-Status, Feature-Flags.
- Workarounds für Operatoren, die nicht sofort upgraden können.
- Credits an die Berichtende mit ihrer Erlaubnis.

Die Kombination aus "Auswirkung" und "Voraussetzungen" ist das, was einen Operator entscheiden lässt, ob er exponiert ist, ohne den Patch zu lesen.

## Operator-Aktion

Operatoren, die diese Seite lesen, sollten drei Dinge tun.

Beobachte `tale-project/tale`-Releases auf der **Security-Advisories**-Benachrichtigungs-Ebene — `GitHub → Watch → Custom → Security advisories` ist kostenlos, läuft über GitHubs eigenes E-Mail-System und braucht keine plattformseitige Arbeit.

Behandle jeden `## 🔒 Security`-Eintrag in Release-Notes als Upgrade-Aufforderung. Selbst wenn das verlinkte Advisory mit deinem Deployment nichts zu tun zu haben scheint, existiert der Punkt, weil etwas Tieferliegendes — Auth, Krypto, Geheimnisse, eine erreichbare Abhängigkeit — sich bewegte.

Abonniere die direkte Nur-Kritisch-Benachrichtigungs-Liste, sobald sie existiert. Bis dahin ist der GitHub-Watch-Feed der einzige Push-Kanal.

## Wo das einsetzt

Sicherheitshinweise sind, wie Ruler GmbH CVEs offenlegt und wie Operatoren lernen, was auf einer selbst gehosteten Instanz zu patchen ist. Jedes Advisory zeigt auf ein Tale-Release, das die Behebung enthält; Operatoren fahren `tale deploy`, um vorwärts zu rollen, und Cloud-Kunden bekommen dieselbe Behebung beim nächsten Platform-Deploy. Die Release-Notes-Seite desselben Ereignisses lebt unter [Release-Notes-Format](/de/self-hosted/operate/release-notes/format) im `## 🔒 Security`-Abschnitt; der `/release`-Slash-Befehl im Haupt-Repository entwirft diesen Abschnitt automatisch beim Release.
