"use client";

import { useEffect, useRef, useCallback } from "react";

interface POVModeProps {
  text: string;
  textColor: string;
  acceleration: number;
  permissionState: "unknown" | "granted" | "denied" | "unavailable";
  onRequestPermission: () => Promise<void>;
}

// ---- 定数（モジュールスコープ） ----
const BITMAP_HEIGHT = 48;
const SWING_THRESHOLD = 2.0;   // この加速度(m/s²)を超えたらスイング開始

// ============================================================
// テキストをビットマップ列配列に変換
// columns[x][y] = true/false
// 解像度固定（BITMAP_HEIGHT行）で軽量かつ文字が潰れない
// ============================================================
function textToBitmap(text: string): boolean[][] {
  const displayText = text || "推し";

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return [];

  const height = BITMAP_HEIGHT;
  const fontSize = Math.floor(height * 0.85);
  const fontStr = `900 ${fontSize}px system-ui, -apple-system, sans-serif`;
  ctx.font = fontStr;

  const metrics = ctx.measureText(displayText);
  const textWidth = Math.ceil(metrics.width);
  const padding = Math.ceil(textWidth * 0.08);

  const canvasWidth = textWidth + padding * 2;
  canvas.width = canvasWidth;
  canvas.height = height;

  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, canvasWidth, height);

  ctx.font = fontStr;
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "middle";
  ctx.fillText(displayText, padding, height / 2);

  const imageData = ctx.getImageData(0, 0, canvasWidth, height);
  const data = imageData.data;

  const columns: boolean[][] = [];
  for (let x = 0; x < canvasWidth; x++) {
    const col: boolean[] = [];
    for (let y = 0; y < height; y++) {
      const idx = (y * canvasWidth + x) * 4;
      col.push(data[idx] > 80);
    }
    columns.push(col);
  }

  return columns;
}

// ============================================================
// hex色をrgb文字列に変換
// ============================================================
function hexToRgb(hex: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `${r},${g},${b}`;
}

// ============================================================
// POVMode — 画面上に光の軌跡で文字を描くバーサライト
// ============================================================
export function POVMode({
  text,
  textColor,
  acceleration,
  permissionState,
  onRequestPermission,
}: POVModeProps) {
  const bitmapRef = useRef<boolean[][]>([]);
  const totalColsRef = useRef(0);

  const positionRef = useRef(0);
  const prevAccSignRef = useRef(0); // 前フレームの加速度の符号（+1 / -1 / 0）
  const isSwingingRef = useRef(false);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const touchPrevXRef = useRef<number | null>(null);
  const touchVelRef = useRef(0);

  const rafRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const guideRef = useRef<HTMLDivElement>(null);

  const textColorRef = useRef(textColor);
  textColorRef.current = textColor;

  // ============================================================
  // ビットマップ生成
  // ============================================================
  const buildBitmap = useCallback(() => {
    const cols = textToBitmap(text);
    bitmapRef.current = cols;
    totalColsRef.current = cols.length;
    positionRef.current = 0;
  }, [text]);

  useEffect(() => {
    if (permissionState === "granted") {
      buildBitmap();
    }
  }, [buildBitmap, permissionState]);

  // ============================================================
  // 加速度センサー入力
  // スイング中は毎フレーム列を進める。符号反転でcolIndexリセット。
  // ============================================================
  useEffect(() => {
    if (permissionState !== "granted") return;

    const absAcc = Math.abs(acceleration);
    const currentSign = acceleration > 0 ? 1 : acceleration < 0 ? -1 : 0;

    if (absAcc > SWING_THRESHOLD) {
      // 符号が反転した（スイング方向が変わった）→ 列を0にリセット
      if (
        prevAccSignRef.current !== 0 &&
        currentSign !== 0 &&
        currentSign !== prevAccSignRef.current
      ) {
        positionRef.current = 0;
      }

      // 加速度に応じて列を進める: advance = max(1, floor(absAcc * 0.5))
      const advance = Math.max(1, Math.floor(absAcc * 0.5));
      const totalCols = totalColsRef.current;
      if (totalCols > 0) {
        positionRef.current = (positionRef.current + advance) % totalCols;
      }

      isSwingingRef.current = true;
      if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
      stopTimerRef.current = setTimeout(() => {
        isSwingingRef.current = false;
      }, 400);
    }

    if (currentSign !== 0) {
      prevAccSignRef.current = currentSign;
    }
  }, [acceleration, permissionState]);

  // ============================================================
  // タッチスワイプ（テスト用）
  // deltaXが3px以上で1列進める。方向が変わったらcolIndex = 0にリセット
  // ============================================================
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchPrevXRef.current = e.touches[0].clientX;
    touchVelRef.current = 0;
    isSwingingRef.current = true;
    positionRef.current = 0;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (touchPrevXRef.current === null) return;
    const currentX = e.touches[0].clientX;
    const deltaX = currentX - touchPrevXRef.current;

    if (Math.abs(deltaX) >= 3) {
      const newSign = deltaX > 0 ? 1 : -1;
      // 方向が反転したらリセット
      if (touchVelRef.current !== 0 && newSign !== touchVelRef.current) {
        positionRef.current = 0;
      }
      touchVelRef.current = newSign;

      const totalCols = totalColsRef.current;
      if (totalCols > 0) {
        positionRef.current = (positionRef.current + 1) % totalCols;
      }

      touchPrevXRef.current = currentX;
    }

    isSwingingRef.current = true;

    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    stopTimerRef.current = setTimeout(() => {
      isSwingingRef.current = false;
      touchVelRef.current = 0;
    }, 400);
  }, []);

  const handleTouchEnd = useCallback(() => {
    touchPrevXRef.current = null;
  }, []);

  // ============================================================
  // rAFループ — 本物のPOV（バーサライト）方式
  // 毎フレーム: 完全クリア → ビットマップの1列のみ画面全幅に描画
  // 残像はユーザーの目が担当。フェードなし。
  // ============================================================
  useEffect(() => {
    if (permissionState !== "granted") return;

    const loop = () => {
      const bitmap = bitmapRef.current;
      const totalCols = totalColsRef.current;
      const canvas = canvasRef.current;

      if (!canvas || totalCols === 0 || bitmap.length === 0) {
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

      // ---- 毎フレーム完全クリア（フェードなし）----
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, canvasW, canvasH);

      if (isSwingingRef.current) {
        const colIndex = positionRef.current % totalCols;
        const col = bitmap[colIndex];

        if (col) {
          const rowH = canvasH / col.length;
          const rgb = hexToRgb(textColorRef.current);

          // グロー効果
          ctx.shadowColor = textColorRef.current;
          ctx.shadowBlur = 30;
          ctx.fillStyle = `rgb(${rgb})`;

          // ビットマップの1列を画面全幅に描画
          for (let y = 0; y < col.length; y++) {
            if (col[y]) {
              ctx.fillRect(0, Math.floor(y * rowH), canvasW, Math.ceil(rowH));
            }
          }

          // グローリセット
          ctx.shadowBlur = 0;
        }

        // ---- タッチ操作: deltaXが3px以上で1列進める ----
        // (handleTouchMoveで直接advanceColを呼ぶ方式に変更)
      }

      // ガイド表示制御
      if (guideRef.current) {
        guideRef.current.style.opacity = isSwingingRef.current ? "0" : "1";
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [permissionState]);

  // ============================================================
  // Canvas サイズ（DPR対応）
  // ============================================================
  useEffect(() => {
    if (permissionState !== "granted") return;

    const resizeCanvas = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      // canvasクリア
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      buildBitmap();
    };

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    return () => window.removeEventListener("resize", resizeCanvas);
  }, [permissionState, buildBitmap]);

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
          設定アプリを開く
        </button>
        <p className="text-white/50 text-sm text-center">
          設定 → Safari → モーションとWebサイトのアクセス → ON
        </p>
      </div>
    );
  }

  // ============================================================
  // 許可待ち
  // ============================================================
  if (permissionState === "unknown") {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-8 bg-black px-8">
        <div className="text-7xl">✋</div>
        <div className="text-center">
          <p className="text-white font-bold text-2xl mb-3">POVモード</p>
          <p className="text-white/60 text-base leading-relaxed">
            スマホを横に振ると<br />
            光の軌跡で文字が描かれます
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
  // granted — 光の軌跡POVモード
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
        className="pov-canvas"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          display: "block",
        }}
      />

      <div ref={guideRef} className="absolute bottom-16 left-0 right-0 flex justify-center pointer-events-none" style={{ transition: "opacity 0.3s" }}>
        <p className="text-white/60 text-sm text-center px-8">
          スマホを横に素早く振ってください<br />
          <span className="text-white/40 text-xs">または画面をスワイプでテスト</span>
        </p>
      </div>
    </div>
  );
}
