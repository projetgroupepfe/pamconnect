const fs = require("fs");
const path = require("path");
const PROJET = require("path").join(__dirname, "..");
process.chdir(PROJET);
require(PROJET + "/_serveur_test_temporaire.js");

const base = require(PROJET + "/node_modules/better-sqlite3")(PROJET + "/data/pamconnect.db");
base.pragma("foreign_keys = ON");

const RACINE = "http://127.0.0.1:3999";
const DOCS = path.join(PROJET, "data", "documents");
const M = "test-verif";
let ok = 0, ko = 0;

const dire = (nom, cond, detail) => {
  if (cond) { ok++; console.log("  OK    | " + nom); }
  else { ko++; console.log("  ECHEC | " + nom + (detail ? "   -> " + detail : "")); }
};

async function poster(chemin, corps, cookie) {
  const entetes = {};
  if (cookie) entetes.Cookie = cookie;
  const r = await fetch(RACINE + chemin, { method: "POST", body: corps, headers: entetes, redirect: "manual" });
  return { code: r.status, corps: await r.text(), cookie: r.headers.getSetCookie()[0] };
}

function formulaire(objet) {
  return new URLSearchParams(objet);
}

function fichier(nom, octets, type) {
  return new File([new Uint8Array(octets)], nom, { type });
}

// Une photo avec une vraie en-tete JPEG : le serveur lit les premiers
// octets et refuse un fichier qui n'est une image que par son nom.
function photoJpeg(nom, octets) {
  const contenu = new Uint8Array(octets || 1500);
  contenu.set([0xff, 0xd8, 0xff, 0xe0]);
  return new File([contenu], nom || "visage.jpg", { type: "image/jpeg" });
}

setTimeout(async () => {
  const mdp = "motdepasse123";
  const mail = M + "@example.com";

  await poster("/inscription", formulaire({
    role: "prestataire", nom: "Verif Test", email: mail, motdepasse: mdp,
    arrondissement: "Yaounde 1", metier: "MetierVerif", tarif: "10000",
  }));
  const connexion = await poster("/connexion", formulaire({ email: mail, motdepasse: mdp }));
  const cookie = connexion.cookie.split(";")[0];
  const moi = () => base.prepare("SELECT * FROM utilisateurs WHERE email = ?").get(mail);

  console.log("\n--- 1. Etat de depart ---");
  dire("statut initial = 'non soumis'", moi().statut_verification === "non soumis", moi().statut_verification);
  const page = await fetch(RACINE + "/verification", { headers: { Cookie: cookie } });
  dire("la page /verification s'affiche", page.status === 200);

  console.log("\n--- 2. Envois refuses ---");
  const fichiersAvant = fs.readdirSync(DOCS).length;

  const f1 = new FormData();
  f1.append("cni", fichier("cni.jpg", 1000, "image/jpeg"));
  const seul = await poster("/verification", f1, cookie);
  dire("un seul document sur deux -> refuse", seul.code === 400, "code " + seul.code);
  dire("le message est clair", seul.corps.includes("Trois envois sont nécessaires"));

  const f2 = new FormData();
  f2.append("cni", fichier("virus.exe", 1000, "application/octet-stream"));
  f2.append("casier", fichier("casier.pdf", 1000, "application/pdf"));
  const exe = await poster("/verification", f2, cookie);
  dire("fichier .exe -> refuse", exe.code === 400 && exe.corps.includes("Format"), "code " + exe.code);

  const f3 = new FormData();
  f3.append("cni", fichier("enorme.jpg", 6 * 1024 * 1024, "image/jpeg"));
  f3.append("casier", fichier("casier.pdf", 1000, "application/pdf"));
  const gros = await poster("/verification", f3, cookie);
  dire("fichier de 6 Mo -> refuse", gros.code === 400 && gros.corps.includes("volumineux"), "code " + gros.code);

  // LA PHOTO DU VISAGE est obligatoire, et c'est une image.
  const sansPhoto = new FormData();
  sansPhoto.append("cni", fichier("cni.jpg", 1000, "image/jpeg"));
  sansPhoto.append("casier", fichier("casier.pdf", 1000, "application/pdf"));
  const rSansPhoto = await poster("/verification", sansPhoto, cookie);
  dire("sans photo -> refuse", rSansPhoto.code === 400 && rSansPhoto.corps.includes("une photo de votre visage"),
       "code " + rSansPhoto.code);

  const photoPdf = new FormData();
  photoPdf.append("cni", fichier("cni.jpg", 1000, "image/jpeg"));
  photoPdf.append("casier", fichier("casier.pdf", 1000, "application/pdf"));
  photoPdf.append("photo", fichier("visage.pdf", 1000, "application/pdf"));
  const rPhotoPdf = await poster("/verification", photoPdf, cookie);
  dire("une photo en PDF -> refusee",
       rPhotoPdf.code === 400 && rPhotoPdf.corps.includes("La photo de votre visage doit être au format JPEG ou PNG."),
       "code " + rPhotoPdf.code);

  const photoDeguisee = new FormData();
  photoDeguisee.append("cni", fichier("cni.jpg", 1000, "image/jpeg"));
  photoDeguisee.append("casier", fichier("casier.pdf", 1000, "application/pdf"));
  photoDeguisee.append("photo", fichier("pas-une-image.jpg", 1000, "image/jpeg"));
  const rDeguisee = await poster("/verification", photoDeguisee, cookie);
  dire("un fichier nomme .jpg qui n'est pas une image -> refuse",
       rDeguisee.code === 400 && rDeguisee.corps.includes("au format JPEG ou PNG"), "code " + rDeguisee.code);

  dire("aucun fichier orphelin laisse sur le disque",
       fs.readdirSync(DOCS).length === fichiersAvant,
       fs.readdirSync(DOCS).length + " fichiers au lieu de " + fichiersAvant);
  dire("le statut n'a pas bouge", moi().statut_verification === "non soumis");

  console.log("\n--- 3. Envoi valide ---");
  const f4 = new FormData();
  f4.append("cni", fichier("ma-cni.jpg", 2000, "image/jpeg"));
  f4.append("casier", fichier("mon-casier.pdf", 3000, "application/pdf"));
  f4.append("photo", photoJpeg("mon-visage.jpg"));
  const envoi = await poster("/verification", f4, cookie);
  dire("les deux documents sont acceptes", envoi.code === 200 && envoi.corps.includes("Documents envoyés"), "code " + envoi.code);

  const apres = moi();
  dire("statut passe a 'en attente'", apres.statut_verification === "en attente", apres.statut_verification);
  dire("le nom de la CNI est enregistre", !!apres.cni_fichier);
  dire("le nom du casier est enregistre", !!apres.casier_fichier);
  dire("le nom d'origine n'est PAS reutilise",
       apres.cni_fichier !== "ma-cni.jpg" && /^[0-9a-f]{32}\.jpg$/.test(apres.cni_fichier),
       apres.cni_fichier);
  dire("les fichiers sont bien sur le disque",
       fs.existsSync(path.join(DOCS, apres.cni_fichier)) && fs.existsSync(path.join(DOCS, apres.casier_fichier)));
  dire("la photo attend le controle, sous un nom tire au hasard",
       /^[0-9a-f]{32}\.jpg$/.test(String(apres.photo_envoyee_fichier)) && apres.photo_fichier === null &&
       fs.existsSync(path.join(DOCS, apres.photo_envoyee_fichier)), String(apres.photo_envoyee_fichier));

  console.log("\n--- 4. LE TEST DE SECURITE : les documents sont-ils telechargeables ? ---");
  for (const adresse of [
    "/documents/" + apres.cni_fichier,
    "/data/documents/" + apres.cni_fichier,
    "/" + apres.cni_fichier,
    "/../data/documents/" + apres.cni_fichier,
    "/documents/" + apres.photo_envoyee_fichier,
    "/" + apres.photo_envoyee_fichier,
  ]) {
    const r = await fetch(RACINE + adresse);
    dire("inaccessible : " + adresse, r.status === 404, "code " + r.status);
  }

  console.log("\n--- 5. Un employeur ne peut pas envoyer de documents ---");
  const mailEmp = M + "-emp@example.com";
  await poster("/inscription", formulaire({
    role: "employeur", nom: "Emp", email: mailEmp, motdepasse: mdp, arrondissement: "Yaounde 1",
  }));
  const coEmp = await poster("/connexion", formulaire({ email: mailEmp, motdepasse: mdp }));
  const rEmp = await fetch(RACINE + "/verification", { headers: { Cookie: coEmp.cookie.split(";")[0] } });
  // LA REGLE A CHANGE : la verification concerne les deux cotes. Un
  // employeur fait entrer quelqu'un chez lui, mais la personne qui vient
  // entre chez un inconnu, seule - la protection ne va pas dans un seul sens.
  dire("un employeur y accede aussi maintenant", rEmp.status === 200, "code " + rEmp.status);

  console.log("\n--- L'ECRAN DE REPONSE NE SE CONTREDIT PAS ---");
  // Le badge et la phrase parlent de la meme chose. S'ils divergent, la
  // personne lit "PamConnect a controle son casier" sous un badge qui dit
  // le contraire - et c'est la fausse affirmation qu'elle retient.
  const cEmp = coEmp.cookie.split(";")[0];
  const idEmp = base.prepare("SELECT id FROM utilisateurs WHERE email = ?").get(mailEmp).id;

  base.prepare("UPDATE utilisateurs SET statut_verification = 'verifie' WHERE id = ?").run(idEmp);
  await poster("/annonces", formulaire({ titre: M + " demande", metier: "menagere",
    quartier: "Mvan", horaire: "Lundi 8h", prix: "10000" }), cEmp);
  const ann = base.prepare("SELECT id FROM annonces WHERE employeur_id = ? ORDER BY id DESC LIMIT 1").get(idEmp);

  // La personne qui repond doit etre verifiee pour voir cet ecran.
  base.prepare("UPDATE utilisateurs SET statut_verification = 'verifie' WHERE email = ?").run(mail);
  const lireRepondre = async () =>
    (await (await fetch(RACINE + "/candidatures/nouvelle/" + ann.id,
      { headers: { Cookie: cookie } })).text());

  const vu = await lireRepondre();
  dire("employeur verifie : le badge le dit", vu.includes("Identité et casier vérifiés"));
  dire("employeur verifie : la phrase le confirme", vu.includes("a contrôlé sa"));

  base.prepare("UPDATE utilisateurs SET statut_verification = 'non soumis' WHERE id = ?").run(idEmp);
  const pasVu = await lireRepondre();
  dire("employeur non verifie : le badge le dit", pasVu.includes("Identité non vérifiée"));
  dire("employeur non verifie : la phrase ne pretend plus le contraire",
       !pasVu.includes("a contrôlé sa"));
  dire("et elle laisse la personne decider", pasVu.includes("À vous de décider"));

  const anon = await fetch(RACINE + "/verification", { redirect: "manual" });
  dire("visiteur non connecte -> redirige", anon.status === 302, "code " + anon.status);

  console.log("\n--- LE DELAI DE 24 HEURES ---");
  // Un delai annonce engage l'equipe et rassure celui qui attend. Sans
  // date d'envoi enregistree, ce ne serait qu'une phrase.
  const lire = (chemin, ck) =>
    fetch(RACINE + chemin, { headers: ck ? { Cookie: ck } : {} });

  // Les series precedentes ont valide puis refuse ce dossier. On le
  // remet en attente : c'est l'etat dont parle le delai.
  const remettreEnAttente = (decalage) =>
    base.prepare("UPDATE utilisateurs SET statut_verification = 'en attente', "
      + "documents_envoyes_le = " + decalage + " WHERE email = ?").run(mail);

  remettreEnAttente("datetime('now', '-2 hours')");
  dire("l'envoi est horodate", typeof moi().documents_envoyes_le === "string");

  const pageAttente = await (await lire("/verification", cookie)).text();
  dire("la page dit depuis quand le dossier attend",
       pageAttente.includes("il y a 2 heures"));
  dire("et combien de temps il reste", pageAttente.includes("22 heures"));

  const profilAttente = await (await lire("/mon-profil", cookie)).text();
  dire("le profil aussi", profilAttente.includes("Réponse attendue"));

  // Passe le delai, l'ecran doit le dire plutot que d'annoncer un temps
  // restant qui n'existe plus.
  remettreEnAttente("datetime('now', '-49 hours')");
  const pageDepassee = await (await lire("/verification", cookie)).text();
  dire("passe 24 h, l'ecran l'annonce", pageDepassee.includes("est dépassé"));
  dire("et ne promet plus de temps restant", !pageDepassee.includes("Réponse attendue"));
  dire("il dit que le dossier n'est pas perdu", pageDepassee.includes("pas été perdu"));

  // Une date inconnue - un dossier depose avant l'existence de cette
  // colonne - ne doit pas produire une date inventee.
  remettreEnAttente("NULL");
  // La phrase vient maintenant du serveur : EJS ecrit son apostrophe
  // &#39; dans la page, que le navigateur affiche comme une apostrophe.
  const pageSansDate = await (await lire("/verification", cookie)).text();
  dire("une date inconnue est annoncee comme telle",
       pageSansDate.replace(/&#39;/g, "'").includes("n'a pas été enregistrée"));
  dire("et le delai reste annonce", pageSansDate.includes("24 heures"));

  console.log("\n--- CE QUE L'EQUIPE VOIT ---");
  // La base contient de vrais dossiers en attente. On ne lit donc que la
  // carte de NOTRE dossier, jamais la page entiere : sinon un dossier
  // etranger ferait passer le test a notre place.
  const carteDe = (page) => {
    const i = page.indexOf(mail);
    if (i < 0) return "";
    const suivant = page.indexOf("<h3>", i);
    return page.slice(i, suivant < 0 ? page.length : suivant);
  };

  const mailEq = M + "-eq@example.com";
  await poster("/inscription", formulaire({
    role: "employeur", nom: "Equipe Test", email: mailEq, motdepasse: mdp, quartier: "Bastos",
  }));
  const coEq = await poster("/connexion", formulaire({ email: mailEq, motdepasse: mdp }));
  const cEq = coEq.cookie.split(";")[0];
  base.prepare("UPDATE utilisateurs SET est_admin = 1 WHERE email = ?").run(mailEq);

  const carteSansDate = carteDe(await (await lire("/admin", cEq)).text());
  dire("notre dossier figure bien dans la liste de l'equipe", carteSansDate.length > 0);
  dire("l'equipe voit qu'une date manque", carteSansDate.includes("Date d'envoi inconnue"));

  remettreEnAttente("datetime('now', '-2 hours')");
  const carteRecente = carteDe(await (await lire("/admin", cEq)).text());
  dire("elle voit depuis quand le dossier attend", carteRecente.includes("il y a 2 heures"));
  dire("et combien d'heures il lui reste", carteRecente.includes("22 h restantes"));

  remettreEnAttente("datetime('now', '-30 hours')");
  const carteDepassee = carteDe(await (await lire("/admin", cEq)).text());
  dire("un dossier en retard est signale a l'equipe", carteDepassee.includes("Délai dépassé"));

  console.log("\n--- LA VERIFICATION DEPUIS L'APPLICATION ---");
  const jetonDe = async (adresse) => (await (await fetch(RACINE + "/api/connexion", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: adresse, motdepasse: mdp }),
  })).json()).jeton;
  const parJeton = (jeton) => ({ Authorization: "Bearer " + jeton });
  const ecranApi = async (entetes) => {
    const r = await fetch(RACINE + "/api/verification", { headers: entetes || {} });
    return { code: r.status, donnees: await r.json().catch(() => null) };
  };
  const envoyerApi = async (envoi, entetes) => {
    const r = await fetch(RACINE + "/api/verification", { method: "POST", body: envoi, headers: entetes || {} });
    return { code: r.status, donnees: await r.json().catch(() => null) };
  };
  const dossierComplet = (cniNom, casierNom) => {
    const envoi = new FormData();
    envoi.append("cni", fichier(cniNom, 2000, "image/jpeg"));
    envoi.append("casier", fichier(casierNom, 3000, "application/pdf"));
    envoi.append("photo", photoJpeg());
    return envoi;
  };
  const jetonPre = await jetonDe(mail);
  const jetonEmp = await jetonDe(mailEmp);
  const employeurTest = () => base.prepare("SELECT * FROM utilisateurs WHERE email = ?").get(mailEmp);

  dire("sans session : 401", (await ecranApi()).code === 401);
  dire("un compte d'equipe : 403", (await ecranApi({ Cookie: cEq })).code === 403);

  remettreEnAttente("datetime('now', '-2 hours')");
  const ecranPre = (await ecranApi(parJeton(jetonPre))).donnees;
  const pageSite = await (await lire("/verification", cookie)).text();
  dire("en attente : la meme phrase et les memes mots en gras que la page du site",
       ecranPre.statut === "en attente" && ecranPre.libelle === "Vérification en cours" &&
       ecranPre.attente.morceaux.map((m) => m.texte).join("") === "Envoyé il y a 2 heures. Réponse attendue d'ici 22 heures." &&
       ecranPre.attente.morceaux.filter((m) => m.gras).map((m) => m.texte).join("|") === "il y a 2 heures|22 heures" &&
       pageSite.includes("<strong>il y a 2 heures</strong>") && pageSite.includes("<strong>22 heures</strong>") &&
       ecranPre.remplaceUnDossier === true, JSON.stringify(ecranPre.attente));
  dire("les formats et la taille viennent du serveur",
       JSON.stringify(ecranPre.extensions) === JSON.stringify([".jpg", ".jpeg", ".png", ".pdf"]) &&
       ecranPre.tailleMaxMo === 5 && pageSite.includes('accept=".jpg,.jpeg,.png,.pdf"'));
  dire("la photo n'accepte que des images, sur les deux ecrans",
       JSON.stringify(ecranPre.extensionsPhoto) === JSON.stringify([".jpg", ".jpeg", ".png"]) &&
       pageSite.includes('name="photo" accept=".jpg,.jpeg,.png"') &&
       pageSite.includes("Une photo de votre visage"));

  const ecranEmp = (await ecranApi(parJeton(jetonEmp))).donnees;
  dire("chacun lit sa raison de donner ses documents",
       ecranEmp.chapeau.startsWith("Les personnes qui vous répondront") &&
       ecranPre.chapeau.startsWith("Les employeurs confient") && ecranEmp.attente === null);
  dire("et chacun sait qu'une photo est demandee",
       ecranEmp.chapeau.endsWith("deux documents et une photo sont demandés.") &&
       ecranPre.chapeau.endsWith("deux documents et une photo sont demandés."));

  const profilEmp = await (await fetch(RACINE + "/api/mon-profil", { headers: parJeton(jetonEmp) })).json();
  const pageProfilEmp = await (await lire("/mon-profil", cEmp)).text();
  dire("un employeur trouve aussi le bouton sur son profil, site et application",
       profilEmp.boutonVerification === "Faire vérifier mon identité" &&
       pageProfilEmp.includes("Faire vérifier mon identité"), JSON.stringify(profilEmp.boutonVerification));

  const fichiersAvantApi = fs.readdirSync(DOCS).length;
  const seulApi = new FormData();
  seulApi.append("cni", fichier("cni.jpg", 1000, "image/jpeg"));
  const refusApi = await envoyerApi(seulApi, parJeton(jetonEmp));
  dire("un seul document : 400, avec la phrase du site, sans fichier laisse",
       refusApi.code === 400 &&
       refusApi.donnees.erreur === "Il faut envoyer la pièce d'identité, l'extrait de casier judiciaire ET une photo de votre visage." &&
       fs.readdirSync(DOCS).length === fichiersAvantApi, JSON.stringify(refusApi.donnees));

  const accepteApi = await envoyerApi(dossierComplet("photo-cni.jpg", "casier.pdf"), parJeton(jetonEmp));
  dire("les deux documents par le jeton de l'application : le dossier part en examen",
       accepteApi.code === 200 && accepteApi.donnees.texte.startsWith("Votre dossier est arrivé.") &&
       employeurTest().statut_verification === "en attente" &&
       fs.existsSync(path.join(DOCS, employeurTest().cni_fichier)) &&
       fs.existsSync(path.join(DOCS, employeurTest().casier_fichier)), JSON.stringify(accepteApi.donnees));

  const ancienPre = moi();
  const remplace = await envoyerApi(dossierComplet("nouvelle-cni.jpg", "nouveau-casier.pdf"), parJeton(jetonPre));
  dire("un nouvel envoi remplace le dossier en examen et efface les anciens fichiers",
       remplace.code === 200 && moi().cni_fichier !== ancienPre.cni_fichier &&
       !fs.existsSync(path.join(DOCS, ancienPre.cni_fichier)) &&
       fs.existsSync(path.join(DOCS, moi().cni_fichier)), JSON.stringify(remplace.donnees));

  base.prepare("UPDATE utilisateurs SET statut_verification = 'verifie' WHERE email = ?").run(mailEmp);
  dire("deja verifie : 409",
       (await envoyerApi(dossierComplet("cni.jpg", "casier.pdf"), parJeton(jetonEmp))).code === 409);
  const ecranValide = (await ecranApi(parJeton(jetonEmp))).donnees;
  const pageValide = await (await lire("/verification", cEmp)).text();
  dire("une fois valide, l'employeur est renvoye vers ses demandes, sur le site aussi",
       ecranValide.verifiee === true && ecranValide.suite.url === "/mes-demandes" &&
       pageValide.includes('href="/mes-demandes">Voir mes demandes'));

  console.log("\n--- NETTOYAGE ---");
  base.prepare("SELECT cni_fichier, casier_fichier, photo_envoyee_fichier, photo_fichier FROM utilisateurs WHERE email LIKE ?")
    .all("%" + M + "%")
    .flatMap((compte) => [compte.cni_fichier, compte.casier_fichier, compte.photo_envoyee_fichier, compte.photo_fichier])
    .forEach((f) => {
      if (f && fs.existsSync(path.join(DOCS, f))) fs.unlinkSync(path.join(DOCS, f));
    });
  const n = base.prepare("DELETE FROM utilisateurs WHERE email LIKE ?").run("%" + M + "%").changes;
  console.log("  " + n + " comptes et leurs documents supprimes");

  console.log("\nRESULTAT : " + ok + " reussis, " + ko + " echec(s)");
  process.exit(ko === 0 ? 0 : 1);
}, 500);
