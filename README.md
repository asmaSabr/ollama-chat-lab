# Ollama Chat Lab

Interface de chat web sur un modèle local Ollama, avec un proxy Node.js/Express (streaming NDJSON, Stop, raisonnement, rate limit, token, rendu Markdown assaini).


## Lancer le projet

1. Installer Ollama, puis télécharger le modèle : `ollama pull gemma4:e4b`
2. Installer les dépendances : `npm install`
3. Lancer le serveur : `API_TOKEN=mon-token node server.js`
4. Ouvrir http://localhost:3000 et saisir le token
