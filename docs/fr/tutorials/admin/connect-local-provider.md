---
title: Brancher un fournisseur LLM local
description: Câble un serveur Ollama, LM Studio ou vLLM local dans une instance Tale auto-hébergée, allowliste ses modèles et vérifie que les agents l'atteignent sans quitter le réseau de l'hôte.
---

Un fournisseur local est le chemin vers des modèles qui tournent dans ton propre périmètre — pas d'appels d'API sortants, pas de facture au token, pas de transcription chez un tiers. Ce parcours emmène une instance Tale auto-hébergée de « J'ai un endpoint Ollama, LM Studio ou vLLM » à « Un agent dans l'organisation appelle un modèle local et la réponse streame en retour. » Le parcours s'adresse à un Admin sur un install auto-hébergé ; les organisations Cloud ne tendent pas la main vers ton réseau et sautent cette page.

Il te faut le rôle Admin dans Tale, un serveur d'inférence local joignable depuis le conteneur `tale-platform`, et un modèle déjà téléchargé ou chargé sur ce serveur. La mécanique sous-jacente du fournisseur est documentée dans [Fournisseurs](/fr/self-hosted/configuration/providers) ; cette page parcourt le chemin UI et vérifie le résultat de bout en bout.

## Avant de commencer

Confirme quatre choses. Ton rôle est Admin ou Propriétaire — le panneau **Fournisseurs** est caché en dessous. Ton serveur d'inférence local tourne et répond à `GET /v1/models` (ou l'équivalent Ollama `GET /api/tags`) depuis l'intérieur du réseau Docker Tale. Au moins un modèle est chargé — les utilisateurs d'Ollama ont lancé `ollama pull llama3.1:8b` ou similaire, les utilisateurs de LM Studio ont un modèle chargé dans l'onglet serveur, les utilisateurs de vLLM ont démarré le serveur avec `--model` pointant sur un checkpoint. Et le chemin réseau de `tale-platform` vers l'hôte d'inférence est ouvert sur le port d'inférence (typiquement `11434` pour Ollama, `1234` pour LM Studio, `8000` pour vLLM).

## Étape 1 — Rendre le serveur d'inférence joignable depuis Tale

Le premier geste est de confirmer que `tale-platform` atteint le serveur d'inférence par son nom d'hôte. Sans ça, chaque appel de modèle fait remonter une erreur de connexion et le picker affiche le fournisseur en **error**.

Quand le serveur d'inférence tourne sur le même hôte Docker, le nom d'hôte joignable dépend d'où le serveur lui-même tourne. Un conteneur Ollama dans le même réseau compose est `http://ollama:11434`. Un serveur LM Studio ou vLLM qui tourne sur l'hôte (hors compose) est `http://host.docker.internal:1234` sur macOS et Windows, ou l'IP de bridge de l'hôte sous Linux. Lance un curl ponctuel depuis le conteneur `tale-platform` pour vérifier avant d'ouvrir l'UI :

```bash
docker compose exec platform curl -sf http://ollama:11434/api/tags
```

Une liste JSON des modèles téléchargés est le signal de succès. Une erreur connection-refused signifie que le nom d'hôte est faux ou que le serveur d'inférence n'écoute pas sur l'interface que le conteneur peut atteindre.

## Étape 2 — Enregistrer le fournisseur dans Tale

Un serveur joignable ne fait rien tant que Tale ne connaît pas l'URL et la forme de protocole qu'il parle. L'entrée du fournisseur dit à Tale où envoyer les requêtes et quel dialecte compatible OpenAI utiliser.

Ouvre **Paramètres > Fournisseurs** et clique **Ajouter un fournisseur**. Choisis le type de fournisseur qui correspond à ton serveur : **Ollama** pour un serveur Ollama, ou **Compatible OpenAI** pour LM Studio et vLLM (les deux exposent la forme `/v1` d'OpenAI). Remplis l'**URL de base** avec la valeur que tu as vérifiée à l'étape 1 ; laisse le champ clé d'API vide pour Ollama, mets-le à n'importe quelle chaîne pour LM Studio (le serveur l'ignore), mets-le à ton token configuré pour vLLM si tu as démarré le serveur avec `--api-key`.

Clique **Enregistrer**. Tale appelle immédiatement l'endpoint de liste de modèles du fournisseur ; la ligne passe au vert et le picker de modèles se remplit de ce que le serveur a rapporté.

## Étape 3 — Allowlister les modèles que tu veux appelables

Un fournisseur enregistré sans modèle allowlisté est invisible à chaque agent. L'allowlist est le contrat entre l'organisation et le fournisseur — choisir le modèle est la porte.

Dans la ligne du fournisseur, déplie le picker de modèles. Chaque modèle de la liste upstream affiche une case à cocher plus le tag que Tale a inféré (`chat`, `embedding`, `vision`). Coche les modèles que tu veux que les agents appellent ; un modèle tagué chat est ce à quoi un agent se lie par défaut. Clique **Enregistrer l'allowlist**.

Si tu veux que le modèle local soit le défaut à l'échelle de l'organisation pour les nouveaux chats, fais défiler en haut de la liste des fournisseurs et choisis-le sous **Modèle par défaut**. Les agents existants gardent leur liaison précédente ; les nouveaux atterrissent sur le modèle local à la requête suivante.

## Étape 4 — Vérifier avec un chat d'agent

La preuve que le câblage marche est une réponse de chat qui streame depuis le serveur local. Sans cette étape tu ne sais pas si le picker de modèles _a l'air_ juste seulement.

Ouvre ou crée un agent, règle son modèle sur un des modèles locaux que tu as allowlisté et démarre un chat avec un prompt court (`Réponds avec le seul mot "prêt"`). La réponse streame en tokens en quelques secondes ; la tool-call card du chat affiche le nom du modèle et le fournisseur que tu as enregistré.

Suis le log du serveur d'inférence sur l'hôte pendant que tu envoies le prompt — Ollama logge la ligne de requête, LM Studio imprime un résumé de requête, vLLM imprime la latence de génération. Voir la requête frapper le serveur local est la vérification que le trafic reste dans ton réseau et ne rebondit pas via une API externe.

## Dépannage

- **Symptôme :** la ligne du fournisseur affiche **error** avec `connection refused`. **Cause :** l'URL de base n'est pas joignable depuis le conteneur `tale-platform`. **Correction :** répète le `docker compose exec platform curl` de l'étape 1 ; ajuste le nom d'hôte (souvent `host.docker.internal` sur macOS/Windows, l'IP de bridge sous Linux).
- **Symptôme :** le picker de modèles est vide après **Enregistrer**. **Cause :** le serveur d'inférence est joignable mais aucun modèle n'est chargé. **Correction :** lance `ollama pull <model>` ou charge un modèle dans LM Studio / vLLM, puis clique **Rafraîchir les modèles** sur la ligne du fournisseur.
- **Symptôme :** la réponse du chat est un toast d'erreur (`model not found`). **Cause :** le nom du modèle auquel l'agent est lié ne correspond pas à l'identifiant upstream. **Correction :** ouvre le dropdown de modèle de l'agent et re-choisis depuis la liste vivante — les tags Ollama comme `:latest` comptent en upstream et doivent correspondre exactement.
- **Symptôme :** l'enregistrement du fournisseur est refusé parce que l'URL de base pointe vers `localhost`, `127.0.0.1` ou une IP privée. **Cause :** Tale bloque par défaut les hôtes de fournisseur privés et loopback, par sécurité contre le SSRF. **Correction :** utilise plutôt le nom d'hôte interne au réseau (`http://ollama:11434`, `http://host.docker.internal:1234`) ; si tu dois pointer vers une adresse privée ou loopback, définis `TALE_ALLOW_PRIVATE_PROVIDER_HOSTS=1` sur le service platform.

## Où cela s'inscrit

Un fournisseur local est la couture entre Tale et tes propres GPU — la même mécanique d'allowlist qu'un fournisseur cloud, mais aucun trafic ne quitte l'hôte. Les prochaines lectures naturelles sont [Fournisseurs](/fr/self-hosted/configuration/providers) pour l'équivalent en forme de fichier de ce que tu viens de faire dans l'UI, et [Durcissement](/fr/self-hosted/operate/security/hardening) pour les garanties d'allowlist egress qui empêchent un agent de retomber par accident sur un modèle cloud quand le local n'est pas joignable.
