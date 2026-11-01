# LocalVQE v1.4-AEC : provenance et licence

Les fichiers `LocalVQEAECResidualMask.onnx` et `LocalVQEAECFrontend.json` viennent de
LocalVQE (© les auteurs de LocalVQE, Richard Palethorpe et contributeurs,
<https://github.com/localai-org/LocalVQE>). Ils sont distribués sous licence Apache 2.0 :
texte complet dans `LOCALVQE_LICENSE`.

| Fichier | Origine | SHA-256 |
|---|---|---|
| `LocalVQEAECResidualMask.onnx` | [soniqo/LocalVQE-v1.4-AEC-200K-ONNX-FP32](https://huggingface.co/soniqo/LocalVQE-v1.4-AEC-200K-ONNX-FP32), export ONNX tiers (opset 18) du masque neuronal de `localvqe-v1.4-aec-200K-f32.gguf` | `402644e7f28a6f2e10c7903f710cff907f490283a99fdc38aa0890e90bcc5cf0` |
| `LocalVQEAECFrontend.json` | même dépôt : poids du contrôleur du frontal adaptatif (2 742 valeurs) et fenêtre d'analyse | `e20551aa8a57a0d977e1ccb15f39f17d3a569d87ee8e8687848fb03096ff71ac` |

Source des deux exports : `localvqe-v1.4-aec-200K-f32.gguf` de
[LocalAI-io/LocalVQE](https://huggingface.co/LocalAI-io/LocalVQE), SHA-256
`b6e43138588a83bfe903ab5e143b4020b91c1e1629f5a575ac5855ff0003c731`, run `v1.4.r005`.

Vérifications faites avant import (#293) :

- les 2 742 poids du JSON sont identiques, valeur par valeur, aux tenseurs `daf.*` des GGUF
  officiels 200K et 2.7K (`localvqe-v1.4-aec-2.7K-f32.gguf`, SHA-256
  `d79f824f6ee6f58b2a7108d1df90db51c42c15a7400a5addbd3be9972ba657a4`) ;
- le masque ONNX, alimenté par le frontal officiel, reproduit la sortie officielle à 107–132 dB
  de SNR avec les matrices d'analyse du GGUF, à 72–101 dB avec la FFT utilisée ici
  (`crates/aec/tools/localvqe_ref/onnx_parity.py`).

Les fichiers ne sont pas modifiés. Le code Rust de `crates/aec/src/localvqe/` (`daf.rs`,
`controller.rs`) est un portage de `ggml/daf_frontend.cpp` de LocalVQE, sous la même licence
Apache 2.0 ; les modifications sont la traduction en Rust et l'usage de `realfft`.
