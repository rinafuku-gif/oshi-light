"use client";

import { useEffect, useRef } from "react";

interface BlinkModeProps {
  color: string;
  blinkSpeed: number; // ms per half-cycle
  bpm: number;
  useBpm: boolean;
}

export function BlinkMode({ color, blinkSpeed, bpm, useBpm }: BlinkModeProps) {
  const divRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = divRef.current;
    if (!el) return;

    const halfCycle = useBpm
      ? (60000 / bpm) / 2
      : blinkSpeed;

    el.style.animation = `blink ${halfCycle * 2}ms step-start infinite`;
  }, [blinkSpeed, bpm, useBpm]);

  return (
    <div
      ref={divRef}
      className="w-full h-full"
      style={{ backgroundColor: color }}
    />
  );
}
