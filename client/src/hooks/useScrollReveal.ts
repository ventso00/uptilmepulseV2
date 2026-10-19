import { useEffect, useRef, useState } from "react";

interface ScrollRevealOptions {
  threshold?: number;
  rootMargin?: string;
  triggerOnce?: boolean;
  delay?: number;
}

export function useScrollReveal(options: ScrollRevealOptions = {}) {
  const {
    threshold = 0.1,
    rootMargin = "0px 0px -50px 0px",
    triggerOnce = true,
    delay = 0,
  } = options;

  const ref = useRef<HTMLElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [hasTriggered, setHasTriggered] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element || (triggerOnce && hasTriggered)) return;

    const observer = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            if (delay > 0) {
              setTimeout(() => setIsVisible(true), delay);
            } else {
              setIsVisible(true);
            }
            if (triggerOnce) {
              setHasTriggered(true);
              observer.unobserve(element);
            }
          } else if (!triggerOnce) {
            setIsVisible(false);
          }
        });
      },
      { threshold, rootMargin }
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [threshold, rootMargin, triggerOnce, delay, hasTriggered]);

  return { ref, isVisible };
}

/**
 * Hook for staggering multiple elements
 */
export function useStaggeredReveal(
  count: number,
  options: ScrollRevealOptions & { staggerDelay?: number } = {}
) {
  const { staggerDelay = 80, ...revealOptions } = options;
  const refs = useRef<(HTMLElement | null)[]>(Array(count).fill(null));
  const [visibleIndices, setVisibleIndices] = useState<Set<number>>(new Set());

  useEffect(() => {
    const elements = refs.current.filter(
      (el): el is HTMLElement => el !== null
    );
    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          const index = elements.indexOf(entry.target as HTMLElement);
          if (index === -1) return;

          if (entry.isIntersecting) {
            const delay = revealOptions.delay ?? 0 + index * staggerDelay;
            setTimeout(() => {
              setVisibleIndices(prev => new Set(prev).add(index));
            }, delay);
            if (revealOptions.triggerOnce !== false) {
              observer.unobserve(entry.target);
            }
          } else if (revealOptions.triggerOnce === false) {
            setVisibleIndices(prev => {
              const next = new Set(prev);
              next.delete(index);
              return next;
            });
          }
        });
      },
      {
        threshold: revealOptions.threshold ?? 0.1,
        rootMargin: revealOptions.rootMargin ?? "0px 0px -50px 0px",
      }
    );

    elements.forEach(el => observer.observe(el));
    return () => observer.disconnect();
  }, [
    staggerDelay,
    revealOptions.delay,
    revealOptions.threshold,
    revealOptions.rootMargin,
    revealOptions.triggerOnce,
  ]);

  const setRef = (index: number) => (el: HTMLElement | null) => {
    refs.current[index] = el;
  };

  return { setRef, visibleIndices };
}

/**
 * Parallax scroll hook - returns transform values based on scroll position
 */
export function useParallax(speed: number = 0.3) {
  const [offset, setOffset] = useState(0);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const handleScroll = () => {
      const rect = element.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const scrolled = -rect.top;
      const progress = scrolled / (rect.height + viewportHeight);
      setOffset(progress * speed * 100);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll(); // Initial calculation
    return () => window.removeEventListener("scroll", handleScroll);
  }, [speed]);

  return { ref, offset };
}

/**
 * Magnetic cursor effect hook
 */
export function useMagnetic(strength: number = 0.3) {
  const ref = useRef<HTMLElement>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const handleMove = (e: MouseEvent) => {
      const rect = element.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const deltaX = (e.clientX - centerX) * strength;
      const deltaY = (e.clientY - centerY) * strength;
      setTransform({ x: deltaX, y: deltaY });
    };

    const handleLeave = () => {
      setTransform({ x: 0, y: 0 });
    };

    element.addEventListener("mousemove", handleMove);
    element.addEventListener("mouseleave", handleLeave);
    return () => {
      element.removeEventListener("mousemove", handleMove);
      element.removeEventListener("mouseleave", handleLeave);
    };
  }, [strength]);

  return { ref, transform };
}
