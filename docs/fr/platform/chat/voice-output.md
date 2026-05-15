---
title: Sortie vocale
description: Fais lire les réponses de l'assistant à voix haute au fil du streaming — avec surcharges par conversation et repli sur la synthèse intégrée au navigateur.
---

La sortie vocale lit à voix haute les réponses de l'assistant pendant qu'elles streament. Chaque phrase est synthétisée dès qu'elle apparaît : la lecture commence une à deux secondes après les premiers mots — tu n'attends pas la fin de la réponse.

## Activer

La sortie vocale est désactivée par défaut. Tu la contrôles à deux endroits :

- **Bouton par conversation.** Une icône haut-parleur à côté du sélecteur de modèle dans l'en-tête du chat. Le clic enchaîne trois états : _suivre la valeur par défaut_ (ta préférence globale), _explicitement activée_ (cette conversation uniquement) et _explicitement désactivée_ (cette conversation uniquement).
- **Valeur par défaut globale.** Dans **Paramètres → Personnalisation → Sortie vocale**, active la valeur par défaut. Les nouvelles conversations liront alors les réponses jusqu'à ce que tu surcharges depuis l'en-tête.

La première fois que tu actives la sortie vocale dans une session, le clic débloque aussi le système audio du navigateur. Sans ce geste, Safari mobile et les builds Chromium plus stricts refusent de lire automatiquement l'audio synthétisé, et l'indicateur sur chaque message affichera « Lecture vocale bloquée — touche pour lire » jusqu'à ce que tu touches.

## Ce qui est lu

La sortie vocale narre les réponses de l'assistant dans la langue de ton interface. Elle retire les décorations markdown (gras, italique, titres, syntaxe de lien) et ignore les blocs de code, pour que tu n'entendes pas « astérisque astérisque bonjour astérisque astérisque » ou un script Python lu à voix haute. La ponctuation, les nombres et les abréviations restent intacts.

## Fournisseur vs. repli navigateur

La sortie vocale préfère un fournisseur de synthèse vocale côté serveur, pour la qualité et la cohérence. Si ton organisation n'en a pas configuré — ou si la synthèse échoue — Tale bascule automatiquement sur la `speechSynthesis` intégrée au navigateur pour cette phrase. Le repli est par chunk : une erreur passagère ou un problème de codec sur une phrase ne casse pas le reste de la réponse.

Quand aucun fournisseur n'est configuré, la page Personnalisation affiche un lien vers **Paramètres → Fournisseurs d'IA**, où une personne admin peut en ajouter un. Voir [Configurer un fournisseur de synthèse vocale](/fr/self-hosted/configuration/providers#openai) pour la forme de la configuration.

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

Les erreurs passagères (limite de débit, 5xx bref, timeout) sont réessayées automatiquement jusqu'à deux fois avec un backoff exponentiel. Les erreurs terminales (pas de fournisseur configuré, identifiants invalides, budget dépassé) ne sont pas réessayées ; l'indicateur les expose via une infobulle, et le texte de la réponse reste lisible à l'écran.

## Coût et quota

Chaque caractère synthétisé est facturé par le fournisseur configuré. La politique de budget de Tale s'applique à la sortie vocale comme au chat : la synthèse est bloquée dès que le plafond de coût ou de requêtes par période est atteint. La plateforme applique également des limites de débit par utilisateur et par organisation sur le TTS pour qu'un usage scripté abusif ne puisse pas épuiser un quota fournisseur.

L'audio est mis en cache dans le stockage Convex pendant environ sept jours : rejouer un message récent ne refacture pas. Au-delà, la ligne et le blob sont supprimés par le nettoyage paresseux ; la lecture suivante synthétise à nouveau.

## Accessibilité

L'indicateur annonce son état via une région live screen-reader (« Lecture en cours », « Arrêté », « Échec de la sortie vocale »). Les animations respectent `prefers-reduced-motion` — la pulsation de lecture comme le spinner de chargement deviennent statiques quand les animations réduites sont actives. Le bouton utilise `aria-pressed="mixed"` pour l'état « suivre la valeur par défaut » afin que les technologies d'assistance distinguent les trois positions.

Si tu utilises un lecteur d'écran, tu préféreras peut-être laisser la sortie vocale désactivée — le lecteur d'écran et la voix de l'assistant liraient le même texte et se superposeraient.
