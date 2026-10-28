export function parseFrontmatter(content: string): {
  date: string | null;
  summary: string | null;
  body: string;
} {
  const trimmed = content.trim();
  // Les délimiteurs de frontmatter n'acceptent que des espaces/tabs (et un CR
  // éventuel avant le saut de ligne) : `\s*` autoriserait `\n` et se confondrait
  // avec les boucles `[\s\S]*?`, ce qui rend le motif quadratique sur une entrée
  // hostile (ReDoS). Le motif ci-dessous reste linéaire.
  const frontmatterMatch = trimmed.match(
    /^---[ \t\r]*\n([\s\S]*?)\n---[ \t\r]*\n([\s\S]*)$/,
  );

  if (!frontmatterMatch) {
    return { date: null, summary: null, body: trimmed };
  }

  const frontmatterBlock = frontmatterMatch[1];
  // L'ancien `\s*` avalait les lignes vides situées après le délimiteur
  // fermant ; on les retire ici pour conserver exactement le même corps.
  const body = frontmatterMatch[2].replace(/^[\s]*/, "");

  const date = readFrontmatterValue(frontmatterBlock, "date");
  const summary = readFrontmatterValue(frontmatterBlock, "summary");

  return { date, summary, body };
}

function readFrontmatterValue(block: string, key: string) {
  const match = block.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  if (!match) return null;

  const value = match[1].trim();
  const quote = value[0];
  if ((quote === `"` || quote === `'`) && value.endsWith(quote)) {
    return value.slice(1, -1);
  }

  return value;
}

export function processContent(raw: string): {
  content: string;
  date: string | null;
  summary: string | null;
} {
  const { date, summary, body } = parseFrontmatter(raw);
  return { content: body, date, summary };
}
