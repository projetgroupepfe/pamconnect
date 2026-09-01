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
  verifie_le      TEXT,
  motif_refus     TEXT,

  -- Membre de l'equipe projet, autorise a valider les dossiers.
  est_admin       INTEGER NOT NULL DEFAULT 0 CHECK (est_admin IN (0, 1)),

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

  -- --- Ce que l'employeur est pret a payer ---
  --
  -- Sans ce montant, une candidate propose son tarif a l'aveugle : elle
  -- ne sait pas si elle est dans le budget ou tres au-dessus. C'est le
  -- point de depart de la discussion, et le pendant de la proposition
  -- qu'elle fera de son cote.
  --
  -- NULL est accepte : un employeur qui ne sait pas encore combien coute
  -- une prestation ne doit pas etre empeche de publier sa demande.
  budget          INTEGER,

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

  cree_le         TEXT    NOT NULL DEFAULT (datetime('now'))
);


-- ------------------------------------------------------------
-- Table candidatures : les reponses des prestataires aux annonces
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS candidatures (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,

  annonce_id      INTEGER NOT NULL REFERENCES annonces(id)     ON DELETE CASCADE,
  prestataire_id  INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,

  statut          TEXT    NOT NULL DEFAULT 'en attente'
                          CHECK (statut IN ('en attente', 'acceptee', 'refusee')),

  -- Le tarif finalement retenu pour cette candidature, en francs CFA.
  --
  -- La personne affiche un tarif sur son profil : c'est son point de
  -- depart. Si l'employeur et elle s'entendent sur un autre montant en
  -- discutant, c'est celui-ci qui compte, et il est ecrit ICI - jamais
  -- dans le profil, qui doit rester valable pour les autres annonces.
  --
  -- NULL tant que personne n'a rien propose : on garde alors le tarif
  -- du profil.
  tarif_propose   INTEGER,

  cree_le         TEXT    NOT NULL DEFAULT (datetime('now')),

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

CREATE INDEX IF NOT EXISTS idx_quartiers_arrond ON quartiers (arrondissement);
CREATE INDEX IF NOT EXISTS idx_messages_candidature ON messages (candidature_id);
CREATE INDEX IF NOT EXISTS idx_messages_signale     ON messages (signale);
