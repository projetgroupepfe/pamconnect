// Série : proposer une demande à une personne.
//
// Un employeur trouve quelqu'un dans la recherche et publie sa demande
// POUR cette personne. Quatre règles :
//   - on ne propose une demande qu'à une personne vérifiée ;
//   - cette personne la voit en premier, et la demande reste ouverte aux
//     autres ;
//   - sa première réponse ne coûte pas de jeton et ne compte pas dans la
//     limite du jour ;
//   - une réponse refusée puis renvoyée redevient un envoi ordinaire.
//
// La série modifie les réglages : elle remet les valeurs d'origine à la
// fin.
const PROJET = require("path").join(__dirname, "..");
process.chdir(PROJET);
require(PROJET + "/_serveur_test_temporaire.js");

const base = require(PROJET + "/node_modules/better-sqlite3")(PROJET + "/data/pamconnect.db");
base.pragma("foreign_keys = ON");

const RACINE = "http://127.0.0.1:3999";
const M = "test-invitation";
let ok = 0, ko = 0;

const SAUT = String.fromCharCode(10);

const dire = (nom, cond, detail) => {
  if (cond) { ok++; console.log("  OK    | " + nom); }
  else { ko++; console.log("  ECHEC | " + nom + (detail ? "   -> " + detail : "")); }
};

const form = (o) => new URLSearchParams(o);
const uneLigne = (texte) => texte.replace(/\s+/g, " ");

async function page(chemin, cookie) {
  const r = await fetch(RACINE + chemin, { headers: cookie ? { Cookie: cookie } : {}, redirect: "manual" });
  return { code: r.status, texte: uneLigne(await r.text()) };
}

async function poster(chemin, corps, cookie) {
  const entetes = {};
  if (cookie) entetes.Cookie = cookie;
  const r = await fetch(RACINE + chemin, { method: "POST", body: corps, headers: entetes, redirect: "manual" });
  const sc = r.headers.getSetCookie();
  return { code: r.status, corps: uneLigne(await r.text()), cookie: sc.length ? sc[0].split(";")[0] : null };
}

// Les appels de l'application : du JSON, avec le cookie de la session.
async function json(chemin, corps, cookie) {
  const r = await fetch(RACINE + chemin, {
    method: corps === undefined ? "GET" : "POST",
    headers: Object.assign({ "Content-Type": "application/json" }, cookie ? { Cookie: cookie } : {}),
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  const brut = await r.text();
  let donnees = null;
  try { donnees = JSON.parse(brut); } catch (e) { donnees = null; }
  return { code: r.status, donnees, brut };
}

const formReglages = (o) => {
  const p = new URLSearchParams();
  p.append("jeton_valeur_fcfa", "100");
  [5, 10, 20, 60].forEach((q) => p.append("pack", String(q)));
  p.append("bienvenue_employeur", "10");
  p.append("bienvenue_prestataire", "0");
  p.append("bienvenue_jours", "60");
  p.append("cout_candidature", "1");
  p.append("cout_mise_en_avant", "20");
  p.append("candidatures_par_jour", String(o.parJour));
  p.append("duree_mise_en_avant_jours", "7");
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
    mail, cookie: c.cookie, nom: "Test " + suffixe,
    id: base.prepare("SELECT id FROM utilisateurs WHERE email = ?").get(mail).id,
  };
}

const champs = (titre, pour) => Object.assign(
  { titre: M + " " + titre, metier: "menagere", quartier: "Mvan", horaire: "Lundi 8h", prix: "10000" },
  pour === undefined ? {} : { pour: String(pour) });

const annonceNommee = (titre) => base.prepare(
  "SELECT id, personne_invitee_id FROM annonces WHERE titre = ? ORDER BY id DESC LIMIT 1").get(M + " " + titre);

const solde = (id) => base.prepare(
  "SELECT COALESCE(SUM(quantite), 0) AS n FROM jetons_mouvements WHERE utilisateur_id = ?").get(id).n;

const crediter = (id, n) => base.prepare(`
  INSERT INTO jetons_mouvements (utilisateur_id, quantite, nature, motif, detail)
  VALUES (?, ?, 'achete', 'achat', 'Credit de test')
`).run(id, n);

setTimeout(async () => {
  const reglagesInitiaux = base.prepare("SELECT cle, valeur FROM parametres").all();

  const eq = await creerCompte("eq", "employeur", true);
  base.prepare("UPDATE utilisateurs SET est_admin = 1 WHERE id = ?").run(eq.id);
  await poster("/admin/parametres", formReglages({ parJour: 2 }), eq.cookie);

  const emp = await creerCompte("emp", "employeur", true);
  const elle = await creerCompte("invitee", "prestataire", true, { metier: "menagere", tarif: "15000" });
  const autre = await creerCompte("autre", "prestataire", true, { metier: "menagere", tarif: "15000" });
  const pasVerifiee = await creerCompte("pasverif", "prestataire", false, { metier: "menagere", tarif: "15000" });
  const metierOfficiel = base.prepare("SELECT metier FROM utilisateurs WHERE id = ?").get(elle.id).metier;

  console.log(SAUT + "--- LA FICHE : PROPOSER, SEULEMENT A UNE PERSONNE VERIFIEE ---");
  const ficheVerifiee = await page("/personnes/" + elle.id, emp.cookie);
  dire("l'employeur voit le bouton pour cette personne",
       ficheVerifiee.texte.includes('href="/publier-annonce?pour=' + elle.id + '"') &&
       ficheVerifiee.texte.includes("Publier une demande pour cette personne"));
  dire("et la phrase qui dit ce que cela change",
       ficheVerifiee.texte.includes("elle la verra en premier"));

  const ficheNonVerifiee = await page("/personnes/" + pasVerifiee.id, emp.cookie);
  dire("pas de proposition a une personne non verifiee",
       !ficheNonVerifiee.texte.includes("?pour=") && ficheNonVerifiee.texte.includes("Publier une demande"));

  const ficheVisiteur = await page("/personnes/" + elle.id);
  dire("un visiteur ne voit pas le bouton", !ficheVisiteur.texte.includes("?pour="));
  const ficheParElle = await page("/personnes/" + autre.id, elle.cookie);
  dire("une personne qui repond non plus", !ficheParElle.texte.includes("?pour="));

  const apiFiche = await json("/api/personnes/" + elle.id, undefined, emp.cookie);
  dire("l'application le sait aussi", apiFiche.donnees && apiFiche.donnees.peutProposer === true, apiFiche.brut);
  const apiFicheNon = await json("/api/personnes/" + pasVerifiee.id, undefined, emp.cookie);
  dire("et pas pour une personne non verifiee",
       apiFicheNon.donnees && apiFicheNon.donnees.peutProposer === false, apiFicheNon.brut);
  const apiFicheVisiteur = await json("/api/personnes/" + elle.id);
  dire("ni pour un visiteur",
       apiFicheVisiteur.donnees && apiFicheVisiteur.donnees.peutProposer === false, apiFicheVisiteur.brut);

  console.log(SAUT + "--- LE FORMULAIRE ---");
  const formulaire = await page("/publier-annonce?pour=" + elle.id, emp.cookie);
  dire("il s'ouvre", formulaire.code === 200, String(formulaire.code));
  dire("il dit a qui la demande est proposee", formulaire.texte.includes("Proposée à " + elle.nom));
  dire("et que d'autres pourront repondre", formulaire.texte.includes("aussi y répondre"));
  dire("il garde la personne dans le formulaire",
       formulaire.texte.includes('name="pour" value="' + elle.id + '"'));
  dire("le metier de la personne est deja rempli",
       formulaire.texte.includes('value="' + metierOfficiel + '"'), metierOfficiel);

  const sansPour = await page("/publier-annonce", emp.cookie);
  dire("sans personne, rien de tout cela",
       !sansPour.texte.includes("Proposée à") && !sansPour.texte.includes('name="pour"'));

  for (const [nom, valeur] of [["non verifiee", pasVerifiee.id], ["un employeur", emp.id],
                               ["un texte", "abc"], ["un nombre negatif", "-3"]]) {
    const r = await page("/publier-annonce?pour=" + valeur, emp.cookie);
    dire("refuse pour " + nom, r.code === 400 && r.texte.includes("ne peut pas recevoir de demande"),
         String(r.code));
  }

  const apiFormulaire = await json("/api/formulaire-demande?pour=" + elle.id, undefined, emp.cookie);
  dire("l'application recoit la personne",
       apiFormulaire.donnees && apiFormulaire.donnees.invitee &&
       apiFormulaire.donnees.invitee.id === elle.id && apiFormulaire.donnees.invitee.nom === elle.nom &&
       apiFormulaire.donnees.invitee.metier === metierOfficiel, apiFormulaire.brut);
  const apiFormulaireSans = await json("/api/formulaire-demande", undefined, emp.cookie);
  dire("et rien quand la demande est pour tout le monde",
       apiFormulaireSans.donnees && apiFormulaireSans.donnees.invitee === null);
  const apiFormulaireRefus = await json("/api/formulaire-demande?pour=" + pasVerifiee.id, undefined, emp.cookie);
  dire("l'application est refusee pour une personne non verifiee",
       apiFormulaireRefus.code === 400 && apiFormulaireRefus.donnees &&
       String(apiFormulaireRefus.donnees.erreur).includes("ne peut pas recevoir"), apiFormulaireRefus.brut);

  console.log(SAUT + "--- PUBLIER ---");
  const publiee = await poster("/annonces", form(champs("I1", elle.id)), emp.cookie);
  dire("la demande est publiee", publiee.code === 200, String(publiee.code));
  dire("la phrase dit que la personne la verra en premier",
       publiee.corps.includes(elle.nom + " la verra en premier"));
  const i1 = annonceNommee("I1");
  dire("la personne est enregistree", i1 && i1.personne_invitee_id === elle.id);

  const refusee = await poster("/annonces", form(champs("refusee", pasVerifiee.id)), emp.cookie);
  dire("refusee pour une personne non verifiee", refusee.code === 400, String(refusee.code));
  dire("aucune demande n'est creee", !annonceNommee("refusee"));
  dire("le retour garde la personne dans l'adresse",
       refusee.corps.includes('href="/publier-annonce?pour=' + pasVerifiee.id + '"'));

  await poster("/annonces", form(champs("O1")), emp.cookie);
  await poster("/annonces", form(champs("O2")), emp.cookie);
  await poster("/annonces", form(champs("O3")), emp.cookie);
  const o1 = annonceNommee("O1"), o2 = annonceNommee("O2"), o3 = annonceNommee("O3");
  dire("une demande ordinaire n'est proposee a personne", o1 && o1.personne_invitee_id === null);

  const parAppli = await json("/api/demandes", champs("I2", elle.id), emp.cookie);
  dire("l'application publie pour la personne", parAppli.code === 201, parAppli.brut);
  const i2 = annonceNommee("I2");
  dire("et la personne est enregistree", i2 && i2.personne_invitee_id === elle.id);
  const parAppliNombre = await json("/api/demandes", Object.assign(champs("I3"), { pour: elle.id }), emp.cookie);
  dire("l'identifiant peut venir en nombre", parAppliNombre.code === 201, parAppliNombre.brut);
  const formeFausse = await json("/api/demandes", Object.assign(champs("forme"), { pour: { id: elle.id } }), emp.cookie);
  dire("un objet a la place de la personne est refuse", formeFausse.code === 400, formeFausse.brut);
  const appliRefus = await json("/api/demandes", champs("appli refusee", pasVerifiee.id), emp.cookie);
  dire("l'application est refusee pour une personne non verifiee",
       appliRefus.code === 400 && !annonceNommee("appli refusee"), appliRefus.brut);

  console.log(SAUT + "--- ELLE LA VOIT EN PREMIER, LES AUTRES AUSSI ---");
  const saListe = await page("/annonces", elle.cookie);
  const section = saListe.texte.indexOf("Demandes qui vous sont proposées");
  dire("la section est la", section >= 0);
  dire("avant les demandes de son metier",
       section >= 0 && section < saListe.texte.indexOf("Pour vous :"));
  dire("et la demande y est",
       section >= 0 && saListe.texte.indexOf(M + " I1") > section &&
       saListe.texte.indexOf(M + " I1") < saListe.texte.indexOf("Pour vous :"));
  dire("la gratuite est dite", saListe.texte.includes("Y répondre ne vous coûte aucun jeton"));

  const listeAutre = await page("/annonces", autre.cookie);
  dire("une autre personne ne voit pas la section",
       !listeAutre.texte.includes("Demandes qui vous sont proposées"));
  dire("mais la demande lui reste ouverte", listeAutre.texte.includes(M + " I1"));
  const listeVisiteur = await page("/annonces");
  dire("un visiteur la voit aussi, sans la section",
       listeVisiteur.texte.includes(M + " I1") && !listeVisiteur.texte.includes("qui vous sont proposées"));

  const apiSaListe = await json("/api/demandes", undefined, elle.cookie);
  const ids = (liste) => (liste || []).map((a) => a.id);
  dire("l'application la range dans ses propositions",
       apiSaListe.donnees && ids(apiSaListe.donnees.proposees).includes(i1.id) &&
       !ids(apiSaListe.donnees.pourMoi).includes(i1.id) && !ids(apiSaListe.donnees.autres).includes(i1.id),
       apiSaListe.brut.slice(0, 200));
  const apiAutre = await json("/api/demandes", undefined, autre.cookie);
  dire("et chez une autre personne, parmi les demandes ordinaires",
       apiAutre.donnees && apiAutre.donnees.proposees.length === 0 &&
       ids(apiAutre.donnees.pourMoi).concat(ids(apiAutre.donnees.autres)).includes(i1.id));

  console.log(SAUT + "--- SA REPONSE NE COUTE RIEN ET NE COMPTE PAS ---");
  crediter(elle.id, 5);
  crediter(autre.id, 5);

  const ecranProposee = await page("/candidatures/nouvelle/" + i1.id, elle.cookie);
  dire("l'ecran dit que la reponse ne coute rien",
       ecranProposee.texte.includes("Rien.") && ecranProposee.texte.includes("ne vous coûte aucun jeton"));
  dire("sans ligne de jetons ni limite du jour",
       !ecranProposee.texte.includes("Envoyer cette réponse") && !ecranProposee.texte.includes("par tranche de 24 heures"));
  const apiEcran = await json("/api/demandes/" + i1.id + "/reponse", undefined, elle.cookie);
  dire("l'application le sait",
       apiEcran.donnees && apiEcran.donnees.proposee === true &&
       apiEcran.donnees.cout === null && apiEcran.donnees.limite === null, apiEcran.brut.slice(-200));

  const ecranAutre = await page("/candidatures/nouvelle/" + i1.id, autre.cookie);
  dire("pour une autre personne, la meme demande coute un jeton",
       ecranAutre.texte.includes("Envoyer cette réponse") && !ecranAutre.texte.includes("Rien."));
  const apiEcranAutre = await json("/api/demandes/" + i1.id + "/reponse", undefined, autre.cookie);
  dire("et l'application le sait aussi",
       apiEcranAutre.donnees && apiEcranAutre.donnees.proposee === false && apiEcranAutre.donnees.cout !== null);

  // Limite du jour : 2. Une reponse ordinaire, la reponse proposee, puis
  // une seconde ordinaire : elle doit passer, la proposee n'a pas compte.
  const avant = solde(elle.id);
  const rO1 = await poster("/candidatures", form({ annonceId: String(o1.id) }), elle.cookie);
  dire("une reponse ordinaire passe", rO1.code === 200, String(rO1.code));
  dire("et coute un jeton", solde(elle.id) === avant - 1, avant + " -> " + solde(elle.id));

  const rI1 = await poster("/candidatures", form({ annonceId: String(i1.id) }), elle.cookie);
  dire("la reponse proposee passe", rI1.code === 200, String(rI1.code));
  dire("sans jeton preleve", solde(elle.id) === avant - 1, avant + " -> " + solde(elle.id));
  dire("et sans phrase de jeton", !rI1.corps.includes("a été prélevé"));

  const rO2 = await poster("/candidatures", form({ annonceId: String(o2.id) }), elle.cookie);
  dire("la seconde reponse ordinaire passe : la proposee n'a pas compte", rO2.code === 200, String(rO2.code));
  const rO3 = await poster("/candidatures", form({ annonceId: String(o3.id) }), elle.cookie);
  dire("la troisieme est arretee par la limite", rO3.code === 429, String(rO3.code));

  const apiI2 = await json("/api/demandes/" + i2.id + "/reponse", {}, elle.cookie);
  dire("une demande proposee passe meme a la limite", apiI2.code === 201, apiI2.brut);
  dire("toujours sans jeton", solde(elle.id) === avant - 2, avant + " -> " + solde(elle.id));

  const avantAutre = solde(autre.id);
  const rAutre = await poster("/candidatures", form({ annonceId: String(i1.id) }), autre.cookie);
  dire("une autre personne repond a la demande proposee", rAutre.code === 200, String(rAutre.code));
  dire("et paie son jeton comme d'habitude", solde(autre.id) === avantAutre - 1, String(solde(autre.id)));

  console.log(SAUT + "--- REFUSEE PUIS RENVOYEE : UN ENVOI ORDINAIRE ---");
  const cand = base.prepare("SELECT id FROM candidatures WHERE prestataire_id = ? AND annonce_id = ?")
    .get(elle.id, i1.id);
  await poster("/candidatures/statut", form({ candidatureId: String(cand.id), statut: "refusee" }), emp.cookie);
  base.prepare("UPDATE candidatures SET envoyee_le = datetime('now', '-2 day') WHERE prestataire_id = ?")
    .run(elle.id);

  const ecranRenvoi = await page("/candidatures/nouvelle/" + i1.id, elle.cookie);
  dire("l'ecran annonce le jeton du renvoi",
       ecranRenvoi.texte.includes("Envoyer cette réponse") && !ecranRenvoi.texte.includes("Rien."));
  const avantRenvoi = solde(elle.id);
  const renvoi = await poster("/candidatures", form({ annonceId: String(i1.id) }), elle.cookie);
  dire("le renvoi passe", renvoi.code === 200, String(renvoi.code));
  dire("et coute un jeton", solde(elle.id) === avantRenvoi - 1, avantRenvoi + " -> " + solde(elle.id));

  console.log(SAUT + "--- L'EMPLOYEUR VOIT A QUI IL L'A PROPOSEE ---");
  const mesDemandes = await page("/mes-demandes", emp.cookie);
  dire("la page Mes demandes le dit", mesDemandes.texte.includes("Proposée à <strong>" + elle.nom + "</strong>"));
  const apiMes = await json("/api/mes-demandes", undefined, emp.cookie);
  const trouver = (id) => apiMes.donnees && apiMes.donnees.demandes.find((d) => d.id === id);
  dire("l'application aussi", trouver(i1.id) && trouver(i1.id).proposeeA === elle.nom);
  dire("et rien pour une demande ordinaire", trouver(o1.id) && trouver(o1.id).proposeeA === null);

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
