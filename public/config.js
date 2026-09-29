/* =====================================================================
   THE LAST VIBE — Configuration client
   En web, vide = même origine que le serveur (http://localhost:3000…).
   En build Capacitor (APK/IPA), pointer vers l'API déployée :
     window.TLV_API_BASE = 'https://the-last-vibe.example.com'
   (les liens de partage /og et /c utilisent aussi cette origine)
===================================================================== */
window.TLV_API_BASE = window.TLV_API_BASE || '';