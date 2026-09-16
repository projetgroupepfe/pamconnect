// Série : la photo d'une personne.
//
// Elle n'est JAMAIS publique. Elle s'ouvre pour :
//   - la personne elle-même ;
//   - l'équipe ;
//   - l'autre personne d'un service convenu, une fois le choix fait, et
//     seulement dans la discussion.
// Ni la recherche, ni la fiche, ni les listes ne la montrent. Tout autre
// demandeur reçoit 404, sans savoir si la photo existe.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const PROJET = path.join(__dirname, "..");
process.chdir(PROJET);
require(PROJET + "/_serveur_test_temporaire.js");

const base = require(PROJET + "/node_modules/better-sqlite3")(PROJET + "/data/pamconnect.db");
base.pragma("foreign_keys = ON");

const RACINE = "http://127.0.0.1:3999";
const DOCS = path.join(PROJET, "data", "documents");
const M = "test-photos";
let ok = 0, ko = 0;

const SAUT = String.fromCharCode(10);

const dire = (nom, cond, detail) => {
  if (cond) { ok++; console.log("  OK    | " + nom); }
  else { ko++; console.log("  ECHEC | " + nom + (detail ? "   -> " + detail : "")); }
};

const form = (o) => new URLSearchParams(o);

async function lire(chemin, entetes) {
  const r = await fetch(RACINE + chemin, { headers: entetes || {}, redirect: "manual" });
  const octets = Buffer.from(await r.arrayBuffer());
  return { code: r.status, entetes: r.headers, octets, texte: octets.toString("utf-8") };
}
const cookieDe = (c) => ({ Cookie: c });

async function poster(chemin, corps, cookie) {
  const r = await fetch(RACINE + chemin, { method: "POST", body: corps, headers: cookie ? { Cookie: cookie } : {}, redirect: "manual" });
  const sc = r.headers.getSetCookie();
  return { code: r.status, texte: await r.text(), cookie: sc.length ? sc[0].split(";")[0] : null };
}

async function creerCompte(suffixe, role, extra) {
  const mail = (M + "-" + suffixe + "@example.com").toLowerCase();
  await poster("/inscription", form(Object.assign(
    { role, nom: "Test " + suffixe, email: mail, motdepasse: "motdepasse123", quartier: "Bastos" },
    extra || {})));
  const c = await poster("/connexion", form({ email: mail, motdepasse: "motdepasse123" }));
  base.prepare("UPDATE utilisateurs SET statut_verification = 'verifie' WHERE email = ?").run(mail);
  return {
    mail, cookie: c.cookie, nom: "Test " + suffixe,
    id: base.prepare("SELECT id FROM utilisateurs WHERE email = ?").get(mail).id,
  };
}

// Une photo deja acceptee, posee directement : la serie parle de qui la
// voit, pas de son envoi (voir test_verification et test_admin).
function poserPhoto(personne) {
  const nom = crypto.randomBytes(16).toString("hex") + ".jpg";
  const contenu = Buffer.alloc(1200);
  contenu.set([0xff, 0xd8, 0xff, 0xe0]);
  fs.writeFileSync(path.join(DOCS, nom), contenu);
  base.prepare("UPDATE utilisateurs SET photo_fichier = ? WHERE id = ?").run(nom, personne.id);
  return nom;
}

const crediter = (id, n) => base.prepare(`
  INSERT INTO jetons_mouvements (utilisateur_id, quantite, nature, motif, detail)
  VALUES (?, ?, 'achete', 'achat', 'Credit de test')
`).run(id, n);

setTimeout(async () => {
  const eq = await creerCompte("eq", "employeur");
  base.prepare("UPDATE utilisateurs SET est_admin = 1 WHERE id = ?").run(eq.id);
  const emp = await creerCompte("emp", "employeur");
  const elle = await creerCompte("elle", "prestataire", { metier: "menagere", tarif: "15000" });
  const autre = await creerCompte("autre", "prestataire", { metier: "menagere", tarif: "15000" });
  const inconnue = await creerCompte("inconnue", "prestataire", { metier: "menagere", tarif: "15000" });

  const photoElle = poserPhoto(elle);
  const photoEmp = poserPhoto(emp);
  poserPhoto(autre);

  await poster("/annonces", form({ titre: M + " demande", metier: "menagere", quartier: "Mvan",
    horaire: "Lundi 8h", prix: "10000" }), emp.cookie);
  const demande = base.prepare("SELECT id FROM annonces WHERE titre = ?").get(M + " demande");
  crediter(elle.id, 5);
  crediter(autre.id, 5);
  await poster("/candidatures", form({ annonceId: String(demande.id) }), elle.cookie);
  await poster("/candidatures", form({ annonceId: String(demande.id) }), autre.cookie);
  const candidature = (personne) => base.prepare(
    "SELECT id FROM candidatures WHERE annonce_id = ? AND prestataire_id = ?").get(demande.id, personne.id).id;
  const candElle = candidature(elle), candAutre = candidature(autre);

  const photo = (personne, entetes) => lire("/photos/" + personne.id, entetes);
  const discussionApi = async (id, cookie) => JSON.parse((await lire("/api/discussions/" + id, cookieDe(cookie))).texte);

  console.log(SAUT + "--- AVANT LE CHOIX, PERSONNE NE VOIT LE VISAGE DE PERSONNE ---");
  const pageAvant = await lire("/messages/" + candElle, cookieDe(emp.cookie));
  dire("la discussion ne montre pas la photo", pageAvant.code === 200 && !pageAvant.texte.includes("/photos/"));
  dire("l'application non plus", (await discussionApi(candElle, emp.cookie)).photoAutre === null);
  dire("l'employeur ne l'ouvre pas par son adresse", (await photo(elle, cookieDe(emp.cookie))).code === 404);

  console.log(SAUT + "--- ELLE-MEME ET L'EQUIPE ---");
  const parElle = await photo(elle, cookieDe(elle.cookie));
  dire("la personne voit sa propre photo", parElle.code === 200 && parElle.octets.length === 1200, "code " + parElle.code);
  dire("le navigateur ne devine pas le type du fichier",
       parElle.entetes.get("x-content-type-options") === "nosniff");
  dire("et ne la garde que pour ce compte", String(parElle.entetes.get("cache-control")).includes("private"));
  dire("l'equipe la voit", (await photo(elle, cookieDe(eq.cookie))).code === 200);
  dire("un visiteur non", (await photo(elle)).code === 404);
  dire("une personne sans lien non plus", (await photo(elle, cookieDe(inconnue.cookie))).code === 404);
  dire("une adresse inventee : 404", (await lire("/photos/abc", cookieDe(eq.cookie))).code === 404);

  console.log(SAUT + "--- APRES LE CHOIX, DANS LA DISCUSSION ---");
  const choix = await poster("/candidatures/statut", form({ candidatureId: String(candElle), statut: "acceptee" }), emp.cookie);
  dire("l'employeur choisit", choix.code === 302 || choix.code === 200, "code " + choix.code);

  const pageEmp = await lire("/messages/" + candElle, cookieDe(emp.cookie));
  dire("l'employeur voit la photo de la personne choisie",
       pageEmp.texte.includes('src="/photos/' + elle.id + "?v=" + photoElle.slice(0, 8) + '"') &&
       pageEmp.texte.includes("Photo contrôlée par l'équipe"));
  const pageElle = await lire("/messages/" + candElle, cookieDe(elle.cookie));
  dire("et elle voit celle de l'employeur", pageElle.texte.includes('src="/photos/' + emp.id + "?v=" + photoEmp.slice(0, 8) + '"'));
  dire("l'application donne la meme adresse",
       (await discussionApi(candElle, emp.cookie)).photoAutre === "/photos/" + elle.id + "?v=" + photoElle.slice(0, 8) &&
       (await discussionApi(candElle, elle.cookie)).photoAutre === "/photos/" + emp.id + "?v=" + photoEmp.slice(0, 8));
  dire("l'employeur ouvre la photo", (await photo(elle, cookieDe(emp.cookie))).code === 200);
  dire("elle ouvre celle de l'employeur", (await photo(emp, cookieDe(elle.cookie))).code === 200);

  const coAppli = await fetch(RACINE + "/api/connexion", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: emp.mail, motdepasse: "motdepasse123" }) });
  const jeton = (await coAppli.json()).jeton;
  dire("le telephone l'ouvre avec le jeton de la session",
       (await photo(elle, { Authorization: "Bearer " + jeton })).code === 200);

  console.log(SAUT + "--- LA PERSONNE NON CHOISIE NE VOIT RIEN ---");
  const pageAutre = await lire("/messages/" + candAutre, cookieDe(autre.cookie));
  dire("sa discussion ne montre pas la photo de l'employeur", pageAutre.code === 200 && !pageAutre.texte.includes("/photos/"), "code " + pageAutre.code);
  dire("elle ne l'ouvre pas par son adresse", (await photo(emp, cookieDe(autre.cookie))).code === 404);
  dire("et l'employeur n'ouvre pas la sienne", (await photo(autre, cookieDe(emp.cookie))).code === 404);

  console.log(SAUT + "--- NULLE PART AILLEURS ---");
  for (const [nom, adresse, cookie] of [
    ["la recherche d'un visiteur", "/recherche?metier=menage", null],
    ["la recherche de l'employeur", "/recherche?metier=menage", emp.cookie],
    ["la fiche publique", "/personnes/" + elle.id, emp.cookie],
    ["la liste des demandes", "/annonces", elle.cookie],
    ["Mes demandes", "/mes-demandes", emp.cookie],
  ]) {
    const page = await lire(adresse, cookie ? cookieDe(cookie) : {});
    dire("pas de photo dans " + nom, page.code === 200 && !page.texte.includes("/photos/"), "code " + page.code);
  }
  const ficheApi = JSON.parse((await lire("/api/personnes/" + elle.id, cookieDe(emp.cookie))).texte);
  dire("ni dans la fiche de l'application", !JSON.stringify(ficheApi).includes("photo"));

  console.log(SAUT + "--- SANS PHOTO, OU SUSPENDUE ---");
  base.prepare("UPDATE utilisateurs SET suspendu = 1 WHERE id = ?").run(elle.id);
  dire("une personne suspendue : sa photo ne s'ouvre plus", (await photo(elle, cookieDe(emp.cookie))).code === 404);
  dire("et la discussion ne la montre plus", (await discussionApi(candElle, emp.cookie)).photoAutre === null);
  base.prepare("UPDATE utilisateurs SET suspendu = 0 WHERE id = ?").run(elle.id);

  base.prepare("UPDATE utilisateurs SET photo_fichier = NULL WHERE id = ?").run(elle.id);
  dire("sans photo acceptee : 404", (await photo(elle, cookieDe(emp.cookie))).code === 404);
  dire("et l'initiale reste", (await discussionApi(candElle, emp.cookie)).photoAutre === null &&
       !(await lire("/messages/" + candElle, cookieDe(emp.cookie))).texte.includes("/photos/"));
  base.prepare("UPDATE utilisateurs SET photo_fichier = ? WHERE id = ?").run(photoElle, elle.id);

  console.log(SAUT + "--- NETTOYAGE ---");
  base.prepare("SELECT photo_fichier, photo_envoyee_fichier FROM utilisateurs WHERE email LIKE ?").all("%" + M + "%")
    .flatMap((u) => [u.photo_fichier, u.photo_envoyee_fichier])
    .forEach((f) => { if (f && fs.existsSync(path.join(DOCS, f))) fs.unlinkSync(path.join(DOCS, f)); });
  const n = base.prepare("DELETE FROM utilisateurs WHERE email LIKE ?").run("%" + M + "%").changes;
  console.log("  " + n + " comptes de test supprimes, et leurs photos");

  console.log(SAUT + "RESULTAT : " + ok + " reussis, " + ko + " echec(s)");
  process.exit(ko === 0 ? 0 : 1);
}, 600);
