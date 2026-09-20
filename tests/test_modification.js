const PROJET = require("path").join(__dirname, "..");
process.chdir(PROJET);
require(PROJET + "/_serveur_test_temporaire.js");

const base = require(PROJET + "/node_modules/better-sqlite3")(PROJET + "/data/pamconnect.db");
base.pragma("foreign_keys = ON");

const RACINE = "http://127.0.0.1:3999";
const M = "test-modif";
let ok = 0, ko = 0;

const dire = (n, c, d) => {
  if (c) { ok++; console.log("  OK    | " + n); }
  else { ko++; console.log("  ECHEC | " + n + (d ? "   -> " + d : "")); }
};

async function poster(chemin, corps, cookie) {
  const r = await fetch(RACINE + chemin, {
    method: "POST", body: corps,
    headers: cookie ? { Cookie: cookie } : {}, redirect: "manual",
  });
  const sc = r.headers.getSetCookie();
  return { code: r.status, corps: await r.text(), cookie: sc.length ? sc[0].split(";")[0] : null };
}
const lire = (chemin, cookie) =>
  fetch(RACINE + chemin, { headers: cookie ? { Cookie: cookie } : {}, redirect: "manual" });
const form = (o) => new URLSearchParams(o);

setTimeout(async () => {
  const mdp = "motdepasse123";
  const emp = M + "-emp@example.com";
  const pre = M + "-pre@example.com";
  const qui = (mail) => base.prepare("SELECT * FROM utilisateurs WHERE email = ?").get(mail);

  await poster("/inscription", form({ role: "employeur", telephone: "600000000", nom: "Emp Avant", email: emp,
    motdepasse: mdp, arrondissement: "Yaoundé 1", quartier: "Nsam" }));
  await poster("/inscription", form({ role: "prestataire", telephone: "600000000", nom: "Pre Avant", email: pre,
    motdepasse: mdp, arrondissement: "Yaoundé 1", quartier: "Mvan",
    metier: "MetierAvant", tarif: "5000" }));

  const cEmp = (await poster("/connexion", form({ email: emp, motdepasse: mdp }))).cookie;
  let cPre = (await poster("/connexion", form({ email: pre, motdepasse: mdp }))).cookie;

  console.log("\n--- 1. Acces au formulaire ---");
  dire("visiteur non connecte -> redirige", (await lire("/mon-profil/modifier")).status === 302);
  const page = await (await lire("/mon-profil/modifier", cPre)).text();
  dire("la page s'affiche", page.includes("Modifier mon profil"));
  dire("le formulaire est prerempli",
       page.includes('value="Pre Avant"') && page.includes('value="MetierAvant"') && page.includes('value="5000"'));
  // Le compte a ete cree avec le quartier "Mvan" : le serveur en a
  // deduit Yaounde 4, quel que soit l'arrondissement envoye au formulaire.
  dire("l'arrondissement deduit du quartier est selectionne",
       page.includes('value="Yaoundé 4" selected'), qui(pre).arrondissement);
  dire("les quartiers sont proposes en suggestion", page.includes("listeQuartiers"));
  dire("le detail du tarif actuel est visible", page.includes("Commission PamConnect"));
  dire("l'adresse actuelle est rappelee", page.includes(pre));
  dire("la section de changement d'adresse existe", page.includes('action="/mon-profil/email"'));
  dire("elle exige le mot de passe", page.includes('id="motdepasseEmail"'));
  dire("le pave d'explication a disparu", !page.includes("Ce qui ne peut pas"));

  console.log("\n--- 2. Modification acceptee ---");
  const r1 = await poster("/mon-profil/modifier", form({
    nom: "Pre Apres", telephone: "600000000", arrondissement: "Yaoundé 5", quartier: "Bastos",
    metier: "MetierApres", tarif: "12000" }), cPre);
  dire("la modification passe", r1.code === 200 && r1.corps.includes("mis à jour"), "code " + r1.code);

  const modifie = qui(pre);
  dire("nom modifie", modifie.nom === "Pre Apres", modifie.nom);
  // On a envoye quartier "Bastos" AVEC arrondissement "Yaoundé 5".
  // Bastos est a Yaounde 1 : le serveur doit ignorer ce qu'on lui envoie.
  dire("l'arrondissement vient du quartier, pas du formulaire",
       modifie.arrondissement === "Yaoundé 1", modifie.arrondissement);
  dire("le quartier est enregistre sous son nom officiel",
       modifie.quartier === "Bastos", modifie.quartier);
  dire("quartier modifie", modifie.quartier === "Bastos", modifie.quartier);
  dire("metier modifie", modifie.metier === "MetierApres", modifie.metier);
  dire("tarif modifie", modifie.tarif === 12000, String(modifie.tarif));

  const profil = await (await lire("/mon-profil", cPre)).text();
  dire("le nouveau calcul apparait sur le profil",
       profil.includes("12 000 FCFA") && profil.includes("1 200 FCFA") && profil.includes("13 200 FCFA"));

  const recherche = await (await lire("/recherche?metier=metierapres")).text();
  dire("la recherche voit le nouveau metier, mais jamais le tarif",
       recherche.includes("Pre Apres") && !recherche.includes("12 000 FCFA"));

  console.log("\n--- 3. Les regles du profil tiennent aussi ici ---");
  const sansMetier = await poster("/mon-profil/modifier", form({
    nom: "Pre Apres", telephone: "600000000", arrondissement: "Yaoundé 5", quartier: "Bastos",
    metier: "   ", tarif: "12000" }), cPre);
  dire("metier vide -> 400", sansMetier.code === 400, "code " + sansMetier.code);
  dire("rien n'a change", qui(pre).metier === "MetierApres");

  const tarifZero = await poster("/mon-profil/modifier", form({
    nom: "Pre Apres", telephone: "600000000", arrondissement: "Yaoundé 5", quartier: "Bastos",
    metier: "MetierApres", tarif: "0" }), cPre);
  dire("tarif a zero -> 400", tarifZero.code === 400, "code " + tarifZero.code);
  dire("le tarif n'a pas bouge", qui(pre).tarif === 12000);

  const horsTranche = await poster("/mon-profil/modifier", form({
    nom: "Pre Apres", telephone: "600000000", arrondissement: "Yaoundé 5", quartier: "Bastos",
    metier: "MetierApres", tarif: "12250" }), cPre);
  dire("tarif hors tranche de 500 -> 400", horsTranche.code === 400, "code " + horsTranche.code);
  dire("le tarif n'a toujours pas bouge", qui(pre).tarif === 12000);

  const sansNom = await poster("/mon-profil/modifier", form({
    nom: "  ", telephone: "600000000", arrondissement: "Yaoundé 5", metier: "MetierApres", tarif: "12000" }), cPre);
  dire("nom vide -> 400", sansNom.code === 400, "code " + sansNom.code);

  console.log("\n--- 4. Un employeur n'herite pas d'un metier ---");
  const rEmp = await poster("/mon-profil/modifier", form({
    nom: "Emp Apres", telephone: "600000000", arrondissement: "Yaoundé 3", quartier: "Mokolo",
    metier: "MetierPirate", tarif: "99999" }), cEmp);
  dire("la modification passe", rEmp.code === 200, "code " + rEmp.code);
  const empModifie = qui(emp);
  dire("nom et quartier modifies", empModifie.nom === "Emp Apres" && empModifie.quartier === "Mokolo");
  dire("metier ignore (reste vide)", empModifie.metier === null, String(empModifie.metier));
  dire("tarif ignore (reste vide)", empModifie.tarif === null, String(empModifie.tarif));

  console.log("\n--- 5. La position n'est jamais effacee par erreur ---");
  base.prepare("UPDATE utilisateurs SET latitude = 3.85, longitude = 11.5 WHERE email = ?").run(pre);
  await poster("/mon-profil/modifier", form({
    nom: "Pre Apres", telephone: "600000000", arrondissement: "Yaoundé 5", quartier: "Bastos",
    metier: "MetierApres", tarif: "12000" }), cPre);   // aucune position envoyee
  dire("sans position envoyee, l'ancienne est conservee", qui(pre).latitude === 3.85);

  await poster("/mon-profil/modifier", form({
    nom: "Pre Apres", telephone: "600000000", arrondissement: "Yaoundé 5", quartier: "Bastos",
    metier: "MetierApres", tarif: "12000",
    latitude: "3.9", longitude: "11.6" }), cPre);
  dire("avec une position envoyee, elle est mise a jour", qui(pre).latitude === 3.9);

  console.log("\n--- 6. Le mot de passe ---");
  const empreinteAvant = qui(pre).motdepasse;

  const mauvais = await poster("/mon-profil/mot-de-passe", form({
    ancien: "je-ne-sais-pas", nouveau: "nouveaumdp123" }), cPre);
  dire("ancien mot de passe faux -> 403", mauvais.code === 403, "code " + mauvais.code);
  dire("le mot de passe n'a pas change", qui(pre).motdepasse === empreinteAvant);

  const courtMdp = await poster("/mon-profil/mot-de-passe", form({
    ancien: mdp, nouveau: "abc" }), cPre);
  dire("nouveau mot de passe trop court -> 400", courtMdp.code === 400, "code " + courtMdp.code);
  dire("le mot de passe n'a toujours pas change", qui(pre).motdepasse === empreinteAvant);

  const bon = await poster("/mon-profil/mot-de-passe", form({
    ancien: mdp, nouveau: "nouveaumdp123" }), cPre);
  dire("changement accepte", bon.code === 200 && bon.corps.includes("modifié"), "code " + bon.code);
  dire("l'empreinte a change en base", qui(pre).motdepasse !== empreinteAvant);

  const ancienneConnexion = await poster("/connexion", form({ email: pre, motdepasse: mdp }));
  dire("l'ancien mot de passe ne marche plus", ancienneConnexion.code === 401, "code " + ancienneConnexion.code);
  const nouvelleConnexion = await poster("/connexion", form({ email: pre, motdepasse: "nouveaumdp123" }));
  dire("le nouveau mot de passe marche", nouvelleConnexion.code === 200 && !!nouvelleConnexion.cookie);

  console.log("\n--- 7. Changer son adresse email ---");
  const mdpActuel = "nouveaumdp123";               // change a l'etape 6
  const nouvelEmail = M + "-nouvelle@example.com";

  const mauvaisMdp = await poster("/mon-profil/email",
    form({ nouveau: nouvelEmail, motdepasse: "je-ne-sais-pas" }), cPre);
  dire("mot de passe faux -> 403", mauvaisMdp.code === 403, "code " + mauvaisMdp.code);
  dire("l'adresse n'a pas bouge", !!qui(pre));

  const invalide = await poster("/mon-profil/email",
    form({ nouveau: "pasuneadresse", motdepasse: mdpActuel }), cPre);
  dire("adresse sans @ -> 400", invalide.code === 400, "code " + invalide.code);

  const dejaPrise = await poster("/mon-profil/email",
    form({ nouveau: emp, motdepasse: mdpActuel }), cPre);
  dire("adresse deja utilisee -> 409", dejaPrise.code === 409, "code " + dejaPrise.code);

  const identique = await poster("/mon-profil/email",
    form({ nouveau: pre, motdepasse: mdpActuel }), cPre);
  dire("adresse inchangee -> 400", identique.code === 400, "code " + identique.code);
  dire("apres 4 refus, l'adresse est toujours l'ancienne", !!qui(pre));

  const change = await poster("/mon-profil/email",
    form({ nouveau: nouvelEmail.toUpperCase(), motdepasse: mdpActuel }), cPre);
  dire("changement accepte", change.code === 200 && change.corps.includes("modifi"), "code " + change.code);
  dire("la nouvelle adresse est en base, en minuscules", !!qui(nouvelEmail) && !qui(pre));
  dire("la session reste valide (pas de deconnexion)",
       (await lire("/mon-profil", cPre)).status === 200);
  dire("l'ancienne adresse ne connecte plus",
       (await poster("/connexion", form({ email: pre, motdepasse: mdpActuel }))).code === 401);
  const reconnexion = await poster("/connexion", form({ email: nouvelEmail, motdepasse: mdpActuel }));
  dire("la nouvelle adresse connecte bien", reconnexion.code === 200 && !!reconnexion.cookie);

  console.log("\n--- NETTOYAGE ---");
  const n = base.prepare("DELETE FROM utilisateurs WHERE email LIKE ?").run("%" + M + "%").changes;
  console.log("  " + n + " comptes de test supprimes");

  console.log("\nRESULTAT : " + ok + " reussis, " + ko + " echec(s)");
  process.exit(ko === 0 ? 0 : 1);
}, 500);
