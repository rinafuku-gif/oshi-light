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
// テキストをビットマップ列配列に変換（初回1回だけ実行）
// columns[x][y] = true/false
// heightRows: 縦方向の解像度（50行）
// ============================================================
function textToBitmap(text: string, heightRows: number): boolean[][] {
  const displayText = text || "推し活ライト";

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return [];

  const fontSize = Math.floor(heightRows * 0.75);
  ctx.font = `900 ${fontSize}px system-ui, -apple-system, sans-serif`;

  const metrics = ctx.measureText(displayText);
  const textWidth = Math.ceil(metrics.width);
  // 左右に20%パディング
  const padding = Math.ceil(textWidth * 0.2);

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
// POVMode 本体 — 真バーサライト方式
// 毎フレーム: 半透明黒オーバーレイ + 現在列1本だけ描画
// ============================================================
export function POVMode({
  text,
  textColor,
  acceleration,
  permissionState,
  onRequestPermission,
}: POVModeProps) {
  // ---- ビットマップデータ ----
  const bitmapRef = useRef<boolean[][]>([]);
  const totalColsRef = useRef(0);

  // ---- スクロールオフセット（実数、列インデックス単位） ----
  const offsetRef = useRef(0);
  const velocityRef = useRef(0);
  const isSwingingRef = useRef(false);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- 加速度の前回値 ----
  const prevAccRef = useRef(0);

  // ---- rAF ----
  const rafRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);

  // ---- タッチスワイプ ----
  const touchPrevXRef = useRef<number | null>(null);

  // ---- Canvas ----
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // ---- デバッグ（10フレームに1回だけsetState） ----
  const [debug, setDebug] = useState({ x: 0, vel: 0, col: 0 });
  const debugCountRef = useRef(0);

  // ---- パラメータ ----
  const HEIGHT_ROWS = 50;
  const SPEED_FACTOR = 80;

  // ============================================================
  // ビットマップ生成
  // ============================================================
  const buildBitmap = useCallback(() => {
    const cols = textToBitmap(text, HEIGHT_ROWS);
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

  // ============================================================
  // 加速度 → velocity 変換
  // ============================================================
  useEffect(() => {
    if (permissionState !== "granted") return;

    const raw = acceleration;
    const delta = raw - prevAccRef.current;
    prevAccRef.current = raw;

    velocityRef.current = velocityRef.current * 0.6 + delta * SPEED_FACTOR * 0.4;

    const absVel = Math.abs(velocityRef.current);
    if (absVel > 0.05) {
      isSwingingRef.current = true;

      if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
      stopTimerRef.current = setTimeout(() => {
        isSwingingRef.current = false;
        velocityRef.current = 0;
      }, 400);
    }
  }, [acceleration, permissionState]);

  // ============================================================
  // タッチスワイプ（テスト用）
  // ============================================================
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchPrevXRef.current = e.touches[0].clientX;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (touchPrevXRef.current === null) return;
    const currentX = e.touches[0].clientX;
    const deltaX = currentX - touchPrevXRef.current;
    touchPrevXRef.current = currentX;

    velocityRef.current = velocityRef.current * 0.5 + (-deltaX * 0.5) * 0.5;
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

  // ============================================================
  // rAFループ — 真バーサライト方式
  // ============================================================
  useEffect(() => {
    if (permissionState !== "granted") return;

    const loop = (now: number) => {
      if (lastTimeRef.current === 0) lastTimeRef.current = now;
      const dt = Math.min(now - lastTimeRef.current, 50);
      lastTimeRef.current = now;

      const bitmap = bitmapRef.current;
      const totalCols = totalColsRef.current;
      const canvas = canvasRef.current;

      if (totalCols === 0 || !canvas) {
        rafRef.current = requestAnimationFrame(loop);
        return;
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        rafRef.current = requestAnimationFrame(loop);
        return;
      }

      const canvasW = canvas.width;
      const canvasH = canvas.height;
      const isSwinging = isSwingingRef.current;

      // ---- 毎フレーム: 半透明黒オーバーレイでフェードアウト ----
      // isSwinging中も停止中も常にオーバーレイをかける
      // → 停止するとすぐ黒になり、振ると残像が尾を引く
      ctx.fillStyle = "rgba(0, 0, 0, 0.06)";
      ctx.fillRect(0, 0, canvasW, canvasH);

      if (isSwinging) {
        // ---- オフセット更新（列単位） ----
        offsetRef.current += velocityRef.current * (dt / 1000);
        offsetRef.current = ((offsetRef.current % totalCols) + totalCols) % totalCols;

        const offset = offsetRef.current;

        // ---- 現在列のX位置を計算 ----
        const currentCol = Math.floor(offset) % totalCols;
        const screenX = (currentCol / totalCols) * canvasW;
        const lineWidth = Math.max(6, Math.ceil(canvasW / totalCols) * 2);
        const cellH = canvasH / HEIGHT_ROWS;

        // ---- 現在列のONピクセルだけを縦ラインとして描画 ----
        const col = bitmap[currentCol];
        if (col) {
          ctx.fillStyle = textColor;
          ctx.shadowBlur = 20;
          ctx.shadowColor = textColor;

          for (let y = 0; y < HEIGHT_ROWS; y++) {
            if (col[y]) {
              ctx.fillRect(screenX, y * cellH, lineWidth, cellH);
            }
          }

          ctx.shadowBlur = 0;
        }

        // ---- デバッグ更新（10フレームに1回） ----
        debugCountRef.current++;
        if (debugCountRef.current % 10 === 0) {
          setDebug({
            x: Math.round(prevAccRef.current * 100) / 100,
            vel: Math.round(velocityRef.current * 10) / 10,
            col: currentCol,
          });
        }
      } else {
        // 振っていない: オーバーレイのみで自然にフェードアウト
        debugCountRef.current++;
        if (debugCountRef.current % 10 === 0) {
          setDebug({
            x: Math.round(prevAccRef.current * 100) / 100,
            vel: Math.round(velocityRef.current * 10) / 10,
            col: Math.floor(offsetRef.current),
          });
        }
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      lastTimeRef.current = 0;
    };
  }, [permissionState, textColor]);

  // ============================================================
  // Canvas サイズをウィンドウに合わせる（DPR対応）
  // ============================================================
  useEffect(() => {
    if (permissionState !== "granted") return;

    const resizeCanvas = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
    };

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    return () => window.removeEventListener("resize", resizeCanvas);
  }, [permissionState]);

  // ---- クリーンアップ ----
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
  // granted — 真バーサライト方式POVモード
  // ============================================================
  return (
    <div
      className="w-full h-full relative bg-black overflow-hidden"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Canvas: 画面全体に表示 */}
      <canvas
        ref={canvasRef}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          display: "block",
          imageRendering: "pixelated",
        }}
      />

      {/* 振り方ガイド（停止中のみ表示） */}
      <div className="absolute bottom-16 left-0 right-0 flex justify-center pointer-events-none">
        <p className="text-white/20 text-sm text-center px-8">
          スマホを横に素早く振ってください<br />
          <span className="text-white/10 text-xs">または画面をスワイプでテスト</span>
        </p>
      </div>

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
          <div>col: {debug.col}</div>
        </div>
      </div>
    </div>
  );
}
