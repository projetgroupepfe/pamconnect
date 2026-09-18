-- ============================================================
-- PamConnect - Schema de la base de donnees (SQLite)
-- ============================================================
-- Ce fichier decrit la STRUCTURE de la base : les tables, leurs
-- colonnes, et les regles que la base fera respecter elle-meme.
--
-- Trois tables, deux relations :
--     utilisateurs 1 ---- N annonces        (un employeur publie N annonces)
--     annonces     1 ---- N candidatures    (une annonce recoit N candidatures)
--     utilisateurs 1 ---- N candidatures    (un prestataire envoie N candidatures)
-- ============================================================

-- SQLite ne fait PAS respecter les cles etrangeres par defaut.
-- Cette ligne doit etre executee a chaque ouverture de la base.
PRAGMA foreign_keys = ON;


-- ------------------------------------------------------------
-- Table utilisateurs : employeurs et prestataires
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS utilisateurs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,

  -- CHECK : la base refuse tout autre role que ces deux-la.
  role            TEXT    NOT NULL CHECK (role IN ('employeur', 'prestataire')),

  nom             TEXT    NOT NULL,

  -- UNIQUE : deux comptes ne peuvent plus avoir le meme email.
  -- C'est la base elle-meme qui l'interdit, pas seulement notre code.
  email           TEXT    NOT NULL UNIQUE,

  motdepasse      TEXT    NOT NULL,

  -- Le numero qui permet a l'equipe d'appeler. Neuf chiffres, sans
  -- espaces ni indicatif : deux ecritures du meme numero feraient sinon
  -- deux numeros differents.
  --
  -- IL N'APPARAIT SUR AUCUNE FICHE PUBLIQUE : seule l'equipe le voit, et
  -- c'est par lui qu'elle met un employeur et un prestataire en relation.
  telephone       TEXT,

  arrondissement  TEXT,
  quartier        TEXT,

  -- Renseignes uniquement pour les prestataires.
  metier          TEXT,
  tarif           INTEGER,

  -- --- Ce qui permet a un employeur de se decider ---

  -- La date complete est CONSERVEE mais n'est JAMAIS affichee : les
  -- ecrans ne montrent qu'une tranche ("25 - 34 ans"). Une date de
  -- naissance complete, associee a un nom et a un quartier, suffit a
  -- identifier quelqu'un - c'est une donnee qu'on ne diffuse pas.
  date_naissance  TEXT,

  -- Depuis combien d'annees la personne exerce ce metier.
  experience_annees INTEGER,

  -- Les moments ou la personne peut travailler, sous forme de liste :
  --   lundi-matin|lundi-apresmidi|samedi-matin
  --
  -- Ce n'est pas du texte libre : chaque valeur vient d'une liste fermee
  -- de 7 jours x 3 moments, verifiee par le serveur. Une seule colonne
  -- suffit parce qu'on lit toujours la liste entiere, jamais un creneau
  -- isole - exactement comme les synonymes des metiers.
  disponibilites  TEXT,

  -- Position GPS, renseignee si l'utilisateur a accepte la geolocalisation.
  latitude        REAL,
  longitude       REAL,

  -- --- Verification d'identite (prestataires) ---
  -- Les documents eux-memes ne sont PAS en base : seuls leurs noms de
  -- fichier y figurent, le temps de la verification. Ils sont effaces
  -- du disque des que le dossier est valide (principe de minimisation).
  statut_verification TEXT NOT NULL DEFAULT 'non soumis'
                      CHECK (statut_verification IN ('non soumis', 'en attente', 'verifie', 'refuse')),
  cni_fichier     TEXT,
  casier_fichier  TEXT,

  -- --- Photo du visage ---
  -- Envoyee avec les documents, et comparee a la piece d'identite par
  -- l'equipe : on sait alors que celui qui envoie la piece en est le
  -- titulaire. A la decision, les documents sont effaces, mais la photo
  -- acceptee est GARDEE : elle sert a chaque service, pour se reconnaitre
  -- a la porte. Elle n'est jamais publique.
  --
  -- photo_envoyee_fichier : la photo en cours de controle.
  -- photo_fichier         : la photo acceptee.
  photo_envoyee_fichier TEXT,
  photo_fichier   TEXT,

  -- Changer de photo, une fois verifie : la piece d'identite a ete
  -- supprimee apres la verification, elle est donc renvoyee avec la
  -- nouvelle photo, puis supprimee a la decision de l'equipe.
  photo_piece_fichier TEXT,
  photo_envoyee_le    TEXT,
  photo_motif_refus   TEXT,
  -- Quand les documents ont ete envoyes. Sans cette date, le delai de
  -- 24 h annonce aux deux cotes ne serait qu'une phrase : rien ne
  -- permettrait de dire si l'equipe le tient.
  --
  -- Elle reste NULL pour les dossiers deposes avant l'existence de cette
  -- colonne. Les ecrans le disent plutot que d'afficher une date fausse.
  documents_envoyes_le TEXT,
  verifie_le      TEXT,
  motif_refus     TEXT,

  -- Membre de l'equipe projet, autorise a valider les dossiers.
  est_admin       INTEGER NOT NULL DEFAULT 0 CHECK (est_admin IN (0, 1)),

  -- --- Suspension ---
  -- Un compte suspendu ne peut plus se connecter. On ne SUPPRIME pas le
  -- compte : les annonces, les candidatures et les messages doivent
  -- rester consultables en cas de litige, et une suppression effacerait
  -- la preuve de ce qui a justifie la sanction.
  suspendu        INTEGER NOT NULL DEFAULT 0 CHECK (suspendu IN (0, 1)),
  suspendu_le     TEXT,
  suspendu_motif  TEXT,

  -- Un avertissement se situe entre le classement sans suite et la
  -- suspension. Le compte continue de fonctionner, mais la personne lit
  -- ce que l'equipe lui reproche la prochaine fois qu'elle ouvre son
  -- profil, et ne peut pas le faire disparaitre sans l'avoir vu.
  --
  -- Le COMPTEUR est garde separement du dernier motif : au signalement
  -- suivant, l'equipe doit savoir si cette personne en est a son premier
  -- ecart ou a son troisieme.
  -- Un message de l'equipe n'est PAS une sanction : aucun compteur,
  -- aucune consequence. Elle s'en sert pour poser une question - le plus
  -- souvent avant de trancher un desaccord sur de l'argent.
  --
  -- Un seul message a la fois : le suivant remplace le precedent. Garder
  -- un historique demanderait une table, un ecran, et n'apporterait rien
  -- ici - ce qui compte est ce qui attend une reponse maintenant.
  message_equipe      TEXT,
  message_equipe_le   TEXT,
  message_equipe_lu   INTEGER NOT NULL DEFAULT 0 CHECK (message_equipe_lu IN (0, 1)),

  avertissements      INTEGER NOT NULL DEFAULT 0,
  avertissement_motif TEXT,
  avertissement_le    TEXT,
  avertissement_lu    INTEGER NOT NULL DEFAULT 0 CHECK (avertissement_lu IN (0, 1)),

  -- QUI A CREE CE COMPTE. Vide quand la personne s'est inscrite
  -- elle-meme ; renseigne quand l'equipe l'a ajoutee a son annuaire,
  -- souvent apres l'avoir rencontree.
  --
  -- Une personne ajoutee ainsi n'a pas choisi de mot de passe, et on n'en
  -- invente pas un a sa place : son compte ne s'ouvre pas en ligne, il
  -- sert a l'equipe pour l'appeler.
  ajoute_par      INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,

  cree_le         TEXT    NOT NULL DEFAULT (datetime('now'))
);


-- ------------------------------------------------------------
-- Table annonces : les demandes publiees par les employeurs
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS annonces (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,

  -- REFERENCES : cet identifiant DOIT exister dans utilisateurs.
  -- ON DELETE CASCADE : si l'employeur est supprime, ses annonces
  -- disparaissent avec lui. Plus d'annonces orphelines.
  employeur_id    INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,

  titre           TEXT    NOT NULL,
  metier          TEXT    NOT NULL,
  arrondissement  TEXT,

  -- Le quartier plutot que l'adresse : beaucoup de gens connaissent
  -- "Bastos" sans savoir que c'est Yaounde 2. C'est ce repere qui
  -- permet a une candidate de juger si elle peut s'y rendre.
  quartier        TEXT,

  -- Quand l'employeur a besoin de quelqu'un. C'est le critere sur
  -- lequel une candidate decide de repondre ou non a l'annonce.
  -- Texte libre : "Lundi et jeudi, 8h a 12h" est plus parlant
  -- qu'un calendrier a remplir, et bien plus rapide a saisir.
  --
  -- Il n'y a PAS de champ description : il faisait doublon avec
  -- l'horaire, et les employeurs le remplissaient au hasard.
  horaire         TEXT,

  -- --- LE PRIX ---
  --
  -- Ce n'est pas une indication : c'est le montant que l'employeur
  -- PAIERA. Sur cette plateforme, c'est lui qui annonce le prix du
  -- service qu'il demande ; la personne postule si cela lui convient, ou
  -- repond a une autre annonce.
  --
  -- Il est obligatoire depuis ce changement de modele. Les demandes
  -- publiees avant peuvent encore l'avoir vide : le serveur l'exige a la
  -- publication, il ne reecrit pas le passe.
  prix            INTEGER,

  -- Un meme chiffre n'a pas le meme sens selon ce qu'il mesure :
  -- 3 000 FCFA de l'heure et 3 000 FCFA pour la journee sont deux
  -- propositions tres differentes. Le CHECK empeche toute autre valeur.
  unite_tarif     TEXT    NOT NULL DEFAULT 'forfaitaire'
                          CHECK (unite_tarif IN ('horaire', 'journalier', 'forfaitaire')),

  -- Combien de temps la prestation devrait durer. Texte libre : "environ
  -- 3 heures", "une matinee". C'est ce qui rend le budget comprehensible.
  duree_estimee   TEXT,

  -- Ce qu'il faut savoir avant d'accepter : un chien dans la maison, un
  -- etage sans ascenseur, du materiel a apporter.
  conditions      TEXT,

  -- --- Annulation ---
  -- Une demande retiree n'est PAS supprimee. Elle disparait de la liste
  -- publique et n'accepte plus de reponse, mais elle reste visible de son
  -- employeur, et les candidatures et discussions qu'elle porte
  -- subsistent : les effacer priverait les deux parties de la trace de ce
  -- qui a ete convenu, et ferait disparaitre des conversations que des
  -- gens ont eues.
  annulee         INTEGER NOT NULL DEFAULT 0 CHECK (annulee IN (0, 1)),
  annulee_le      TEXT,

  -- --- Mise en avant ---
  -- JUSQU'A QUAND, et non "est-elle en avant". Un drapeau demanderait
  -- que quelqu'un pense a l'eteindre au bon moment ; une date se
  -- compare, et la demande reprend sa place toute seule.
  --
  -- NULL : cette demande n'a jamais ete mise en avant.
  mise_en_avant_jusqu_au TEXT,

  -- --- Proposee a une personne ---
  -- L'employeur a trouve quelqu'un dans la recherche et publie sa demande
  -- POUR cette personne. Elle la voit en premier, et y repondre ne lui
  -- coute pas de jeton. La demande reste ouverte aux autres : proposer
  -- n'est pas choisir.
  --
  -- NULL : demande publiee pour tout le monde.
  -- ON DELETE SET NULL : si le compte disparait, la demande reste.
  personne_invitee_id INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,

  cree_le         TEXT    NOT NULL DEFAULT (datetime('now'))
);


-- ------------------------------------------------------------
-- Table candidatures : les reponses des prestataires aux annonces
-- ------------------------------------------------------------
-- Le budget que l'employeur pense mettre, en FCFA. FACULTATIF, et vu de
-- l'equipe seulement : il l'aide a savoir qui appeler. Le prix, lui, est
-- annonce par la personne qui fera le travail, lors de l'appel.
CREATE TABLE IF NOT EXISTS candidatures (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,

  annonce_id      INTEGER NOT NULL REFERENCES annonces(id)     ON DELETE CASCADE,
  prestataire_id  INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,

  statut          TEXT    NOT NULL DEFAULT 'en attente'
                          CHECK (statut IN ('en attente', 'acceptee', 'refusee')),

  cree_le         TEXT    NOT NULL DEFAULT (datetime('now')),

  -- Quand chaque cote a ouvert la discussion pour la derniere fois.
  -- Un message ecrit apres cette date n'a pas encore ete lu.
  --
  -- Deux colonnes plutot qu'un drapeau par message : ce qu'on veut
  -- savoir, c'est "depuis quand n'ai-je pas regarde", et cela ne depend
  -- pas du nombre de messages.
  vu_employeur_le    TEXT,
  vu_prestataire_le  TEXT,

  -- Quand l'employeur a accepte ou refuse. Comparee a vu_prestataire_le,
  -- elle dit si la personne a DEJA VU la decision.
  --
  -- Sans cette date, une personne choisie ne l'apprenait qu'en revenant
  -- regarder son profil : la pastille du menu ne comptait que les
  -- messages, et accepter quelqu'un n'en cree aucun.
  statut_change_le   TEXT,

  -- Quand l'employeur a declare le service effectue. La discussion
  -- passe alors dans l'historique : lisible des deux cotes, mais on n'y
  -- ecrit plus.
  --
  -- Une colonne a part plutot qu'une quatrieme valeur de statut : SQLite
  -- ne sait pas modifier une contrainte CHECK par un ALTER TABLE, il
  -- faudrait reconstruire la table. Une candidature terminee reste donc
  -- 'acceptee', avec une date de fin.
  terminee_le        TEXT,

  -- Quand la personne qui a travaille a declare l'avoir fait.
  --
  -- CETTE DATE NE PAIE RIEN. Seule la declaration de l'employeur libere
  -- l'argent, ou la decision de l'equipe : sinon il suffirait de mentir
  -- pour toucher une somme. Elle sert de trace - l'employeur voit
  -- qu'elle attend, et l'equipe lit un desaccord date plutot qu'un
  -- silence.
  declaree_par_elle_le TEXT,

  -- QUAND CETTE REPONSE A ETE ENVOYEE POUR LA DERNIERE FOIS.
  --
  -- cree_le ne suffit pas : une reponse refusee peut etre renvoyee, et
  -- c'est un nouvel envoi - il coute un jeton et compte dans la limite
  -- du jour. Sans cette colonne, on compterait la premiere fois.
  envoyee_le      TEXT,

  -- Un prestataire ne peut postuler qu'UNE SEULE FOIS a une annonce donnee.
  UNIQUE (annonce_id, prestataire_id)
);


-- ------------------------------------------------------------
-- Table messages : la conversation entre un employeur et un candidat
-- ------------------------------------------------------------
-- Une conversation n'a pas de table a elle : c'est la CANDIDATURE qui
-- en tient lieu. C'est logique - on ne discute pas dans le vide, on
-- discute d'une annonce precise avec une personne precise. La
-- candidature porte deja ces deux informations, et la contrainte
-- UNIQUE (annonce_id, prestataire_id) garantit qu'il n'y a qu'une seule
-- conversation par couple.
--
-- Consequence utile : quand une annonce disparait, ses candidatures
-- disparaissent (ON DELETE CASCADE), et les messages avec elles. Aucune
-- discussion orpheline ne subsiste en base.
CREATE TABLE IF NOT EXISTS messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,

  candidature_id  INTEGER NOT NULL REFERENCES candidatures(id) ON DELETE CASCADE,

  -- Qui a ecrit. On ne stocke pas "employeur" ou "prestataire" : le role
  -- se retrouve en comparant cet identifiant a ceux de la candidature.
  -- Une information deduite ne peut pas se contredire.
  auteur_id       INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,

  texte           TEXT    NOT NULL,

  -- Le message ressemble-t-il a une tentative de paiement en dehors de
  -- la plateforme ? Calcule au moment de l'envoi et conserve, pour que
  -- l'equipe puisse retrouver ces messages sans relire toute la base.
  --
  -- Le message n'est jamais bloque : discuter du prix est normal et
  -- autorise. Seul un avertissement est affiche aux deux personnes.
  risque_paiement INTEGER NOT NULL DEFAULT 0 CHECK (risque_paiement IN (0, 1)),

  -- Signale par son destinataire, en attente d'examen par l'equipe.
  signale         INTEGER NOT NULL DEFAULT 0 CHECK (signale IN (0, 1)),

  -- La decision de l'equipe, une fois le signalement examine.
  -- NULL tant que personne ne l'a regarde : c'est ce qui fait qu'un
  -- signalement APPARAIT dans la liste de l'equipe, et en disparait une
  -- fois traite.
  --   'rien'     : examine, aucun probleme constate
  --   'sanction' : le compte de l'auteur a ete suspendu
  signalement_decision TEXT,

  -- Qui a decide, et quand. Le cahier des charges demande que chaque
  -- decision sensible laisse une trace : sans elle, personne ne peut
  -- repondre a "qui a suspendu ce compte, et pourquoi ?".
  signalement_traite_par INTEGER REFERENCES utilisateurs(id),
  signalement_traite_le  TEXT,

  cree_le         TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ------------------------------------------------------------
-- Table metiers : les services proposes sur la plateforme
-- ------------------------------------------------------------
-- Le metier etait un texte libre, saisi a la main des deux cotes. La
-- base contenait donc "menage", "Menage", "menagere", "nounou" et
-- "nounous" - cinq ecritures pour trois metiers. Consequence : une
-- nounou ne trouvait pas les demandes de "nounous", et la recherche de
-- "menage" ratait les annonces de "menagere".
--
-- C'est le meme probleme que les quartiers, et la meme solution : une
-- liste fermee, et le serveur qui ramene ce qui est saisi au nom
-- officiel.
CREATE TABLE IF NOT EXISTS metiers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Le nom officiel, celui qui s'affiche partout.
  nom         TEXT    NOT NULL UNIQUE,

  -- Les autres facons d'ecrire le meme metier, separees par une barre
  -- verticale. Elles ne sont jamais interrogees une par une : le serveur
  -- lit la colonne entiere au demarrage pour construire son
  -- dictionnaire. Une table separee n'apporterait qu'une jointure de
  -- plus pour le meme resultat.
  synonymes   TEXT    NOT NULL DEFAULT ''
);

INSERT OR IGNORE INTO metiers (nom, synonymes) VALUES
  ('Ménage à domicile', 'menage|menagere|menageres|aide menagere|aide-menagere|femme de menage|entretien maison|menage a domicile'),
  ('Nettoyage de bureaux', 'nettoyage de bureau|nettoyage bureau|technicienne de surface|technicien de surface|agent d entretien|entretien bureau'),
  ('Garde d''enfants', 'nounou|nounous|garde enfant|garde d enfant|baby sitter|babysitter|gouvernante'),
  ('Jardinage', 'jardinier|jardiniere|entretien jardin|jardin'),
  ('Gardiennage', 'gardien|gardienne|vigile|veilleur|securite'),
  ('Cuisine', 'cuisinier|cuisiniere|chef|preparation des repas');

-- ------------------------------------------------------------
-- Index : accelerent les recherches les plus frequentes
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_utilisateurs_role   ON utilisateurs (role);
CREATE INDEX IF NOT EXISTS idx_utilisateurs_metier ON utilisateurs (metier);
CREATE INDEX IF NOT EXISTS idx_annonces_employeur  ON annonces (employeur_id);
CREATE INDEX IF NOT EXISTS idx_candid_annonce      ON candidatures (annonce_id);
CREATE INDEX IF NOT EXISTS idx_candid_prestataire  ON candidatures (prestataire_id);

-- ------------------------------------------------------------
-- Table quartiers : la liste normalisee des quartiers de Yaounde
-- ------------------------------------------------------------
-- Avant, l'arrondissement etait saisi a la main dans trois formulaires
-- differents, et le quartier etait un texte libre. Resultat : "cite vert",
-- "biyemassi", "ngoussso" - des orthographes qu'aucune recherche ne
-- rapproche, et des arrondissements parfois faux.
--
-- Desormais la personne choisit son QUARTIER, et le serveur en DEDUIT
-- l'arrondissement. Une seule information saisie, une seule verite.
--
-- ATTENTION : cette table est modifiable. Le rattachement d'un quartier a
-- son arrondissement doit etre verifie par l'equipe : c'est une donnee de
-- terrain, pas une donnee technique.
CREATE TABLE IF NOT EXISTS quartiers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,

  -- UNIQUE : un quartier n'est ecrit qu'une fois dans la table.
  nom             TEXT    NOT NULL UNIQUE,

  arrondissement  TEXT    NOT NULL,

  -- Les autres facons d'ecrire le meme quartier, separees par une barre
  -- verticale. La mise en forme du serveur rattrape les accents, les
  -- majuscules et les tirets - mais pas une lettre en trop : "ngoussso"
  -- avec trois s, ou "cite vert" sans le e final, ne se rapprochaient de
  -- rien. Ces orthographes-la se declarent ici, une fois rencontrees.
  synonymes       TEXT    NOT NULL DEFAULT '',

  -- La premiere version ne couvre que Yaounde. La colonne existe deja
  -- pour qu'une autre ville puisse etre ajoutee sans refaire la table.
  ville           TEXT    NOT NULL DEFAULT 'Yaoundé'
);

-- INSERT OR IGNORE : si le quartier existe deja, la ligne est ignoree
-- au lieu de provoquer une erreur. On peut donc relancer ce fichier
-- autant de fois qu'on veut sans rien casser.
INSERT OR IGNORE INTO quartiers (nom, arrondissement) VALUES
  ('Bastos', 'Yaoundé 1'),
  ('Nlongkak', 'Yaoundé 1'),
  ('Elig-Essono', 'Yaoundé 1'),
  ('Djoungolo', 'Yaoundé 1'),
  ('Etoa-Meki', 'Yaoundé 1'),
  ('Emana', 'Yaoundé 1'),
  ('Nkolmesseng', 'Yaoundé 1'),
  ('Ekoudou', 'Yaoundé 1'),
  ('Manguier', 'Yaoundé 1'),
  ('Tsinga', 'Yaoundé 2'),
  ('Briqueterie', 'Yaoundé 2'),
  ('Madagascar', 'Yaoundé 2'),
  ('Mokolo', 'Yaoundé 2'),
  ('Messa', 'Yaoundé 2'),
  ('Cité Verte', 'Yaoundé 2'),
  ('Nkomkana', 'Yaoundé 2'),
  ('Carrière', 'Yaoundé 2'),
  ('Oliga', 'Yaoundé 2'),
  ('Efoulan', 'Yaoundé 3'),
  ('Nsimeyong', 'Yaoundé 3'),
  ('Mvog-Betsi', 'Yaoundé 3'),
  ('Obili', 'Yaoundé 3'),
  ('Ngoa-Ekellé', 'Yaoundé 3'),
  ('Mvolyé', 'Yaoundé 3'),
  ('Simbock', 'Yaoundé 3'),
  ('Ahala', 'Yaoundé 3'),
  ('Nsam', 'Yaoundé 3'),
  ('Damas', 'Yaoundé 3'),
  ('Kondengui', 'Yaoundé 4'),
  ('Mvog-Ada', 'Yaoundé 4'),
  ('Mimboman', 'Yaoundé 4'),
  ('Nkolndongo', 'Yaoundé 4'),
  ('Ekounou', 'Yaoundé 4'),
  ('Awae', 'Yaoundé 4'),
  ('Mvan', 'Yaoundé 4'),
  ('Odza', 'Yaoundé 4'),
  ('Ekié', 'Yaoundé 4'),
  ('Nkolfoulou', 'Yaoundé 4'),
  ('Essos', 'Yaoundé 5'),
  ('Mfandena', 'Yaoundé 5'),
  ('Omnisport', 'Yaoundé 5'),
  ('Ngousso', 'Yaoundé 5'),
  ('Emombo', 'Yaoundé 5'),
  ('Mvog-Mbi', 'Yaoundé 5'),
  ('Santa Barbara', 'Yaoundé 5'),
  ('Nkoabang', 'Yaoundé 5'),
  ('Biyem-Assi', 'Yaoundé 6'),
  ('Mendong', 'Yaoundé 6'),
  ('Etoug-Ebe', 'Yaoundé 6'),
  ('Melen', 'Yaoundé 6'),
  ('Nkolbikok', 'Yaoundé 6'),
  ('Etetak', 'Yaoundé 6'),
  ('Obobogo', 'Yaoundé 6'),
  ('Mendong-Village', 'Yaoundé 6'),
  ('Nkolbisson', 'Yaoundé 7'),
  ('Oyom-Abang', 'Yaoundé 7'),
  ('Nkolso', 'Yaoundé 7'),
  ('Minkoameyos', 'Yaoundé 7'),
  ('Nomayos', 'Yaoundé 7'),
  ('Ekoumdoum', 'Yaoundé 7');

-- Quartiers rencontres dans les saisies reelles et absents de la liste
-- initiale. A faire relire par l'equipe : le rattachement d'un quartier a
-- son arrondissement est une donnee de terrain.
INSERT OR IGNORE INTO quartiers (nom, arrondissement) VALUES
  ('École de Poste', 'Yaoundé 1'),
  ('Cradat', 'Yaoundé 1');

-- Les orthographes rencontrees qui ne se rapprochaient d'aucun quartier.
UPDATE quartiers SET synonymes = 'cite vert|citeverte|cité vert'  WHERE nom = 'Cité Verte';
UPDATE quartiers SET synonymes = 'ngoussso|ngousso|ngoussou'      WHERE nom = 'Ngousso';
UPDATE quartiers SET synonymes = 'ngoaekele|ngoa ekele|ngoa-ekele' WHERE nom = 'Ngoa-Ekellé';
UPDATE quartiers SET synonymes = 'biyemassi|biyem assi'           WHERE nom = 'Biyem-Assi';
UPDATE quartiers SET synonymes = 'ecole de poste|ecole poste'     WHERE nom = 'École de Poste';

-- ------------------------------------------------------------------
-- Un probleme signale a l'equipe.
--
-- A ne pas confondre avec messages.signale, qui pointe UN message ecrit
-- par quelqu'un d'autre. Ici, la personne ECRIT elle-meme ce qui ne va
-- pas. Les vrais problemes n'ont souvent aucun message a montrer : la
-- personne n'est pas venue, les conditions ont change sur place, on lui
-- a propose de payer hors plateforme au telephone.
--
-- vise_id est l'AUTRE personne de la discussion. Le serveur la deduit,
-- elle n'est jamais choisie dans le formulaire : on ne signale pas
-- quelqu'un avec qui on n'a rien en cours.
CREATE TABLE IF NOT EXISTS problemes (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  candidature_id INTEGER NOT NULL REFERENCES candidatures(id) ON DELETE CASCADE,
  auteur_id      INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  vise_id        INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  texte          TEXT    NOT NULL,
  cree_le        TEXT    NOT NULL DEFAULT (datetime('now')),

  -- NULL tant que l'equipe n'a pas tranche. Les memes trois issues que
  -- pour un message signale : on ne cree pas un second vocabulaire de
  -- sanctions a cote du premier.
  decision       TEXT CHECK (decision IN ('rien', 'avertissement', 'sanction')),
  traite_par     INTEGER REFERENCES utilisateurs(id),
  traite_le      TEXT
);

CREATE INDEX IF NOT EXISTS idx_problemes_ouverts ON problemes (decision);


-- ------------------------------------------------------------------
-- Table mises_en_relation : la fiche que l'equipe tient par demande.
--
-- LE PRIX NE VIENT PAS DE LA PLATEFORME. Il vient de la personne qui
-- fera le travail : l'equipe l'appelle, la personne annonce son prix, et
-- l'equipe l'ecrit ici tel quel. La plateforme y ajoute sa commission,
-- et c'est CE montant-la que l'equipe annonce ensuite a l'employeur.
--
-- Les deux montants sont gardes. Ne garder que celui annonce a
-- l'employeur obligerait a recalculer la part de la personne a chaque
-- lecture ; et le jour ou la commission changerait, toutes les fiches
-- anciennes se mettraient a mentir.
--
-- PLUSIEURS FICHES PAR DEMANDE, UNE SEULE ACCEPTEE. Quand l'employeur
-- refuse un prix, la fiche reste avec son refus, et l'equipe en ouvre
-- une autre avec quelqu'un d'autre. Effacer la premiere effacerait le
-- travail deja fait, et l'equipe rappellerait les memes personnes.
--
--   'en cours' : le prix est enregistre, l'employeur n'a pas repondu
--   'acceptee' : l'employeur a dit oui, les deux sont mis en relation
--   'refusee'  : l'employeur a dit non
CREATE TABLE IF NOT EXISTS mises_en_relation (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,

  annonce_id        INTEGER NOT NULL REFERENCES annonces(id)     ON DELETE CASCADE,
  prestataire_id    INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,

  -- Ce que la personne a annonce au telephone, et ce que l'employeur
  -- entendra : ce prix augmente de la commission.
  prix_prestataire  INTEGER NOT NULL,
  commission        INTEGER NOT NULL,
  prix_employeur    INTEGER NOT NULL,

  appel_prestataire_le  TEXT NOT NULL DEFAULT (datetime('now')),
  appel_employeur_le    TEXT,

  statut            TEXT    NOT NULL DEFAULT 'en cours'
                            CHECK (statut IN ('en cours', 'acceptee', 'refusee')),

  -- Ce que l'equipe veut retenir de l'appel : "rappeler apres 18 h",
  -- "trouve le prix trop eleve". Facultatif.
  note              TEXT,

  faite_par         INTEGER REFERENCES utilisateurs(id),
  cree_le           TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_relations_annonce ON mises_en_relation (annonce_id);
CREATE INDEX IF NOT EXISTS idx_relations_statut  ON mises_en_relation (statut);


-- ------------------------------------------------------------------
-- Table paiements : ce que PamConnect a recu, et ce qu'elle a reverse.
--
-- L'ARGENT NE TRANSITE PAS PAR LA PLATEFORME. Encaisser la somme d'une
-- personne pour la reverser a une autre est une activite d'intermediaire
-- financier, reglementee par la COBAC dans la zone CEMAC : elle suppose
-- une entite juridique, un agrement ou un partenariat avec un
-- etablissement agree, et un contrat de production avec MTN et Orange.
-- Aucun de ces prerequis n'est accessible ici.
--
-- L'employeur paie donc PamConnect APRES le service, a l'agence ou par
-- Mobile Money, et PamConnect reverse a la personne qui a travaille.
-- Cette table en garde la TRACE : deux montants, deux dates, deux
-- moyens. Ce qui est recu moins ce qui est reverse est la commission.
--
-- DEUX TEMPS DISTINCTS, et c'est voulu : l'equipe peut avoir recu sans
-- avoir encore reverse, et l'ecran doit pouvoir le dire. Une seule
-- colonne "paye" ne dirait pas ou en est l'argent de quelqu'un.
CREATE TABLE IF NOT EXISTS paiements (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,

  mise_en_relation_id INTEGER NOT NULL UNIQUE
                              REFERENCES mises_en_relation(id) ON DELETE CASCADE,

  montant_recu        INTEGER,
  recu_le             TEXT,
  moyen_reception     TEXT,

  montant_reverse     INTEGER,
  reverse_le          TEXT,
  moyen_reversement   TEXT,

  enregistre_par      INTEGER REFERENCES utilisateurs(id),
  cree_le             TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_quartiers_arrond ON quartiers (arrondissement);
CREATE INDEX IF NOT EXISTS idx_messages_candidature ON messages (candidature_id);
CREATE INDEX IF NOT EXISTS idx_messages_signale     ON messages (signale);


-- ------------------------------------------------------------------
-- Table parametres : les valeurs que l'equipe peut changer elle-meme
-- ------------------------------------------------------------------
-- LE PRIX N'EST PAS DANS LE CODE. Un tarif ecrit en dur dans server.js
-- ne peut etre change que par quelqu'un qui sait programmer, et il
-- faudrait redeployer la plateforme pour ajuster un pack de 100 FCFA.
--
-- Il vit donc ici, dans une ligne que l'equipe modifie depuis son
-- espace. Le meme prix s'applique alors a TOUT LE MONDE, immediatement :
-- il n'y a pas un tarif par utilisateur, et un changement ne reecrit pas
-- les achats deja payes - ceux-la gardent le montant qu'ils ont coute.
--
-- Une valeur est du TEXTE : selon la cle, le serveur y lit un nombre
-- (100) ou une liste (10:1000|30:3000). Une colonne par type de valeur
-- aurait fait trois colonnes vides sur quatre.
CREATE TABLE IF NOT EXISTS parametres (
  cle      TEXT PRIMARY KEY,
  valeur   TEXT NOT NULL,

  -- QUI A CHANGE CE PRIX, ET QUAND. C'etait le seul reglage sensible de
  -- l'espace equipe sans trace : une suspension, un arbitrage et un
  -- refus gardent tous le nom de qui a decide, un prix non.
  --
  -- Un seul changement garde, le dernier. Un historique complet
  -- demanderait une table et un ecran de plus, pour repondre a une
  -- question que personne ne pose : ce qu'on veut savoir, c'est qui a
  -- mis le prix qui s'applique maintenant.
  modifie_par INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
  modifie_le  TEXT
);

-- UN PACK NE PORTE QUE SON NOMBRE DE JETONS. Son prix se calcule :
-- 10 jetons a 100 FCFA se vendent 1 000 FCFA.
--
-- Ranger aussi le prix laisserait les deux se contredire - un jeton a
-- 200 et un pack de 10 a 1 000 - et il n'y aurait aucun moyen de savoir
-- lequel des deux dit vrai. Un seul nombre a changer, une seule verite.
INSERT OR IGNORE INTO parametres (cle, valeur) VALUES
  ('jeton_valeur_fcfa', '100'),
  ('packs_jetons', '5|10|30|60'),

  -- LES JETONS DE BIENVENUE. Ils ne sont pas un cadeau : ils arrivent
  -- apres la verification d'identite, c'est-a-dire apres avoir envoye
  -- ses papiers et attendu. Une seule fois par compte, et ils expirent -
  -- le gratuit a une date de fin, on ne peut pas s'y installer.
  ('bienvenue_employeur', '10'),
  ('bienvenue_prestataire', '3'),
  ('bienvenue_jours', '60'),

  -- CE QU'UNE ACTION COUTE. Ces deux nombres ne servent pas encore a
  -- prelever quoi que ce soit : ils servent d'abord a DIRE la verite.
  -- Sans eux, la page annonce "des jetons vous sont offerts" sans
  -- pouvoir dire ce qu'ils permettent de faire.
  ('cout_candidature', '1'),
  ('cout_mise_en_avant', '20'),

  -- COMBIEN DE REPONSES PAR 24 HEURES, quel que soit le solde. Le jeton
  -- fait reflechir, il n'empeche pas quelqu'un de tres motive de repondre
  -- a tout. Cette limite-la si.
  ('candidatures_par_jour', '3'),
  ('duree_mise_en_avant_jours', '7');


-- ------------------------------------------------------------------
-- Table jetons_achats : une demande d'achat de jetons
-- ------------------------------------------------------------------
-- SIMULATION, comme le sequestre. La plateforme n'encaisse rien : elle
-- enregistre une demande, et un membre de l'equipe confirme avoir recu
-- le paiement. C'est aussi ainsi que fonctionnent beaucoup de services
-- a Yaounde - le paiement passe par Mobile Money entre les deux
-- personnes, la plateforme le constate.
--
-- Aucun ecran d'operateur n'est imite : PamConnect n'affiche jamais une
-- interface qui ressemblerait a celle de MTN ou d'Orange.
--
-- LE MONTANT EST FIGE ICI. Si l'equipe change le prix d'un pack demain,
-- cette ligne garde ce qu'elle a coute aujourd'hui.
CREATE TABLE IF NOT EXISTS jetons_achats (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  utilisateur_id INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,

  quantite       INTEGER NOT NULL,
  montant_fcfa   INTEGER NOT NULL,

  etat           TEXT NOT NULL DEFAULT 'en attente'
                 CHECK (etat IN ('en attente', 'confirme', 'refuse')),

  cree_le        TEXT NOT NULL DEFAULT (datetime('now')),
  traite_par     INTEGER REFERENCES utilisateurs(id),
  traite_le      TEXT,
  motif_refus    TEXT
);

CREATE INDEX IF NOT EXISTS idx_jetons_achats_etat ON jetons_achats (etat);


-- ------------------------------------------------------------------
-- Table jetons_mouvements : tout ce qui entre et sort d'un solde
-- ------------------------------------------------------------------
-- IL N'Y A PAS DE COLONNE "solde". Le solde est la SOMME de ces lignes,
-- exactement comme pour les paiements : un total range a cote de son
-- historique peut diverger de lui, calcule il ne le peut pas.
--
-- quantite est positive quand des jetons entrent, negative quand ils
-- sortent. Une ligne n'est jamais modifiee ni supprimee : corriger une
-- erreur, c'est ecrire la ligne inverse.
--
-- DEUX NATURES, ET C'EST VOLONTAIRE. Les jetons offerts a la
-- verification expirent ; ceux qu'on achete, jamais. Les melanger
-- obligerait a deviner lesquels sont partis en premier. Separes, chaque
-- solde se lit tout seul, et la personne voit ce qui va expirer.
--
-- Les jetons ne se transferent pas entre utilisateurs et ne se
-- retirent pas en argent : aucune ligne ne porte de destinataire, et
-- aucune route n'en cree.
CREATE TABLE IF NOT EXISTS jetons_mouvements (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  utilisateur_id INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,

  quantite       INTEGER NOT NULL,

  nature         TEXT NOT NULL CHECK (nature IN ('offert', 'achete')),

  --   'achat'         : un pack confirme par l'equipe
  --   'bienvenue'     : les jetons offerts a la verification du compte
  --   'expiration'    : les jetons offerts non utilises a temps
  --   'candidature'   : une reponse a une demande
  --   'mise_en_avant' : une annonce mise en avant
  --   'remboursement' : la plateforme rend des jetons preleves
  motif          TEXT NOT NULL,

  -- La phrase que la personne lit dans son historique.
  detail         TEXT NOT NULL DEFAULT '',

  achat_id       INTEGER REFERENCES jetons_achats(id) ON DELETE SET NULL,
  annonce_id     INTEGER REFERENCES annonces(id)      ON DELETE SET NULL,

  -- Renseignee sur les jetons offerts uniquement.
  expire_le      TEXT,

  cree_le        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_jetons_mouv_personne ON jetons_mouvements (utilisateur_id);


-- ------------------------------------------------------------------
-- Table avis : ce que chacun dit de l'autre, apres le service
-- ------------------------------------------------------------------
-- DANS LES DEUX SENS, et c'est le point. L'employeur note la personne
-- qui a travaille ; elle note l'employeur. Une plateforme qui ne fait
-- noter que d'un cote met toute la pression sur celui qui a le moins de
-- pouvoir - et elle ne dit rien du logement ou l'on envoie quelqu'un.
--
-- UN AVIS SUPPOSE UN SERVICE. La candidature doit porter une date de
-- fin : personne ne note une rencontre qui n'a pas eu lieu.
--
-- UNIQUE (candidature_id, auteur_id) : un seul avis par service et par
-- personne. On ne revient pas dessus - un avis qu'on peut reecrire
-- devient un moyen de pression apres coup.
CREATE TABLE IF NOT EXISTS avis (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,

  -- LE SERVICE CONCERNE. Chaque avis y reste rattache : sans lui, on ne
  -- pourrait pas verifier qu'il repose sur quelque chose.
  candidature_id INTEGER NOT NULL REFERENCES candidatures(id) ON DELETE CASCADE,

  auteur_id      INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  vise_id        INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,

  -- La note d'ensemble, seule obligatoire.
  note           INTEGER NOT NULL CHECK (note BETWEEN 1 AND 5),

  commentaire    TEXT,

  -- LES QUATRE NOTES DE DETAIL, FACULTATIVES. Imposer cinq etoiles a
  -- remplir ferait abandonner le formulaire, et une note posee au hasard
  -- vaut moins que pas de note.
  --
  -- LEUR NOM EST NEUTRE, ET C'EST VOULU : les deux cotes ne jugent pas
  -- la meme chose. Le sens de chaque colonne se lit dans le ROLE de
  -- celui qui a ecrit l'avis :
  --
  --   colonne     employeur qui note         personne qui note
  --   ---------   ------------------------   --------------------------
  --   critere1    Ponctualite                Conditions conformes
  --   critere2    Qualite du travail         Paiement declare sans retard
  --   critere3    Respect du domicile        Respect
  --   critere4    Communication              Communication
  --
  -- Huit colonnes dont quatre vides sur chaque ligne auraient dit la
  -- meme chose, en moins lisible. Les libelles vivent dans UNE fonction
  -- du serveur, criteresAvis() : le formulaire et l'affichage s'en
  -- servent tous les deux, ils ne peuvent donc pas diverger.
  --
  -- "Paiement declare sans retard" est celui qui manquait, et c'est le
  -- plus important pour elle : un employeur qui oublie de declarer le
  -- service la laisse impayee.
  critere1       INTEGER CHECK (critere1 BETWEEN 1 AND 5),
  critere2       INTEGER CHECK (critere2 BETWEEN 1 AND 5),
  critere3       INTEGER CHECK (critere3 BETWEEN 1 AND 5),
  critere4       INTEGER CHECK (critere4 BETWEEN 1 AND 5),

  cree_le        TEXT NOT NULL DEFAULT (datetime('now')),

  -- --- Moderation ---
  -- Signale par la personne visee : c'est elle que l'avis designe, et
  -- c'est elle qui sait s'il est faux ou insultant.
  signale        INTEGER NOT NULL DEFAULT 0 CHECK (signale IN (0, 1)),

  -- MASQUE, PAS SUPPRIME. Un avis efface ne laisserait aucune trace de
  -- ce qui a ete decide ni pourquoi. Masque, il disparait des ecrans et
  -- ne compte plus dans la moyenne, mais l'equipe peut encore expliquer
  -- sa decision des mois plus tard.
  masque         INTEGER NOT NULL DEFAULT 0 CHECK (masque IN (0, 1)),
  masque_par     INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
  masque_le      TEXT,
  motif_masquage TEXT,

  UNIQUE (candidature_id, auteur_id)
);

CREATE INDEX IF NOT EXISTS idx_avis_vise    ON avis (vise_id);
CREATE INDEX IF NOT EXISTS idx_avis_signale ON avis (signale);
