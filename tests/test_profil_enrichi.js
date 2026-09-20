// Série : le profil enrichi — âge, expérience, disponibilités, badges.
const PROJET = require("path").join(__dirname, "..");
process.chdir(PROJET);
require(PROJET + "/_serveur_test_temporaire.js");

const base = require(PROJET + "/node_modules/better-sqlite3")(PROJET + "/data/pamconnect.db");
base.pragma("foreign_keys = ON");

const RACINE = "http://127.0.0.1:3999";
const M = "test-enrichi";
let ok = 0, ko = 0;

const dire = (nom, cond, detail) => {
  if (cond) { ok++; console.log("  OK    | " + nom); }
  else { ko++; console.log("  ECHEC | " + nom + (detail ? "   -> " + detail : "")); }
};

const form = (o) => new URLSearchParams(o);
const lire = (chemin, cookie) =>
  fetch(RACINE + chemin, { headers: cookie ? { Cookie: cookie } : {}, redirect: "manual" });

setTimeout(async () => {
  console.log("\n--- CE QUI EST SAISI EST BIEN ENREGISTRE ---");
  const mail = M + "-p@example.com";
  const corps = form({ role: "prestataire", nom: "Test Enrichi", email: mail,
    motdepasse: "motdepasse123", telephone: "600000000", quartier: "Bastos", metier: "menagere", tarif: "15000",
    date_naissance: "1995-06-15", experience_annees: "4" });
  // Un creneau invente est glisse au milieu des vrais.
  ["lundi-matin", "lundi-soir", "samedi-matin", "sorcier-minuit"]
    .forEach((c) => corps.append("disponibilites", c));

  const inscription = await fetch(RACINE + "/inscription", { method: "POST", body: corps });
  dire("l'inscription est acceptee", inscription.status === 200);

  const u = base.prepare("SELECT * FROM utilisateurs WHERE email = ?").get(mail);
  dire("la date de naissance est conservee", u.date_naissance === "1995-06-15", u.date_naissance);
  dire("l'experience aussi", u.experience_annees === 4, String(u.experience_annees));
  dire("les creneaux valides sont gardes, dans l'ordre de la semaine",
       u.disponibilites === "lundi-matin|lundi-soir|samedi-matin", u.disponibilites);
  dire("le creneau invente est ecarte", !u.disponibilites.includes("sorcier"));

  const r = await fetch(RACINE + "/connexion", { method: "POST", redirect: "manual",
    body: form({ email: mail, motdepasse: "motdepasse123", telephone: "600000000" }) });
  const cookie = r.headers.getSetCookie()[0].split(";")[0];

  console.log("\n--- LA DATE COMPLETE N'EST JAMAIS AFFICHEE ---");
  const profil = await (await lire("/mon-profil", cookie)).text();
  dire("une tranche d'age est affichee", profil.includes("25 - 34 ans"));
  dire("la date complete n'apparait nulle part sur le profil",
       !profil.includes("1995-06-15"));

  const emp = await (async () => {
    const m = M + "-e@example.com";
    await fetch(RACINE + "/inscription", { method: "POST", body: form({
      role: "employeur", nom: "Emp", email: m, motdepasse: "motdepasse123", telephone: "600000000", quartier: "Bastos" }) });
    const rr = await fetch(RACINE + "/connexion", { method: "POST", redirect: "manual",
      body: form({ email: m, motdepasse: "motdepasse123", telephone: "600000000" }) });
    return rr.headers.getSetCookie()[0].split(";")[0];
  })();

  const recherche = await (await lire("/recherche?metier=menage", emp)).text();
  // La tranche d'age n'est plus une information publique : elle a quitte
  // la recherche, et n'apparait qu'a l'employeur qui a deja embauche.
  dire("la tranche d'age n'apparait pas dans la recherche",
       !recherche.includes("25 - 34 ans"));
  dire("ni la date complete, evidemment", !recherche.includes("1995-06-15"));

  console.log("\n--- CE QU'UN EMPLOYEUR VOIT AVANT DE CHOISIR ---");
  dire("les jours de disponibilite", recherche.includes("lundi, samedi"));
  // La phrase est construite par libelleExperience et echappee par EJS :
  // l'apostrophe devient &#39;.
  dire("les annees d'experience", recherche.includes("4 ans d&#39;expérience"));

  console.log("\n--- LES BADGES NE PROMETTENT QUE LE VRAI ---");
  dire("badge experience", profil.includes("4 ans d&#39;expérience"));
  dire("badge disponibilite compte les JOURS, pas les creneaux",
       profil.includes("Disponible 2 jours par semaine"));
  dire("pas de badge 'identite verifiee' sans verification",
       !profil.includes("Identité et casier vérifiés"));

  // Ces deux badges figurent au cahier des charges, mais la plateforme
  // n'envoie ni SMS ni email : les afficher serait mentir.
  dire("aucun badge 'telephone verifie'", !profil.includes("Téléphone vérifié"));
  dire("aucun badge 'e-mail verifie'", !profil.includes("E-mail vérifié"));

  base.prepare("UPDATE utilisateurs SET statut_verification = 'verifie' WHERE email = ?").run(mail);
  const profilVerifie = await (await lire("/mon-profil", cookie)).text();
  dire("apres validation, le badge apparait",
       profilVerifie.includes("Identité et casier vérifiés"));

  console.log("\n--- LA PLATEFORME EST RESERVEE AUX MAJEURS ---");
  const mineur = await fetch(RACINE + "/inscription", { method: "POST", body: form({
    role: "prestataire", nom: "Jeune", email: M + "-j@example.com", motdepasse: "motdepasse123", telephone: "600000000",
    quartier: "Bastos", metier: "menagere", tarif: "5000", date_naissance: "2015-01-01" }) });
  dire("une date donnant moins de 18 ans est refusee", mineur.status === 400,
       "code " + mineur.status);
  dire("le compte n'a pas ete cree",
       !base.prepare("SELECT id FROM utilisateurs WHERE email = ?").get(M + "-j@example.com"));

  const sansDate = await fetch(RACINE + "/inscription", { method: "POST", body: form({
    role: "prestataire", nom: "Sans", email: M + "-s@example.com", motdepasse: "motdepasse123", telephone: "600000000",
    quartier: "Bastos", metier: "menagere", tarif: "5000" }) });
  dire("la date reste facultative", sansDate.status === 200, "code " + sansDate.status);

  console.log("\n--- CES CHAMPS NE CONCERNENT PAS UN EMPLOYEUR ---");
  const formEmp = await (await lire("/mon-profil/modifier", emp)).text();
  dire("un employeur ne voit pas la grille des disponibilites",
       !formEmp.includes("creneaux-table"));
  const formPre = await (await lire("/mon-profil/modifier", cookie)).text();
  dire("la personne qui travaille, oui", formPre.includes("creneaux-table"));
  dire("et sa grille est preremplie", formPre.includes('value="lundi-matin" checked'));

  console.log("\n--- LES COMPTES CREES AVANT CES CHAMPS MARCHENT TOUJOURS ---");
  // Chaque nouvelle colonne arrive VIDE sur les comptes existants. Un
  // ecran qui suppose sa presence casserait pour tout le monde sauf les
  // nouveaux inscrits. On fabrique ici un compte "d'avant" - toutes les
  // colonnes recentes a NULL - et on ouvre chaque page.
  const ancien = M + "-ancien@example.com";
  await fetch(RACINE + "/inscription", { method: "POST", body: form({
    role: "prestataire", nom: "Compte Ancien", email: ancien,
    motdepasse: "motdepasse123", telephone: "600000000", quartier: "Bastos", metier: "menagere", tarif: "12000" }) });
  base.prepare(`UPDATE utilisateurs
    SET date_naissance = NULL, experience_annees = NULL, disponibilites = NULL
    WHERE email = ?`).run(ancien);
  const idAncien = base.prepare("SELECT id FROM utilisateurs WHERE email = ?").get(ancien).id;
  const rAncien = await fetch(RACINE + "/connexion", { method: "POST", redirect: "manual",
    body: form({ email: ancien, motdepasse: "motdepasse123", telephone: "600000000" }) });
  const ckAncien = rAncien.headers.getSetCookie()[0].split(";")[0];

  const casse = (t) => /ReferenceError|TypeError|Cannot read/.test(t);

  for (const chemin of ["/mon-profil", "/mon-profil/modifier", "/annonces",
                        "/messages", "/verification"]) {
    const r = await lire(chemin, ckAncien);
    dire("ancien compte : " + chemin, r.status === 200 && !casse(await r.text()),
         "code " + r.status);
  }

  const ficheAncien = await lire("/personnes/" + idAncien);
  const texteAncien = await ficheAncien.text();
  dire("ancien compte : sa fiche publique s'ouvre",
       ficheAncien.status === 200 && !casse(texteAncien));
  dire("les blocs vides sont simplement absents",
       !/\d+ - \d+ ans/.test(texteAncien) && !texteAncien.includes("Ses disponibilités"));
  dire("mais son tarif n'est pas montre a un visiteur : il est reserve a l'equipe", !texteAncien.includes("FCFA"));

  // Une annonce publiee avant que le prix ne devienne obligatoire :
  // c'est le cas de quatre demandes reelles.
  const empAncien = await (async () => {
    const m = M + "-empa@example.com";
    await fetch(RACINE + "/inscription", { method: "POST", body: form({
      role: "employeur", nom: "EmpA", email: m, motdepasse: "motdepasse123", telephone: "600000000", quartier: "Bastos" }) });
    const rr = await fetch(RACINE + "/connexion", { method: "POST", redirect: "manual",
      body: form({ email: m, motdepasse: "motdepasse123", telephone: "600000000" }) });
    return rr.headers.getSetCookie()[0].split(";")[0];
  })();
  // Publier une demande ET y repondre exigent une identite verifiee.
  // Ce n'est pas le sujet de cette serie : on la donne a tous les
  // comptes qu'elle cree.
  base.prepare("UPDATE utilisateurs SET statut_verification = 'verifie' "
    + "WHERE email LIKE ?").run("%" + M + "%");

  await fetch(RACINE + "/annonces", { method: "POST", headers: { Cookie: empAncien },
    redirect: "manual", body: form({ titre: M + " sans prix", metier: "menagere",
      quartier: "Mvan", horaire: "Lundi", prix: "10000" }) });
  const annA = base.prepare("SELECT id FROM annonces WHERE titre LIKE ? ORDER BY id DESC LIMIT 1").get("%" + M + " sans prix%");
  base.prepare("UPDATE annonces SET prix = NULL, duree_estimee = NULL, conditions = NULL WHERE id = ?").run(annA.id);

  await fetch(RACINE + "/candidatures", { method: "POST", headers: { Cookie: ckAncien },
    redirect: "manual", body: form({ annonceId: String(annA.id) }) });
  base.prepare("UPDATE utilisateurs SET statut_verification = 'verifie' WHERE email = ?").run(ancien);
  const candA = base.prepare("SELECT id FROM candidatures WHERE annonce_id = ?").get(annA.id);

  const confA = await lire("/candidatures/" + candA.id + "/confirmer", empAncien);
  const texteConfA = await confA.text();
  dire("annonce sans prix : la confirmation s'ouvre quand meme",
       confA.status === 200 && !casse(texteConfA), "code " + confA.status);
  dire("elle s'affiche entierement, malgre le prix manquant",
       texteConfA.includes("Confirmer votre choix"));

  console.log("\n--- LE TARIF DU PROFIL EST UNE INDICATION ---");
  // Reste du changement de modele : le calcul "vous recevez" s'affichait
  // a partir du tarif DECLARE, sans dire que ce montant ne sera pas
  // celui qui sera paye. Une personne ayant declare 25 000 lisait "vous
  // recevez 22 500" ; en repondant a une demande a 10 000, elle recevra
  // 9 000.
  //
  // Les fragments cherches ici tiennent sur UNE ligne du gabarit : une
  // phrase entiere serait coupee par un retour a la ligne, et le test
  // echouerait sur du texte pourtant present.
  const monProfil = await (await lire("/mon-profil", cookie)).text();
  dire("le tarif souhaite reste affiche, avec ce que la personne recoit",
       monProfil.includes("Vous recevez") && monProfil.includes("L&#39;employeur paie"));
  dire("mais l'ecran dit que c'est un point de depart",
       monProfil.includes("Ce tarif est un point de départ"));
  dire("vu de l'equipe seule, jamais des employeurs",
       monProfil.includes("seule l'équipe PamConnect le voit"));

  const pageInscription = await (await lire("/inscription")).text();
  dire("l'inscription le dit aussi", pageInscription.includes("Ce tarif est un point de départ"));
  dire("l'ancienne phrase fausse a disparu",
       !pageInscription.includes("montant que l'employeur paiera"));

  const pageModif = await (await lire("/mon-profil/modifier", cookie)).text();
  dire("la modification du profil aussi",
       pageModif.includes("Ce tarif est un point de départ")
       && !pageModif.includes("montant que l'employeur paiera"));

  // La page qui EXPLIQUE le modele affirmait encore que l'employeur paie
  // le tarif du profil. C'est lui qui annonce son prix.
  const pagePrestataire = await (await lire("/prestataire")).text();
  dire("la page du modele est corrigee",
       !pagePrestataire.includes("C'est ce montant que l'employeur paie"));
  dire("elle dit que la personne annonce son prix", pagePrestataire.includes("vous annoncez votre prix"));

  // Une seule mention par ecran : ajouter la meme phrase a cote d'un
  // paragraphe qui la disait deja n'aurait rien clarifie.
  const compter = (t, m) => t.split(m).length - 1;
  dire("l'inscription ne le dit qu'une fois",
       compter(pageInscription, "Ce tarif est un point de départ") === 1);
  dire("le profil non plus", compter(monProfil, "Ce tarif est un point de départ") === 1);

  // La ou le montant est REEL - le prix d'une annonce - cette mention
  // n'a rien a faire : elle jetterait un doute sur un chiffre certain.
  dire("l'ecran de reponse a une demande ne porte pas cette mention",
       !(await (await lire("/annonces")).text()).includes("Ce tarif est un point de départ"));

  console.log("\n--- NETTOYAGE ---");
  const n = base.prepare("DELETE FROM utilisateurs WHERE email LIKE ?").run("%" + M + "%").changes;
  console.log("  " + n + " comptes de test supprimes");

  console.log("\nRESULTAT : " + ok + " reussis, " + ko + " echec(s)");
  process.exit(ko === 0 ? 0 : 1);
}, 600);
