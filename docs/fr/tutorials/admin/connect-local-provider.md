---
title: Brancher un fournisseur LLM local
description: Déclare un serveur Ollama, LM Studio ou vLLM local comme connecteur de fournisseur maison sur une instance Tale auto-hébergée, enregistre son identifiant et vérifie qu'un chat l'atteint sans quitter ton réseau.
---

Un fournisseur local, c'est la voie pour faire tourner des modèles dans ton propre périmètre — aucun appel API sortant, aucune facture au token, aucune transcription chez un tiers. Ce parcours mène une instance Tale auto-hébergée de « j'ai un point de terminaison Ollama, LM Studio ou vLLM » à « un chat de l'organisation appelle un modèle local et la réponse arrive en streaming ». Il s'adresse à un Administrateur sur une installation auto-hébergée ; les organisations Cloud n'atteignent pas ton réseau et sautent cette page.

Il te faut le rôle Administrateur dans Tale, un serveur d'inférence local joignable depuis le conteneur `tale-platform` en TLS, et un modèle déjà chargé sur ce serveur. Le format du connecteur et le modèle d'identifiants sont documentés dans [Fournisseurs](/fr/self-hosted/configuration/providers) ; cette page déroule un chemin complet et en vérifie le résultat.

## Avant de commencer

Vérifie quatre choses. Ton rôle est Administrateur ou Propriétaire — **Paramètres > Fournisseurs IA** est masqué en dessous. Ton serveur d'inférence local répond à `GET /v1/models` (ou l'équivalent Ollama `GET /api/tags`) depuis l'intérieur du réseau Docker de Tale. Au moins un modèle est chargé — côté Ollama tu as lancé `ollama pull llama3.1:8b` ou équivalent, côté LM Studio un modèle est chargé dans l'onglet serveur, côté vLLM le serveur est démarré avec `--model` pointé sur un checkpoint. Et le serveur est joignable en `https://` : l'URL de base d'un connecteur doit être une URL HTTPS, alors termine le TLS devant le serveur d'inférence — un reverse proxy avec un certificat interne est la réponse habituelle — plutôt que de l'exposer en clair.

## Étape 1 — Rendre le serveur d'inférence joignable depuis Tale

Le premier geste consiste à confirmer que `tale-platform` joint le serveur d'inférence par son nom d'hôte en TLS. Sans cela, chaque appel de modèle remonte une erreur de connexion et aucun modèle n'est appelable.

Quand le serveur d'inférence tourne derrière un proxy du même réseau Docker, le nom d'hôte joignable est le nom de service de ce proxy. Lance un curl unique depuis le conteneur `tale-platform` avant d'écrire la moindre configuration :

```bash
docker compose exec platform curl -sf https://ollama.internal/api/tags
```

Une liste JSON des modèles chargés est le signal de succès. Une erreur de connexion signifie un mauvais nom d'hôte, un certificat non approuvé, ou un serveur d'inférence qui n'écoute pas sur l'interface que le conteneur atteint.

## Étape 2 — Déclarer le connecteur

Les connecteurs livrés couvrent les fournisseurs publics ; une machine de ton propre réseau est un connecteur maison — un fichier YAML dans l'arbre de configuration de l'organisation. Le fichier dit à Tale où envoyer les requêtes, quel dialecte le point de terminaison parle et d'où vient sa liste de modèles.

Écris `$TALE_CONFIG_DIR/<orgSlug>/providers/local-ollama.yml`. Le `name` doit correspondre à la racine du nom de fichier, et il ne doit entrer en collision avec aucun connecteur livré :

```yaml
name: local-ollama
displayName: Local Ollama
apiFormat: openai
baseUrl: https://ollama.internal/v1
catalog:
  source: models-endpoint
auth:
  - method: api-key
  - method: env
```

`apiFormat: openai` convient à Ollama, LM Studio et vLLM — les trois exposent la forme OpenAI Chat Completions. `catalog.source: models-endpoint` dit à Tale de lister les modèles via `GET {baseUrl}/models` au lieu d'embarquer une liste statique, ce que tu veux quand les modèles chargés changent. Un fichier qui ne valide pas est ignoré et la raison est journalisée : lis le log de la plateforme si le connecteur n'apparaît pas.

## Étape 3 — Enregistrer l'identifiant

Un connecteur seul n'appelle rien. Ce qui autorise une requête, c'est un identifiant enregistré sur ce connecteur, et un connecteur en porte autant que nécessaire.

Ouvre **Paramètres > Fournisseurs IA**. Le nouveau connecteur s'affiche à côté des connecteurs livrés ; clique sur **Ajouter un identifiant** dessus. Choisis **Clé API** et colle le token qu'attend ton serveur — LM Studio ignore la valeur, vLLM veut le token passé à `--api-key`. Nomme l'identifiant d'après la machine qu'il atteint (`Machine GPU, baie 2`), et laisse la **Liste blanche de modèles** vide pour exposer tout ce que le serveur liste, ou choisis le sous-ensemble que l'organisation peut appeler. Le premier identifiant d'un connecteur en devient le défaut.

Tu préfères que la clé vive sur le déploiement ? Choisis **Variable d'environnement** et nomme une variable de déploiement sous le préfixe réservé `TALE_PROVIDER_KEY_`. Le secret n'entre alors jamais dans le stockage de Tale, et ton équipe d'exploitation possède la rotation.

## Étape 4 — Vérifier avec un chat

La preuve que le câblage tient, c'est une réponse de chat en streaming venue du serveur local. Sans cette étape, tu sais seulement que la configuration se parse.

Ouvre un nouveau chat, ouvre le sélecteur de modèle et choisis l'un des modèles locaux par son nom — un modèle se choisit toujours explicitement, il n'y a donc aucune couche de routage à écarter. Envoie un prompt court (`Réponds par le seul mot "prêt"`). La réponse arrive en quelques secondes.

Suis le log du serveur d'inférence sur l'hôte pendant l'envoi — Ollama journalise la ligne de requête, LM Studio imprime un résumé de requête, vLLM la latence de génération. Voir la requête arriver sur le serveur local, c'est la vérification que le trafic reste dans ton réseau au lieu de rebondir par une API externe.

## Dépannage

- **Symptôme :** le connecteur n'apparaît jamais dans **Paramètres > Fournisseurs IA**. **Cause :** le YAML n'a pas validé, ou son `name` ne correspond pas à la racine du nom de fichier. **Correctif :** lis le log de la plateforme — un connecteur rejeté y est journalisé avec le fichier et la raison — puis corrige le fichier.
- **Symptôme :** le connecteur apparaît mais sa liste de modèles reste vide. **Cause :** le serveur d'inférence est joignable mais n'a aucun modèle chargé, ou son point de terminaison `/models` a répondu une erreur. **Correctif :** charge un modèle, puis clique sur **Actualiser les catalogues** sur la page des fournisseurs. Les catalogues ne se mettent à jour que quand tu les actualises.
- **Symptôme :** le fichier est rejeté parce que l'URL de base n'est pas en HTTPS, ou pointe sur `localhost`, `127.0.0.1` ou une IP privée. **Cause :** les URL de base de connecteur sont HTTPS uniquement, et la politique d'hôtes bloque le loopback et les adresses privées. **Correctif :** place un reverse proxy qui termine le TLS devant le serveur d'inférence et utilise son nom d'hôte interne.
- **Symptôme :** la réponse du chat est une erreur qui nomme le modèle. **Cause :** l'identifiant du modèle ne correspond pas à celui de l'amont. **Correctif :** rechoisis dans le sélecteur de modèle — les tags Ollama comme `:latest` comptent en amont et doivent correspondre exactement.

## Où cela s'inscrit

Un fournisseur local est la couture entre Tale et tes propres GPU — la même forme connecteur-et-identifiant qu'un fournisseur public, mais aucun trafic ne quitte ton réseau. Les lectures suivantes naturelles sont [Fournisseurs](/fr/self-hosted/configuration/providers) pour le format complet du connecteur et la voie par variable d'environnement, et [Durcissement](/fr/self-hosted/operate/security/hardening) pour les garanties de sortie qui empêchent un agent d'atteindre un modèle cloud que tu n'avais pas prévu.
