---
title: Den ersten Admin erstellen
description: Eine brandneue self-hosted Instanz durch ihren einmaligen Setup-Wizard führen — das erste Konto wird ohne Key zum Owner, neue Leute kommen per Einladung dazu, und der Admin-Key ist nur fürs Convex-Dashboard.
---

Eine brandneue Tale-Instanz hat noch keine User. Die erste Person, die sie öffnet, durchläuft einen einmaligen Setup-Wizard, der ihr Konto anlegt, sie anmeldet, sie zum **Owner** macht und die erste Organisation benennt — kein Bootstrap-Key, keine manuelle Beförderung. Dieser Spaziergang deckt diesen ersten Lauf ab, wie Teammitglieder danach dazukommen und wo du den Convex-Dashboard-Admin-Key bekommst, falls du das Backend mal direkt inspizieren musst.

Das Eine, was du aus älteren Anleitungen verlernen musst: Die erste Anmeldung fragt nicht mehr nach einem Admin-Key. Tale ist nach dem ersten Konto nur per Einladung zugänglich, also gibt es auch keine offene Sign-up-Seite, die du abriegeln müsstest.

## Bevor du beginnst

Hab die Instanz laufen und unter `SITE_URL` erreichbar. Verifizier mit:

```bash
docker compose ps
```

Jeder Service sollte `running` oder `healthy` zeigen. Ist einer ungesund, benennt die [Fehlersuche](/de/self-hosted/operate/observability/troubleshooting) die vier häufigen Ursachen.

## Den Setup-Wizard durchlaufen

Öffne `SITE_URL`. Da es noch keine User gibt, schickt Tale dich direkt in den Setup-Wizard — es gibt keine separate Sign-up-Seite zu suchen, denn der Login-Bildschirm leitet eine leere Instanz automatisch ins Setup um. Der Wizard legt dein Konto an und meldet dich mitten im Flow an, dann benennt er deine erste Organisation.

Der Provider-Schritt ist optional: Überspring ihn und füg einen Key später unter **Einstellungen > KI-Anbieter** hinzu, oder verbinde OpenRouter jetzt, um sofort zu chatten. Hol dir einen Key auf [openrouter.ai/keys](https://openrouter.ai/keys). Der Abschluss-Schritt setzt dich ins Dashboard.

## Bestätigen, dass du der Owner bist

Das erste Konto auf einer frischen Instanz ist automatisch der **Owner** — kein Key zum Einfügen, kein Beförderungsschritt. Bestätig unter **Einstellungen > Personen**, dass deine Zeile das Owner-Badge trägt.

## Wie neue Leute dazukommen

Es gibt kein Self-Service-Signup. Sobald ein Owner existiert, leitet `SITE_URL/sign-up` Besucher auf den Login-Bildschirm um, sodass niemand sich selbst ein Konto anlegen kann. Füg Teammitglieder per Einladung unter **Einstellungen > Personen** hinzu; jede Einladung trägt die Rolle, mit der das neue Mitglied startet. Das vollständige Rollenmodell steht in [Mitglieder und Rollen](/de/platform/admin/members-and-roles).

## Den Convex-Dashboard-Admin-Key holen

Der Admin-Key spielt in den obigen Schritten keine Rolle — er schaltet nur das **Convex-Dashboard** frei, die Low-Level-Ansicht der Backend-Datenbank. Der Key ist deterministisch: Er wird aus `INSTANCE_SECRET` abgeleitet, bleibt also über Neustarts hinweg gleich und rotiert nicht.

Hol ihn so, wie es zu deiner Installation passt:

- Mit der CLI: `tale convex admin` findet den Platform-Container und gibt den Key aus. `tale dev` gibt ihn ebenfalls aus, sobald die Services gesund sind.
- Aus einem Git-Klon: `./scripts/get-admin-key.sh` aus dem Repo-Root.

Öffne `SITE_URL/convex-dashboard`, gib `SITE_URL` als Deployment-URL ein und füg den Key ein, wenn du danach gefragt wirst.

## Fehlersuche

- **Der Wizard erschien nicht — du landest auf dem Login-Bildschirm.** Es gibt bereits User auf dieser Instanz; der Wizard läuft nur auf einer wirklich leeren. Melde dich stattdessen an, oder lass dich von einem bestehenden Owner unter **Einstellungen > Personen** einladen.
- **Ein Service ist ungesund.** Der Platform-Container ist nicht vollständig oben. `docker compose ps` sagt, welcher Service scheitert; `docker compose logs platform` zeigt warum.
- **Das Dashboard lehnt den Admin-Key ab.** Der Key ist deterministisch aus `INSTANCE_SECRET`, eine Ablehnung heisst also meist, dass sich `INSTANCE_NAME` und `INSTANCE_SECRET` zwischen Platform- und Convex-Service unterscheiden, oder die Deployment-URL falsch ist — nimm `SITE_URL`. Generier mit `tale convex admin` neu, um sicherzugehen, dass du den aktuellen Wert kopiert hast.

## Wo das eingesetzt wird

Du hast jetzt einen Owner und eine Org und weisst, dass der Admin-Key ein Backend-Inspektionswerkzeug ist, kein Teil der Anmeldung. Der erste Lauf ist absichtlich keylos: Öffne die URL, der Wizard macht dich zum Owner, und alle anderen kommen per Einladung dazu.

Die nächsten Schritte für den Kalender sind, den Rest der Admins einzuladen (unter **Einstellungen > Personen**), einen Modell-Provider hinzuzufügen und den ersten Agent zu veröffentlichen — der [Cloud-Onboarding](/de/cloud/onboarding)-Spaziergang ist von hier an identisch, ausser der URL.
