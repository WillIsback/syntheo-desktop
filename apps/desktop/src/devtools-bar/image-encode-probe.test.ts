import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type EncodeSample,
  formatFrame,
  installImageEncodeProbe,
} from "./image-encode-probe";

const proto = HTMLCanvasElement.prototype;
// Lu sans liaison de `this` : seule l'identité de la fonction compte.
const method = (name: "toDataURL" | "toBlob"): unknown =>
  Reflect.get(proto, name);
let originalToDataURL: unknown;
let originalToBlob: unknown;

beforeEach(() => {
  originalToDataURL = method("toDataURL");
  originalToBlob = method("toBlob");
  // jsdom n'implémente pas l'encodage : on le remplace par des doublures.
  proto.toDataURL = vi.fn(() => "data:image/png;base64,AAAA");
  proto.toBlob = vi.fn();
});

afterEach(() => {
  Reflect.set(proto, "toDataURL", originalToDataURL);
  Reflect.set(proto, "toBlob", originalToBlob);
});

function encodeAvatarForTest(canvas: HTMLCanvasElement) {
  return canvas.toDataURL();
}

describe("installImageEncodeProbe", () => {
  it("compte toDataURL avec type, taille et site de l'appelant", () => {
    const stub = method("toDataURL");
    const samples: EncodeSample[] = [];
    const uninstall = installImageEncodeProbe((sample) => samples.push(sample));

    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 32;
    expect(encodeAvatarForTest(canvas)).toBe("data:image/png;base64,AAAA");
    canvas.toBlob(() => {}, "image/jpeg", 0.9);

    expect(samples).toHaveLength(2);
    expect(samples[0]).toMatchObject({
      kind: "toDataURL",
      type: "image/png",
      size: "64x32",
    });
    expect(samples[0].site).toMatch(
      /^encodeAvatarForTest@image-encode-probe\.test\.ts:\d+:\d+$/,
    );
    expect(samples[1]).toMatchObject({ kind: "toBlob", type: "image/jpeg" });
    expect(samples[1].site).toMatch(/@image-encode-probe\.test\.ts:\d+:\d+$/);

    uninstall();
    expect(method("toDataURL")).toBe(stub);
    canvas.toDataURL();
    expect(samples).toHaveLength(2);
  });

  it("compte aussi un échec de l'encodage, sans l'avaler", () => {
    proto.toDataURL = vi.fn(() => {
      throw new DOMException("tainted", "SecurityError");
    });
    const samples: EncodeSample[] = [];
    const uninstall = installImageEncodeProbe((sample) => samples.push(sample));
    expect(() => document.createElement("canvas").toDataURL()).toThrow(
      "tainted",
    );
    expect(samples).toHaveLength(1);
    uninstall();
  });

  it("compte les débuts de glisser-déposer", () => {
    const samples: EncodeSample[] = [];
    const uninstall = installImageEncodeProbe((sample) => samples.push(sample));
    document.body.dispatchEvent(new Event("dragstart", { bubbles: true }));
    uninstall();
    document.body.dispatchEvent(new Event("dragstart", { bubbles: true }));
    expect(samples.map((sample) => sample.kind)).toEqual(["dragstart"]);
  });
});

describe("formatFrame", () => {
  it("lit les piles JSC (WebKit) et V8", () => {
    expect(
      formatFrame(
        "renderAvatarPng@tauri://localhost/assets/perf-zone-C7CSQoL6.js:1:12345",
      ),
    ).toBe("renderAvatarPng@perf-zone-C7CSQoL6.js:1:12345");
    expect(formatFrame("tauri://localhost/assets/index-abc.js:2:7")).toBe(
      "anonymous@index-abc.js:2:7",
    );
    expect(
      formatFrame("at Object.draw (http://localhost:1422/src/a.ts?t=1:3:4)"),
    ).toBe("draw@a.ts:3:4");
    expect(formatFrame("at http://localhost:1422/src/b.ts:5:6")).toBe(
      "anonymous@b.ts:5:6",
    );
    expect(formatFrame("[native code]")).toBe("_");
  });
});
