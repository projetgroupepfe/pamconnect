const http = require("http");
const fs = require("fs");
const path = require("path");
const querystring = require("querystring");
const crypto = require("crypto");

const PORT = 3000;
const FICHIER_UTILISATEURS = path.join(__dirname, "data", "utilisateurs.json");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

function lireUtilisateurs() {
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

      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });

      if (utilisateurTrouve && verifierMotDePasse(donnees.motdepasse, utilisateurTrouve.motdepasse)) {
        response.end(`<h1>Bienvenue ${utilisateurTrouve.nom} !</h1><p>Connexion réussie en tant que ${utilisateurTrouve.role}.</p><a href="/index.html">Retour à l'accueil</a>`);
      } else {
        response.end(`<h1>Connexion échouée</h1><p>Email ou mot de passe incorrect.</p><a href="/connexion.html">Réessayer</a>`);
      }
    });

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