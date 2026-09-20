// Série : une demande proposée à une personne précise, vue par l'équipe.
//
// LE CAS. Depuis la fiche d'une personne, l'employeur publie une demande
// « pour cette personne ». Il l'a donc choisie avant même de publier. Mais
// l'écran de l'équipe ne le disait pas : la personne n'y figurait que si
// elle avait déjà répondu, et l'équipe pouvait appeler quelqu'un d'autre.
//
// Maintenant la demande porte « Proposée par l'employeur à X », et X passe
// en tête de la liste d'appels, qu'elle ait répondu ou non.
const PROJET = require("path").join(__dirname, "..");
process.chdir(PROJET);
require(PROJET + "/_serveur_test_temporaire.js");

const base = require(PROJET + "/node_modules/better-sqlite3")(PROJET + "/data/pamconnect.db");
base.pragma("foreign_keys = ON");

const RACINE = "http://127.0.0.1:3999";
const M = "test-proposee";
let ok = 0, ko = 0;

const dire = (nom, cond, detail) => {
  if (cond) { ok++; console.log("  OK    | " + nom); }
  else { ko++; console.log("  ECHEC | " + nom + (detail ? "   -> " + detail : "")); }
};

const form = (o) => new URLSearchParams(o);
const lire = (chemin, cookie) =>
  fetch(RACINE + chemin, { headers: cookie ? { Cookie: cookie } : {}, redirect: "manual" });
const texte = async (chemin, cookie) => (await lire(chemin, cookie)).text();
const plat = (t) => t.replace(/\s+/g, " ");

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
      telephone: "600000000", quartier: "Bastos" },
    extra || {})));
  const c = await poster("/connexion", form({ email: mail, motdepasse: "motdepasse123" }));
  const ligne = base.prepare("SELECT id FROM utilisateurs WHERE email = ?").get(mail.toLowerCase());
  return { mail, cookie: c.cookie, id: ligne.id };
}


setTimeout(async () => {
  const emp = await creerCompte("emp", "employeur");
  const a = await creerCompte("a", "prestataire", { metier: "menagere", tarif: "20000" });
  const b = await creerCompte("b", "prestataire", { metier: "menagere", tarif: "15000" });
  const eq = await creerCompte("eq", "employeur");
  base.prepare("UPDATE utilisateurs SET est_admin = 1 WHERE email = ?").run(eq.mail.toLowerCase());
  base.prepare("UPDATE utilisateurs SET statut_verification = 'verifie' WHERE email LIKE ?")
    .run("%" + M + "%");
  for (const p of [a, b]) {
    base.prepare(`INSERT INTO jetons_mouvements (utilisateur_id, quantite, nature, motif, detail)
                  VALUES (?, 5, 'achete', 'achat', 'Credit de test')`).run(p.id);
  }

  const carte = async (titre) => {
    const page = plat(await texte("/admin/mises-en-relation", eq.cookie));
    const debut = page.indexOf(titre);
    const fin = page.indexOf("<h3>", debut + 1);
    return debut === -1 ? "" : page.slice(debut, fin === -1 ? undefined : fin);
  };
  const publier = async (nom, pour) => {
    const corps = { titre: M + " " + nom, metier: "menagere",
      quartier: "Bastos", arrondissement: "Yaounde 1", horaire: "Lundi 8h" };
    if (pour) corps.pour = String(pour.id);
    await poster("/annonces", form(corps), emp.cookie);
    return base.prepare("SELECT id FROM annonces WHERE titre = ? ORDER BY id DESC LIMIT 1")
      .get(M + " " + nom).id;
  };
  const candidatureDe = (annonceId, p) =>
    base.prepare("SELECT id FROM candidatures WHERE annonce_id = ? AND prestataire_id = ?")
      .get(annonceId, p.id);

  console.log("\n--- 1. UNE DEMANDE PROPOSEE A UNE PERSONNE QUI N'A PAS ENCORE REPONDU ---");
  const d1 = await publier("un", a);
  // B, elle, se manifeste : sans la proposition, elle serait appelee la premiere.
  await poster("/candidatures", form({ annonceId: String(d1) }), b.cookie);
  let c = await carte(M + " un");
  dire("la demande est sur l'écran de l'équipe", c !== "");
  dire("l'équipe lit à qui l'employeur l'a proposée",
       c.includes("Proposée par l'employeur à Test a") && c.includes("Appelez-la en premier"));
  dire("la personne est dans la liste d'appels, même sans avoir répondu",
       c.includes("<strong>Test a</strong>"));
  dire("elle porte le badge « Demandée par l'employeur »",
       c.includes("Demandée par l'employeur : à appeler en premier"));
  dire("elle passe avant celle qui s'est manifestée",
       c.indexOf("<strong>Test a</strong>") !== -1 && c.indexOf("<strong>Test a</strong>") < c.indexOf("<strong>Test b</strong>"));
  dire("B reste dans la liste, avec son badge « Intéressée »",
       c.includes("<strong>Test b</strong>") && c.includes("Intéressée"));
  const options = c.indexOf('<option value="' + a.id + '"');
  dire("le formulaire propose A en premier", options !== -1 && options < c.indexOf('<option value="' + b.id + '"'));

  console.log("\n--- 2. UNE DEMANDE ORDINAIRE N'A PAS CETTE LIGNE ---");
  const d2 = await publier("deux", null);
  c = await carte(M + " deux");
  dire("aucune personne n'est proposée", !c.includes("Proposée par l'employeur") && !c.includes("Demandée par l'employeur"));

  console.log("\n--- 3. ELLE A REPONDU, PUIS L'EMPLOYEUR CHOISIT UNE AUTRE ---");
  await poster("/candidatures", form({ annonceId: String(d1) }), a.cookie);
  c = await carte(M + " un");
  dire("toujours en tête une fois qu'elle a répondu",
       c.indexOf("<strong>Test a</strong>") < c.indexOf("<strong>Test b</strong>") &&
       c.includes("Demandée par l'employeur"));
  await poster("/candidatures/statut",
    form({ candidatureId: String(candidatureDe(d1, b).id), statut: "acceptee" }), emp.cookie);
  c = await carte(M + " un");
  dire("l'employeur a choisi B : c'est elle qu'il faut appeler",
       c.includes("Choisie par l'employeur : Test b"));
  dire("la ligne « Proposée à » disparaît, elle n'a plus de sens", !c.includes("Proposée par l'employeur à"));

  console.log("\n--- 4. UNE PERSONNE REFUSEE N'EST PLUS MISE EN TETE ---");
  const d3 = await publier("trois", a);
  await poster("/candidatures", form({ annonceId: String(d3) }), a.cookie);
  await poster("/candidatures/statut",
    form({ candidatureId: String(candidatureDe(d3, a).id), statut: "refusee" }), emp.cookie);
  c = await carte(M + " trois");
  dire("l'employeur a refusé A : elle n'est plus « demandée »",
       !c.includes("Demandée par l'employeur") && !c.includes("Proposée par l'employeur à"));

  const supprimes = base.prepare("DELETE FROM utilisateurs WHERE email LIKE ?")
    .run("%" + M + "%").changes;
  console.log("  ----- | nettoyage : " + supprimes + " comptes de test supprimés");

  console.log("\nRESULTAT : " + ok + " reussis, " + ko + " echec(s)");
  process.exit(ko === 0 ? 0 : 1);
}, 500);
