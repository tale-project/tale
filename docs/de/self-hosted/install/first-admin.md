---
title: Den ersten Admin erstellen
description: Bootstrap des ersten Kontos auf einer brandneuen self-hosted Instanz — Admin-Key holen, anmelden, zum Owner befördern, optional Signup schliessen.
---

Eine brandneue Tale-Instanz hat noch keine User. Die erste Anmeldung braucht einen Bootstrap-Key, um die Rolle **Owner** zu beanspruchen; danach verhält sich die Instanz wie jede andere Org. Dieser Spaziergang führt das Bootstrap durch und verweist auf die Einstellungen, die offenes Signup ausschalten, sobald das Team drin ist.

Der Bootstrap-Key wird von einem Skript generiert, das ihn aus dem laufenden Platform-Container liest; er rotiert jedes Mal, wenn die Plattform neu startet. Brauchst du zwischen Generieren und Nutzen des Keys zu lange, generier einen frischen — alte Keys stapeln sich nicht.

## Bevor du beginnst

Hab die Instanz laufen und unter `SITE_URL` erreichbar. Verifizier mit:

```bash
docker compose ps
```

Jeder Service sollte `running` oder `healthy` zeigen. Ist einer ungesund, benennt die [Fehlersuche](/de/self-hosted/operate/observability/troubleshooting) die vier häufigen Ursachen.

## Schritt 1 — get-admin-key.sh ausführen

Aus dem Repo-Root:

```bash
./scripts/get-admin-key.sh
```

Das Skript gibt einen Einmal-Key auf stdout aus. Kopier ihn — das Skript speichert ihn nirgendwo. Hast du mit der `tale`-CLI statt mit einem Klon installiert, liegt das Skript nicht in deinem Baum, aber es umwickelt nur einen Generator, der im Platform-Container lebt — lauf ihn direkt mit `docker exec -it $(docker ps --format '{{.Names}}' | grep platform | head -1) ./generate-admin-key.sh`.

## Schritt 2 — Anmelden über SITE_URL

Öffne `SITE_URL` und klick **Sign up**. Füll deinen Namen, deine E-Mail und ein Passwort aus. Der nächste Bildschirm fragt nach dem Admin-Key — füg ihn ein und sende ab. Erstell einen **Organisation**snamen auf dem Bildschirm danach. Du landest im Dashboard.

## Schritt 3 — Sich zum Owner befördern

Auf einer frischen Instanz ist das erste Konto automatisch **Owner**; keine manuelle Beförderung nötig. Bestätig unter **Einstellungen > Personen**, dass deine Zeile das Owner-Badge trägt.

Bist du einer bestehenden Instanz mit dem Admin-Key beigetreten (was ungewöhnlich, aber unterstützt ist), liest deine Rolle stattdessen **Admin**, und der bestehende Owner kann dich auf demselben Bildschirm befördern.

## Schritt 4 — Offenes Signup deaktivieren

Standardmässig ist die Sign-up-Seite unter `SITE_URL/signup` ohne Bootstrap-Key erreichbar, sobald ein Owner existiert. Um sie zu schliessen:

- Öffne **Einstellungen > Organisation** und schalt **Open signup** aus.
- Oder setze `ALLOW_OPEN_SIGNUP=false` in `.env` und starte den Platform-Container neu.

Mit ausgeschaltetem offenem Signup treten neue Konten nur per Mitgliedereinladung unter **Einstellungen > Personen** bei — siehe [Mitglieder und Rollen](/de/platform/admin/members-and-roles).

## Fehlersuche

- **`get-admin-key.sh` bricht mit „container not running" ab.** Der Platform-Container ist noch nicht oben. `docker compose ps` sagt, welcher Service scheitert; Logs über `docker compose logs platform` zeigen warum.
- **Der eingefügte Key wird abgelehnt.** Keys rotieren pro Platform-Container-Boot. Lauf das Skript erneut, um einen frischen zu bekommen.
- **Du hast dich angemeldet, aber das Dashboard liest „no organization".** Der Org-Erstellungs-Bildschirm wurde übersprungen — melde dich ab und wieder an, um auf dem Org-Erstellungs-Flow zu landen.

## Wo das eingesetzt wird

Du hast jetzt einen Owner und eine Org. Die nächsten Schritte für den Kalender sind, den Rest der Admins einzuladen (unter **Einstellungen > Personen**), einen Modell-Provider hinzuzufügen und den ersten Agent zu veröffentlichen — der [Cloud-Onboarding](/de/cloud/onboarding)-Spaziergang ist von hier an identisch, ausser der URL.
