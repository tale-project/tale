---
title: Sortie vocale
description: Fais lire les réponses de l'assistant à voix haute au fil du streaming — avec surcharges par conversation et un fournisseur de synthèse vocale configuré.
---

La sortie vocale lit à voix haute les réponses de l'assistant pendant qu'elles streament. Chaque phrase est synthétisée dès qu'elle apparaît : la lecture commence une à deux secondes après les premiers mots — tu n'attends pas la fin de la réponse.

## Activer

La sortie vocale est désactivée par défaut. Tu la contrôles à deux endroits :

- **Bouton par conversation.** Ouvre le menu `…` de l'en-tête du chat et bascule **Sortie vocale pour cette conversation**. La ligne est un simple interrupteur et n'apparaît que si la valeur par défaut globale est activée. Désactiver coupe cette conversation ; activer la fait lire même quand la valeur par défaut est désactivée.
- **Valeur par défaut globale.** Dans **Paramètres → Personnalisation → Sortie vocale**, active la valeur par défaut. Les nouvelles conversations liront alors les réponses jusqu'à ce que tu surcharges depuis le menu `…` de l'en-tête.

La première fois que tu actives la sortie vocale dans une session, le clic débloque aussi le système audio du navigateur. Sans ce geste, Safari mobile et les builds Chromium plus stricts refusent de lire automatiquement l'audio synthétisé, et l'indicateur sur chaque message affichera « Lecture vocale bloquée — touche pour lire » jusqu'à ce que tu touches.

## Ce qui est lu

La sortie vocale narre les réponses de l'assistant dans la langue de ton interface. Elle retire les décorations markdown (gras, italique, titres, syntaxe de lien) et ignore les blocs de code, pour que tu n'entendes pas « astérisque astérisque bonjour astérisque astérisque » ou un script Python lu à voix haute. La ponctuation, les nombres et les abréviations restent intacts.

## Quand aucun fournisseur n'est configuré

La sortie vocale utilise un fournisseur de synthèse vocale côté serveur — il n'y a pas de repli sur la `speechSynthesis` du navigateur. Si ton organisation n'a pas configuré de modèle TTS, le bouton de personnalisation est désactivé et le lien renvoie vers **Paramètres → Fournisseurs IA**, où une personne admin peut en ajouter un. Voir [Configurer un fournisseur de synthèse vocale](/fr/self-hosted/configuration/providers#openai) pour la forme de la configuration.

Quand la synthèse échoue sur une phrase précise (5xx fournisseur, timeout passager, etc.), cette phrase est ignorée silencieusement et la lecture continue avec la suivante. Le texte de la réponse à l'écran reste lisible dans tous les cas.

## Arrêter et relire

Pendant la lecture d'un message, un bouton d'arrêt apparaît dans sa barre d'outils. L'arrêt met en pause immédiatement ; un nouveau message de l'assistant qui arrive plus tard est tout de même lu automatiquement (le bouton reste actif jusqu'à ce que tu le désactives).

Si tu changes de conversation en cours de lecture, l'audio s'arrête proprement. Les messages précédents de l'assistant ne sont **pas** rejoués automatiquement à ton retour — tu entendrais le même contenu deux fois. Utilise le bouton lecture sur l'indicateur pour relire un message manuellement.

## À quoi ressemblent les erreurs

| État de l'indicateur                     | Signification                                                                                                                                                                      |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Haut-parleur animé                       | Lecture en cours.                                                                                                                                                                  |
| Spinner de chargement                    | Synthèse en cours ; aucun audio encore prêt.                                                                                                                                       |
| Icône d'arrêt                            | Audio lisible ; lecture en cours.                                                                                                                                                  |
| Haut-parleur simple                      | Audio prêt ou terminé ; touche pour (re)lire.                                                                                                                                      |
| Haut-parleur ambré, « Touche pour lire » | Le navigateur a bloqué la lecture automatique. Touche l'indicateur pour démarrer.                                                                                                  |
| Icône d'alerte rouge, « … a échoué »     | La synthèse a échoué à chaque nouvelle tentative. Survole pour la raison classifiée (pas de fournisseur, limite de débit, budget atteint, panne passagère). Clique pour réessayer. |

Les erreurs de limite de débit et de contention du rate-limiter sont réessayées automatiquement jusqu'à deux fois avec un backoff exponentiel. Les 5xx fournisseur, timeouts, et autres erreurs (pas de fournisseur configuré, identifiants invalides, budget dépassé) ne sont pas réessayés automatiquement ; l'indicateur les expose via une infobulle, et tu touches pour réessayer. Le texte de la réponse reste lisible à l'écran.

## Coût et quota

Chaque caractère synthétisé est facturé par le fournisseur configuré. La politique de budget de Tale s'applique à la sortie vocale comme au chat : la synthèse est bloquée dès que le plafond de coût ou de requêtes par période est atteint. La plateforme applique également des limites de débit par utilisateur et par organisation sur le TTS pour qu'un usage scripté abusif ne puisse pas épuiser un quota fournisseur.

L'audio est mis en cache dans le stockage Convex pendant environ sept jours : rejouer un message récent ne refacture pas. Au-delà, la ligne et le blob sont supprimés par un balayage quotidien en arrière-plan (complété par un nettoyage opportuniste par conversation côté écriture) ; la lecture suivante synthétise à nouveau.

## Accessibilité

L'indicateur annonce son état via une région live screen-reader (« Lecture en cours », « Arrêté », « Échec de la sortie vocale »). Les animations respectent `prefers-reduced-motion` — la pulsation de lecture comme le spinner de chargement deviennent statiques quand les animations réduites sont actives. L'interrupteur par conversation dans le menu `…` utilise la sémantique standard `role="menuitemcheckbox"` + `aria-checked`, donc les lecteurs d'écran annoncent l'état actif/inactif avec le menu.

Si tu utilises un lecteur d'écran, tu préféreras peut-être laisser la sortie vocale désactivée — le lecteur d'écran et la voix de l'assistant liraient le même texte et se superposeraient.
