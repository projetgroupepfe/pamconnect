// Série : répondre à une demande coûte un jeton.
//
// Trois règles, et la troisième est la plus facile à casser :
//   - seule une personne vérifiée peut répondre ;
//   - le jeton part SEULEMENT si la réponse part vraiment ;
//   - trois réponses par 24 heures, quel que soit le solde.
//
// La série modifie les réglages : elle remet les valeurs d'origine à la
// fin, sinon elle laisserait la plateforme avec ses chiffres de test.
const PROJET = require("path").join(__dirname, "..");
process.chdir(PROJET);
require(PROJET + "/_serveur_test_temporaire.js");

const base = require(PROJET + "/node_modules/better-sqlite3")(PROJET + "/data/pamconnect.db");
base.pragma("foreign_keys = ON");

const RACINE = "http://127.0.0.1:3999";
const M = "test-reponse";
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

const formReglages = (o) => {
  const p = new URLSearchParams();
  p.append("jeton_valeur_fcfa", "100");
  [5, 10, 20, 60].forEach((q) => p.append("pack", String(q)));
  p.append("bienvenue_employeur", "10");
  p.append("bienvenue_prestataire", String(o.offerts === undefined ? 3 : o.offerts));
  p.append("bienvenue_jours", "60");
  p.append("cout_candidature", String(o.cout === undefined ? 1 : o.cout));
  p.append("cout_mise_en_avant", "20");
  p.append("candidatures_par_jour", String(o.parJour === undefined ? 3 : o.parJour));
  return p;
};

async function creerCompte(suffixe, role, verifier, extra) {
  const mail = (M + "-" + suffixe + "@example.com").toLowerCase();
  await poster("/inscription", form(Object.assign(
    { role, nom: "Test " + suffixe, email: mail, motdepasse: "motdepasse123", quartier: "Bastos" },
    extra || {})));
  const c = await poster("/connexion", form({ email: mail, motdepasse: "motdepasse123" }));
  base.prepare("UPDATE utilisateurs SET statut_verification = ? WHERE email = ?")
    .run(verifier ? "verifie" : "non soumis", mail);
  return {
    mail, cookie: c.cookie,
    id: base.prepare("SELECT id FROM utilisateurs WHERE email = ?").get(mail).id,
  };
}

async function publier(titre, prix, cookie) {
  await poster("/annonces", form({ titre: M + " " + titre, metier: "menagere",
    quartier: "Mvan", horaire: "Lundi 8h", prix: String(prix) }), cookie);
  return base.prepare("SELECT id FROM annonces WHERE titre = ? ORDER BY id DESC LIMIT 1")
    .get(M + " " + titre);
}

const solde = (id) => base.prepare(
  "SELECT COALESCE(SUM(quantite), 0) AS n FROM jetons_mouvements WHERE utilisateur_id = ?").get(id).n;

const depenses = (id) => base.prepare(
  "SELECT * FROM jetons_mouvements WHERE utilisateur_id = ? AND motif = 'candidature' ORDER BY id").all(id);

// Donne des jetons a quelqu'un sans passer par l'achat : la serie parle
// de la depense, pas de la vente.
const crediter = (id, n) => base.prepare(`
  INSERT INTO jetons_mouvements (utilisateur_id, quantite, nature, motif, detail)
  VALUES (?, ?, 'achete', 'achat', 'Credit de test')
`).run(id, n);

setTimeout(async () => {
  const reglagesInitiaux = base.prepare("SELECT cle, valeur FROM parametres").all();

  const eq = await creerCompte("eq", "employeur", true);
  base.prepare("UPDATE utilisateurs SET est_admin = 1 WHERE id = ?").run(eq.id);
  await poster("/admin/parametres", formReglages({}), eq.cookie);

  const emp = await creerCompte("emp", "employeur", true);
  const a1 = await publier("A1", 20000, emp.cookie);
  const a2 = await publier("A2", 15000, emp.cookie);
  const a3 = await publier("A3", 12000, emp.cookie);
  const a4 = await publier("A4", 9000, emp.cookie);

  console.log(SAUT + "--- SANS VERIFICATION, ON NE REPOND PAS ---");
  const pasVerifiee = await creerCompte("pasverif", "prestataire", false,
    { metier: "menagere", tarif: "15000" });
  crediter(pasVerifiee.id, 10);

  const ecranRefuse = await lire("/candidatures/nouvelle/" + a1.id, pasVerifiee.cookie);
  dire("l'ecran de reponse lui est ferme", ecranRefuse.status === 403, String(ecranRefuse.status));
  const envoiRefuse = await poster("/candidatures", form({ annonceId: String(a1.id) }), pasVerifiee.cookie);
  dire("l'envoi aussi", envoiRefuse.code === 403, String(envoiRefuse.code));
  dire("aucun jeton preleve", solde(pasVerifiee.id) === 10, String(solde(pasVerifiee.id)));
  dire("aucune reponse enregistree",
       base.prepare("SELECT COUNT(*) n FROM candidatures WHERE prestataire_id = ?")
         .get(pasVerifiee.id).n === 0);
  // Pas la raison de l employeur : la sienne. Le fragment evite les
  // apostrophes, que EJS remplace par leur code HTML.
  dire("la raison qui la concerne lui est dite",
       envoiRefuse.corps.includes("il a le droit de savoir qui vient"));
  dire("et pas celle de l autre role",
       !envoiRefuse.corps.includes("se déplaceront chez vous"));

  console.log(SAUT + "--- LE COUT EST ANNONCE AVANT DE S'ENGAGER ---");
  const elle = await creerCompte("elle", "prestataire", true,
    { metier: "menagere", tarif: "15000" });
  const avant = await (await lire("/candidatures/nouvelle/" + a1.id, elle.cookie)).text();
  dire("elle a recu ses jetons offerts", solde(elle.id) === 3, String(solde(elle.id)));
  dire("le cout est ecrit", avant.includes("Envoyer cette réponse"));
  dire("en jetons et en francs", avant.includes("1 jeton (100 FCFA)"));
  dire("ce qu'il restera aussi", avant.includes("Il vous restera"));
  dire("la limite du jour est dite avant", avant.includes("par tranche de 24 heures"));

  console.log(SAUT + "--- REPONDRE PRELEVE UN JETON ---");
  const envoi = await poster("/candidatures", form({ annonceId: String(a1.id) }), elle.cookie);
  dire("la reponse part", envoi.code === 200, String(envoi.code));
  dire("un jeton est preleve", solde(elle.id) === 2, String(solde(elle.id)));
  dire("le prelevement est trace", depenses(elle.id).length === 1);
  dire("il est negatif", depenses(elle.id)[0].quantite === -1);
  dire("il porte le nom de la demande",
       String(depenses(elle.id)[0].detail).includes("A1"));
  dire("il est rattache a l'annonce", depenses(elle.id)[0].annonce_id === a1.id);
  dire("les jetons offerts partent en premier", depenses(elle.id)[0].nature === "offert");
  dire("la page le dit", envoi.corps.includes("Il vous reste"));

  console.log(SAUT + "--- RIEN N'EST PRELEVE POUR RIEN ---");
  // Repondre deux fois a la meme demande : refuse, et gratuit.
  const doublon = await poster("/candidatures", form({ annonceId: String(a1.id) }), elle.cookie);
  dire("le doublon est refuse", doublon.code === 409, String(doublon.code));
  dire("aucun jeton de plus", solde(elle.id) === 2, String(solde(elle.id)));

  // Une demande retiree : refuse, et gratuit.
  await poster("/annonces/" + a4.id + "/annuler", form({}), emp.cookie);
  const fermee = await poster("/candidatures", form({ annonceId: String(a4.id) }), elle.cookie);
  dire("une demande retiree est refusee", fermee.code === 410, String(fermee.code));
  dire("toujours aucun jeton de plus", solde(elle.id) === 2, String(solde(elle.id)));

  console.log(SAUT + "--- SANS JETON, PAS DE REPONSE ---");
  const fauchee = await creerCompte("fauchee", "prestataire", true,
    { metier: "menagere", tarif: "15000" });
  // On lui retire ses jetons offerts pour la mettre a zero.
  base.prepare(`
    INSERT INTO jetons_mouvements (utilisateur_id, quantite, nature, motif, detail)
    VALUES (?, -3, 'offert', 'expiration', 'Mise a zero de test')
  `).run(fauchee.id);
  await lire("/mes-jetons", fauchee.cookie);
  dire("son solde est vide", solde(fauchee.id) === 0, String(solde(fauchee.id)));

  const sansJeton = await poster("/candidatures", form({ annonceId: String(a1.id) }), fauchee.cookie);
  dire("l'envoi est refuse", sansJeton.code === 402, String(sansJeton.code));
  dire("on lui dit combien il faut", sansJeton.corps.includes("1 jeton (100 FCFA)"));
  dire("aucune reponse n'est enregistree",
       base.prepare("SELECT COUNT(*) n FROM candidatures WHERE prestataire_id = ?")
         .get(fauchee.id).n === 0);

  console.log(SAUT + "--- TROIS REPONSES PAR 24 HEURES ---");
  // Elle a deja repondu une fois. Deux de plus, puis la porte se ferme -
  // meme avec des jetons plein le compte.
  crediter(elle.id, 50);
  await poster("/candidatures", form({ annonceId: String(a2.id) }), elle.cookie);
  await poster("/candidatures", form({ annonceId: String(a3.id) }), elle.cookie);
  dire("les trois sont passees",
       base.prepare("SELECT COUNT(*) n FROM candidatures WHERE prestataire_id = ?")
         .get(elle.id).n === 3);

  const a5 = await publier("A5", 8000, emp.cookie);
  const quatrieme = await poster("/candidatures", form({ annonceId: String(a5.id) }), elle.cookie);
  dire("la quatrieme est refusee", quatrieme.code === 429, String(quatrieme.code));
  dire("malgre un solde confortable", solde(elle.id) > 10, String(solde(elle.id)));
  dire("la raison est donnee", quatrieme.corps.includes("limite du jour"));
  dire("et le moment ou elle pourra reprendre",
       quatrieme.corps.includes("Vous pourrez répondre à nouveau dans"));
  dire("aucun jeton preleve pour un refus",
       depenses(elle.id).filter((d) => d.quantite < 0).length === 3);

  console.log(SAUT + "--- LA FENETRE GLISSE ---");
  // On recule la plus ancienne des trois : une place se libere.
  base.prepare(`
    UPDATE candidatures SET envoyee_le = datetime('now', '-2 day')
    WHERE prestataire_id = ? AND annonce_id = ?
  `).run(elle.id, a1.id);

  const cinquieme = await poster("/candidatures", form({ annonceId: String(a5.id) }), elle.cookie);
  dire("elle peut de nouveau repondre", cinquieme.code === 200, String(cinquieme.code));

  console.log(SAUT + "--- RENVOYER UNE REPONSE REFUSEE COUTE AUSSI ---");
  // Sinon un refus pourrait etre suivi de renvois sans fin, gratuitement.
  const cand = base.prepare(
    "SELECT id FROM candidatures WHERE prestataire_id = ? AND annonce_id = ?").get(elle.id, a2.id);
  await poster("/candidatures/statut",
    form({ candidatureId: String(cand.id), statut: "refusee" }), emp.cookie);

  const avantRenvoi = solde(elle.id);
  base.prepare("UPDATE candidatures SET envoyee_le = datetime('now', '-2 day') WHERE prestataire_id = ?")
    .run(elle.id);
  const renvoi = await poster("/candidatures", form({ annonceId: String(a2.id) }), elle.cookie);
  dire("le renvoi passe", renvoi.code === 200, String(renvoi.code));
  dire("il coute un jeton", solde(elle.id) === avantRenvoi - 1,
       avantRenvoi + " -> " + solde(elle.id));
  dire("et il compte comme un envoi",
       base.prepare(`SELECT COUNT(*) n FROM candidatures
                     WHERE prestataire_id = ? AND envoyee_le >= datetime('now','-1 day')`)
         .get(elle.id).n === 1);

  console.log(SAUT + "--- L'EQUIPE REGLE LE COUT ET LA LIMITE ---");
  const majOk = await poster("/admin/parametres", formReglages({ cout: 2, parJour: 5 }), eq.cookie);
  dire("les reglages passent", majOk.code === 302, String(majOk.code));
  const ecranCout = await (await lire("/candidatures/nouvelle/" + a3.id, elle.cookie)).text();
  dire("le nouveau cout s'affiche", ecranCout.includes("2 jetons (200 FCFA)"));
  dire("et la nouvelle limite", ecranCout.includes("5 réponses par tranche"));

  const zeroJour = await poster("/admin/parametres", formReglages({ parJour: 0 }), eq.cookie);
  dire("zero reponse par jour est refuse", zeroJour.code === 400, String(zeroJour.code));

  await poster("/admin/parametres", formReglages({}), eq.cookie);

  console.log(SAUT + "--- NETTOYAGE ---");
  reglagesInitiaux.forEach((p) =>
    base.prepare("UPDATE parametres SET valeur = ?, modifie_par = NULL, modifie_le = NULL WHERE cle = ?")
      .run(p.valeur, p.cle));
  console.log("  reglages d'origine remis");
  const n = base.prepare("DELETE FROM utilisateurs WHERE email LIKE ?").run("%" + M + "%").changes;
  console.log("  " + n + " comptes de test supprimes");

  console.log(SAUT + "RESULTAT : " + ok + " reussis, " + ko + " echec(s)");
  process.exit(ko === 0 ? 0 : 1);
}, 600);
