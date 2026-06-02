---
title: Security-Advisories
description: Der Tale-Security-Advisory-Feed — CVE-Format, die vierstufige Severity-Skala, die Disclosure-Timeline, der die Maintainer sich verpflichten, und wie du dich anmeldest.
---

Tale veröffentlicht ein Security-Advisory für jede Schwachstelle, die durch ein gepatchtes Release geschlossen wird. Der Feed lebt unter GitHub Security Advisories im Repository `tale-project/tale` und spiegelt auf einen RSS-Endpunkt, den Operator in ihr Alerting hängen können. Diese Seite deckt das Format ab, dem jedes Advisory folgt, die Severity-Skala, die Tale verwendet, die Disclosure-Timeline, der die Maintainer sich verpflichten, und die drei Subscription-Pfade.

Die Advisories sind die Langform-Aufzeichnung. Die Ein-Zeilen-Zusammenfassung plus Link erscheint im **Security**-Abschnitt jeder [Release-Note](/de/self-hosted/operate/release-notes/format).

## Das Advisory-Format

Jedes Advisory ist ein GitHub Security Advisory mit einem stabilen Identifier der Form `TAL-YYYY-NNN` (Tales interne ID) plus dem Upstream-`CVE-YYYY-NNNNN`, wenn eine zugewiesen wurde. Der Body ist dieselbe geordnete Abschnittsmenge, damit ein Operator die tragenden Fakten scannen kann, ohne die Prosa zu lesen.

- **Summary** — ein Satz dazu, was ein Angreifer tun könnte und was der Fix ändert.
- **Affected versions** — die Versions-Range, die die Schwachstelle enthält, in semver-Form (`>=0.8.0, <0.12.3`).
- **Patched versions** — das erste Release, das den Fix enthält. Das Upgraden auf oder über diese Version schließt die Schwachstelle.
- **Severity** — eine der vier Stufen unten, plus der CVSS-3.1-Vektor für Operator, die gegen ihr eigenes Threat-Model scoren.
- **Workarounds** — was zu setzen, zu deaktivieren oder zu blockieren ist, um die Schwachstelle zu mitigieren, wenn ein sofortiges Upgrade nicht möglich ist. Leer, wenn kein Workaround existiert.
- **Credits** — der Melder, wenn er namentlich genannt werden möchte.

Die Patched-Versions-Zeile ist die, auf der die meisten Operator zuerst landen; das Upgrade selbst ist die Zwei-Kommando-Sequenz aus [Upgrades](/de/self-hosted/operate/upgrades).

## Die Severity-Skala

Tale nutzt vier Stufen. Die Stufe wird aus dem CVSS-Score und der Erreichbarkeit der verwundbaren Oberfläche auf einem Standard-Install gesetzt.

| Stufe    | CVSS    | Was es bedeutet                                                                                                                      |
| -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Critical | 9.0+    | Pre-authentifizierte Remote-Code-Execution oder unauthentifizierte Daten-Exfiltration. Patche innerhalb 24 Stunden.                  |
| High     | 7.0–8.9 | Authentifizierte Eskalation, Sandbox-Ausbruch oder Cross-Tenant-Daten-Leak. Patche innerhalb einer Woche.                            |
| Moderate | 4.0–6.9 | Informations-Disclosure, Denial of Service oder Eskalation, die seltene Vorbedingungen verlangt. Patche im nächsten Wartungsfenster. |
| Low      | 0.1–3.9 | Defense-in-Depth-Fixes und Härtung ohne bekannten Exploit-Pfad. Patche, wenn es passt.                                               |

Der CVSS-Vektor lässt dich gegen dein eigenes Deployment neu scoren — ein Advisory, das gegen ein öffentliches Install High ist, kann gegen ein air-gapped Install Low sein.

## Die Disclosure-Timeline

Die Maintainer verpflichten sich auf die folgende Timeline ab dem Moment, in dem ein Report bei `security@tale.dev` landet:

- **Innerhalb 72 Stunden** — Bestätigung, ein Triage-Call und ein zugewiesener TAL-Identifier.
- **Innerhalb 14 Tagen** — ein Fix oder ein Workaround, privat an den Melder veröffentlicht, und die gepatchte Version geplant.
- **Bei Fix-Release** — das Advisory wird auf GitHub veröffentlicht, die CVE-Zuweisung wird angefordert, und der Security-Abschnitt der Release-Notes trägt die Zusammenfassung.
- **30 Tage nach Release** — das technische Detail im Advisory erweitert sich um den Reproducer (wenn das Reproduzieren in der Öffentlichkeit ungepatchte Installs nicht mehr gefährdet).

Melder können eine Verzögerung anfordern, wenn sie für die Offenlegung mehr Zeit brauchen; die Maintainer akzeptieren bis zu 90 Tage, bevor sie die Zusammenfassung trotzdem veröffentlichen.

Auf der Engineering-Seite laufen Dependency-Fixes auf einem Fast Track, damit das gepatchte Release schnell erscheint: Renovate öffnet innerhalb von 24 Stunden nach einem Upstream-Advisory einen Security-Update-PR — am sonst üblichen Release-Age-Delay für Routine-Updates vorbei — und CI blockt jeden Merge, der ein bekanntes kritisches Advisory einführt. Ein offengelegter Dependency-CVE wird damit in Tagen zu einem gepatchten Tale-Release, nicht erst beim nächsten Routine-Zyklus.

## Anmelden

Drei Pfade zum selben Feed:

```text
GitHub-Watch     — github.com/tale-project/tale → Watch → Custom → Security alerts
RSS              — https://github.com/tale-project/tale/security/advisories.atom
E-Mail-Digest    — security-announce@tale.dev (eine Mail pro Advisory, kein Verkehr dazwischen)
```

Der RSS-Feed ist das, was die meisten Operator in Slack oder PagerDuty einhängen; der E-Mail-Digest ist für Ein-Personen-Teams, die keine Alerting-Pipeline betreiben.

## Wo das hingehört

Der Advisory-Feed ist einer der zwei Verträge, die Tale sicher selbst hostbar machen — Release-Notes nennen, was sich ändert, Advisories nennen, was falsch war. Die natürlichen nächsten Lesungen sind [Wie du Release-Notes liest](/de/self-hosted/operate/release-notes/format) für das passende Change-Log-Format und [Hardening](/de/self-hosted/operate/security/hardening) für die Checkliste, die Exposition begrenzt, bevor ein Advisory überhaupt feuert.
