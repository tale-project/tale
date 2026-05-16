---
title: Release-Notes-Format
description: Maßgebliches Format für GitHub-Release-Notes auf tale-project/tale.
---

Tale liefert seine Release-Historie als GitHub-Release-Notes gegen das Repository `tale-project/tale` aus, in einer festen Form, damit Operatoren ein Release vor einem Upgrade auf die drei wichtigen Dinge — Sicherheitsrelevanz, Verhaltensänderung, Breaking-Change — überfliegen können, ohne jeden Punkt zu lesen. Diese Seite ist der Vertrag: sie benennt jeden Abschnitt, die Reihenfolge, in der sie erscheinen, die Rahmung, die jedes Release teilt, und die Klassifikationsregeln, die entscheiden, welcher Punkt wo landet.

Operatoren lesen diese Notes vor `tale upgrade`; dasselbe Markdown, das der `/release`-Slash-Befehl im Haupt-Repo entwirft, ist das, was die **Was ist neu**-Ansicht im Produkt rendert. Die Konsistenz der Form ist die tragende Eigenschaft — sobald ein Operator drei Releases gelesen hat, weiß er genau, wo die Security-Einträge, die Modell-Sprünge und die Migrations-Schritte zu suchen sind.

## Warum dieser Vertrag existiert

Operatoren und Endnutzer verlassen sich auf Release-Notes, um drei Fragen vor dem Upgrade zu beantworten:

- Behebt dieses Release ein Sicherheitsproblem, das mich betrifft?
- Hat eine Modell- oder Anbieter-Änderung die Ausgabe eines Workflows verschoben, den ich fahre?
- Verlangt dieses Upgrade manuelle Schritte?

Konsistente Sektionierung in einer konsistenten Reihenfolge macht diese drei Antworten in Sekunden auffindbar, ohne jeden Punkt zu lesen. Der Vertrag existiert, um diesen Vertrag über jedes Release laut zu halten.

## Erforderliche Abschnitte

Nimm nur Abschnitte auf, die Inhalt haben; nimm nie einen leeren Abschnitt auf. Die Reihenfolge ist fest:

| Reihenfolge | Abschnitts-Überschrift   | Bereich                                                                                                 |
| ----------- | ------------------------ | ------------------------------------------------------------------------------------------------------- |
| 1           | `## 🔒 Security`         | CVE-Behebungen, Abhängigkeits-Patches, Auth/Session/Krypto-Härtung, Geheimnis-Handling.                 |
| 2           | `## 🤖 Model & Provider` | LLM-Modell-Tausch/-Upgrade/-Deprecation, Anbieter-Konfigurations-Änderungen, die die Ausgabe verändern. |
| 3           | `## 💥 Breaking Changes` | API-Entfernung/-Umbenennung, Schema-Änderungen, die manuelle Migration verlangen, entfernte Funktionen. |
| 4           | `## 🚀 Features`         | Neue nutzersichtbare Funktionalität.                                                                    |
| 5           | `## ⚡ Performance`      | Messbare Performance-Gewinne, die erwähnenswert sind.                                                   |
| 6           | `## 🛠 Improvements`     | Nicht-brechende Verbesserungen, UX-Politur.                                                             |
| 7           | `## 🐛 Fixes`            | Bug-Fixes (nicht-Security).                                                                             |
| 8           | `## 📝 Other`            | Docs, Refactors, Aufgaben. Sparsam einsetzen.                                                           |

## Erforderliche Rahmung

Jedes Release enthält mindestens vier Stücke Rahmung oben auf den Abschnitts-Punkten.

**Titel.** Format `v{version} — {short tagline}`, z. B. `v1.6.0 — Usage analytics & multi-tenancy`. Die Tagline ist die einzeilige Schlagzeile, die der Changelog-Viewer neben der Versionsnummer rendert.

**Zusammenfassung.** Zwei bis drei Sätze ganz oben, die beschreiben, was sich geändert hat und warum. Kein Emoji in der Zusammenfassung — Emoji sind den Abschnitts-Überschriften unten vorbehalten.

**Upgrade-Anweisungen.** Ein kurzer Block am Ende der Notes, der die zwei Befehle benennt, die jedes Upgrade beinhaltet:

```markdown
## Upgrade

Run `tale upgrade` to update the CLI, then `tale deploy` to apply the new version.
```

Beide Schritte sind erforderlich. `tale upgrade` holt die neue CLI-Binärdatei; `tale deploy` rollt die neue Version auf den laufenden Stack. Einen der beiden auszulassen, lässt das Deployment auf der alten Version, was der häufigste Upgrade-Fehler ist.

**Manuelle Migrationshinweise** (nur wenn relevant). Wenn eine Breaking-Change Operator-Aktion jenseits von `tale deploy` verlangt, nimm einen `## Migration Guide`-Abschnitt mit nummerierten Schritten auf. Das ist der Abschnitt, den Operatoren suchen, wenn der Titel oder die Zusammenfassung eine Breaking-Change erwähnt.

**Full-Changelog-Link** am Ende:

```markdown
**Full Changelog**: https://github.com/tale-project/tale/compare/v{previous}...v{new}
```

## Klassifikationsregeln

Ein Punkt landet in `## 🔒 Security`, wann immer er Authentifizierung, Sessions, Geheimnis-Storage, Kryptographie oder einen erreichbaren Abhängigkeits-CVE berührt. Wenn die Kategorisierung mehrdeutig ist, klassifiziere als Security und reiche zusätzlich einen [Security Advisory](/de/self-hosted/operate/security/advisories) ein — es ist billiger, eine Nicht-Problemstellung zurückzuziehen, als ein echtes Problem unter zu offenbaren.

`## 🤖 Model & Provider` fängt alles, was die LLM-Ausgabe für denselben Nutzer-Input verändern könnte — Modell-Sprünge, Anbieter-Tausche, Prompt- oder Template-Änderungen in Standard-Agents.

`## 💥 Breaking Changes` ist reserviert für Änderungen, bei denen Nutzer oder Operatoren etwas tun müssen, um nach dem Upgrade weiterzuarbeiten. Wenn `tale upgrade` gefolgt von `tale deploy` reicht, ist es nicht brechend.

`## 📝 Other` ist für erwähnenswerte Änderungen, die nirgendwo sonst passen. Triviale Aufgaben (Tippfehler-Behebungen, interne Refactors, reine Test-Änderungen) werden ganz ausgelassen — die sind git-Historie, keine Release-Notes.

## Ein durchgespieltes Release

```markdown
# v1.6.0 — Usage analytics & multi-tenancy

This release adds time-based usage analytics, hardens multi-tenant org isolation,
and bumps the default reasoning model. No breaking changes.

## 🔒 Security

- Tighten org-scoping on governance policy queries (#1573)

## 🤖 Model & Provider

- Default reasoning model bumped from Opus 4.6 → Opus 4.7 (#1590)

## 🚀 Features

- Time-based usage analytics dashboard under `/metrics/usage` (#1574)
- Multi-org support: users can belong to multiple organizations (#1573)

## 🛠 Improvements

- Tabs underline variant adopted across settings surfaces (#1571)

## 🐛 Fixes

- Fix prompt library sidebar scroll on short viewports (#1572)

## Upgrade

Run `tale upgrade` to update the CLI, then `tale deploy` to apply the new version.

**Full Changelog**: https://github.com/tale-project/tale/compare/v1.5.2...v1.6.0
```

## Wo das einsetzt

Das Release-Notes-Format ist der Vertrag zwischen Ruler GmbH und jedem Operator, der eine selbst gehostete Tale-Instanz fährt. Dasselbe Markdown, das die In-App-[Was ist neu](/de/platform/admin/changelog)-Ansicht rendert, ist das, was Operatoren vor `tale upgrade` konsultieren; konsistente Form ist, was die Notes überfliegbar macht. Der `/release`-Slash-Befehl im Haupt-Repository entwirft Notes nach diesem Vertrag. Für Security-Behebungen, die auch eine CVE-Offenlegung rechtfertigen, ist [Sicherheitshinweise](/de/self-hosted/operate/security/advisories) die parallele Oberfläche.
