---
title: Intégrations
description: Construire des intégrations personnalisées — connecteurs REST, bases SQL, serveurs MCP — et où chacune s'insère à côté du catalogue d'intégrations livré.
---

Les intégrations sont les coutures entre Tale et le reste de ta stack. Le catalogue livré couvre les systèmes SaaS courants (Slack, GitHub, Microsoft 365, Google Drive, Shopify et le reste) ; quand ton système cible n'y est pas, tu construis le pont toi-même. Trois surfaces te le permettent : un connecteur REST déclaré en JSON, un adaptateur SQL pour les bases relationnelles, ou un serveur MCP quand il te faut un processus auto-hébergé pour relayer les appels.

Lis ceci quand tu étends le catalogue d'intégrations. Reviens-y quand une operation que tu as déclarée n'apparaît pas dans la barre d'outils de l'agent — la réponse est presque toujours un conflit de schéma contre la référence sous `.tale/reference/integrations/`.

## Un connecteur REST personnalisé mis en pratique

L'intégration utile la plus simple est une seule operation REST déclarée en JSON. Dépose un dossier dans le projet et l'intégration apparaît sous **Paramètres > Intégrations** sans changement de code :

```text
integrations/
  acme-billing/
    config.json
    connector.ts        # optionnel, pour façonner les requêtes non triviales
    icon.svg
```

`config.json` déclare la méthode d'auth, les hôtes autorisés et les operations :

```json
{
  "slug": "acme-billing",
  "name": "ACME Billing",
  "auth": { "type": "apiKey", "header": "X-API-Key" },
  "allowedHosts": ["api.acme.example.com"],
  "operations": [
    {
      "name": "list_invoices",
      "method": "GET",
      "path": "/v1/invoices",
      "query": { "since": "string?" }
    }
  ]
}
```

L'operation apparaît sur les agents comme une famille de tools dès que l'org branche ses identifiants. Le fichier connecteur est optionnel — sers-t'en quand la forme de réponse a besoin d'être aplatie ou quand la pagination demande des boucles que le manifeste ne peut pas exprimer.

Pour un connecteur OAuth2 (`"auth": { "type": "oauth2", … }`), enregistre l'URL de callback de Tale comme URI de redirection autorisée dans l'app OAuth upstream, sinon l'étape de consentement échoue avec un `redirect_uri` non concordant. Le callback est `${SITE_URL}/api/integrations/oauth2/callback` (préfixé par `BASE_PATH` s'il est défini). En développement local, cet origin est ton URL de dev — `http://localhost:3000/api/integrations/oauth2/callback`, pas un hôte `https://`.

## Choix de la surface

| Surface        | Sers-t'en quand                                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Manifeste REST | Le système cible parle JSON sur HTTPS et l'auth est clé API ou OAuth2. Couvre la plupart des API SaaS.                               |
| Adaptateur SQL | La cible est une base relationnelle (Postgres, MySQL, SQL Server) et tu veux que les agents lisent des tables sous policy par ligne. |
| Serveur MCP    | Le pont doit être un processus de longue durée — fichiers locaux, une CLI à toi, un système inatteignable depuis le réseau de Tale.  |
| Connecteur TS  | Le manifeste REST couvre 80 % de l'API mais une operation a besoin d'une mise en forme que le manifeste ne sait pas déclarer.        |

Les intégrations livrées sous [Platform > Intégrations](/fr/platform/integrations/overview) sont le catalogue des manifestes REST que Tale livre — lis leurs configs dans `examples/default/integrations/` pour les motifs que tu copieras.

## Adaptateurs SQL

Un adaptateur SQL expose une surface de tools façon Tale sur une base SQL. Tu déclares la connexion (driver, hôte, référence d'identifiant) et les tables que l'intégration a le droit de lire ; l'adaptateur génère une operation `query_<table>` par table déclarée et une operation `run_named_query` pour les requêtes que tu autorises par nom. Les écritures passent par les mutations déclarées uniquement — il n'y a pas d'operation `execute` brute.

L'autorisation ligne par ligne est la responsabilité de l'opérateur : déclare une colonne tenant sur chaque table et Tale injectera le filtre tenant dans chaque requête générée. Les operations qui touchent une table sans colonne tenant échouent à la validation au déploiement.

## Serveurs MCP

Quand l'intégration ne peut pas s'exprimer comme un manifeste JSON — une CLI, une chaîne d'outils locale, n'importe quoi isolé du réseau de Tale — écris un serveur MCP et enregistre-le sous **Paramètres > Serveurs MCP**. Chaque tool que le serveur expose apparaît dans la barre d'outils de l'agent avec approbation par tool au premier appel. Le transport est stdio pour Tale auto-hébergé ; pour Tale Cloud, le serveur vit sur ton réseau et Tale l'appelle via un tunnel HTTPS signé.

Le walk-through MCP complet vit sous [Serveur MCP de zéro](/fr/tutorials/developer/mcp-server-from-scratch) — cette page est la construction ; celle-ci est le choix.

## Où cela s'inscrit

Les intégrations personnalisées sont la manière dont Tale atteint des systèmes que le catalogue livré ne couvre pas. La [vue d'ensemble des intégrations](/fr/platform/integrations/overview) liste ce qui est déjà là ; une fois ton intégration personnalisée déclarée, [Tools d'agent](/fr/platform/agents/tools) explique comment ses operations apparaissent sur un agent. Si le pont doit vivre entièrement hors de Tale — un processus que tu démarres, un hôte que tu contrôles — la [référence Serveurs MCP](/fr/platform/integrations/mcp-servers) couvre l'autre moitié.
