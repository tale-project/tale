---
title: Fournisseurs IA
description: Paramètres > Fournisseurs est l'endroit où les Administrateurs branchent OpenAI, Anthropic, Azure OpenAI et un Ollama local, choisissent quels modèles chacun expose, et fixent le défaut de l'org. Chaque réponse que Tale stream vient d'un modèle résolu par cette page.
---

Paramètres > Fournisseurs est la surface où Tale rencontre les LLM qu'il sert. Les Administrateurs branchent les fournisseurs que l'org veut utiliser — OpenAI, Anthropic, Azure OpenAI, ou un Ollama local — choisissent lesquels des modèles de chaque fournisseur l'org peut appeler, et fixent le modèle par défaut pour les nouveaux chats et nouveaux agents. Chaque réponse que Tale stream est routée par cette page ; y toucher change ce que le reste du produit peut faire.

Cette page couvre l'UI : comment ajouter un fournisseur, ce que contrôle l'allowlist de modèles, comment se résout le défaut, et comment retirer un fournisseur sans casser les chats existants. Le catalogue de fournisseurs lui-même et la forme plus profonde du fichier de configuration de la même surface vivent un onglet plus loin sous [Modèles](/fr/platform/models) pour le catalogue et l'onglet configuration self-hosted pour la forme fichier.

## Ce que la liste montre

Ouvre **Paramètres > Fournisseurs** et tu atterris sur la liste des fournisseurs que l'org a branchés. Chaque ligne nomme le fournisseur, montre son statut d'identifiants (connecté, erreur, non testé), le nombre de modèles que le fournisseur expose, et le nombre de ceux que l'org a allowlistés. Une erreur de connexion fait remonter le message amont à côté de la ligne — généralement une mauvaise clé ou un périmètre manquant.

La ligne se déplie vers le picker de modèles du fournisseur. Tale récupère la liste complète des modèles du fournisseur à la vérification des identifiants ; le picker montre cette liste avec une case à cocher à côté de chaque modèle, plus un tag par modèle (chat, image, embedding, audio) qui pilote où le modèle peut être utilisé en aval.

## Ajouter un fournisseur

Clique sur **Ajouter un fournisseur** et choisis le type de fournisseur. Chaque type demande l'identifiant qu'il faut :

- **OpenAI** — clé API depuis `platform.openai.com`. La clé hérite du quota et des limites de débit du compte OpenAI.
- **Anthropic** — clé API depuis `console.anthropic.com`. Même forme qu'OpenAI.
- **Azure OpenAI** — URL d'endpoint plus une clé ; Tale résout les modèles contre le déploiement Azure, pas le nom de modèle OpenAI.
- **Ollama** — URL de base du serveur Ollama (typiquement `http://ollama:11434` dans le réseau Tale). Pas de clé ; l'accessibilité est l'auth.

Une fois l'identifiant déposé, Tale appelle l'endpoint de liste de modèles du fournisseur, fait remonter chaque modèle trouvé, et attend que tu choisisses l'allowlist avant qu'aucun agent puisse les appeler. Enregistrer une allowlist vide est autorisé, mais aucun modèle de ce fournisseur n'est appelable jusqu'à ce que tu en allowlistes au moins un.

## L'allowlist et les tags par modèle

L'allowlist est le contrat que l'org passe avec elle-même sur les modèles que ses agents peuvent utiliser. Un modèle qui n'est pas dans l'allowlist n'apparaît dans aucun picker, même si le fournisseur amont l'expose. Ajoute des modèles quand tu fais confiance au prix du fournisseur pour eux ; retire des modèles quand tu ne les veux plus appelables.

Chaque modèle porte un ou plusieurs tags assignés par Tale à la récupération en se basant sur les métadonnées du fournisseur : `chat` (texte entrant, texte sortant), `image` (texte entrant, image sortante), `embedding` (texte entrant, vecteur sortant), `audio` (audio entrant ou sortant). Les agents se lient à des modèles tagués chat ; la famille de tools de génération d'images utilise des modèles tagués image ; l'indexation de documents utilise des modèles tagués embedding. Retirer le seul modèle allowlisté d'une classe de tag casse les fonctionnalités qui en dépendent ; la ligne avertit quand tu es sur le point de le faire.

## Le défaut de l'org

Le défaut de l'org est le modèle que les nouveaux chats et nouveaux agents prennent quand aucun autre n'est nommé. Fixe-le depuis la ligne **Modèle par défaut** en haut de la liste des fournisseurs. Changer le défaut n'affecte que les nouveaux objets — les chats et agents existants gardent le modèle auquel ils étaient liés. Va vers le défaut quand tu déroules une nouvelle génération de modèle à l'échelle de l'org sans rééditer chaque agent.

## Retirer un fournisseur

Clique la ligne, puis **Déconnecter**. Un fournisseur déconnecté arrête d'apparaître dans les pickers ; les agents liés à un de ses modèles font remonter une erreur de configuration et basculent sur le défaut de l'org si l'agent a le fallback activé. La ligne reste dans la liste avec un badge déconnecté pour la piste d'audit. Déconnecter est réversible — cliquer sur **Reconnecter** repart le flux d'identifiants — mais l'allowlist par modèle doit être recoché car la liste de modèles sous-jacente peut avoir bougé en amont.

## Où cela s'inscrit

Les fournisseurs sont le bas de la pile — chaque agent, chaque chat, chaque étape de workflow qui produit du texte se résout à travers eux. La lecture suivante naturelle est [Modèles](/fr/platform/models) pour le catalogue de ce que chaque fournisseur ship actuellement et quels tags ils portent, et [Concepts agents](/fr/platform/agents/concepts) pour comment le bouton modèle s'inscrit dans le modèle à quatre boutons à partir duquel un agent est construit.
