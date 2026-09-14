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
/// Sur le site, le navigateur peut aussi donner la position. L'application
/// ne la demande pas : le serveur garde celle qu'il connait.
class EcranModifierProfil extends StatefulWidget {
  const EcranModifierProfil({super.key, required this.api});

  final ApiPamConnect api;

  @override
  State<EcranModifierProfil> createState() => _EcranModifierProfilState();
}

class _EcranModifierProfilState extends State<EcranModifierProfil> {
  FormulaireProfil? _formulaire;
  String? _erreurChargement;

  final _nom = TextEditingController();
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
    for (final controleur in [_nom, _experience, _tarif]) {
      controleur.dispose();
    }
    super.dispose();
  }

  Future<void> _charger() async {
    try {
      final formulaire = await widget.api.formulaireProfil();
      if (!mounted) return;
      setState(() {
        _formulaire = formulaire;
        _erreurChargement = null;
        _nom.text = formulaire.nom;
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
      if (erreur.sessionPerdue) {
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

    final date = _dateAEnvoyer();
    if (formulaire.pourPersonne && date == null) {
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
        'nom': _nom.text,
        'quartier': _quartier?.text ?? '',
        'arrondissement': _arrondissement ?? '',
        if (formulaire.pourPersonne) ...{
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
      final texte = (await widget.api.enregistrerProfil(champs)).texte;
      if (!mounted) return;
      Navigator.of(context).pop(texte);
    } on ErreurApi catch (erreur) {
      if (!mounted) return;
      if (erreur.sessionPerdue) {
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
      appBar: AppBar(title: const Text('Modifier mon profil')),
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
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: _champs(context, formulaire),
            ),
          ),
        ),
      ],
    );
  }

  List<Widget> _champs(BuildContext context, FormulaireProfil formulaire) {
    const espace = SizedBox(height: 16);
    final texte = Theme.of(context).textTheme;
    final titre = texte.titleSmall?.copyWith(color: Couleurs.encre, fontWeight: FontWeight.w600);
    final aide = texte.bodyMedium?.copyWith(color: Couleurs.encrePale);
    const fort = TextStyle(fontWeight: FontWeight.w600, color: Couleurs.encre);
    final erreurEnvoi = _erreurEnvoi;
    final detail = _detail;
    final aideDetail = detail?.aide;

    return [
      TextField(
        controller: _nom,
        textCapitalization: TextCapitalization.words,
        textInputAction: TextInputAction.next,
        decoration: const InputDecoration(labelText: 'Votre nom'),
      ),
      espace,
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
      if (formulaire.pourPersonne) ...[
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
          for (final ligne in detail.lignes)
            Container(
              padding: const EdgeInsets.symmetric(vertical: 8),
              decoration: ligne.total
                  ? const BoxDecoration(border: Border(top: BorderSide(color: Couleurs.trait)))
                  : null,
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      ligne.libelle,
                      style: ligne.total ? fort : texte.bodyMedium?.copyWith(color: Couleurs.encreDouce),
                    ),
                  ),
                  Text(
                    ligne.montant,
                    style: ligne.retenue ? texte.bodyMedium?.copyWith(color: Couleurs.encreDouce) : fort,
                  ),
                ],
              ),
            ),
          if (aideDetail != null) Text(aideDetail, style: aide),
        ],
      ],
      const SizedBox(height: 24),
      if (erreurEnvoi != null) ...[
        Avertissement(texte: erreurEnvoi),
        espace,
      ],
      FilledButton(
        onPressed: _envoi ? null : _enregistrer,
        child: _envoi
            ? const SizedBox(
                width: 22,
                height: 22,
                child: CircularProgressIndicator(strokeWidth: 2.5, color: Couleurs.bleuFonce),
              )
            : const Text('Enregistrer'),
      ),
      const SizedBox(height: 8),
      OutlinedButton(
        onPressed: _envoi ? null : () => Navigator.of(context).pop(),
        style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48)),
        child: const Text('Annuler'),
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
