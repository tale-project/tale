---
title: Hardening
description: Die Hardening-Checkliste für eine Produktions-Tale-Instanz — Non-Root-Benutzer, Firewall, TLS, Secret-Storage, Audit-Log-Retention, Backups.
---

Die Defaults, mit denen Tale ausgeliefert wird, sind sicher für Development und vernünftig für eine kleine Produktions-Installation. Von „vernünftig" zu „bereit für die Regulator" zu kommen ist eine Checkliste, kein Konfigurations-Flag — jede Zeile unten zieht eine spezifische Angriffsoberfläche an. Walk die Liste einmal, bevor du die URL für echte Benutzer öffnest, und walk sie nach jedem grösseren Upgrade erneut.

Die Referenz-Details für jede Zeile leben anderswo — TLS in [TLS und Domains](/de/self-hosted/configuration/tls-and-domains), Backups in [Backups und Restore](/de/self-hosted/operate/backups-and-restore), Retention in [Retention](/de/self-hosted/configuration/retention). Diese Seite ist der Index, der nennt, was zu härten ist und auf die Seite zeigt, die es walkt.

## Host

| Punkt                                | Warum es zählt                                                            |
| ------------------------------------ | ------------------------------------------------------------------------- |
| Non-Root-Operator-Benutzer           | Begrenzt den Blast-Radius, wenn der Plattform-Benutzer kompromittiert ist |
| Nur SSH-Schlüssel-Auth               | Passwort-Auth ist die offene Tür, nach der Bots scannen                   |
| Unbeaufsichtigte Sicherheits-Updates | Patcht das OS, ohne auf ein Wartungsfenster zu warten                     |
| Host-Firewall (ufw / nftables)       | Schliesst alles, was nicht 22, 80, 443 ist                                |
| Platten-Verschlüsselung at-rest      | Pflicht, wenn du SOPS im Klartext-Modus betreibst                         |

Der Non-Root-Benutzer ist der, den die meisten Teams überspringen. Die Container von Tale laufen ihre eigenen Non-Root-Prozesse innen, aber der Docker-Daemon selbst läuft als Root — diesen Daemon als Operator-Benutzer zu betreiben (Mitglied der `docker`-Gruppe, nicht als Root) ist das günstigste Anziehen auf dieser Seite. Der vollständige Walk lebt in [Produktions-Linux-Server-Install](/de/self-hosted/install/linux-server).

## Netzwerk

Der Proxy ist die einzige eingehende Oberfläche. Blockier alles andere.

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

Wenn du trusted-Headers-Auth betreibst, darf der Plattform-Port nicht direkt von irgendwo ausser dem vorgelagerten Proxy erreichbar sein — alles, was ihn mit den richtigen Headern treffen kann, wird zu diesem Benutzer. Ein Docker-Netzwerk oder eine Host-Firewall-Regel funktionieren beide; wähl eins und verifizier es von ausserhalb des Hosts.

## TLS

`TLS_MODE=selfsigned` ist für Development. Produktion läuft `letsencrypt` (oder `external`, wenn du Tale mit deinem eigenen TLS-terminierenden Proxy davor stellst). Der Erneuerungs-Cron ist automatisch; der Alert, der feuert, wenn die Erneuerung scheitert, ist das, was dich 90 Tage später rettet. Siehe [TLS und Domains](/de/self-hosted/configuration/tls-and-domains).

## Secrets

Jedes Secret in `.env` ist sensibel — das Auth-Signing-Secret, der Verschlüsselungs-Schlüssel, das Datenbank-Passwort, der age-Schlüssel, das Metric-Bearer-Token. Die Mindestmesslatte:

- `.env` ist Modus 0600 und gehört dem Operator-Benutzer.
- `BETTER_AUTH_SECRET`, `ENCRYPTION_SECRET_HEX`, `INSTANCE_SECRET` sind von den Beispielwerten weg rotiert, die `.env.example` mitbringt.
- `DB_PASSWORD` ist vom Default-Platzhalter geändert.
- `SOPS_AGE_KEY` oder `SOPS_AGE_KEY_FILE` ist gesetzt — beide unset zu lassen ist unterstützt, aber Hosts mit verschlüsselter Platte und externem Secret-Management vorbehalten.

Der vollständige SOPS-Walk und die Rotations-Prozedur leben in [Secrets mit SOPS](/de/self-hosted/configuration/secrets-with-sops).

## Audit-Logs

Audit-Logs sind unveränderlich und retentions-gebunden. Compliance-Frameworks erwarten mindestens ein Jahr; die Grenze wird pro Deployment durchgesetzt, also ist die strengste Einstellung der Org das, was tatsächlich läuft. Setz die Untergrenze in deiner Operator-Config so, dass sie zum lockersten Framework passt, das du unterstützt, und stell sicher, dass Backups Audit-Log-Zeilen mit dem Rest der Datenbank erfassen. Die Retention-Referenz lebt in [Retention](/de/self-hosted/configuration/retention).

## Backups

Ein Backup, das nicht wiederhergestellt wurde, ist eine Hoffnung, kein Backup. Das Minimum: tägliche Postgres-Dumps, vom `tale-db`-Cron geschrieben, innerhalb der Stunde vom Host weg kopiert, und ein vierteljährlicher Restore-Drill, der eine funktionierende Instanz aus dem Snapshot wieder aufbaut. Die vollständige Prozedur ist in [Backups und Restore](/de/self-hosted/operate/backups-and-restore).

## Sandbox-Isolation

Run-Code ist die riskanteste Oberfläche im Produkt — der einzige Ort, an dem benutzergelieferter Input zu ausgeführtem Code wird. `tale-sandbox` läuft ohne privilegierte Caps, sein Netzwerk ist intern, und `tale-sandbox-egress` ist sein einziger ausgehender Pfad. Auf Hostname-Ebene ist dieser Pfad standardmäßig offen: sandboxierter Code erreicht jeden öffentlichen Host über HTTPS, während Cloud-Metadaten-Endpunkte und private Adressbereiche auf IP-Ebene immer blockiert sind — dieser Boden hält in jeder Konfiguration.

Der Hardening-Hebel ist `SANDBOX_EGRESS_ALLOWLIST`. Setz die Variable in `.env` auf eine Pipe-getrennte Liste von Hostname-Regexen und erzeuge `tale-sandbox-egress` neu — der Proxy kippt auf Default-Deny, nur passende Hosts sind erreichbar. Ein Lockdown auf reine Registries, der pip, npm, uv und Git über HTTPS am Laufen hält:

```bash
SANDBOX_EGRESS_ALLOWLIST=^pypi\.org$|^files\.pythonhosted\.org$|^registry\.npmjs\.org$|^objects\.githubusercontent\.com$|^codeload\.github\.com$|^github\.com$|^api\.github\.com$
```

Halt die Liste kurz und bevorzuge spezifische Hosts gegenüber Wildcards.

## Monitoring

`METRICS_BEARER_TOKEN` ist in `.env.example` unset — das ist Absicht, damit eine frische Installation keine Metriken leakt. Setz den Token, scrape aus deinem Prometheus, und die Alert-Schwellen in [Operations](/de/self-hosted/operate/observability/operations) decken die kundenwirksamen Signale ab.

Die Hash-Kette des Audit-Logs wird automatisch jede Nacht verifiziert. Jeder Bruch löst einen kritischen Security-Alert an die Org-Admins aus — in der Notification-Glocke und, wenn Slack verbunden ist, in deinem Slack-Channel —, sodass Manipulation auffällt, auch wenn niemand die Logs beobachtet. Dieselbe Verifikation kannst du jederzeit on demand von der Admin-Audit-Log-Seite aus neu walken.

## HTTP-Sicherheitsheader

Jede HTML-Antwort trägt einen strengen Satz an Sicherheitsheadern, und der Satz ist durch Tests abgesichert, sodass ein Upgrade keinen davon unbemerkt fallen lassen kann. Der Plattform-Webclient (`services/platform`) sendet eine Nonce-basierte Content-Security-Policy ohne `unsafe-inline`-Skripte, HSTS über HTTPS, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` zusammen mit CSP `frame-ancestors 'none'`, `Referrer-Policy: strict-origin-when-cross-origin`, eine restriktive `Permissions-Policy` und `X-Permitted-Cross-Domain-Policies: none`. Er erreicht A+ im MDN HTTP Observatory, und diese Note wird von der CI-Testsuite abgesichert — die Bewertung ist in Tests nachgebildet, die den Build bei jeder Regression scheitern lassen. Die Marketing-Seite und die Docs-Seite liefern dieselbe Header-Familie und ergänzen `Cross-Origin-Opener-Policy` und `Cross-Origin-Resource-Policy` mit `same-origin`.

Gegen die eigene Bereitstellung prüfen:

- `curl -sI https://<dein-host>/ | grep -iE 'content-security|strict-transport|x-frame|x-content-type|referrer-policy|permissions-policy|cross-origin'`
- Den Host auf [securityheaders.com](https://securityheaders.com) oder im [MDN HTTP Observatory](https://developer.mozilla.org/de/observatory) scannen.

<!--
  The MDN Observatory UI is only localized in some languages. When adding a new
  docs language, check whether developer.mozilla.org/<lang>/observatory exists
  and fall back to the en-US analyze links if it does not.
-->

Die öffentliche Demo ist die Live-Referenz dafür, was eine korrekte Bereitstellung meldet: Der [Observatory-Scan von demo.tale.dev](https://developer.mozilla.org/de/observatory/analyze?host=demo.tale.dev) stand am 15.07.2026 bei A+ — Score 115/100, alle zehn Tests bestanden. Der einzige Header, der im Report als nicht implementiert steht — `Cross-Origin-Resource-Policy` — kostet keine Punkte und ist die bewusste Ausnahme direkt darunter.

Cross-Origin-Isolation (COOP/CORP) bleibt auf der Plattform-App bewusst aus: `Cross-Origin-Opener-Policy: same-origin` würde die Fenster-Referenz kappen, über die ein OAuth-Anmelde-Popup die fertige Anmeldung an die App zurückmeldet, und `Cross-Origin-Resource-Policy` würde Branding-Assets blockieren, die von einem zweiten Host geladen werden. Die Content-Seiten, die beides nicht tun, aktivieren beide Header. HSTS wird nur ausgegeben, wenn `SITE_URL` `https://` ist.

## Wo das hingehört

Hardening ist keine Ein-Durchgangs-Aufgabe — die Liste oben ist das, was du vor dem Launch walkst und nach jedem Upgrade oder nach jeder Änderung der Netzwerk-Form neu walkst. Das nächste, was es wert ist, danach zu lesen, ist die Zeile oben, die du noch nicht gemacht hast.
