"use client";

import { useEffect, useRef, useCallback } from "react";

interface POVModeProps {
  text: string;
  textColor: string;
  permissionState: "unknown" | "granted" | "denied" | "unavailable";
  onRequestPermission: () => Promise<void>;
}

// ---- 定数 ----
const BITMAP_HEIGHT = 48;
const SPIKE_THRESHOLD = 3.0;   // この加速度(m/s²)を超えたらスキャン開始
const SCAN_DURATION_MIN = 150; // ms
const SCAN_DURATION_MAX = 500; // ms

// スキャン状態マシン
type ScanState = "IDLE" | "SCANNING" | "COOLDOWN";

// ============================================================
// テキストをビットマップ列配列に変換
// columns[x][y] = true/false
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
// 1列をcanvasに描画
// ============================================================
function drawColumn(
  colIndex: number,
  ctx: CanvasRenderingContext2D,
  bitmap: boolean[][],
  canvasW: number,
  canvasH: number,
  color: string
) {
  const col = bitmap[colIndex];
  if (!col) return;

  const rowH = canvasH / col.length;

  ctx.shadowColor = color;
  ctx.shadowBlur = 25;
  ctx.fillStyle = color;

  for (let y = 0; y < col.length; y++) {
    if (col[y]) {
      ctx.fillRect(0, Math.floor(y * rowH), canvasW, Math.ceil(rowH));
    }
  }

  ctx.shadowBlur = 0;
}

// ============================================================
// POVMode — バーサライト方式
// React stateを経由せず、refとrAFループで直接センサーを扱う
// ============================================================
export function POVMode({
  text,
  textColor,
  permissionState,
  onRequestPermission,
}: POVModeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const guideRef = useRef<HTMLDivElement>(null);

  // ---- センサーデータ（React stateを経由しない）----
  const latestAccXRef = useRef(0);

  // ---- ビットマップ ----
  const bitmapRef = useRef<boolean[][]>([]);
  const totalColsRef = useRef(0);

  // ---- 状態マシン ----
  const scanStateRef = useRef<ScanState>("IDLE");
  const scanStartTimeRef = useRef(0);
  const scanDurationRef = useRef(300); // ms

  // ---- タッチ操作（テスト用）----
  const touchPrevXRef = useRef<number | null>(null);
  const touchStartXRef = useRef<number | null>(null);
  const touchScanActiveRef = useRef(false);
  const touchAccumRef = useRef(0); // 累積移動量

  // ---- rAF ----
  const rafRef = useRef<number | null>(null);
  const lastTimeRef = useRef(0);
  const cooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // textColorはrAFループからrefで参照
  const textColorRef = useRef(textColor);
  textColorRef.current = textColor;

  // ============================================================
  // ビットマップ生成
  // ============================================================
  const buildBitmap = useCallback(() => {
    const cols = textToBitmap(text);
    bitmapRef.current = cols;
    totalColsRef.current = cols.length;
  }, [text]);

  // ============================================================
  // スキャン開始（状態マシン: IDLE → SCANNING）
  // ============================================================
  const startScan = useCallback((absAcc: number) => {
    if (cooldownTimerRef.current) {
      clearTimeout(cooldownTimerRef.current);
      cooldownTimerRef.current = null;
    }
    // スパイク強度から持続時間を推定: 強く振るほど速くスキャン
    const duration = Math.round(
      Math.max(SCAN_DURATION_MIN, Math.min(SCAN_DURATION_MAX, 300 / Math.max(absAcc, 1)))
    );
    scanDurationRef.current = duration;
    scanStartTimeRef.current = performance.now();
    scanStateRef.current = "SCANNING";
  }, []);

  // ============================================================
  // スキャン終了（SCANNING → COOLDOWN → IDLE）
  // ============================================================
  const endScan = useCallback(() => {
    scanStateRef.current = "COOLDOWN";
    if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
    cooldownTimerRef.current = setTimeout(() => {
      scanStateRef.current = "IDLE";
      cooldownTimerRef.current = null;
    }, 100);
  }, []);

  // ============================================================
  // devicemotion リスナー（Reactのstateを経由しない）
  // ============================================================
  useEffect(() => {
    if (permissionState !== "granted") return;

    const handleMotion = (e: DeviceMotionEvent) => {
      const acc = e.acceleration ?? e.accelerationIncludingGravity;
      latestAccXRef.current = acc?.x ?? 0;
    };

    window.addEventListener("devicemotion", handleMotion);
    return () => {
      window.removeEventListener("devicemotion", handleMotion);
    };
  }, [permissionState]);

  // ============================================================
  // rAFループ
  // スパイク検出 → SCANNING → COOLDOWN → IDLE
  // SCANNING中は経過時間ベースで列インデックスを算出
  // ============================================================
  useEffect(() => {
    if (permissionState !== "granted") return;

    const loop = (now: number) => {
      lastTimeRef.current = now;

      const bitmap = bitmapRef.current;
      const totalCols = totalColsRef.current;
      const canvas = canvasRef.current;
      const guide = guideRef.current;

      rafRef.current = requestAnimationFrame(loop);

      if (!canvas || totalCols === 0 || bitmap.length === 0) return;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const canvasW = canvas.width;
      const canvasH = canvas.height;

      // ---- 毎フレーム完全クリア ----
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, canvasW, canvasH);

      const state = scanStateRef.current;

      // ---- スパイク検出（IDLE時のみ）----
      if (state === "IDLE") {
        const absAcc = Math.abs(latestAccXRef.current);
        if (absAcc > SPIKE_THRESHOLD) {
          startScan(absAcc);
        }
      }

      // ---- SCANNING: 経過時間ベースで列を描画 ----
      if (scanStateRef.current === "SCANNING") {
        const elapsed = now - scanStartTimeRef.current;
        const progress = elapsed / scanDurationRef.current;

        if (progress >= 1.0) {
          // スキャン完了
          endScan();
        } else {
          const colIndex = Math.floor(progress * totalCols);
          const clampedIndex = Math.min(colIndex, totalCols - 1);
          drawColumn(clampedIndex, ctx, bitmap, canvasW, canvasH, textColorRef.current);

          // スキャン中に逆方向スパイクが来たら再スキャン
          const absAcc = Math.abs(latestAccXRef.current);
          if (absAcc > SPIKE_THRESHOLD && elapsed > 50) {
            startScan(absAcc);
          }
        }
      }

      // ---- ガイド表示制御 ----
      if (guide) {
        const scanning = scanStateRef.current === "SCANNING";
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
  }, [permissionState, startScan, endScan]);

  // ============================================================
  // タッチ操作（テスト用）
  // タッチ開始 → SCANNING, deltaX累積で列インデックス制御
  // ============================================================
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const x = e.touches[0].clientX;
    touchPrevXRef.current = x;
    touchStartXRef.current = x;
    touchAccumRef.current = 0;
    touchScanActiveRef.current = true;

    // タッチ開始でスキャン開始
    startScan(5.0); // 固定の中程度の速度
  }, [startScan]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!touchScanActiveRef.current || touchPrevXRef.current === null) return;
    const currentX = e.touches[0].clientX;
    const deltaX = currentX - touchPrevXRef.current;
    touchAccumRef.current += Math.abs(deltaX);
    touchPrevXRef.current = currentX;

    const totalCols = totalColsRef.current;
    if (totalCols === 0) return;

    // deltaX累積をスキャン進捗にマッピング（画面幅で1スキャン）
    const screenW = window.innerWidth;
    const progress = Math.min(touchAccumRef.current / screenW, 1.0);

    // 手動でスキャン状態を維持しながら列インデックスを上書き
    if (scanStateRef.current === "SCANNING" || scanStateRef.current === "IDLE") {
      scanStateRef.current = "SCANNING";
      // progressをscanStartTimeとscanDurationで表現するために逆算
      const fakeDuration = 300;
      scanDurationRef.current = fakeDuration;
      scanStartTimeRef.current = performance.now() - progress * fakeDuration;
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    touchPrevXRef.current = null;
    touchScanActiveRef.current = false;
    touchAccumRef.current = 0;
    endScan();
  }, [endScan]);

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
      if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
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

      <div
        ref={guideRef}
        className="absolute bottom-16 left-0 right-0 flex justify-center pointer-events-none"
        style={{ transition: "opacity 0.3s" }}
      >
        <p className="text-white/60 text-sm text-center px-8">
          スマホを横に素早く振ってください<br />
          <span className="text-white/40 text-xs">または画面をスワイプでテスト</span>
        </p>
      </div>
    </div>
  );
}
