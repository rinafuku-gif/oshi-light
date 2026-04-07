"use client";

import { useEffect, useRef } from "react";

interface StaticModeProps {
  text: string;
  textColor: string;
  bgColor: string;
  imageUrl: string | null;
  overlayText: boolean;
}

export function StaticMode({ text, textColor, bgColor, imageUrl, overlayText }: StaticModeProps) {
  const textRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // フォントサイズを画面幅に合わせて最大化（バイナリサーチ）
  useEffect(() => {
    const el = textRef.current;
    const container = containerRef.current;
    if (!el || !container || !text) return;

    const calcFontSize = () => {
      const containerW = container.clientWidth * 0.95;
      const containerH = container.clientHeight * 0.9;

      let lo = 16, hi = 400;
      while (lo < hi - 1) {
        const mid = Math.floor((lo + hi) / 2);
        el.style.fontSize = `${mid}px`;
        if (el.scrollWidth <= containerW && el.scrollHeight <= containerH) {
          lo = mid;
        } else {
          hi = mid;
        }
      }
      el.style.fontSize = `${lo}px`;
    };

    calcFontSize();
    window.addEventListener("resize", calcFontSize);
    return () => window.removeEventListener("resize", calcFontSize);
  }, [text]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full flex items-center justify-center relative overflow-hidden"
      style={{ backgroundColor: imageUrl ? undefined : bgColor }}
    >
      {imageUrl && (
        <img
          src={imageUrl}
          alt="推し"
          className="absolute inset-0 w-full h-full object-cover"
          draggable={false}
        />
      )}

      {(!imageUrl || overlayText) && (
        <div
          ref={textRef}
          className="relative z-10 font-black text-center leading-none px-2 select-none neon-glow"
          style={{
            color: textColor,
            textShadow: `0 0 20px ${textColor}, 0 0 40px ${textColor}66`,
            wordBreak: "keep-all",
            whiteSpace: "nowrap",
          }}
        >
          {text || "推し活ライト"}
        </div>
      )}

      {imageUrl && !overlayText && (
        <div className="absolute bottom-6 left-0 right-0 flex justify-center z-20 pointer-events-none">
          <span className="text-white/40 text-xs">タップして設定を開く</span>
        </div>
      )}
    </div>
  );
}
