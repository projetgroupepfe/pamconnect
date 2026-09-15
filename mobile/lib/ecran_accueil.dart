import 'package:flutter/material.dart';

import 'api.dart';
import 'elements.dart';
import 'modeles.dart';
import 'theme.dart';

// Sur le site, ces boutons ouvrent la recherche, les demandes ou l'envoi
// des documents sans compte. L'application demande d'abord de se
// connecter : elle ramene a la connexion en disant pourquoi.
const _pourChercher = "Pour chercher quelqu'un, connectez-vous ou créez un compte.";
const _pourPublier = 'Pour publier une demande, connectez-vous ou créez un compte.';
const _pourDocuments = 'Pour envoyer vos documents, connectez-vous ou créez un compte.';
const _pourDemandes = 'Pour voir les demandes, connectez-vous ou créez un compte.';

const _gras = TextStyle(fontWeight: FontWeight.w700);

/// L'accueil du site, avant tout compte, avec ses deux pages : Vous
/// cherchez quelqu'un et Vous proposez vos services.
///
/// Les textes sont ceux des pages du site. Seuls les chiffres viennent du
/// serveur : la commission et l'exemple de calcul.
class EcranAccueil extends StatefulWidget {
  const EcranAccueil({
    super.key,
    required this.api,
    required this.seConnecter,
    required this.proposerSesServices,
  });

  final ApiPamConnect api;

  /// Ramene a la connexion, avec la phrase qui dit pourquoi.
  final void Function(String message) seConnecter;

  /// Ouvre Creer un compte sur le choix "Proposer mes services".
  final VoidCallback proposerSesServices;

  @override
  State<EcranAccueil> createState() => _EcranAccueilState();
}

class _EcranAccueilState extends State<EcranAccueil> {
  Presentation? _presentation;
  String? _erreur;

  @override
  void initState() {
    super.initState();
    _charger();
  }

  Future<void> _charger() async {
    try {
      final presentation = await widget.api.presentation();
      if (!mounted) return;
      setState(() => _presentation = presentation);
    } on ErreurApi catch (erreur) {
      if (!mounted) return;
      setState(() => _erreur = erreur.message);
    }
  }

  void _reessayer() {
    setState(() => _erreur = null);
    _charger();
  }

  @override
  Widget build(BuildContext context) {
    final erreur = _erreur;
    final presentation = _presentation;

    return Scaffold(
      appBar: AppBar(title: const Text('Accueil')),
      body: SafeArea(
        child: erreur != null
            ? ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  Avertissement(texte: erreur),
                  const SizedBox(height: 16),
                  FilledButton(onPressed: _reessayer, child: const Text('Réessayer')),
                ],
              )
            : presentation == null
                ? const Center(child: CircularProgressIndicator())
                : _contenu(context, presentation),
      ),
    );
  }

  Widget _contenu(BuildContext context, Presentation presentation) {
    final texte = Theme.of(context).textTheme;
    final vousCherchez = EcranVousCherchez(seConnecter: widget.seConnecter);
    final vousProposez = EcranVousProposez(
      presentation: presentation,
      seConnecter: widget.seConnecter,
      proposerSesServices: widget.proposerSesServices,
    );
    void ouvrir(Widget page) => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => page));

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        const _TitrePage("Du personnel de maison dont l'identité a été vérifiée."),
        const SizedBox(height: 8),
        const _Chapeau(
          "Notre équipe contrôle la pièce d'identité et le casier judiciaire de chaque "
          "personne avant qu'un employeur puisse la retenir.",
        ),
        const SizedBox(height: 20),
        FilledButton.icon(
          onPressed: () => widget.seConnecter(_pourChercher),
          icon: const Icon(Icons.search),
          label: const Text("Chercher quelqu'un"),
        ),
        const SizedBox(height: 8),
        _BoutonSecondaire(texte: 'Proposer mes services', auClic: widget.proposerSesServices),
        const SizedBox(height: 16),
        const TitreSection('Comment ça marche'),
        const _Etape(
          numero: 1,
          titre: "L'employeur dit ce dont il a besoin",
          morceaux: [
            TextSpan(text: 'Le métier, le quartier, et surtout '),
            TextSpan(text: 'quand', style: _gras),
            TextSpan(text: " : le jour et l'heure."),
          ],
        ),
        const _Etape(
          numero: 2,
          titre: 'Les personnes vérifiées répondent',
          morceaux: [
            TextSpan(
              text: "Celles que l'horaire arrange se proposent. Une pastille verte indique "
                  'que nous avons contrôlé leurs papiers.',
            ),
          ],
        ),
        const _Etape(
          numero: 3,
          titre: "L'employeur choisit et confirme le service",
          morceaux: [
            TextSpan(
              text: "Le prix qu'il annonce est bloqué dès la publication. La personne le reçoit, "
                  'commission déduite, quand il déclare le service effectué.',
            ),
          ],
        ),
        const SizedBox(height: 16),
        // Le bandeau bleu du site, sous les etapes.
        Container(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
          decoration: BoxDecoration(color: Couleurs.bleuClair, borderRadius: BorderRadius.circular(10)),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Padding(
                padding: EdgeInsets.only(top: 2),
                child: Icon(Icons.payments_outlined, size: 18, color: Couleurs.bleu),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      "L'employeur paie le prix qu'il annonce, sans frais en plus. "
                      'PamConnect retient ${presentation.pourcentageCommission} % sur ce montant.',
                      style: texte.bodyMedium?.copyWith(color: Couleurs.encreDouce),
                    ),
                    TextButton(
                      onPressed: () => ouvrir(vousProposez),
                      style: TextButton.styleFrom(
                        foregroundColor: Couleurs.bleu,
                        padding: EdgeInsets.zero,
                        minimumSize: const Size(0, 40),
                        alignment: Alignment.centerLeft,
                      ),
                      child: const Text('Voir le détail', style: TextStyle(decoration: TextDecoration.underline)),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        const TitreSection('Les métiers'),
        // Une simple liste a icones : rien n'y est cliquable, rien ne doit
        // ressembler a un bouton.
        const _Metiers([
          (Icons.auto_awesome_outlined, 'Ménage'),
          (Icons.sentiment_satisfied_outlined, "Garde d'enfants"),
          (Icons.shield_outlined, 'Gardiennage'),
          (Icons.eco_outlined, 'Jardinage'),
          (Icons.restaurant, 'Cuisine'),
          (Icons.home_outlined, 'Autres'),
        ]),
        const SizedBox(height: 16),
        _CarteConfiance(
          titre: 'Pourquoi la vérification change tout',
          paragraphes: const [
            [
              TextSpan(
                text: "Faire venir quelqu'un chez soi, c'est lui ouvrir sa porte. Aujourd'hui, cela "
                    "repose surtout sur le bouche-à-oreille. PamConnect contrôle la pièce d'identité "
                    "et le casier judiciaire avant qu'une personne puisse être retenue, puis supprime "
                    'ces documents une fois le contrôle fait.',
              ),
            ],
            [
              TextSpan(text: 'Nous vérifions '),
              TextSpan(text: 'qui est la personne', style: _gras),
              TextSpan(
                text: ", pas ce qu'elle sait faire. Le métier est déclaré par chacun ; aucun "
                    "document ne l'atteste. PamConnect met en relation, elle ne certifie pas un "
                    'savoir-faire.',
              ),
            ],
          ],
          boutons: [
            _BoutonSecondaire(texte: "Je cherche quelqu'un", auClic: () => ouvrir(vousCherchez)),
            _BoutonSecondaire(texte: 'Je propose mes services', auClic: () => ouvrir(vousProposez)),
          ],
        ),
      ],
    );
  }
}

/// La page "Vous cherchez quelqu'un" du site.
class EcranVousCherchez extends StatelessWidget {
  const EcranVousCherchez({super.key, required this.seConnecter});

  final void Function(String message) seConnecter;

  @override
  Widget build(BuildContext context) {
    final texte = Theme.of(context).textTheme;

    return Scaffold(
      appBar: AppBar(title: const Text("Vous cherchez quelqu'un")),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            const _Chapeau(
              "Particulier, famille ou entreprise : trouvez la personne qu'il vous faut, "
              'dans votre quartier, avec une identité vérifiée.',
            ),
            const SizedBox(height: 16),
            const TitreSection('Ce que vous payez'),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text.rich(
                      const TextSpan(
                        children: [
                          TextSpan(text: 'Vous payez '),
                          TextSpan(text: 'le prix que vous annoncez', style: _gras),
                          TextSpan(text: ' dans votre demande, sans aucun frais de votre côté.'),
                        ],
                      ),
                      style: texte.bodyLarge?.copyWith(color: Couleurs.encre),
                    ),
                    const SizedBox(height: 12),
                    Text(
                      'Cette somme est bloquée dès la publication, et versée à la personne '
                      'quand vous déclarez le service effectué.',
                      style: texte.bodyMedium?.copyWith(color: Couleurs.encrePale),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),
            const TitreSection('Deux façons de trouver'),
            _CarteAction(
              titre: 'Chercher vous-même',
              morceaux: const [
                TextSpan(
                  text: "Vous indiquez ce que vous cherchez. La plateforme place d'abord les personnes "
                      'vérifiées et bien notées ; à niveau égal, celles proches de chez vous passent devant.',
                ),
              ],
              bouton: FilledButton.icon(
                onPressed: () => seConnecter(_pourChercher),
                icon: const Icon(Icons.search),
                label: const Text('Chercher maintenant'),
              ),
            ),
            _CarteAction(
              titre: 'Publier une demande',
              morceaux: const [
                TextSpan(text: 'Vous décrivez votre besoin et surtout '),
                TextSpan(text: 'quand', style: _gras),
                TextSpan(
                  text: " vous avez besoin de quelqu'un. Les personnes que l'horaire arrange "
                      'vous répondent.',
                ),
              ],
              bouton: _BoutonSecondaire(
                icone: Icons.add,
                texte: 'Publier une demande',
                auClic: () => seConnecter(_pourPublier),
              ),
            ),
            const SizedBox(height: 4),
            const _CarteConfiance(
              titre: 'Ce que PamConnect vérifie pour vous',
              paragraphes: [
                [
                  TextSpan(
                    text: "Nous contrôlons l'identité, pas les compétences : le métier est déclaré "
                        "par la personne, et aucun document ne l'atteste.",
                  ),
                ],
                [
                  TextSpan(text: "Avant qu'une personne puisse être retenue, notre équipe contrôle sa "),
                  TextSpan(text: "pièce d'identité", style: _gras),
                  TextSpan(text: ' et son '),
                  TextSpan(text: 'extrait de casier judiciaire', style: _gras),
                  TextSpan(
                    text: ". Tant que ce contrôle n'a pas été fait, vous ne pouvez pas accepter sa "
                        "candidature : c'est la plateforme qui l'empêche, pas seulement un bouton grisé.",
                  ),
                ],
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// La page "Vous proposez vos services" du site.
class EcranVousProposez extends StatelessWidget {
  const EcranVousProposez({
    super.key,
    required this.presentation,
    required this.seConnecter,
    required this.proposerSesServices,
  });

  final Presentation presentation;
  final void Function(String message) seConnecter;
  final VoidCallback proposerSesServices;

  @override
  Widget build(BuildContext context) {
    final texte = Theme.of(context).textTheme;
    final corps = texte.bodyLarge?.copyWith(color: Couleurs.encre);
    final exemple = presentation.exempleTarif;

    return Scaffold(
      appBar: AppBar(title: const Text('Vous proposez vos services')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            const _Chapeau(
              'Aide-ménagère, technicienne de surface, nounou, gardien, jardinier, cuisinier : '
              'faites-vous connaître des familles et des entreprises de Yaoundé.',
            ),
            const SizedBox(height: 16),
            const TitreSection('Ce que vous gagnez'),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text.rich(
                      const TextSpan(
                        children: [
                          TextSpan(text: 'Vous indiquez le tarif que vous demandez pour vos services. Il est '),
                          TextSpan(text: 'indicatif', style: _gras),
                          TextSpan(
                            text: ' : il aide les employeurs à vous trouver. Le montant réellement payé '
                                'est celui annoncé dans la demande à laquelle vous répondez.',
                          ),
                        ],
                      ),
                      style: corps,
                    ),
                    const SizedBox(height: 12),
                    Text(
                      "PamConnect y retient une commission et vous verse le reste quand l'employeur "
                      'a déclaré le service effectué.',
                      style: corps,
                    ),
                    const SizedBox(height: 12),
                    CadreExemple(
                      morceaux: [
                        const TextSpan(text: 'Pour une demande à '),
                        montantExemple(exemple.prix),
                        const TextSpan(text: ', la commission de '),
                        montantExemple('${presentation.pourcentageCommission} %'),
                        const TextSpan(text: ' est de '),
                        montantExemple(exemple.commission),
                        const TextSpan(text: ', et vous recevez '),
                        montantExemple(exemple.recu),
                        const TextSpan(text: '.'),
                      ],
                    ),
                    const SizedBox(height: 12),
                    Text(
                      'Vous voyez ce calcul avant de répondre à une demande, jamais après. '
                      'Après votre réponse, le prix ne peut plus baisser.',
                      style: texte.bodyMedium?.copyWith(color: Couleurs.encrePale),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),
            const TitreSection('Comment commencer'),
            _CarteAction(
              titre: '1. Créez votre compte',
              morceaux: const [
                TextSpan(text: 'Votre métier, votre quartier et votre tarif. Cela prend deux minutes.'),
              ],
              bouton: FilledButton.icon(
                onPressed: proposerSesServices,
                icon: const Icon(Icons.person_outline),
                label: const Text("M'inscrire"),
              ),
            ),
            _CarteAction(
              titre: '2. Faites vérifier votre identité',
              morceaux: const [
                TextSpan(
                  text: "Votre pièce d'identité et votre extrait de casier judiciaire. Sans cette "
                      'vérification, aucun employeur ne peut vous retenir.',
                ),
              ],
              bouton: _BoutonSecondaire(
                icone: Icons.file_upload_outlined,
                texte: 'Envoyer mes documents',
                auClic: () => seConnecter(_pourDocuments),
              ),
            ),
            _CarteAction(
              titre: '3. Répondez aux demandes',
              morceaux: const [
                TextSpan(
                  text: "Les employeurs indiquent quand ils ont besoin de quelqu'un. Si l'horaire "
                      'vous arrange, vous répondez.',
                ),
              ],
              bouton: _BoutonSecondaire(
                icone: Icons.insert_drive_file_outlined,
                texte: 'Voir les demandes',
                auClic: () => seConnecter(_pourDemandes),
              ),
            ),
            const SizedBox(height: 4),
            const _CarteConfiance(
              titre: 'Que deviennent vos documents ?',
              paragraphes: [
                [
                  TextSpan(
                    text: "Ils sont vus uniquement par l'équipe qui fait la vérification. Ni les "
                        "employeurs, ni les autres personnes inscrites n'y ont accès. ",
                  ),
                  TextSpan(text: 'Ils sont supprimés dès que votre dossier est traité', style: _gras),
                  TextSpan(text: ' : il ne reste que la mention « identité vérifiée » et sa date.'),
                ],
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// Le grand titre d'une page, comme h1 sur le site : bleu.
class _TitrePage extends StatelessWidget {
  const _TitrePage(this.texte);

  final String texte;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      header: true,
      child: Text(
        texte,
        style: Theme.of(context).textTheme.headlineSmall?.copyWith(
              color: Couleurs.bleu,
              fontWeight: FontWeight.w700,
            ),
      ),
    );
  }
}

/// La phrase d'introduction, comme la classe "chapeau" du site.
class _Chapeau extends StatelessWidget {
  const _Chapeau(this.texte);

  final String texte;

  @override
  Widget build(BuildContext context) {
    return Text(
      texte,
      style: Theme.of(context).textTheme.bodyLarge?.copyWith(color: Couleurs.encreDouce),
    );
  }
}

/// Le bouton blanc a bord bleu du site (.bouton-secondaire).
class _BoutonSecondaire extends StatelessWidget {
  const _BoutonSecondaire({required this.texte, required this.auClic, this.icone});

  final String texte;
  final VoidCallback auClic;
  final IconData? icone;

  @override
  Widget build(BuildContext context) {
    final style = OutlinedButton.styleFrom(
      minimumSize: const Size.fromHeight(48),
      foregroundColor: Couleurs.bleu,
      backgroundColor: Couleurs.surface,
      side: const BorderSide(color: Couleurs.bleu),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(rayon)),
    );
    final icone = this.icone;
    if (icone == null) return OutlinedButton(onPressed: auClic, style: style, child: Text(texte));
    return OutlinedButton.icon(onPressed: auClic, style: style, icon: Icon(icone), label: Text(texte));
  }
}

/// Une etape de "Comment ca marche" : le numero dans son rond orange.
class _Etape extends StatelessWidget {
  const _Etape({required this.numero, required this.titre, required this.morceaux});

  final int numero;
  final String titre;
  final List<InlineSpan> morceaux;

  @override
  Widget build(BuildContext context) {
    final texte = Theme.of(context).textTheme;

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Couleurs.surface,
        border: Border.all(color: Couleurs.trait),
        borderRadius: BorderRadius.circular(rayon),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 34,
            height: 34,
            alignment: Alignment.center,
            decoration: const BoxDecoration(color: Couleurs.orangeClair, shape: BoxShape.circle),
            child: Text(
              '$numero',
              style: texte.titleSmall?.copyWith(color: Couleurs.orange, fontWeight: FontWeight.w700),
            ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(titre, style: texte.titleMedium?.copyWith(color: Couleurs.bleu, fontWeight: FontWeight.w600)),
                const SizedBox(height: 4),
                Text.rich(
                  TextSpan(children: morceaux),
                  style: texte.bodyMedium?.copyWith(color: Couleurs.encreDouce),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// La liste des metiers, deux par ligne.
class _Metiers extends StatelessWidget {
  const _Metiers(this.metiers);

  final List<(IconData, String)> metiers;

  @override
  Widget build(BuildContext context) {
    final style = Theme.of(context).textTheme.bodyLarge?.copyWith(color: Couleurs.encreDouce);

    Widget metier((IconData, String) m) => Padding(
          padding: const EdgeInsets.symmetric(vertical: 7),
          child: Row(
            children: [
              Icon(m.$1, size: 24, color: Couleurs.bleu),
              const SizedBox(width: 10),
              Expanded(child: Text(m.$2, style: style)),
            ],
          ),
        );

    return Column(
      children: [
        for (var i = 0; i < metiers.length; i += 2)
          Row(
            children: [
              Expanded(child: metier(metiers[i])),
              const SizedBox(width: 12),
              Expanded(child: i + 1 < metiers.length ? metier(metiers[i + 1]) : const SizedBox.shrink()),
            ],
          ),
      ],
    );
  }
}

/// Une carte blanche avec son titre, sa phrase et son bouton.
class _CarteAction extends StatelessWidget {
  const _CarteAction({required this.titre, required this.morceaux, required this.bouton});

  final String titre;
  final List<InlineSpan> morceaux;
  final Widget bouton;

  @override
  Widget build(BuildContext context) {
    final texte = Theme.of(context).textTheme;

    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(titre, style: texte.titleMedium?.copyWith(color: Couleurs.bleu, fontWeight: FontWeight.w600)),
              const SizedBox(height: 8),
              Text.rich(
                TextSpan(children: morceaux),
                style: texte.bodyMedium?.copyWith(color: Couleurs.encreDouce),
              ),
              const SizedBox(height: 16),
              bouton,
            ],
          ),
        ),
      ),
    );
  }
}

/// La carte bleu clair du site (.confiance), avec le bouclier.
class _CarteConfiance extends StatelessWidget {
  const _CarteConfiance({required this.titre, required this.paragraphes, this.boutons = const []});

  final String titre;
  final List<List<InlineSpan>> paragraphes;
  final List<Widget> boutons;

  @override
  Widget build(BuildContext context) {
    final texte = Theme.of(context).textTheme;

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: Couleurs.bleuClair, borderRadius: BorderRadius.circular(rayon)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              const Icon(Icons.verified_user_outlined, size: 22, color: Couleurs.bleu),
              const SizedBox(width: 8),
              Expanded(
                child: Semantics(
                  header: true,
                  child: Text(
                    titre,
                    style: texte.titleMedium?.copyWith(color: Couleurs.bleu, fontWeight: FontWeight.w600),
                  ),
                ),
              ),
            ],
          ),
          for (final morceaux in paragraphes) ...[
            const SizedBox(height: 10),
            Text.rich(
              TextSpan(children: morceaux),
              style: texte.bodyMedium?.copyWith(color: Couleurs.encreDouce),
            ),
          ],
          for (final bouton in boutons) ...[
            const SizedBox(height: 10),
            bouton,
          ],
        ],
      ),
    );
  }
}
