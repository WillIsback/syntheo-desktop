const MAX_STREAMS = 64;
const MAX_INFLATE_BYTES = 2_000_000;

export function isPdfMaterial(contentType: string, filename: string): boolean {
  return (
    contentType === "application/pdf" ||
    contentType === "application/x-pdf" ||
    /\.pdf$/i.test(filename)
  );
}

export async function extractPdfText(
  bytes: Uint8Array | number[],
): Promise<string | null> {
  const data = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  if (data.length < 5) {
    return null;
  }

  const header = latin1Decode(data.subarray(0, 5));
  if (header !== "%PDF-") {
    return null;
  }

  const streams = collectPdfStreams(data).slice(0, MAX_STREAMS);
  const decoded = await Promise.all(
    streams.map((stream) => decodePdfStream(stream)),
  );

  const chunks: string[] = [];
  for (const content of decoded) {
    if (!content) {
      continue;
    }
    const text = extractPdfOperators(content);
    if (text) {
      chunks.push(text);
    }
  }

  const joined = normalizePdfText(chunks.join("\n"));
  return joined || null;
}

type PdfStream = {
  dictionary: string;
  data: Uint8Array;
};

type PdfToken = {
  value: string;
  end: number;
};

function normalizePdfText(text: string): string {
  return text
    .split("\n")
    .map((line) => trimSpacesAndTabs(line))
    .join("\n")
    .trim();
}

function trimSpacesAndTabs(line: string): string {
  let end = line.length;
  while (end > 0 && (line[end - 1] === " " || line[end - 1] === "\t")) {
    end -= 1;
  }
  return line.slice(0, end);
}

function collectPdfStreams(bytes: Uint8Array): PdfStream[] {
  const source = latin1Decode(bytes);
  const streams: PdfStream[] = [];
  const pattern = /stream\r?\n/g;
  let match: RegExpExecArray | null = pattern.exec(source);
  while (match) {
    const dictionary = source.slice(
      Math.max(0, match.index - 512),
      match.index,
    );
    const dataStart = match.index + match[0].length;
    const declaredLength = pdfStreamByteLength(dictionary, source);
    const dataEnd =
      declaredLength !== null
        ? Math.min(dataStart + declaredLength, bytes.length)
        : source.indexOf("endstream", dataStart);
    if (dataEnd < dataStart) {
      match = pattern.exec(source);
      continue;
    }

    streams.push({
      dictionary,
      data: bytes.subarray(dataStart, dataEnd),
    });
    match = pattern.exec(source);
  }
  return streams;
}

function pdfStreamByteLength(
  dictionary: string,
  source: string,
): number | null {
  const indirect = /\/Length\s+(\d+)\s+(\d+)\s+R\b/.exec(dictionary);
  if (indirect) {
    const objectId = indirect[1] ?? "";
    const generation = indirect[2] ?? "0";
    const object = new RegExp(
      String.raw`(?:^|\s)${objectId}\s+${generation}\s+obj\s+(\d+)\s+endobj`,
    ).exec(source);
    const resolved = Number(object?.[1]);
    return Number.isFinite(resolved) ? resolved : null;
  }

  const direct = /\/Length\s+(\d+)(?!\s+\d+\s+R\b)/.exec(dictionary);
  const declared = Number(direct?.[1]);
  return Number.isFinite(declared) ? declared : null;
}

async function decodePdfStream(stream: PdfStream): Promise<string | null> {
  const filtered = /\/Filter\b/.test(stream.dictionary);
  const flate = /\/FlateDecode\b/.test(stream.dictionary);
  if (flate) {
    const inflated = await inflateZlib(trimPdfStream(stream.data));
    if (!inflated) {
      return null;
    }
    return latin1Decode(inflated);
  }

  if (filtered) {
    return null;
  }

  return latin1Decode(trimPdfStream(stream.data));
}

function trimPdfStream(data: Uint8Array): Uint8Array {
  if (
    data.length >= 2 &&
    data[data.length - 2] === 0x0d &&
    data[data.length - 1] === 0x0a
  ) {
    return data.subarray(0, data.length - 2);
  }
  if (
    data.length >= 1 &&
    (data[data.length - 1] === 0x0a || data[data.length - 1] === 0x0d)
  ) {
    return data.subarray(0, data.length - 1);
  }
  return data;
}

async function inflateZlib(data: Uint8Array): Promise<Uint8Array | null> {
  const copy = Uint8Array.from(data);
  for (const format of ["deflate", "deflate-raw"] as const) {
    try {
      const decompressor = new DecompressionStream(format);
      const writer = decompressor.writable.getWriter();
      await writer.write(copy);
      await writer.close();
      const inflated = new Uint8Array(
        await new Response(decompressor.readable).arrayBuffer(),
      );
      if (inflated.byteLength > MAX_INFLATE_BYTES) {
        return inflated.subarray(0, MAX_INFLATE_BYTES);
      }
      return inflated;
    } catch {
      continue;
    }
  }
  return null;
}

function extractPdfOperators(content: string): string {
  const parts: string[] = [];
  let index = 0;

  while (index < content.length) {
    const operand = readPdfOperand(content, index);
    if (!operand) {
      index += 1;
      continue;
    }
    index = operand.end;
    if (operand.text !== null) {
      parts.push(operand.text);
    }
  }

  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function readPdfOperand(
  content: string,
  index: number,
): { end: number; text: string | null } | null {
  const parsed = readPdfOperandValue(content, index);
  if (!parsed) {
    return null;
  }
  return {
    end: parsed.end,
    text: isPdfShowOperator(content, parsed.end) ? parsed.value : null,
  };
}

function readPdfOperandValue(content: string, index: number): PdfToken | null {
  const char = content[index];
  if (char === "(") {
    return readPdfLiteral(content, index);
  }
  if (char === "<" && content[index + 1] !== "<") {
    return readPdfHex(content, index);
  }
  if (char === "[") {
    return readPdfTjArray(content, index);
  }
  return null;
}

const SHOW_OPERATOR_PATTERN = /^\s*('|"|Tj|TJ)/;

function isPdfShowOperator(content: string, index: number): boolean {
  return SHOW_OPERATOR_PATTERN.exec(content.slice(index)) !== null;
}

function readPdfLiteral(content: string, start: number): PdfToken | null {
  if (content[start] !== "(") {
    return null;
  }

  let depth = 0;
  let escaped = false;
  let value = "";

  for (let index = start; index < content.length; index += 1) {
    const char = content[index] ?? "";
    if (escaped) {
      value += unescapePdfChar(char);
      escaped = false;
    } else if (char === "\\") {
      escaped = true;
    } else if (char === "(") {
      depth += 1;
      if (depth > 1) {
        value += char;
      }
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return { value, end: index + 1 };
      }
      value += char;
    } else {
      value += char;
    }
  }

  return null;
}

function unescapePdfChar(char: string): string {
  switch (char) {
    case "n":
      return "\n";
    case "r":
      return "\r";
    case "t":
      return "\t";
    case "b":
      return "\b";
    case "f":
      return "\f";
    default:
      return char;
  }
}

function readPdfHex(content: string, start: number): PdfToken | null {
  if (content[start] !== "<") {
    return null;
  }

  const end = content.indexOf(">", start + 1);
  if (end < 0) {
    return null;
  }

  const clean = content.slice(start + 1, end).replace(/\s+/g, "");
  const hex = (clean + "0").slice(0, clean.length + (clean.length % 2));
  let value = "";
  for (let index = 0; index < hex.length; index += 2) {
    const code = Number.parseInt(hex.slice(index, index + 2), 16);
    if (Number.isFinite(code) && code >= 32 && code !== 127) {
      value += String.fromCodePoint(code);
    }
  }
  return { value, end: end + 1 };
}

function readPdfTjArray(content: string, start: number): PdfToken | null {
  if (content[start] !== "[") {
    return null;
  }

  const parts: string[] = [];
  let index = start + 1;
  while (index < content.length) {
    const char = content[index];
    if (char === "]") {
      return { value: parts.join(""), end: index + 1 };
    }
    if (char === "(") {
      const parsed = readPdfLiteral(content, index);
      if (!parsed) {
        return null;
      }
      parts.push(parsed.value);
      index = parsed.end;
      continue;
    }
    if (char === "<" && content[index + 1] !== "<") {
      const parsed = readPdfHex(content, index);
      if (!parsed) {
        return null;
      }
      parts.push(parsed.value);
      index = parsed.end;
      continue;
    }
    index += 1;
  }

  return null;
}

function latin1Decode(bytes: Uint8Array): string {
  return new TextDecoder("latin1").decode(bytes);
}
