---
title: Security-Advisory-Prozess
description: Wie Tale sicherheitsrelevante Fixes koordiniert, einreicht und veröffentlicht.
---

Wie Tale sicherheitsrelevante Fixes koordiniert, einreicht und veröffentlicht.

## Kanäle

- **Primär**: [GitHub Security Advisories](https://github.com/tale-project/tale/security/advisories) auf `tale-project/tale`. Advisories werden privat vorbereitet, bei Relevanz mit einer CVE verknüpft und erst veröffentlicht, sobald ein Patched Release verfügbar ist.
- **Sekundär**: jedes Advisory wird in den zugehörigen GitHub-Release-Notes unter dem Abschnitt `## 🔒 Security` referenziert (siehe [release-notes-format.md](/de/operate/release-notes/format)).
- **Direkte Benachrichtigung** (zurzeit manuell): kritische Advisories werden per E-Mail an bekannte Deployment-Operatoren geschickt. Eine automatisierte Operator-E-Mail-Liste gibt es noch nicht — das ist geplant.

## Wann ein Advisory eingereicht wird

Ein GitHub Security Advisory wird eingereicht, wenn eines der folgenden Kriterien zutrifft:

- CVSS-v3.1-Score ≥ 4.0 (Medium oder höher).
- Jeder Bug, der Secrets über Mandantengrenzen lecken, Session-Tokens lecken oder Rechte eskalieren könnte.
- Jeder Fix in Authentifizierung, Session, Organisations-Scoping, Crypto oder Secret-Speicherung — auch ohne externen Melder.
- Jede erreichbare Abhängigkeits-CVE (der verwundbare Code-Pfad wird von Tale ausgeführt).

**Kein** Advisory für Abhängigkeits-CVEs, deren Code-Pfade von Tale nachweislich nicht erreicht werden — stattdessen im normalen Abschnitt `## 🔒 Security` der Release-Notes mit Hinweis dokumentieren, warum sie hier nicht ausnutzbar sind.

## Schwere → Eskalations-Matrix

| CVSS             | Advisory   | Release-Notes                       | Direkte E-Mail an Operatoren                                                   |
| ---------------- | ---------- | ----------------------------------- | ------------------------------------------------------------------------------ |
| Critical (9.0+)  | Pflicht    | Pflicht, prominente Zusammenfassung | Ja — vor öffentlicher Offenlegung bei Koordination, sonst bei Veröffentlichung |
| High (7.0–8.9)   | Pflicht    | Pflicht                             | Nur wenn Ausnutzung keine Nutzer-Aktion braucht                                |
| Medium (4.0–6.9) | Pflicht    | Pflicht                             | Nein                                                                           |
| Low (&lt;4.0)    | Optional   | Pflicht                             | Nein                                                                           |

## Zeitablauf

1. **Privater Entwurf** im GitHub Security Advisory. Enthalte betroffene Versionen, Beschreibung und Schwere-Einschätzung.
2. **CVE anfragen** über die Advisory-UI von GitHub, wenn die Schwere mindestens Medium ist.
3. **Patched Release vorbereiten** auf einem privaten Fork/Branch. Patches nicht nach `main` pushen, bevor das Advisory zur Veröffentlichung bereit ist.
4. **Koordinierte Offenlegung** mit dem Melder bei externen Meldungen — typischerweise bis zu 90 Tage Embargo, kürzer bei aktiv ausgenutzten Problemen.
5. **Advisory veröffentlichen** gleichzeitig mit der Verfügbarkeit des patched `tale upgrade`. CVE und Release-Tag referenzieren.
6. **Querverweis** in den Release-Notes der gepatchten Version.

## Was in ein Advisory gehört

- Betroffene Versionen (Bereich oder Liste).
- Gepatchte Version (exakter Tag, z. B. `v1.6.1`).
- Zusammenfassung der Auswirkung — was ein Angreifer tun könnte.
- Voraussetzungen — Netzwerkposition, Auth-Status, benötigte Feature-Flags zur Ausnutzung.
- Workarounds für Operatoren, die nicht sofort upgraden können.
- Credits an die melder (mit Zustimmung).

## Operator-Aktion

Operatoren sollten:

- Releases von `tale-project/tale` beobachten (`GitHub → Watch → Custom → Security advisories` ist kostenlos, ohne Plattform-Arbeit).
- Einträge unter `## 🔒 Security` in Release-Notes als Upgrade-Hinweis behandeln.
- Sich (sobald verfügbar) in die Liste für direkte Benachrichtigungen für ausschließlich kritische Meldungen eintragen.

## Verwandt

- [Release-Notes-Format](/de/operate/release-notes/format) — wo Security-Einträge in den Notes stehen.
- Der `/release`-Slash-Command im Hauptrepository entwirft den Security-Abschnitt.
