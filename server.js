const http = require("http");
const fs = require("fs");
const path = require("path");
const querystring = require("querystring");
const crypto = require("crypto");

const PORT = 3000;
const FICHIER_UTILISATEURS = path.join(__dirname, "data", "utilisateurs.json");

const sessions = {};

function genererToken() {
  return crypto.randomBytes(32).toString("hex");
}

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

function lireUtilisateurs() {
  if (!fs.existsSync(FICHIER_UTILISATEURS)) {
    fs.writeFileSync(FICHIER_UTILISATEURS, "[]");
  }
  const contenu = fs.readFileSync(FICHIER_UTILISATEURS, "utf-8");
  return JSON.parse(contenu);
}

function sauvegarderUtilisateurs(utilisateurs) {
  fs.writeFileSync(FICHIER_UTILISATEURS, JSON.stringify(utilisateurs, null, 2));
}

function hacherMotDePasse(motDePasse) {
  const sel = crypto.randomBytes(16).toString("hex");
  const hache = crypto.scryptSync(motDePasse, sel, 64).toString("hex");
  return `${sel}:${hache}`;
}

function verifierMotDePasse(motDePasseSaisi, motDePasseHache) {
  const [sel, hache] = motDePasseHache.split(":");
  const hacheTest = crypto.scryptSync(motDePasseSaisi, sel, 64).toString("hex");
  return hache === hacheTest;
}

function trouverEmailConnecte(request) {
  const enteteCookie = request.headers.cookie || "";
  const paire = enteteCookie.split("; ").find((c) => c.startsWith("session="));
  if (!paire) return null;

  const token = paire.split("=")[1];
  return sessions[token] || null;
}

const server = http.createServer((request, response) => {
  if (request.method === "POST" && request.url === "/inscription") {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
    });

    request.on("end", () => {
      const donnees = querystring.parse(body);

      const nouvelUtilisateur = {
        id: Date.now(),
        role: donnees.role,
        nom: donnees.nom,
        email: donnees.email,
        motdepasse: hacherMotDePasse(donnees.motdepasse),
        arrondissement: donnees.arrondissement,
        quartier: donnees.quartier || null,
        metier: donnees.metier || null,
        tarif: donnees.tarif || null,
        latitude: donnees.latitude || null,
        longitude: donnees.longitude || null,
      };

      const utilisateurs = lireUtilisateurs();
      utilisateurs.push(nouvelUtilisateur);
      sauvegarderUtilisateurs(utilisateurs);

      console.log("Nouvel utilisateur enregistré :", nouvelUtilisateur);

      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(`<h1>Merci ${donnees.nom} !</h1><p>Ton inscription en tant que ${donnees.role} a bien été enregistrée.</p><a href="/index.html">Retour à l'accueil</a>`);
    });

    return;
  }

  if (request.method === "POST" && request.url === "/connexion") {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
    });

    request.on("end", () => {
      const donnees = querystring.parse(body);
      const utilisateurs = lireUtilisateurs();

      const utilisateurTrouve = utilisateurs.find((u) => u.email === donnees.email);

      if (utilisateurTrouve && verifierMotDePasse(donnees.motdepasse, utilisateurTrouve.motdepasse)) {
        const token = genererToken();
        sessions[token] = utilisateurTrouve.email;

        response.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Set-Cookie": `session=${token}; HttpOnly; Path=/`,
        });
        response.end(`<h1>Bienvenue ${utilisateurTrouve.nom} !</h1><p>Connexion réussie en tant que ${utilisateurTrouve.role}.</p><a href="/mon-profil">Voir mon profil</a>`);
      } else {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(`<h1>Connexion échouée</h1><p>Email ou mot de passe incorrect.</p><a href="/connexion.html">Réessayer</a>`);
      }
    });

    return;
  }

  if (request.method === "GET" && request.url === "/mon-profil") {
    const emailConnecte = trouverEmailConnecte(request);

    if (!emailConnecte) {
      response.writeHead(302, { "Location": "/connexion.html" });
      response.end();
      return;
    }

    const utilisateurs = lireUtilisateurs();
    const utilisateur = utilisateurs.find((u) => u.email === emailConnecte);

    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(`
      <!DOCTYPE html>
      <html lang="fr">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>PamConnect - Mon profil</title>
        <link rel="stylesheet" href="/style.css">
      </head>
      <body>
        <nav>
          <a href="/index.html">Accueil</a>
          <a href="/employeur.html">Espace employeur</a>
          <a href="/prestataire.html">Espace prestataire</a>
          <a href="/inscription.html">Inscription</a>
          <a href="/connexion.html">Connexion</a>
        </nav>
        <h1>Mon profil</h1>
        <p><strong>Nom :</strong> ${utilisateur.nom}</p>
        <p><strong>Email :</strong> ${utilisateur.email}</p>
        <p><strong>Rôle :</strong> ${utilisateur.role}</p>
        <p><strong>Arrondissement :</strong> ${utilisateur.arrondissement}</p>
        <p><strong>Quartier :</strong> ${utilisateur.quartier || "Non renseigné"}</p>
        <p><strong>Métier :</strong> ${utilisateur.metier || "Non renseigné"}</p>
        <p><strong>Tarif :</strong> ${utilisateur.tarif || "Non renseigné"}</p>
      </body>
      </html>
    `);
    return;
  }

  let requestedPath = request.url === "/" ? "/index.html" : request.url;
  const filePath = path.join(__dirname, "public", requestedPath);
  const extension = path.extname(filePath);
  const contentType = MIME_TYPES[extension] || "text/plain";

  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      response.end("<h1>404 - Page introuvable</h1>");
      return;
    }
    response.writeHead(200, { "Content-Type": contentType });
    response.end(content);
  });
});

server.listen(PORT, () => {
  console.log(`Serveur PamConnect démarré : http://localhost:${PORT}`);
});