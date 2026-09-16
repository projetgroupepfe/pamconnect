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

// Un envoi de l'ecran Ajouter ma photo : la photo et la piece d'identite.
function envoiPhoto(options) {
  const envoi = new FormData();
  const o = options || {};
  if (o.photo !== false) {
    const contenu = new Uint8Array(o.octets || 1500);
    if (!o.deguisee) contenu.set([0xff, 0xd8, 0xff, 0xe0]);
    envoi.append("photo", new File([contenu], o.nomPhoto || "visage.jpg", { type: "image/jpeg" }));
  }
  if (o.piece !== false) {
    envoi.append("cni", new File([new Uint8Array(900)], "piece.pdf", { type: "application/pdf" }));
  }
  return envoi;
}

const ligne = (personne) => base.prepare("SELECT * FROM utilisateurs WHERE id = ?").get(personne.id);
const surLeDisque = (nom) => Boolean(nom) && fs.existsSync(path.join(DOCS, nom));
// EJS ecrit &#39; pour une apostrophe venue du serveur : on la decode.
const uneLigne = (texte) => texte.replace(/\s+/g, " ").replace(/&#39;/g, "'");

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

  console.log(SAUT + "--- MA PHOTO : SEULEMENT UNE FOIS VERIFIEE ---");
  const pasVerifiee = await creerCompte("pasverifiee", "prestataire", { metier: "menagere", tarif: "15000" });
  base.prepare("UPDATE utilisateurs SET statut_verification = 'non soumis' WHERE id = ?").run(pasVerifiee.id);
  const fichiersAvant = fs.readdirSync(DOCS).length;
  dire("la page lui est fermee", (await lire("/mon-profil/photo", cookieDe(pasVerifiee.cookie))).code === 403);
  const envoiRefuse = await poster("/mon-profil/photo", envoiPhoto(), pasVerifiee.cookie);
  dire("l'envoi aussi, sans fichier laisse",
       envoiRefuse.code === 403 && fs.readdirSync(DOCS).length === fichiersAvant, "code " + envoiRefuse.code);
  const profilPasVerifiee = await lire("/mon-profil", cookieDe(pasVerifiee.cookie));
  dire("et son profil ne montre pas la carte", !profilPasVerifiee.texte.includes("Ma photo"));

  console.log(SAUT + "--- MA PHOTO : L'AJOUTER ---");
  const profilSans = uneLigne((await lire("/mon-profil", cookieDe(inconnue.cookie))).texte);
  dire("sans photo, la carte invite a en ajouter une",
       profilSans.includes("Ajoutez une photo de votre visage : la personne avec qui vous travaillerez pourra vous reconnaître le jour du service.") &&
       profilSans.includes("Ajouter ma photo") && !profilSans.includes("Retirer ma photo"));
  const pageAjout = uneLigne((await lire("/mon-profil/photo", cookieDe(inconnue.cookie))).texte);
  dire("la page dit ce qui est envoye et ce qui est garde",
       pageAjout.includes("<h1>Ajouter ma photo</h1>") &&
       pageAjout.includes("L'équipe vérifie que c'est bien vous, puis supprime la pièce d'identité : seule la photo est gardée.") &&
       pageAjout.includes("Ma photo") && pageAjout.includes("Ma pièce d'identité"));

  const avantRefus = fs.readdirSync(DOCS).length;
  const sansPiece = await poster("/mon-profil/photo", envoiPhoto({ piece: false }), inconnue.cookie);
  dire("sans piece d'identite : refuse", sansPiece.code === 400 && sansPiece.texte.includes("Deux envois sont nécessaires"));
  const enPdf = await poster("/mon-profil/photo", envoiPhoto({ nomPhoto: "visage.pdf" }), inconnue.cookie);
  dire("une photo en PDF : refusee", enPdf.code === 400 && enPdf.texte.includes("au format JPEG ou PNG"));
  const deguisee = await poster("/mon-profil/photo", envoiPhoto({ deguisee: true }), inconnue.cookie);
  dire("un faux JPEG : refuse", deguisee.code === 400 && deguisee.texte.includes("au format JPEG ou PNG"));
  dire("aucun fichier laisse par ces refus", fs.readdirSync(DOCS).length === avantRefus);

  const ajout = await poster("/mon-profil/photo", envoiPhoto(), inconnue.cookie);
  dire("la photo et la piece partent", ajout.code === 200 && ajout.texte.includes("Photo envoyée"), "code " + ajout.code);
  const enAttente = ligne(inconnue);
  dire("elles attendent sur le disque", surLeDisque(enAttente.photo_envoyee_fichier) && surLeDisque(enAttente.photo_piece_fichier));
  dire("le profil dit que la photo est controlee",
       uneLigne((await lire("/mon-profil", cookieDe(inconnue.cookie))).texte).includes("Votre photo est en cours de contrôle par l'équipe."));
  dire("et elle n'est encore visible par personne", (await photo(inconnue, cookieDe(inconnue.cookie))).code === 404);

  console.log(SAUT + "--- L'EQUIPE CONTROLE ---");
  const espace = uneLigne((await lire("/admin", cookieDe(eq.cookie))).texte);
  dire("la photo attend dans l'espace equipe",
       espace.includes("Photos à contrôler") && espace.includes(inconnue.nom) &&
       espace.includes('href="/admin/photo/' + inconnue.id + '/photo"') &&
       espace.includes('href="/admin/photo/' + inconnue.id + '/piece"'));
  const ouverte = await lire("/admin/photo/" + inconnue.id + "/photo", cookieDe(eq.cookie));
  dire("l'equipe ouvre la photo", ouverte.code === 200 && ouverte.entetes.get("x-content-type-options") === "nosniff");
  dire("et la piece", (await lire("/admin/photo/" + inconnue.id + "/piece", cookieDe(eq.cookie))).code === 200);
  dire("personne d'autre", (await lire("/admin/photo/" + inconnue.id + "/piece", cookieDe(inconnue.cookie))).code === 403);

  await poster("/admin/photos", form({ utilisateurId: String(inconnue.id), decision: "refuser",
    motif: "le visage n'est pas visible" }), eq.cookie);
  const apresRefus = ligne(inconnue);
  dire("refusee : la photo et la piece sont supprimees",
       apresRefus.photo_envoyee_fichier === null && apresRefus.photo_piece_fichier === null &&
       !surLeDisque(enAttente.photo_envoyee_fichier) && !surLeDisque(enAttente.photo_piece_fichier));
  const profilRefus = uneLigne((await lire("/mon-profil", cookieDe(inconnue.cookie))).texte);
  dire("la personne lit le motif",
       profilRefus.includes("Votre photo n&#39;a pas été acceptée : le visage n&#39;est pas visible.") ||
       profilRefus.includes("Votre photo n'a pas été acceptée : le visage n'est pas visible."));
  dire("et peut en envoyer une autre", profilRefus.includes("Envoyer une autre photo"));

  await poster("/mon-profil/photo", envoiPhoto(), inconnue.cookie);
  const deuxieme = ligne(inconnue);
  await poster("/admin/photos", form({ utilisateurId: String(inconnue.id), decision: "accepter" }), eq.cookie);
  const acceptee = ligne(inconnue);
  dire("acceptee : elle devient sa photo, la piece est supprimee",
       acceptee.photo_fichier === deuxieme.photo_envoyee_fichier && surLeDisque(acceptee.photo_fichier) &&
       !surLeDisque(deuxieme.photo_piece_fichier) && acceptee.photo_piece_fichier === null &&
       acceptee.photo_motif_refus === null);
  const profilAcceptee = uneLigne((await lire("/mon-profil", cookieDe(inconnue.cookie))).texte);
  dire("le profil la montre, avec qui peut la voir",
       profilAcceptee.includes('src="/photos/' + inconnue.id + "?v=") &&
       profilAcceptee.includes("Visible seulement par la personne avec qui vous travaillez, une fois le choix fait.") &&
       profilAcceptee.includes("Changer ma photo") && profilAcceptee.includes("Retirer ma photo") &&
       profilAcceptee.includes('data-question="Retirer votre photo ?"'));
  dire("l'espace equipe n'a plus rien a controler pour elle",
       !uneLigne((await lire("/admin", cookieDe(eq.cookie))).texte).includes('/admin/photo/' + inconnue.id + '/'));
  dire("une decision deja prise : 404",
       (await poster("/admin/photos", form({ utilisateurId: String(inconnue.id), decision: "accepter" }), eq.cookie)).code === 404);

  console.log(SAUT + "--- CHANGER DE PHOTO, PUIS LA RETIRER ---");
  const ancienne = ligne(elle).photo_fichier;
  await poster("/mon-profil/photo", envoiPhoto(), elle.cookie);
  dire("pendant le controle, l'ancienne photo reste visible pour l'employeur",
       ligne(elle).photo_fichier === ancienne && (await photo(elle, cookieDe(emp.cookie))).code === 200);
  dire("la page s'appelle Changer ma photo",
       (await lire("/mon-profil/photo", cookieDe(elle.cookie))).texte.includes("<h1>Changer ma photo</h1>"));
  await poster("/admin/photos", form({ utilisateurId: String(elle.id), decision: "accepter" }), eq.cookie);
  const nouvelle = ligne(elle).photo_fichier;
  dire("acceptee, la nouvelle remplace l'ancienne, effacee du disque",
       nouvelle !== ancienne && surLeDisque(nouvelle) && !surLeDisque(ancienne));
  dire("la discussion donne la nouvelle adresse",
       (await discussionApi(candElle, emp.cookie)).photoAutre === "/photos/" + elle.id + "?v=" + nouvelle.slice(0, 8));

  const retrait = await poster("/mon-profil/photo/retirer", new URLSearchParams(), elle.cookie);
  dire("elle retire sa photo", retrait.code === 302 && ligne(elle).photo_fichier === null && !surLeDisque(nouvelle));
  dire("l'employeur ne la voit plus", (await photo(elle, cookieDe(emp.cookie))).code === 404 &&
       (await discussionApi(candElle, emp.cookie)).photoAutre === null);
  dire("et sa carte l'invite de nouveau a en ajouter une",
       (await lire("/mon-profil", cookieDe(elle.cookie))).texte.includes("Ajouter ma photo"));

  console.log(SAUT + "--- MA PHOTO DEPUIS L'APPLICATION ---");
  const coElle = await fetch(RACINE + "/api/connexion", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: elle.mail, motdepasse: "motdepasse123" }) });
  const jetonElle = { Authorization: "Bearer " + (await coElle.json()).jeton };
  const profilApi = JSON.parse((await lire("/api/mon-profil", jetonElle)).texte);
  dire("le profil de l'application porte la meme carte",
       profilApi.photo && profilApi.photo.etat === "aucune" && profilApi.photo.bouton === "Ajouter ma photo" &&
       profilApi.photo.texte === "Ajoutez une photo de votre visage : la personne avec qui vous travaillerez pourra vous reconnaître le jour du service.");
  const ecranApi = JSON.parse((await lire("/api/mon-profil/photo", jetonElle)).texte);
  dire("l'ecran d'envoi aussi", ecranApi.titre === "Ajouter ma photo" &&
       JSON.stringify(ecranApi.extensionsPhoto) === JSON.stringify([".jpg", ".jpeg", ".png"]));
  const envoiApi = await fetch(RACINE + "/api/mon-profil/photo", { method: "POST", body: envoiPhoto(), headers: jetonElle });
  const envoiApiJson = await envoiApi.json();
  dire("l'application envoie la photo et la piece",
       envoiApi.status === 200 && envoiApiJson.texte === "Votre photo est en cours de contrôle par l'équipe.", JSON.stringify(envoiApiJson));
  const refusApi = await fetch(RACINE + "/api/mon-profil/photo", { method: "POST", body: envoiPhoto({ piece: false }), headers: jetonElle });
  dire("et recoit le meme refus en JSON",
       refusApi.status === 400 && (await refusApi.json()).erreur === "Il faut envoyer une photo de votre visage ET votre pièce d'identité.");
  const jetonPasVerifiee = { Authorization: "Bearer " + (await (await fetch(RACINE + "/api/connexion", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: pasVerifiee.mail, motdepasse: "motdepasse123" }) })).json()).jeton };
  const fermeApi = await fetch(RACINE + "/api/mon-profil/photo", { headers: jetonPasVerifiee });
  dire("une personne non verifiee : 403, avec le chemin de la verification",
       fermeApi.status === 403 && (await fermeApi.json()).verification === true);

  console.log(SAUT + "--- NETTOYAGE ---");
  base.prepare("SELECT photo_fichier, photo_envoyee_fichier, photo_piece_fichier FROM utilisateurs WHERE email LIKE ?").all("%" + M + "%")
    .flatMap((u) => [u.photo_fichier, u.photo_envoyee_fichier, u.photo_piece_fichier])
    .forEach((f) => { if (f && fs.existsSync(path.join(DOCS, f))) fs.unlinkSync(path.join(DOCS, f)); });
  const n = base.prepare("DELETE FROM utilisateurs WHERE email LIKE ?").run("%" + M + "%").changes;
  console.log("  " + n + " comptes de test supprimes, et leurs photos");

  console.log(SAUT + "RESULTAT : " + ok + " reussis, " + ko + " echec(s)");
  process.exit(ko === 0 ? 0 : 1);
}, 600);
