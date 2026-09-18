// Série : un mot de passe oublié, rattrapé par un appel de l'équipe.
//
// Aucun email n'est envoyé : le numéro de téléphone est déjà au dossier.
// L'équipe appelle, lit un code à six chiffres, et la personne choisit
// elle-même son nouveau mot de passe.
//
// Ce que cette série surveille le plus : l'équipe n'apprend jamais le
// mot de passe de personne, le code ne se relit pas dans la base, et une
// porte ouverte laisse une trace que la personne peut voir.
const PROJET = require("path").join(__dirname, "..");
process.chdir(PROJET);
require(PROJET + "/_serveur_test_temporaire.js");

const base = require(PROJET + "/node_modules/better-sqlite3")(PROJET + "/data/pamconnect.db");
base.pragma("foreign_keys = ON");

const RACINE = "http://127.0.0.1:3999";
const M = "test-oubli";
const MDP = "motdepasse123";
const TITRE7 = "\n--- 7. LE MEME RATTRAPAGE DEPUIS L'APPLICATION ---";
let ok = 0, ko = 0;

const dire = (nom, cond, detail) => {
  if (cond) { ok++; console.log("  OK    | " + nom); }
  else { ko++; console.log("  ECHEC | " + nom + (detail ? "   -> " + detail : "")); }
};

const form = (o) => new URLSearchParams(o);
const lire = (chemin, cookie) =>
  fetch(RACINE + chemin, { headers: cookie ? { Cookie: cookie } : {}, redirect: "manual" });

async function poster(chemin, corps, cookie) {
  const e = {};
  if (cookie) e.Cookie = cookie;
  const r = await fetch(RACINE + chemin, { method: "POST", body: corps, headers: e, redirect: "manual" });
  const sc = r.headers.getSetCookie();
  return { code: r.status, corps: await r.text(), cookie: sc.length ? sc[0].split(";")[0] : null };
}

async function creerCompte(suffixe, role, extra) {
  const mail = (M + "-" + suffixe + "@example.com").toLowerCase();
  await poster("/inscription", form(Object.assign(
    { role, nom: "Test " + suffixe, email: mail, motdepasse: MDP,
      telephone: "677100001", quartier: "Bastos" },
    extra || {})));
  const c = await poster("/connexion", form({ email: mail, motdepasse: MDP }));
  const ligne = base.prepare("SELECT id FROM utilisateurs WHERE email = ?").get(mail);
  return { mail, cookie: c.cookie, id: ligne.id };
}

setTimeout(async () => {
  const perso = await creerCompte("perso", "employeur", { telephone: "677100001" });
  const eq = await creerCompte("eq", "employeur", { telephone: "677100002" });
  base.prepare("UPDATE utilisateurs SET est_admin = 1 WHERE email = ?").run(eq.mail);

  console.log("\n--- 1. LA PERSONNE DEMANDE DE L'AIDE ---");
  const page = await (await lire("/mot-de-passe-oublie")).text();
  dire("la page dit que l'équipe appelle", page.includes("appelle le"));
  dire("et qu'elle ne connaîtra pas le mot de passe",
       page.includes("ne connaît jamais votre mot de passe"));

  const inconnue = await poster("/mot-de-passe-oublie", form({ email: "personne@example.com" }));
  const connue = await poster("/mot-de-passe-oublie", form({ email: perso.mail }));
  // LA MEME REPONSE DANS LES DEUX CAS : sinon n'importe qui apprendrait
  // quelles adresses ont un compte sur la plateforme.
  dire("une adresse inconnue reçoit la même réponse",
       inconnue.code === connue.code && inconnue.corps === connue.corps);

  const enAttente = base.prepare("SELECT code_demande_le FROM utilisateurs WHERE id = ?").get(perso.id);
  dire("la demande est notée pour l'équipe", Boolean(enAttente.code_demande_le));

  const annuaire = await (await lire("/admin/utilisateurs", eq.cookie)).text();
  dire("l'équipe voit qui attend un appel", annuaire.includes("Attend un code de connexion"));
  dire("et le bouton pour donner un code", annuaire.includes("Donner un code"));

  console.log("\n--- 2. L'EQUIPE APPELLE ET LIT UN CODE ---");
  const parLaPersonne = await poster("/admin/utilisateurs/" + perso.id + "/code", form({}), perso.cookie);
  dire("personne d'autre que l'équipe ne délivre un code",
       parLaPersonne.code === 403, "code " + parLaPersonne.code);

  const donne = await poster("/admin/utilisateurs/" + perso.id + "/code", form({}), eq.cookie);
  dire("l'équipe délivre le code", donne.code === 200, "code " + donne.code);
  dire("le numéro à appeler est sous ses yeux", donne.corps.includes("677 10 00 01"));

  const trouve = donne.corps.match(/<strong>(\d{6})<\/strong>/);
  dire("un code à six chiffres est affiché", Boolean(trouve), donne.corps.slice(0, 120));
  const code = trouve ? trouve[1] : "000000";

  const ligne = base.prepare("SELECT * FROM utilisateurs WHERE id = ?").get(perso.id);
  // LE CODE EST HACHE : un code lisible dans la base ouvrirait tous les
  // comptes qui en attendent un.
  dire("le code n'est pas lisible dans la base",
       ligne.code_connexion && !ligne.code_connexion.includes(code),
       String(ligne.code_connexion).slice(0, 20));
  dire("qui l'a délivré est gardé", ligne.code_donne_par === eq.id);
  dire("et la demande est retirée de la liste", ligne.code_demande_le === null);

  console.log("\n--- 3. LA PERSONNE CHOISIT SON MOT DE PASSE ---");
  const mauvais = await poster("/nouveau-mot-de-passe",
    form({ email: perso.mail, code: "000001", motdepasse: "nouveaumotdepasse" }));
  dire("un code faux est refusé", mauvais.code === 401, "code " + mauvais.code);

  const trop = await poster("/nouveau-mot-de-passe",
    form({ email: perso.mail, code, motdepasse: "abc" }));
  dire("un mot de passe trop court est refusé", trop.code === 400, "code " + trop.code);

  const change = await poster("/nouveau-mot-de-passe",
    form({ email: perso.mail, code, motdepasse: "nouveaumotdepasse" }));
  dire("le mot de passe est changé", change.code === 200, "code " + change.code);

  const ancien = await poster("/connexion", form({ email: perso.mail, motdepasse: MDP }));
  dire("l'ancien mot de passe ne marche plus", !ancien.cookie);

  const nouveau = await poster("/connexion", form({ email: perso.mail, motdepasse: "nouveaumotdepasse" }));
  dire("le nouveau marche", Boolean(nouveau.cookie));

  console.log("\n--- 4. LE CODE NE SERT QU'UNE FOIS ---");
  const rejoue = await poster("/nouveau-mot-de-passe",
    form({ email: perso.mail, code, motdepasse: "encoreunautre" }));
  dire("le même code ne resservira pas", rejoue.code === 401, "code " + rejoue.code);

  const apres = base.prepare("SELECT * FROM utilisateurs WHERE id = ?").get(perso.id);
  dire("le code est effacé", apres.code_connexion === null);
  dire("la date du changement est gardée", Boolean(apres.motdepasse_change_le));

  const profil = await (await lire("/mon-profil", nouveau.cookie)).text();
  // UN ABUS SE VOIT : la personne lit sur son profil qu'un mot de passe a
  // ete change, meme si ce n'est pas elle qui l'a demande.
  dire("la personne voit la trace sur son profil", profil.includes("Mot de passe changé le"));

  console.log("\n--- 5. CINQ ESSAIS, PAS PLUS ---");
  await poster("/mot-de-passe-oublie", form({ email: perso.mail }));
  const second = await poster("/admin/utilisateurs/" + perso.id + "/code", form({}), eq.cookie);
  const codeDeux = second.corps.match(/<strong>(\d{6})<\/strong>/)[1];

  for (let essai = 0; essai < 5; essai++) {
    await poster("/nouveau-mot-de-passe",
      form({ email: perso.mail, code: "111111", motdepasse: "unautremotdepasse" }));
  }

  const apresCinq = await poster("/nouveau-mot-de-passe",
    form({ email: perso.mail, code: codeDeux, motdepasse: "unautremotdepasse" }));
  dire("après cinq essais, même le bon code est refusé",
       apresCinq.code === 401, "code " + apresCinq.code);
  dire("et le code est effacé",
       base.prepare("SELECT code_connexion FROM utilisateurs WHERE id = ?").get(perso.id)
         .code_connexion === null);

  console.log("\n--- 6. LES COMPTES QUI N'ONT RIEN A ROUVRIR ---");
  await poster("/admin/utilisateurs",
    form({ nom: M + " Ajoutee", telephone: "677100003", role: "prestataire",
           metier: "jardinier", quartier: "Bastos" }), eq.cookie);
  const ajoutee = base.prepare("SELECT id FROM utilisateurs WHERE nom = ?").get(M + " Ajoutee");
  const sansCompte = await poster("/admin/utilisateurs/" + ajoutee.id + "/code", form({}), eq.cookie);
  dire("une personne ajoutée par l'équipe n'a pas d'accès à rouvrir",
       sansCompte.code === 409, "code " + sansCompte.code);

  base.prepare("UPDATE utilisateurs SET suspendu = 1 WHERE id = ?").run(perso.id);
  const suspendu = await poster("/admin/utilisateurs/" + perso.id + "/code", form({}), eq.cookie);
  dire("un compte suspendu ne se rouvre pas non plus",
       suspendu.code === 409, "code " + suspendu.code);

  console.log(TITRE7);
  base.prepare("UPDATE utilisateurs SET suspendu = 0 WHERE id = ?").run(perso.id);

  const appli = (chemin, corps) => fetch(RACINE + chemin, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corps),
  }).then(async (r) => ({ code: r.status, donnees: await r.json().catch(() => ({})) }));

  const demandeAppli = await appli("/api/mot-de-passe-oublie", { email: perso.mail });
  dire("l'application demande un appel", demandeAppli.code === 200, "code " + demandeAppli.code);
  dire("et lit la phrase du serveur",
       String(demandeAppli.donnees.texte || "").includes("appellera le"),
       JSON.stringify(demandeAppli.donnees).slice(0, 120));

  const troisieme = await poster("/admin/utilisateurs/" + perso.id + "/code", form({}), eq.cookie);
  const codeTrois = troisieme.corps.match(/<strong>(\d{6})<\/strong>/)[1];

  const fauxAppli = await appli("/api/nouveau-mot-de-passe",
    { email: perso.mail, code: "222222", motdepasse: "encoreunmotdepasse" });
  dire("un code faux est refusé sur le téléphone aussi",
       fauxAppli.code === 401, "code " + fauxAppli.code);

  const changeAppli = await appli("/api/nouveau-mot-de-passe",
    { email: perso.mail, code: codeTrois, motdepasse: "encoreunmotdepasse" });
  dire("le mot de passe se change depuis l'application",
       changeAppli.code === 200, "code " + changeAppli.code);

  const connexionAppli = await appli("/api/connexion",
    { email: perso.mail, motdepasse: "encoreunmotdepasse" });
  dire("et la personne se connecte avec",
       connexionAppli.code === 200 && Boolean(connexionAppli.donnees.jeton));

  const supprimes = base.prepare("DELETE FROM utilisateurs WHERE email LIKE ? OR nom LIKE ?")
    .run("%" + M + "%", M + "%").changes;
  console.log("  ----- | nettoyage : " + supprimes + " comptes de test supprimés");

  console.log("\nRESULTAT : " + ok + " reussis, " + ko + " echec(s)");
  process.exit(ko === 0 ? 0 : 1);
}, 500);
