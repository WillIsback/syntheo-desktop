#!/usr/bin/env bash
# Inférence officielle LocalVQE v1.4-AEC (GGML, C++) sur crates/aec/data/inputs, pour la fidélité
# du portage Rust (#293). Tout se passe dans $WORK, hors du dépôt.
#
#   WORK=/chemin/de/travail crates/aec/tools/localvqe_ref/run.sh
#   cargo run --release -p aec --features localvqe --example localvqe_bench -- \
#       --official "$WORK/out" --fidelity-only
#
# Prérequis : curl, hf (huggingface_hub), python3 avec numpy et soundfile, docker et l'image
# syntheo-dev:1 (cmake, g++). Le dépôt officiel est pris à la révision `LOCALVQE_REV`, ggml au
# commit épinglé par son sous-module, avec le correctif ggml-gru du dépôt.
set -euo pipefail

WORK=${WORK:?définir WORK}
LOCALVQE_REV=${LOCALVQE_REV:-main}
GGML_REV=c044a8eeae2591faa0950c8b5e514cbc4bbfc4ca
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
INPUTS=$(cd "$HERE/../../data/inputs" && pwd)
SRC=$WORK/src/LocalVQE-$LOCALVQE_REV

mkdir -p "$WORK/src" "$WORK/models" "$WORK/io" "$WORK/out" "$WORK/build"
if [ ! -d "$SRC" ]; then
  curl -sL "https://codeload.github.com/localai-org/LocalVQE/tar.gz/$LOCALVQE_REV" | tar xz -C "$WORK/src"
  rmdir "$SRC/ggml/vendor/ggml"
  curl -sL "https://codeload.github.com/ggml-org/ggml/tar.gz/$GGML_REV" | tar xz -C "$WORK/src"
  mv "$WORK/src/ggml-$GGML_REV" "$SRC/ggml/vendor/ggml"
  (cd "$SRC/ggml/vendor/ggml" && patch -p1 -s < ../../patches/ggml-gru.patch)
fi
hf download LocalAI-io/LocalVQE localvqe-v1.4-aec-200K-f32.gguf localvqe-v1.4-aec-2.7K-f32.gguf \
  --local-dir "$WORK/models" > /dev/null

python3 - "$INPUTS" "$WORK/io" <<'PY'
import sys, soundfile as sf
src, dst = sys.argv[1:]
for name in ["doubletalk_mic_sample", "doubletalk_lpb_sample", "syntheo_mic", "syntheo_lpb", "theo_mic", "theo_lpb"]:
    x, sr = sf.read(f"{src}/{name}.wav", dtype="float32")
    assert sr == 16000 and x.ndim == 1
    x.astype("<f4").tofile(f"{dst}/{name}.f32")
PY

cp "$HERE/lvqe_ref.cpp" "$WORK/build/"
docker run --rm --user "$(id -u):$(id -g)" -v "$WORK:$WORK" -w "$WORK" syntheo-dev:1 bash -c "
set -e
cmake -S $SRC/ggml -B build/cmake -DCMAKE_BUILD_TYPE=Release -DLOCALVQE_BUILD_SHARED=ON > build/cmake.log
cmake --build build/cmake -j\$(nproc) --target localvqe_shared dvqe_graph > build/build.log
B=build/cmake
g++ -O2 -ffp-contract=off -std=c++17 -I$SRC/ggml -I$SRC/ggml/vendor/ggml/include build/lvqe_ref.cpp \
  $SRC/ggml/daf_frontend.cpp -o build/lvqe_ref -L\$B/bin -Wl,-rpath,$WORK/\$B/bin -llocalvqe \
  -Wl,--start-group \$(find \$B -name 'libdvqe_*.a') -Wl,--end-group \
  \$(ls \$B/bin/libggml*.so | sed 's#.*/lib\(.*\)\.so\$#-l\1#' | sort -u) -lpthread -ldl
for spec in doubletalk:doubletalk_mic_sample:doubletalk_lpb_sample syntheo:syntheo_mic:syntheo_lpb theo:theo_mic:theo_lpb; do
  IFS=: read -r n m l <<< \"\$spec\"
  for v in 200K 2.7K; do
    echo -n \"\$n \$v : \"
    LVQE_REPS=3 build/lvqe_ref full models/localvqe-v1.4-aec-\$v-f32.gguf io/\$m.f32 io/\$l.f32 out/\${n}_\$v.f32 2>/dev/null
  done
  build/lvqe_ref daf models/localvqe-v1.4-aec-200K-f32.gguf io/\$m.f32 io/\$l.f32 out/\${n}_daf_e.f32 out/\${n}_daf_y.f32 2>/dev/null
done
"
