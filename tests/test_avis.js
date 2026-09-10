// Série : les notes et les avis.
//
// Ce qui doit tenir :
//   - un avis suppose un SERVICE TERMINÉ, jamais avant ;
//   - un seul avis par service et par personne, et il ne se modifie pas ;
//   - dans les DEUX SENS : elle note l'employeur, il la note ;
//   - la personne visée peut signaler, jamais effacer ;
//   - l'équipe masque avec un motif écrit, et l'avis masqué sort de la
//     moyenne sans disparaître de la base.
const PROJET = require("path").join(__dirname, "..");
process.chdir(PROJET);
require(PROJET + "/_serveur_test_temporaire.js");

const base = require(PROJET + "/node_modules/better-sqlite3")(PROJET + "/data/pamconnect.db");
base.pragma("foreign_keys = ON");

const RACINE = "http://127.0.0.1:3999";
const M = "test-avis";
let ok = 0, ko = 0;

const SAUT = String.fromCharCode(10);

const dire = (nom, cond, detail) => {
  if (cond) { ok++; console.log("  OK    | " + nom); }
  else { ko++; console.log("  ECHEC | " + nom + (detail ? "   -> " + detail : "")); }
};

const form = (o) => new URLSearchParams(o);
const lire = (chemin, cookie) =>
  fetch(RACINE + chemin, { headers: cookie ? { Cookie: cookie } : {}, redirect: "manual" });

async function poster(chemin, corps, cookie) {
  const entetes = {};
  if (cookie) entetes.Cookie = cookie;
  const r = await fetch(RACINE + chemin, { method: "POST", body: corps, headers: entetes, redirect: "manual" });
  const sc = r.headers.getSetCookie();
  return { code: r.status, corps: await r.text(), cookie: sc.length ? sc[0].split(";")[0] : null };
}

async function creerCompte(suffixe, role, extra) {
  const mail = (M + "-" + suffixe + "@example.com").toLowerCase();
  await poster("/inscription", form(Object.assign(
    { role, nom: "Test " + suffixe, email: mail, motdepasse: "motdepasse123", quartier: "Bastos" },
    extra || {})));
  const c = await poster("/connexion", form({ email: mail, motdepasse: "motdepasse123" }));
  base.prepare("UPDATE utilisateurs SET statut_verification = 'verifie' WHERE email = ?").run(mail);
  return {
    mail, cookie: c.cookie,
    id: base.prepare("SELECT id FROM utilisateurs WHERE email = ?").get(mail).id,
  };
}

// Les jetons ne sont pas le sujet : on en donne assez pour repondre.
const crediter = (id, n) => base.prepare(`
  INSERT INTO jetons_mouvements (utilisateur_id, quantite, nature, motif, detail)
  VALUES (?, ?, 'achete', 'achat', 'Credit de test')
`).run(id, n);

const reputation = (id) => base.prepare(`
  SELECT COUNT(*) AS nombre, AVG(note) AS moyenne
  FROM avis WHERE vise_id = ? AND masque = 0`).get(id);

const avisDe = (candidature, auteur) => base.prepare(
  "SELECT * FROM avis WHERE candidature_id = ? AND auteur_id = ?").get(candidature, auteur);

// Un service complet : elle repond, il la choisit, il declare le service
// effectue. Renvoie la candidature.
async function serviceTermine(emp, elle, titre, prix) {
  await poster("/annonces", form({ titre: M + " " + titre, metier: "menagere",
    quartier: "Mvan", horaire: "Lundi 8h", prix: String(prix) }), emp.cookie);
  const annonce = base.prepare(
    "SELECT id FROM annonces WHERE titre = ? ORDER BY id DESC LIMIT 1").get(M + " " + titre);

  await poster("/candidatures", form({ annonceId: String(annonce.id) }), elle.cookie);
  const cand = base.prepare(
    "SELECT id FROM candidatures WHERE annonce_id = ? AND prestataire_id = ?")
    .get(annonce.id, elle.id);

  await poster("/candidatures/statut",
    form({ candidatureId: String(cand.id), statut: "acceptee" }), emp.cookie);

  return { annonce, cand };
}

setTimeout(async () => {
  const eq = await creerCompte("eq", "employeur");
  base.prepare("UPDATE utilisateurs SET est_admin = 1 WHERE id = ?").run(eq.id);

  const emp = await creerCompte("emp", "employeur");
  const elle = await creerCompte("elle", "prestataire", { metier: "menagere", tarif: "15000" });
  crediter(elle.id, 50);
  crediter(emp.id, 50);

  const { cand } = await serviceTermine(emp, elle, "Service1", 20000);

  console.log(SAUT + "--- PAS D'AVIS SANS SERVICE TERMINE ---");
  // Elle est retenue, mais le service n'a pas encore ete declare fait.
  dire("l'ecran est refuse", (await lire("/avis/" + cand.id, emp.cookie)).status === 409);
  const tropTot = await poster("/avis/" + cand.id, form({ note: "5" }), emp.cookie);
  dire("l'envoi aussi", tropTot.code === 409, String(tropTot.code));
  dire("aucun avis en base", !avisDe(cand.id, emp.id));
  dire("la raison est donnee", tropTot.corps.includes("après un service effectué"));

  // L'employeur declare le service effectue : la porte s'ouvre.
  await poster("/candidatures/" + cand.id + "/terminer", form({}), emp.cookie);

  console.log(SAUT + "--- SEULS LES DEUX CONCERNES ---");
  const autre = await creerCompte("autre", "employeur");
  dire("un tiers recoit 404", (await lire("/avis/" + cand.id, autre.cookie)).status === 404);
  dire("l'equipe n'a pas cet ecran", (await lire("/avis/" + cand.id, eq.cookie)).status === 403);

  console.log(SAUT + "--- L'EMPLOYEUR NOTE LA PERSONNE ---");
  const ecran = await (await lire("/avis/" + cand.id, emp.cookie)).text();
  dire("l'ecran s'ouvre", ecran.includes("Donner mon avis"));
  dire("il previent que c'est definitif", ecran.includes("ne pourra plus être modifié"));
  dire("et que c'est public", ecran.includes("visible par tout le monde"));
  dire("les criteres de l'employeur", ecran.includes("Qualité du travail"));

  const sansNote = await poster("/avis/" + cand.id, form({ commentaire: "rien" }), emp.cookie);
  dire("un avis sans note est refuse", sansNote.code === 400, String(sansNote.code));

  const horsEchelle = await poster("/avis/" + cand.id, form({ note: "9" }), emp.cookie);
  dire("une note hors echelle est refusee", horsEchelle.code === 400, String(horsEchelle.code));
  dire("toujours aucun avis", !avisDe(cand.id, emp.id));

  const pose = await poster("/avis/" + cand.id,
    form({ note: "5", commentaire: M + " travail soigne et ponctuel",
           ponctualite: "5", qualite: "4", respect: "", communication: "5" }), emp.cookie);
  dire("l'avis est publie", pose.code === 200, String(pose.code));

  const son = avisDe(cand.id, emp.id);
  dire("il est enregistre", Boolean(son));
  dire("avec la note", son.note === 5);
  dire("le commentaire", String(son.commentaire).includes("soigne"));
  dire("il vise la personne", son.vise_id === elle.id);
  dire("les criteres remplis sont gardes", son.ponctualite === 5 && son.qualite === 4);
  // FACULTATIF VEUT DIRE FACULTATIF : une case vide n'est pas une erreur.
  dire("celui laisse vide reste vide", son.respect === null);

  console.log(SAUT + "--- UN SEUL AVIS, ET IL NE SE MODIFIE PAS ---");
  dire("l'ecran se ferme", (await lire("/avis/" + cand.id, emp.cookie)).status === 409);
  const deux = await poster("/avis/" + cand.id, form({ note: "1" }), emp.cookie);
  dire("un second envoi est refuse", deux.code === 409, String(deux.code));
  dire("la premiere note tient", avisDe(cand.id, emp.id).note === 5);
  dire("la raison est dite", deux.corps.includes("Un seul avis par service"));

  console.log(SAUT + "--- ELLE NOTE L'EMPLOYEUR AUSSI ---");
  const sonEcran = await (await lire("/avis/" + cand.id, elle.cookie)).text();
  dire("son ecran s'ouvre", sonEcran.includes("Donner mon avis"));
  // Le meme critere ne dit pas la meme chose des deux cotes.
  dire("ses criteres a elle", sonEcran.includes("Conditions conformes"));
  dire("et pas ceux de l'employeur", !sonEcran.includes("Qualité du travail"));

  await poster("/avis/" + cand.id,
    form({ note: "4", commentaire: M + " maison accueillante" }), elle.cookie);
  const sien = avisDe(cand.id, elle.id);
  dire("son avis est enregistre", Boolean(sien));
  dire("il vise l'employeur", sien.vise_id === emp.id);
  dire("les deux avis coexistent",
       base.prepare("SELECT COUNT(*) n FROM avis WHERE candidature_id = ?").get(cand.id).n === 2);

  console.log(SAUT + "--- LA MOYENNE ET LE NOMBRE ---");
  dire("elle a un avis", reputation(elle.id).nombre === 1);
  dire("de 5 sur 5", reputation(elle.id).moyenne === 5);
  dire("lui aussi en a un", reputation(emp.id).nombre === 1);

  // Un second service pour faire bouger la moyenne.
  const deuxieme = await serviceTermine(emp, elle, "Service2", 12000);
  await poster("/candidatures/" + deuxieme.cand.id + "/terminer", form({}), emp.cookie);
  await poster("/avis/" + deuxieme.cand.id, form({ note: "4" }), emp.cookie);
  dire("deux avis maintenant", reputation(elle.id).nombre === 2);
  dire("la moyenne suit", reputation(elle.id).moyenne === 4.5, String(reputation(elle.id).moyenne));

  console.log(SAUT + "--- LES AVIS SONT PUBLICS ---");
  const fiche = await (await lire("/personnes/" + elle.id)).text();
  dire("la fiche affiche la moyenne", fiche.includes("4,5 sur 5"));
  dire("et le nombre d'avis", fiche.includes("sur 2 avis"));
  dire("et le commentaire", fiche.includes("travail soigne"));
  // Peu d'avis : on le dit plutot que de laisser croire a une reputation etablie.
  dire("elle previent que c'est peu", fiche.includes("peut encore beaucoup bouger"));

  console.log(SAUT + "--- LA REPUTATION DE L'EMPLOYEUR AUSSI ---");
  // Une plateforme qui ne fait noter que d'un cote met toute la pression
  // sur celui qui a le moins de pouvoir.
  // Une demande OUVERTE : sur une demande deja pourvue, l ecran de
  // reponse ne s ouvre meme pas.
  await poster("/annonces", form({ titre: M + " Service3", metier: "menagere",
    quartier: "Mvan", horaire: "Lundi 8h", prix: "9000" }), emp.cookie);
  const ouverte = base.prepare(
    "SELECT id FROM annonces WHERE titre = ? ORDER BY id DESC LIMIT 1").get(M + " Service3");

  const reponse = await lire("/candidatures/nouvelle/" + ouverte.id, elle.cookie);
  dire("l ecran de reponse s ouvre", reponse.status === 200, String(reponse.status));
  const ecranReponse = await reponse.text();
  dire("elle voit la note de l'employeur avant d'aller chez lui",
       ecranReponse.includes("sur 1 avis"));

  console.log(SAUT + "--- SIGNALER, PAS EFFACER ---");
  dire("la personne visee peut signaler",
       (await poster("/avis/" + son.id + "/signaler", form({}), elle.cookie)).code === 200);
  dire("l'avis est marque", base.prepare("SELECT signale FROM avis WHERE id = ?").get(son.id).signale === 1);
  dire("il reste visible", base.prepare("SELECT masque FROM avis WHERE id = ?").get(son.id).masque === 0);
  dire("la moyenne ne bouge pas", reputation(elle.id).nombre === 2);

  // L'AUTEUR NE SIGNALE PAS SON PROPRE AVIS, et personne ne signale
  // celui d'un tiers.
  const parAuteur = await poster("/avis/" + son.id + "/signaler", form({}), emp.cookie);
  dire("l'auteur ne peut pas le signaler", parAuteur.code === 404, String(parAuteur.code));
  const parTiers = await poster("/avis/" + son.id + "/signaler", form({}), autre.cookie);
  dire("un tiers non plus", parTiers.code === 404, String(parTiers.code));

  console.log(SAUT + "--- L'EQUIPE TRANCHE ---");
  dire("un employeur n'a pas l'ecran", (await lire("/admin/avis", emp.cookie)).status === 403);
  const ecranEquipe = await (await lire("/admin/avis", eq.cookie)).text();
  dire("l'equipe voit l'avis signale", ecranEquipe.includes("travail soigne"));
  dire("avec le nom de qui l'a ecrit", ecranEquipe.includes(emp.mail));

  const sansMotif = await poster("/admin/avis/" + son.id, form({ decision: "masquer" }), eq.cookie);
  dire("masquer sans motif est refuse", sansMotif.code === 400, String(sansMotif.code));
  dire("l'avis est toujours en ligne",
       base.prepare("SELECT masque FROM avis WHERE id = ?").get(son.id).masque === 0);

  const masque = await poster("/admin/avis/" + son.id,
    form({ decision: "masquer", motif: "Propos non verifiables" }), eq.cookie);
  dire("avec motif, il est masque", masque.code === 302, String(masque.code));
  const apres = base.prepare("SELECT * FROM avis WHERE id = ?").get(son.id);
  dire("il est marque masque", apres.masque === 1);
  dire("le motif est garde", String(apres.motif_masquage).includes("verifiables"));
  dire("qui a decide aussi", apres.masque_par === eq.id);
  // MASQUE, PAS SUPPRIME : la ligne reste, l'equipe peut s'expliquer.
  dire("la ligne reste en base", Boolean(apres));

  dire("il sort de la moyenne", reputation(elle.id).nombre === 1, String(reputation(elle.id).nombre));
  dire("la moyenne est recalculee", reputation(elle.id).moyenne === 4);
  const ficheApres = await (await lire("/personnes/" + elle.id)).text();
  dire("il disparait de la fiche", !ficheApres.includes("travail soigne"));

  console.log(SAUT + "--- LAISSER EN LIGNE EST AUSSI UNE DECISION ---");
  await poster("/avis/" + sien.id + "/signaler", form({}), emp.cookie);
  dire("l'avis est signale", base.prepare("SELECT signale FROM avis WHERE id = ?").get(sien.id).signale === 1);
  const rien = await poster("/admin/avis/" + sien.id, form({ decision: "rien" }), eq.cookie);
  dire("l'equipe le laisse", rien.code === 302);
  dire("il n'est plus signale", base.prepare("SELECT signale FROM avis WHERE id = ?").get(sien.id).signale === 0);
  dire("et pas masque", base.prepare("SELECT masque FROM avis WHERE id = ?").get(sien.id).masque === 0);
  dire("il compte toujours", reputation(emp.id).nombre === 1);

  console.log(SAUT + "--- NETTOYAGE ---");
  const n = base.prepare("DELETE FROM utilisateurs WHERE email LIKE ?").run("%" + M + "%").changes;
  console.log("  " + n + " comptes de test supprimes");

  console.log(SAUT + "RESULTAT : " + ok + " reussis, " + ko + " echec(s)");
  process.exit(ko === 0 ? 0 : 1);
}, 600);
