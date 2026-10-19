# Direction visuelle — UptimePulse

## Direction retenue : Signal clair

UptimePulse est un cockpit d’observabilité pour des personnes qui doivent comprendre l’état de leurs sites en quelques secondes. L’interface doit ressembler à une console fiable et calme, pas à un tableau de bord décoratif.

- **Mouvement :** opérateur moderne, signalétique fonctionnelle, contraste maîtrisé.
- **Principes :** hiérarchie nette, densité utile, état lisible sans dépendre de la couleur, actions réversibles clairement séparées des actions destructives.
- **Philosophie couleur :** bleu nuit et graphite pour le cadre ; cyan pour l’activité et les liens ; vert pour UP ; ambre pour UNKNOWN/suspect ; rouge pour DOWN ; les couleurs sont toujours accompagnées d’un libellé et/ou d’une icône.
- **Paradigme de mise en page :** navigation latérale compacte, header de contexte, cartes KPI en bandeau, contenu principal en tableau et panneaux de détail.
- **Éléments signature :** petit symbole d’impulsion dans le logo, ligne de statut continue, badges monospace pour codes HTTP et classifications, micro-animations de chargement discrètes.
- **Interaction :** feedback immédiat pour pause/reprise et filtres ; confirmation explicite pour suppression ; erreurs directement au niveau du champ ; états vides pédagogiques.
- **Animation :** transitions courtes et non essentielles ; respect de `prefers-reduced-motion`.
- **Typographie :** une sans-serif lisible pour l’interface, une monospace pour les URLs, codes et mesures ; titres compacts, chiffres KPI plus grands mais sobres.
- **Essence de marque :** « savoir avant que les utilisateurs ne le signalent ».
- **Voix :** factuelle, rassurante, directe, sans jargon inutile.
- **Logo/favicon :** symbole abstrait de pulse formé de deux ou trois formes pleines, silhouette simple, fond carré plein bleu nuit, sans texte intégré ni effets.
- **Couleur signature :** cyan `#54D6FF` sur fond `#0B1220`.

## Contraintes d’implémentation

Le dashboard est fonctionnel et ne nécessite pas d’illustration héroïque. Le seul asset visuel généré en fondation est le logo carré opaque, utilisé par l’identité du projet et comme favicon. Les composants doivent rester accessibles sur mobile et ne pas confondre état « suspect » et incident confirmé.
