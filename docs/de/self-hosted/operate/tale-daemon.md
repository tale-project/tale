---
title: tale-daemon
description: Aufgaben-Arbeit auf eigenen Maschinen mit lokalen Coding-Agent-CLIs (Claude Code, Codex, OpenCode) — Setup, Taktung, Isolation, Berechtigungen und Fehlerbehandlung.
---

`tale-daemon` führt Tale-Board-Aufgaben auf einer Maschine aus, die du kontrollierst — mit den Coding-Agent-CLIs, die du bereits hast: **Claude Code** (`claude`), **Codex** (`codex`) und **OpenCode** (`opencode`). Binde einen Agenten in seiner Konfiguration an eine Runtime, und seine zugewiesenen Aufgaben werden an den Daemon geschickt statt an Tales interne Modell-Schleife; das Ergebnis landet als Kommentar (mit Diff-Statistik) auf der Aufgabe, die wie jede andere Agenten-Arbeit bei _In Review_ parkt.

## Setup

```sh
bunx tale-daemon setup    # Basis-URL, API-Schlüssel, Workspace, Berechtigungs-Obergrenze
bunx tale-daemon start    # Registrierung + Claim-Schleife (Strg-C lässt den Lauf ausklingen)
bunx tale-daemon status   # Konfiguration, erkannte CLIs, Server-Erreichbarkeit
```

`setup` erzeugt eine stabile Daemon-Identität und speichert die Konfiguration unter `~/.tale-daemon/config.json` (Modus 600). Nutze einen normalen Tale-API-Schlüssel (**Einstellungen → API → REST**); setze `TALE_DAEMON_API_KEY`, um den Schlüssel aus der Datei herauszuhalten. Verbundene Daemons erscheinen unter **Einstellungen → API → Runtimes** mit Live-Status.

## Datenschutz & Berechtigungen

- Lokale Workspace-**Pfade verlassen die Maschine nie** — nur die von dir gewählten Workspace-Schlüssel werden dem Server gemeldet.
- Die effektive Berechtigung eines Laufs ist **min(Server-Konfiguration, Daemon-Obergrenze)**. `full_auto` (Berechtigungen überspringen / voller Sandbox-Zugriff) erfordert daher Opt-in auf _beiden_ Seiten. Standard ist `safe`.

## Wie Läufe ausgeführt werden

- **Taktung**: der Daemon fragt Arbeit mit server-gesteuertem Backoff ab (3 s nach Arbeit, 15 s im Leerlauf, gedeckelt bei 60 s nach zehn Leerlauf-Minuten — ein untätiger Daemon kostet etwa eine Anfrage pro Minute). Ein 15-s-Heartbeat während eines Laufs erneuert die Server-Lease und nimmt Abbrüche entgegen (SIGTERM).
- **Isolation**: jeder Lauf läuft in einem eigenen Git-Worktree auf einem `tale/run-…`-Branch. Es wird nichts gepusht; die Diff-Statistik reist mit dem Bericht.
- **Sessions**: Revisions-Läufe (Review-Feedback) setzen die vorherige CLI-Session fort, wo der Adapter es unterstützt.

## Fehlerbehandlung

| Situation                                       | Verhalten                                                                                     |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Kein Daemon übernimmt den Lauf binnen 2 Minuten | Lauf schlägt fehl (`runtime_offline`), Aufgabe rollt mit Kommentar nach _Zu erledigen_ zurück |
| Daemon stirbt mitten im Lauf (Lease verloren)   | Ein Retry aus sauberem Worktree, dann Fehlschlag                                              |
| Lauf überschreitet 30 Minuten                   | Harter Timeout, Behandlung wie oben                                                           |
| CLI endet mit Fehlercode                        | Ein Retry, dann Fehlschlag mit Fehler-Auszug                                                  |

Alle externen Läufe teilen den internen Laufdatensatz — Budgets, Parallelitäts-Limits und Metriken gelten identisch.
