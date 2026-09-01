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

  cree_le         TEXT    NOT NULL DEFAULT (datetime('now')),

  -- Un prestataire ne peut postuler qu'UNE SEULE FOIS a une annonce donnee.
  UNIQUE (annonce_id, prestataire_id)
);


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
