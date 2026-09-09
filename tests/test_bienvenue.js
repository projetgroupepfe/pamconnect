// Série : les jetons de bienvenue.
//
// Trois règles à tenir, et elles se contredisent facilement :
//   - offerts une SEULE fois par compte, jamais deux ;
//   - seulement après vérification d'identité, jamais avant ;
//   - ils EXPIRENT, et les jetons achetés jamais.
//
// La série modifie les réglages : elle remet les valeurs d'origine à la
// fin, sinon elle laisserait la plateforme avec ses chiffres de test.
const PROJET = require("path").join(__dirname, "..");
process.chdir(PROJET);
require(PROJET + "/_serveur_test_temporaire.js");

const base = require(PROJET + "/node_modules/better-sqlite3")(PROJET + "/data/pamconnect.db");
base.pragma("foreign_keys = ON");

const RACINE = "http://127.0.0.1:3999";
const M = "test-bienvenue";
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

// Le formulaire des reglages envoie TOUT ensemble : les prix et les
// jetons offerts. En omettre un reviendrait a l'effacer.
const formReglages = (o) => {
  const p = new URLSearchParams();
  p.append("jeton_valeur_fcfa", String(o.valeur === undefined ? 100 : o.valeur));
  (o.packs || [5, 10, 30, 60]).forEach((q) => p.append("pack", String(q)));
  p.append("bienvenue_employeur", String(o.employeur === undefined ? 10 : o.employeur));
  p.append("bienvenue_prestataire", String(o.prestataire === undefined ? 3 : o.prestataire));
  p.append("bienvenue_jours", String(o.jours === undefined ? 60 : o.jours));
  return p;
};

// verifier = false laisse le compte non verifie : c'est le cas qui ne
// doit RIEN recevoir.
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

const solde = (id) => base.prepare(
  "SELECT COALESCE(SUM(quantite), 0) AS n FROM jetons_mouvements WHERE utilisateur_id = ?").get(id).n;

const mouvements = (id, motif) => base.prepare(
  "SELECT * FROM jetons_mouvements WHERE utilisateur_id = ? AND motif = ? ORDER BY id").all(id, motif);

const ouvrir = async (cookie) => (await lire("/mes-jetons", cookie)).text();

setTimeout(async () => {
  const reglagesInitiaux = base.prepare("SELECT cle, valeur FROM parametres").all();

  const eq = await creerCompte("eq", "employeur", true);
  base.prepare("UPDATE utilisateurs SET est_admin = 1 WHERE id = ?").run(eq.id);

  // On part de reglages connus : la serie ne doit pas dependre de ce que
  // l'equipe a regle sur cette base.
  await poster("/admin/parametres", formReglages({}), eq.cookie);

  console.log(SAUT + "--- PAS DE JETONS SANS VERIFICATION ---");
  const pasVerifie = await creerCompte("neuf", "prestataire", false,
    { metier: "menagere", tarif: "15000" });
  let page = await ouvrir(pasVerifie.cookie);
  dire("aucun jeton offert", solde(pasVerifie.id) === 0, String(solde(pasVerifie.id)));
  dire("aucun mouvement ecrit", mouvements(pasVerifie.id, "bienvenue").length === 0);
  dire("la page dit ce qui manque", page.includes("dès que votre identité aura été vérifiée"));
  dire("et propose la verification", page.includes("Faire vérifier mon identité"));

  console.log(SAUT + "--- LA VERIFICATION DECLENCHE LE CADEAU ---");
  base.prepare("UPDATE utilisateurs SET statut_verification = 'verifie' WHERE id = ?")
    .run(pasVerifie.id);
  page = await ouvrir(pasVerifie.cookie);
  dire("trois jetons sont offerts", solde(pasVerifie.id) === 3, String(solde(pasVerifie.id)));
  const cadeau = mouvements(pasVerifie.id, "bienvenue")[0];
  dire("un seul mouvement", mouvements(pasVerifie.id, "bienvenue").length === 1);
  dire("de nature offerte", cadeau.nature === "offert");
  dire("avec une date limite", typeof cadeau.expire_le === "string" && cadeau.expire_le.length > 0);
  dire("la page l'annonce", page.includes("Bienvenue"));
  dire("elle dit combien de jours", page.includes("60 jours"));

  console.log(SAUT + "--- UNE SEULE FOIS DANS LA VIE DU COMPTE ---");
  await ouvrir(pasVerifie.cookie);
  await ouvrir(pasVerifie.cookie);
  page = await ouvrir(pasVerifie.cookie);
  dire("le solde n'a pas bouge", solde(pasVerifie.id) === 3, String(solde(pasVerifie.id)));
  dire("toujours un seul cadeau", mouvements(pasVerifie.id, "bienvenue").length === 1);
  dire("la page ne le reannonce pas", !page.includes("Bienvenue :"));

  console.log(SAUT + "--- L'EMPLOYEUR N'A PAS LE MEME NOMBRE ---");
  const emp = await creerCompte("emp", "employeur", true);
  await ouvrir(emp.cookie);
  dire("dix jetons pour un employeur", solde(emp.id) === 10, String(solde(emp.id)));

  console.log(SAUT + "--- CE QUI EXPIRE, ET CE QUI N'EXPIRE PAS ---");
  // On ajoute des jetons achetes a cote des jetons offerts : seuls les
  // seconds doivent disparaitre.
  base.prepare(`
    INSERT INTO jetons_mouvements (utilisateur_id, quantite, nature, motif, detail)
    VALUES (?, 20, 'achete', 'achat', 'Pack de test')
  `).run(pasVerifie.id);
  dire("le solde cumule les deux", solde(pasVerifie.id) === 23, String(solde(pasVerifie.id)));

  // On force la date limite dans le passe : c'est le seul moyen de
  // verifier une regle qui ne se declenche qu'au bout de 60 jours.
  base.prepare(`
    UPDATE jetons_mouvements SET expire_le = datetime('now', '-1 day')
    WHERE utilisateur_id = ? AND motif = 'bienvenue'
  `).run(pasVerifie.id);

  page = await ouvrir(pasVerifie.cookie);
  dire("les jetons offerts sont perdus", solde(pasVerifie.id) === 20, String(solde(pasVerifie.id)));
  dire("les jetons achetes sont intacts",
       base.prepare(`SELECT COALESCE(SUM(quantite),0) n FROM jetons_mouvements
                     WHERE utilisateur_id = ? AND nature = 'achete'`).get(pasVerifie.id).n === 20);
  const perte = mouvements(pasVerifie.id, "expiration")[0];
  dire("une ligne d'expiration est ecrite", Boolean(perte));
  dire("elle est negative", perte.quantite === -3, String(perte.quantite));
  dire("la page le dit", page.includes("Jetons offerts expirés"));

  console.log(SAUT + "--- LE CADEAU N'EST PAS RENDU APRES EXPIRATION ---");
  // Sinon il suffirait d'attendre 60 jours pour en recevoir de nouveaux.
  await ouvrir(pasVerifie.cookie);
  page = await ouvrir(pasVerifie.cookie);
  dire("aucun nouveau cadeau", mouvements(pasVerifie.id, "bienvenue").length === 1);
  dire("aucune expiration en double", mouvements(pasVerifie.id, "expiration").length === 1);
  dire("le solde reste celui des jetons achetes", solde(pasVerifie.id) === 20);

  console.log(SAUT + "--- L'EQUIPE PEUT CHANGER LES NOMBRES ---");
  const majReglages = await poster("/admin/parametres",
    formReglages({ prestataire: 5, jours: 30 }), eq.cookie);
  dire("les reglages sont enregistres", majReglages.code === 302, String(majReglages.code));

  const apres = await creerCompte("apres", "prestataire", true,
    { metier: "menagere", tarif: "12000" });
  page = await ouvrir(apres.cookie);
  dire("le nouveau nombre s'applique", solde(apres.id) === 5, String(solde(apres.id)));
  dire("et la nouvelle duree", page.includes("30 jours"));
  dire("celle d'avant ne bouge pas", solde(pasVerifie.id) === 20);

  console.log(SAUT + "--- ZERO JETON OFFERT EST UN CHOIX VALIDE ---");
  await poster("/admin/parametres", formReglages({ prestataire: 0 }), eq.cookie);
  const rien = await creerCompte("rien", "prestataire", true,
    { metier: "menagere", tarif: "12000" });
  await ouvrir(rien.cookie);
  dire("personne ne recoit rien", solde(rien.id) === 0, String(solde(rien.id)));
  dire("et aucun mouvement n'est ecrit", mouvements(rien.id, "bienvenue").length === 0);

  console.log(SAUT + "--- UNE DUREE DE ZERO JOUR EST REFUSEE ---");
  // Elle voudrait dire "perimes en arrivant" : c'est un piege, pas un
  // reglage. Pour ne rien offrir, on met le NOMBRE a zero.
  const dureeAvant =
    base.prepare("SELECT valeur FROM parametres WHERE cle = 'bienvenue_jours'").get().valeur;
  const dureeNulle = await poster("/admin/parametres", formReglages({ jours: 0 }), eq.cookie);
  dire("le formulaire la refuse", dureeNulle.code === 400, String(dureeNulle.code));
  dire("l'ancienne duree tient",
       base.prepare("SELECT valeur FROM parametres WHERE cle = 'bienvenue_jours'").get().valeur
         === dureeAvant, dureeAvant);

  const negatif = await poster("/admin/parametres", formReglages({ employeur: -5 }), eq.cookie);
  dire("un nombre negatif est refuse", negatif.code === 400, String(negatif.code));

  console.log(SAUT + "--- L'EQUIPE N'EN RECOIT PAS ---");
  // Un membre de l'equipe ne publie ni ne repond : la page lui est
  // fermee, et rien ne doit lui etre credite en douce.
  dire("la page lui est refusee", (await lire("/mes-jetons", eq.cookie)).status === 403);
  dire("son solde est reste vide", solde(eq.id) === 0, String(solde(eq.id)));

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
