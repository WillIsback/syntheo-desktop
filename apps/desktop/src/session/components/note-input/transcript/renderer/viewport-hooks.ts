import {
  type DependencyList,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

// Délai pendant lequel un défilement est attribué au dernier geste de
// l'utilisateur (l'inertie de la molette prolonge le geste).
const USER_SCROLL_GESTURE_WINDOW_MS = 800;

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? "auto" : "smooth";
}

export async function preserveScrollPosition<T>(
  element: HTMLElement | null,
  action: () => Promise<T>,
): Promise<T> {
  if (!element) {
    return action();
  }

  const scrollTop = element.scrollTop;
  let actionSettled = false;
  let contentChanged = false;
  let observer: MutationObserver | null = null;
  let cleanupTimer: number | null = null;

  const restore = () => {
    element.scrollTop = scrollTop;
  };

  const stopObserving = () => {
    observer?.disconnect();
    observer = null;
    if (cleanupTimer !== null) {
      window.clearTimeout(cleanupTimer);
      cleanupTimer = null;
    }
  };

  if (typeof MutationObserver !== "undefined") {
    observer = new MutationObserver(() => {
      contentChanged = true;
      restore();
      requestAnimationFrame(() => {
        restore();
        if (actionSettled) {
          stopObserving();
        }
      });
    });
    observer.observe(element, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  }

  try {
    return await action();
  } finally {
    actionSettled = true;
    restore();
    requestAnimationFrame(() => {
      restore();
      requestAnimationFrame(() => {
        restore();
        if (contentChanged) {
          stopObserving();
        }
      });
    });
    if (observer && !contentChanged) {
      cleanupTimer = window.setTimeout(stopObserving, 5_000);
    }
  }
}

// Suit la hauteur du contenu d'un conteneur défilant : le conteneur et ses
// enfants directs (un bloc par transcription). Contrairement à un
// MutationObserver sur tout le sous-arbre, rien ne se déclenche quand un
// partiel change un mot sans changer de hauteur (issue 281).
export function observeScrollContent(
  element: HTMLElement,
  onResize: () => void,
): () => void {
  const resizeObserver =
    typeof ResizeObserver === "undefined" ? null : new ResizeObserver(onResize);
  const observeChildren = () => {
    resizeObserver?.observe(element);
    for (const child of element.children) {
      resizeObserver?.observe(child);
    }
  };
  observeChildren();
  const mutationObserver =
    typeof MutationObserver === "undefined"
      ? null
      : new MutationObserver(() => {
          observeChildren();
          onResize();
        });
  mutationObserver?.observe(element, { childList: true });

  return () => {
    resizeObserver?.disconnect();
    mutationObserver?.disconnect();
  };
}

export function useScrollDetection(
  containerRef: RefObject<HTMLDivElement | null>,
  active = true,
) {
  const [isAtTop, setIsAtTop] = useState(true);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [canScroll, setCanScroll] = useState(false);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const [scrollTarget, setScrollTarget] = useState<"top" | "bottom" | null>(
    null,
  );
  const lastScrollTopRef = useRef(0);
  const userScrolledAwayRef = useRef(false);
  const wasActiveRef = useRef(active);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }

    lastScrollTopRef.current = element.scrollTop;
    // Seul un geste de l'utilisateur (molette, toucher, clavier, barre de
    // défilement) décroche le suivi. Un scrollTop qui recule parce que le
    // contenu a rétréci (segment provisoire remplacé, hauteur réestimée) ne
    // doit pas figer la marge en pleine écoute.
    let lastUserGestureAt = Number.NEGATIVE_INFINITY;
    const markUserGesture = () => {
      lastUserGestureAt = performance.now();
    };
    const isUserScroll = () =>
      performance.now() - lastUserGestureAt < USER_SCROLL_GESTURE_WINDOW_MS;

    const updateScrollState = () => {
      const bottomThreshold = 100;
      const scrollHeight = element.scrollHeight;
      const distanceToBottom =
        scrollHeight - element.scrollTop - element.clientHeight;
      const hasOverflow = scrollHeight - element.clientHeight > 1;
      const isNearBottom = distanceToBottom < bottomThreshold;
      const isAtExactTop = element.scrollTop <= 1;
      const isAtExactBottom = !isAtExactTop && distanceToBottom <= 1;
      setCanScroll(hasOverflow);
      setIsAtTop(!hasOverflow || isAtExactTop);
      setIsAtBottom(!hasOverflow || isAtExactBottom);
      setIsNearBottom(!hasOverflow || isNearBottom);

      return isNearBottom;
    };

    const handleScroll = () => {
      const isNearBottom = updateScrollState();

      const currentTop = element.scrollTop;
      const prevTop = lastScrollTopRef.current;
      lastScrollTopRef.current = currentTop;

      const scrolledUp = currentTop < prevTop - 2;
      const scrolledDown = currentTop > prevTop + 2;
      const userScroll = isUserScroll();
      if (scrolledUp && userScroll) {
        userScrolledAwayRef.current = true;
        setAutoScrollEnabled(false);
        setScrollTarget("bottom");
        return;
      }

      if (scrolledDown && userScroll) {
        setScrollTarget("top");
      }

      // Revenir en bas (à la main) relance le suivi automatique.
      if (isNearBottom && (userScroll || !userScrolledAwayRef.current)) {
        userScrolledAwayRef.current = false;
        setAutoScrollEnabled(true);
        if (userScroll) {
          setScrollTarget(null);
        }
      }
    };

    const gestureEvents = [
      "wheel",
      "touchstart",
      "touchmove",
      "keydown",
      "pointerdown",
    ] as const;
    gestureEvents.forEach((type) =>
      element.addEventListener(type, markUserGesture, { passive: true }),
    );
    element.addEventListener("scroll", handleScroll);
    handleScroll();

    // Une seule lecture de la mise en page par image, quand la hauteur du
    // contenu a changé.
    let frame: number | null = null;
    const scheduleUpdate = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        updateScrollState();
      });
    };
    const stopObserving = observeScrollContent(element, scheduleUpdate);

    return () => {
      gestureEvents.forEach((type) =>
        element.removeEventListener(type, markUserGesture),
      );
      element.removeEventListener("scroll", handleScroll);
      stopObserving();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [containerRef]);

  useEffect(() => {
    if (active && !wasActiveRef.current && !userScrolledAwayRef.current) {
      setAutoScrollEnabled(true);
      setScrollTarget(null);
    }

    wasActiveRef.current = active;
  }, [active]);

  const scrollToBottom = () => {
    const element = containerRef.current;
    if (!element) {
      return;
    }
    userScrolledAwayRef.current = false;
    setAutoScrollEnabled(true);
    setScrollTarget(null);
    element.scrollTo({ top: element.scrollHeight, behavior: scrollBehavior() });
  };

  const scrollToTop = () => {
    const element = containerRef.current;
    if (!element) {
      return;
    }
    // Remonter en haut est un choix explicite : on cesse de suivre l'écoute.
    userScrolledAwayRef.current = true;
    setAutoScrollEnabled(false);
    setScrollTarget(null);
    element.scrollTo({ top: 0, behavior: scrollBehavior() });
  };

  return {
    isAtTop,
    isAtBottom,
    isNearBottom,
    canScroll,
    autoScrollEnabled,
    scrollTarget,
    scrollToTop,
    scrollToBottom,
  };
}

// Garde la fin de la transcription à l'écran pendant l'écoute. Le suivi
// réagit aux changements de hauteur du contenu, pas aux partiels : un mot de
// plus qui ne fait pas grandir le texte ne déclenche ni lecture de la mise en
// page ni défilement. Les lectures (scrollHeight, scrollTop, clientHeight) se
// font au plus une fois par image, dans l'image elle-même (issue 281).
export function useAutoScroll(
  containerRef: RefObject<HTMLElement | null>,
  deps: DependencyList,
  enabled = true,
) {
  const frameRef = useRef<number | null>(null);
  const lastHeightRef = useRef<number | null>(null);
  const initialFlushRef = useRef(enabled);
  const previousEnabledRef = useRef(enabled);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }

    let forced = false;
    const flush = () => {
      frameRef.current = null;
      const height = element.scrollHeight;
      // Collé au bas avant que le contenu grandisse : la distance se mesure
      // avec la hauteur précédente.
      const previousHeight = lastHeightRef.current ?? height;
      lastHeightRef.current = height;
      const pinned =
        previousHeight - element.scrollTop - element.clientHeight < 80;
      const force = forced;
      forced = false;
      if (force || (enabled && pinned)) {
        element.scrollTop = height;
      }
    };

    // Deux images : la hauteur mesurée des lignes virtuelles est appliquée
    // une image après leur rendu.
    const schedule = (force = false) => {
      forced ||= force;
      if (!forced && !enabled) {
        return;
      }
      if (frameRef.current !== null) {
        return;
      }
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = requestAnimationFrame(flush);
      });
    };

    if (initialFlushRef.current) {
      initialFlushRef.current = false;
      schedule(true);
    } else if (enabled && !previousEnabledRef.current) {
      schedule(true);
    }
    previousEnabledRef.current = enabled;

    const stopObserving = observeScrollContent(element, () => schedule());

    return () => {
      stopObserving();
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, deps);
}

export function usePlaybackAutoScroll(
  containerRef: RefObject<HTMLElement | null>,
  currentMs: number,
  isPlaying: boolean,
) {
  const lastScrolledWordIdRef = useRef<string | null>(null);
  const userScrolledRef = useRef(false);
  const lastScrollTimeRef = useRef(0);

  const resetUserScroll = useCallback(() => {
    userScrolledRef.current = false;
  }, []);

  useEffect(() => {
    if (!isPlaying) {
      lastScrolledWordIdRef.current = null;
      userScrolledRef.current = false;
      return;
    }

    const element = containerRef.current;
    if (!element) {
      return;
    }

    const handleUserScroll = () => {
      const now = Date.now();
      if (now - lastScrollTimeRef.current > 100) {
        userScrolledRef.current = true;
      }
    };

    element.addEventListener("wheel", handleUserScroll);
    element.addEventListener("touchmove", handleUserScroll);

    return () => {
      element.removeEventListener("wheel", handleUserScroll);
      element.removeEventListener("touchmove", handleUserScroll);
    };
  }, [containerRef, isPlaying]);

  useEffect(() => {
    if (!isPlaying || userScrolledRef.current) {
      return;
    }

    const now = Date.now();
    if (now - lastScrollTimeRef.current < 200) {
      return;
    }

    const element = containerRef.current;
    if (!element) {
      return;
    }

    const currentLineEl = element.querySelector<HTMLElement>(
      "[data-line-current='true']",
    );

    if (!currentLineEl) {
      return;
    }

    const lineKey = currentLineEl.textContent?.slice(0, 50) ?? "";
    if (lineKey === lastScrolledWordIdRef.current) {
      return;
    }

    lastScrolledWordIdRef.current = lineKey;
    lastScrollTimeRef.current = now;

    currentLineEl.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }, [containerRef, currentMs, isPlaying]);

  return { resetUserScroll };
}
