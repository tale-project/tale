---
title: TLS et domaines
description: Comment le proxy Caddy termine TLS — auto-signé pour développement, Let's Encrypt pour production, externe pour un proxy amont — plus les setups domaine personnalisé et certificat personnalisé.
---

Le conteneur `tale-proxy` est Caddy. Il possède la terminaison TLS, le routage par hôte et la barrière d'auth des métriques ; chaque requête venue du navigateur y atterrit en premier. Les trois modes — auto-signé, Let's Encrypt, externe — couvrent les trois formes de déploiement que la plupart des opérateurs choisissent, et la variable qui bascule entre eux est `TLS_MODE` dans ton `.env`.

Les lignes de référence des variables d'env vivent dans [Référence des variables d'environnement](/fr/self-hosted/configuration/environment-reference#tls). Cette page est le walkthrough mode par mode et les recettes pour les domaines personnalisés et bring-your-own certificats.

## Auto-signé (défaut)

`TLS_MODE=selfsigned` fait tourner Caddy avec un certificat qu'il génère depuis sa CA interne. Le navigateur avertit la première fois, et l'hôte doit faire confiance au certificat pour supprimer l'avertissement — c'est destiné au développement local :

```bash
docker exec tale-proxy caddy trust
```

La commande trust importe la CA de Caddy dans le trust store système sur l'hôte qui fait tourner le démon Docker. Les autres machines du réseau voient encore l'avertissement sauf si elles importent la CA aussi. La production n'utilise jamais ce mode.

## Let's Encrypt

`TLS_MODE=letsencrypt` laisse Caddy émettre et renouveler un vrai certificat public. Trois prérequis doivent tenir sinon la boucle d'émission échoue :

- Le hostname dans `HOST` et `SITE_URL` résout vers l'IP publique de l'hôte depuis l'Internet public.
- Les ports 80 et 443 sont joignables depuis l'Internet public (le port 80 porte le challenge ACME HTTP-01).
- `TLS_EMAIL` est mis sur une boîte mail que tu lis — Let's Encrypt y avertit avant l'expiration.

```bash
# .env
TLS_MODE=letsencrypt
TLS_EMAIL=ops@yourdomain.com
```

Le premier boot bloque environ une minute pendant que le challenge ACME tourne. Après ça, les renouvellements sont automatiques 30 jours avant l'expiration ; les échecs atterrissent dans `docker compose logs proxy`.

## Proxy externe

`TLS_MODE=external` fait que Caddy sert du HTTP en clair à l'intérieur, et tu le mets derrière ton propre reverse proxy qui termine TLS en amont. Choisis ça quand :

- Tu fais déjà tourner un CDN ou un load balancer qui gère les certificats.
- Tu veux terminer TLS une seule fois au bord de ton VPC et faire tourner tout l'interne en clair.
- Ta posture de compliance exige une autorité de certification spécifique que Caddy ne supporte pas.

```bash
# .env
TLS_MODE=external
SITE_URL=https://tale.yourdomain.com  # l'URL que tes utilisateurs frappent
```

Le proxy en amont a besoin que `X-Forwarded-Proto: https` soit posé sur chaque requête pour que Tale génère des redirects et des URL absolues correctes. Sans lui, les liens de sign-in atterrissent sur `http://` et le flag `Secure` du cookie d'auth les rejette.

## Domaine personnalisé

Le domaine lui-même n'est que `HOST` et `SITE_URL`. Le même Caddyfile dans `tale-proxy` lit les deux au boot. Change-les, recrée le conteneur proxy (`docker compose up -d --force-recreate tale-proxy`), et le nouveau domaine est live en quelques secondes. Let's Encrypt réémet pour le nouveau nom à la prochaine requête qui frappe le nouveau hostname.

```bash
# .env
HOST=tale.example.com
SITE_URL=https://tale.example.com
```

Les déploiements en sous-chemin — Tale derrière `https://example.com/app/` — règlent en plus `BASE_PATH=/app`. Le reverse proxy en amont de Caddy ne strip rien ; Tale gère le préfixe lui-même.

## Plusieurs domaines à la fois

Un déploiement peut répondre sur plusieurs domaines — un apex et un domaine de marque, l'hôte en
marque blanche d'un partenaire, un ancien nom gardé vivant après un changement. Liste les origines
supplémentaires dans `ADDITIONAL_SITE_URLS`, séparées par des virgules ou des espaces, et garde
`SITE_URL` comme domaine canonique :

```bash
# .env
HOST=tale.example.com
SITE_URL=https://tale.example.com
ADDITIONAL_SITE_URLS=https://tale.partner.example,https://app.example.org
```

Chaque entrée est une origine nue — schéma, hôte, port optionnel, pas de chemin. Caddy les sert
toutes depuis le même bloc de site et, sous `TLS_MODE=letsencrypt`, obtient un certificat par nom :
le DNS de chaque domaine doit donc pointer vers cet hôte avant que tu recrées le proxy.

Chaque domaine listé est une entrée complète, pas une redirection : qui se connecte sur l'un y
reste, et les liens que l'app construit — callbacks de connexion, consentements de connecteur,
URLs audio et de téléchargement — l'y maintiennent, parce que le cookie de session vit sur ce
domaine-là et nulle part ailleurs.

<Warning>

Un domaine absent de cette liste n'est jamais honoré, même si une requête arrive avec son en-tête
`Host` : les hôtes inconnus retombent sur le `SITE_URL` canonique. C'est ce qui empêche un `Host`
falsifié de pointer un callback de connexion vers le serveur de quelqu'un d'autre.

</Warning>

### Ce qui reste sur le domaine canonique

`SITE_URL` reste la seule réponse partout où un déploiement ne peut en avoir qu'une : laisse-la
donc pointer vers ton domaine principal.

| Reste canonique                 | Pourquoi                                                                          |
| ------------------------------- | ---------------------------------------------------------------------------------- |
| Liens e-mail et notifications   | Envoyés sans requête navigateur, il n'y a donc aucun domaine à déduire.           |
| entityID du SP SAML             | Le fournisseur d'identité connaît le service par un identifiant stable.           |
| `meta.location` SCIM            | Les URLs de ressources doivent rester stables d'une synchro d'annuaire à l'autre. |
| Passkeys                        | WebAuthn lie une clé à un seul domaine ; une clé enregistrée sur l'hôte canonique n'est pas proposée sur les autres. |
| `OBJECT_STORE_PUBLIC_ENDPOINT`  | Retombe sur `SITE_URL` ; les URLs présignées sont signées contre cette origine.   |

### Enregistrer chaque domaine chez tes fournisseurs d'identité et OAuth

Une connexion qui démarre sur `tale.partner.example` revient sur `tale.partner.example` : l'URL de
callback propre à ce domaine doit donc être enregistrée chez le fournisseur. Le produit affiche la
liste exacte par domaine, tu n'as jamais à assembler les URLs à la main :

- **Paramètres > Enterprise SSO** liste l'URL de redirection (OIDC) et l'URL ACS (SAML) de chaque
  domaine. Le document de métadonnées SAML publie un `AssertionConsumerService` par domaine :
  l'importer les enregistre tous d'un coup.
- **Paramètres > Connecteurs > Apps OAuth** liste l'URI de redirection connecteur et
  cloud-import de chaque domaine.

## Apporter ton propre certificat

Pour une CA interne ou un certificat wildcard que tu possèdes déjà, monte le certificat et la clé dans `tale-proxy` et ajoute une directive `tls` au Caddyfile :

```yaml
# override compose.yml
services:
  proxy:
    volumes:
      - ./certs/fullchain.pem:/etc/tale/cert.pem:ro
      - ./certs/privkey.pem:/etc/tale/key.pem:ro
    environment:
      TLS_MODE: external # contourne l'auto-émission de Caddy
```

Ensuite, soit pré-construis une image `tale-proxy` avec un Caddyfile personnalisé, soit mets ton propre reverse proxy devant Tale et reste sur `TLS_MODE=external` — les deux chemins sont supportés et le second est plus simple.

## Où cela s'inscrit

Les trois modes couvrent les trois formes de déploiement que la plupart des équipes touchent ; les lignes de variables d'env vivent dans [Référence des variables d'environnement](/fr/self-hosted/configuration/environment-reference#tls). Si tu mets en place un hôte de production frais maintenant, [Installation serveur Linux de production](/fr/self-hosted/install/linux-server) walk Let's Encrypt de bout en bout avec les étapes firewall et DNS dans l'ordre.
