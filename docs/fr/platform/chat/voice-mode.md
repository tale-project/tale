---
title: Mode vocal
description: Dicte un message, vérifie sa transcription avant l’envoi et écoute les réponses lorsque la sortie vocale est disponible.
---

La dictée permet de parler au lieu de taper un message. La sortie vocale lit une réponse de l’assistant à voix haute. Tu peux utiliser chacune séparément : dicter n’impose pas une réponse parlée et écouter ne nécessite pas l’accès au microphone.

## Dicter et vérifier un message

1. Clique sur **Démarrer la dictée** sur le microphone du champ de message.
2. Autorise le microphone dans le navigateur si nécessaire, puis parle clairement.
3. Clique sur **Arrêter la dictée**. Si la transcription passe par le serveur, attends qu’elle se termine.
4. Relis et corrige le texte, surtout les noms, nombres et dates. Envoie-le lorsqu’il est prêt.

La dictée ajoute du texte au champ de saisie ; elle n’envoie pas automatiquement le message. L’envoi arrête une dictée en cours. Le modèle de chat reçoit le texte que tu soumets.

Tale utilise d’abord la reconnaissance vocale du navigateur lorsqu’elle est disponible. Sinon, il peut enregistrer et transcrire via le modèle configuré par l’organisation. Si aucun parcours n’est disponible, le microphone est absent ou explique la configuration manquante. La reconnaissance du navigateur peut utiliser un service de son fournisseur : ne suppose pas qu’elle fonctionne hors ligne.

Le parcours serveur exige la prise en charge de l’enregistrement par MediaRecorder dans le navigateur, l’autorisation du microphone et un modèle de transcription disponible dans l’organisation. Un admin choisit le **Modèle de transcription audio** sous [Paramètres > Gouvernance > Modèles](/fr/platform/admin/governance/content-models). Ce réglage sert aussi aux pièces jointes audio et vidéo. Il ne modifie pas le service de reconnaissance du navigateur : la dictée du navigateur reste utilisable lorsqu’elle est prise en charge, même si le modèle serveur de l’organisation est indisponible.

## Écouter une réponse

Active **Mode vocal** dans le champ de message pour écouter les réponses du chat courant. Un modèle de synthèse vocale prépare l’audio à partir de la réponse. Utilise la commande de lecture de la réponse pour arrêter ou réécouter. Le texte reste disponible pour vérifier les détails.

Une politique de l’organisation peut masquer la sortie vocale. Une commande désactivée peut aussi signaler l’absence de modèle vocal utilisable. Un administrateur vérifie les [fournisseurs d’IA](/fr/platform/admin/providers). Changer seulement le modèle de chat ne configure pas un fournisseur vocal.

Le réglage dans un chat existant s’applique à ce chat. Sur un nouveau chat, il définit aussi la valeur par défaut des conversations suivantes. Il n’y a pas de voix distincte à configurer pour chaque agent de projet.

## Résoudre un problème vocal

| Symptôme | Points à vérifier |
| --- | --- |
| Le microphone ne démarre pas | Permission du navigateur, périphérique d’entrée sélectionné et éventuelle utilisation par une autre app. |
| Des mots manquent ou sont incorrects | Réduire le bruit ambiant et corriger le texte avant l’envoi. |
| La transcription serveur échoue | Réessayer tant que l’enregistrement reste disponible, ou le supprimer et taper le message. |
| La réponse est prête mais silencieuse | Vérifier le volume et l’autorisation de lecture du navigateur, puis lancer la lecture de la réponse. |
| Une erreur de configuration apparaît | Demander à un administrateur de vérifier le modèle vocal et ses identifiants. |

Après un échec de transcription serveur, l’enregistrement reste dans la mémoire de la page pour une relance. Quitter ou recharger la page peut le perdre. Ce n’est pas une pièce jointe audio enregistrée. Utilise les [pièces jointes](/fr/platform/chat/attachments) pour importer un enregistrement existant.

## Comprendre le parcours de l’audio

La dictée du navigateur suit son propre service de reconnaissance. Le parcours serveur transmet l’enregistrement à Tale pour une transcription avec le fournisseur de l’organisation. Ce parcours de dictée ne le stocke pas comme document. Une fois envoyé, le texte transcrit rejoint l’historique du chat.

La sortie vocale transmet le texte de la réponse au fournisseur configuré et diffuse l’audio pour la lecture. Si la réponse contient des informations issues d’une source restreinte, elles font aussi partie de cette demande vocale. Les administrateurs doivent choisir des services compatibles avec les [exigences de résidence des données](/fr/cloud/data-residency) de l’organisation.
