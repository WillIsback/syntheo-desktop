// Pilote de référence : inférence officielle LocalVQE en flux (trame de 256),
// 1 fil, entrées/sorties en float32 brut. Mode "daf" : sorties e / yhat du
// frontal seul, en ligne (pas de prime_delay), pour la parité par étage.
#include "localvqe_api.h"
#include "daf_frontend.h"
#include "localvqe_graph.h"
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>
#include <algorithm>

static std::vector<float> rd(const char* p) {
    FILE* f = fopen(p, "rb"); if (!f) { perror(p); exit(1); }
    fseek(f, 0, SEEK_END); long n = ftell(f) / 4; fseek(f, 0, SEEK_SET);
    std::vector<float> v(n); if (fread(v.data(), 4, n, f) != (size_t)n) exit(1); fclose(f); return v;
}
static void wr(const char* p, const std::vector<float>& v) {
    FILE* f = fopen(p, "wb"); fwrite(v.data(), 4, v.size(), f); fclose(f);
}

int main(int argc, char** argv) {
    if (argc < 6) { fprintf(stderr, "usage: lvqe_ref full|daf model.gguf mic.f32 ref.f32 out.f32 [yhat.f32]\n"); return 1; }
    std::string mode = argv[1];
    auto mic = rd(argv[3]), ref = rd(argv[4]);
    const int hop = 256;
    int n = (int)std::min(mic.size(), ref.size()) / hop * hop;
    std::vector<float> out(n, 0.0f), yh(n, 0.0f);
    if (mode == "daf" || mode == "daf-noalign") {
        dvqe_graph_model m;
        if (!load_graph_model(argv[2], m, false)) return 1;
        daf_frontend fe;
        if (!daf_init(fe, m)) { fprintf(stderr, "no daf\n"); return 1; }
        fe.enable_prealign = (mode == "daf");
        for (int t = 0; t < n; t += hop)
            daf_process(fe, mic.data() + t, ref.data() + t, hop, out.data() + t, yh.data() + t);
        wr(argv[5], out);
        if (argc > 6) wr(argv[6], yh);
        printf("daf: n=%d shift=%d locked=%d conf=%.2f\n", n, fe.cur_shift, (int)fe.gcc_locked, fe.gcc_conf);
        return 0;
    }
    localvqe_options_t o = localvqe_options_new();
    localvqe_options_set_model_path(o, argv[2]);
    localvqe_options_set_threads(o, 1);
    localvqe_ctx_t ctx = localvqe_new_with_options(o);
    localvqe_options_free(o);
    if (!ctx) { fprintf(stderr, "load failed\n"); return 1; }
    const char* reps_env = getenv("LVQE_REPS");
    const unsigned long reps_raw = reps_env ? strtoul(reps_env, nullptr, 10) : 1;
    const int reps = (int)std::min(std::max(reps_raw, 1ul), 100ul);
    double best = 1e9;
    for (int r = 0; r < reps; r++) {
        localvqe_reset(ctx);
        auto t0 = std::chrono::steady_clock::now();
        for (int t = 0; t < n; t += hop)
            if (localvqe_process_frame_f32(ctx, mic.data() + t, ref.data() + t, hop, out.data() + t)) return 2;
        double s = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
        best = std::min(best, s);
    }
    wr(argv[5], out);
    printf("full: n=%d audio=%.2fs cpu=%.3fs ms_per_hop=%.3f cpu_per_audio_s=%.4f\n",
           n, n / 16000.0, best, 1000.0 * best / (n / hop), best / (n / 16000.0));
    localvqe_free(ctx);
    return 0;
}
