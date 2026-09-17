// Série : mettre une demande en avant.
//
// Ce qui doit tenir :
//   - seul le propriétaire de la demande peut la mettre en avant ;
//   - les jetons ne partent que si la demande passe vraiment devant ;
//   - elle passe devant les demandes DU MÊME MÉTIER, jamais devant
//     celles d'un autre — on ne paie pas pour tromper quelqu'un sur ce
//     qu'il cherche ;
//   - le badge est affiché : une liste qui se réordonne contre argent
//     doit le dire ;
//   - au bout des jours prévus, la demande reprend sa place toute seule.
const PROJET = require("path").join(__dirname, "..");
process.chdir(PROJET);
require(PROJET + "/_serveur_test_temporaire.js");

const base = require(PROJET + "/node_modules/better-sqlite3")(PROJET + "/data/pamconnect.db");
base.pragma("foreign_keys = ON");

const RACINE = "http://127.0.0.1:3999";
const M = "test-avant";
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
  p.append("bienvenue_prestataire", "3");
  p.append("bienvenue_jours", "60");
  p.append("cout_candidature", "1");
  p.append("cout_mise_en_avant", String(o.cout === undefined ? 20 : o.cout));
  p.append("candidatures_par_jour", "3");
  p.append("duree_mise_en_avant_jours", String(o.jours === undefined ? 7 : o.jours));
  return p;
};

async function creerCompte(suffixe, role, extra) {
  const mail = (M + "-" + suffixe + "@example.com").toLowerCase();
  await poster("/inscription", form(Object.assign(
    { role, nom: "Test " + suffixe, email: mail, motdepasse: "motdepasse123", telephone: "600000000", quartier: "Bastos" },
    extra || {})));
  const c = await poster("/connexion", form({ email: mail, motdepasse: "motdepasse123", telephone: "600000000" }));
  base.prepare("UPDATE utilisateurs SET statut_verification = 'verifie' WHERE email = ?").run(mail);
  return {
    mail, cookie: c.cookie,
    id: base.prepare("SELECT id FROM utilisateurs WHERE email = ?").get(mail).id,
  };
}

async function publier(titre, metier, prix, cookie) {
  await poster("/annonces", form({ titre: M + " " + titre, metier,
    quartier: "Mvan", horaire: "Lundi 8h", prix: String(prix) }), cookie);
  return base.prepare("SELECT id, titre FROM annonces WHERE titre = ? ORDER BY id DESC LIMIT 1")
    .get(M + " " + titre);
}

const solde = (id) => base.prepare(
  "SELECT COALESCE(SUM(quantite), 0) AS n FROM jetons_mouvements WHERE utilisateur_id = ?").get(id).n;

const crediter = (id, n) => base.prepare(`
  INSERT INTO jetons_mouvements (utilisateur_id, quantite, nature, motif, detail)
  VALUES (?, ?, 'achete', 'achat', 'Credit de test')
`).run(id, n);

const enAvant = (id) => base.prepare(`
  SELECT mise_en_avant_jusqu_au AS fin,
         (mise_en_avant_jusqu_au IS NOT NULL
          AND mise_en_avant_jusqu_au > datetime('now')) AS actif
  FROM annonces WHERE id = ?`).get(id);

// La position d'une demande dans la liste : plus le nombre est petit,
// plus elle est haut.
const rang = (page, titre) => page.indexOf(titre);

setTimeout(async () => {
  const reglagesInitiaux = base.prepare("SELECT cle, valeur FROM parametres").all();

  const eq = await creerCompte("eq", "employeur");
  base.prepare("UPDATE utilisateurs SET est_admin = 1 WHERE id = ?").run(eq.id);
  await poster("/admin/parametres", formReglages({}), eq.cookie);

  const emp = await creerCompte("emp", "employeur");
  const autre = await creerCompte("autre", "employeur");
  const elle = await creerCompte("elle", "prestataire", { metier: "menagere", tarif: "15000" });

  // Trois demandes de menage, publiees dans cet ordre : la plus recente
  // est en tete tant que personne ne paie.
  const m1 = await publier("Menage1", "menagere", 10000, emp.cookie);
  const m2 = await publier("Menage2", "menagere", 12000, emp.cookie);
  const m3 = await publier("Menage3", "menagere", 15000, emp.cookie);

  console.log(SAUT + "--- SEUL LE PROPRIETAIRE PEUT METTRE EN AVANT ---");
  crediter(autre.id, 50);
  const vol = await poster("/annonces/" + m1.id + "/mettre-en-avant", form({}), autre.cookie);
  dire("un autre employeur recoit 404", vol.code === 404, String(vol.code));
  dire("aucun jeton ne lui est preleve", solde(autre.id) === 50, String(solde(autre.id)));
  dire("la demande n'est pas en avant", enAvant(m1.id).actif === 0);

  const ecranVole = await lire("/annonces/" + m1.id + "/mettre-en-avant", autre.cookie);
  dire("l'ecran lui est ferme aussi", ecranVole.status === 404, String(ecranVole.status));

  const parElle = await poster("/annonces/" + m1.id + "/mettre-en-avant", form({}), elle.cookie);
  dire("une personne qui propose ses services recoit 404", parElle.code === 404, String(parElle.code));

  dire("l'equipe n'a pas cet ecran",
       (await lire("/annonces/" + m1.id + "/mettre-en-avant", eq.cookie)).status === 403);

  console.log(SAUT + "--- SANS JETONS, RIEN NE SE PASSE ---");
  // Il a recu 10 jetons offerts, une mise en avant en coute 20.
  dire("son solde ne suffit pas", solde(emp.id) < 20, String(solde(emp.id)));
  const sansAssez = await poster("/annonces/" + m1.id + "/mettre-en-avant", form({}), emp.cookie);
  dire("l'envoi est refuse", sansAssez.code === 402, String(sansAssez.code));
  dire("on lui dit combien il faut", sansAssez.corps.includes("20 jetons (2 000 FCFA)"));
  dire("la demande n'est pas en avant", enAvant(m1.id).actif === 0);

  console.log(SAUT + "--- L'ECRAN DIT TOUT AVANT DE CONFIRMER ---");
  crediter(emp.id, 50);
  const ecran = await (await lire("/annonces/" + m1.id + "/mettre-en-avant", emp.cookie)).text();
  dire("le cout est ecrit", ecran.includes("20 jetons (2 000 FCFA)"));
  dire("la duree aussi", ecran.includes("7 jours"));
  dire("ce qu'il restera", ecran.includes("Il vous restera"));
  dire("le badge est annonce", ecran.includes("Mise en avant"));
  dire("et ce que la mise en avant NE fait pas", ecran.includes("autre métier"));
  dire("le non-remboursement est dit avant", ecran.includes("ne sont pas rendus"));

  console.log(SAUT + "--- LA MISE EN AVANT PRELEVE ET DATE ---");
  const avant = solde(emp.id);
  const pose = await poster("/annonces/" + m1.id + "/mettre-en-avant", form({}), emp.cookie);
  dire("elle aboutit", pose.code === 200, String(pose.code));
  dire("vingt jetons sont preleves", solde(emp.id) === avant - 20, avant + " -> " + solde(emp.id));
  dire("la demande est en avant", enAvant(m1.id).actif === 1);

  const mouvement = base.prepare(`
    SELECT * FROM jetons_mouvements WHERE utilisateur_id = ? AND motif = 'mise_en_avant'
    ORDER BY id DESC LIMIT 1`).get(emp.id);
  dire("le prelevement est trace", Boolean(mouvement));
  dire("il porte le nom de la demande", String(mouvement.detail).includes("Menage1"));
  dire("il est rattache a la demande", mouvement.annonce_id === m1.id);

  const jours = base.prepare(`
    SELECT julianday(mise_en_avant_jusqu_au) - julianday('now') AS j FROM annonces WHERE id = ?`)
    .get(m1.id).j;
  dire("elle dure sept jours", jours > 6.9 && jours <= 7, String(Math.round(jours * 10) / 10));

  console.log(SAUT + "--- ELLE PASSE DEVANT LES AUTRES DU MEME METIER ---");
  // Menage1 est la PLUS ANCIENNE des trois : sans la mise en avant, elle
  // serait derniere. C'est ce qui rend le test concluant.
  const liste = await (await lire("/annonces", elle.cookie)).text();
  dire("elle est passee devant la plus recente",
       rang(liste, M + " Menage1") < rang(liste, M + " Menage3"),
       "Menage1 " + rang(liste, M + " Menage1") + " / Menage3 " + rang(liste, M + " Menage3"));
  dire("et devant l'autre aussi",
       rang(liste, M + " Menage1") < rang(liste, M + " Menage2"));
  dire("le badge est affiche dans la liste", liste.includes("Mise en avant"));

  console.log(SAUT + "--- MAIS JAMAIS DEVANT UN AUTRE METIER ---");
  // Elle est menagere : les demandes de menage restent au-dessus des
  // autres, meme si une demande de jardinage est mise en avant.
  const j1 = await publier("Jardin1", "jardinier", 9000, autre.cookie);
  await poster("/annonces/" + j1.id + "/mettre-en-avant", form({}), autre.cookie);
  dire("la demande de jardinage est bien en avant", enAvant(j1.id).actif === 1);

  const liste2 = await (await lire("/annonces", elle.cookie)).text();
  dire("son metier reste au-dessus",
       rang(liste2, M + " Menage2") < rang(liste2, M + " Jardin1"),
       "Menage2 " + rang(liste2, M + " Menage2") + " / Jardin1 " + rang(liste2, M + " Jardin1"));

  console.log(SAUT + "--- ON NE PAIE PAS DEUX FOIS ---");
  const rejoue = await poster("/annonces/" + m1.id + "/mettre-en-avant", form({}), emp.cookie);
  dire("la seconde fois est refusee", rejoue.code === 409, String(rejoue.code));
  dire("elle dit jusqu a quand", rejoue.corps.includes("Elle le reste"));
  const soldeApres = solde(emp.id);
  dire("aucun jeton de plus", soldeApres === avant - 20, String(soldeApres));

  const ecranDeja = await (await lire("/annonces/" + m1.id + "/mettre-en-avant", emp.cookie)).text();
  dire("l'ecran ne propose plus le bouton", !ecranDeja.includes("Confirmer la mise en avant"));

  console.log(SAUT + "--- UNE DEMANDE FERMEE NE SE MET PAS EN AVANT ---");
  const m4 = await publier("Menage4", "menagere", 8000, emp.cookie);
  await poster("/annonces/" + m4.id + "/annuler", form({}), emp.cookie);
  const surFermee = await poster("/annonces/" + m4.id + "/mettre-en-avant", form({}), emp.cookie);
  dire("l'envoi est refuse", surFermee.code === 409, String(surFermee.code));
  dire("aucun jeton preleve", solde(emp.id) === soldeApres, String(solde(emp.id)));

  console.log(SAUT + "--- AU BOUT DU DELAI, ELLE REPREND SA PLACE ---");
  // On recule la date de fin : c'est le seul moyen de verifier une regle
  // qui ne se declenche qu'au bout de sept jours.
  base.prepare("UPDATE annonces SET mise_en_avant_jusqu_au = datetime('now', '-1 hour') WHERE id = ?")
    .run(m1.id);
  dire("elle n'est plus en avant", enAvant(m1.id).actif === 0);

  const liste3 = await (await lire("/annonces", elle.cookie)).text();
  dire("la plus recente repasse devant",
       rang(liste3, M + " Menage3") < rang(liste3, M + " Menage1"),
       "Menage3 " + rang(liste3, M + " Menage3") + " / Menage1 " + rang(liste3, M + " Menage1"));
  dire("son badge a disparu",
       !liste3.slice(rang(liste3, M + " Menage1"), rang(liste3, M + " Menage1") + 400)
         .includes("Mise en avant"));
  dire("aucun jeton n'est rendu", solde(emp.id) === soldeApres, String(solde(emp.id)));

  console.log(SAUT + "--- ELLE PEUT ETRE REMISE EN AVANT ENSUITE ---");
  const encore = await poster("/annonces/" + m1.id + "/mettre-en-avant", form({}), emp.cookie);
  dire("la remise en avant passe", encore.code === 200, String(encore.code));
  dire("vingt jetons de plus sont preleves", solde(emp.id) === soldeApres - 20, String(solde(emp.id)));

  console.log(SAUT + "--- L'EQUIPE REGLE LE COUT ET LA DUREE ---");
  const maj = await poster("/admin/parametres", formReglages({ cout: 5, jours: 2 }), eq.cookie);
  dire("les reglages passent", maj.code === 302, String(maj.code));
  const m5 = await publier("Menage5", "menagere", 7000, emp.cookie);
  const ecran2 = await (await lire("/annonces/" + m5.id + "/mettre-en-avant", emp.cookie)).text();
  dire("le nouveau cout s'affiche", ecran2.includes("5 jetons (500 FCFA)"));
  dire("et la nouvelle duree", ecran2.includes("2 jours"));

  const zero = await poster("/admin/parametres", formReglages({ jours: 0 }), eq.cookie);
  dire("une duree nulle est refusee", zero.code === 400, String(zero.code));

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
