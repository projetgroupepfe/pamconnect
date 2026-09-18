// Série : l'annuaire de l'équipe.
//
// Deux populations dans une seule liste : les personnes inscrites
// elles-mêmes, et celles que l'équipe a rencontrées et ajoutées. D'où
// vient chaque fiche est écrit sur chacune.
//
// Ce que cette série surveille le plus : une personne ajoutée par
// l'équipe n'a AUCUN accès en ligne. Aucun mot de passe n'a été choisi
// pour elle, et on n'en a pas inventé.
const PROJET = require("path").join(__dirname, "..");
process.chdir(PROJET);
require(PROJET + "/_serveur_test_temporaire.js");

const base = require(PROJET + "/node_modules/better-sqlite3")(PROJET + "/data/pamconnect.db");
base.pragma("foreign_keys = ON");

const RACINE = "http://127.0.0.1:3999";
const M = "test-annuaire";
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
  const mail = M + "-" + suffixe + "@example.com";
  await poster("/inscription", form(Object.assign(
    { role, nom: "Test " + suffixe, email: mail, motdepasse: "motdepasse123",
      telephone: extra && extra.telephone ? extra.telephone : "600000000", quartier: "Bastos" },
    extra || {})));
  const c = await poster("/connexion", form({ email: mail, motdepasse: "motdepasse123" }));
  const ligne = base.prepare("SELECT id FROM utilisateurs WHERE email = ?").get(mail.toLowerCase());
  return { mail, cookie: c.cookie, id: ligne.id };
}

setTimeout(async () => {
  const emp = await creerCompte("emp", "employeur", { telephone: "677000001" });
  const pre = await creerCompte("pre", "prestataire",
    { metier: "menagere", tarif: "20000", telephone: "677000002" });
  const eq = await creerCompte("eq", "employeur", { telephone: "677000003" });
  base.prepare("UPDATE utilisateurs SET est_admin = 1 WHERE email = ?").run(eq.mail.toLowerCase());

  console.log("\n--- 1. L'ANNUAIRE EST RESERVE A L'EQUIPE ---");
  dire("un employeur reçoit 403", (await lire("/admin/utilisateurs", emp.cookie)).status === 403);
  dire("une personne qui répond aussi", (await lire("/admin/utilisateurs", pre.cookie)).status === 403);
  dire("sans session, on est renvoyé", (await lire("/admin/utilisateurs")).status === 302);

  console.log("\n--- 2. CE QU'IL MONTRE ---");
  let page = await (await lire("/admin/utilisateurs", eq.cookie)).text();
  dire("les inscrits y sont", page.includes("Test pre") && page.includes("Test emp"));
  dire("leur origine est écrite", page.includes("Inscrite elle-même"));
  dire("leur numéro est appelable", page.includes('href="tel:+237677000002"'));

  console.log("\n--- 3. AJOUTER UNE PERSONNE RENCONTREE ---");
  const sansNom = await poster("/admin/utilisateurs",
    form({ nom: "A", telephone: "677000004", role: "prestataire", metier: "jardinier" }), eq.cookie);
  dire("un nom trop court est refusé", sansNom.code === 400, "code " + sansNom.code);

  const sansMetier = await poster("/admin/utilisateurs",
    form({ nom: M + " Jardinier", telephone: "677000004", role: "prestataire" }), eq.cookie);
  dire("un prestataire sans métier est refusé", sansMetier.code === 400, "code " + sansMetier.code);

  const numeroInvalide = await poster("/admin/utilisateurs",
    form({ nom: M + " Jardinier", telephone: "123", role: "prestataire", metier: "jardinier" }), eq.cookie);
  dire("un numéro invalide est refusé", numeroInvalide.code === 400, "code " + numeroInvalide.code);

  const ajout = await poster("/admin/utilisateurs",
    form({ nom: M + " Jardinier", telephone: "677 00 00 04", role: "prestataire",
           metier: "jardinier", quartier: "Mvan", tarif: "8000" }), eq.cookie);
  dire("la personne est ajoutée", ajout.code === 302, "code " + ajout.code);

  const ajoutee = base.prepare("SELECT * FROM utilisateurs WHERE nom = ?").get(M + " Jardinier");
  dire("sa fiche existe", Boolean(ajoutee));
  dire("le numéro est rangé sous une seule forme", ajoutee && ajoutee.telephone === "677000004",
       String(ajoutee && ajoutee.telephone));
  dire("l'équipe qui l'a ajoutée est gardée", ajoutee && ajoutee.ajoute_par === eq.id);
  dire("le quartier est reconnu et son arrondissement trouvé",
       ajoutee && ajoutee.quartier === "Mvan" && Boolean(ajoutee.arrondissement),
       ajoutee ? ajoutee.quartier + " / " + ajoutee.arrondissement : "");
  dire("son identité n'est pas vérifiée sans la case",
       ajoutee && ajoutee.statut_verification === "non soumis",
       String(ajoutee && ajoutee.statut_verification));

  console.log("\n--- 4. ELLE N'A AUCUN ACCES EN LIGNE ---");
  const essai = await poster("/connexion",
    form({ email: "annuaire-677000004", motdepasse: "motdepasse123" }));
  dire("on ne se connecte pas avec son identifiant", !essai.cookie, String(essai.cookie));
  dire("aucun mot de passe utilisable n'a été rangé",
       ajoutee && ajoutee.motdepasse.startsWith("sans-connexion:"),
       ajoutee ? ajoutee.motdepasse.slice(0, 20) : "");

  const doublon = await poster("/admin/utilisateurs",
    form({ nom: M + " Autre", telephone: "677000004", role: "prestataire", metier: "jardinier" }), eq.cookie);
  dire("le même numéro n'entre pas deux fois", doublon.code === 409, "code " + doublon.code);

  console.log("\n--- 4 bis. L'ADRESSE EMAIL, SI ELLE EN A UNE ---");
  const mauvaise = await poster("/admin/utilisateurs",
    form({ nom: M + " Plombier", telephone: "677000006", role: "prestataire",
           metier: "jardinier", email: "pas-une-adresse" }), eq.cookie);
  dire("une adresse incomplète est refusée", mauvaise.code === 400, "code " + mauvaise.code);

  await poster("/admin/utilisateurs",
    form({ nom: M + " Plombier", telephone: "677000006", role: "prestataire",
           metier: "jardinier", email: M + "-plombier@example.com" }), eq.cookie);
  const avecMail = base.prepare("SELECT * FROM utilisateurs WHERE nom = ?").get(M + " Plombier");
  dire("l'adresse notée par l'équipe est gardée",
       avecMail && avecMail.email_contact === M + "-plombier@example.com",
       String(avecMail && avecMail.email_contact));

  // ELLE RESTE LIBRE : l'identifiant de connexion est technique, donc la
  // personne pourra s'inscrire elle-meme avec sa propre adresse.
  dire("elle n'est pas devenue son identifiant de connexion",
       avecMail && avecMail.email === "annuaire-677000006", String(avecMail && avecMail.email));

  const inscription = await poster("/inscription",
    form({ role: "prestataire", nom: M + " Plombier", email: M + "-plombier@example.com",
           motdepasse: "motdepasse123", telephone: "677000007", quartier: "Bastos",
           metier: "jardinier", tarif: "8000" }));
  dire("la personne peut s'inscrire elle-même avec cette adresse",
       inscription.code === 200, "code " + inscription.code);

  console.log("\n--- 5. LA PIECE VUE EN PERSONNE ---");
  await poster("/admin/utilisateurs",
    form({ nom: M + " Menuisier", telephone: "677000005", role: "prestataire",
           metier: "jardinier", quartier: "Bastos", piece_vue: "oui" }), eq.cookie);
  const vue = base.prepare("SELECT statut_verification FROM utilisateurs WHERE nom = ?")
    .get(M + " Menuisier");
  dire("l'équipe peut valider ce qu'elle a vu en main",
       vue && vue.statut_verification === "verifie", String(vue && vue.statut_verification));

  console.log("\n--- 6. CHERCHER ---");
  page = await (await lire("/admin/utilisateurs", eq.cookie)).text();
  dire("les deux origines apparaissent", page.includes("Ajoutée par l'équipe"));

  page = await (await lire("/admin/utilisateurs?q=jardinier", eq.cookie)).text();
  dire("la recherche par métier trouve", page.includes(M + " Jardinier"));
  dire("et écarte le reste", !page.includes("Test pre<"));

  page = await (await lire("/admin/utilisateurs?q=677000004", eq.cookie)).text();
  dire("la recherche par numéro trouve", page.includes(M + " Jardinier"));

  page = await (await lire("/admin/utilisateurs?origine=ajoute", eq.cookie)).text();
  dire("le filtre garde les personnes ajoutées", page.includes(M + " Jardinier"));
  dire("et écarte les inscrits", !page.includes("Test emp"));

  page = await (await lire("/admin/utilisateurs?role=employeur", eq.cookie)).text();
  dire("le filtre par rôle marche", page.includes("Test emp") && !page.includes(M + " Jardinier"));

  const supprimes = base.prepare("DELETE FROM utilisateurs WHERE email LIKE ? OR nom LIKE ?")
    .run("%" + M + "%", M + "%").changes;
  console.log("  ----- | nettoyage : " + supprimes + " comptes de test supprimés");

  console.log("\nRESULTAT : " + ok + " reussis, " + ko + " echec(s)");
  process.exit(ko === 0 ? 0 : 1);
}, 500);
