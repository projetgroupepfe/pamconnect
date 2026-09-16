const fs = require("fs");
const path = require("path");
const PROJET = require("path").join(__dirname, "..");
process.chdir(PROJET);
require(PROJET + "/_serveur_test_temporaire.js");

const base = require(PROJET + "/node_modules/better-sqlite3")(PROJET + "/data/pamconnect.db");
base.pragma("foreign_keys = ON");

const RACINE = "http://127.0.0.1:3999";
const DOCS = path.join(PROJET, "data", "documents");
const M = "test-admin";
let ok = 0, ko = 0;

const dire = (nom, cond, detail) => {
  if (cond) { ok++; console.log("  OK    | " + nom); }
  else { ko++; console.log("  ECHEC | " + nom + (detail ? "   -> " + detail : "")); }
};

async function poster(chemin, corps, cookie) {
  const entetes = {};
  if (cookie) entetes.Cookie = cookie;
  const r = await fetch(RACINE + chemin, { method: "POST", body: corps, headers: entetes, redirect: "manual" });
  const sc = r.headers.getSetCookie();
  return { code: r.status, corps: await r.text(), cookie: sc.length ? sc[0].split(";")[0] : null };
}
const lire = (chemin, cookie) =>
  fetch(RACINE + chemin, { headers: cookie ? { Cookie: cookie } : {}, redirect: "manual" });
const form = (o) => new URLSearchParams(o);
const fichier = (nom, octets, type) => new File([new Uint8Array(octets)], nom, { type });

// Une photo avec une vraie en-tete JPEG : le serveur lit les premiers
// octets et refuse un fichier qui n'est une image que par son nom.
function photoJpeg(nom, octets) {
  const contenu = new Uint8Array(octets || 1500);
  contenu.set([0xff, 0xd8, 0xff, 0xe0]);
  return new File([contenu], nom || "visage.jpg", { type: "image/jpeg" });
}

async function creerCompte(mail, role, extra) {
  await poster("/inscription", form(Object.assign(
    { role, nom: mail.split("@")[0], email: mail, motdepasse: "motdepasse123",
      arrondissement: "Yaounde 1", tarif: role === "prestataire" ? "10000" : "" },
    extra || {})));
  const c = await poster("/connexion", form({ email: mail, motdepasse: "motdepasse123" }));
  return c.cookie;
}

setTimeout(async () => {
  const mailAdmin = M + "-admin@example.com";
  const mailPres = M + "-prestataire@example.com";

  const cookieAdmin = await creerCompte(mailAdmin, "employeur");
  const cookiePres = await creerCompte(mailPres, "prestataire", { metier: "MetierAdmin" });

  // On promeut le compte administrateur, comme le fera l'equipe projet.
  base.prepare("UPDATE utilisateurs SET est_admin = 1 WHERE email = ?").run(mailAdmin);

  const qui = (mail) => base.prepare("SELECT * FROM utilisateurs WHERE email = ?").get(mail);

  console.log("\n--- 1. Qui peut entrer dans l'administration ? ---");
  dire("visiteur non connecte -> redirige", (await lire("/admin")).status === 302);
  dire("utilisateur ordinaire -> 403", (await lire("/admin", cookiePres)).status === 403);
  const pageAdmin = await lire("/admin", cookieAdmin);
  dire("administrateur -> 200", pageAdmin.status === 200, "code " + pageAdmin.status);

  console.log("\n--- 2. Le lien Administration dans le menu ---");
  const menuAdmin = await (await lire("/mon-profil", cookieAdmin)).text();
  const menuPres = await (await lire("/mon-profil", cookiePres)).text();
  dire("visible pour l'administrateur", menuAdmin.includes('href="/admin"'));
  dire("invisible pour les autres", !menuPres.includes('href="/admin"'));

  console.log("\n--- 3. Le prestataire envoie ses documents ---");
  const envoi = new FormData();
  envoi.append("cni", fichier("cni.jpg", 2000, "image/jpeg"));
  envoi.append("casier", fichier("casier.pdf", 3000, "application/pdf"));
  envoi.append("photo", photoJpeg("visage.jpg", 1500));
  await poster("/verification", envoi, cookiePres);
  const soumis = qui(mailPres);
  dire("statut 'en attente'", soumis.statut_verification === "en attente", soumis.statut_verification);
  dire("les 2 fichiers sont sur le disque",
       fs.existsSync(path.join(DOCS, soumis.cni_fichier)) && fs.existsSync(path.join(DOCS, soumis.casier_fichier)));
  dire("et la photo du visage aussi", fs.existsSync(path.join(DOCS, String(soumis.photo_envoyee_fichier))));

  const liste = await (await lire("/admin", cookieAdmin)).text();
  dire("le dossier apparait dans la liste", liste.includes(mailPres));
  dire("l'adresse du document ne revele pas le nom du fichier",
       !liste.includes(soumis.cni_fichier) && liste.includes("/admin/document/" + soumis.id + "/cni"));

  console.log("\n--- 4. Consultation des documents ---");
  const doc = await lire("/admin/document/" + soumis.id + "/cni", cookieAdmin);
  dire("l'administrateur peut ouvrir la CNI", doc.status === 200, "code " + doc.status);
  dire("le contenu fait bien 2000 octets", (await doc.arrayBuffer()).byteLength === 2000);
  dire("un utilisateur ordinaire -> 403",
       (await lire("/admin/document/" + soumis.id + "/cni", cookiePres)).status === 403);
  dire("un visiteur non connecte -> redirige",
       (await lire("/admin/document/" + soumis.id + "/cni")).status === 302);
  dire("un type de document invente -> 404",
       (await lire("/admin/document/" + soumis.id + "/passeport", cookieAdmin)).status === 404);

  dire("l'equipe controle la date du casier", liste.includes("Vérifiez que l'extrait de casier date de moins de 3 mois."));
  dire("la liste propose d'ouvrir la photo, avec la consigne",
       liste.includes('href="/admin/document/' + soumis.id + '/photo"') &&
       liste.includes("Comparez le visage de la photo à celui de la pièce d'identité avant de valider."));
  const photoDossier = await lire("/admin/document/" + soumis.id + "/photo", cookieAdmin);
  dire("l'equipe ouvre la photo du visage", photoDossier.status === 200 &&
       photoDossier.headers.get("x-content-type-options") === "nosniff" &&
       (await photoDossier.arrayBuffer()).byteLength === 1500, "code " + photoDossier.status);
  dire("une personne ordinaire ne l'ouvre pas -> 403",
       (await lire("/admin/document/" + soumis.id + "/photo", cookiePres)).status === 403);

  console.log("\n--- 5. Validation : les documents doivent DISPARAITRE ---");
  const cniAvant = soumis.cni_fichier, casierAvant = soumis.casier_fichier;
  const photoAvant = soumis.photo_envoyee_fichier;
  const validation = await poster("/admin/verification",
    form({ utilisateurId: soumis.id, decision: "valider" }), cookieAdmin);
  dire("redirection vers /admin", validation.code === 302, "code " + validation.code);

  const valide = qui(mailPres);
  dire("statut = 'verifie'", valide.statut_verification === "verifie", valide.statut_verification);
  dire("date de verification enregistree", !!valide.verifie_le, String(valide.verifie_le));
  dire("nom de la CNI efface en base", valide.cni_fichier === null);
  dire("nom du casier efface en base", valide.casier_fichier === null);
  dire("FICHIER CNI supprime du disque", !fs.existsSync(path.join(DOCS, cniAvant)));
  dire("FICHIER casier supprime du disque", !fs.existsSync(path.join(DOCS, casierAvant)));
  // LA PHOTO, ELLE, EST GARDEE : elle sert a se reconnaitre a la porte.
  dire("la photo est gardee, devenue la photo acceptee",
       valide.photo_fichier === photoAvant && valide.photo_envoyee_fichier === null &&
       fs.existsSync(path.join(DOCS, photoAvant)));
  dire("le dossier a quitte la liste", !(await (await lire("/admin", cookieAdmin)).text()).includes(mailPres));

  console.log("\n--- 6. Le badge apparait pour les employeurs ---");
  const recherche = await (await lire("/recherche?metier=metieradmin")).text();
  dire("badge 'Identite verifiee' dans les resultats", recherche.includes("Identit&#233; v&#233;rifi&#233;e") || recherche.includes("Identité vérifiée"));

  console.log("\n--- 7. Un dossier deja traite ne peut plus l'etre ---");
  const rejeu = await poster("/admin/verification",
    form({ utilisateurId: soumis.id, decision: "valider" }), cookieAdmin);
  dire("nouvelle validation -> 404", rejeu.code === 404, "code " + rejeu.code);
  dire("un prestataire deja verifie ne peut pas renvoyer (409)",
       (await poster("/verification", new FormData(), cookiePres)).code === 409);

  console.log("\n--- 8. Le refus avec motif ---");
  const mailRefus = M + "-refus@example.com";
  const cookieRefus = await creerCompte(mailRefus, "prestataire", { metier: "MetierAdmin" });
  const envoi2 = new FormData();
  envoi2.append("cni", fichier("cni.jpg", 1000, "image/jpeg"));
  envoi2.append("casier", fichier("casier.pdf", 1000, "application/pdf"));
  envoi2.append("photo", photoJpeg());
  await poster("/verification", envoi2, cookieRefus);
  const aRefuser = qui(mailRefus);
  await poster("/admin/verification",
    form({ utilisateurId: aRefuser.id, decision: "refuser", motif: "Document illisible" }), cookieAdmin);
  const refuse = qui(mailRefus);
  dire("statut = 'refuse'", refuse.statut_verification === "refuse", refuse.statut_verification);
  dire("motif enregistre", refuse.motif_refus === "Document illisible", String(refuse.motif_refus));
  dire("documents supprimes du disque aussi",
       !fs.existsSync(path.join(DOCS, aRefuser.cni_fichier)) && !fs.existsSync(path.join(DOCS, aRefuser.casier_fichier)));
  dire("la photo d'un dossier refuse est supprimee avec lui",
       refuse.photo_envoyee_fichier === null && refuse.photo_fichier === null &&
       !fs.existsSync(path.join(DOCS, aRefuser.photo_envoyee_fichier)));
  const profilRefuse = await (await lire("/mon-profil", cookieRefus)).text();
  dire("le prestataire voit le motif sur son profil", profilRefuse.includes("Document illisible"));
  dire("il peut renvoyer un dossier", (await lire("/verification", cookieRefus)).status === 200);

  console.log("\n--- L'EQUIPE N'EMBAUCHE PAS (conflit d'interet) ---");

  // 1. Le bouton a disparu de la page.
  const profilEquipe = await (await lire("/mon-profil", cookieAdmin)).text();
  dire("pas de bloc 'Mes demandes' sur un compte d'equipe",
       !profilEquipe.includes("Mes demandes"));
  dire("pas de bouton vers /publier-annonce",
       !profilEquipe.includes("/publier-annonce"));
  dire("un lien vers l'espace equipe le remplace",
       profilEquipe.includes('href="/admin"'));

  // 2. La regle tient SANS le bouton : on appelle les adresses a la main.
  const formulaireInterdit = await lire("/publier-annonce", cookieAdmin);
  dire("le formulaire de publication repond 403", formulaireInterdit.status === 403,
       String(formulaireInterdit.status));

  const avant = base.prepare("SELECT COUNT(*) n FROM annonces").get().n;
  const envoiInterdit = await poster("/annonces", form({
    titre: M + " annonce interdite", metier: "menage",
    arrondissement: "Yaounde 1", quartier: "Bastos", horaire: "Lundi matin", tarif: "10000", prix: "10000" }), cookieAdmin);
  dire("l'envoi direct du formulaire repond 403", envoiInterdit.code === 403, String(envoiInterdit.code));
  dire("aucune annonce n'a ete creee",
       base.prepare("SELECT COUNT(*) n FROM annonces").get().n === avant);

  // 3. Un employeur ordinaire, lui, publie toujours.
  const mailVrai = M + "-employeur@example.com";
  const cookieVrai = await creerCompte(mailVrai, "employeur");
  base.prepare("UPDATE utilisateurs SET statut_verification = 'verifie' WHERE email = ?").run(mailVrai);
  dire("un employeur ordinaire atteint le formulaire",
       (await lire("/publier-annonce", cookieVrai)).status === 200);
  const profilVrai = await (await lire("/mon-profil", cookieVrai)).text();
  dire("et il voit toujours 'Mes demandes'", profilVrai.includes("Mes demandes"));

  console.log("\n--- LES MOTS DE LA BASE NE SORTENT PAS A L'ECRAN ---");

  const MOTS = ["en tant que employeur", "en tant que prestataire",
                "en tant qu'employeur", "en tant qu'prestataire"];
  for (const [mail, qui] of [[mailAdmin, "equipe"], [mailVrai, "employeur"], [mailPres, "prestataire"]]) {
    const page = (await poster("/connexion", form({ email: mail, motdepasse: "motdepasse123" }))).corps;
    dire("connexion (" + qui + ") : aucun mot de la colonne role",
         !MOTS.some((m) => page.includes(m)) && !page.includes("Connexion réussie en tant que"));
  }

  // Chaque compte est envoye la ou il a quelque chose a faire.
  const accueilEquipe = (await poster("/connexion", form({ email: mailAdmin, motdepasse: "motdepasse123" }))).corps;
  dire("l'equipe est envoyee vers l'espace equipe", accueilEquipe.includes('href="/admin"'));
  const accueilPres = (await poster("/connexion", form({ email: mailPres, motdepasse: "motdepasse123" }))).corps;
  dire("le prestataire est envoye vers les annonces", accueilPres.includes('href="/annonces"'));

  console.log("\n--- L'ESPACE EQUIPE EST INVISIBLE POUR LES AUTRES ---");

  const visiteur = await (await lire("/")).text();
  dire("un visiteur non connecte ne voit aucun lien vers /admin",
       !visiteur.includes('href="/admin"'));
  const employeurAccueil = await (await lire("/", cookieVrai)).text();
  dire("un employeur connecte non plus", !employeurAccueil.includes('href="/admin"'));
  const presAccueil = await (await lire("/", cookiePres)).text();
  dire("un prestataire connecte non plus", !presAccueil.includes('href="/admin"'));

  // Et le lien absent n'est pas une protection : on tape l'adresse a la main.
  dire("/admin en tapant l'adresse : 403 pour un employeur",
       (await lire("/admin", cookieVrai)).status === 403);
  dire("/admin sans etre connecte : renvoi vers la connexion",
       (await lire("/admin")).status === 302);
  dire("un document d'identite n'est pas lisible par un employeur",
       (await lire("/admin/document/1/cni", cookieVrai)).status === 403);

  // Le compte d'equipe n'apparait pas non plus dans la recherche.
  const listePublique = await (await lire("/recherche")).text();
  dire("le compte d'equipe n'apparait pas dans la recherche",
       !listePublique.includes(mailAdmin) && !listePublique.includes("Adm "));

  console.log("\n--- L'EQUIPE N'A NI QUARTIER NI POSITION ---");
  const profilEquipe2 = await (await lire("/mon-profil", cookieAdmin)).text();
  dire("aucune ligne d'adresse sur son profil",
       !profilEquipe2.includes('nom: "lieu"') && !profilEquipe2.includes("Yaounde 1"));
  const formEquipe = await (await lire("/mon-profil/modifier", cookieAdmin)).text();
  dire("le formulaire ne demande pas l'arrondissement", !formEquipe.includes('name="arrondissement"'));
  dire("ni le quartier", !formEquipe.includes('name="quartier"'));
  dire("ni la position GPS", !formEquipe.includes("navigator.geolocation"));
  dire("mais il peut toujours changer son mot de passe", formEquipe.includes('name="ancien"'));
  dire("et son adresse email", formEquipe.includes('name="nouveau"'));

  const formEmployeur = await (await lire("/mon-profil/modifier", cookieVrai)).text();
  dire("un employeur, lui, garde arrondissement et quartier",
       formEmployeur.includes('name="arrondissement"') && formEmployeur.includes('name="quartier"'));

  console.log("\n--- NETTOYAGE ---");
  for (const mail of [mailAdmin, mailPres, mailRefus, mailVrai]) {
    const u = qui(mail);
    if (u) [u.cni_fichier, u.casier_fichier, u.photo_envoyee_fichier, u.photo_fichier].forEach((f) => {
      if (f && fs.existsSync(path.join(DOCS, f))) fs.unlinkSync(path.join(DOCS, f));
    });
  }
  const n = base.prepare("DELETE FROM utilisateurs WHERE email LIKE ?").run("%" + M + "%").changes;
  console.log("  " + n + " comptes de test supprimes");

  console.log("\nRESULTAT : " + ok + " reussis, " + ko + " echec(s)");
  process.exit(ko === 0 ? 0 : 1);
}, 500);
