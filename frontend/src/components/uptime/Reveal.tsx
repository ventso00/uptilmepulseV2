import { useEffect, useRef, useState } from "react";

export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { ref, visible };
}

type RevealDirection = "up" | "down" | "left" | "right" | "scale" | "blur";

const offsetClass: Record<RevealDirection, string> = {
  up: "translate-y-6",
  down: "-translate-y-6",
  left: "-translate-x-8",
  right: "translate-x-8",
  scale: "scale-95",
  blur: "translate-y-4 blur-[6px]",
};

/**
 * Scroll-reveal wrapper. Enters from `direction`, staggers with `delay`, and
 * shows instantly for reduced-motion users (never leaves content hidden).
 */
export function Reveal({
  children,
  delay = 0,
  className = "",
  direction = "up",
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
  direction?: RevealDirection;
}) {
  const { ref, visible } = useReveal<HTMLDivElement>();
  const hidden = offsetClass[direction];
  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      className={`transition-all duration-700 ease-out motion-reduce:transition-none ${
        visible
          ? "translate-x-0 translate-y-0 scale-100 opacity-100 blur-none"
          : `${hidden} opacity-0 motion-reduce:translate-x-0 motion-reduce:translate-y-0 motion-reduce:scale-100 motion-reduce:opacity-100 motion-reduce:blur-none`
      } ${className}`}
    >
      {children}
    </div>
  );
}
