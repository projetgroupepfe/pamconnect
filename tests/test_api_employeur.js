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

  console.log(SAUT + "--- NETTOYAGE ---");
  const n = base.prepare("DELETE FROM utilisateurs WHERE email LIKE ?").run("%" + M + "%").changes;
  console.log("  " + n + " comptes de test supprimes");

  console.log(SAUT + "RESULTAT : " + ok + " reussis, " + ko + " echec(s)");
  process.exit(ko === 0 ? 0 : 1);
}, 600);
