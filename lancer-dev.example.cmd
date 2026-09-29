@echo off
rem ============================================================
rem  THE LAST VIBE - lancement du serveur de dev
rem  Colle tes secrets ci-dessous (aucun n'est obligatoire :
rem  seuls les fournisseurs remplis auront un bouton de login).
rem ============================================================
set PORT=3111

rem --- GitHub : https://github.com/settings/developers (New OAuth App) ---
set GITHUB_CLIENT_ID=
set GITHUB_CLIENT_SECRET=

rem --- Discord : https://discord.com/developers/applications (OAuth2) ---
set DISCORD_CLIENT_ID=
set DISCORD_CLIENT_SECRET=

rem --- Google : console.cloud.google.com - Credentials - OAuth client ID ---
set GOOGLE_CLIENT_ID=
set GOOGLE_CLIENT_SECRET=

rem --- Recommande : change cette phrase en un texte aleatoire long ---
set SESSION_SECRET=the-last-vibe-a-changer-avant-la-prod

rem --- Bouton "compte de test" : 1 actif, 0 desactive ---
set DEV_LOGIN=1

cd /d "%~dp0"
node server.js
