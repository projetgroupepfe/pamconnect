// Série : archiver les services effectués.
//
// La plateforme ne savait pas qu'un service avait eu lieu. Une personne
// retrouvait au même endroit ce qui est en cours et ce qui appartient au
// passé. C'est l'employeur qui déclare le service effectué — c'est lui
// qui l'a reçu — et la discussion devient alors une archive : lisible
// des deux côtés, mais on n'y écrit plus.
const PROJET = require("path").join(__dirname, "..");
process.chdir(PROJET);
require(PROJET + "/_serveur_test_temporaire.js");

const base = require(PROJET + "/node_modules/better-sqlite3")(PROJET + "/data/pamconnect.db");
base.pragma("foreign_keys = ON");

const RACINE = "http://127.0.0.1:3999";
const M = "test-archive";
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

async function creerCompte(suffixe, role, extra) {
  const mail = M + "-" + suffixe + "@example.com";
  await poster("/inscription", form(Object.assign(
    { role, nom: "Test " + suffixe, email: mail, motdepasse: "motdepasse123", telephone: "600000000", quartier: "Bastos" },
    extra || {})));
  const c = await poster("/connexion", form({ email: mail, motdepasse: "motdepasse123", telephone: "600000000" }));
  base.prepare("UPDATE utilisateurs SET statut_verification = 'verifie' WHERE email = ?")
    .run(mail.toLowerCase());
  return { mail, cookie: c.cookie };
}

setTimeout(async () => {
  const emp = await creerCompte("emp", "employeur");
  const pre = await creerCompte("pre", "prestataire", { metier: "menagere", tarif: "15000" });
  const tiers = await creerCompte("tiers", "prestataire", { metier: "menagere", tarif: "12000" });

  await poster("/annonces", form({ titre: M + " demande", metier: "menagere",
    quartier: "Mvan", horaire: "Lundi 8h", prix: "10000" }), emp.cookie);
  const annonce = base.prepare("SELECT id FROM annonces WHERE titre LIKE ? ORDER BY id DESC LIMIT 1").get("%" + M + "%");
  await poster("/candidatures", form({ annonceId: String(annonce.id) }), pre.cookie);
  const conv = base.prepare("SELECT id FROM candidatures WHERE annonce_id = ?").get(annonce.id);
  await poster("/messages/" + conv.id, form({ texte: M + " bonjour" }), emp.cookie);

  const finDe = () => base.prepare("SELECT terminee_le FROM candidatures WHERE id = ?").get(conv.id).terminee_le;

  console.log("\n--- ON NE CLOT PAS UN SERVICE QUI N'A PAS COMMENCE ---");
  // Tant que la candidature est "en attente", personne n'a travaille.
  const tropTot = await poster("/candidatures/" + conv.id + "/terminer", form({}), emp.cookie);
  dire("clore avant d'accepter est refuse", tropTot.code === 409, "code " + tropTot.code);
  dire("aucune date n'est posee", finDe() === null);
  dire("le bouton n'apparait pas non plus",
       !(await (await lire("/messages/" + conv.id, emp.cookie)).text()).includes("Déclarer le service"));

  console.log("\n--- SEUL CELUI QUI A RECU LE SERVICE LE CLOT ---");
  await poster("/candidatures/statut",
    form({ candidatureId: String(conv.id), statut: "acceptee" }), emp.cookie);

  dire("l'employeur voit le bouton",
       (await (await lire("/messages/" + conv.id, emp.cookie)).text()).includes("Déclarer le service effectué"));
  dire("la personne qui a travaille ne le voit pas",
       !(await (await lire("/messages/" + conv.id, pre.cookie)).text()).includes("Déclarer le service effectué"));
  // La regle est sur le serveur : masquer un bouton n'est pas une regle.
  dire("et elle ne peut pas clore en envoyant la requete a la main",
       (await poster("/candidatures/" + conv.id + "/terminer", form({}), pre.cookie)).code === 403);
  dire("un tiers non plus",
       (await poster("/candidatures/" + conv.id + "/terminer", form({}), tiers.cookie)).code === 404);
  dire("rien n'a bouge", finDe() === null);

  console.log("\n--- LE SERVICE EST DECLARE EFFECTUE ---");
  const clore = await poster("/candidatures/" + conv.id + "/terminer", form({}), emp.cookie);
  dire("l'employeur clot le service", clore.code === 302, "code " + clore.code);
  dire("la date est enregistree", typeof finDe() === "string");
  // Deux envois successifs ne doivent pas changer la date : la condition
  // est dans la requete elle-meme.
  const dateAvant = finDe();
  await poster("/candidatures/" + conv.id + "/terminer", form({}), emp.cookie);
  dire("un second envoi ne change pas la date", finDe() === dateAvant);

  console.log("\n--- LA DISCUSSION DEVIENT UNE ARCHIVE ---");
  const vuePre = await (await lire("/messages/" + conv.id, pre.cookie)).text();
  const vueEmp = await (await lire("/messages/" + conv.id, emp.cookie)).text();
  dire("les deux cotes lisent qu'elle est terminee",
       vuePre.includes("Service terminé") && vueEmp.includes("Service terminé"));
  dire("le champ d'ecriture disparait des deux cotes",
       !vuePre.includes("Écrire à") && !vueEmp.includes("Écrire à"));
  dire("le bouton de cloture aussi", !vueEmp.includes("Déclarer le service effectué"));
  dire("on n'ecrit plus, meme en envoyant la requete a la main",
       (await poster("/messages/" + conv.id, form({ texte: "encore un mot" }), pre.cookie)).code === 409);
  dire("ni du cote de l'employeur",
       (await poster("/messages/" + conv.id, form({ texte: "encore un mot" }), emp.cookie)).code === 409);

  console.log("\n--- RIEN N'EST PERDU ---");
  dire("les messages sont conserves",
       base.prepare("SELECT COUNT(*) n FROM messages WHERE candidature_id = ?").get(conv.id).n === 1);
  dire("et restent lisibles", vuePre.includes(M + " bonjour"));

  console.log("\n--- LA LISTE SEPARE LE PASSE DU PRESENT ---");
  const liste = await (await lire("/messages", pre.cookie)).text();
  dire("une section 'Services termines' apparait", liste.includes("Services terminés"));
  // "Archivees" ne s affiche que lorsqu il n y a plus rien a y faire.
  // Tant qu un avis attend, le bloc le dit - c etait tout le probleme.
  dire("elle dit qu un avis est attendu", liste.includes("attend votre avis"));
  dire("et qu on n y ecrit plus", liste.includes("ne reçoivent plus de message"));
  dire("et donne la date du service", liste.includes("Service effectué le"));
  dire("plus aucune discussion en cours", liste.includes("Aucune discussion en cours"));

  console.log("\n--- ELLE AUSSI PEUT DIRE QU'ELLE L'A FAIT ---");
  // Seul l'employeur pouvait declarer. Elle attendait, sans aucun moyen
  // de dire "j'y suis allee" - et s'il se taisait, rien ne le signalait.
  const empJ = await creerCompte("empJ", "employeur");
  const preJ = await creerCompte("preJ", "prestataire", { metier: "menagere", tarif: "15000" });
  const eqJ = await creerCompte("eqJ", "employeur");
  base.prepare("UPDATE utilisateurs SET est_admin = 1 WHERE email = ?").run(eqJ.mail.toLowerCase());
  base.prepare("UPDATE utilisateurs SET statut_verification = 'verifie' WHERE email = ?")
    .run(preJ.mail.toLowerCase());

  await poster("/annonces", form({ titre: M + " declaree", metier: "menagere",
    quartier: "Mvan", horaire: "Lundi 8h", prix: "12000" }), empJ.cookie);
  const aJ = base.prepare("SELECT id FROM annonces WHERE titre = ? ORDER BY id DESC LIMIT 1").get(M + " declaree");
  await poster("/candidatures", form({ annonceId: String(aJ.id) }), preJ.cookie);
  const cJ = base.prepare("SELECT id FROM candidatures WHERE annonce_id = ?").get(aJ.id);

  const avant = await poster("/candidatures/" + cJ.id + "/jai-effectue", form({}), preJ.cookie);
  dire("avant d'etre choisie, elle ne peut rien declarer", avant.code === 409, "code " + avant.code);

  await poster("/candidatures/statut",
    form({ candidatureId: String(cJ.id), statut: "acceptee" }), empJ.cookie);

  // Chacun son bouton : celui de l'employeur paie, le sien ne paie pas.
  const vole = await poster("/candidatures/" + cJ.id + "/jai-effectue", form({}), empJ.cookie);
  dire("l'employeur ne peut pas prendre son bouton", vole.code === 403, "code " + vole.code);

  const sien = await poster("/candidatures/" + cJ.id + "/jai-effectue", form({}), preJ.cookie);
  dire("elle declare avoir effectue le service", sien.code === 302, "code " + sien.code);

  const apresJ = base.prepare(
    "SELECT declaree_par_elle_le, terminee_le FROM candidatures WHERE id = ?").get(cJ.id);
  dire("la date est enregistree", typeof apresJ.declaree_par_elle_le === "string");

  // LE POINT CENTRAL : sa declaration ne libere aucun argent. L'employeur
  // paie apres le service, et c'est l'equipe qui enregistre ce paiement.
  dire("aucune somme n'est engagee",
       !base.prepare("SELECT etat FROM versements WHERE annonce_id = ?").get(aJ.id));
  dire("et le service n'est pas clos", apresJ.terminee_le === null);
  dire("la discussion reste ouverte a l'ecriture",
       (await poster("/messages/" + cJ.id, form({ texte: M + " a bientot" }), preJ.cookie)).code === 302);

  const dateJ = apresJ.declaree_par_elle_le;
  await poster("/candidatures/" + cJ.id + "/jai-effectue", form({}), preJ.cookie);
  dire("un second envoi ne change pas la date",
       base.prepare("SELECT declaree_par_elle_le FROM candidatures WHERE id = ?")
         .get(cJ.id).declaree_par_elle_le === dateJ);

  console.log("\n--- CE QUE SA DECLARATION CHANGE POUR LES AUTRES ---");
  dire("l'employeur est relance dans la discussion",
       (await (await lire("/messages/" + cJ.id, empJ.cookie)).text())
         .includes("indique avoir effectué le service"));
  dire("elle voit sa propre declaration",
       (await (await lire("/messages/" + cJ.id, preJ.cookie)).text())
         .includes("Vous avez déclaré avoir effectué"));
  dire("et le bouton ne lui est plus propose",
       !(await (await lire("/messages/" + cJ.id, preJ.cookie)).text())
         .includes("Avez-vous effectué ce service"));
  console.log("\n--- QUAND L'EMPLOYEUR CONFIRME ENFIN ---");
  await poster("/candidatures/" + cJ.id + "/terminer", form({}), empJ.cookie);
  dire("la discussion est archivee",
       typeof base.prepare("SELECT terminee_le FROM candidatures WHERE id = ?").get(cJ.id).terminee_le === "string");

  console.log("\n--- NETTOYAGE ---");
  const n = base.prepare("DELETE FROM utilisateurs WHERE email LIKE ?").run("%" + M + "%").changes;
  console.log("  " + n + " comptes de test supprimes");

  console.log("\nRESULTAT : " + ok + " reussis, " + ko + " echec(s)");
  process.exit(ko === 0 ? 0 : 1);
}, 600);
