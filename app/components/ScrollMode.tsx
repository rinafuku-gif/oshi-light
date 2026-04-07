"use client";

import { useEffect, useRef, useState } from "react";

interface ScrollModeProps {
  text: string;
  textColor: string;
  bgColor: string;
  speed: number; // px per second
}

export function ScrollMode({ text, textColor, bgColor, speed }: ScrollModeProps) {
  const spanRef = useRef<HTMLSpanElement>(null);
  const [fontSize, setFontSize] = useState(80);

  // フォントサイズ計算とアニメーション時間計算を1つのuseEffectに統合
  useEffect(() => {
    const update = () => {
      setFontSize(Math.min(window.innerHeight * 0.35, 200));
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // スクロール時間を動的計算
  useEffect(() => {
    const el = spanRef.current;
    if (!el) return;

    const textWidth = el.scrollWidth;
    const totalDistance = window.innerWidth + textWidth;
    const duration = totalDistance / speed;

    el.style.animationDuration = `${duration}s`;
  }, [text, speed, fontSize]);

  return (
    <div
      className="w-full h-full flex items-center overflow-hidden"
      style={{ backgroundColor: bgColor }}
    >
      <div className="w-full flex items-center overflow-hidden">
        <span
          ref={spanRef}
          className="scroll-text font-black select-none"
          style={{
            color: textColor,
            fontSize: `${fontSize}px`,
            lineHeight: 1.1,
            textShadow: `0 0 20px ${textColor}, 0 0 40px ${textColor}88, 0 0 80px ${textColor}44`,
            animationDuration: "8s",
          }}
        >
          {text || "推し活ライト"}　　　　　{text || "推し活ライト"}
        </span>
      </div>
    </div>
  );
}
