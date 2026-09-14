// Série : l'API des demandes de l'employeur.
//
// Ce qui doit tenir :
//   - seul un employeur connecte lit ses demandes, en JSON ;
//   - l'API dit EXACTEMENT ce que dit la page Mes demandes : la meme
//     fonction decide pour les deux ;
//   - les demandes en cours viennent avant les demandes fermees ;
//   - choisir n'est propose qu'a une personne verifiee, refuser toujours ;
//   - aucune coordonnee des personnes qui ont repondu ne sort.
const PROJET = require("path").join(__dirname, "..");
process.chdir(PROJET);
require(PROJET + "/_serveur_test_temporaire.js");

const base = require(PROJET + "/node_modules/better-sqlite3")(PROJET + "/data/pamconnect.db");
base.pragma("foreign_keys = ON");

const RACINE = "http://127.0.0.1:3999";
const M = "test-api-emp";
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
  base.prepare("UPDATE utilisateurs SET statut_verification = 'verifie' WHERE email = ?").run(mail);
  const c = await poster("/connexion", form({ email: mail, motdepasse: "motdepasse123" }));
  const id = base.prepare("SELECT id FROM utilisateurs WHERE email = ?").get(mail).id;
  return { mail, id, cookie: c.cookie };
}

// Les jetons ne sont pas le sujet : on en donne assez pour repondre.
const crediter = (id, n) => base.prepare(`
  INSERT INTO jetons_mouvements (utilisateur_id, quantite, nature, motif, detail)
  VALUES (?, ?, 'achete', 'achat', 'Credit de test')
`).run(id, n);

async function mesDemandes(cookie) {
  const r = await fetch(RACINE + "/api/mes-demandes", { headers: cookie ? { Cookie: cookie } : {} });
  const brut = await r.text();
  let donnees = null;
  try { donnees = JSON.parse(brut); } catch (e) { donnees = null; }
  return { code: r.status, type: r.headers.get("content-type") || "", brut, donnees };
}

setTimeout(async () => {
  base.prepare("DELETE FROM utilisateurs WHERE email LIKE ?").run("%" + M + "%");

  const emp = await creerCompte("emp", "employeur");
  const verifiee = await creerCompte("verifiee", "prestataire", { metier: "menagere", tarif: "15000" });
  const autre = await creerCompte("autre", "prestataire", { metier: "menagere", tarif: "15000" });
  crediter(verifiee.id, 10);
  crediter(autre.id, 10);

  console.log(SAUT + "--- QUI PEUT LIRE ---");
  const sans = await mesDemandes();
  dire("sans session : 401 en JSON", sans.code === 401 && sans.type.includes("application/json"), "code " + sans.code);
  const parPre = await mesDemandes(verifiee.cookie);
  dire("une personne qui repond : 403", parPre.code === 403, "code " + parPre.code);
  const vide = await mesDemandes(emp.cookie);
  dire("un employeur sans demande lit une liste vide",
       vide.code === 200 && Array.isArray(vide.donnees.demandes) && vide.donnees.demandes.length === 0,
       vide.brut.slice(0, 80));

  // Deux demandes : l'une sera retiree, l'autre recevra deux reponses.
  await poster("/annonces", form({ titre: M + " retiree", metier: "menagere", quartier: "Mvan",
                                   horaire: "Lundi 8h", prix: "9000" }), emp.cookie);
  await poster("/annonces", form({ titre: M + " ouverte", metier: "menagere", quartier: "Mvan",
                                   horaire: "Mardi 8h", prix: "12000" }), emp.cookie);
  const idRetiree = base.prepare("SELECT id FROM annonces WHERE titre = ?").get(M + " retiree").id;
  const idOuverte = base.prepare("SELECT id FROM annonces WHERE titre = ?").get(M + " ouverte").id;
  await poster("/annonces/" + idRetiree + "/annuler", form({}), emp.cookie);

  await poster("/candidatures", form({ annonceId: String(idOuverte) }), verifiee.cookie);
  await poster("/candidatures", form({ annonceId: String(idOuverte) }), autre.cookie);
  // Une identite qui n'est plus verifiee : choisir ne doit plus etre propose.
  base.prepare("UPDATE utilisateurs SET statut_verification = 'non soumis' WHERE id = ?").run(autre.id);

  console.log(SAUT + "--- CE QUE L'EMPLOYEUR LIT ---");
  let lu = await mesDemandes(emp.cookie);
  const titres = lu.donnees.demandes.map((d) => d.titre);
  dire("les deux demandes sont la", titres.includes(M + " ouverte") && titres.includes(M + " retiree"));
  dire("la demande en cours vient avant la demande fermee",
       titres.indexOf(M + " ouverte") < titres.indexOf(M + " retiree"), titres.join(" | "));

  const ouverte = lu.donnees.demandes.find((d) => d.titre === M + " ouverte");
  const retiree = lu.donnees.demandes.find((d) => d.titre === M + " retiree");
  dire("la retiree est fermee, et le dit",
       retiree.fermee === true && retiree.phraseFermeture === "Vous avez retiré cette demande.",
       String(retiree.phraseFermeture));
  dire("la retiree ne propose plus aucune action",
       !retiree.peutModifier && !retiree.peutMettreEnAvant && !retiree.peutRetirer);
  dire("l'ouverte propose modifier, mettre en avant et retirer",
       ouverte.peutModifier && ouverte.peutMettreEnAvant && ouverte.peutRetirer);
  dire("le prix arrive deja ecrit", String(ouverte.prixLisible).includes("FCFA"), String(ouverte.prixLisible));
  dire("le lieu commence par le quartier", String(ouverte.lieu).startsWith("Mvan"), String(ouverte.lieu));
  dire("l'horaire est la", ouverte.horaire === "Mardi 8h", String(ouverte.horaire));

  const deVerifiee = ouverte.candidatures.find((c) => c.nom === "Test verifiee");
  const deAutre = ouverte.candidatures.find((c) => c.nom === "Test autre");
  dire("les deux reponses sont la", Boolean(deVerifiee) && Boolean(deAutre));
  dire("la phrase de statut est celle de l'employeur",
       deVerifiee.phrase === "En attente de votre décision", deVerifiee.phrase);
  dire("une personne verifiee peut etre choisie ou refusee",
       deVerifiee.peutChoisir === true && deVerifiee.peutRefuser === true && deVerifiee.attendVerification === false);
  dire("une personne non verifiee peut seulement etre refusee",
       deAutre.peutChoisir === false && deAutre.peutRefuser === true && deAutre.attendVerification === true);
  dire("son identite est dite en clair",
       deAutre.libelleVerification === "Identité non vérifiée", deAutre.libelleVerification);
  dire("une personne sans avis ni service est dite nouvelle",
       deVerifiee.note.etat === "nouveau" && deVerifiee.note.badge === "Nouveau prestataire",
       JSON.stringify(deVerifiee.note));
  dire("aucune coordonnee ne sort",
       !lu.brut.includes("@example.com") && !lu.brut.includes("motdepasse") && !lu.brut.includes("telephone"));

  console.log(SAUT + "--- LA MEME CHOSE QUE LA PAGE ---");
  // La page et l'API lisent la meme fonction : ce que dit l'API doit se
  // retrouver dans la page. Fragments sans apostrophe, que EJS echappe.
  const page = await (await lire("/mes-demandes", emp.cookie)).text();
  dire("la phrase de statut est dans la page", page.includes(deVerifiee.phrase));
  dire("le libelle d'identite aussi", page.includes(deAutre.libelleVerification));
  dire("la note aussi", page.includes(deVerifiee.note.badge));
  dire("le prix aussi", page.includes(ouverte.prixLisible));
  dire("la page propose Choisir a la personne verifiee",
       page.includes("/candidatures/" + deVerifiee.id + "/confirmer"));
  dire("mais pas a la personne non verifiee",
       !page.includes("/candidatures/" + deAutre.id + "/confirmer"));

  console.log(SAUT + "--- APRES UN CHOIX ---");
  await poster("/candidatures/statut",
    form({ candidatureId: String(deVerifiee.id), statut: "acceptee" }), emp.cookie);
  lu = await mesDemandes(emp.cookie);
  const pourvue = lu.donnees.demandes.find((d) => d.titre === M + " ouverte");
  dire("la demande pourvue est fermee et le dit",
       pourvue.fermee === true && pourvue.phraseFermeture === "Vous avez choisi quelqu'un.",
       String(pourvue.phraseFermeture));
  const choisie = pourvue.candidatures.find((c) => c.id === deVerifiee.id);
  const ecartee = pourvue.candidatures.find((c) => c.id === deAutre.id);
  dire("la personne choisie", choisie.phrase === "Vous avez accepté cette candidature", choisie.phrase);
  dire("l'autre lit un choix, pas un refus",
       ecartee.phrase === "Vous avez choisi quelqu'un d'autre", ecartee.phrase);
  dire("plus aucune decision a prendre",
       !choisie.peutChoisir && !choisie.peutRefuser && !ecartee.peutChoisir && !ecartee.peutRefuser);

  console.log(SAUT + "--- LES LIENS MENENT A MES DEMANDES ---");
  const reconnexion = await poster("/connexion", form({ email: emp.mail, motdepasse: "motdepasse123" }));
  dire("apres la connexion, l'employeur est envoye sur ses demandes",
       reconnexion.corps.includes("Voir mes demandes") && !reconnexion.corps.includes("Voir mon profil"));
  const formulaireWeb = await (await lire("/publier-annonce", emp.cookie)).text();
  dire("Annuler ramene a Mes demandes", formulaireWeb.includes('href="/mes-demandes">Annuler'));
  dire("le formulaire tire ses limites du serveur",
       formulaireWeb.includes('min="500"') && formulaireWeb.includes('step="500"') &&
       formulaireWeb.includes('maxlength="300"'));

  // Les appels de l'application : du JSON, avec un cookie ou un jeton.
  async function json(chemin, corps, entetes) {
    const r = await fetch(RACINE + chemin, {
      method: corps === undefined ? "GET" : "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, entetes || {}),
      body: corps === undefined ? undefined : JSON.stringify(corps),
    });
    const brut = await r.text();
    let donnees = null;
    try { donnees = JSON.parse(brut); } catch (e) { donnees = null; }
    return { code: r.status, donnees, brut };
  }
  const cookieDe = (c) => ({ Cookie: c });
  const erreurDe = (r) => (r.donnees && r.donnees.erreur) || "";

  // Un quartier de la vraie table, pour ne rien supposer de son contenu.
  const unQuartier = base.prepare("SELECT nom, arrondissement FROM quartiers ORDER BY nom LIMIT 1").get();

  console.log(SAUT + "--- PUBLIER DEPUIS L'APPLICATION : QUI PEUT ---");
  dire("le formulaire sans session : 401", (await json("/api/formulaire-demande")).code === 401);
  const formPre = await json("/api/formulaire-demande", undefined, cookieDe(verifiee.cookie));
  dire("le formulaire refuse a une personne qui repond",
       formPre.code === 403 && erreurDe(formPre) === "Seuls les employeurs peuvent publier une demande.",
       formPre.code + " " + erreurDe(formPre));

  const mailNonVerifie = M + "-nonverifie@example.com";
  await poster("/inscription", form({ role: "employeur", nom: "Test nonverifie", email: mailNonVerifie,
                                      motdepasse: "motdepasse123", quartier: "Bastos" }));
  const nonVerifie = await poster("/connexion", form({ email: mailNonVerifie, motdepasse: "motdepasse123" }));
  const formNonVerifie = await json("/api/formulaire-demande", undefined, cookieDe(nonVerifie.cookie));
  dire("un employeur non verifie lit la meme raison que sur le site",
       formNonVerifie.code === 403 && erreurDe(formNonVerifie).startsWith("Avant de publier une demande"),
       formNonVerifie.code + " " + erreurDe(formNonVerifie));

  const formEmp = await json("/api/formulaire-demande", undefined, cookieDe(emp.cookie));
  const f = formEmp.donnees || {};
  dire("l'employeur verifie recoit le formulaire", formEmp.code === 200, formEmp.brut.slice(0, 80));
  dire("tous les metiers de la table",
       Array.isArray(f.metiers) && f.metiers.length === base.prepare("SELECT COUNT(*) n FROM metiers").get().n);
  dire("tous les quartiers de la table",
       Array.isArray(f.quartiers) && f.quartiers.length === base.prepare("SELECT COUNT(*) n FROM quartiers").get().n);
  dire("les arrondissements sont la", Array.isArray(f.arrondissements) && f.arrondissements.includes(unQuartier.arrondissement));
  dire("les trois facons de compter le prix, forfaitaire par defaut",
       Array.isArray(f.unitesTarif) &&
       ["horaire", "journalier", "forfaitaire"].every((v) => f.unitesTarif.some((u) => u.valeur === v && u.libelle)) &&
       f.uniteParDefaut === "forfaitaire");

  console.log(SAUT + "--- L'ARRONDISSEMENT D'UN QUARTIER ---");
  dire("sans session : 401", (await json("/api/quartier?nom=x")).code === 401);
  const trouve = await json("/api/quartier?nom=" + encodeURIComponent(unQuartier.nom.toLowerCase()), undefined, cookieDe(emp.cookie));
  dire("un quartier connu, meme ecrit en minuscules",
       trouve.donnees && trouve.donnees.connu === true && trouve.donnees.quartier === unQuartier.nom &&
       trouve.donnees.arrondissement === unQuartier.arrondissement, trouve.brut);
  const inconnu = await json("/api/quartier?nom=" + encodeURIComponent(M + " inconnu"), undefined, cookieDe(emp.cookie));
  dire("un quartier inconnu est dit inconnu", inconnu.donnees && inconnu.donnees.connu === false, inconnu.brut);

  console.log(SAUT + "--- PUBLIER : CE QUI EST REFUSE ---");
  const complet = (titre) => ({ titre, metier: "menagere", quartier: unQuartier.nom.toLowerCase(),
                                horaire: "Mercredi 9h", prix: 8000, unite_tarif: "horaire",
                                duree_estimee: "Environ 3 heures" });
  const compter = (titre) => base.prepare("SELECT COUNT(*) n FROM annonces WHERE titre = ?").get(titre).n;

  dire("publier sans session : 401", (await json("/api/demandes", complet(M + " sans session"))).code === 401);
  const parPre2 = await json("/api/demandes", complet(M + " par une personne"), cookieDe(verifiee.cookie));
  dire("publier par une personne qui repond : 403", parPre2.code === 403, String(parPre2.code));

  const forme = await json("/api/demandes", Object.assign(complet(M + " forme"), { titre: { faux: true } }), cookieDe(emp.cookie));
  dire("un objet a la place d'un texte : 400",
       forme.code === 400 && erreurDe(forme) === "Le formulaire envoyé n'a pas la forme attendue.", forme.brut);

  const sansTitre = await json("/api/demandes", Object.assign(complet(""), { titre: "   " }), cookieDe(emp.cookie));
  dire("sans description : 400", sansTitre.code === 400 && erreurDe(sansTitre).length > 0, sansTitre.brut);
  const sansTitreWeb = await poster("/annonces", form(Object.assign(complet(""), { titre: "", prix: "8000" })), emp.cookie);
  dire("le site refuse aussi, avec la meme phrase",
       sansTitreWeb.code === 400 && sansTitreWeb.corps.includes(erreurDe(sansTitre)), "code " + sansTitreWeb.code);

  const sansMetier = await json("/api/demandes", Object.assign(complet(M + " sans metier"), { metier: "" }), cookieDe(emp.cookie));
  dire("sans metier : 400", sansMetier.code === 400 && erreurDe(sansMetier).startsWith("Indiquez qui vous cherchez"), sansMetier.brut);
  const sansPrix = await json("/api/demandes", Object.assign(complet(M + " sans prix"), { prix: "" }), cookieDe(emp.cookie));
  dire("sans prix : 400", sansPrix.code === 400, sansPrix.brut);
  dire("aucune de ces demandes n'a ete enregistree",
       compter(M + " sans session") + compter(M + " par une personne") + compter(M + " forme") +
       compter(M + " sans metier") + compter(M + " sans prix") === 0);

  // Le trou qui existait sur le site : le role n'etait verifie qu'a
  // l'ouverture du formulaire, pas a l'envoi.
  const parPreWeb = await poster("/annonces", form(Object.assign(complet(M + " forcee"), { prix: "8000" })), verifiee.cookie);
  dire("le site refuse l'envoi force par une personne qui repond",
       parPreWeb.code === 403 && compter(M + " forcee") === 0, "code " + parPreWeb.code);

  console.log(SAUT + "--- PUBLIER : LA MEME DEMANDE DES DEUX COTES ---");
  const coAppli = await json("/api/connexion", { email: emp.mail, motdepasse: "motdepasse123" });
  const jeton = coAppli.donnees && coAppli.donnees.jeton;
  const publiee = await json("/api/demandes", complet(M + " appli"), { Authorization: "Bearer " + jeton });
  dire("publiee depuis l'application, avec le jeton : 201",
       publiee.code === 201 && Number.isInteger(publiee.donnees.id), publiee.brut);
  dire("la confirmation reprend le titre",
       publiee.donnees && publiee.donnees.titre === "Demande publiée" && String(publiee.donnees.texte).includes(M + " appli"));

  const parSite = await poster("/annonces", form(Object.assign(complet(M + " site"), { prix: "8000" })), emp.cookie);
  dire("publiee depuis le site, qui renvoie vers Mes demandes",
       parSite.code === 200 && parSite.corps.includes("Voir mes demandes"), "code " + parSite.code);

  const ligne = (titre) => base.prepare(`
    SELECT metier, quartier, arrondissement, horaire, prix, unite_tarif, duree_estimee, annulee
    FROM annonces WHERE titre = ?`).get(titre);
  const deLAppli = ligne(M + " appli");
  const duSite = ligne(M + " site");
  dire("le site et l'application enregistrent exactement la meme demande",
       JSON.stringify(deLAppli) === JSON.stringify(duSite), JSON.stringify(deLAppli) + " / " + JSON.stringify(duSite));
  dire("le quartier est reconnu et son arrondissement trouve",
       deLAppli.quartier === unQuartier.nom && deLAppli.arrondissement === unQuartier.arrondissement,
       JSON.stringify(deLAppli));
  const bloque = base.prepare("SELECT montant, etat FROM versements WHERE annonce_id = ?").get(publiee.donnees.id);
  dire("la somme annoncee est bloquee", bloque && bloque.montant === 8000 && bloque.etat === "bloque", JSON.stringify(bloque));

  const apresPublication = await mesDemandes(emp.cookie);
  dire("elle apparait dans Mes demandes de l'application",
       apresPublication.donnees.demandes.some((d) => d.id === publiee.donnees.id && !d.fermee));
  dire("et sur la page du site",
       (await (await lire("/mes-demandes", emp.cookie)).text()).includes(M + " appli"));

  console.log(SAUT + "--- LES MONTANTS : AU MOINS 500 FCFA, PAR TRANCHES DE 500 ---");
  // Seul le navigateur de l'ordinateur les verifiait : le telephone, lui,
  // publiait une demande a 750 FCFA.
  let phrasePrix = "";
  for (const prix of [250, 750, 10250]) {
    const titre = M + " prix " + prix;
    const r = await json("/api/demandes", Object.assign(complet(titre), { prix }), cookieDe(emp.cookie));
    dire("un prix de " + prix + " FCFA est refuse", r.code === 400 && compter(titre) === 0, r.brut);
    phrasePrix = erreurDe(r);
  }
  dire("la phrase dit la regle",
       phrasePrix === "Le prix doit être au moins 500 FCFA, par tranches de 500 FCFA.", phrasePrix);
  const prixWeb = await poster("/annonces", form(Object.assign(complet(M + " prix web"), { prix: "750" })), emp.cookie);
  dire("le site refuse aussi, avec la meme phrase",
       prixWeb.code === 400 && prixWeb.corps.includes(phrasePrix) && compter(M + " prix web") === 0,
       "code " + prixWeb.code);
  const prixRond = await json("/api/demandes", Object.assign(complet(M + " prix rond"), { prix: 10500 }), cookieDe(emp.cookie));
  dire("un prix de 10500 FCFA est accepte", prixRond.code === 201, prixRond.brut);

  const tropLong = await json("/api/demandes",
    Object.assign(complet(M + " trop long"), { conditions: "x".repeat(301) }), cookieDe(emp.cookie));
  dire("301 caracteres a savoir avant de venir : refuse",
       tropLong.code === 400 && compter(M + " trop long") === 0, tropLong.brut);
  const tropLongWeb = await poster("/annonces",
    form(Object.assign(complet(M + " trop long web"), { prix: "8000", conditions: "x".repeat(301) })), emp.cookie);
  dire("le site refuse aussi", tropLongWeb.code === 400 && compter(M + " trop long web") === 0,
       "code " + tropLongWeb.code);
  const juste = await json("/api/demandes",
    Object.assign(complet(M + " juste"), { conditions: "x".repeat(300) }), cookieDe(emp.cookie));
  dire("300 caracteres : accepte", juste.code === 201, juste.brut);

  console.log(SAUT + "--- CHOISIR ET REFUSER DEPUIS L'APPLICATION : QUI PEUT ---");
  const pre3 = await creerCompte("trois", "prestataire", { metier: "menagere", tarif: "15000" });
  const pre4 = await creerCompte("quatre", "prestataire", { metier: "menagere", tarif: "15000" });
  const autreEmp = await creerCompte("autreemp", "employeur");
  crediter(pre3.id, 10);
  crediter(pre4.id, 10);

  const aChoisir = await json("/api/demandes", complet(M + " a choisir"), cookieDe(emp.cookie));
  const idAChoisir = aChoisir.donnees.id;
  for (const p of [verifiee, pre3, pre4]) {
    await poster("/candidatures", form({ annonceId: String(idAChoisir) }), p.cookie);
  }
  const candDe = (p) => base.prepare(
    "SELECT id FROM candidatures WHERE annonce_id = ? AND prestataire_id = ?").get(idAChoisir, p.id).id;
  const cChoisie = candDe(verifiee);
  const cRefusee = candDe(pre3);
  const cNonVerifiee = candDe(pre4);
  // Son identite n'est plus verifiee apres avoir repondu : on ne doit pas
  // pouvoir la choisir.
  base.prepare("UPDATE utilisateurs SET statut_verification = 'non soumis' WHERE id = ?").run(pre4.id);
  const statutDe = (id) => base.prepare("SELECT statut FROM candidatures WHERE id = ?").get(id).statut;
  const confirmation = (id, entetes) => json("/api/candidatures/" + id + "/confirmation", undefined, entetes);
  const decider = (id, decision, entetes) => json("/api/candidatures/" + id + "/" + decision, {}, entetes);

  dire("l'ecran de confirmation sans session : 401", (await confirmation(cChoisie)).code === 401);
  dire("la personne elle-meme : 403", (await confirmation(cChoisie, cookieDe(verifiee.cookie))).code === 403);
  dire("un autre employeur : 404", (await confirmation(cChoisie, cookieDe(autreEmp.cookie))).code === 404);
  dire("un autre employeur ne peut pas refuser : 404",
       (await decider(cRefusee, "refuser", cookieDe(autreEmp.cookie))).code === 404 && statutDe(cRefusee) === "en attente");
  const confNonVerifiee = await confirmation(cNonVerifiee, cookieDe(emp.cookie));
  const choixNonVerifiee = await decider(cNonVerifiee, "choisir", cookieDe(emp.cookie));
  dire("choisir une personne non verifiee : 403, et rien ne bouge",
       confNonVerifiee.code === 403 && choixNonVerifiee.code === 403 && statutDe(cNonVerifiee) === "en attente",
       confNonVerifiee.code + " " + choixNonVerifiee.code);
  dire("avec la phrase du site", erreurDe(choixNonVerifiee).startsWith("L'identité de cette personne"));

  console.log(SAUT + "--- CE QUE L'EMPLOYEUR RELIT AVANT DE CHOISIR ---");
  const conf = await confirmation(cChoisie, cookieDe(emp.cookie));
  const d = conf.donnees || {};
  dire("l'ecran s'ouvre", conf.code === 200, conf.brut.slice(0, 120));
  dire("le nom de la personne", d.nom === "Test verifiee", String(d.nom));
  dire("ce qu'il paie, la commission et ce que la personne recoit",
       d.paiement && d.paiement.vousPayez === "8 000 FCFA" && d.paiement.commission === "800 FCFA" &&
       d.paiement.pourcentageCommission === 10 && d.paiement.recoit === "7 200 FCFA",
       JSON.stringify(d.paiement));
  dire("combien de personnes recevront un refus",
       d.refusAnnonces && d.refusAnnonces.nombre === 2 &&
       d.refusAnnonces.suite === "autres personnes qui attendaient recevront un refus.",
       JSON.stringify(d.refusAnnonces));
  dire("l'horaire et le lieu general", d.horaire === "Mercredi 9h" && String(d.lieu).startsWith(unQuartier.nom),
       d.horaire + " / " + d.lieu);
  dire("aucune coordonnee ne sort", !conf.brut.includes("@example.com") && !conf.brut.includes("telephone"));
  const pageConf = await (await lire("/candidatures/" + cChoisie + "/confirmer", emp.cookie)).text();
  dire("la page du site dit la meme chose",
       pageConf.includes(d.paiement.vousPayez) && pageConf.includes(d.paiement.recoit) &&
       pageConf.includes("<strong>2</strong> " + d.refusAnnonces.suite));
  dire("rien n'est decide tant qu'on n'a pas confirme", statutDe(cChoisie) === "en attente");

  console.log(SAUT + "--- REFUSER DEPUIS L'APPLICATION ---");
  const refus = await decider(cRefusee, "refuser", cookieDe(emp.cookie));
  dire("le refus passe", refus.code === 200 && statutDe(cRefusee) === "refusee", refus.brut);
  const apresRefus = (await mesDemandes(emp.cookie)).donnees.demandes.find((x) => x.id === idAChoisir);
  const lueRefusee = apresRefus.candidatures.find((x) => x.id === cRefusee);
  dire("l'employeur lit son refus, sans plus aucun bouton",
       lueRefusee.phrase === "Vous avez refusé cette candidature" && !lueRefusee.peutChoisir && !lueRefusee.peutRefuser,
       lueRefusee.phrase);
  dire("la demande reste ouverte", apresRefus.fermee === false);
  dire("refuser deux fois : 409", (await decider(cRefusee, "refuser", cookieDe(emp.cookie))).code === 409);

  console.log(SAUT + "--- CHOISIR DEPUIS L'APPLICATION ---");
  const choix = await decider(cChoisie, "choisir", { Authorization: "Bearer " + jeton });
  dire("le choix passe, avec le jeton de l'application",
       choix.code === 200 && statutDe(cChoisie) === "acceptee", choix.brut);
  dire("la demande est pourvue et fermee",
       base.prepare("SELECT annulee FROM annonces WHERE id = ?").get(idAChoisir).annulee === 1);
  dire("la personne qui attendait encore recoit un refus", statutDe(cNonVerifiee) === "refusee");

  const reprise = await decider(cChoisie, "refuser", cookieDe(emp.cookie));
  dire("revenir sur son choix : 409, et rien ne bouge",
       reprise.code === 409 && statutDe(cChoisie) === "acceptee", reprise.brut);
  const deuxieme = await decider(cRefusee, "choisir", cookieDe(emp.cookie));
  dire("choisir une deuxieme personne : 409", deuxieme.code === 409 && statutDe(cRefusee) === "refusee", deuxieme.brut);
  const deuxiemeWeb = await poster("/candidatures/statut",
    form({ candidatureId: String(cRefusee), statut: "acceptee" }), emp.cookie);
  dire("le site le refuse aussi", deuxiemeWeb.code === 409 && statutDe(cRefusee) === "refusee",
       "code " + deuxiemeWeb.code);
  dire("l'ecran de confirmation repond 409", (await confirmation(cChoisie, cookieDe(emp.cookie))).code === 409);

  console.log(SAUT + "--- UNE DEMANDE RETIREE N'ATTEND PLUS DE DECISION ---");
  const aRetirer = await json("/api/demandes", complet(M + " a retirer"), cookieDe(emp.cookie));
  await poster("/candidatures", form({ annonceId: String(aRetirer.donnees.id) }), pre3.cookie);
  const cSurRetiree = base.prepare("SELECT id FROM candidatures WHERE annonce_id = ?").get(aRetirer.donnees.id).id;
  await poster("/annonces/" + aRetirer.donnees.id + "/annuler", form({}), emp.cookie);

  const lueRetiree = (await mesDemandes(emp.cookie)).donnees.demandes.find((x) => x.id === aRetirer.donnees.id);
  const reponseRetiree = lueRetiree.candidatures[0];
  dire("plus aucun bouton sur ses reponses",
       lueRetiree.fermee && !reponseRetiree.peutChoisir && !reponseRetiree.peutRefuser && !reponseRetiree.attendVerification);
  dire("et l'employeur ne lit plus qu'une decision l'attend",
       reponseRetiree.phrase === "Vous avez retiré cette demande", reponseRetiree.phrase);
  const choixRetiree = await decider(cSurRetiree, "choisir", cookieDe(emp.cookie));
  dire("choisir sur une demande retiree : 409", choixRetiree.code === 409 && statutDe(cSurRetiree) === "en attente",
       choixRetiree.brut);
  const choixRetireeWeb = await poster("/candidatures/statut",
    form({ candidatureId: String(cSurRetiree), statut: "acceptee" }), emp.cookie);
  dire("le site le refuse aussi", choixRetireeWeb.code === 409 && statutDe(cSurRetiree) === "en attente",
       "code " + choixRetireeWeb.code);
  dire("la page du site ne propose plus Choisir",
       !(await (await lire("/mes-demandes", emp.cookie)).text()).includes("/candidatures/" + cSurRetiree + "/confirmer"));
  dire("la personne, elle, lit toujours que la demande a ete retiree",
       (await (await lire("/mes-reponses", pre3.cookie)).text()).includes("employeur a retiré cette demande"));

  console.log(SAUT + "--- NETTOYAGE ---");
  const n = base.prepare("DELETE FROM utilisateurs WHERE email LIKE ?").run("%" + M + "%").changes;
  console.log("  " + n + " comptes de test supprimes");

  console.log(SAUT + "RESULTAT : " + ok + " reussis, " + ko + " echec(s)");
  process.exit(ko === 0 ? 0 : 1);
}, 600);
