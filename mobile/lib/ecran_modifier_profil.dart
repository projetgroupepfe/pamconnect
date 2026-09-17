import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'api.dart';
import 'ecran_connexion.dart';
import 'elements.dart';
import 'modeles.dart';
import 'theme.dart';

const _aideArrondissementDepart = "Rempli automatiquement d'après votre quartier.";

const _nomsDesMois = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

/// Modifier mon profil : le formulaire du site, champ pour champ.
///
/// Comme pour une demande, l'ecran ne verifie rien lui-meme : le serveur
/// refuse, avec la phrase du site. En cas de succes, l'ecran rend cette
/// phrase a Mon profil.
///
/// CREER UN COMPTE reprend ce formulaire, vide, comme la page inscription
/// du site reprend ses morceaux : le choix du role, l'adresse et le mot de
/// passe s'ajoutent en haut, et les champs de la personne qui repond
/// n'apparaissent que pour ce choix. En cas de succes, l'ecran rend
/// l'adresse a la connexion.
///
/// Sur le site, le navigateur peut aussi donner la position. L'application
/// ne la demande pas : le serveur garde celle qu'il connait.
class EcranModifierProfil extends StatefulWidget {
  const EcranModifierProfil({super.key, required this.api})
      : pourInscription = false,
        proposerSesServices = false;

  const EcranModifierProfil.inscription({super.key, required this.api, this.proposerSesServices = false})
      : pourInscription = true;

  final ApiPamConnect api;

  /// Creer un compte plutot que modifier le sien.
  final bool pourInscription;

  /// Ouvrir Creer un compte sur le choix de la personne qui repond, comme
  /// "Proposer mes services" sur le site.
  final bool proposerSesServices;

  @override
  State<EcranModifierProfil> createState() => _EcranModifierProfilState();
}

class _EcranModifierProfilState extends State<EcranModifierProfil> {
  FormulaireProfil? _formulaire;
  String? _erreurChargement;

  // Creer un compte seulement : le choix du role, l'adresse et le mot de passe.
  FormulaireInscription? _inscription;
  String? _role;
  final _email = TextEditingController();
  final _motdepasse = TextEditingController();

  final _nom = TextEditingController();
  final _telephone = TextEditingController();
  final _experience = TextEditingController();
  final _tarif = TextEditingController();

  // Le metier et le quartier ont une liste de suggestions, qui cree son
  // propre controleur : on le garde pour lire la saisie a l'envoi.
  TextEditingController? _metier;
  TextEditingController? _quartier;

  String? _arrondissement;
  String _aideArrondissement = _aideArrondissementDepart;
  Timer? _attenteQuartier;
  int _rechercheQuartier = 0;

  // La date de naissance, en trois listes : jour, mois, annee.
  int? _jour;
  int? _mois;
  int? _annee;

  /// Les creneaux coches, par exemple "lundi-matin".
  final Set<String> _coches = {};

  /// Le detail du tarif, calcule par le serveur pendant la saisie.
  TarifDuProfil? _detail;
  Timer? _attenteTarif;
  int _rechercheTarif = 0;

  String? _erreurEnvoi;
  bool _envoi = false;

  @override
  void initState() {
    super.initState();
    _charger();
  }

  @override
  void dispose() {
    _attenteQuartier?.cancel();
    _attenteTarif?.cancel();
    for (final controleur in [_nom, _telephone, _experience, _tarif, _email, _motdepasse]) {
      controleur.dispose();
    }
    super.dispose();
  }

  Future<void> _charger() async {
    try {
      final FormulaireInscription? inscription;
      final FormulaireProfil formulaire;
      if (widget.pourInscription) {
        final lu = await widget.api.formulaireInscription();
        inscription = lu;
        formulaire = lu.profil;
      } else {
        inscription = null;
        formulaire = await widget.api.formulaireProfil();
      }
      if (!mounted) return;
      setState(() {
        _formulaire = formulaire;
        _inscription = inscription;
        // Le premier choix de la liste, comme sur le site, sauf si l'on vient
        // de "Proposer mes services".
        if (inscription != null) {
          final roles = inscription.roles;
          _role ??= (widget.proposerSesServices
                  ? roles.firstWhere((role) => role.pourPersonne, orElse: () => roles.first)
                  : roles.first)
              .valeur;
        }
        _erreurChargement = null;
        _nom.text = formulaire.nom;
        _telephone.text = formulaire.telephone;
        _experience.text = formulaire.experienceAnnees;
        _tarif.text = formulaire.tarif;
        // Une valeur absente de la liste ne peut pas etre selectionnee.
        if (formulaire.arrondissements.contains(formulaire.arrondissement)) {
          _arrondissement = formulaire.arrondissement;
        }
        _coches
          ..clear()
          ..addAll([
            for (final jour in formulaire.jours)
              for (final creneau in jour.creneaux)
                if (creneau.coche) creneau.valeur,
          ]);
        _lireDate(formulaire.dateNaissance);
      });
      if (formulaire.pourPersonne) await _chercherDetail(formulaire.tarif);
    } on ErreurApi catch (erreur) {
      if (!mounted) return;
      if (erreur.sessionPerdue && !widget.pourInscription) {
        revenirALaConnexion(context, widget.api, messageSessionPerdue);
        return;
      }
      setState(() => _erreurChargement = erreur.message);
    }
  }

  /// "1995-06-15", tel que le serveur l'enregistre, reparti dans les trois
  /// listes.
  void _lireDate(String? date) {
    final morceaux = date?.split('-');
    if (morceaux == null || morceaux.length != 3) return;
    _annee = int.tryParse(morceaux[0]);
    _mois = int.tryParse(morceaux[1]);
    _jour = int.tryParse(morceaux[2]);
  }

  /// Le nombre de jours du mois choisi. Tant que l'annee n'est pas choisie,
  /// on compte sur une annee bissextile : le 29 fevrier reste possible.
  int _joursDuMois() {
    final mois = _mois;
    if (mois == null || mois < 1 || mois > 12) return 31;
    return DateUtils.getDaysInMonth(_annee ?? 2000, mois);
  }

  void _ajusterJour() {
    final jour = _jour;
    if (jour != null && jour > _joursDuMois()) _jour = null;
  }

  /// La date telle que le serveur l'attend, "" si les trois listes sont
  /// vides, null si elle n'est remplie qu'a moitie.
  String? _dateAEnvoyer() {
    final jour = _jour, mois = _mois, annee = _annee;
    if (jour == null && mois == null && annee == null) return '';
    if (jour == null || mois == null || annee == null) return null;
    String deuxChiffres(int nombre) => nombre.toString().padLeft(2, '0');
    return '$annee-${deuxChiffres(mois)}-${deuxChiffres(jour)}';
  }

  /// L'arrondissement s'affiche avant l'envoi, comme sur le site. C'est le
  /// serveur qui le trouve : l'application ne recopie pas sa regle.
  void _quartierChange(String texte) {
    _attenteQuartier?.cancel();
    if (texte.trim().isEmpty) {
      setState(() => _aideArrondissement = _aideArrondissementDepart);
      return;
    }
    _attenteQuartier = Timer(const Duration(milliseconds: 400), () => _chercherQuartier(texte));
  }

  Future<void> _chercherQuartier(String texte) async {
    final numero = ++_rechercheQuartier;
    try {
      final lieu = await widget.api.quartier(texte);
      if (!mounted || numero != _rechercheQuartier) return;
      final arrondissements = _formulaire?.arrondissements ?? const <String>[];
      setState(() {
        if (lieu.connu && arrondissements.contains(lieu.arrondissement)) {
          _arrondissement = lieu.arrondissement;
          _aideArrondissement = "Trouvé d'après votre quartier.";
        } else {
          _aideArrondissement = "Ce quartier n'est pas encore dans notre liste : "
              "choisissez vous-même l'arrondissement.";
        }
      });
    } on ErreurApi {
      // L'aide reste telle quelle : le serveur trouvera l'arrondissement a
      // l'envoi.
    }
  }

  void _tarifChange(String texte) {
    _attenteTarif?.cancel();
    _attenteTarif = Timer(const Duration(milliseconds: 400), () => _chercherDetail(texte));
  }

  /// Comme sur le site, quitter le choix de la personne qui repond vide le
  /// metier et le tarif.
  void _roleChange(String? choix) {
    setState(() {
      _role = choix;
      final formulaire = _formulaire;
      if (formulaire != null && !_champsDeLaPersonne(formulaire)) {
        _attenteTarif?.cancel();
        _rechercheTarif++;
        _tarif.clear();
        _detail = null;
      }
    });
  }

  /// Les champs de la personne qui repond : ceux de son compte, ou ceux du
  /// role choisi pour en creer un.
  bool _champsDeLaPersonne(FormulaireProfil formulaire) {
    final inscription = _inscription;
    if (inscription == null) return formulaire.pourPersonne;
    return inscription.roles.any((role) => role.valeur == _role && role.pourPersonne);
  }

  /// La commission n'est pas calculee ici : le serveur rend le detail.
  Future<void> _chercherDetail(String montant) async {
    final numero = ++_rechercheTarif;
    if (montant.trim().isEmpty) {
      if (mounted) setState(() => _detail = null);
      return;
    }
    try {
      final detail = await widget.api.detailTarif(montant);
      if (!mounted || numero != _rechercheTarif) return;
      setState(() => _detail = detail);
    } on ErreurApi {
      // Le detail n'est qu'une aide : sans reponse, il ne s'affiche pas.
      if (mounted && numero == _rechercheTarif) setState(() => _detail = null);
    }
  }

  Future<void> _enregistrer() async {
    final formulaire = _formulaire;
    if (_envoi || formulaire == null) return;
    final personne = _champsDeLaPersonne(formulaire);

    final date = _dateAEnvoyer();
    if (personne && date == null) {
      setState(() => _erreurEnvoi =
          "Choisissez le jour, le mois et l'année de naissance, ou laissez les trois vides.");
      return;
    }

    setState(() {
      _envoi = true;
      _erreurEnvoi = null;
    });

    try {
      final champs = <String, dynamic>{
        if (widget.pourInscription) ...{
          'role': _role ?? '',
          'email': _email.text,
          'motdepasse': _motdepasse.text,
        },
        'nom': _nom.text,
        'telephone': _telephone.text,
        'quartier': _quartier?.text ?? '',
        'arrondissement': _arrondissement ?? '',
        if (personne) ...{
          'metier': _metier?.text ?? '',
          'tarif': _tarif.text,
          'date_naissance': date,
          'experience_annees': _experience.text,
          'disponibilites': [
            for (final jour in formulaire.jours)
              for (final creneau in jour.creneaux)
                if (_coches.contains(creneau.valeur)) creneau.valeur,
          ],
        },
      };
      if (widget.pourInscription) {
        final faite = await widget.api.inscrire(champs);
        if (!mounted) return;
        Navigator.of(context).pop(faite);
        return;
      }
      final texte = (await widget.api.enregistrerProfil(champs)).texte;
      if (!mounted) return;
      Navigator.of(context).pop(texte);
    } on ErreurApi catch (erreur) {
      if (!mounted) return;
      if (erreur.sessionPerdue && !widget.pourInscription) {
        revenirALaConnexion(context, widget.api, messageSessionPerdue);
        return;
      }
      setState(() {
        _envoi = false;
        _erreurEnvoi = erreur.message;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(widget.pourInscription ? 'Créer un compte' : 'Modifier mon profil')),
      body: SafeArea(child: _corps(context)),
    );
  }

  Widget _corps(BuildContext context) {
    final erreurChargement = _erreurChargement;
    final formulaire = _formulaire;

    if (erreurChargement != null) {
      return ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Avertissement(texte: erreurChargement),
          const SizedBox(height: 16),
          FilledButton(onPressed: _charger, child: const Text('Réessayer')),
        ],
      );
    }
    if (formulaire == null) return const Center(child: CircularProgressIndicator());

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        // La phrase sous le titre de la page du site.
        if (widget.pourInscription) ...[
          Text(
            "C'est gratuit. Si vous proposez vos services, vous devrez ensuite "
            'faire vérifier votre identité pour être visible.',
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: Couleurs.encreDouce),
          ),
          const SizedBox(height: 16),
        ],
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: _champs(context, formulaire),
            ),
          ),
        ),
        // L'adresse et le mot de passe sont les deux cles du compte : chacune
        // a sa section, et chacune exige le mot de passe actuel.
        if (!widget.pourInscription) ...[
          const SizedBox(height: 8),
          const TitreSection('Changer mon adresse email'),
          _CarteEmail(api: widget.api, emailActuel: formulaire.email),
          const SizedBox(height: 8),
          const TitreSection('Changer mon mot de passe'),
          _CarteMotDePasse(api: widget.api, minimum: formulaire.motDePasseMin),
        ],
      ],
    );
  }

  List<Widget> _champs(BuildContext context, FormulaireProfil formulaire) {
    const espace = SizedBox(height: 16);
    final texte = Theme.of(context).textTheme;
    final titre = texte.titleSmall?.copyWith(color: Couleurs.encre, fontWeight: FontWeight.w600);
    final aide = texte.bodyMedium?.copyWith(color: Couleurs.encrePale);
    final erreurEnvoi = _erreurEnvoi;
    final detail = _detail;
    // Sur la page inscription du site, l'aide est l'exemple, sous le cadre.
    final aideDetail = widget.pourInscription ? null : detail?.aide;
    final inscription = _inscription;
    final personne = _champsDeLaPersonne(formulaire);

    return [
      if (inscription != null) ...[
        InputDecorator(
          decoration: const InputDecoration(labelText: 'Vous êtes ici pour'),
          child: DropdownButtonHideUnderline(
            child: DropdownButton<String>(
              value: _role,
              isExpanded: true,
              isDense: true,
              items: [
                for (final role in inscription.roles)
                  DropdownMenuItem<String>(value: role.valeur, child: Text(role.libelle)),
              ],
              onChanged: _envoi ? null : _roleChange,
            ),
          ),
        ),
        espace,
      ],
      TextField(
        controller: _nom,
        textCapitalization: TextCapitalization.words,
        textInputAction: TextInputAction.next,
        decoration: InputDecoration(labelText: inscription != null ? 'Votre nom complet' : 'Votre nom'),
      ),
      espace,
      // L'EQUIPE APPELLE : sans numero, personne ne peut etre mis en
      // relation. Demande aux deux roles, comme sur le site.
      TextField(
        controller: _telephone,
        keyboardType: TextInputType.phone,
        textInputAction: TextInputAction.next,
        decoration: const InputDecoration(
          labelText: 'Votre numéro de téléphone',
          hintText: '6XX XX XX XX',
          helperText: "Ce numéro sert à l'équipe PamConnect pour vous appeler.\n"
              "Il n'est jamais montré aux autres utilisateurs.",
          helperMaxLines: 3,
        ),
      ),
      espace,
      if (inscription != null) ...[
        TextField(
          controller: _email,
          keyboardType: TextInputType.emailAddress,
          autocorrect: false,
          autofillHints: const [AutofillHints.email],
          textInputAction: TextInputAction.next,
          decoration: const InputDecoration(labelText: 'Votre adresse email'),
        ),
        espace,
        ChampMotDePasse(
          controleur: _motdepasse,
          libelle: 'Votre mot de passe',
          aide: '${formulaire.motDePasseMin} caractères au minimum.',
          autofill: const [AutofillHints.newPassword],
        ),
        espace,
      ],
      ChampAvecSuggestions(
        liste: formulaire.quartiers,
        libelle: 'Votre quartier',
        exemple: 'ex : Bastos, Mvan, Biyem-Assi...',
        aide: "Indiquez le quartier, nous trouvons l'arrondissement.",
        valeurDepart: formulaire.quartier,
        garder: (controleur) => _quartier = controleur,
        auChangement: _quartierChange,
      ),
      espace,
      InputDecorator(
        decoration: InputDecoration(
          labelText: 'Arrondissement',
          helperText: _aideArrondissement,
          helperMaxLines: 3,
        ),
        child: DropdownButtonHideUnderline(
          child: DropdownButton<String?>(
            value: _arrondissement,
            isExpanded: true,
            isDense: true,
            items: [
              const DropdownMenuItem<String?>(value: null, child: Text('Non précisé')),
              for (final arrondissement in formulaire.arrondissements)
                DropdownMenuItem<String?>(value: arrondissement, child: Text(arrondissement)),
            ],
            onChanged: (choix) => setState(() => _arrondissement = choix),
          ),
        ),
      ),
      if (personne) ...[
        espace,
        ChampAvecSuggestions(
          liste: formulaire.metiers,
          libelle: 'Ce que vous faites',
          exemple: 'ex : Ménage à domicile',
          valeurDepart: formulaire.metier ?? '',
          garder: (controleur) => _metier = controleur,
        ),
        const SizedBox(height: 24),
        Text('Votre date de naissance', style: titre),
        const SizedBox(height: 8),
        _listesDate(formulaire),
        const SizedBox(height: 8),
        Text(
          "Elle n'est jamais affichée. Les employeurs ne voient qu'une tranche d'âge, "
          'par exemple « 25 - 34 ans ».',
          style: aide,
        ),
        const SizedBox(height: 24),
        Text("Depuis combien d'années faites-vous ce travail ?", style: titre),
        TextField(
          controller: _experience,
          keyboardType: TextInputType.number,
          inputFormatters: [FilteringTextInputFormatter.digitsOnly],
          textInputAction: TextInputAction.next,
          decoration: const InputDecoration(hintText: 'ex : 4'),
        ),
        const SizedBox(height: 24),
        Text('Quand pouvez-vous travailler ?', style: titre),
        const SizedBox(height: 8),
        _grilleCreneaux(context, formulaire),
        const SizedBox(height: 8),
        Text('Cochez tous les moments qui vous conviennent.', style: aide),
        const SizedBox(height: 24),
        TextField(
          controller: _tarif,
          keyboardType: TextInputType.number,
          inputFormatters: [FilteringTextInputFormatter.digitsOnly],
          onChanged: _tarifChange,
          decoration: const InputDecoration(
            labelText: 'Le tarif que vous demandez (FCFA)',
            hintText: 'ex : 10000',
            helperText: "C'est ce que vous demandez pour vos services.",
            helperMaxLines: 2,
          ),
        ),
        // Le detail se recalcule pendant la saisie, comme sur le site.
        if (detail != null && detail.lignes.isNotEmpty) ...[
          const SizedBox(height: 12),
          DetailMontants(lignes: detail.lignes),
          if (aideDetail != null) Text(aideDetail, style: aide),
        ],
        if (inscription != null) ...[
          const SizedBox(height: 12),
          _ExempleDeTarif(exemple: inscription.exempleTarif),
        ],
      ],
      const SizedBox(height: 24),
      if (erreurEnvoi != null) ...[
        Avertissement(texte: erreurEnvoi),
        espace,
      ],
      // La coche, comme le bouton du site. Creer mon compte n'en a pas.
      if (inscription == null)
        FilledButton.icon(
          onPressed: _envoi ? null : _enregistrer,
          icon: _envoi
              ? const SizedBox(
                  width: 22,
                  height: 22,
                  child: CircularProgressIndicator(strokeWidth: 2.5, color: Couleurs.bleuFonce),
                )
              : const Icon(Icons.check),
          label: const Text('Enregistrer'),
        )
      else
        FilledButton(
          onPressed: _envoi ? null : _enregistrer,
          child: _envoi
              ? const SizedBox(
                  width: 22,
                  height: 22,
                  child: CircularProgressIndicator(strokeWidth: 2.5, color: Couleurs.bleuFonce),
                )
              : const Text('Créer mon compte'),
        ),
      const SizedBox(height: 8),
      OutlinedButton(
        // J'ai deja un compte mene a la connexion, meme depuis l'accueil.
        onPressed: _envoi
            ? null
            : () => inscription == null
                ? Navigator.of(context).pop()
                : Navigator.of(context).popUntil((route) => route.isFirst),
        style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48)),
        child: Text(inscription == null ? 'Annuler' : "J'ai déjà un compte"),
      ),
    ];
  }

  /// Jour, mois et annee. Le telephone n'a pas le calendrier en francais :
  /// trois listes se lisent sans lui.
  Widget _listesDate(FormulaireProfil formulaire) {
    final joursDuMois = _joursDuMois();
    final jour = _jour;
    final mois = _mois;
    final annee = _annee;
    final bornes = formulaire.anneesNaissance;
    final annees = <int>[
      if (bornes != null)
        for (var a = bornes.a; a >= bornes.de; a--) a,
    ];
    // Une annee deja enregistree reste affichee, meme hors des bornes.
    if (annee != null && !annees.contains(annee)) annees.insert(0, annee);

    return Row(
      children: [
        Expanded(
          flex: 3,
          child: _liste(
            libelle: 'Jour',
            valeur: jour != null && jour >= 1 && jour <= joursDuMois ? jour : null,
            choix: [for (var j = 1; j <= joursDuMois; j++) (j, '$j')],
            auChoix: (choix) => setState(() => _jour = choix),
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          flex: 5,
          child: _liste(
            libelle: 'Mois',
            valeur: mois != null && mois >= 1 && mois <= 12 ? mois : null,
            choix: [for (var m = 1; m <= 12; m++) (m, _nomsDesMois[m - 1])],
            auChoix: (choix) => setState(() {
              _mois = choix;
              _ajusterJour();
            }),
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          flex: 4,
          child: _liste(
            libelle: 'Année',
            valeur: annee,
            choix: [for (final a in annees) (a, '$a')],
            auChoix: (choix) => setState(() {
              _annee = choix;
              _ajusterJour();
            }),
          ),
        ),
      ],
    );
  }

  Widget _liste({
    required String libelle,
    required int? valeur,
    required List<(int, String)> choix,
    required void Function(int?) auChoix,
  }) {
    return InputDecorator(
      decoration: InputDecoration(labelText: libelle),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<int?>(
          value: valeur,
          isExpanded: true,
          isDense: true,
          items: [
            const DropdownMenuItem<int?>(value: null, child: Text('-')),
            for (final (nombre, texte) in choix)
              DropdownMenuItem<int?>(value: nombre, child: Text(texte, overflow: TextOverflow.ellipsis)),
          ],
          onChanged: auChoix,
        ),
      ),
    );
  }

  /// Sept jours, trois moments : une liste fermee, comme sur le site, pour
  /// que l'on puisse chercher qui est libre le samedi matin.
  Widget _grilleCreneaux(BuildContext context, FormulaireProfil formulaire) {
    final texte = Theme.of(context).textTheme;
    final entete = texte.labelMedium?.copyWith(color: Couleurs.encreDouce, fontWeight: FontWeight.w600);

    return Table(
      columnWidths: const {0: FlexColumnWidth(1.6)},
      defaultVerticalAlignment: TableCellVerticalAlignment.middle,
      children: [
        TableRow(
          children: [
            const SizedBox.shrink(),
            for (final moment in formulaire.moments)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Text(moment, textAlign: TextAlign.center, style: entete),
              ),
          ],
        ),
        for (final jour in formulaire.jours)
          TableRow(
            decoration: const BoxDecoration(border: Border(top: BorderSide(color: Couleurs.trait))),
            children: [
              Text(jour.libelle, style: texte.bodyMedium?.copyWith(color: Couleurs.encre)),
              for (final creneau in jour.creneaux)
                Checkbox(
                  value: _coches.contains(creneau.valeur),
                  semanticLabel: '${jour.libelle} ${creneau.libelle}',
                  onChanged: (coche) => setState(() {
                    if (coche == true) {
                      _coches.add(creneau.valeur);
                    } else {
                      _coches.remove(creneau.valeur);
                    }
                  }),
                ),
            ],
          ),
      ],
    );
  }
}

/// L'exemple sous le tarif, comme le cadre "exemple" de la page inscription
/// du site. Les montants viennent du serveur.
class _ExempleDeTarif extends StatelessWidget {
  const _ExempleDeTarif({required this.exemple});

  final ExempleTarif exemple;

  @override
  Widget build(BuildContext context) {
    return CadreExemple(
      morceaux: [
        const TextSpan(
          text: 'Ce tarif est indicatif. Le montant réellement reçu dépend de la demande '
              'à laquelle vous répondez : pour une demande à ',
        ),
        montantExemple(exemple.prix),
        const TextSpan(text: ', la commission est de '),
        montantExemple(exemple.commission),
        const TextSpan(text: ' et vous recevez '),
        montantExemple(exemple.recu),
        const TextSpan(text: '.'),
      ],
    );
  }
}

/// Changer mon adresse email. Elle a son propre bouton : l'enregistrer ne
/// touche pas au reste du formulaire.
class _CarteEmail extends StatefulWidget {
  const _CarteEmail({required this.api, required this.emailActuel});

  final ApiPamConnect api;
  final String emailActuel;

  @override
  State<_CarteEmail> createState() => _CarteEmailState();
}

class _CarteEmailState extends State<_CarteEmail> {
  late String _actuelle = widget.emailActuel;
  final _nouvelle = TextEditingController();
  final _motdepasse = TextEditingController();
  bool _envoi = false;
  String? _erreur;
  String? _reussite;

  @override
  void dispose() {
    _nouvelle.dispose();
    _motdepasse.dispose();
    super.dispose();
  }

  Future<void> _envoyer() async {
    if (_envoi) return;
    setState(() {
      _envoi = true;
      _erreur = null;
      _reussite = null;
    });

    try {
      final resultat = await widget.api.changerEmail(_nouvelle.text, _motdepasse.text);
      if (!mounted) return;
      setState(() {
        _envoi = false;
        _actuelle = resultat.email;
        _reussite = resultat.texte;
        _nouvelle.clear();
        _motdepasse.clear();
      });
    } on ErreurApi catch (erreur) {
      if (!mounted) return;
      if (erreur.sessionPerdue) {
        revenirALaConnexion(context, widget.api, messageSessionPerdue);
        return;
      }
      // Un mot de passe refuse ne reste pas affiche dans le champ.
      setState(() {
        _envoi = false;
        _erreur = erreur.message;
        _motdepasse.clear();
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    const espace = SizedBox(height: 16);
    final gris = Theme.of(context).textTheme.bodyMedium?.copyWith(color: Couleurs.encreDouce);
    final erreur = _erreur;
    final reussite = _reussite;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text.rich(
              TextSpan(
                children: [
                  const TextSpan(text: 'Adresse actuelle : '),
                  TextSpan(
                    text: _actuelle,
                    style: const TextStyle(fontWeight: FontWeight.w600, color: Couleurs.encre),
                  ),
                ],
              ),
              style: gris,
            ),
            espace,
            TextField(
              controller: _nouvelle,
              keyboardType: TextInputType.emailAddress,
              autocorrect: false,
              autofillHints: const [AutofillHints.email],
              textInputAction: TextInputAction.next,
              decoration: const InputDecoration(
                labelText: 'Nouvelle adresse',
                helperText: "C'est cette adresse qu'il faudra saisir pour vous connecter.",
                helperMaxLines: 2,
              ),
            ),
            espace,
            ChampMotDePasse(
              controleur: _motdepasse,
              libelle: 'Votre mot de passe',
              action: TextInputAction.done,
            ),
            espace,
            if (erreur != null) ...[
              Avertissement(texte: erreur),
              espace,
            ],
            if (reussite != null) ...[
              Confirmation(texte: reussite),
              espace,
            ],
            OutlinedButton(
              onPressed: _envoi ? null : _envoyer,
              style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48)),
              child: _envoi
                  ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.5))
                  : const Text('Changer mon adresse'),
            ),
          ],
        ),
      ),
    );
  }
}

/// Changer mon mot de passe, avec l'ancien : sans lui, quelqu'un qui
/// trouverait le telephone deverrouille pourrait s'approprier le compte.
class _CarteMotDePasse extends StatefulWidget {
  const _CarteMotDePasse({required this.api, required this.minimum});

  final ApiPamConnect api;

  /// La longueur que le serveur exige, affichee sous le champ.
  final int minimum;

  @override
  State<_CarteMotDePasse> createState() => _CarteMotDePasseState();
}

class _CarteMotDePasseState extends State<_CarteMotDePasse> {
  final _ancien = TextEditingController();
  final _nouveau = TextEditingController();
  bool _envoi = false;
  String? _erreur;
  String? _reussite;

  @override
  void dispose() {
    _ancien.dispose();
    _nouveau.dispose();
    super.dispose();
  }

  Future<void> _envoyer() async {
    if (_envoi) return;
    setState(() {
      _envoi = true;
      _erreur = null;
      _reussite = null;
    });

    try {
      final resultat = await widget.api.changerMotDePasse(_ancien.text, _nouveau.text);
      if (!mounted) return;
      setState(() {
        _envoi = false;
        _reussite = resultat.texte;
        _ancien.clear();
        _nouveau.clear();
      });
    } on ErreurApi catch (erreur) {
      if (!mounted) return;
      if (erreur.sessionPerdue) {
        revenirALaConnexion(context, widget.api, messageSessionPerdue);
        return;
      }
      setState(() {
        _envoi = false;
        _erreur = erreur.message;
        _ancien.clear();
        _nouveau.clear();
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    const espace = SizedBox(height: 16);
    final erreur = _erreur;
    final reussite = _reussite;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            ChampMotDePasse(
              controleur: _ancien,
              libelle: 'Mot de passe actuel',
            ),
            espace,
            ChampMotDePasse(
              controleur: _nouveau,
              libelle: 'Nouveau mot de passe',
              aide: '${widget.minimum} caractères au minimum.',
              autofill: const [AutofillHints.newPassword],
              action: TextInputAction.done,
            ),
            espace,
            if (erreur != null) ...[
              Avertissement(texte: erreur),
              espace,
            ],
            if (reussite != null) ...[
              Confirmation(texte: reussite),
              espace,
            ],
            OutlinedButton(
              onPressed: _envoi ? null : _envoyer,
              style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48)),
              child: _envoi
                  ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.5))
                  : const Text('Changer mon mot de passe'),
            ),
          ],
        ),
      ),
    );
  }
}
