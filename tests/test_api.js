// Série : l'API de l'application mobile.
//
// Ce qui doit tenir :
//   - se connecter par l'API donne la MEME session que le site ;
//   - un mot de passe faux ne dit pas si l'email existe ;
//   - un compte suspendu l'apprend, au lieu de croire a une panne ;
//   - l'API ne renvoie JAMAIS l'empreinte du mot de passe ;
//   - une erreur d'API est du JSON, jamais une page HTML ;
//   - les demandes sont triees comme sur la page publique.
const PROJET = require("path").join(__dirname, "..");
process.chdir(PROJET);
require(PROJET + "/_serveur_test_temporaire.js");

const base = require(PROJET + "/node_modules/better-sqlite3")(PROJET + "/data/pamconnect.db");
base.pragma("foreign_keys = ON");

const RACINE = "http://127.0.0.1:3999";
const M = "test-api";
let ok = 0, ko = 0;
const SAUT = String.fromCharCode(10);

const dire = (nom, cond, detail) => {
  if (cond) { ok++; console.log("  OK    | " + nom); }
  else { ko++; console.log("  ECHEC | " + nom + (detail ? "   -> " + detail : "")); }
};

const form = (o) => new URLSearchParams(o);

// L'application parle JSON, pas formulaire : les essais doivent lui
// ressembler, sinon on ne teste pas ce que Flutter enverra.
async function api(chemin, corps, cookie) {
  const entetes = { "Content-Type": "application/json" };
  if (cookie) entetes.Cookie = cookie;
  const r = await fetch(RACINE + chemin, {
    method: corps ? "POST" : "GET",
    headers: entetes,
    body: corps ? JSON.stringify(corps) : undefined,
    redirect: "manual",
  });
  const brut = await r.text();
  let donnees = null;
  try { donnees = JSON.parse(brut); } catch (e) { donnees = null; }
  const sc = r.headers.getSetCookie();
  return {
    code: r.status,
    type: r.headers.get("content-type") || "",
    brut, donnees,
    cookie: sc.length ? sc[0].split(";")[0] : null,
  };
}

async function creerCompte(suffixe, role, extra) {
  const mail = (M + "-" + suffixe + "@example.com").toLowerCase();
  await fetch(RACINE + "/inscription", {
    method: "POST",
    body: form(Object.assign(
      { role, nom: "Test " + suffixe, email: mail, motdepasse: "motdepasse123", quartier: "Bastos" },
      extra || {})),
    redirect: "manual",
  });
  base.prepare("UPDATE utilisateurs SET statut_verification = 'verifie' WHERE email = ?").run(mail);
  const id = base.prepare("SELECT id FROM utilisateurs WHERE email = ?").get(mail).id;
  return { mail, id };
}

setTimeout(async () => {
  base.prepare("DELETE FROM utilisateurs WHERE email LIKE ?").run("%" + M + "%");

  const emp = await creerCompte("emp", "employeur");
  const pre = await creerCompte("pre", "prestataire", { metier: "menagere", tarif: "15000" });

  console.log(SAUT + "--- SE CONNECTER PAR L'API ---");
  const bon = await api("/api/connexion", { email: pre.mail, motdepasse: "motdepasse123" });
  dire("la connexion repond 200", bon.code === 200, "code " + bon.code);
  dire("et renvoie du JSON", bon.type.includes("application/json"), bon.type);
  dire("elle pose le cookie de session", Boolean(bon.cookie), String(bon.cookie));
  dire("le nom est renvoye", bon.donnees && bon.donnees.moi && bon.donnees.moi.nom === "Test pre");
  dire("le role aussi", bon.donnees.moi.role === "prestataire", String(bon.donnees.moi.role));
  // LE SOLDE EST DETAILLE, ET C EST VOULU : les jetons offerts
  // periment, les achetes jamais. Ne montrer que le total cacherait
  // a la personne ce qui va disparaitre.
  const j = bon.donnees.moi.jetons;
  dire("et le solde de jetons", j && typeof j.total === "number", JSON.stringify(j));
  dire("en separant les offerts des achetes",
       typeof j.offerts === "number" && typeof j.achetes === "number" &&
       j.total === j.offerts + j.achetes, JSON.stringify(j));

  // L'EMPREINTE DU MOT DE PASSE NE SORT JAMAIS. On choisit les champs un
  // par un plutot que de renvoyer la ligne entiere : un oubli ici
  // exposerait tous les comptes d'un coup.
  dire("l'empreinte du mot de passe ne sort pas",
       !bon.brut.includes("motdepasse") && !bon.brut.includes(":".repeat(1) + "$"));
  dire("aucun email n'est renvoye non plus", !bon.brut.includes("@example.com"));

  console.log(SAUT + "--- LA MEME SESSION QUE LE SITE ---");
  // Le cookie obtenu par l'API doit ouvrir les pages : inventer un
  // second mecanisme aurait fait deux portes a surveiller au lieu d'une.
  const page = await fetch(RACINE + "/mes-reponses", { headers: { Cookie: bon.cookie }, redirect: "manual" });
  dire("le cookie de l'API ouvre les pages du site", page.status === 200, "code " + page.status);
  const moi = await api("/api/moi", null, bon.cookie);
  dire("et /api/moi reconnait la personne", moi.code === 200 && moi.donnees.moi.id === pre.id);

  console.log(SAUT + "--- CE QUI DOIT ECHOUER, ECHOUE EN JSON ---");
  const sansRien = await api("/api/moi");
  dire("sans cookie, /api/moi repond 401", sansRien.code === 401, "code " + sansRien.code);
  dire("et c'est du JSON, pas une page", sansRien.type.includes("application/json"), sansRien.type);
  dire("le message est lisible", typeof sansRien.donnees.erreur === "string", String(sansRien.brut).slice(0, 40));

  const faux = await api("/api/connexion", { email: pre.mail, motdepasse: "pas le bon" });
  dire("un mot de passe faux repond 401", faux.code === 401, "code " + faux.code);
  // LE MESSAGE NE DIT PAS SI L'EMAIL EXISTE : le contraire permettrait de
  // decouvrir qui est inscrit en essayant des adresses une par une.
  const inconnu = await api("/api/connexion", { email: "personne" + M + "@example.com", motdepasse: "x" });
  dire("un email inconnu donne le MEME message",
       inconnu.donnees.erreur === faux.donnees.erreur, inconnu.donnees.erreur);

  console.log(SAUT + "--- UN COMPTE SUSPENDU L'APPREND ---");
  base.prepare("UPDATE utilisateurs SET suspendu = 1, suspendu_motif = ? WHERE id = ?")
    .run("Essai de la serie", emp.id);
  const suspendu = await api("/api/connexion", { email: emp.mail, motdepasse: "motdepasse123" });
  dire("il repond 403, pas 401", suspendu.code === 403, "code " + suspendu.code);
  dire("et le motif est dit", String(suspendu.donnees.erreur).includes("Essai de la serie"));
  base.prepare("UPDATE utilisateurs SET suspendu = 0, suspendu_motif = NULL WHERE id = ?").run(emp.id);

  console.log(SAUT + "--- LES DEMANDES, TRIEES COMME SUR LA PAGE ---");
  const cookieEmp = (await api("/api/connexion", { email: emp.mail, motdepasse: "motdepasse123" })).cookie;
  await fetch(RACINE + "/annonces", {
    method: "POST", headers: { Cookie: cookieEmp }, redirect: "manual",
    body: form({ titre: M + " menage", metier: "menagere", quartier: "Mvan",
                 horaire: "Lundi 8h", prix: "12000" }) });
  await fetch(RACINE + "/annonces", {
    method: "POST", headers: { Cookie: cookieEmp }, redirect: "manual",
    body: form({ titre: M + " jardin", metier: "jardinier", quartier: "Mvan",
                 horaire: "Mardi 8h", prix: "9000" }) });

  const vues = await api("/api/demandes", null, bon.cookie);
  dire("la liste repond 200", vues.code === 200, "code " + vues.code);
  const titres = (l) => l.map((a) => a.titre);
  dire("son metier passe devant", titres(vues.donnees.pourMoi).includes(M + " menage"));
  dire("les autres metiers restent visibles", titres(vues.donnees.autres).includes(M + " jardin"));
  dire("et ne sont pas melanges aux siens", !titres(vues.donnees.pourMoi).includes(M + " jardin"));

  // LE SERVEUR MET EN FORME, PAS L'APPLICATION. Sinon les francs CFA
  // s'ecriraient de deux facons selon l'ecran ou l'on regarde.
  const sienne = vues.donnees.pourMoi.find((a) => a.titre === M + " menage");
  dire("le prix arrive deja ecrit en toutes lettres",
       typeof sienne.prixLisible === "string" && sienne.prixLisible.includes("FCFA"),
       String(sienne.prixLisible));
  dire("le montant brut est la aussi, pour trier", sienne.prix === 12000, String(sienne.prix));

  // UN VISITEUR N'A PAS DE METIER : la liste ne doit pas planter, elle
  // doit tout mettre dans "autres".
  const visiteur = await api("/api/demandes");
  dire("un visiteur voit la liste", visiteur.code === 200, "code " + visiteur.code);
  dire("tout est dans 'autres' pour lui", visiteur.donnees.pourMoi.length === 0);
  dire("et les demandes y sont", titres(visiteur.donnees.autres).includes(M + " menage"));

  console.log(SAUT + "--- SE DECONNECTER ---");
  const sortie = await api("/api/deconnexion", {}, bon.cookie);
  dire("la deconnexion repond 200", sortie.code === 200, "code " + sortie.code);
  const apres = await api("/api/moi", null, bon.cookie);
  dire("la session ne vaut plus rien", apres.code === 401, "code " + apres.code);

  console.log(SAUT + "--- LES FORMULAIRES DU SITE MARCHENT TOUJOURS ---");
  // express.json n'est monte que sous /api : une inscription ordinaire
  // doit continuer d'arriver comme avant.
  const encore = await creerCompte("apres", "prestataire", { metier: "menagere", tarif: "15000" });
  dire("une inscription par formulaire passe encore",
       base.prepare("SELECT COUNT(*) n FROM utilisateurs WHERE id = ?").get(encore.id).n === 1);

  console.log(SAUT + "--- NETTOYAGE ---");
  const n = base.prepare("DELETE FROM utilisateurs WHERE email LIKE ?").run("%" + M + "%").changes;
  console.log("  " + n + " comptes de test supprimes");

  console.log(SAUT + "RESULTAT : " + ok + " reussis, " + ko + " echec(s)");
  process.exit(ko === 0 ? 0 : 1);
}, 600);
