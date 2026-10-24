# Politique de sécurité

## Versions maintenues

Seule la dernière release reçoit des correctifs de sécurité.

## Signaler une vulnérabilité

N'ouvrez pas d'issue publique. Utilisez
[GitHub Security Advisories](https://github.com/WillIsback/syntheo-desktop/security/advisories/new)
en décrivant le problème, son impact et un moyen de le reproduire.

## Périmètre

Syntheo Desktop ne communique qu'avec les endpoints d'inférence configurés par
l'utilisateur et ne conserve jamais l'audio. Toute communication réseau vers un
autre hôte, ou toute écriture d'audio sur disque, est considérée comme une
vulnérabilité.
