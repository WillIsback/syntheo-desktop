/** Animation en cours, nommée par des noms de code seulement (jamais de contenu). */
export type AnimationSample = { kind: string; name: string; target: string };

export function describeAnimation(animation: Animation): AnimationSample {
  const named = animation as Animation & {
    animationName?: string;
    transitionProperty?: string;
  };
  const kind = animation.constructor?.name || "Animation";
  const name = named.transitionProperty ?? named.animationName ?? "_";
  const effect = animation.effect as KeyframeEffect | null;
  const target = effect?.target ?? null;
  return { kind, name, target: target ? describeElement(target) : "_" };
}

/**
 * `span[data-level-meter]>i` : balise de l'élément animé, précédée du plus
 * proche ancêtre marqué d'un attribut `data-*` (nom seulement, sans valeur).
 */
export function describeElement(element: Element): string {
  const self = `${element.tagName.toLowerCase()}${dataAttributeName(element)}`;
  if (dataAttributeName(element)) return self;
  for (
    let parent = element.parentElement;
    parent;
    parent = parent.parentElement
  ) {
    const attribute = dataAttributeName(parent);
    if (attribute) {
      return `${parent.tagName.toLowerCase()}${attribute}>${self}`;
    }
  }
  return self;
}

function dataAttributeName(element: Element): string {
  for (const attribute of element.getAttributeNames()) {
    if (attribute.startsWith("data-")) return `[${attribute}]`;
  }
  return "";
}
