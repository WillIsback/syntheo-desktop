/**
 * Sonde des encodages d'image côté interface, pour le résumé `[render-perf]`
 * (issue 289 : libpng et zlib compressent en continu dans WebKitWebProcess
 * pendant l'écoute, sans qu'on sache quel code les appelle).
 *
 * Tant qu'elle est installée, chaque appel aux API qui encodent (ou font
 * encoder) une image est compté avec un site d'appel court, lu dans la pile :
 * `fonction@fichier:ligne:colonne`. En build minifiée, le fichier est le
 * chunk Vite (`perf-zone-C7CSQoL6.js:1:12345`), qu'on retrouve dans `dist`.
 *
 * Si rien n'est compté alors que le profil montre encore `deflate`, l'encodage
 * vient de WebKit lui-même (glisser-déposer, presse-papiers natif,
 * inspecteur Web ouvert avec capture d'écran de la chronologie…), pas du
 * JavaScript de l'app.
 *
 * Installée seulement en build devtools, pendant l'écoute ; `uninstall`
 * remet les fonctions d'origine.
 */

export type EncodeSample = {
  /** API appelée : `toDataURL`, `toBlob`, `convertToBlob`, … */
  kind: string;
  /** Type MIME demandé (`image/png` par défaut) ou type de la source. */
  type: string;
  /** `largeurxhauteur` du canevas, `na` si sans objet. */
  size: string;
  /** `fonction@fichier:ligne:colonne` de l'appelant, `_` si illisible. */
  site: string;
  /** Durée de la partie synchrone de l'appel. */
  durationMs: number;
};

type EncodeListener = (sample: EncodeSample) => void;

const DEFAULT_IMAGE_TYPE = "image/png";
const MAX_FUNCTION_NAME = 24;

type Restore = () => void;

export function installImageEncodeProbe(onEncode: EncodeListener): Restore {
  const restores: Restore[] = [];

  const record = (
    kind: string,
    type: string,
    size: string,
    startedAt: number,
  ) => {
    try {
      onEncode({
        kind,
        type,
        size,
        // Cadres : captureCallSite, record, l'enveloppe, puis l'appelant.
        site: captureCallSite(3),
        durationMs: performance.now() - startedAt,
      });
    } catch {
      // La sonde ne doit jamais casser l'appel qu'elle observe.
    }
  };

  if (typeof HTMLCanvasElement !== "undefined") {
    const proto = HTMLCanvasElement.prototype;
    restores.push(
      patchMethod(
        proto,
        "toDataURL",
        (original) =>
          function toDataURL(this: HTMLCanvasElement, ...args: unknown[]) {
            const startedAt = performance.now();
            try {
              return original.apply(this, args);
            } finally {
              record(
                "toDataURL",
                imageType(args[0]),
                canvasSize(this),
                startedAt,
              );
            }
          },
      ),
      patchMethod(
        proto,
        "toBlob",
        (original) =>
          function toBlob(this: HTMLCanvasElement, ...args: unknown[]) {
            const startedAt = performance.now();
            try {
              return original.apply(this, args);
            } finally {
              record("toBlob", imageType(args[1]), canvasSize(this), startedAt);
            }
          },
      ),
    );
  }

  if (typeof OffscreenCanvas !== "undefined") {
    restores.push(
      patchMethod(
        OffscreenCanvas.prototype,
        "convertToBlob",
        (original) =>
          function convertToBlob(this: OffscreenCanvas, ...args: unknown[]) {
            const startedAt = performance.now();
            try {
              return original.apply(this, args);
            } finally {
              const options = args[0] as { type?: unknown } | undefined;
              record(
                "convertToBlob",
                imageType(options?.type),
                canvasSize(this),
                startedAt,
              );
            }
          },
      ),
    );
  }

  if (typeof globalThis.createImageBitmap === "function") {
    restores.push(
      patchMethod(
        globalThis,
        "createImageBitmap",
        (original) =>
          function createImageBitmap(this: unknown, ...args: unknown[]) {
            const startedAt = performance.now();
            try {
              return original.apply(this, args);
            } finally {
              record("createImageBitmap", sourceType(args[0]), "na", startedAt);
            }
          },
      ),
    );
  }

  if (typeof Clipboard !== "undefined") {
    restores.push(
      patchMethod(
        Clipboard.prototype,
        "write",
        (original) =>
          function write(this: Clipboard, ...args: unknown[]) {
            const startedAt = performance.now();
            try {
              return original.apply(this, args);
            } finally {
              record(
                "clipboard.write",
                clipboardTypes(args[0]),
                "na",
                startedAt,
              );
            }
          },
      ),
    );
  }

  if (typeof document !== "undefined") {
    // WebKit fabrique une image de l'élément glissé : on compte les débuts
    // de glisser-déposer, sans pile (l'appelant est le moteur).
    const onDragStart = () => {
      onEncode({
        kind: "dragstart",
        type: "na",
        size: "na",
        site: "_",
        durationMs: 0,
      });
    };
    document.addEventListener("dragstart", onDragStart, true);
    restores.push(() =>
      document.removeEventListener("dragstart", onDragStart, true),
    );
  }

  return () => {
    for (const restore of restores.reverse()) restore();
  };
}

type AnyFunction = (...args: unknown[]) => unknown;

function patchMethod(
  target: object,
  name: string,
  wrap: (original: AnyFunction) => AnyFunction,
): Restore {
  const holder = target as Record<string, unknown>;
  const original = holder[name];
  if (typeof original !== "function") return () => {};
  const wrapped = wrap(original as AnyFunction);
  holder[name] = wrapped;
  return () => {
    // Ne pas écraser un autre correctif posé après le nôtre.
    if (holder[name] === wrapped) holder[name] = original;
  };
}

function imageType(value: unknown): string {
  return typeof value === "string" && value ? value : DEFAULT_IMAGE_TYPE;
}

function canvasSize(canvas: { width: number; height: number }): string {
  return `${canvas.width}x${canvas.height}`;
}

function sourceType(source: unknown): string {
  if (source && typeof source === "object") {
    return source.constructor?.name || "object";
  }
  return typeof source;
}

function clipboardTypes(items: unknown): string {
  if (!Array.isArray(items)) return "na";
  const types = items.flatMap((item) =>
    Array.isArray((item as ClipboardItem | null)?.types)
      ? [...(item as ClipboardItem).types]
      : [],
  );
  return types.length ? types.join("+") : "na";
}

/**
 * Cadre de pile numéro `skip` (0 : `captureCallSite` lui-même), mis en forme
 * courte. Pile JSC : `fn@url:l:c` ; V8 : `at fn (url:l:c)`. JSC élimine
 * les appels terminaux en mode strict : si l'appelant fait
 * `return canvas.toDataURL()`, c'est son propre appelant qui apparaît.
 */
export function captureCallSite(skip: number): string {
  const stack = new Error("encode").stack ?? "";
  const frames = stack
    .split("\n")
    .map((entry) => entry.trim())
    .filter((entry) => entry && !/^Error\b/.test(entry));
  const frame = frames[skip];
  return frame ? formatFrame(frame) : "_";
}

export function formatFrame(frame: string): string {
  // V8 : `at fn (url:l:c)` ou `at url:l:c`.
  const v8 = /^at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(frame);
  // JSC : `fn@url:l:c` ou `url:l:c`.
  const jsc = /^(?:(.*?)@)?(.+?):(\d+):(\d+)$/.exec(frame);
  const match = v8 ?? jsc;
  if (!match) return "_";
  const [, fn, url, line, column] = match;
  const name = (fn ?? "")
    .replace(/^(?:async |new )/, "")
    .split(/[.\s]/)
    .pop()
    ?.slice(0, MAX_FUNCTION_NAME);
  const file =
    url
      .replace(/[?#].*$/, "")
      .split("/")
      .pop() || "_";
  return `${name || "anonymous"}@${file}:${line}:${column}`;
}
