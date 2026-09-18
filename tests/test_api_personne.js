// Série : l'API de la personne qui répond aux demandes.
//
// Ce qui doit tenir :
//   - seule une personne verifiee, qui propose ses services, peut repondre ;
//   - l'ecran de reponse dit ce que dit la page du site : le prix, ce
//     qu'elle recevra, ce que la reponse coute en jetons ;
//   - le jeton n'est preleve que si la reponse part ;
//   - une reponse ne part pas deux fois, ni sur une demande retiree ;
//   - le site et l'application passent par la meme fonction.
const PROJET = require("path").join(__dirname, "..");
process.chdir(PROJET);
require(PROJET + "/_serveur_test_temporaire.js");

const base = require(PROJET + "/node_modules/better-sqlite3")(PROJET + "/data/pamconnect.db");
base.pragma("foreign_keys = ON");

const RACINE = "http://127.0.0.1:3999";
const M = "test-api-pers";
const SAUT = String.fromCharCode(10);
let ok = 0, ko = 0;

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

async function creerCompte(suffixe, role, extra, verifier) {
  const mail = (M + "-" + suffixe + "@example.com").toLowerCase();
  await poster("/inscription", form(Object.assign(
    { role, nom: "Test " + suffixe, email: mail, motdepasse: "motdepasse123", telephone: "600000000", quartier: "Bastos" },
    extra || {})));
  if (verifier !== false) {
    base.prepare("UPDATE utilisateurs SET statut_verification = 'verifie' WHERE email = ?").run(mail);
  }
  const c = await poster("/connexion", form({ email: mail, motdepasse: "motdepasse123", telephone: "600000000" }));
  const id = base.prepare("SELECT id FROM utilisateurs WHERE email = ?").get(mail).id;
  return { mail, id, cookie: c.cookie };
}

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

// Les jetons ne sont pas le sujet : on en donne assez pour repondre.
const crediter = (id, n) => base.prepare(`
  INSERT INTO jetons_mouvements (utilisateur_id, quantite, nature, motif, detail)
  VALUES (?, ?, 'achete', 'achat', 'Credit de test')
`).run(id, n);
const soldeDe = (id) => base.prepare(
  "SELECT COALESCE(SUM(quantite), 0) AS s FROM jetons_mouvements WHERE utilisateur_id = ?").get(id).s;

setTimeout(async () => {
  base.prepare("DELETE FROM utilisateurs WHERE email LIKE ?").run("%" + M + "%");

  const emp = await creerCompte("emp", "employeur");
  const elle = await creerCompte("elle", "prestataire", { metier: "menagere", tarif: "15000" });
  const pasVerifiee = await creerCompte("attente", "prestataire", { metier: "menagere", tarif: "15000" }, false);
  const fauchee = await creerCompte("fauchee", "prestataire", { metier: "menagere", tarif: "15000" });
  crediter(elle.id, 10);

  const metierElle = base.prepare("SELECT metier FROM utilisateurs WHERE id = ?").get(elle.id).metier;
  const arrondissementBastos = base.prepare("SELECT arrondissement FROM quartiers WHERE nom = 'Bastos'").get().arrondissement;

  // Les demandes sont posees directement : cette serie parle de la reponse,
  // la publication a la sienne.
  const nouvelleDemande = (titre, annulee) => Number(base.prepare(`
    INSERT INTO annonces (employeur_id, titre, metier, quartier, arrondissement, horaire, prix,
                          unite_tarif, conditions, annulee)
    VALUES (?, ?, ?, 'Bastos', ?, 'Samedi 9h', 20000, 'forfaitaire', 'Deuxième étage sans ascenseur.', ?)
  `).run(emp.id, M + " " + titre, metierElle, arrondissementBastos, annulee ? 1 : 0).lastInsertRowid);
  const ouverte = nouvelleDemande("ouverte", false);
  const retiree = nouvelleDemande("retiree", true);
  const seconde = nouvelleDemande("seconde", false);

  const jetonElle = (await json("/api/connexion", { email: elle.mail, motdepasse: "motdepasse123", telephone: "600000000" })).donnees.jeton;
  const parJeton = { Authorization: "Bearer " + jetonElle };
  const ecranApi = (id, entetes) => json("/api/demandes/" + id + "/reponse", undefined, entetes);
  const repondre = (id, entetes) => json("/api/demandes/" + id + "/reponse", {}, entetes);

  console.log(SAUT + "--- QUI PEUT REPONDRE ---");
  dire("sans session : 401", (await ecranApi(ouverte)).code === 401 && (await repondre(ouverte)).code === 401);
  const parEmployeur = await ecranApi(ouverte, cookieDe(emp.cookie));
  dire("un employeur : 403",
       parEmployeur.code === 403 && (await repondre(ouverte, cookieDe(emp.cookie))).code === 403, parEmployeur.brut);
  const nonVerifiee = await repondre(ouverte, cookieDe(pasVerifiee.cookie));
  dire("une personne pas encore verifiee : 403, avec la raison qui la concerne",
       nonVerifiee.code === 403 && erreurDe(nonVerifiee).includes("il a le droit de savoir qui vient"), nonVerifiee.brut);
  dire("une demande qui n'existe pas : 404", (await ecranApi(999999999, parJeton)).code === 404);
  dire("une demande retiree : 410",
       (await ecranApi(retiree, parJeton)).code === 410 && (await repondre(retiree, parJeton)).code === 410);

  console.log(SAUT + "--- CE QU'ELLE LIT AVANT DE REPONDRE ---");
  const ecran = await ecranApi(ouverte, parJeton);
  const e = ecran.donnees || {};
  dire("la demande, l'employeur et ce qu'elle recevra",
       ecran.code === 200 && e.demande.titre === M + " ouverte" &&
       e.demande.conditions === "Deuxième étage sans ascenseur." && e.demande.horaire === "Samedi 9h" &&
       e.employeur.nom === "Test emp" && e.employeur.verifie === true && e.employeur.note === null &&
       e.phrase === "C'est l'équipe PamConnect qui vous appellera pour convenir du prix.",
       ecran.brut.slice(0, 300));
  const pageReponse = await (await lire("/candidatures/nouvelle/" + ouverte, elle.cookie)).text();
  dire("la page du site dit la meme chose",
       pageReponse.includes("vous appellera pour convenir du prix") && pageReponse.includes("Test emp") &&
       (e.limite === null || pageReponse.includes(e.limite.parJour + " réponses par tranche")));

  console.log(SAUT + "--- LA REPONSE PART DEPUIS L'APPLICATION ---");
  const avant = soldeDe(elle.id);
  const envoi = await repondre(ouverte, parJeton);
  const candidature = base.prepare(
    "SELECT id, statut FROM candidatures WHERE annonce_id = ? AND prestataire_id = ?").get(ouverte, elle.id);
  const preleve = avant - soldeDe(elle.id);
  dire("la reponse est enregistree, et la phrase du serveur revient",
       envoi.code === 201 && Boolean(candidature) && candidature.statut === "en attente" &&
       envoi.donnees.candidatureId === candidature.id &&
       envoi.donnees.texte.startsWith("Votre réponse a bien été enregistrée."), envoi.brut);
  dire("repondre ne coute aucun jeton", preleve === 0, "preleve : " + preleve);
  const doublon = await repondre(ouverte, parJeton);
  dire("une seconde reponse : 409, sans second jeton",
       doublon.code === 409 && avant - soldeDe(elle.id) === preleve, doublon.brut);
  dire("l'employeur voit sa reponse", (await (await lire("/mes-demandes", emp.cookie)).text()).includes("Test elle"));

  console.log(SAUT + "--- LA LISTE DES DEMANDES ---");
  const liste = await json("/api/demandes", undefined, parJeton);
  const toutes = [...((liste.donnees && liste.donnees.pourMoi) || []), ...((liste.donnees && liste.donnees.autres) || [])];
  const carte = toutes.find((a) => a.id === seconde);
  dire("la demande porte son metier et ce qu'il faut savoir avant de venir, comme la carte du site",
       liste.donnees.monMetier === metierElle && Boolean(carte) && carte.metier === metierElle &&
       carte.conditions === "Deuxième étage sans ascenseur." &&
       liste.donnees.pourMoi.some((a) => a.id === seconde), liste.brut.slice(0, 300));

  console.log(SAUT + "--- SANS JETON ---");
  // Les jetons offerts arrivent a la premiere visite : on les retire ensuite.
  await json("/api/mes-jetons", undefined, cookieDe(fauchee.cookie));
  const parts = base.prepare(`
    SELECT COALESCE(SUM(CASE WHEN nature = 'offert' THEN quantite ELSE 0 END), 0) AS offerts,
           COALESCE(SUM(CASE WHEN nature = 'achete' THEN quantite ELSE 0 END), 0) AS achetes
    FROM jetons_mouvements WHERE utilisateur_id = ?`).get(fauchee.id);
  const retirer = base.prepare(`
    INSERT INTO jetons_mouvements (utilisateur_id, quantite, nature, motif, detail)
    VALUES (?, ?, ?, 'candidature', 'Retire pour le test')`);
  if (parts.offerts > 0) retirer.run(fauchee.id, -parts.offerts, "offert");
  if (parts.achetes > 0) retirer.run(fauchee.id, -parts.achetes, "achete");
  const ecranFauchee = await ecranApi(seconde, cookieDe(fauchee.cookie));
  if (ecranFauchee.donnees && ecranFauchee.donnees.cout) {
    const sansJeton = await repondre(seconde, cookieDe(fauchee.cookie));
    dire("l'ecran le dit avant, et l'envoi est refuse : 402, sans reponse enregistree",
         ecranFauchee.donnees.cout.soldeInsuffisant === true && sansJeton.code === 402 &&
         erreurDe(sansJeton).includes(ecranFauchee.donnees.cout.envoyer.replace("− ", "")) &&
         !base.prepare("SELECT 1 FROM candidatures WHERE annonce_id = ? AND prestataire_id = ?").get(seconde, fauchee.id),
         sansJeton.brut);
  } else {
    dire("aucun cout regle : l'ecran s'ouvre sans jeton", ecranFauchee.code === 200, ecranFauchee.brut);
  }

  console.log(SAUT + "--- LE SITE PASSE PAR LA MEME FONCTION ---");
  const siteRetiree = await poster("/candidatures", form({ annonceId: String(retiree) }), elle.cookie);
  const siteDoublon = await poster("/candidatures", form({ annonceId: String(ouverte) }), elle.cookie);
  dire("le site refuse la demande retiree et le doublon, avec les memes codes",
       siteRetiree.code === 410 && siteDoublon.code === 409 && siteDoublon.corps.includes("Candidature déjà envoyée"),
       "codes " + siteRetiree.code + " " + siteDoublon.code);

  console.log(SAUT + "--- MES REPONSES ---");
  const mesReponsesApi = (entetes) => json("/api/mes-reponses", undefined, entetes);
  dire("sans session : 401", (await mesReponsesApi()).code === 401);
  dire("un employeur : 403", (await mesReponsesApi(cookieDe(emp.cookie))).code === 403);
  const reponses = await mesReponsesApi(parJeton);
  const maReponse = reponses.donnees && reponses.donnees.reponses.find((r) => r.id === candidature.id);
  dire("sa reponse y figure, avec la phrase du site",
       reponses.code === 200 && Boolean(maReponse) && maReponse.titreDemande === M + " ouverte" &&
       maReponse.phrase === "Votre candidature est en attente", reponses.brut.slice(0, 300));
  const pageReponses = await (await lire("/mes-reponses", elle.cookie)).text();
  dire("la page du site dit la meme chose",
       pageReponses.includes(M + " ouverte") && pageReponses.includes(maReponse.phrase));

  console.log(SAUT + "--- J'AI EFFECTUE CE SERVICE ---");
  const jaiEffectue = (id, entetes) => json("/api/candidatures/" + id + "/jai-effectue", {}, entetes);
  const declareeLe = (id) => base.prepare("SELECT declaree_par_elle_le AS le FROM candidatures WHERE id = ?").get(id).le;
  dire("sans session : 401", (await jaiEffectue(candidature.id)).code === 401);
  dire("avant d'etre choisie : 409, rien d'enregistre",
       (await jaiEffectue(candidature.id, parJeton)).code === 409 && declareeLe(candidature.id) === null);
  // Le choix a sa propre serie : on le pose directement.
  base.prepare("UPDATE candidatures SET statut = 'acceptee' WHERE id = ?").run(candidature.id);
  dire("l'employeur n'a pas ce bouton : 403", (await jaiEffectue(candidature.id, cookieDe(emp.cookie))).code === 403);
  dire("une autre personne : 404", (await jaiEffectue(candidature.id, cookieDe(fauchee.cookie))).code === 404);
  const avantDeclaration = (await json("/api/discussions/" + candidature.id, undefined, parJeton)).donnees;
  dire("choisie, la discussion lui propose de le dire",
       Boolean(avantDeclaration.maDeclaration) && avantDeclaration.maDeclaration.dejaFaite === false &&
       avantDeclaration.maDeclaration.employeur === "Test emp" && avantDeclaration.peutDeclarerService === false,
       JSON.stringify(avantDeclaration.maDeclaration));
  const pageAvantDeclaration = await (await lire("/messages/" + candidature.id, elle.cookie)).text();
  dire("la page du site pose la question avant de declarer",
       pageAvantDeclaration.includes('data-question="Confirmez-vous avoir effectué ce service ?"'));
  const declaration = await jaiEffectue(candidature.id, parJeton);
  dire("sa declaration est enregistree avec sa date, et ne clot rien",
       declaration.code === 200 && declareeLe(candidature.id) !== null && declaration.donnees.texte.includes("Test emp") &&
       base.prepare("SELECT terminee_le FROM candidatures WHERE id = ?").get(candidature.id).terminee_le === null,
       declaration.brut);
  dire("une seconde fois : 409", (await jaiEffectue(candidature.id, parJeton)).code === 409);
  const apresDeclaration = (await json("/api/discussions/" + candidature.id, undefined, parJeton)).donnees;
  const vueDeLEmployeur = (await json("/api/discussions/" + candidature.id, undefined, cookieDe(emp.cookie))).donnees;
  dire("elle relit sa declaration, et l'employeur l'apprend",
       apresDeclaration.maDeclaration.dejaFaite === true && apresDeclaration.maDeclaration.le === declareeLe(candidature.id) &&
       vueDeLEmployeur.maDeclaration === null && Boolean(vueDeLEmployeur.declarationDeLaPersonne) &&
       vueDeLEmployeur.declarationDeLaPersonne.nom === "Test elle");
  const pageApresDeclaration = await (await lire("/messages/" + candidature.id, elle.cookie)).text();
  dire("la page du site dit la meme chose",
       pageApresDeclaration.includes("Vous avez déclaré avoir effectué ce service"));

  console.log(SAUT + "--- NETTOYAGE ---");
  const n = base.prepare("DELETE FROM utilisateurs WHERE email LIKE ?").run("%" + M + "%").changes;
  console.log("  " + n + " comptes de test supprimes");

  console.log(SAUT + "RESULTAT : " + ok + " reussis, " + ko + " echec(s)");
  process.exit(ko === 0 ? 0 : 1);
}, 600);
