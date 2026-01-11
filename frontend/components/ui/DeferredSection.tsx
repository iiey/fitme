"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { CardSkeleton } from "./Skeleton";

export function DeferredSection({
  children,
  height = 200,
}: {
  children: ReactNode;
  height?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return <div ref={ref}>{visible ? children : <CardSkeleton height={height} />}</div>;
}
