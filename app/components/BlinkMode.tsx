"use client";

interface BlinkModeProps {
  color: string;
  blinkSpeed: number; // ms per half-cycle
}

export function BlinkMode({ color, blinkSpeed }: BlinkModeProps) {
  return (
    <div
      className="w-full h-full"
      style={{
        backgroundColor: color,
        animation: `blink ${blinkSpeed * 2}ms step-start infinite`,
      }}
    />
  );
}
