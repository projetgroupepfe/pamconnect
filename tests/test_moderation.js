// Série : la modération des messages signalés.
const PROJET = require("path").join(__dirname, "..");
process.chdir(PROJET);
require(PROJET + "/_serveur_test_temporaire.js");

const base = require(PROJET + "/node_modules/better-sqlite3")(PROJET + "/data/pamconnect.db");
base.pragma("foreign_keys = ON");

const RACINE = "http://127.0.0.1:3999";
const M = "test-moderation";
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
    { role, nom: "Test " + suffixe, email: mail, motdepasse: "motdepasse123", quartier: "Bastos" },
    extra || {})));
  const c = await poster("/connexion", form({ email: mail, motdepasse: "motdepasse123" }));
  return { mail, cookie: c.cookie };
}

setTimeout(async () => {
  const emp = await creerCompte("emp", "employeur");
  const pre = await creerCompte("pre", "prestataire", { metier: "menagere", tarif: "15000" });
  const eq = await creerCompte("eq", "employeur");
  base.prepare("UPDATE utilisateurs SET est_admin = 1 WHERE email = ?").run(eq.mail);

  // Publier exige une identite verifiee. Ce n'est pas le sujet de
  // cette serie : on la donne aux employeurs qu'elle cree.
  base.prepare("UPDATE utilisateurs SET statut_verification = 'verifie' "
    + "WHERE email LIKE ? AND role = 'employeur'").run("%" + M + "%");

  await poster("/annonces", form({ titre: M + " demande", metier: "menagere",
    quartier: "Mvan", horaire: "Lundi 8h", prix: "10000" }), emp.cookie);
  const annonce = base.prepare("SELECT id FROM annonces WHERE titre LIKE ? ORDER BY id DESC LIMIT 1").get("%" + M + "%");
  await poster("/candidatures", form({ annonceId: String(annonce.id) }), pre.cookie);
  const conv = base.prepare("SELECT id FROM candidatures WHERE annonce_id = ?").get(annonce.id);

  // Un marqueur unique : la base contient de vrais signalements, et un
  // test doit verifier SES lignes, pas l'etat general de la base.
  const MARQUE = M + "-piece-a-conviction";
  await poster("/messages/" + conv.id,
    form({ texte: MARQUE + " envoie moi l'argent par MoMo au 677451289" }), pre.cookie);
  const msg = base.prepare("SELECT id FROM messages WHERE candidature_id = ? ORDER BY id DESC LIMIT 1").get(conv.id);

  console.log("\n--- QUI PEUT OUVRIR LA PAGE ---");
  dire("l'equipe y accede", (await lire("/admin/signalements", eq.cookie)).status === 200);
  dire("un employeur est refuse", (await lire("/admin/signalements", emp.cookie)).status === 403);
  dire("une personne qui travaille aussi", (await lire("/admin/signalements", pre.cookie)).status === 403);
  dire("un visiteur est renvoye", (await lire("/admin/signalements")).status === 302);

  console.log("\n--- UN MESSAGE NON SIGNALE N'Y FIGURE PAS ---");
  let page = await (await lire("/admin/signalements", eq.cookie)).text();
  dire("un message non signale n'y figure pas", !page.includes(MARQUE));

  console.log("\n--- LE SIGNALEMENT REMONTE JUSQU'A L'EQUIPE ---");
  await poster("/messages/" + msg.id + "/signaler", form({ candidatureId: String(conv.id) }), emp.cookie);
  page = await (await lire("/admin/signalements", eq.cookie)).text();
  dire("le message signale apparait", page.includes(MARQUE));
  dire("avec le nom de son auteur", page.includes("Test pre"));
  dire("et la demande concernee", page.includes(M + " demande"));
  dire("l'alerte automatique est rappelee", page.includes("paiement en dehors du site"));

  const enAttente = base.prepare(
    "SELECT COUNT(*) n FROM messages WHERE signale = 1 AND signalement_decision IS NULL").get().n;
  const accueilEquipe = await (await lire("/admin", eq.cookie)).text();
  dire("l'espace equipe annonce le nombre en attente",
       accueilEquipe.includes("Messages signalés (" + enAttente + ")"),
       enAttente + " attendus");

  console.log("\n--- UNE SUSPENSION DOIT ETRE MOTIVEE ---");
  const sansMotif = await poster("/admin/signalements/" + msg.id,
    form({ decision: "sanction", motif: "  " }), eq.cookie);
  dire("suspendre sans motif est refuse", sansMotif.code === 400, "code " + sansMotif.code);
  dire("le compte n'a pas ete suspendu",
       base.prepare("SELECT suspendu FROM utilisateurs WHERE email = ?").get(pre.mail).suspendu === 0);
  dire("le signalement reste ouvert",
       base.prepare("SELECT signalement_decision FROM messages WHERE id = ?").get(msg.id).signalement_decision === null);

  console.log("\n--- LA SUSPENSION ---");
  await poster("/admin/signalements/" + msg.id,
    form({ decision: "sanction", motif: "tentative de paiement hors plateforme" }), eq.cookie);
  const auteur = base.prepare("SELECT * FROM utilisateurs WHERE email = ?").get(pre.mail);
  dire("le compte est suspendu", auteur.suspendu === 1);
  dire("le motif est enregistre", auteur.suspendu_motif === "tentative de paiement hors plateforme");
  dire("la date aussi", Boolean(auteur.suspendu_le));

  const traite = base.prepare("SELECT * FROM messages WHERE id = ?").get(msg.id);
  dire("la decision est enregistree", traite.signalement_decision === "sanction");
  dire("on sait QUI a decide", Boolean(traite.signalement_traite_par));
  dire("et quand", Boolean(traite.signalement_traite_le));

  page = await (await lire("/admin/signalements", eq.cookie)).text();
  dire("le signalement traite disparait de la liste", !page.includes(MARQUE));

  console.log("\n--- UN COMPTE SUSPENDU NE SE CONNECTE PLUS ---");
  const tentative = await poster("/connexion", form({ email: pre.mail, motdepasse: "motdepasse123" }));
  dire("la connexion est refusee", tentative.code === 403, "code " + tentative.code);
  dire("la personne sait pourquoi", tentative.corps.includes("tentative de paiement hors plateforme"));
  dire("on ne lui dit pas 'mot de passe incorrect'",
       !tentative.corps.includes("Email ou mot de passe incorrect"));

  console.log("\n--- SES DONNEES NE SONT PAS EFFACEES ---");
  // Supprimer le compte effacerait la preuve de ce qui a justifie la
  // sanction, et les candidatures dont un employeur depend.
  dire("le compte existe toujours", Boolean(auteur.id));
  dire("sa candidature aussi",
       Boolean(base.prepare("SELECT id FROM candidatures WHERE id = ?").get(conv.id)));
  dire("ses messages aussi",
       base.prepare("SELECT COUNT(*) n FROM messages WHERE candidature_id = ?").get(conv.id).n > 0);

  console.log("\n--- ON NE REJUGE PAS UNE DECISION PRISE ---");
  const rejuge = await poster("/admin/signalements/" + msg.id, form({ decision: "rien" }), eq.cookie);
  dire("un second examen est refuse", rejuge.code === 409, "code " + rejuge.code);
  dire("la premiere decision tient",
       base.prepare("SELECT signalement_decision FROM messages WHERE id = ?").get(msg.id).signalement_decision === "sanction");

  console.log("\n--- CLASSER SANS SUITE ---");
  await poster("/messages/" + conv.id, form({ texte: "Bonjour, quel est l'horaire exact ?", prix: "10000" }), emp.cookie);
  const msg2 = base.prepare("SELECT id FROM messages WHERE candidature_id = ? ORDER BY id DESC LIMIT 1").get(conv.id);
  await poster("/messages/" + msg2.id + "/signaler", form({ candidatureId: String(conv.id) }), pre.cookie);
  await poster("/admin/signalements/" + msg2.id, form({ decision: "rien" }), eq.cookie);
  const classe = base.prepare("SELECT * FROM messages WHERE id = ?").get(msg2.id);
  dire("le signalement est classe", classe.signalement_decision === "rien");
  dire("aucun compte n'a ete suspendu au passage",
       base.prepare("SELECT suspendu FROM utilisateurs WHERE email = ?").get(emp.mail).suspendu === 0);

  console.log("\n--- UN COMPTE D'EQUIPE NE PEUT PAS ETRE SUSPENDU ---");
  base.prepare("UPDATE messages SET signale = 1, signalement_decision = NULL WHERE id = ?").run(msg2.id);
  base.prepare("UPDATE messages SET auteur_id = (SELECT id FROM utilisateurs WHERE email = ?) WHERE id = ?").run(eq.mail, msg2.id);
  await poster("/admin/signalements/" + msg2.id,
    form({ decision: "sanction", motif: "essai" }), eq.cookie);
  dire("le compte d'equipe reste actif",
       base.prepare("SELECT suspendu FROM utilisateurs WHERE email = ?").get(eq.mail).suspendu === 0);

  console.log("\n--- AVERTIR : LA TROISIEME VOIE ---");
  // Entre classer sans suite et suspendre, il manquait la reponse
  // proportionnee. Un message qui enfreint une regle sans justifier une
  // exclusion n'avait aucune sortie juste.
  const pre2 = await creerCompte("pre2", "prestataire", { metier: "menagere", tarif: "15000" });
  const idPre2 = base.prepare("SELECT id FROM utilisateurs WHERE email = ?").get(pre2.mail).id;
  await poster("/candidatures", form({ annonceId: String(annonce.id) }), pre2.cookie);
  const conv2 = base.prepare(
    "SELECT id FROM candidatures WHERE annonce_id = ? AND prestataire_id = ?").get(annonce.id, idPre2);
  await poster("/messages/" + conv2.id, form({ texte: M + " je propose 12000" }), pre2.cookie);
  const msgA = base.prepare(
    "SELECT id FROM messages WHERE candidature_id = ? ORDER BY id DESC LIMIT 1").get(conv2.id);
  await poster("/messages/" + msgA.id + "/signaler", form({ candidatureId: String(conv2.id) }), emp.cookie);

  const luPre2 = () => base.prepare("SELECT * FROM utilisateurs WHERE id = ?").get(idPre2);

  const avertSansMotif = await poster("/admin/signalements/" + msgA.id,
    form({ decision: "avertissement", motif: "   " }), eq.cookie);
  dire("un avertissement sans motif est refuse", avertSansMotif.code === 400,
       "code " + avertSansMotif.code);
  dire("et rien n'a ete enregistre", luPre2().avertissements === 0);

  await poster("/admin/signalements/" + msgA.id,
    form({ decision: "avertissement", motif: "le prix ne se negocie pas" }), eq.cookie);

  const apres = luPre2();
  dire("l'avertissement est compte", apres.avertissements === 1, String(apres.avertissements));
  dire("le motif est conserve", apres.avertissement_motif === "le prix ne se negocie pas");
  dire("il n'est pas encore lu", apres.avertissement_lu === 0);
  dire("le compte n'est PAS suspendu", apres.suspendu === 0);
  // Une connexion reussie REND une page d'accueil, elle ne redirige pas.
  // Un compte suspendu, lui, recoit 403 "Compte suspendu".
  const reconnexion = await poster("/connexion",
    form({ email: pre2.mail, motdepasse: "motdepasse123" }));
  dire("la personne peut toujours se connecter",
       reconnexion.code === 200 && reconnexion.corps.includes("Bienvenue"),
       "code " + reconnexion.code);
  dire("le signalement est classe en avertissement",
       base.prepare("SELECT signalement_decision FROM messages WHERE id = ?")
         .get(msgA.id).signalement_decision === "avertissement");

  const profilAvant = await (await lire("/mon-profil", pre2.cookie)).text();
  dire("la personne lit l'avertissement sur son profil",
       profilAvant.includes("le prix ne se negocie pas"));
  dire("et on lui dit que son compte fonctionne",
       profilAvant.includes("Votre compte fonctionne normalement"));

  await poster("/avertissement/lu", form({}), pre2.cookie);
  dire("une fois reconnu, il disparait de l'ecran",
       !(await (await lire("/mon-profil", pre2.cookie)).text()).includes("le prix ne se negocie pas"));
  dire("mais il reste dans la base", luPre2().avertissements === 1);

  console.log("\n--- L'EQUIPE VOIT LE PASSE ---");
  await poster("/messages/" + conv2.id, form({ texte: M + " deuxieme ecart" }), pre2.cookie);
  const msgB = base.prepare(
    "SELECT id FROM messages WHERE candidature_id = ? ORDER BY id DESC LIMIT 1").get(conv2.id);
  await poster("/messages/" + msgB.id + "/signaler", form({ candidatureId: String(conv2.id) }), emp.cookie);
  const listeEq = await (await lire("/admin/signalements", eq.cookie)).text();
  dire("un signalement suivant rappelle l'avertissement deja donne",
       listeEq.includes("Déjà <strong>1</strong>"));

  console.log("\n--- NETTOYAGE ---");
  const n = base.prepare("DELETE FROM utilisateurs WHERE email LIKE ?").run("%" + M + "%").changes;
  console.log("  " + n + " comptes de test supprimes");

  console.log("\nRESULTAT : " + ok + " reussis, " + ko + " echec(s)");
  process.exit(ko === 0 ? 0 : 1);
}, 600);
