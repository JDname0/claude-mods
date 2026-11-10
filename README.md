# Indicateurs — panneau de suivi pour Claude Code

Un panneau affiché à côté du chat, dans chaque session et pour n'importe quel projet :

- **Environnement** : cloud ou local, dossier, branche git, dépôt, appareils qui suivent la session (Remote Control), modèle, nombre de messages, durée
- **Contexte** : % utilisé, barre colorée, détail par catégorie (Messages, outils système, outils MCP, prompt système, skills, mémoire, autocompact, espace libre, outils différés…), nombre d'outils MCP, de fichiers mémoire, d'agents et de skills
- **Limites d'usage** : fenêtres 5 h et 7 jours avec l'heure de remise à zéro, coût de la session
- **Connecteurs** : connectés / à connecter / bloqués
- **Activité** : nombre d'actions et outils les plus utilisés
- **Résultats** : fichiers créés ou modifiés par Claude pendant la session
- **Modifications** : fichiers modifiés, lignes ajoutées et supprimées, commits pas encore poussés, dernier commit
- Alerte quand le contexte dépasse 70 %, bouton **Compacter** (comme `/compact`)
- Bouton **Actualiser**, et commande `/indicateurs` pour rouvrir le panneau

## Installation

À l'invite d'une session Claude Code dans un terminal :

```
/plugin install indicateurs --marketplace JDname0/claude-mods
```

Réponds `y` pour ajouter la marketplace, puis choisis la portée **user** (Entrée) pour l'avoir dans tous tes projets.

Depuis un shell :

```
claude plugin install indicateurs --marketplace JDname0/claude-mods
```

Dans l'app desktop, où `/plugin` ne marche pas : clique sur **+** à côté de la zone de saisie, puis **Plugins**, **Add marketplace** avec `JDname0/claude-mods`, puis **Add plugin**.

Le dépôt est privé : la machine doit déjà avoir un accès git à github.com (clé SSH, ou `gh auth login` puis `gh auth setup-git`).
