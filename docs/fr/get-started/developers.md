---
title: Ton premier jour d’intégration avec Tale
description: Le parcours développeur — crée une clé API, envoie ta première requête authentifiée et sache où vit la surface d’API.
---

Ce parcours s’adresse à la personne qui câble Tale dans d’autres systèmes. En dix minutes, tu crées une clé API, tu envoies ta première requête authentifiée et tu sais à quelle porte frapper pour le chat, les workflows et les documents.

Il te faut le rôle **Développeur** ou plus (les paramètres d’API sont masqués en dessous) sur une instance qui tourne — [démarrage rapide](/fr/get-started/quickstart) si tu n’en as pas. Remplace `your-host.example.com` ci-dessous par l’hôte de ton instance.

<Steps>

<Step title="Crée une clé API">

Pour obtenir un identifiant que tes scripts peuvent porter, ouvre **Paramètres > API > REST** et clique sur **Créer une clé API**. Nomme-la d’après le système qui l’utilisera — les clés sont listées par nom, et dans un an « zapier-bridge » bat « test ». La valeur de la clé ne s’affiche qu’une fois, à la création ; range-la dans ton gestionnaire de secrets, pas dans le code.

<Frame caption="Les paramètres de l’API REST — les clés se créent et se révoquent ici.">

![La page des paramètres des clés API REST avec un bouton Créer une clé API et une liste de clés vide.](/images/get-started/settings-api-keys.webp)

</Frame>

</Step>

<Step title="Envoie la première requête">

L’appel utile le plus court liste les agents que ta clé peut voir. La clé voyage comme un token bearer ; le contexte de l’espace de travail se déduit de la clé elle-même :

```bash
curl -sS https://your-host.example.com/api/v1/agents \
  -H "Authorization: Bearer $TALE_API_KEY"
```

<Check>

Un tableau JSON d’agents — dont l’Assistant intégré — prouve la clé, l’en-tête et la route. Un `401` signifie que l’en-tête du token est malformé ou que la clé a été révoquée.

</Check>

</Step>

</Steps>

## Le reste de la surface

Tout le reste est une variation de cette requête. Les endpoints compatibles OpenAI (`/api/v1/chat/completions`, `/api/v1/models`) signifient que les SDK existants fonctionnent en changeant l’URL de base ; les workflows se lancent par slug via `/api/v1/workflows/<slug>/run` avec la même clé Bearer, ou se déclenchent depuis l’extérieur via des URL de webhook de la forme `/api/workflows/wh/<token>` — le jeton dans l’URL est l’identifiant ; les documents se téléversent via `/api/v1/documents`. La [référence API](/fr/develop/api-reference) est l’inventaire complet avec l’authentification, les formes et les limites.

## Où tu en es

Tu tiens un identifiant qui fonctionne et tu as vu la forme de requête que chaque endpoint partage. À partir d’ici, [appeler Tale depuis un script](/fr/tutorials/developer/call-tale-from-a-script) transforme le curl en vraie intégration, [déclencher un workflow par webhook](/fr/tutorials/developer/trigger-automation-via-webhook) couvre le sens entrant — tes systèmes qui déclenchent Tale — et [webhooks](/fr/develop/webhooks) documente les payloads que Tale t’envoie.
