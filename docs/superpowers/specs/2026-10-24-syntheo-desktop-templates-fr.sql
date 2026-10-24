-- Syntheo Desktop : templates FR
-- Destination dans le fork : crates/db-app/migrations/20261024120000_syntheo_templates_fr.sql
-- (horodatage postérieur à la dernière migration upstream : 20261013090000_recording_import_jobs.sql)
--
-- Format : celui d'Anarlog (table `templates`, sections_json = [{title, description}]).
-- Ces données sont injectées dans le prompt d'enhance par la macro Jinja
-- `template_numbered` (crates/template-app/assets/_macros.jinja) : un template
-- n'est pas lui-même un fichier Jinja, c'est la donnée que la macro numérote.
--
-- 1) Traduction FR des 17 templates par défaut d'Anarlog
--    (ids conservés : les références existantes et l'INSERT OR IGNORE upstream restent valides).
-- 2) Ajout des 4 templates Syntheo, épinglés en tête.
-- 1) Templates Anarlog traduits -----------------------------------------------
UPDATE
  templates
SET
  title = 'Conseil d''administration',
  description = 'Pour les conseils d''administration et les sujets de gouvernance',
  category = 'Direction',
  targets_json = '["Fondateur","PDG","Administrateur"]',
  sections_json = '[{"title":"Performance de l''entreprise","description":"Point financier et opérationnel"},{"title":"Initiatives stratégiques","description":"Avancement des priorités stratégiques"},{"title":"Revue financière","description":"Budget, trésorerie et santé financière"},{"title":"Décisions du conseil","description":"Résolutions et questions de gouvernance"},{"title":"Risques et conformité","description":"Gestion des risques et point conformité"},{"title":"Prochaines étapes","description":"Actions et suivis"}]'
WHERE
  id = 'default-board-meeting';
UPDATE
  templates
SET
  title = 'Séance de brainstorming',
  description = 'Pour les séances de créativité et d''idéation',
  category = 'Produit',
  targets_json = '["Chef de produit","Designer","Marketing"]',
  sections_json = '[{"title":"Objectif de la séance","description":"Quel problème ou quelle opportunité explore-t-on ?"},{"title":"Idées émises","description":"Toutes les idées recueillies pendant la séance"},{"title":"Pistes prometteuses","description":"Idées à approfondir"},{"title":"Critères d''évaluation","description":"Comment les idées seront évaluées"},{"title":"Prochaines étapes","description":"Actions pour avancer"}]'
WHERE
  id = 'default-brainstorming-session';
UPDATE
  templates
SET
  title = 'Lancement client',
  description = 'Pour démarrer une mission client et cadrer les attentes',
  category = 'Succès client',
  targets_json = '["Customer Success Manager","Responsable de compte","Responsable déploiement"]',
  sections_json = '[{"title":"Présentation du projet","description":"Périmètre, objectifs et livrables"},{"title":"Présentation des équipes","description":"Rôles et responsabilités"},{"title":"Calendrier et jalons","description":"Planning du projet et dates clés"},{"title":"Plan de communication","description":"Fréquence des réunions et des points d''étape"},{"title":"Critères de réussite","description":"Comment mesurer la réussite du projet"},{"title":"Prochaines étapes","description":"Actions immédiates"}]'
WHERE
  id = 'default-client-kickoff';
UPDATE
  templates
SET
  title = 'Entretien de découverte client',
  description = 'Pour les entretiens de découverte et la recherche utilisateur',
  category = 'Produit',
  targets_json = '["Chef de produit","Chercheur UX","Fondateur"]',
  sections_json = '[{"title":"Contexte","description":"Contexte et profil du client"},{"title":"Fonctionnement actuel","description":"Comment il résout le problème aujourd''hui"},{"title":"Points de douleur","description":"Difficultés et frustrations"},{"title":"Besoins et objectifs","description":"Ce qu''il cherche à accomplir"},{"title":"Retours sur la solution","description":"Réactions à la solution proposée"},{"title":"Enseignements clés","description":"Principaux constats et apprentissages"}]'
WHERE
  id = 'default-customer-discovery';
UPDATE
  templates
SET
  title = 'Daily standup',
  description = 'Pour un point quotidien rapide sur l''avancement et les blocages',
  category = 'Ingénierie',
  targets_json = '["Développeur","Engineering Manager","Scrum Master"]',
  sections_json = '[{"title":"Réalisé hier","description":"Qu''as-tu terminé hier ?"},{"title":"Prévu aujourd''hui","description":"Sur quoi travailles-tu aujourd''hui ?"},{"title":"Blocages","description":"Des obstacles ou un besoin d''aide ?"},{"title":"Infos d''équipe","description":"Annonces ou informations importantes"}]'
WHERE
  id = 'default-daily-standup';
UPDATE
  templates
SET
  title = 'Point direction',
  description = 'Pour consigner les échanges stratégiques et les décisions de direction',
  category = 'Direction',
  targets_json = '["Dirigeant","PDG","Directeur"]',
  sections_json = '[{"title":"Vue d''ensemble stratégique","description":"Contexte et objectifs de haut niveau"},{"title":"Indicateurs clés","description":"Indicateurs de performance et tendances"},{"title":"Décisions majeures","description":"Décisions stratégiques et leur justification"},{"title":"Allocation des ressources","description":"Engagements de budget et de ressources"},{"title":"Risques et opportunités","description":"Risques stratégiques et leviers de croissance"},{"title":"Actions","description":"Suivis au niveau de la direction"}]'
WHERE
  id = 'default-executive-briefing';
UPDATE
  templates
SET
  title = 'Post-mortem d''incident',
  description = 'Pour un post-mortem sans recherche de coupable après un incident ou une panne',
  category = 'Ingénierie',
  targets_json = '["Ingénieur plateforme","SRE","Ingénieur DevOps"]',
  sections_json = '[{"title":"Résumé de l''incident","description":"Ce qui s''est passé et quand"},{"title":"Chronologie","description":"Déroulé chronologique des événements"},{"title":"Analyse de la cause racine","description":"Ce qui a provoqué l''incident"},{"title":"Évaluation de l''impact","description":"Conséquences pour les utilisateurs et l''activité"},{"title":"Réponse et résolution","description":"Comment l''incident a été résolu"},{"title":"Enseignements","description":"Principaux enseignements"},{"title":"Actions","description":"Mesures préventives et améliorations"}]'
WHERE
  id = 'default-incident-postmortem';
UPDATE
  templates
SET
  title = 'Rendez-vous investisseur',
  description = 'Pour les présentations à des investisseurs et fonds',
  category = 'Levée de fonds',
  targets_json = '["Fondateur","PDG","Directeur financier"]',
  sections_json = '[{"title":"Contexte du rendez-vous","description":"Profil de l''investisseur et objet de la rencontre"},{"title":"Synthèse du pitch","description":"Points clés présentés"},{"title":"Questions posées","description":"Questions et réserves de l''investisseur"},{"title":"Retours reçus","description":"Réactions et retours de l''investisseur"},{"title":"Intérêt pour l''investissement","description":"Niveau d''intérêt et suite envisagée"},{"title":"Éléments à fournir","description":"Informations demandées et actions"}]'
WHERE
  id = 'default-investor-pitch';
UPDATE
  templates
SET
  title = 'Notes de cours',
  description = 'Pour prendre et organiser des notes de cours',
  category = 'Formation',
  targets_json = '["Étudiant","Doctorant","Chercheur"]',
  sections_json = '[{"title":"Informations sur le cours","description":"Matière, date et sujet"},{"title":"Notions clés","description":"Idées et théories principales abordées"},{"title":"Définitions importantes","description":"Termes et définitions à retenir"},{"title":"Exemples et applications","description":"Exemples et applications concrètes"},{"title":"Questions et points à éclaircir","description":"Points à approfondir"},{"title":"À faire","description":"Devoirs et prochaines étapes"}]'
WHERE
  id = 'default-lecture-notes';
UPDATE
  templates
SET
  title = 'Entretien individuel (1:1)',
  description = 'Pour des entretiens individuels structurés avec les membres de l''équipe',
  category = 'Management',
  targets_json = '["Manager","Engineering Manager","Chef d''équipe"]',
  sections_json = '[{"title":"Actualités","description":"Que s''est-il passé depuis la dernière fois ?"},{"title":"Réussites et difficultés","description":"Saluer les succès et discuter des obstacles"},{"title":"Objectifs et progrès","description":"Revoir les objectifs en cours et leur avancement"},{"title":"Feedback","description":"Échange de feedback dans les deux sens"},{"title":"Actions","description":"Prochaines étapes et engagements"}]'
WHERE
  id = 'default-one-on-one-meeting';
UPDATE
  templates
SET
  title = 'Entretien annuel',
  description = 'Pour les entretiens d''évaluation et les échanges sur l''évolution de carrière',
  category = 'Management',
  targets_json = '["Manager","Engineering Manager","RH"]',
  sections_json = '[{"title":"Bilan de la période","description":"Vue d''ensemble de la période évaluée"},{"title":"Réalisations clés","description":"Principales réussites et contributions"},{"title":"Points forts","description":"Compétences et comportements à conserver"},{"title":"Axes de progrès","description":"Opportunités de développement et améliorations"},{"title":"Objectifs de carrière","description":"Aspirations et parcours de développement"},{"title":"Plan d''action","description":"Objectifs de développement et prochaines étapes"}]'
WHERE
  id = 'default-performance-review';
UPDATE
  templates
SET
  title = 'Revue de roadmap produit',
  description = 'Pour revoir et aligner les priorités de la roadmap produit',
  category = 'Produit',
  targets_json = '["Chef de produit","Engineering Manager","Dirigeant"]',
  sections_json = '[{"title":"État des lieux","description":"Avancement des chantiers en cours"},{"title":"Fonctionnalités à venir","description":"Priorités et calendrier du prochain trimestre"},{"title":"Retours clients","description":"Enseignements clés des utilisateurs et clients"},{"title":"Indicateurs de succès","description":"KPI et méthode de mesure"},{"title":"Allocation des ressources","description":"Affectation des équipes et capacité"},{"title":"Décisions prises","description":"Décisions clés et arbitrages"}]'
WHERE
  id = 'default-product-roadmap-review';
UPDATE
  templates
SET
  title = 'Lancement de projet',
  description = 'Pour démarrer un projet avec des objectifs clairs et un alignement partagé',
  category = 'Produit',
  targets_json = '["Chef de produit","Engineering Manager","Designer"]',
  sections_json = '[{"title":"Présentation du projet","description":""},{"title":"Objectifs et indicateurs de succès","description":"Définir ce qu''est la réussite"},{"title":"Parties prenantes et rôles","description":""},{"title":"Calendrier et jalons","description":""},{"title":"Risques et dépendances","description":""},{"title":"Prochaines étapes","description":""}]'
WHERE
  id = 'default-project-kickoff';
UPDATE
  templates
SET
  title = 'Appel de découverte commerciale',
  description = 'Pour qualifier un prospect et comprendre ses besoins',
  category = 'Ventes',
  targets_json = '["Commercial grands comptes","Commercial","Business developer"]',
  sections_json = '[{"title":"Présentation de l''entreprise","description":"Contexte du prospect"},{"title":"Situation actuelle","description":"Son fonctionnement aujourd''hui"},{"title":"Enjeux et points de douleur","description":"Problèmes qu''il cherche à résoudre"},{"title":"Objectifs et critères de réussite","description":"Ce qu''est la réussite pour lui"},{"title":"Budget et calendrier","description":"Contraintes financières et de délai"},{"title":"Prochaines étapes","description":"Actions de suivi et calendrier"}]'
WHERE
  id = 'default-sales-discovery-call';
UPDATE
  templates
SET
  title = 'Planification de sprint',
  description = 'Pour planifier un sprint et fixer les objectifs de l''équipe',
  category = 'Ingénierie',
  targets_json = '["Engineering Manager","Chef de produit","Tech Lead"]',
  sections_json = '[{"title":"Objectif du sprint","description":"Quel est l''objectif principal de ce sprint ?"},{"title":"Backlog du sprint","description":"User stories et tâches engagées pour le sprint"},{"title":"Capacité et disponibilités","description":"Disponibilités de l''équipe et estimation de capacité"},{"title":"Dépendances et risques","description":"Dépendances externes et risques potentiels"},{"title":"Définition de « terminé »","description":"Critères d''acceptation et standards de complétion"}]'
WHERE
  id = 'default-sprint-planning';
UPDATE
  templates
SET
  title = 'Rétrospective de sprint',
  description = 'Pour prendre du recul sur le sprint et améliorer en continu les pratiques et la collaboration',
  category = 'Ingénierie',
  targets_json = '["Engineering Manager","Scrum Master","Tech Lead"]',
  sections_json = '[{"title":"Ce qui a bien marché","description":"Saluer les réussites et les résultats positifs"},{"title":"Ce qui n''a pas marché","description":"Identifier les difficultés et les problèmes"},{"title":"Ce que nous avons appris","description":"Enseignements et constats clés"},{"title":"Actions","description":"Mesures concrètes d''amélioration"}]'
WHERE
  id = 'default-sprint-retrospective';
UPDATE
  templates
SET
  title = 'Revue de conception technique',
  description = 'Pour revoir une conception technique et les choix d''architecture',
  category = 'Ingénierie',
  targets_json = '["Développeur","Tech Lead","Ingénieur plateforme"]',
  sections_json = '[{"title":"Énoncé du problème","description":"Quel problème résout-on ?"},{"title":"Solution proposée","description":"Approche technique et architecture"},{"title":"Alternatives étudiées","description":"Autres options et compromis"},{"title":"Plan de mise en œuvre","description":"Découpage du travail et calendrier"},{"title":"Stratégie de test","description":"Comment valider la solution"},{"title":"Risques et parades","description":"Problèmes potentiels et plans de repli"},{"title":"Décisions et actions","description":"Résultats et prochaines étapes"}]'
WHERE
  id = 'default-technical-design-review';
-- 2) Templates Syntheo (Markdown « # Titre + consigne » → sections_json) ------
-- Les emojis Syntheo deviennent des icônes Lucide aux couleurs Syntheo
-- (bleu #1a73e8, vert #0f9d58, orange #e37400, violet #a142f4).
INSERT
  OR IGNORE INTO templates (
    id,
    title,
    description,
    pinned,
    pin_order,
    category,
    targets_json,
    sections_json,
    icon_json
  )
VALUES
  (
    'syntheo-general',
    'Réunion générale',
    'Résumé standard : décisions et actions à suivre.',
    1,
    0,
    'Général',
    '[]',
    '[{"title":"Participants","description":"Liste les participants à la réunion avec leur rôle si mentionné."},{"title":"Décisions actées","description":"Résume les décisions importantes prises au cours de la réunion."},{"title":"Actions à suivre","description":"Liste les actions à réaliser, en précisant le responsable et le délai si mentionnés."},{"title":"Prochaine étape","description":"Décris la prochaine étape ou la date de la prochaine réunion."}]',
    '{"type":"icon","value":"file-text","color":"#1a73e8"}'
  ),
  (
    'syntheo-compliance',
    'Comité conformité / RGPD',
    'Axé risques, décisions réglementaires, points bloquants.',
    1,
    1,
    'Conformité',
    '[]',
    '[{"title":"Contexte","description":"Résume le contexte réglementaire ou le sujet de conformité abordé."},{"title":"Décisions actées","description":"Liste les décisions réglementaires ou techniques prises."},{"title":"Points bloquants avant production","description":"Dresse la liste des obstacles identifiés qui empêchent le passage en production."},{"title":"Risques résiduels","description":"Identifie les risques non encore traités et leur impact potentiel."},{"title":"Prochaine étape","description":"Décris les actions immédiates et la date de révision."}]',
    '{"type":"icon","value":"shield-check","color":"#0f9d58"}'
  ),
  (
    'syntheo-project',
    'Point projet / Sprint',
    'Avancement, blocages, prochaines échéances.',
    1,
    2,
    'Projet',
    '[]',
    '[{"title":"Avancement","description":"Résume les progrès réalisés depuis le dernier point."},{"title":"Blocages","description":"Liste les obstacles actuels avec leur impact sur le planning."},{"title":"Prochaines étapes","description":"Liste les tâches prioritaires et les échéances."}]',
    '{"type":"icon","value":"kanban","color":"#e37400"}'
  ),
  (
    'syntheo-standup',
    'Standup équipe',
    'Format court : fait, en cours, bloquants.',
    1,
    3,
    'Projet',
    '[]',
    '[{"title":"Fait","description":"Pour chaque intervenant, résume ce qui a été accompli depuis le dernier standup."},{"title":"En cours","description":"Pour chaque intervenant, liste les tâches en cours du jour."},{"title":"Bloquants","description":"Liste les blocages signalés et leur impact."}]',
    '{"type":"icon","value":"zap","color":"#a142f4"}'
  );
