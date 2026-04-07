"use client";

import { useEffect, useRef, useCallback } from "react";

interface POVModeProps {
  text: string;
  textColor: string;
  permissionState: "unknown" | "granted" | "denied" | "unavailable";
  onRequestPermission: () => Promise<void>;
}

// ---- 定数 ----
// ビットマップ高さ: 8行。60Hzで0.4秒のスイング=24フレームが目安
// フォントサイズを8pxに抑えることで列数を20-30以内に収める
const BITMAP_HEIGHT = 8;

// スイング検出の閾値（m/s²）
const SWING_THRESHOLD = 8.0;

// 1スイングの推定持続時間（ms）初期値。学習で更新される
const INITIAL_SWING_DURATION = 350;

// 学習の重み（0.3=新データを30%反映）
const LEARN_RATE = 0.3;

// ============================================================
// テキストをビットマップ列配列に変換
// Canvas APIで8px高さで描画 → ImageDataでビット取得
// 列数を20-30以内に収めることが最優先
// ============================================================
function textToBitmap(text: string): number[] {
  const displayText = text || "推し";

  if (typeof document === "undefined") return [];

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return [];

  const height = BITMAP_HEIGHT;
  // 高さ8pxに収めるフォントサイズ（日本語含む）
  const fontSize = 7;
  const fontStr = `bold ${fontSize}px monospace`;

  ctx.font = fontStr;
  const metrics = ctx.measureText(displayText);
  const textWidth = Math.ceil(metrics.width);

  // 左右に1px余白
  const padding = 1;
  const canvasWidth = textWidth + padding * 2;

  canvas.width = canvasWidth;
  canvas.height = height;

  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, canvasWidth, height);

  ctx.font = fontStr;
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "top";
  ctx.fillText(displayText, padding, 0);

  const imageData = ctx.getImageData(0, 0, canvasWidth, height);
  const data = imageData.data;

  // 各列をビットマスクとして格納（ビット0=行0=最上行）
  const columns: number[] = [];
  for (let x = 0; x < canvasWidth; x++) {
    let mask = 0;
    for (let y = 0; y < height; y++) {
      const idx = (y * canvasWidth + x) * 4;
      if (data[idx] > 80) {
        mask |= (1 << y);
      }
    }
    columns.push(mask);
  }

  // 前後の空白列を除去してコンパクトにする
  let start = 0;
  let end = columns.length - 1;
  while (start <= end && columns[start] === 0) start++;
  while (end >= start && columns[end] === 0) end--;

  // 両端に1列の余白を残す
  const trimmed = columns.slice(Math.max(0, start - 1), end + 2);

  return trimmed;
}

// ============================================================
// hex色をrgb文字列に変換
// ============================================================
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  };
}

// ============================================================
// 1列をcanvasに描画
// 画面全体を黒クリアしてから、該当列のドットを横帯として描画
// ============================================================
function drawColumn(
  colData: number,
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  rows: number,
  color: string
) {
  // 画面全体を黒クリア
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, canvasW, canvasH);

  if (colData === 0) return;

  const rgb = hexToRgb(color);
  const colorStr = `rgb(${rgb.r},${rgb.g},${rgb.b})`;

  // 上下マージン（1行分）を確保して中央寄せ
  const totalRows = rows + 2;
  const rowHeight = canvasH / totalRows;
  const yOffset = rowHeight; // 上マージン1行分

  ctx.fillStyle = colorStr;
  ctx.shadowColor = colorStr;
  ctx.shadowBlur = 8;

  for (let row = 0; row < rows; row++) {
    if (colData & (1 << row)) {
      const y = yOffset + row * rowHeight;
      // 2pxの隙間でドット感を出す
      ctx.fillRect(0, Math.floor(y), canvasW, Math.max(1, Math.ceil(rowHeight) - 2));
    }
  }

  ctx.shadowBlur = 0;
}

// ============================================================
// POVMode — バーサライト方式（根本修正版）
//
// 変更点:
// 1. Canvas 8pxビットマップで列数を20-30以内に抑制
// 2. 加速度閾値ベースのスイング検出（速度積分廃止）
// 3. 片方向（右スイング）のみ描画
// 4. 時間経過ベースで列を進める（学習で精度向上）
// 5. マウスドラッグ対応（デスクトップテスト用）
// ============================================================
export function POVMode({
  text,
  textColor,
  permissionState,
  onRequestPermission,
}: POVModeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const guideRef = useRef<HTMLDivElement>(null);

  // ---- ビットマップ ----
  const bitmapRef = useRef<number[]>([]);
  const totalColsRef = useRef(0);

  // ---- スイング状態 ----
  const isSwingingRef = useRef(false);
  const swingStartTimeRef = useRef(0);
  const swingDirectionRef = useRef<1 | -1>(1); // 1=右, -1=左
  const estimatedSwingDurationRef = useRef(INITIAL_SWING_DURATION);
  const currentColumnRef = useRef(-1);

  // ---- rAF ----
  const rafRef = useRef<number | null>(null);

  // textColorはrAFループからrefで参照
  const textColorRef = useRef(textColor);
  textColorRef.current = textColor;

  // ---- マウス/タッチ操作（テスト用）----
  const pointerActiveRef = useRef(false);
  const pointerPrevXRef = useRef<number | null>(null);
  const pointerAccumRef = useRef(0);

  // ============================================================
  // ビットマップ生成
  // ============================================================
  const buildBitmap = useCallback(() => {
    const cols = textToBitmap(text);
    bitmapRef.current = cols;
    totalColsRef.current = cols.length;
    currentColumnRef.current = -1;
  }, [text]);

  // ============================================================
  // devicemotion リスナー（加速度閾値ベース）
  // ============================================================
  useEffect(() => {
    if (permissionState !== "granted") return;

    const handleMotion = (e: DeviceMotionEvent) => {
      const acc = e.acceleration ?? e.accelerationIncludingGravity;
      const ax = acc?.x ?? 0;
      const now = performance.now();

      if (!isSwingingRef.current) {
        // スイング開始検出
        if (Math.abs(ax) > SWING_THRESHOLD) {
          isSwingingRef.current = true;
          swingStartTimeRef.current = now;
          swingDirectionRef.current = ax > 0 ? 1 : -1;
          currentColumnRef.current = 0;
        }
      } else {
        // 方向反転検出（逆方向の強い加速度）
        const isReversal =
          (swingDirectionRef.current === 1 && ax < -SWING_THRESHOLD) ||
          (swingDirectionRef.current === -1 && ax > SWING_THRESHOLD);

        if (isReversal) {
          // 前スイングの実際の時間で推定値を学習
          const actualDuration = now - swingStartTimeRef.current;
          if (actualDuration > 100 && actualDuration < 2000) {
            estimatedSwingDurationRef.current =
              estimatedSwingDurationRef.current * (1 - LEARN_RATE) +
              actualDuration * LEARN_RATE;
          }
          // 新しいスイング開始
          isSwingingRef.current = true;
          swingStartTimeRef.current = now;
          swingDirectionRef.current = ax > 0 ? 1 : -1;
          currentColumnRef.current = 0;
        }
      }
    };

    window.addEventListener("devicemotion", handleMotion);
    return () => {
      window.removeEventListener("devicemotion", handleMotion);
    };
  }, [permissionState]);

  // ============================================================
  // rAFループ
  // 時間経過ベースで列インデックスを更新
  // ============================================================
  useEffect(() => {
    if (permissionState !== "granted") return;

    const loop = (now: number) => {
      rafRef.current = requestAnimationFrame(loop);

      const bitmap = bitmapRef.current;
      const totalCols = totalColsRef.current;
      const canvas = canvasRef.current;
      const guide = guideRef.current;

      if (!canvas || totalCols === 0 || bitmap.length === 0) return;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const canvasW = canvas.width;
      const canvasH = canvas.height;

      // ---- ポインター操作中はセンサーを無視 ----
      if (!pointerActiveRef.current) {
        if (isSwingingRef.current) {
          const elapsed = now - swingStartTimeRef.current;
          const progress = elapsed / estimatedSwingDurationRef.current;

          if (progress >= 1.0) {
            // スイング終了（推定時間を超えた）
            isSwingingRef.current = false;
            currentColumnRef.current = -1;

            // 黒画面
            ctx.fillStyle = "#000000";
            ctx.fillRect(0, 0, canvasW, canvasH);
          } else {
            currentColumnRef.current = Math.floor(progress * totalCols);

            // 右スイング（swingDirection === 1）のみ描画
            if (swingDirectionRef.current === 1) {
              const colIndex = Math.max(0, Math.min(totalCols - 1, currentColumnRef.current));
              drawColumn(bitmap[colIndex], ctx, canvasW, canvasH, BITMAP_HEIGHT, textColorRef.current);
            } else {
              // 左スイング中は黒画面
              ctx.fillStyle = "#000000";
              ctx.fillRect(0, 0, canvasW, canvasH);
            }
          }
        } else {
          // IDLE: 黒画面
          ctx.fillStyle = "#000000";
          ctx.fillRect(0, 0, canvasW, canvasH);
        }
      } else {
        // ---- ポインター（マウス/タッチ）操作時 ----
        const colIndex = Math.max(0, Math.min(totalCols - 1, currentColumnRef.current));
        if (currentColumnRef.current >= 0) {
          drawColumn(bitmap[colIndex], ctx, canvasW, canvasH, BITMAP_HEIGHT, textColorRef.current);
        } else {
          ctx.fillStyle = "#000000";
          ctx.fillRect(0, 0, canvasW, canvasH);
        }
      }

      // ---- ガイド表示制御 ----
      if (guide) {
        const scanning = isSwingingRef.current || pointerActiveRef.current;
        guide.style.opacity = scanning ? "0" : "1";
      }
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
  // ポインター操作（マウス + タッチ共通）
  // 移動距離に応じてリアルタイムに列インデックスを制御
  // ============================================================
  const handlePointerStart = useCallback((clientX: number) => {
    pointerActiveRef.current = true;
    pointerPrevXRef.current = clientX;
    pointerAccumRef.current = 0;
    currentColumnRef.current = 0;
  }, []);

  const handlePointerMove = useCallback((clientX: number) => {
    if (!pointerActiveRef.current || pointerPrevXRef.current === null) return;

    const deltaX = clientX - pointerPrevXRef.current;
    const totalCols = totalColsRef.current;
    if (totalCols === 0) return;

    if (Math.abs(deltaX) > 1) {
      if (deltaX > 0) {
        // 右移動のみ有効
        pointerAccumRef.current += deltaX;
      }
      // 左移動は無視（片方向のみ）
    }

    // 画面幅の70%で全列を表示
    const screenW = window.innerWidth;
    const progress = Math.min(pointerAccumRef.current / (screenW * 0.7), 1.0);
    currentColumnRef.current = Math.floor(progress * (totalCols - 1));

    pointerPrevXRef.current = clientX;
  }, []);

  const handlePointerEnd = useCallback(() => {
    pointerActiveRef.current = false;
    pointerPrevXRef.current = null;
    pointerAccumRef.current = 0;
    currentColumnRef.current = -1;
  }, []);

  // ---- タッチイベント ----
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    handlePointerStart(e.touches[0].clientX);
  }, [handlePointerStart]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    handlePointerMove(e.touches[0].clientX);
  }, [handlePointerMove]);

  const handleTouchEnd = useCallback(() => {
    handlePointerEnd();
  }, [handlePointerEnd]);

  // ---- マウスイベント（デスクトップテスト用）----
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    handlePointerStart(e.clientX);
  }, [handlePointerStart]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!pointerActiveRef.current) return;
    handlePointerMove(e.clientX);
  }, [handlePointerMove]);

  const handleMouseUp = useCallback(() => {
    if (!pointerActiveRef.current) return;
    handlePointerEnd();
  }, [handlePointerEnd]);

  const handleMouseLeave = useCallback(() => {
    if (!pointerActiveRef.current) return;
    handlePointerEnd();
  }, [handlePointerEnd]);

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

  // ---- text変更時にビットマップ再生成 ----
  useEffect(() => {
    if (permissionState === "granted") {
      buildBitmap();
    }
  }, [buildBitmap, permissionState]);

  // ---- クリーンアップ ----
  useEffect(() => {
    return () => {
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
        <p className="text-white/50 text-sm text-center">
          PCではマウスを左から右にドラッグでテストできます
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
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      style={{ cursor: "ew-resize" }}
    >
      <canvas
        ref={canvasRef}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          display: "block",
        }}
      />

      {/* 使い方ガイド（スイング未検出時のみ表示）*/}
      <div
        ref={guideRef}
        className="absolute inset-0 flex flex-col items-center justify-center gap-4 pointer-events-none"
        style={{ transition: "opacity 0.3s" }}
      >
        <div className="flex flex-col items-start gap-3 px-8">
          <p className="text-white/70 text-sm">🌙 暗い場所で使用してください</p>
          <p className="text-white/70 text-sm">🔆 画面の明るさを最大にしてください</p>
          <p className="text-white/70 text-sm">📱 スマホを横に素早く振ってください</p>
          <p className="text-white/70 text-sm">✏️ 2-3文字以内がおすすめです</p>
        </div>
        <p className="text-white/30 text-xs text-center mt-2 px-8">
          PCはマウスを左から右にドラッグでテスト
        </p>
      </div>
    </div>
  );
}
