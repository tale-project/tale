---
title: Durcissement
description: La checklist de durcissement pour une instance Tale en production — utilisateur non-root, firewall, TLS, stockage des secrets, rétention d'audit logs, backups.
---

Les défauts livrés par Tale sont sûrs pour le développement et raisonnables pour une petite installation en production. Passer de « raisonnable » à « prêt pour le régulateur » est une checklist, pas un flag de configuration — chaque ligne ci-dessous resserre une surface d'attaque spécifique. Walk la liste une fois avant d'ouvrir l'URL à de vrais utilisateurs, et walk-la à nouveau après chaque montée de version majeure.

Le détail de référence pour chaque ligne vit ailleurs — TLS dans [TLS et domaines](/fr/self-hosted/configuration/tls-and-domains), backups dans [Backups et restauration](/fr/self-hosted/operate/backups-and-restore), rétention dans [Rétention](/fr/self-hosted/configuration/retention). Cette page est l'index qui nomme ce qu'il faut durcir et pointe vers la page qui le walk.

## Hôte

| Élément                                  | Pourquoi ça compte                                                 |
| ---------------------------------------- | ------------------------------------------------------------------ |
| Utilisateur opérateur non-root           | Limite le blast radius si l'utilisateur plateforme est compromis   |
| Auth SSH par clé uniquement              | L'auth par mot de passe est la porte ouverte que les bots scannent |
| Mises à jour de sécurité non surveillées | Patche l'OS sans attendre une fenêtre de maintenance               |
| Firewall hôte (ufw / nftables)           | Ferme tout ce qui n'est pas 22, 80, 443                            |
| Chiffrement du disque au repos           | Requis si tu fais tourner SOPS en mode clair                       |

L'utilisateur non-root est celui que la plupart des équipes sautent. Les conteneurs de Tale font tourner leurs propres processus non-root à l'intérieur, mais le démon Docker lui-même tourne en root — opérer ce démon en tant qu'utilisateur opérateur (membre du groupe `docker`, pas en tant que root) est le resserrement le moins cher de cette page. Le walk complet vit dans [Installation serveur Linux de production](/fr/self-hosted/install/linux-server).

## Réseau

Le proxy est la seule surface entrante. Bloque tout le reste.

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

Si tu fais tourner l'auth trusted-headers, le port plateforme ne doit pas être joignable directement depuis ailleurs que le proxy amont — tout ce qui peut le frapper avec les bons en-têtes devient cet utilisateur. Un réseau Docker ou une règle firewall hôte marchent tous les deux ; choisis-en un et vérifie-le depuis l'extérieur de l'hôte.

## TLS

`TLS_MODE=selfsigned` est pour le développement. La production fait tourner `letsencrypt` (ou `external` si tu mets ton propre proxy TLS-terminant devant Tale). Le cron de renouvellement est automatique ; l'alerte qui sonne quand le renouvellement échoue est ce qui te sauve 90 jours plus tard. Voir [TLS et domaines](/fr/self-hosted/configuration/tls-and-domains).

## Secrets

Chaque secret dans `.env` est sensible — le secret de signature d'auth, la clé de chiffrement, le mot de passe de base, la clé age, le bearer token de métriques. La barre minimale :

- `.env` est en mode 0600 et appartient à l'utilisateur opérateur.
- `BETTER_AUTH_SECRET`, `ENCRYPTION_SECRET_HEX`, `INSTANCE_SECRET` sont rotés depuis les valeurs d'exemple livrées dans `.env.example`.
- `DB_PASSWORD` est changé du placeholder par défaut.
- `SOPS_AGE_KEY` ou `SOPS_AGE_KEY_FILE` est défini — laisser les deux non définis est supporté mais réservé aux hôtes à disque chiffré avec gestion de secrets externe.

Le walk SOPS complet et la procédure de rotation vivent dans [Secrets avec SOPS](/fr/self-hosted/configuration/secrets-with-sops).

## Audit logs

Les audit logs sont immuables et bornés par rétention. Les frameworks de compliance attendent au moins un an ; la borne est imposée par déploiement, donc le réglage de l'org le plus strict est ce qui tourne effectivement. Fixe le plancher dans ta config opérateur pour correspondre au framework le plus lâche que tu supportes, et assure-toi que les backups capturent les lignes d'audit log avec le reste de la base. La référence de rétention vit dans [Rétention](/fr/self-hosted/configuration/retention).

## Backups

Un backup qui n'a pas été restauré est un espoir, pas un backup. Le minimum : dumps Postgres quotidiens écrits par le cron `tale-db`, copiés hors-hôte dans l'heure, et un drill de restauration trimestriel qui reconstruit une instance fonctionnelle depuis le snapshot. La procédure complète est dans [Backups et restauration](/fr/self-hosted/operate/backups-and-restore).

## Isolation de la sandbox

Run-code est la surface la plus risquée du produit — le seul endroit où un input fourni par l'utilisateur devient du code exécuté. `tale-sandbox` tourne sans cap privilégié, son réseau est interne uniquement, et `tale-sandbox-egress` est son seul chemin sortant. Au niveau des hôtes, ce chemin est ouvert par défaut : le code en sandbox atteint n'importe quel hôte public en HTTPS, tandis que les endpoints de métadonnées cloud et les plages d'adresses privées sont toujours bloqués au niveau IP — ce plancher tient dans toutes les configurations.

Le levier de durcissement est `SANDBOX_EGRESS_ALLOWLIST`. Mets-la dans `.env` sur une liste de regex d'hôtes séparées par des pipes et recrée `tale-sandbox-egress` : le proxy bascule en refus par défaut — seuls les hôtes correspondants sont joignables. Un verrouillage limité aux registres, qui garde pip, npm, uv et Git via HTTPS fonctionnels :

```bash
SANDBOX_EGRESS_ALLOWLIST=^pypi\.org$|^files\.pythonhosted\.org$|^registry\.npmjs\.org$|^objects\.githubusercontent\.com$|^codeload\.github\.com$|^github\.com$|^api\.github\.com$
```

Garde la liste courte et préfère des hôtes spécifiques aux wildcards.

## Monitoring

`METRICS_BEARER_TOKEN` est non défini dans `.env.example` — c'est intentionnel, pour qu'une installation fraîche ne leak pas de métriques. Règle le token, scrape depuis ton Prometheus, et les seuils d'alerte dans [Opérations](/fr/self-hosted/operate/observability/operations) couvrent les signaux client-impactants.

La chaîne de hachage du journal d'audit est vérifiée automatiquement chaque nuit. Toute rupture déclenche une alerte de sécurité critique vers les admins de l'org — dans la cloche de notifications et, lorsque Slack est connecté, dans ton canal Slack — pour que toute altération ressorte même quand personne ne surveille les logs. Tu peux re-walk la même vérification à la demande depuis la page d'administration du journal d'audit.

## En-têtes de sécurité HTTP

Chaque réponse HTML porte un ensemble strict d'en-têtes de sécurité, et cet ensemble est verrouillé par des tests pour qu'une mise à jour ne puisse pas en supprimer un discrètement. Le client web de la plateforme (`services/platform`) envoie une Content-Security-Policy à nonce sans scripts `unsafe-inline`, HSTS en HTTPS, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` avec CSP `frame-ancestors 'none'`, `Referrer-Policy: strict-origin-when-cross-origin`, une `Permissions-Policy` restrictive et `X-Permitted-Cross-Domain-Policies: none`. Il obtient A+ au MDN HTTP Observatory, et cette note est garantie par la suite de tests CI — le calcul du score est réimplémenté dans des tests qui font échouer le build à la moindre régression. Le site vitrine et le site de documentation livrent la même famille d'en-têtes, en ajoutant `Cross-Origin-Opener-Policy` et `Cross-Origin-Resource-Policy` à `same-origin`.

Vérifie-le sur ton propre déploiement :

- `curl -sI https://<ton-hôte>/ | grep -iE 'content-security|strict-transport|x-frame|x-content-type|referrer-policy|permissions-policy|cross-origin'`
- Analyse l'hôte sur [securityheaders.com](https://securityheaders.com) ou le [MDN HTTP Observatory](https://developer.mozilla.org/fr/observatory).

<!--
  The MDN Observatory UI is only localized in some languages. When adding a new
  docs language, check whether developer.mozilla.org/<lang>/observatory exists
  and fall back to the en-US analyze links if it does not.
-->

La démo publique est la référence en direct de ce qu’un déploiement correct rapporte : le [scan Observatory de demo.tale.dev](https://developer.mozilla.org/fr/observatory/analyze?host=demo.tale.dev) affichait A+ le 15/07/2026 — score 115/100, dix tests sur dix réussis. Le seul en-tête que le rapport liste comme non implémenté, `Cross-Origin-Resource-Policy`, ne coûte aucun point ; c’est l’exception délibérée décrite juste en dessous.

L’isolation cross-origin (COOP/CORP) reste volontairement désactivée sur l’app de la plateforme : `Cross-Origin-Opener-Policy: same-origin` couperait la référence de fenêtre par laquelle un popup de connexion OAuth renvoie l’authentification terminée à l’app, et `Cross-Origin-Resource-Policy` bloquerait les ressources de marque chargées depuis un second hôte. Les sites de contenu, qui ne font ni l’un ni l’autre, activent les deux. HSTS n’est émis que lorsque `SITE_URL` est `https://`.

## Où cela s'inscrit

Le durcissement n'est pas une tâche d'une seule passe — la liste ci-dessus est ce que tu walks avant le lancement, et que tu re-walks après chaque montée de version ou après chaque changement de la forme du réseau. La prochaine chose qui vaut la lecture après ceci est la ligne ci-dessus que tu n'as pas encore faite.
