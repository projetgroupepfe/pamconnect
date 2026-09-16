import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import 'api.dart';
import 'ecran_connexion.dart';
import 'ecran_mon_profil.dart';
import 'elements.dart';
import 'modeles.dart';
import 'theme.dart';

// Une photo de document reste lisible a cette taille, et pese bien moins
// que la limite du serveur. Sans reduction, la photo d'un telephone recent
// peut depasser 5 Mo et serait refusee.
const _cotePhotoMax = 2000.0;
const _qualitePhoto = 85;

/// La verification d'identite : l'etat du dossier, et l'envoi des deux
/// documents et de la photo du visage. La page du site, ecrite par le serveur.
///
/// Sur le site, chaque document se choisit dans un champ de fichier. Sur le
/// telephone, deux boutons : prendre une photo, ou choisir un fichier (une
/// image, ou un PDF comme l'extrait de casier judiciaire). Les formats et la
/// taille acceptes viennent du serveur, qui refait tous les controles.
class EcranVerification extends StatefulWidget {
  const EcranVerification({super.key, required this.api, this.auVoirSuite});

  final ApiPamConnect api;

  /// Une fois l'identite validee : retourner a son travail, Mes demandes pour
  /// l'employeur, Les demandes pour la personne qui repond.
  final VoidCallback? auVoirSuite;

  @override
  State<EcranVerification> createState() => _EcranVerificationState();
}

class _EcranVerificationState extends State<EcranVerification> with _ChoixDeDocuments<EcranVerification> {
  DossierDeVerification? _dossier;
  String? _erreurChargement;

  DocumentAEnvoyer? _cni;
  DocumentAEnvoyer? _casier;
  DocumentAEnvoyer? _photo;
  String? _erreurEnvoi;
  bool _envoi = false;

  @override
  void initState() {
    super.initState();
    _charger();
  }

  Future<void> _charger() async {
    try {
      final dossier = await widget.api.verification();
      if (!mounted) return;
      setState(() {
        _dossier = dossier;
        _erreurChargement = null;
      });
    } on ErreurApi catch (erreur) {
      if (!mounted) return;
      if (erreur.sessionPerdue) {
        revenirALaConnexion(context, widget.api, messageSessionPerdue);
        return;
      }
      setState(() => _erreurChargement = erreur.message);
    }
  }

  @override
  void _erreurDeChoix(String message) => setState(() => _erreurEnvoi = message);

  @override
  void _garder(String champ, DocumentAEnvoyer document) {
    setState(() {
      if (champ == 'cni') {
        _cni = document;
      } else if (champ == 'photo') {
        _photo = document;
      } else {
        _casier = document;
      }
      _erreurEnvoi = null;
    });
  }

  /// Le serveur decide : un document manquant, un format ou une taille
  /// refuses reviennent avec la phrase du site.
  Future<void> _envoyer() async {
    if (_envoi) return;
    final cni = _cni;
    final casier = _casier;
    final photo = _photo;
    setState(() {
      _envoi = true;
      _erreurEnvoi = null;
    });

    try {
      final texte = (await widget.api.envoyerDocuments({
        'cni': ?cni,
        'casier': ?casier,
        'photo': ?photo,
      }))
          .texte;
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
      appBar: AppBar(title: const Text("Vérification d'identité")),
      body: SafeArea(child: _corps(context)),
    );
  }

  Widget _corps(BuildContext context) {
    final erreurChargement = _erreurChargement;
    final dossier = _dossier;

    if (erreurChargement != null) {
      return ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Avertissement(texte: erreurChargement),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: () {
              setState(() => _erreurChargement = null);
              _charger();
            },
            child: const Text('Réessayer'),
          ),
        ],
      );
    }
    if (dossier == null) return const Center(child: CircularProgressIndicator());

    final texte = Theme.of(context).textTheme;
    final corps = texte.bodyLarge?.copyWith(color: Couleurs.encre);
    final gris = texte.bodyMedium?.copyWith(color: Couleurs.encreDouce);
    final aide = texte.bodyMedium?.copyWith(color: Couleurs.encrePale);
    final titreCarte = texte.titleMedium?.copyWith(color: Couleurs.bleu, fontWeight: FontWeight.w600);
    const gras = TextStyle(fontWeight: FontWeight.w700);
    final attente = dossier.attente;
    final motif = dossier.motifRefus;
    final auVoirSuite = widget.auVoirSuite;

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Align(
          alignment: Alignment.centerLeft,
          child: PastilleVerification(
            verification: VerificationDuProfil(statut: dossier.statut, libelle: dossier.libelle),
          ),
        ),
        const SizedBox(height: 16),
        // Un dossier envoye n'est pas un dossier oublie : depuis quand il
        // attend, et combien de temps il reste.
        if (attente != null) ...[
          _Cadre(
            children: [
              Text("Votre dossier est entre les mains de l'équipe", style: titreCarte),
              const SizedBox(height: 8),
              Text.rich(
                TextSpan(
                  children: [
                    for (final morceau in attente.morceaux)
                      TextSpan(text: morceau.texte, style: morceau.gras ? gras : null),
                  ],
                ),
                style: gris,
              ),
              const SizedBox(height: 8),
              Text(attente.aide, style: aide),
            ],
          ),
          const SizedBox(height: 16),
        ],
        if (motif != null) ...[
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Motif du refus', style: titreCarte),
                  const SizedBox(height: 8),
                  Text(motif, style: gris),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
        ],
        if (dossier.verifiee)
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    "Votre identité a été validée par notre équipe. Vous n'avez rien d'autre à faire.",
                    style: corps,
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Vos documents ont été supprimés de nos serveurs après la validation. Seule votre photo est gardée.',
                    style: gris,
                  ),
                  if (auVoirSuite != null) ...[
                    const SizedBox(height: 16),
                    FilledButton(onPressed: auVoirSuite, child: Text(dossier.suite.texte)),
                  ],
                ],
              ),
            ),
          )
        else ...[
          Text(dossier.chapeau, style: texte.bodyLarge?.copyWith(color: Couleurs.encreDouce)),
          const SizedBox(height: 12),
          // Le delai est annonce AVANT l'envoi, comme sur le site.
          Text.rich(
            TextSpan(
              children: [
                const TextSpan(text: 'Notre équipe examine votre dossier sous '),
                TextSpan(text: '${dossier.delaiHeures} heures', style: gras),
                const TextSpan(text: '.'),
              ],
            ),
            style: aide,
          ),
          const SizedBox(height: 16),
          _Cadre(
            children: [
              Text('Ce que nous faisons de vos documents', style: titreCarte),
              const SizedBox(height: 8),
              Text.rich(
                const TextSpan(
                  children: [
                    TextSpan(
                      text: "Ils sont consultables uniquement par l'équipe qui effectue la vérification. "
                          "Personne d'autre n'y a accès, d'aucun côté. ",
                    ),
                    TextSpan(text: 'Ils sont définitivement supprimés dès que votre dossier est traité', style: gras),
                    TextSpan(text: ' : seules la mention « identité vérifiée », sa date et votre photo sont conservées.'),
                  ],
                ),
                style: gris,
              ),
            ],
          ),
          const SizedBox(height: 16),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _Document(
                    titre: "Pièce d'identité",
                    aide: "Carte nationale d'identité ou passeport.",
                    document: _cni,
                    actif: !_envoi,
                    auPhoto: () => _prendrePhoto('cni'),
                    auFichier: () => _choisirFichier('cni', dossier.extensions),
                  ),
                  const SizedBox(height: 24),
                  _Document(
                    titre: 'Extrait de casier judiciaire',
                    aide: 'Datant de moins de 3 mois. Formats acceptés : ${dossier.extensions.join(', ')}. '
                        '${dossier.tailleMaxMo} Mo maximum par document.',
                    document: _casier,
                    actif: !_envoi,
                    auPhoto: () => _prendrePhoto('casier'),
                    auFichier: () => _choisirFichier('casier', dossier.extensions),
                  ),
                  const SizedBox(height: 24),
                  _Document(
                    titre: 'Une photo de votre visage',
                    aide: "L'équipe la compare à votre pièce d'identité. Ensuite, seule la personne avec qui "
                        'vous travaillerez la verra, une fois le choix fait.',
                    document: _photo,
                    actif: !_envoi,
                    auPhoto: () => _prendrePhoto('photo'),
                    auFichier: () => _choisirFichier('photo', dossier.extensionsPhoto),
                  ),
                  const SizedBox(height: 24),
                  if (_erreurEnvoi != null) ...[
                    Avertissement(texte: _erreurEnvoi!),
                    const SizedBox(height: 16),
                  ],
                  FilledButton(
                    onPressed: _envoi ? null : _envoyer,
                    child: _envoi
                        ? const SizedBox(
                            width: 22,
                            height: 22,
                            child: CircularProgressIndicator(strokeWidth: 2.5, color: Couleurs.bleuFonce),
                          )
                        : const Text('Envoyer mes documents'),
                  ),
                ],
              ),
            ),
          ),
          if (dossier.remplaceUnDossier) ...[
            const SizedBox(height: 12),
            Text("Un dossier est déjà en cours d'examen. Un nouvel envoi remplacera le précédent.", style: aide),
          ],
        ],
      ],
    );
  }
}

/// Un document a joindre, dans l'ordre du champ du site : le titre, les deux
/// facons de le fournir, la ligne qui dit ce qui est choisi, puis l'aide.
class _Document extends StatelessWidget {
  const _Document({
    required this.titre,
    required this.document,
    this.aide,
    required this.actif,
    required this.auPhoto,
    required this.auFichier,
  });

  final String titre;

  /// Absente quand le champ du site n'en a pas.
  final String? aide;
  final DocumentAEnvoyer? document;
  final bool actif;
  final VoidCallback auPhoto;
  final VoidCallback auFichier;

  @override
  Widget build(BuildContext context) {
    final texte = Theme.of(context).textTheme;
    final document = this.document;
    final aide = this.aide;
    final style = OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48));

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(titre, style: texte.titleSmall?.copyWith(color: Couleurs.encre, fontWeight: FontWeight.w600)),
        const SizedBox(height: 10),
        OutlinedButton.icon(
          onPressed: actif ? auPhoto : null,
          style: style,
          icon: const Icon(Icons.photo_camera_outlined),
          label: const Text('Prendre une photo'),
        ),
        const SizedBox(height: 8),
        OutlinedButton.icon(
          onPressed: actif ? auFichier : null,
          style: style,
          icon: const Icon(Icons.insert_drive_file_outlined),
          label: const Text('Choisir un fichier'),
        ),
        const SizedBox(height: 10),
        // La ligne du champ fichier du site : "Aucun fichier sélectionné."
        // tant que rien n'est choisi, puis le nom du fichier.
        Row(
          children: [
            if (document != null) ...[
              const Icon(Icons.check_circle_outline, size: 20, color: Couleurs.vert),
              const SizedBox(width: 8),
            ],
            Expanded(
              child: Text(
                document?.nom ?? 'Aucun fichier sélectionné.',
                overflow: TextOverflow.ellipsis,
                style: texte.bodyMedium?.copyWith(
                  color: document == null ? Couleurs.encreDouce : Couleurs.encre,
                ),
              ),
            ),
          ],
        ),
        if (aide != null) ...[
          const SizedBox(height: 6),
          Text(aide, style: texte.bodyMedium?.copyWith(color: Couleurs.encrePale)),
        ],
      ],
    );
  }
}

/// La carte bleu clair du site (.confiance).
class _Cadre extends StatelessWidget {
  const _Cadre({required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: Couleurs.bleuClair, borderRadius: BorderRadius.circular(rayon)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children),
    );
  }
}

/// Prendre une photo ou choisir un fichier : les memes gestes pour la
/// verification et pour la photo du profil.
mixin _ChoixDeDocuments<T extends StatefulWidget> on State<T> {
  void _garder(String champ, DocumentAEnvoyer document);
  void _erreurDeChoix(String message);

  Future<void> _prendrePhoto(String champ) async {
    try {
      final photo = await ImagePicker().pickImage(
        source: ImageSource.camera,
        // La photo du visage se prend en se regardant ; un document, avec
        // l'appareil de derriere.
        preferredCameraDevice: champ == 'photo' ? CameraDevice.front : CameraDevice.rear,
        maxWidth: _cotePhotoMax,
        maxHeight: _cotePhotoMax,
        imageQuality: _qualitePhoto,
      );
      if (photo == null) return;
      final document = DocumentAEnvoyer(nom: photo.name, taille: await photo.length(), lire: photo.openRead);
      if (mounted) _garder(champ, document);
    } catch (_) {
      if (!mounted) return;
      _erreurDeChoix("L'appareil photo n'a pas pu s'ouvrir. Choisissez plutôt un fichier.");
    }
  }

  Future<void> _choisirFichier(String champ, List<String> extensions) async {
    try {
      final choisis = await FilePicker.pickFiles(
        type: FileType.custom,
        // Le serveur ecrit ".pdf", le selecteur attend "pdf".
        allowedExtensions: [for (final extension in extensions) extension.replaceFirst('.', '')],
      );
      if (choisis.isEmpty) return;
      final fichier = choisis.first;
      final taille = await fichier.length();
      final DocumentAEnvoyer document;
      if (taille == null) {
        final octets = await fichier.readAsBytes();
        document = DocumentAEnvoyer(nom: fichier.name, taille: octets.length, lire: () => Stream.value(octets));
      } else {
        document = DocumentAEnvoyer(nom: fichier.name, taille: taille, lire: fichier.readAsByteStream);
      }
      if (mounted) _garder(champ, document);
    } catch (_) {
      if (!mounted) return;
      _erreurDeChoix("Ce fichier n'a pas pu être lu. Choisissez-en un autre.");
    }
  }
}

/// Ajouter ou changer sa photo, une fois l'identite verifiee : la photo du
/// visage et la piece d'identite, que l'equipe compare. La page du site.
class EcranMaPhoto extends StatefulWidget {
  const EcranMaPhoto({super.key, required this.api});

  final ApiPamConnect api;

  @override
  State<EcranMaPhoto> createState() => _EcranMaPhotoState();
}

class _EcranMaPhotoState extends State<EcranMaPhoto> with _ChoixDeDocuments<EcranMaPhoto> {
  EcranDeMaPhoto? _ecran;
  String? _erreurChargement;

  DocumentAEnvoyer? _photo;
  DocumentAEnvoyer? _piece;
  String? _erreurEnvoi;
  bool _envoi = false;

  @override
  void initState() {
    super.initState();
    _charger();
  }

  Future<void> _charger() async {
    try {
      final ecran = await widget.api.ecranMaPhoto();
      if (!mounted) return;
      setState(() {
        _ecran = ecran;
        _erreurChargement = null;
      });
    } on ErreurApi catch (erreur) {
      if (!mounted) return;
      if (erreur.sessionPerdue) {
        revenirALaConnexion(context, widget.api, messageSessionPerdue);
        return;
      }
      setState(() => _erreurChargement = erreur.message);
    }
  }

  @override
  void _erreurDeChoix(String message) => setState(() => _erreurEnvoi = message);

  @override
  void _garder(String champ, DocumentAEnvoyer document) {
    setState(() {
      if (champ == 'photo') {
        _photo = document;
      } else {
        _piece = document;
      }
      _erreurEnvoi = null;
    });
  }

  /// Le serveur decide : une piece manquante ou un format refuse reviennent
  /// avec la phrase du site.
  Future<void> _envoyer() async {
    if (_envoi) return;
    final photo = _photo;
    final piece = _piece;
    setState(() {
      _envoi = true;
      _erreurEnvoi = null;
    });

    try {
      final texte = (await widget.api.envoyerMaPhoto({
        'photo': ?photo,
        'cni': ?piece,
      }))
          .texte;
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
      appBar: AppBar(title: Text(_ecran?.titre ?? 'Ma photo')),
      body: SafeArea(child: _corps(context)),
    );
  }

  Widget _corps(BuildContext context) {
    final erreurChargement = _erreurChargement;
    final ecran = _ecran;
    final erreurEnvoi = _erreurEnvoi;

    if (erreurChargement != null) {
      return ListView(
        padding: const EdgeInsets.all(16),
        children: [Avertissement(texte: erreurChargement)],
      );
    }
    if (ecran == null) return const Center(child: CircularProgressIndicator());

    final texte = Theme.of(context).textTheme;
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text(ecran.texte, style: texte.bodyLarge?.copyWith(color: Couleurs.encreDouce)),
        const SizedBox(height: 16),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _Document(
                  titre: 'Ma photo',
                  document: _photo,
                  actif: !_envoi,
                  auPhoto: () => _prendrePhoto('photo'),
                  auFichier: () => _choisirFichier('photo', ecran.extensionsPhoto),
                ),
                const SizedBox(height: 24),
                _Document(
                  titre: "Ma pièce d'identité",
                  aide: 'Formats acceptés : ${ecran.extensions.join(', ')}. '
                      '${ecran.tailleMaxMo} Mo maximum par document.',
                  document: _piece,
                  actif: !_envoi,
                  auPhoto: () => _prendrePhoto('cni'),
                  auFichier: () => _choisirFichier('cni', ecran.extensions),
                ),
                const SizedBox(height: 24),
                if (erreurEnvoi != null) ...[
                  Avertissement(texte: erreurEnvoi),
                  const SizedBox(height: 16),
                ],
                // L'icone de l'envoi, comme le bouton du site.
                FilledButton.icon(
                  onPressed: _envoi ? null : _envoyer,
                  icon: _envoi
                      ? const SizedBox(
                          width: 22,
                          height: 22,
                          child: CircularProgressIndicator(strokeWidth: 2.5, color: Couleurs.bleuFonce),
                        )
                      : const Icon(Icons.file_upload_outlined),
                  label: const Text('Envoyer'),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}
