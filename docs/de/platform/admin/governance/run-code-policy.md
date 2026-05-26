---
title: Run-code-Richtlinie
description: Die Paket-Zulassungsliste und Egress-Kontrollen, die regeln, was sandgeboxtes Run code installieren und welche URLs es erreichen darf. Admins und Inhaber lesen das, wenn ein Agent eine neue Bibliothek braucht oder wenn ein Regulierer die Netzwerkziele benennt, die eine Sandbox berühren darf.
---

Run-code-Richtlinie ist die Oberfläche, auf der du entscheidest, welche Python- und Node-Pakete die Sandbox zur Laufzeit installieren kann und damit, welche Netzwerkziele die Sandbox über diese Pakete erreichen darf. Skills mit Skripten und das Run-code-Tool laufen beide in derselben Sandbox; diese Richtlinie ist die einzige Naht, an der du anziehst oder lockerst, was sie tun dürfen. Admins und Inhaber lesen diese Seite, wenn ein Agent eine neue Bibliothek braucht, wenn ein Regulierer die Ziele benennt, die eine Sandbox berühren darf, oder wenn ein Audit fragt, warum ein Paket zu einem bestimmten Zeitpunkt blockiert war.

## Ein durchgespielter Wechsel

Der Standardmodus ist **Sperrliste** mit leerer Liste, was bedeutet, dass jedes Paket installierbar ist. Um auf eine kuratierte Menge zu wechseln, öffne **Einstellungen > Governance > Run-code-Pakete**, ändere den Modus auf **Zulassungsliste** und liste die Pakete unter **Python-Zulassungsliste** und **Node-Zulassungsliste** auf, denen du vertraust. Speichern, und der nächste Sandbox-Lauf, der ein Paket außerhalb der Liste anfordert, scheitert mit dem Grund **nicht auf der Zulassungsliste** im Audit-Ereignis.

## Die zwei Modi

| Name            | Default | Beschreibung                                                                                                                                  |
| --------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Zulassungsliste | aus     | Nur die aufgelisteten Pakete installieren; alles andere wird abgelehnt. Nutz das, wenn ein Regulierer die freigegebenen Bibliotheken benennt. |
| Sperrliste      | an      | Jedes Paket installiert außer den aufgelisteten. Nutz das, wenn eine kleine Menge als schlecht bekannt ist und der Rest vertraut wird.        |

## Die vier Listen

Jeder Modus liest aus zwei Listen — Python und Node. Ein Paket pro Zeile oder kommagetrennt. Versionsangaben werden automatisch entfernt (`pandas==2.1` entspricht `pandas`), sodass die Richtlinie namensbasiert ist und Bibliotheks-Upgrades übersteht. Scoped Node-Pakete (`@scope/pkg`) werden unterstützt.

Die Listen sind pro Sprache unabhängig: eine Python-Zulassungsliste plus eine Node-Sperrliste ist eine gültige Kombination und bedeutet, dass Python streng ist und Node permissiv auf derselben Sandbox.

## Der Tester

Das Test-Panel auf derselben Seite erlaubt dir, pip- oder npm-Spezifikationen einzufügen und zu sehen, ob jede unter dem aktuellen Entwurf durchgehen würde. Es verwendet deine ungespeicherten Änderungen, sodass du vor dem Speichern iterieren kannst. Jede Spezifikation wird geparst, von ihrer Versionsangabe befreit und gegen die Listen abgeglichen; das Panel meldet **Erlaubt** oder **Abgelehnt** mit der Begründung — passt-zur-Zulassungsliste, nicht-auf-der-Zulassungsliste, passt-zur-Sperrliste, nicht-auf-der-Sperrliste.

## Netzwerk-Egress und Skills

Die Paket-Richtlinie regelt, _was_ in der Sandbox läuft. Dieselbe Sandbox läuft Skill-Skripte — siehe die [Skills-Konzeptseite](/de/platform/agents/skills) — und die Egress-Zulassungsliste, die ausgehendes HTTP aus Sandbox-Code regelt, wird im selben Governance-Bereich für selbst gehostete Deployments konfiguriert. Behandle das Veröffentlichen eines Skills mit Skript als Erweiterung der Vertrauensfläche für jeden Agent, der es aufnimmt; die Paket-Richtlinie und die Egress-Zulassungsliste entscheiden zusammen, was das Skript tun darf.

## Wo das hingehört

Run-code-Richtlinie ist die Schleuse auf der Sandbox, die sowohl das Run-code-Tool als auch Skill-Skripte trägt. Das begleitende Konzept ist [Agent-Skills](/de/platform/agents/skills) — es deckt ab, wann ein Skript als Skill veröffentlicht wird und warum die Paket-Richtlinie die tragende Schleuse ist. Die begleitende Governance-Seite ist [Audit-Logs](/de/platform/admin/governance/audit-logs) — jede abgelehnte Paket-Installation landet dort mit der Spezifikation und der Begründung.
