// Série : les métiers sont une liste, plus un texte libre.
const PROJET = require("path").join(__dirname, "..");
process.chdir(PROJET);
require(PROJET + "/_serveur_test_temporaire.js");

const base = require(PROJET + "/node_modules/better-sqlite3")(PROJET + "/data/pamconnect.db");
base.pragma("foreign_keys = ON");

const RACINE = "http://127.0.0.1:3999";
const M = "test-metiers";
let ok = 0, ko = 0;

const dire = (nom, cond, detail) => {
  if (cond) { ok++; console.log("  OK    | " + nom); }
  else { ko++; console.log("  ECHEC | " + nom + (detail ? "   -> " + detail : "")); }
};

const form = (o) => new URLSearchParams(o);
const lire = (chemin, cookie) =>
  fetch(RACINE + chemin, { headers: cookie ? { Cookie: cookie } : {}, redirect: "manual" });

async function inscrire(suffixe, metier) {
  const mail = M + "-" + suffixe + "@example.com";
  await fetch(RACINE + "/inscription", { method: "POST", body: form({
    role: "prestataire", nom: "Test " + suffixe, email: mail,
    motdepasse: "motdepasse123", telephone: "600000000", quartier: "Bastos", metier, tarif: "10000" }) });
  const r = await fetch(RACINE + "/connexion", { method: "POST", redirect: "manual",
    body: form({ email: mail, motdepasse: "motdepasse123", telephone: "600000000" }) });
  return { mail, cookie: r.headers.getSetCookie()[0].split(";")[0] };
}

setTimeout(async () => {
  console.log("\n--- CE QUI EST SAISI EST RAMENE AU NOM OFFICIEL ---");
  const equivalents = [
    ["menagere",                "Ménage à domicile"],
    ["MENAGE",                  "Ménage à domicile"],
    ["aide-menagere",           "Ménage à domicile"],
    ["nounous",                 "Garde d'enfants"],
    ["baby sitter",             "Garde d'enfants"],
    ["technicienne de surface", "Nettoyage de bureaux"],
    ["Jardinier",               "Jardinage"],
    ["vigile",                  "Gardiennage"],
    ["cuisiniere",              "Cuisine"],
  ];
  let i = 0;
  for (const [saisi, officiel] of equivalents) {
    const c = await inscrire("m" + (i++), saisi);
    const u = base.prepare("SELECT metier FROM utilisateurs WHERE email = ?").get(c.mail);
    dire('"' + saisi + '" devient "' + officiel + '"', u.metier === officiel, u.metier);
  }

  // Notre liste peut etre incomplete : elle ne doit bloquer personne.
  const inconnu = await inscrire("x", "plombier");
  dire("un metier absent de la liste est accepte tel quel",
       base.prepare("SELECT metier FROM utilisateurs WHERE email = ?").get(inconnu.mail).metier === "plombier");

  console.log("\n--- LA RECHERCHE TROUVE MALGRE L'ORTHOGRAPHE ---");
  for (const mot of ["menage", "Ménage à domicile", "menagere", "AIDE MENAGERE"]) {
    const p = await (await lire("/recherche?metier=" + encodeURIComponent(mot))).text();
    dire('chercher "' + mot + '" trouve des profils',
         p.includes("Ménage à domicile"));
  }
  const rien = await (await lire("/recherche?metier=" + encodeURIComponent("zzzinexistant"))).text();
  dire("un mot qui ne correspond a rien ne trouve rien",
       !rien.includes("Ménage à domicile"));

  console.log("\n--- LES ANNONCES COMPATIBLES ---");
  const emp = await (async () => {
    const mail = M + "-emp@example.com";
    await fetch(RACINE + "/inscription", { method: "POST", body: form({
      role: "employeur", nom: "Emp", email: mail, motdepasse: "motdepasse123", telephone: "600000000", quartier: "Bastos" }) });
    const r = await fetch(RACINE + "/connexion", { method: "POST", redirect: "manual",
      body: form({ email: mail, motdepasse: "motdepasse123", telephone: "600000000" }) });
    return { mail, cookie: r.headers.getSetCookie()[0].split(";")[0] };
  })();

  // L'employeur ecrit "menagere" ; la candidate a ecrit "MENAGE".
  // Sans la liste, ces deux mots ne se seraient jamais rencontres.
  // Publier une demande ET y repondre exigent une identite verifiee.
  // Ce n'est pas le sujet de cette serie : on la donne a tous les
  // comptes qu'elle cree.
  base.prepare("UPDATE utilisateurs SET statut_verification = 'verifie' "
    + "WHERE email LIKE ?").run("%" + M + "%");

  await fetch(RACINE + "/annonces", { method: "POST", headers: { Cookie: emp.cookie },
    redirect: "manual", body: form({ titre: M + " demande menage", metier: "menagere",
      quartier: "Mvan", horaire: "Lundi 8h", prix: "10000" }) });

  const menagere = await inscrire("cible", "MENAGE");
  const page = await (await lire("/annonces", menagere.cookie)).text();
  const avant = page.indexOf(M + " demande menage");
  const sectionAutres = page.indexOf("Les autres demandes");

  dire("la section 'Pour vous' porte son metier officiel",
       page.includes("Pour vous : Ménage à domicile"));
  dire("la demande ecrite 'menagere' y figure", avant !== -1);
  dire("elle est placee AVANT les autres demandes",
       sectionAutres === -1 || avant < sectionAutres,
       "position " + avant + " / section autres " + sectionAutres);

  // Masquer les autres enfermerait quelqu'un dans un seul metier.
  const jardinier = await inscrire("jard", "Jardinier");
  const pageJard = await (await lire("/annonces", jardinier.cookie)).text();
  dire("un jardinier voit quand meme les autres demandes",
       pageJard.includes("Les autres demandes") && pageJard.includes(M + " demande menage"));

  const visiteur = await (await lire("/annonces")).text();
  dire("un visiteur voit une liste simple, sans separation",
       !visiteur.includes("Pour vous —"));

  console.log("\n--- LE CHAMP EST LE MEME PARTOUT ---");
  for (const [chemin, cookie, nom] of [
    ["/inscription", null, "inscription"],
    ["/mon-profil/modifier", menagere.cookie, "modifier mon profil"],
    ["/publier-annonce", emp.cookie, "publier une annonce"],
  ]) {
    const p = await (await lire(chemin, cookie)).text();
    dire("suggestions de metiers sur " + nom, p.includes("listeMetiers"));
  }

  console.log("\n--- NETTOYAGE ---");
  const n = base.prepare("DELETE FROM utilisateurs WHERE email LIKE ?").run("%" + M + "%").changes;
  console.log("  " + n + " comptes de test supprimes");

  console.log("\nRESULTAT : " + ok + " reussis, " + ko + " echec(s)");
  process.exit(ko === 0 ? 0 : 1);
}, 600);
