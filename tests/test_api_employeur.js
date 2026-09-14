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

  const pageAvantRefus = await (await lire("/mes-demandes", emp.cookie)).text();
  dire("le site demande confirmation avant de refuser",
       pageAvantRefus.includes('data-question="Voulez-vous vraiment refuser la candidature de Test trois ?"') &&
       pageAvantRefus.includes("window.confirm"));

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

  console.log(SAUT + "--- DISCUTER DEPUIS L'APPLICATION ---");
  const discussion = (id, entetes) => json("/api/discussions/" + id, undefined, entetes);
  const ecrireA = (id, texte, entetes) => json("/api/discussions/" + id + "/messages", { texte }, entetes);
  const signaleEnBase = (id) => base.prepare("SELECT signale FROM messages WHERE id = ?").get(id).signale;

  dire("sans session : 401", (await discussion(cChoisie)).code === 401);
  dire("un autre employeur : 403", (await discussion(cChoisie, cookieDe(autreEmp.cookie))).code === 403);
  dire("une personne qui n'y participe pas : 403", (await discussion(cChoisie, cookieDe(pre3.cookie))).code === 403);

  const envoi = await ecrireA(cChoisie, M + " bonjour depuis le telephone", { Authorization: "Bearer " + jeton });
  dire("l'employeur ecrit depuis l'application", envoi.code === 201, envoi.brut);
  const depuisLeSite = await poster("/messages/" + cChoisie, form({ texte: M + " reponse depuis le site" }), verifiee.cookie);
  dire("la personne repond depuis le site", depuisLeSite.code === 302, "code " + depuisLeSite.code);

  const vueEmp = await discussion(cChoisie, cookieDe(emp.cookie));
  const de = vueEmp.donnees || {};
  const lesMessages = de.messages || [];
  dire("la discussion s'ouvre", vueEmp.code === 200, vueEmp.brut.slice(0, 120));
  dire("avec qui, et a propos de quoi", de.avec === "Test verifiee" && de.titreDemande === M + " a choisir",
       de.avec + " / " + de.titreDemande);
  dire("les deux messages, dans l'ordre",
       lesMessages.length === 2 && lesMessages[0].texte === M + " bonjour depuis le telephone" &&
       lesMessages[1].texte === M + " reponse depuis le site", JSON.stringify(lesMessages));
  dire("le sien est dit Vous, l'autre porte son nom",
       lesMessages[0].deMoi && lesMessages[0].auteur === "Vous" &&
       !lesMessages[1].deMoi && lesMessages[1].auteur === "Test verifiee");
  dire("seul le message de l'autre peut etre signale", !lesMessages[0].peutSignaler && lesMessages[1].peutSignaler);
  dire("la phrase de statut de l'employeur", de.phraseStatut === "Vous avez accepté cette candidature", de.phraseStatut);
  dire("le prix vu par l'employeur",
       de.prix && de.prix.lignes.length === 3 && de.prix.lignes[0].libelle === "Vous payez" &&
       de.prix.lignes[2].libelle === "Test verifiee reçoit" && de.prix.lignes[2].montant === "7 200 FCFA",
       JSON.stringify(de.prix));
  dire("aucune coordonnee ne sort", !vueEmp.brut.includes("@example.com") && !vueEmp.brut.includes("motdepasse"));
  dire("le conseil ne parle plus du prix a negocier, et l'adresse va a la personne choisie",
       de.conseilEcriture === "Accordez-vous sur l'horaire et le déroulement du service : le prix est déjà fixé. " +
         "Vous pouvez maintenant donner votre adresse exacte à Test verifiee.", de.conseilEcriture);
  dire("l'employeur peut declarer le service effectue", de.peutDeclarerService === true);

  const pageDiscussion = await (await lire("/messages/" + cChoisie, emp.cookie)).text();
  dire("la page du site montre les memes messages, le meme prix et le meme statut",
       pageDiscussion.includes(M + " bonjour depuis le telephone") && pageDiscussion.includes(M + " reponse depuis le site") &&
       pageDiscussion.includes(de.prix.lignes[2].montant) && pageDiscussion.includes(de.phraseStatut));
  // Des bulles, pas des cadres : presentes en cartes blanches, les
  // messages se confondaient avec le champ pour ecrire.
  dire("sur le site, les messages sont des bulles, la sienne a part",
       pageDiscussion.includes('class="fil"') &&
       pageDiscussion.includes('class="bulle bulle-mienne"') && pageDiscussion.includes('class="bulle"') &&
       !pageDiscussion.includes("message-mien"));

  const vuePre = await discussion(cChoisie, cookieDe(verifiee.cookie));
  const dp = vuePre.donnees || {};
  dire("la personne lit la meme discussion, de son cote",
       vuePre.code === 200 && dp.avec === "Test emp" && dp.messages[1].deMoi && dp.messages[0].auteur === "Test emp" &&
       dp.prix.lignes[2].libelle === "Vous recevez" && dp.metierAutre === null,
       JSON.stringify(dp.prix && dp.prix.lignes));
  dire("la personne ne declare pas a la place de l'employeur, et son conseil ne parle pas d'adresse",
       dp.peutDeclarerService === false &&
       dp.conseilEcriture === "Accordez-vous sur l'horaire et le déroulement du service : le prix est déjà fixé.",
       dp.conseilEcriture);
  dire("la page du site donne le meme conseil, et demande confirmation avant de declarer",
       pageDiscussion.includes("le prix est déjà fixé. Vous pouvez maintenant donner votre adresse exacte à Test verifiee.") &&
       pageDiscussion.includes('data-question="Confirmez-vous que le service a été effectué ?"'));

  // Un numero de telephone dans un message : l'avertissement doit suivre.
  await ecrireA(cChoisie, M + " appelez-moi au 600000000", cookieDe(verifiee.cookie));
  const avecNumero = (await discussion(cChoisie, cookieDe(emp.cookie))).donnees.messages.pop();
  dire("un numero de telephone declenche l'avertissement de paiement", avecNumero.risquePaiement === true,
       JSON.stringify(avecNumero));

  console.log(SAUT + "--- SIGNALER UN MESSAGE ---");
  const aSignaler = lesMessages[1];
  const signal = await json("/api/discussions/" + cChoisie + "/messages/" + aSignaler.id + "/signaler", {}, cookieDe(emp.cookie));
  dire("signaler le message de l'autre", signal.code === 200 && signaleEnBase(aSignaler.id) === 1, signal.brut);
  const apresSignal = (await discussion(cChoisie, cookieDe(emp.cookie))).donnees.messages.find((m) => m.id === aSignaler.id);
  dire("il est dit signale, et ne se signale plus", apresSignal.signale && !apresSignal.peutSignaler);
  await json("/api/discussions/" + cChoisie + "/messages/" + lesMessages[0].id + "/signaler", {}, cookieDe(emp.cookie));
  dire("son propre message ne se signale pas", signaleEnBase(lesMessages[0].id) === 0);

  // La faille : participer a UNE discussion suffisait pour signaler un
  // message de n'importe quelle autre.
  await json("/api/discussions/" + cRefusee + "/messages/" + lesMessages[0].id + "/signaler", {}, cookieDe(pre3.cookie));
  dire("un message d'une autre discussion ne se signale pas depuis l'application", signaleEnBase(lesMessages[0].id) === 0);
  await poster("/messages/" + lesMessages[0].id + "/signaler", form({ candidatureId: String(cRefusee) }), pre3.cookie);
  dire("ni depuis le site", signaleEnBase(lesMessages[0].id) === 0);

  console.log(SAUT + "--- CE QUI SE REFUSE, ET LA FIN DU SERVICE ---");
  dire("un message vide : 400", (await ecrireA(cRefusee, "   ", cookieDe(emp.cookie))).code === 400);
  dire("un message trop long : 400", (await ecrireA(cRefusee, "x".repeat(2001), cookieDe(emp.cookie))).code === 400);
  dire("un objet a la place du texte : 400",
       (await json("/api/discussions/" + cRefusee + "/messages", { texte: { faux: true } }, cookieDe(emp.cookie))).code === 400);

  await poster("/candidatures/" + cChoisie + "/jai-effectue", form({}), verifiee.cookie);
  const declaree = (await discussion(cChoisie, cookieDe(emp.cookie))).donnees;
  dire("l'employeur voit que la personne dit avoir travaille",
       declaree.declarationDeLaPersonne && declaree.declarationDeLaPersonne.nom === "Test verifiee",
       JSON.stringify(declaree.declarationDeLaPersonne));

  const terminer = (id, entetes) => json("/api/candidatures/" + id + "/terminer", {}, entetes);
  const reponseDansMesDemandes = async (id) =>
    (await mesDemandes(emp.cookie)).donnees.demandes.find((x) => x.id === idAChoisir).candidatures.find((x) => x.id === id);

  dire("tant que le service n'est pas declare, le bouton dit Discuter",
       (await reponseDansMesDemandes(cChoisie)).libelleDiscussion === "Discuter");
  dire("la personne qui a travaille ne declare pas a sa place : 403",
       (await terminer(cChoisie, cookieDe(verifiee.cookie))).code === 403);
  dire("un autre employeur : 404", (await terminer(cChoisie, cookieDe(autreEmp.cookie))).code === 404);
  dire("une reponse refusee n'a pas de service a clore : 409",
       (await terminer(cRefusee, cookieDe(emp.cookie))).code === 409);

  const finService = await terminer(cChoisie, { Authorization: "Bearer " + jeton });
  dire("l'employeur declare le service effectue depuis l'application", finService.code === 200, finService.brut);
  const verse = base.prepare("SELECT etat, beneficiaire_id, net FROM versements WHERE annonce_id = ?").get(idAChoisir);
  dire("la somme est versee a la personne, commission deduite",
       verse.etat === "verse" && verse.beneficiaire_id === verifiee.id && verse.net === 7200, JSON.stringify(verse));
  dire("declarer deux fois : 409", (await terminer(cChoisie, cookieDe(emp.cookie))).code === 409);
  dire("dans Mes demandes, le bouton dit maintenant Relire la discussion",
       (await reponseDansMesDemandes(cChoisie)).libelleDiscussion === "Relire la discussion");
  dire("sur le site aussi", (await (await lire("/mes-demandes", emp.cookie)).text()).includes("Relire la discussion"));
  const archivee = (await discussion(cChoisie, cookieDe(emp.cookie))).donnees;
  dire("une fois le service termine, on relit sans ecrire",
       archivee.serviceTermine && archivee.serviceTermine.par === "Test emp" && archivee.peutEcrire === false &&
       archivee.declarationDeLaPersonne === null && archivee.peutDeclarerService === false,
       JSON.stringify(archivee.serviceTermine));
  const tardif = await ecrireA(cChoisie, M + " trop tard", cookieDe(emp.cookie));
  dire("ecrire dans une discussion archivee : 409", tardif.code === 409, tardif.brut);

  console.log(SAUT + "--- DONNER SON AVIS DEPUIS L'APPLICATION ---");
  const formulaireAvis = (id, entetes) => json("/api/avis/" + id, undefined, entetes);
  const noter = (id, corps, entetes) => json("/api/avis/" + id, corps, entetes);
  const avisEnBase = (auteurId) =>
    base.prepare("SELECT * FROM avis WHERE candidature_id = ? AND auteur_id = ?").get(cChoisie, auteurId);

  dire("sans session : 401", (await formulaireAvis(cChoisie)).code === 401);
  dire("pas d'avis avant la fin du service : 409", (await formulaireAvis(cRefusee, cookieDe(emp.cookie))).code === 409);
  dire("un tiers : 404", (await formulaireAvis(cChoisie, cookieDe(autreEmp.cookie))).code === 404);

  const fa = await formulaireAvis(cChoisie, cookieDe(emp.cookie));
  const f2 = fa.donnees || {};
  dire("le formulaire de l'employeur, avec l'echelle et ses criteres",
       fa.code === 200 && f2.nomVise === "Test verifiee" && f2.echelle.length === 5 &&
       f2.echelle[0].note === 5 && f2.echelle[0].libelle === "Excellent" &&
       f2.criteres[0].libelle === "Ponctualité" && f2.commentaireMax === 1000, fa.brut.slice(0, 160));
  dire("l'exemple garde son apostrophe", f2.exempleCommentaire === "Ce qui s'est bien passé, ce qui pourrait être mieux.");
  const pageAvisEmp = await (await lire("/avis/" + cChoisie, emp.cookie)).text();
  dire("la page du site aussi", pageAvisEmp.includes("Ce qui s&#39;est bien passé") && pageAvisEmp.includes('maxlength="1000"') &&
       pageAvisEmp.includes("<strong>5</strong> sur 5, Excellent"));

  dire("sans note : 400", (await noter(cChoisie, { commentaire: "x" }, cookieDe(emp.cookie))).code === 400);
  const tropLongAvis = await noter(cChoisie, { note: 5, commentaire: "x".repeat(1001) }, cookieDe(emp.cookie));
  dire("un commentaire trop long est refuse, pas coupe : 400", tropLongAvis.code === 400 && !avisEnBase(emp.id), tropLongAvis.brut);
  dire("un objet a la place de la note : 400", (await noter(cChoisie, { note: { faux: true } }, cookieDe(emp.cookie))).code === 400);

  const publieAvis = await noter(cChoisie, { note: 4, commentaire: M + " tres bien", critere1: 5, critere2: "" },
                                 { Authorization: "Bearer " + jeton });
  dire("l'employeur publie son avis depuis l'application", publieAvis.code === 201 && Boolean(publieAvis.donnees.texte), publieAvis.brut);
  const sonAvis = avisEnBase(emp.id);
  dire("il est enregistre tel quel, la personne visee",
       sonAvis && sonAvis.note === 4 && sonAvis.critere1 === 5 && sonAvis.critere2 === null && sonAvis.vise_id === verifiee.id,
       JSON.stringify(sonAvis));
  dire("un seul avis : 409", (await noter(cChoisie, { note: 1 }, cookieDe(emp.cookie))).code === 409);
  dire("le formulaire aussi repond 409", (await formulaireAvis(cChoisie, cookieDe(emp.cookie))).code === 409);

  const formElle = await formulaireAvis(cChoisie, cookieDe(verifiee.cookie));
  dire("le formulaire de la personne a ses criteres a elle",
       formElle.code === 200 && formElle.donnees.criteres.some((x) => x.libelle === "Paiement déclaré sans retard") &&
       formElle.donnees.nomVise === "Test emp");
  await poster("/avis/" + cChoisie, form({ note: "2", commentaire: M + " paiement en retard" }), verifiee.cookie);

  const avisVus = (await discussion(cChoisie, cookieDe(emp.cookie))).donnees.avis;
  dire("la discussion montre son avis a lui",
       avisVus && avisVus.monAvis && avisVus.monAvis.note === 4 && avisVus.monAvis.commentaire === M + " tres bien" &&
       avisVus.monAvis.masque === false, JSON.stringify(avisVus && avisVus.monAvis));
  dire("et celui qu'il a recu, qu'il peut signaler",
       avisVus.avisRecu && avisVus.avisRecu.note === 2 && avisVus.avisRecu.auteur === "Test verifiee" &&
       avisVus.avisRecu.peutSignaler === true, JSON.stringify(avisVus.avisRecu));
  dire("pas d'avis dans une discussion dont le service n'est pas termine",
       (await discussion(cRefusee, cookieDe(emp.cookie))).donnees.avis === null);

  dire("on ne signale pas son propre avis : 404",
       (await json("/api/avis/" + sonAvis.id + "/signaler", {}, cookieDe(emp.cookie))).code === 404);
  const signalAvis = await json("/api/avis/" + avisVus.avisRecu.id + "/signaler", {}, cookieDe(emp.cookie));
  dire("il signale l'avis recu depuis l'application",
       signalAvis.code === 200 && base.prepare("SELECT signale FROM avis WHERE id = ?").get(avisVus.avisRecu.id).signale === 1,
       signalAvis.brut);
  const apresSignalAvis = (await discussion(cChoisie, cookieDe(emp.cookie))).donnees.avis.avisRecu;
  dire("il est dit signale, et ne se signale plus", apresSignalAvis.signale === true && apresSignalAvis.peutSignaler === false);
  dire("la page du site dit la meme chose",
       (await (await lire("/messages/" + cChoisie, emp.cookie)).text()).includes("Signalé"));

  console.log(SAUT + "--- MODIFIER UNE DEMANDE DEPUIS L'APPLICATION ---");
  const aModifier = await json("/api/demandes", complet(M + " a modifier"), cookieDe(emp.cookie));
  const idAModifier = aModifier.donnees.id;
  const modification = (id, entetes) => json("/api/demandes/" + id + "/modification", undefined, entetes);
  const modifier = (id, corps, entetes) => json("/api/demandes/" + id, corps, entetes);
  const ligneDemande = (id) =>
    base.prepare("SELECT titre, prix, annulee, mise_en_avant_jusqu_au FROM annonces WHERE id = ?").get(id);
  const sommeBloquee = (id) => base.prepare("SELECT montant, etat FROM versements WHERE annonce_id = ?").get(id);

  dire("sans session : 401", (await modification(idAModifier)).code === 401);
  dire("une personne qui repond : 403", (await modification(idAModifier, cookieDe(verifiee.cookie))).code === 403);
  dire("un autre employeur : 404", (await modification(idAModifier, cookieDe(autreEmp.cookie))).code === 404);
  const mod = await modification(idAModifier, cookieDe(emp.cookie));
  dire("le formulaire arrive prerempli, avec ses listes",
       mod.code === 200 && mod.donnees.valeurs.titre === M + " a modifier" && mod.donnees.valeurs.prix === "8000" &&
       mod.donnees.valeurs.horaire === "Mercredi 9h" && Array.isArray(mod.donnees.metiers) &&
       mod.donnees.avertissement === null, mod.brut.slice(0, 200));

  await poster("/candidatures", form({ annonceId: String(idAModifier) }), pre3.cookie);
  const modAvecReponse = (await modification(idAModifier, cookieDe(emp.cookie))).donnees;
  dire("une fois quelqu'un a repondu, l'employeur est prevenu",
       modAvecReponse.avertissement && modAvecReponse.avertissement.phrase.startsWith("1 personne a déjà répondu") &&
       modAvecReponse.avertissement.conseil.includes("prévenez-la"), JSON.stringify(modAvecReponse.avertissement));
  dire("la page du site dit la meme chose",
       (await (await lire("/annonces/" + idAModifier + "/modifier", emp.cookie)).text())
         .includes("1 personne a déjà répondu à cette demande."));

  const horsRegle = await modifier(idAModifier, Object.assign(complet(M + " a modifier"), { prix: 750 }), cookieDe(emp.cookie));
  dire("un prix hors regle : 400", horsRegle.code === 400 && ligneDemande(idAModifier).prix === 8000, horsRegle.brut);
  const modOk = await modifier(idAModifier, Object.assign(complet(M + " modifiee"), { prix: 9000 }),
                               { Authorization: "Bearer " + jeton });
  dire("la modification passe depuis l'application",
       modOk.code === 200 && ligneDemande(idAModifier).titre === M + " modifiee" && ligneDemande(idAModifier).prix === 9000,
       modOk.brut);
  dire("la somme bloquee suit le nouveau prix", sommeBloquee(idAModifier).montant === 9000,
       JSON.stringify(sommeBloquee(idAModifier)));

  // La faille : une demande pourvue se modifiait encore, et la somme promise avec.
  const modPourvue = await modifier(idAChoisir, Object.assign(complet(M + " a choisir"), { prix: 500 }), cookieDe(emp.cookie));
  dire("une demande pourvue ne se modifie plus : 409", modPourvue.code === 409 && ligneDemande(idAChoisir).prix === 8000,
       modPourvue.brut);
  const modPourvueWeb = await poster("/annonces/" + idAChoisir + "/modifier",
    form(Object.assign(complet(M + " a choisir"), { prix: "500" })), emp.cookie);
  dire("le site le refuse aussi", modPourvueWeb.code === 409 && ligneDemande(idAChoisir).prix === 8000,
       "code " + modPourvueWeb.code);
  dire("et son formulaire ne s'ouvre plus", (await lire("/annonces/" + idAChoisir + "/modifier", emp.cookie)).status === 409);

  console.log(SAUT + "--- METTRE EN AVANT DEPUIS L'APPLICATION ---");
  const infoMiseEnAvant = (id, entetes) => json("/api/demandes/" + id + "/mise-en-avant", undefined, entetes);
  const mettreEnAvantApi = (id, entetes) => json("/api/demandes/" + id + "/mise-en-avant", {}, entetes);
  const reglage = (cle) => Number((base.prepare("SELECT valeur FROM parametres WHERE cle = ?").get(cle) || {}).valeur);
  const coutReel = reglage("cout_mise_en_avant");
  const joursReels = reglage("duree_mise_en_avant_jours");
  const jetonsDeEmp = async () => (await json("/api/moi", undefined, cookieDe(emp.cookie))).donnees.moi.jetons.total;

  dire("un autre employeur : 404", (await infoMiseEnAvant(idAModifier, cookieDe(autreEmp.cookie))).code === 404);
  dire("une demande fermee : 409", (await infoMiseEnAvant(idAChoisir, cookieDe(emp.cookie))).code === 409);
  const ecranAvant = await infoMiseEnAvant(idAModifier, cookieDe(emp.cookie));

  if (coutReel > 0 && joursReels > 0) {
    dire("l'ecran dit le cout, la duree et ce qu'il restera",
         ecranAvant.code === 200 && ecranAvant.donnees.disponible === true &&
         ecranAvant.donnees.jours === Math.round(joursReels) && ecranAvant.donnees.finActuelle === null &&
         typeof ecranAvant.donnees.cout === "string" && typeof ecranAvant.donnees.resteApres === "string",
         ecranAvant.brut);
    let soldeAvant = await jetonsDeEmp();
    if (soldeAvant < coutReel) {
      dire("sans assez de jetons, l'ecran le dit", ecranAvant.donnees.soldeSuffit === false);
      const sansJetons = await mettreEnAvantApi(idAModifier, cookieDe(emp.cookie));
      dire("et l'envoi est refuse : 402",
           sansJetons.code === 402 && ligneDemande(idAModifier).mise_en_avant_jusqu_au === null, sansJetons.brut);
      crediter(emp.id, coutReel);
      soldeAvant = await jetonsDeEmp();
    }
    const posee = await mettreEnAvantApi(idAModifier, { Authorization: "Bearer " + jeton });
    dire("la mise en avant passe depuis l'application",
         posee.code === 200 && Boolean(ligneDemande(idAModifier).mise_en_avant_jusqu_au), posee.brut);
    const soldeApres = await jetonsDeEmp();
    dire("son cout est preleve", soldeApres === soldeAvant - coutReel, soldeAvant + " -> " + soldeApres);
    const dejaEnAvant = await mettreEnAvantApi(idAModifier, cookieDe(emp.cookie));
    dire("deja en avant : 409, sans payer deux fois",
         dejaEnAvant.code === 409 && (await jetonsDeEmp()) === soldeApres, dejaEnAvant.brut);
    dire("l'ecran dit jusqu'a quand",
         typeof (await infoMiseEnAvant(idAModifier, cookieDe(emp.cookie))).donnees.finActuelle === "string");
    const lueEnAvant = (await mesDemandes(emp.cookie)).donnees.demandes.find((x) => x.id === idAModifier);
    dire("Mes demandes la dit en avant, sans le bouton", lueEnAvant.enAvant === true && lueEnAvant.peutMettreEnAvant === false);
  } else {
    dire("sans reglage de l'equipe, l'option est dite indisponible",
         ecranAvant.code === 200 && ecranAvant.donnees.disponible === false);
  }

  console.log(SAUT + "--- RETIRER UNE DEMANDE DEPUIS L'APPLICATION ---");
  const retirerApi = (id, entetes) => json("/api/demandes/" + id + "/retirer", {}, entetes);
  dire("le site demande confirmation avant de retirer",
       (await (await lire("/mes-demandes", emp.cookie)).text())
         .includes('data-question="Voulez-vous vraiment retirer cette demande ?"'));
  dire("un autre employeur : 404", (await retirerApi(idAModifier, cookieDe(autreEmp.cookie))).code === 404);
  dire("une demande pourvue ne se retire pas : 409", (await retirerApi(idAChoisir, cookieDe(emp.cookie))).code === 409);
  const retraitApi = await retirerApi(idAModifier, { Authorization: "Bearer " + jeton });
  dire("le retrait passe depuis l'application", retraitApi.code === 200 && ligneDemande(idAModifier).annulee === 1,
       retraitApi.brut);
  dire("la somme bloquee est rendue", sommeBloquee(idAModifier).etat === "rembourse", JSON.stringify(sommeBloquee(idAModifier)));
  dire("retirer deux fois : 409", (await retirerApi(idAModifier, cookieDe(emp.cookie))).code === 409);
  const reponseDePre3 = base.prepare("SELECT id FROM candidatures WHERE annonce_id = ?").get(idAModifier).id;
  dire("la personne qui avait repondu garde sa discussion",
       (await discussion(reponseDePre3, cookieDe(pre3.cookie))).code === 200);

  console.log(SAUT + "--- MES MESSAGES DEPUIS L'APPLICATION ---");
  const listeApi = (entetes) => json("/api/discussions", undefined, entetes);
  dire("sans session : 401", (await listeApi()).code === 401);

  const lEmp = await listeApi(cookieDe(emp.cookie));
  const d3 = lEmp.donnees || {};
  dire("la liste de l'employeur arrive rangee",
       lEmp.code === 200 && Array.isArray(d3.enCours) && Array.isArray(d3.terminees) && d3.vide === null,
       lEmp.brut.slice(0, 160));
  const serviceTermine = (d3.terminees || []).find((x) => x.id === cChoisie);
  dire("le service termine est range a part, avec sa date, et son avis deja donne",
       serviceTermine && typeof serviceTermine.termineeLe === "string" && serviceTermine.avisAttendu === false,
       JSON.stringify(serviceTermine));
  const discussionEcartee = (d3.enCours || []).find((x) => x.id === cRefusee);
  dire("une discussion en cours, avec la phrase de l'employeur et sans message",
       discussionEcartee && discussionEcartee.avec === "Test trois" && discussionEcartee.phraseStatut === "Vous avez choisi quelqu'un d'autre" &&
       discussionEcartee.phraseMessages === "Aucun message échangé", JSON.stringify(discussionEcartee));

  await poster("/messages/" + cNonVerifiee, form({ texte: M + " premier" }), pre4.cookie);
  await poster("/messages/" + cNonVerifiee, form({ texte: M + " second" }), pre4.cookie);
  const avecNouveaux = (await listeApi(cookieDe(emp.cookie))).donnees;
  const nonLue = avecNouveaux.enCours.find((x) => x.id === cNonVerifiee);
  dire("deux messages non lus sont dits",
       nonLue && nonLue.phraseNonLus === "2 nouveaux messages" && nonLue.phraseMessages === "2 messages" &&
       typeof nonLue.dernierMessage === "string", JSON.stringify(nonLue));
  const moiAvecNouveaux = (await json("/api/moi", undefined, cookieDe(emp.cookie))).donnees.moi;
  dire("le compteur du menu les compte, comme la liste",
       moiAvecNouveaux.aVoir >= 2 && moiAvecNouveaux.aVoir === avecNouveaux.aVoir,
       moiAvecNouveaux.aVoir + " / " + avecNouveaux.aVoir);
  const pageMessages = await (await lire("/messages", emp.cookie)).text();
  dire("la page du site dit la meme chose",
       pageMessages.includes("/messages/" + cNonVerifiee) && pageMessages.includes("2 nouveaux messages") &&
       pageMessages.includes("Services terminés"));
  await discussion(cNonVerifiee, cookieDe(emp.cookie));
  const apresLecture = (await listeApi(cookieDe(emp.cookie))).donnees.enCours.find((x) => x.id === cNonVerifiee);
  dire("une fois la discussion ouverte, plus rien de nouveau", apresLecture.phraseNonLus === null);

  const listePre = (await listeApi(cookieDe(pre3.cookie))).donnees;
  const pourPre3 = listePre.enCours.find((x) => x.id === reponseDePre3);
  dire("la personne qui a repondu lit ses propres phrases",
       pourPre3 && pourPre3.avec === "Test emp" && pourPre3.phraseStatut === "L'employeur a retiré cette demande",
       JSON.stringify(pourPre3));

  const listeVide = (await listeApi(cookieDe(autreEmp.cookie))).donnees;
  dire("sans discussion, la liste dit pourquoi a l'employeur",
       listeVide.vide && listeVide.vide.phrase === "Aucune discussion pour le moment." &&
       String(listeVide.vide.aide).startsWith("Une discussion s'ouvre lorsque quelqu'un répond"),
       JSON.stringify(listeVide.vide));

  console.log(SAUT + "--- VOIR LE PROFIL D'UNE PERSONNE ---");
  const fiche = (id, entetes) => json("/api/personnes/" + id, undefined, entetes);
  dire("un profil inexistant : 404", (await fiche(999999999, cookieDe(emp.cookie))).code === 404);
  dire("un employeur n'a pas de fiche publique : 404", (await fiche(emp.id, cookieDe(emp.cookie))).code === 404);
  const ficheVerifiee = await fiche(verifiee.id, cookieDe(emp.cookie));
  const fv = ficheVerifiee.donnees || {};
  dire("la fiche de la personne, avec ce que la plateforme a verifie",
       ficheVerifiee.code === 200 && fv.nom === "Test verifiee" && fv.verifiee === true &&
       fv.libelleVerification === "Identité et casier vérifiés" && fv.tarif === "15 000 FCFA" &&
       fv.peutPublier === true, ficheVerifiee.brut.slice(0, 200));
  dire("l'avis qu'elle a recu y figure, avec son auteur",
       fv.avis && fv.avis.nombre >= 1 &&
       fv.avis.liste.some((a) => a.auteur === "Test emp" && String(a.note).endsWith("sur 5")),
       JSON.stringify(fv.avis));
  dire("aucune coordonnee ne sort", !ficheVerifiee.brut.includes("@example.com") && !ficheVerifiee.brut.includes("date_naissance"));
  const pageFiche = await (await lire("/personnes/" + verifiee.id, emp.cookie)).text();
  dire("la page du site montre le meme tarif et la meme verification",
       pageFiche.includes(fv.tarif) && pageFiche.includes(fv.libelleVerification));
  const ficheVisiteur = await fiche(verifiee.id);
  dire("un visiteur y accede aussi, comme sur le site, sans bouton pour publier",
       ficheVisiteur.code === 200 && ficheVisiteur.donnees.peutPublier === false);
  const confAvecFiche = await json("/api/candidatures/" + cRefusee + "/confirmation", undefined, cookieDe(emp.cookie));
  dire("l'ecran de choix refuse toujours une decision deja prise", confAvecFiche.code === 409);

  console.log(SAUT + "--- SIGNALER UN PROBLEME DEPUIS L'APPLICATION ---");
  const formProbleme = (id, entetes) => json("/api/discussions/" + id + "/probleme", undefined, entetes);
  const envoyerProbleme = (id, texte, entetes) => json("/api/discussions/" + id + "/probleme", { texte }, entetes);
  const problemesDe = (id, auteurId) =>
    base.prepare("SELECT COUNT(*) n FROM problemes WHERE candidature_id = ? AND auteur_id = ?").get(id, auteurId).n;

  dire("sans session : 401", (await formProbleme(cRefusee)).code === 401);
  dire("un tiers : 404", (await formProbleme(cRefusee, cookieDe(autreEmp.cookie))).code === 404);
  const fp = await formProbleme(cRefusee, cookieDe(emp.cookie));
  dire("le formulaire nomme la personne concernee et dit ce qui suivra",
       fp.code === 200 && fp.donnees.autre === "Test trois" && fp.donnees.dejaSignale === false &&
       fp.donnees.consequences.includes("avertissement à Test trois") &&
       fp.donnees.apresSignalement.includes("votre demande"), fp.brut);
  dire("la page du site dit la meme chose",
       (await (await lire("/probleme/" + cRefusee, emp.cookie)).text()).includes("adresser un avertissement à Test trois"));
  dire("un texte trop court : 400", (await envoyerProbleme(cRefusee, "court", cookieDe(emp.cookie))).code === 400);
  const problemeTropLong = await envoyerProbleme(cRefusee, "x".repeat(2001), cookieDe(emp.cookie));
  dire("un texte trop long est refuse, pas coupe : 400",
       problemeTropLong.code === 400 && problemesDe(cRefusee, emp.id) === 0, problemeTropLong.brut);
  const envoiProbleme = await envoyerProbleme(cRefusee, M + " il ne repond plus aux messages",
                                              { Authorization: "Bearer " + jeton });
  dire("le signalement part depuis l'application",
       envoiProbleme.code === 201 && problemesDe(cRefusee, emp.id) === 1, envoiProbleme.brut);
  dire("un second avant examen : 409",
       (await envoyerProbleme(cRefusee, M + " encore une fois", cookieDe(emp.cookie))).code === 409);
  dire("le formulaire dit qu'il est deja envoye", (await formProbleme(cRefusee, cookieDe(emp.cookie))).donnees.dejaSignale === true);
  const fpPre = await formProbleme(cRefusee, cookieDe(pre3.cookie));
  dire("de l'autre cote, la phrase parle de sa candidature",
       fpPre.code === 200 && fpPre.donnees.autre === "Test emp" && fpPre.donnees.apresSignalement.includes("votre candidature"),
       fpPre.brut);

  console.log(SAUT + "--- MON PROFIL ---");
  const monProfilApi = (entetes) => json("/api/mon-profil", undefined, entetes);
  dire("sans session : 401", (await monProfilApi()).code === 401);
  const equipe = await creerCompte("equipe", "employeur");
  base.prepare("UPDATE utilisateurs SET est_admin = 1 WHERE id = ?").run(equipe.id);
  dire("un compte d'equipe : 403, son espace reste sur le site", (await monProfilApi(cookieDe(equipe.cookie))).code === 403);

  const TEXTE_EQUIPE = M + " merci de confirmer le versement";
  base.prepare(`UPDATE utilisateurs SET message_equipe = ?, message_equipe_le = datetime('now'),
                message_equipe_lu = 0 WHERE id = ?`).run(TEXTE_EQUIPE, emp.id);
  const profilEmp = await monProfilApi(cookieDe(emp.cookie));
  const pe = profilEmp.donnees || {};
  dire("le profil de l'employeur, formule par le serveur",
       profilEmp.code === 200 && pe.nom === "Test emp" && pe.fonction === "Employeur" && pe.email === emp.mail &&
       pe.verification && pe.verification.libelle === "Identité vérifiée" && pe.tarif === null &&
       pe.badges.length === 0 && pe.avis.vide.includes("Les personnes que vous embauchez"),
       profilEmp.brut.slice(0, 300));
  dire("le message de l'equipe y attend, et compte dans la pastille",
       pe.messageEquipe && pe.messageEquipe.texte === TEXTE_EQUIPE && pe.aLire === 1 &&
       (await json("/api/moi", undefined, cookieDe(emp.cookie))).donnees.moi.aLire === 1);
  dire("l'avis de la personne employee y figure, avec son signalement",
       pe.avis.nombre >= 1 && pe.avis.liste.some((a) => a.auteur === "Test verifiee" && a.signale === true && a.id > 0),
       JSON.stringify(pe.avis));
  const pageProfilEmp = await (await lire("/mon-profil", emp.cookie)).text();
  dire("la page du site montre le meme message, la meme verification et la meme note",
       pageProfilEmp.includes(TEXTE_EQUIPE) && pageProfilEmp.includes(pe.verification.libelle) &&
       pageProfilEmp.includes(pe.avis.liste[0].note));

  const MOTIF = M + " le prix ne se negocie pas";
  base.prepare(`UPDATE utilisateurs SET avertissement_motif = ?, avertissement_le = date('now'),
                avertissement_lu = 0 WHERE id = ?`).run(MOTIF, verifiee.id);
  const profilPre = await monProfilApi(cookieDe(verifiee.cookie));
  const pp = profilPre.donnees || {};
  const metierEnBase = base.prepare("SELECT metier FROM utilisateurs WHERE id = ?").get(verifiee.id).metier;
  dire("le profil de la personne qui repond : son metier, ses badges, son tarif detaille",
       profilPre.code === 200 && pp.fonction === metierEnBase &&
       pp.badges.some((b) => b.verifie === true && b.texte === "Identité et casier vérifiés") &&
       pp.tarif.lignes.length === 3 && pp.tarif.lignes[0].montant === "15 000 FCFA" &&
       pp.tarif.lignes[1].retenue === true && pp.tarif.lignes[2].total === true &&
       pp.tarif.lignes[2].montant === "13 500 FCFA" && pp.tarif.aide.startsWith("Ce tarif est indicatif"),
       profilPre.brut.slice(0, 400));
  dire("l'avertissement y attend", pp.avertissement && pp.avertissement.motif === MOTIF && pp.aLire === 1);
  dire("l'avis recu de l'employeur, pas signale",
       pp.avis.liste.some((a) => a.auteur === "Test emp" && a.signale === false), JSON.stringify(pp.avis));
  const pageProfilPre = await (await lire("/mon-profil", verifiee.cookie)).text();
  dire("la page du site montre le meme metier, le meme montant recu et le meme avertissement",
       pageProfilPre.includes(pp.fonction) && pageProfilPre.includes(pp.tarif.lignes[2].montant) &&
       pageProfilPre.includes(MOTIF));

  const luEquipe = await json("/api/mon-profil/message-equipe/lu", {}, { Authorization: "Bearer " + jeton });
  const apresLu = (await monProfilApi(cookieDe(emp.cookie))).donnees;
  dire("J'ai lu, depuis l'application : le message disparait, sur le site aussi",
       luEquipe.code === 200 && apresLu.messageEquipe === null && apresLu.aLire === 0 &&
       !(await (await lire("/mon-profil", emp.cookie)).text()).includes(TEXTE_EQUIPE), luEquipe.brut);
  const luAvertissement = await json("/api/mon-profil/avertissement/lu", {}, cookieDe(verifiee.cookie));
  dire("l'avertissement aussi",
       luAvertissement.code === 200 && (await monProfilApi(cookieDe(verifiee.cookie))).donnees.avertissement === null);
  dire("sans session, J'ai lu : 401", (await json("/api/mon-profil/avertissement/lu", {})).code === 401);

  console.log(SAUT + "--- MODIFIER MON PROFIL ---");
  const formProfil = (entetes) => json("/api/mon-profil/modification", undefined, entetes);
  const enregistrerProfil = (corps, entetes) => json("/api/mon-profil", corps, entetes);
  const ligneDe = (id) => base.prepare(`
    SELECT nom, quartier, arrondissement, metier, tarif, date_naissance, experience_annees, disponibilites
    FROM utilisateurs WHERE id = ?`).get(id);
  dire("sans session : 401", (await formProfil()).code === 401);
  dire("un compte d'equipe : 403", (await formProfil(cookieDe(equipe.cookie))).code === 403);

  const fe = await formProfil(cookieDe(emp.cookie));
  dire("le formulaire de l'employeur : son nom et son quartier, sans metier ni disponibilites",
       fe.code === 200 && fe.donnees.nom === "Test emp" && fe.donnees.quartier === "Bastos" &&
       fe.donnees.pourPersonne === false && fe.donnees.metier === null && fe.donnees.jours.length === 0 &&
       fe.donnees.arrondissements.includes(fe.donnees.arrondissement), fe.brut.slice(0, 300));
  const nomVide = await enregistrerProfil({ nom: "  ", quartier: "Bastos" }, cookieDe(emp.cookie));
  dire("sans nom : 400, rien ne change",
       nomVide.code === 400 && erreurDe(nomVide).startsWith("Indiquez le nom") && ligneDe(emp.id).nom === "Test emp",
       nomVide.brut);
  dire("un objet a la place du nom : 400",
       (await enregistrerProfil({ nom: { faux: true } }, cookieDe(emp.cookie))).code === 400);
  const arrondissementBastos = base.prepare("SELECT arrondissement FROM quartiers WHERE nom = 'Bastos'").get().arrondissement;
  const enrEmp = await enregistrerProfil({ nom: "Test emp", quartier: "bastos", arrondissement: "",
                                           metier: "Ménage à domicile", tarif: "5000" },
                                         { Authorization: "Bearer " + jeton });
  const apresEmp = ligneDe(emp.id);
  dire("l'employeur enregistre depuis l'application : quartier reconnu, ni metier ni tarif",
       enrEmp.code === 200 && enrEmp.donnees.texte === "Vos informations ont bien été enregistrées." &&
       apresEmp.quartier === "Bastos" && apresEmp.arrondissement === arrondissementBastos &&
       apresEmp.metier === null && apresEmp.tarif === null, enrEmp.brut + " " + JSON.stringify(apresEmp));

  const formulairePre = await formProfil(cookieDe(verifiee.cookie));
  const formulairePreDonnees = formulairePre.donnees || {};
  dire("le formulaire de la personne qui repond : metier, tarif, sept jours de trois moments",
       formulairePre.code === 200 && formulairePreDonnees.pourPersonne === true && formulairePreDonnees.metier === metierEnBase && formulairePreDonnees.tarif === "15000" &&
       formulairePreDonnees.jours.length === 7 && formulairePreDonnees.jours.every((j) => j.creneaux.length === formulairePreDonnees.moments.length) &&
       formulairePreDonnees.anneesNaissance.a - formulairePreDonnees.anneesNaissance.de === 102, formulairePre.brut.slice(0, 300));
  const profilDeBase = { nom: "Test verifiee", quartier: "Bastos", metier: metierEnBase, tarif: "15000" };
  const avecChamp = (champs) => Object.assign({}, profilDeBase, champs);
  const tranche = await enregistrerProfil(avecChamp({ tarif: "15250" }), cookieDe(verifiee.cookie));
  dire("un tarif hors tranches : 400", tranche.code === 400 && tranche.brut.includes("par tranches de 500"), tranche.brut);
  const experienceTrop = await enregistrerProfil(avecChamp({ experience_annees: "75" }), cookieDe(verifiee.cookie));
  const experienceTexte = await enregistrerProfil(avecChamp({ experience_annees: "beaucoup" }), cookieDe(verifiee.cookie));
  dire("une experience de 75 ans, ou en lettres : 400",
       experienceTrop.code === 400 && experienceTexte.code === 400 && ligneDe(verifiee.id).experience_annees === null,
       experienceTrop.brut);
  const fevrier = await enregistrerProfil(avecChamp({ date_naissance: "1995-02-31" }), cookieDe(verifiee.cookie));
  dire("une date qui n'existe pas, le 31 fevrier : 400",
       fevrier.code === 400 && ligneDe(verifiee.id).date_naissance === null, fevrier.brut);
  dire("des disponibilites qui ne sont pas une liste : 400",
       (await enregistrerProfil(avecChamp({ disponibilites: "lundi-matin" }), cookieDe(verifiee.cookie))).code === 400);
  const enrPre = await enregistrerProfil(avecChamp({
    date_naissance: "1995-06-15", experience_annees: "4",
    disponibilites: ["samedi-soir", "lundi-matin", "dimanche-nuit"] }), cookieDe(verifiee.cookie));
  const apresPre = ligneDe(verifiee.id);
  dire("la personne enregistre : un creneau inconnu est ecarte",
       enrPre.code === 200 && apresPre.experience_annees === 4 && apresPre.date_naissance === "1995-06-15" &&
       apresPre.disponibilites === "lundi-matin|samedi-soir", JSON.stringify(apresPre));
  const fpApres = (await formProfil(cookieDe(verifiee.cookie))).donnees;
  const pageModif = await (await lire("/mon-profil/modifier", verifiee.cookie)).text();
  dire("le formulaire rouvert coche les memes cases que la page du site",
       fpApres.jours[0].creneaux[0].coche === true && fpApres.jours[5].creneaux[2].coche === true &&
       fpApres.jours[0].creneaux[1].coche === false &&
       fpApres.experienceAnnees === "4" && fpApres.dateNaissance === "1995-06-15" &&
       pageModif.includes('value="lundi-matin" checked') && pageModif.includes('value="1995-06-15"'));
  const siteTrop = await poster("/mon-profil/modifier", form(avecChamp({ experience_annees: "75" })), verifiee.cookie);
  const siteFevrier = await poster("/mon-profil/modifier", form(avecChamp({ date_naissance: "1995-02-31" })), verifiee.cookie);
  dire("le site refuse aussi l'experience de 75 ans et le 31 fevrier",
       siteTrop.code === 400 && siteFevrier.code === 400 && ligneDe(verifiee.id).experience_annees === 4 &&
       ligneDe(verifiee.id).date_naissance === "1995-06-15", "codes " + siteTrop.code + " " + siteFevrier.code);

  const detailTarif = await json("/api/detail-tarif?montant=15000", undefined, cookieDe(verifiee.cookie));
  const detailVide = await json("/api/detail-tarif?montant=abc", undefined, cookieDe(verifiee.cookie));
  dire("le detail du tarif pendant la saisie, calcule par le serveur",
       detailTarif.code === 200 && detailTarif.donnees.lignes[2].montant === "13 500 FCFA" &&
       detailVide.donnees.lignes.length === 0 && (await json("/api/detail-tarif?montant=15000")).code === 401,
       detailTarif.brut);

  console.log(SAUT + "--- UNE ADRESSE D'API INCONNUE ---");
  const inconnue = await json("/api/cet-ecran-n-existe-pas", undefined, { Authorization: "Bearer " + jeton });
  dire("elle repond en JSON, avec une phrase qui dit quoi faire",
       inconnue.code === 404 && inconnue.donnees !== null && String(inconnue.donnees.erreur).includes("relancez-le"),
       inconnue.brut.slice(0, 120));
  const pageInconnue = await lire("/cette-page-n-existe-pas", emp.cookie);
  dire("une page inconnue du site reste une page",
       pageInconnue.status === 404 && String(pageInconnue.headers.get("content-type")).includes("text/html"));

  console.log(SAUT + "--- CHANGER L'ADRESSE ET LE MOT DE PASSE ---");
  const changerEmail = (corps, entetes) => json("/api/mon-profil/email", corps, entetes);
  const changerMotDePasse = (corps, entetes) => json("/api/mon-profil/mot-de-passe", corps, entetes);
  const emailEnBase = (id) => base.prepare("SELECT email FROM utilisateurs WHERE id = ?").get(id).email;
  dire("sans session : 401", (await changerEmail({})).code === 401 && (await changerMotDePasse({})).code === 401);
  dire("un compte d'equipe : 403",
       (await changerEmail({ nouveau: "equipe@example.com", motdepasse: "motdepasse123" }, cookieDe(equipe.cookie))).code === 403);
  const formAvecCles = (await formProfil(cookieDe(emp.cookie))).donnees;
  dire("le formulaire donne l'adresse actuelle et la longueur minimale",
       formAvecCles.email === emp.mail && formAvecCles.motDePasseMin === 6, JSON.stringify(formAvecCles.email));

  const NOUVEL_EMAIL = (M + "-emp-nouvelle@example.com").toLowerCase();
  const emailSansMotDePasse = await changerEmail({ nouveau: NOUVEL_EMAIL, motdepasse: "pas-le-bon" }, cookieDe(emp.cookie));
  dire("sans le bon mot de passe : 403, l'adresse ne change pas",
       emailSansMotDePasse.code === 403 && emailEnBase(emp.id) === emp.mail, emailSansMotDePasse.brut);
  dire("une adresse sans @ : 400",
       (await changerEmail({ nouveau: "pas-une-adresse", motdepasse: "motdepasse123" }, cookieDe(emp.cookie))).code === 400);
  dire("la meme adresse : 400",
       (await changerEmail({ nouveau: emp.mail, motdepasse: "motdepasse123" }, cookieDe(emp.cookie))).code === 400);
  dire("l'adresse d'un autre compte : 409",
       (await changerEmail({ nouveau: verifiee.mail, motdepasse: "motdepasse123" }, cookieDe(emp.cookie))).code === 409);
  dire("un objet a la place de l'adresse : 400",
       (await changerEmail({ nouveau: { faux: true }, motdepasse: "motdepasse123" }, cookieDe(emp.cookie))).code === 400);
  const emailChange = await changerEmail({ nouveau: NOUVEL_EMAIL.toUpperCase(), motdepasse: "motdepasse123" },
                                         { Authorization: "Bearer " + jeton });
  dire("la nouvelle adresse est enregistree en minuscules, et la session reste ouverte",
       emailChange.code === 200 && emailChange.donnees.email === NOUVEL_EMAIL && emailEnBase(emp.id) === NOUVEL_EMAIL &&
       (await monProfilApi({ Authorization: "Bearer " + jeton })).code === 200, emailChange.brut);
  dire("on se connecte avec la nouvelle adresse",
       (await json("/api/connexion", { email: NOUVEL_EMAIL, motdepasse: "motdepasse123" })).code === 200);

  const motDePasseSansAncien = await changerMotDePasse({ ancien: "pas-le-bon", nouveau: "motdepasse456" }, cookieDe(emp.cookie));
  dire("sans l'ancien mot de passe : 403", motDePasseSansAncien.code === 403, motDePasseSansAncien.brut);
  const motDePasseCourt = await changerMotDePasse({ ancien: "motdepasse123", nouveau: "abc" }, cookieDe(emp.cookie));
  dire("un mot de passe de 3 caracteres : 400",
       motDePasseCourt.code === 400 && erreurDe(motDePasseCourt).includes("6 caractères"), motDePasseCourt.brut);
  const motDePasseChange = await changerMotDePasse({ ancien: "motdepasse123", nouveau: "motdepasse456" }, cookieDe(emp.cookie));
  dire("le nouveau mot de passe est actif, l'ancien ne marche plus",
       motDePasseChange.code === 200 &&
       (await json("/api/connexion", { email: NOUVEL_EMAIL, motdepasse: "motdepasse456" })).code === 200 &&
       (await json("/api/connexion", { email: NOUVEL_EMAIL, motdepasse: "motdepasse123" })).code === 401,
       motDePasseChange.brut);
  const pageAvecCles = await (await lire("/mon-profil/modifier", emp.cookie)).text();
  dire("la page du site montre la nouvelle adresse et la meme longueur minimale",
       pageAvecCles.includes(NOUVEL_EMAIL) && pageAvecCles.includes('minlength="6"'));

  console.log(SAUT + "--- MON COMPTE ---");
  const monCompteApi = (entetes) => json("/api/mon-compte", undefined, entetes);
  dire("sans session : 401", (await monCompteApi()).code === 401);
  dire("un compte d'equipe : 403", (await monCompteApi(cookieDe(equipe.cookie))).code === 403);

  const compteEmp = await monCompteApi({ Authorization: "Bearer " + jeton });
  const ce = compteEmp.donnees || {};
  const versementsEmp = base.prepare("SELECT etat FROM versements WHERE employeur_id = ?").all(emp.id);
  dire("l'employeur voit chaque somme posee, avec son etat et ses dates",
       compteEmp.code === 200 && ce.jeSuisEmployeur === true && ce.totalRecu === null && ce.recus.length === 0 &&
       versementsEmp.length > 0 && ce.envoyes.length === versementsEmp.length &&
       ce.envoyes.some((v) => v.etat === "verse" && v.libelleEtat === "Versé à Test verifiee" && v.denoue.startsWith("Versé le ")) &&
       ce.envoyes.filter((v) => v.etat === "bloque").every((v) => v.rappelDeclaration === true && v.denoue === null) &&
       versementsEmp.some((v) => v.etat === "rembourse") === ce.envoyes.some((v) => v.libelleEtat === "Rendu"),
       compteEmp.brut.slice(0, 300));
  const pageCompteEmp = await (await lire("/mon-compte", emp.cookie)).text();
  dire("la page du site montre les memes etats et les memes dates",
       ce.envoyes.every((v) => pageCompteEmp.includes(v.libelleEtat) && pageCompteEmp.includes("Bloqué le " + v.bloqueLe)));

  const comptePre = await monCompteApi(cookieDe(verifiee.cookie));
  const cp = comptePre.donnees || {};
  const soldePre = base.prepare(
    "SELECT COALESCE(SUM(net), 0) AS s FROM versements WHERE beneficiaire_id = ? AND etat = 'verse'").get(verifiee.id).s;
  dire("la personne voit le total recu et le detail de chaque service",
       comptePre.code === 200 && cp.jeSuisEmployeur === false && cp.envoyes.length === 0 && soldePre > 0 &&
       cp.totalRecu === soldePre.toLocaleString("fr-FR").replace(/[\u202f\u00a0]/g, " ") + " FCFA" &&
       cp.recus.length >= 1 && cp.recus[0].chez === "Test emp" && cp.recus[0].lignes.length === 3 &&
       cp.recus[0].lignes[1].retenue === true && cp.recus[0].lignes[2].total === true,
       comptePre.brut.slice(0, 300));
  const pageComptePre = await (await lire("/mon-compte", verifiee.cookie)).text();
  dire("la page du site montre le meme total, le meme montant recu et la meme date",
       pageComptePre.includes(cp.totalRecu) && pageComptePre.includes(cp.recus[0].lignes[2].montant) &&
       pageComptePre.includes("Versé le " + cp.recus[0].verseLe));

  console.log(SAUT + "--- NETTOYAGE ---");
  const n = base.prepare("DELETE FROM utilisateurs WHERE email LIKE ?").run("%" + M + "%").changes;
  console.log("  " + n + " comptes de test supprimes");

  console.log(SAUT + "RESULTAT : " + ok + " reussis, " + ko + " echec(s)");
  process.exit(ko === 0 ? 0 : 1);
}, 600);
