---
title: Ton premier jour d’connector avec Tale
description: Le parcours développeur — crée une clé API, envoie ta première requête authentifiée et sache où vit la surface d’API.
---

Ce parcours s’adresse à la personne qui câble Tale dans d’autres systèmes. En dix minutes, tu crées une clé API, tu envoies ta première requête authentifiée et tu sais à quelle porte frapper pour le chat, les workflows et les documents.

Il te faut le rôle **Développeur** ou plus (les paramètres d’API sont masqués en dessous) sur une instance qui tourne — [démarrage rapide](/fr/get-started/quickstart) si tu n’en as pas. Remplace `your-host.example.com` ci-dessous par l’hôte de ton instance.

<Steps>

<Step title="Crée une clé API">

Pour obtenir un identifiant que tes scripts peuvent porter, ouvre **Paramètres > API > REST** et clique sur **Créer une clé API**. Nomme-la d’après le système qui l’utilisera — les clés sont listées par nom, et dans un an « zapier-bridge » bat « test ». La valeur de la clé ne s’affiche qu’une fois, à la création ; range-la dans ton gestionnaire de secrets, pas dans le code.

<Frame caption="Les paramètres de l’API REST — les clés se créent et se révoquent ici.">

![La page des paramètres des clés API REST listant deux clés — Production ingest et CI pipeline — dont chacune n’affiche que son préfixe, sa date d’ajout et la mention Jamais utilisée, à côté d’un bouton Créer une clé API.](/images/get-started/settings-api-keys.webp)

</Frame>

</Step>

<Step title="Envoie la première requête">

La première requête liste les modèles que ta clé peut utiliser dans le chat direct. La clé passe comme jeton Bearer ; le contexte d’organisation suit tes appartenances :

```bash
curl -sS https://your-host.example.com/api/v1/models \
  -H "Authorization: Bearer $TALE_API_KEY"
```

<Check>

Un objet JSON contenant un tableau `models` confirme la clé, l’authentification et la route. Le tableau peut être vide si aucun modèle de chat direct n’est disponible. Un `401` indique un en-tête d’autorisation mal formé ou une clé révoquée.

</Check>

</Step>

</Steps>

## Le reste de la surface

Pour travailler dans un projet, démarre une automatisation avec `POST /api/v1/projects/{id}/automations/{name}/runs`, puis suis `/api/v1/projects/{id}/runs/{runId}`. Les chats, tâches et fichiers du projet suivent la même structure `/api/v1/projects/{id}/...` : l’ID du projet appartient à l’URL. Le chat personnel sans projet utilise `/api/v1/threads`, et `/api/v1/documents` gère les documents du hub sans projet. Un appelant webhook utilise `/api/projects/{id}/automations/webhook/{token}` pour une automatisation installée dans le projet ; le token l’autorise. La [référence API](/fr/develop/api-reference) décrit les routes sans projet, les droits et l’en-tête d’organisation requis. La même clé ouvre aussi l’[endpoint MCP](/fr/develop/mcp-endpoint) aux clients pilotés par modèle.

## Où tu en es

Tu tiens un identifiant qui fonctionne et tu as vu la forme de requête que chaque endpoint partage. À partir d’ici, [appeler Tale depuis un script](/fr/tutorials/developer/call-tale-from-a-script) transforme le curl en vraie connector, [déclencher une automatisation par webhook](/fr/tutorials/developer/trigger-automation-via-webhook) couvre le sens entrant — tes systèmes qui déclenchent Tale — et l’[endpoint MCP](/fr/develop/mcp-endpoint) est la même plateforme pour les clients MCP.
