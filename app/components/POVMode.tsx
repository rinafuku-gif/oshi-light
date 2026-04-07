"use client";

import { useEffect, useRef, useState, useCallback } from "react";

interface POVModeProps {
  text: string;
  textColor: string;
  acceleration: number;
  permissionState: "unknown" | "granted" | "denied" | "unavailable";
  onRequestPermission: () => Promise<void>;
}

// ============================================================
// テキストをビットマップ列配列に変換
// columns[x][y] = true/false
// heightRows: 縦方向の解像度
// ============================================================
function textToBitmap(text: string, heightRows: number): boolean[][] {
  const displayText = text || "推し活ライト";

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return [];

  const fontSize = heightRows * 0.75;
  ctx.font = `900 ${fontSize}px system-ui, -apple-system, sans-serif`;

  const metrics = ctx.measureText(displayText);
  const textWidth = Math.ceil(metrics.width);
  // 前後に10%パディング
  const padding = Math.ceil(textWidth * 0.1);

  const canvasWidth = textWidth + padding * 2;
  const canvasHeight = heightRows;

  canvas.width = canvasWidth;
  canvas.height = canvasHeight;

  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  ctx.font = `900 ${fontSize}px system-ui, -apple-system, sans-serif`;
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "middle";
  ctx.fillText(displayText, padding, canvasHeight / 2);

  const imageData = ctx.getImageData(0, 0, canvasWidth, canvasHeight);
  const data = imageData.data;

  const columns: boolean[][] = [];
  for (let x = 0; x < canvasWidth; x++) {
    const col: boolean[] = [];
    for (let y = 0; y < canvasHeight; y++) {
      const idx = (y * canvasWidth + x) * 4;
      col.push(data[idx] > 128);
    }
    columns.push(col);
  }

  return columns;
}

// ============================================================
// 16進カラーをRGB分解
// ============================================================
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace("#", "");
  const num = parseInt(clean, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

// ============================================================
// POVMode 本体
// ============================================================
export function POVMode({
  text,
  textColor,
  acceleration,
  permissionState,
  onRequestPermission,
}: POVModeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bitmapRef = useRef<boolean[][]>([]);
  const totalColsRef = useRef(0);

  // スクロールオフセット（実数、ピクセル単位）
  const offsetRef = useRef(0);
  // 速度（ピクセル/秒）
  const velocityRef = useRef(0);
  // 停止判定
  const isSwingingRef = useRef(false);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 加速度の前回値
  const prevAccRef = useRef(0);

  // rAF
  const rafRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);

  // タッチスワイプ
  const touchPrevXRef = useRef<number | null>(null);

  // デバッグ表示用state（間引き更新）
  const [debug, setDebug] = useState({ x: 0, vel: 0, offset: 0 });
  const debugCountRef = useRef(0);

  // ---- ビットマップ生成 ----
  const buildBitmap = useCallback(() => {
    const heightRows = 150;
    const cols = textToBitmap(text, heightRows);
    bitmapRef.current = cols;
    totalColsRef.current = cols.length;
    offsetRef.current = 0;
    velocityRef.current = 0;
  }, [text]);

  useEffect(() => {
    if (permissionState === "granted") {
      buildBitmap();
    }
  }, [buildBitmap, permissionState]);

  // ---- 加速度 → velocity 変換 ----
  useEffect(() => {
    if (permissionState !== "granted") return;

    const raw = acceleration;
    const delta = raw - prevAccRef.current;
    prevAccRef.current = raw;

    // 加速度の変化量でvelocityを更新
    // delta > 0 → 右方向にスクロール、delta < 0 → 左方向
    const SPEED_FACTOR = 80; // tuning: 大きいほど速い
    velocityRef.current = velocityRef.current * 0.6 + delta * SPEED_FACTOR * 0.4;

    const absVel = Math.abs(velocityRef.current);
    if (absVel > 5) {
      isSwingingRef.current = true;

      if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
      stopTimerRef.current = setTimeout(() => {
        isSwingingRef.current = false;
        velocityRef.current = 0;
      }, 400);
    }
  }, [acceleration, permissionState]);

  // ---- タッチスワイプ（テスト用） ----
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchPrevXRef.current = e.touches[0].clientX;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (touchPrevXRef.current === null) return;
    const currentX = e.touches[0].clientX;
    const deltaX = currentX - touchPrevXRef.current;
    touchPrevXRef.current = currentX;

    // スワイプdeltaXをpixel/frameとして速度に加算
    velocityRef.current = velocityRef.current * 0.5 + (-deltaX * 2) * 0.5;
    isSwingingRef.current = true;

    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    stopTimerRef.current = setTimeout(() => {
      isSwingingRef.current = false;
      velocityRef.current = 0;
    }, 400);
  }, []);

  const handleTouchEnd = useCallback(() => {
    touchPrevXRef.current = null;
  }, []);

  // ---- Canvas 描画ループ ----
  useEffect(() => {
    if (permissionState !== "granted") return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;

    const resize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    };
    resize();
    window.addEventListener("resize", resize);

    const rgb = hexToRgb(textColor);

    const loop = (now: number) => {
      if (lastTimeRef.current === 0) lastTimeRef.current = now;
      const dt = Math.min(now - lastTimeRef.current, 50); // 最大50ms（タブ非アクティブ対策）
      lastTimeRef.current = now;

      const screenW = canvas.width;
      const screenH = canvas.height;
      const bitmap = bitmapRef.current;
      const totalCols = totalColsRef.current;

      // ---- オフセット更新 ----
      if (totalCols > 0) {
        // velocity (px/sec) → dt(ms) で距離計算
        offsetRef.current += velocityRef.current * (dt / 1000) * screenW * 0.5;

        // オフセットをビットマップ幅でループ
        offsetRef.current =
          ((offsetRef.current % totalCols) + totalCols) % totalCols;
      }

      // ---- 描画 ----
      ctx.imageSmoothingEnabled = false;

      // 背景黒
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, screenW, screenH);

      if (totalCols === 0) {
        rafRef.current = requestAnimationFrame(loop);
        return;
      }

      const bitmapHeight = bitmap[0]?.length ?? 1;
      const pixelH = screenH / bitmapHeight; // 1ビットマップピクセルの画面上の高さ

      // 振っている間は明るく、止まっている間は薄く
      const absVel = Math.abs(velocityRef.current);
      const brightness = isSwingingRef.current
        ? Math.min(1, 0.3 + absVel * 0.05)
        : 0.15;

      // グロー設定
      const glowAlpha = brightness;
      ctx.shadowColor = textColor;
      ctx.shadowBlur = isSwingingRef.current ? 8 * dpr : 3 * dpr;

      const fillR = Math.round(rgb.r * brightness);
      const fillG = Math.round(rgb.g * brightness);
      const fillB = Math.round(rgb.b * brightness);
      ctx.fillStyle = `rgb(${fillR},${fillG},${fillB})`;

      // ビットマップを画面横幅にマッピング
      // 1スクリーンピクセル = 1ビットマップ列（最高解像度）
      for (let sx = 0; sx < screenW; sx++) {
        // このスクリーン列が対応するビットマップ列
        const bx = Math.floor((sx + offsetRef.current)) % totalCols;
        const col = bitmap[bx];
        if (!col) continue;

        for (let by = 0; by < bitmapHeight; by++) {
          if (col[by]) {
            const sy = by * pixelH;
            ctx.fillRect(sx, sy, 1, Math.ceil(pixelH));
          }
        }
      }

      // グロー後にリセット（他の描画に影響しないよう）
      ctx.shadowBlur = 0;

      // ---- デバッグ更新（間引き） ----
      debugCountRef.current++;
      if (debugCountRef.current % 10 === 0) {
        setDebug({
          x: Math.round(prevAccRef.current * 100) / 100,
          vel: Math.round(velocityRef.current * 10) / 10,
          offset: Math.round(offsetRef.current),
        });
      }

      // glowAlpha は計算済みだが未使用警告回避
      void glowAlpha;

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);

    return () => {
      window.removeEventListener("resize", resize);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      lastTimeRef.current = 0;
    };
  }, [permissionState, textColor]);

  // クリーンアップ
  useEffect(() => {
    return () => {
      if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // ============================================================
  // センサー未対応
  // ============================================================
  if (permissionState === "unavailable") {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-6 bg-black px-8">
        <div className="text-6xl">📱</div>
        <p className="text-white/70 text-center text-lg">
          このデバイスは加速度センサーに対応していません
        </p>
      </div>
    );
  }

  // ============================================================
  // 許可拒否
  // ============================================================
  if (permissionState === "denied") {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-6 bg-black px-8">
        <div className="text-6xl">🚫</div>
        <p className="text-white/70 text-center text-lg">
          モーションセンサーの許可が必要です
        </p>
        <button
          onClick={onRequestPermission}
          className="px-8 py-4 rounded-2xl text-white font-bold text-xl"
          style={{ background: textColor }}
        >
          許可する
        </button>
      </div>
    );
  }

  // ============================================================
  // 許可待ち（iOS：必ずタップが必要）
  // ============================================================
  if (permissionState === "unknown") {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-8 bg-black px-8">
        <div className="text-7xl">✋</div>
        <div className="text-center">
          <p className="text-white font-bold text-2xl mb-3">POVモード</p>
          <p className="text-white/60 text-base leading-relaxed">
            スマホを横に振ると<br />
            空中に文字が浮かびます
          </p>
        </div>
        <button
          onClick={onRequestPermission}
          className="px-10 py-5 rounded-2xl text-black font-black text-xl active:scale-95 transition-transform"
          style={{ background: textColor }}
        >
          タップしてセンサーON
        </button>
        <p className="text-white/30 text-sm text-center">
          iOS 13以降はモーションセンサーの<br />許可が必要です
        </p>
      </div>
    );
  }

  // ============================================================
  // granted — 縦ストライプ方式POVモード
  // ============================================================
  return (
    <div
      className="w-full h-full relative bg-black overflow-hidden"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0"
        style={{ display: "block" }}
      />

      {/* 振り方ガイド（停止中のみ表示） */}
      {!isSwingingRef.current && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <p className="text-white/20 text-sm text-center px-8">
            スマホを横に素早く振ってください<br />
            <span className="text-white/10 text-xs">または画面をスワイプでテスト</span>
          </p>
        </div>
      )}

      {/* デバッグ表示 */}
      <div className="absolute top-3 left-3 pointer-events-none z-50">
        <div
          className="font-mono leading-tight px-2 py-1 rounded"
          style={{
            color: "rgba(255,255,255,0.5)",
            background: "rgba(0,0,0,0.6)",
            fontSize: "10px",
          }}
        >
          <div>x: {debug.x.toFixed(3)}</div>
          <div>vel: {debug.vel.toFixed(1)}</div>
          <div>offset: {debug.offset}</div>
        </div>
      </div>
    </div>
  );
}
