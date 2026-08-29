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
  description     TEXT,
  metier          TEXT    NOT NULL,
  arrondissement  TEXT,

  -- Quand l'employeur a besoin de quelqu'un. C'est le critere sur
  -- lequel une candidate decide de repondre ou non a l'annonce.
  -- Texte libre : "Lundi et jeudi, 8h a 12h" est plus parlant
  -- qu'un calendrier a remplir, et bien plus rapide a saisir.
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
