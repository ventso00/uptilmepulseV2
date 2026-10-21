import { useEffect, useRef, useState } from "react";
import { useReveal } from "./Reveal";

/** Counts up once on reveal; reduced motion and non-visual contexts get the final value. */
export function CountUp({
  to,
  duration = 900,
  className = "",
}: {
  to: number;
  duration?: number;
  className?: string;
}) {
  const { ref, visible } = useReveal<HTMLSpanElement>();
  const [value, setValue] = useState(0);
  const frame = useRef(0);

  useEffect(() => {
    if (!visible) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setValue(to);
      return;
    }
    const start = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      setValue(Math.round(to * (1 - (1 - progress) ** 3)));
      if (progress < 1) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame.current);
  }, [visible, to, duration]);

  return (
    <span ref={ref} className={className}>
      {value}
    </span>
  );
}
