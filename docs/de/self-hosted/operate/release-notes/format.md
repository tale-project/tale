---
title: Release-Notes-Format
description: Maßgebliches Format für GitHub-Release-Notes auf tale-project/tale.
---

Maßgebliches Format für GitHub-Release-Notes auf `tale-project/tale`. Der `/release`-Slash-Command entwirft Notes gegen diese Spezifikation, und der Link "What's new" im Produkt führt direkt zu diesen Releases.

## Warum diese Spec existiert

Operatoren und Endnutzer verlassen sich auf Release-Notes, um zu wissen:

- ob eine Sicherheitsbehebung sie betrifft;
- ob eine Modell- oder Anbieter-Änderung ihre Workflow-Ausgaben verschiebt;
- ob ein Upgrade manuelle Schritte erfordert.

Konsistente Abschnitte — in konsistenter Reihenfolge — machen es leicht, ein Release nach diesen drei Dingen zu scannen, ohne jeden Bullet lesen zu müssen.

## Pflicht-Abschnitte

Nur Abschnitte einfügen, zu denen Inhalt existiert. Immer in dieser Reihenfolge verwenden:

| Nr.     | Abschnitts-Header       | Umfang                                                                                               |
| ------- | ----------------------- | ---------------------------------------------------------------------------------------------------- |
| 1       | `## 🔒 Security`         | CVE-Fixes, Abhängigkeits-Patches, Auth-/Session-/Crypto-Härtung, Secret-Handling                     |
| 2       | `## 🤖 Model & Provider` | LLM-Modell-Wechsel/-Upgrade/-Deprecation, Anbieter-Config-Änderungen, die Output verändern           |
| 3       | `## 💥 Breaking Changes` | API-Entfernung/-Umbenennung, Schema-Änderungen, die manuelle Migration erfordern, entfernte Features |
| 4       | `## 🚀 Features`         | Neue für Nutzer sichtbare Funktionalität                                                             |
| 5       | `## ⚡ Performance`      | Messbare Performance-Gewinne, die erwähnt werden sollten                                             |
| 6       | `## 🛠 Improvements`     | Nicht-brechende Verbesserungen, UX-Polish                                                            |
| 7       | `## 🐛 Fixes`            | Bug-Fixes (nicht sicherheitsrelevant)                                                                |
| 8       | `## 📝 Other`            | Docs, Refactors, Chores — sparsam einsetzen                                                          |

## Pflicht-Rahmen

Jedes Release muss mindestens enthalten:

1. **Titel**: `v{version} — {kurzer Tagline}`, z. B. `v1.6.0 — Usage analytics & multi-tenancy`.
2. **Zusammenfassung**: 2–3 Sätze oben, die beschreiben, was sich geändert hat und warum. Keine Emojis.
3. **Upgrade-Anleitung**:
   ```markdown
   ## Upgrade

   Run `tale upgrade` to update the CLI, then `tale deploy` to apply the new version.
   ```
   Beide Schritte sind Pflicht — `tale upgrade` lädt die neue CLI, `tale deploy` wendet sie an. Ein fehlender Schritt lässt das Deployment auf der alten Version.
4. **Manuelle Migrations-Hinweise** (nur bei Bedarf): Erfordert eine Breaking Change Operator-Aktion über `tale deploy` hinaus, füge einen Abschnitt `## Migration Guide` mit nummerierten Schritten ein.
5. **Full-Changelog-Link** ganz unten:
   ```markdown
   **Full Changelog**: https://github.com/tale-project/tale/compare/v{previous}...v{new}
   ```

## Klassifizierungsregeln

- **Security**: alles, was Authentifizierung, Session, Secret-Speicherung, Crypto oder erreichbare Abhängigkeits-CVEs berührt. Im Zweifel als Security klassifizieren UND ein [Security Advisory](/de/self-hosted/operate/security/advisories) anlegen.
- **Model & Anbieter**: jede Änderung, die die LLM-Ausgabe bei gleichem Nutzer-Input verschieben kann — Modell-Bumps, Anbieter-Wechsel, Prompt-/Template-Änderungen in Default-Agents.
- **Breaking Changes**: Nutzer oder Operatoren müssen nach dem Upgrade etwas tun, damit es weiter funktioniert. Wenn das Upgrade "einfach funktioniert", ist es nicht breaking.
- **Other**: nur für erwähnenswerte Änderungen, die nirgends sonst passen. Triviale Chores (Tippfehler, interne Refactors, reine Test-Änderungen) weglassen.

## Beispiel

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

## Verwandt

- [Security-Advisory-Prozess](/de/self-hosted/operate/security/advisories) — wann zusätzlich ein GitHub Security Advisory erstellt wird.
- Der `/release`-Slash-Command im Hauptrepository entwirft Notes nach dieser Spec.
