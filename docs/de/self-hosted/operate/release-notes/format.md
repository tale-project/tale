---
title: Wie du Release-Notes liest
description: Die Form, der Tales Release-Notes folgen — das semver-Versprechen, wo breaking Changes und Deprecations sitzen, wie Security-Einträge markiert sind und wo die Migrations-Notes pro Release leben.
---

Tale liefert ein Release pro Minor-Version und Patches als Bugfix-Tags dazwischen aus. Die Release-Notes für jeden Tag folgen derselben Form, damit du eine in einer Minute scannen kannst und weißt, ob das Upgrade ein Fünf-Minuten-Bump oder ein Wartungsfenster ist. Diese Seite deckt das Format ab: das semver-Versprechen, was jeder Abschnitt garantiert, und wo du tiefer liest, wenn eine Zeile auf eine Migration zeigt.

Die Notes selbst leben auf der GitHub-Release-Seite zu jedem Tag. Das CLI bringt sie ebenfalls hoch — `tale update --notes` druckt die Notes für die Version, die es gerade installieren will.

## Das semver-Versprechen

Tale-Versionen sind semver, und die Versionsnummer ist die wichtigste Tatsache über ein Upgrade.

- **Patch (`0.9.0 → 0.9.1`)** — nur Bugfixes. Keine Schema-Migrationen, keine Config-Änderungen, keine Verhaltens-Änderungen außer dem Fix selbst. Sicher zu upgraden, ohne weiter als bis zum Security-Abschnitt zu lesen.
- **Minor (`0.9.x → 0.10.x`)** — neue Features, möglicherweise forward-only Migrationen. Rückwärtskompatibel standardmäßig; Deprecations werden ein Minor im Voraus angekündigt. Die eine stehende Ausnahme ist 0.4.0: ein Breaking Minor, der ein frisches Deployment verlangt (siehe [Upgrades → 0.3 → 0.4](/de/self-hosted/operate/upgrades)).
- **Major (`0.x → 1.x`)** — breaking Changes sind erlaubt. Trägt immer einen Link auf die Migrations-Notes oben am Release; lies sie End-to-End, bevor du anfängst.

Die Versionszeile oben auf jeder Release-Seite nennt die Art des Bumps in Klartext, damit du die Rechnerei nicht selbst machen musst.

## Die Abschnitte, die jedes Release hat

Jede Release-Seite ist dieselbe geordnete Abschnitts-Liste. Leere Abschnitte werden weggelassen, nicht leer gelassen — siehst du einen Abschnitt nicht, gibt es dort nichts zu melden.

- **Highlights** — ein oder zwei Absätze dazu, wofür das Release da ist. Lies das zuerst.
- **Breaking Changes** — jede Änderung, die verlangt, dass der Operator vor oder nach dem Upgrade etwas tut. Jede Zeile nennt das Symptom, das du treffen würdest, wenn du sie überspringst, und die Aktion, die das vermeidet.
- **Deprecations** — Features, die in diesem Release noch laufen, aber zur Entfernung markiert sind. Jede Zeile nennt die Removal-Version, damit du den Cutover planen kannst.
- **Security** — Einträge im CVE-Format für Fixes, die eine Schwachstelle schließen. Der vollständige Feed lebt unter [Security-Advisories](/de/self-hosted/operate/security/advisories); die Release-Notes tragen die Ein-Zeilen-Zusammenfassung plus den Link auf das Advisory.
- **Features und Fixes** — die lange Liste. Gruppiert nach Bereich (Platform, CLI, Docs); jede Zeile liest sich als ein Satz.
- **Migrations-Notes** _(Major-Versionen und manche Minors)_ — der verlinkte Walk durch Schema-Migrationen, Config-Datei-Änderungen oder operatorseitige Umbenennungen. Bei Majors immer lesen.

## Wie du ein Release scannst

Lies die Versionszeile, die Highlights und den Breaking-Changes-Abschnitt. Ist Breaking Changes leer und nennt der Security-Abschnitt keinen Fix, der dein Install berührt, ist das Upgrade die `tale update` + `tale deploy`-Sequenz aus [Upgrades](/de/self-hosted/operate/upgrades). Hat einer der beiden Abschnitte Zeilen, gehst du sie durch, bevor du `tale deploy` läufst.

```text
0.12.0 (minor) — 14.05.2026

Highlights
  Streaming-Tool-Calls streamen jetzt in den Chat, sobald sie emittieren.

Breaking Changes
  (keine)

Deprecations
  AGENTS_LEGACY_PROMPT env var — entfernt in 0.14.

Security
  CVE-2026-XXXX — gepatchter Bypass in der Run-Code-Sandbox.
  Siehe: Advisory TAL-2026-007.
```

Die Form oben ist das, was `tale update --notes` druckt. Die Web-Version desselben Releases fügt auf jeder Advisory- und Migrations-Zeile Links hinzu.

## Wo das hingehört

Das Release-Notes-Format ist der Vertrag zwischen Projekt und Operator — dieselbe Form bei jedem Release, damit die Upgrade-Entscheidung ein Scan ist, kein tiefes Lesen. Die natürlichen nächsten Schritte sind [Upgrades](/de/self-hosted/operate/upgrades) für die Deploy-Mechanik und [Security-Advisories](/de/self-hosted/operate/security/advisories) für den langen Schwachstellen-Feed, in den der Security-Abschnitt verlinkt.
