"use client";

import { useEffect, useRef, useCallback } from "react";

interface POVModeProps {
  text: string;
  textColor: string;
  permissionState: "unknown" | "granted" | "denied" | "unavailable";
  onRequestPermission: () => Promise<void>;
}

// ---- 定数 ----
// 60Hzで0.5秒スイング = 30フレーム。実用的な文字数は2-3文字
// 高さを抑えることで列数を減らし、確実に読めるようにする
const BITMAP_HEIGHT = 24;

// スイング検出: 速度がこの値を超えたらスキャン開始（m/s相当）
const VELOCITY_THRESHOLD = 0.3;
// 符号反転検出: このデルタ時間(ms)以内の反転はスイングとみなす
const DIRECTION_CHANGE_WINDOW = 150;

// スキャン方向
type ScanDirection = "forward" | "backward";
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
  // 太いフォントの方が残像で見やすい
  const fontSize = Math.floor(height * 0.9);
  const fontStr = `900 ${fontSize}px system-ui, -apple-system, sans-serif`;
  ctx.font = fontStr;

  const metrics = ctx.measureText(displayText);
  const textWidth = Math.ceil(metrics.width);
  // 左右に少し余白
  const padding = Math.ceil(textWidth * 0.05);

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
  const rgb = hexToRgb(color);
  const colorStr = `rgb(${rgb.r},${rgb.g},${rgb.b})`;

  // glow効果は軽めに（パフォーマンス優先）
  ctx.shadowColor = colorStr;
  ctx.shadowBlur = 12;
  ctx.fillStyle = colorStr;

  for (let y = 0; y < col.length; y++) {
    if (col[y]) {
      ctx.fillRect(0, Math.floor(y * rowH), canvasW, Math.ceil(rowH) + 1);
    }
  }

  ctx.shadowBlur = 0;
}

// ============================================================
// POVMode — バーサライト方式
// React stateを経由せず、refとrAFループで直接センサーを扱う
//
// 改善点:
// 1. X軸加速度の符号反転でスイング折り返しを検出
// 2. 速度積分によるリアルタイムスキャン速度制御
// 3. 左→右、右→左の両方向表示（逆順）
// 4. マウスドラッグ対応（デスクトップテスト用）
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
  const bitmapRef = useRef<boolean[][]>([]);
  const totalColsRef = useRef(0);

  // ---- 状態マシン ----
  const scanStateRef = useRef<ScanState>("IDLE");
  const scanDirectionRef = useRef<ScanDirection>("forward");
  // 速度ベースのスキャン: 積算速度→列インデックス
  const scanColIndexRef = useRef(0); // 現在描画中の列（float）
  const cooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- センサー速度積分 ----
  const velocityRef = useRef(0);         // 推定X速度（m/s）
  const prevAccXRef = useRef(0);         // 前フレームのX加速度
  const prevAccSignRef = useRef(0);      // 前フレームの符号
  const lastMotionTimeRef = useRef(0);   // 最終モーションイベント時刻
  const directionChangedAtRef = useRef(0); // 最後に符号反転した時刻

  // ---- rAF ----
  const rafRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef(0);

  // textColorはrAFループからrefで参照
  const textColorRef = useRef(textColor);
  textColorRef.current = textColor;

  // ---- マウス/タッチ操作（テスト用）----
  const pointerActiveRef = useRef(false);
  const pointerPrevXRef = useRef<number | null>(null);
  const pointerAccumRef = useRef(0);      // 累積移動量（px）
  const pointerDirectionRef = useRef<ScanDirection>("forward");
  const pointerVelocityRef = useRef(0);   // pointer速度（px/ms）
  const pointerLastTimeRef = useRef(0);

  // ============================================================
  // ビットマップ生成
  // ============================================================
  const buildBitmap = useCallback(() => {
    const cols = textToBitmap(text);
    bitmapRef.current = cols;
    totalColsRef.current = cols.length;
    scanColIndexRef.current = 0;
  }, [text]);

  // ============================================================
  // スキャン開始
  // ============================================================
  const startScan = useCallback((direction: ScanDirection) => {
    if (cooldownTimerRef.current) {
      clearTimeout(cooldownTimerRef.current);
      cooldownTimerRef.current = null;
    }
    scanDirectionRef.current = direction;
    // forward: 列0から開始、backward: 最終列から開始
    scanColIndexRef.current = direction === "forward" ? 0 : totalColsRef.current - 1;
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
    }, 80);
  }, []);

  // ============================================================
  // devicemotion リスナー（速度積分、符号反転検出）
  // ============================================================
  useEffect(() => {
    if (permissionState !== "granted") return;

    const handleMotion = (e: DeviceMotionEvent) => {
      const acc = e.acceleration ?? e.accelerationIncludingGravity;
      const accX = acc?.x ?? 0;
      const now = performance.now();
      const dt = now - lastMotionTimeRef.current; // ms

      if (lastMotionTimeRef.current > 0 && dt > 0 && dt < 100) {
        // 加速度→速度（台形積分, dt ms → s変換）
        const dtSec = dt / 1000;
        velocityRef.current += ((accX + prevAccXRef.current) / 2) * dtSec;

        // 速度の減衰（摩擦モデル: 静止に戻りやすくする）
        velocityRef.current *= 0.92;

        // 符号変化（スイング折り返し）を検出
        const curSign = accX > 0.5 ? 1 : accX < -0.5 ? -1 : 0;
        if (
          curSign !== 0 &&
          prevAccSignRef.current !== 0 &&
          curSign !== prevAccSignRef.current
        ) {
          directionChangedAtRef.current = now;
        }
        prevAccSignRef.current = curSign !== 0 ? curSign : prevAccSignRef.current;
      }

      prevAccXRef.current = accX;
      lastMotionTimeRef.current = now;
    };

    window.addEventListener("devicemotion", handleMotion);
    return () => {
      window.removeEventListener("devicemotion", handleMotion);
    };
  }, [permissionState]);

  // ============================================================
  // rAFループ
  // 速度ベースでスキャン列インデックスを更新
  // ============================================================
  useEffect(() => {
    if (permissionState !== "granted") return;

    const loop = (now: number) => {
      const dt = now - lastFrameTimeRef.current; // ms
      lastFrameTimeRef.current = now;

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

      // ---- 完全クリア ----
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, canvasW, canvasH);

      // ---- ポインター操作中はセンサーを無視 ----
      if (!pointerActiveRef.current) {
        const vel = velocityRef.current;
        const absVel = Math.abs(vel);
        const state = scanStateRef.current;

        if (state === "IDLE") {
          if (absVel > VELOCITY_THRESHOLD) {
            const dir: ScanDirection = vel > 0 ? "forward" : "backward";
            startScan(dir);
          }
          // 折り返し直後（符号反転後DIRECTION_CHANGE_WINDOW ms以内）の検出
          const timeSinceChange = now - directionChangedAtRef.current;
          if (
            directionChangedAtRef.current > 0 &&
            timeSinceChange < DIRECTION_CHANGE_WINDOW &&
            absVel > VELOCITY_THRESHOLD * 0.5
          ) {
            const dir: ScanDirection = vel > 0 ? "forward" : "backward";
            startScan(dir);
          }
        }

        if (state === "SCANNING") {
          if (absVel < 0.05) {
            // 速度がほぼゼロ → スキャン終了
            endScan();
          } else {
            // 速度に比例して列を進める
            // absVel: m/s → 1秒あたりの列数 = totalCols * absVel * スケール係数
            // スケール係数は経験的に調整（大きいほど速く切り替わる）
            const colsPerMs = (totalCols * absVel * 4.0) / 1000;
            const deltaCols = colsPerMs * Math.min(dt, 32); // 最大32msクランプ

            if (scanDirectionRef.current === "forward") {
              scanColIndexRef.current += deltaCols;
              if (scanColIndexRef.current >= totalCols) {
                scanColIndexRef.current = totalCols - 1;
                endScan();
              }
            } else {
              scanColIndexRef.current -= deltaCols;
              if (scanColIndexRef.current < 0) {
                scanColIndexRef.current = 0;
                endScan();
              }
            }

            const colIndex = Math.round(
              Math.max(0, Math.min(totalCols - 1, scanColIndexRef.current))
            );
            drawColumn(colIndex, ctx, bitmap, canvasW, canvasH, textColorRef.current);
          }
        }
      } else {
        // ---- ポインター（マウス/タッチ）操作時 ----
        if (scanStateRef.current === "SCANNING") {
          const colIndex = Math.round(
            Math.max(0, Math.min(totalCols - 1, scanColIndexRef.current))
          );
          drawColumn(colIndex, ctx, bitmap, canvasW, canvasH, textColorRef.current);
        }
      }

      // ---- ガイド表示制御 ----
      if (guide) {
        const scanning = scanStateRef.current === "SCANNING";
        guide.style.opacity = scanning ? "0" : "1";
      }
    };

    lastFrameTimeRef.current = performance.now();
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [permissionState, startScan, endScan]);

  // ============================================================
  // ポインター操作（マウス + タッチ共通）
  // 移動距離に応じてリアルタイムに列インデックスを制御
  // ============================================================
  const handlePointerStart = useCallback((clientX: number) => {
    pointerActiveRef.current = true;
    pointerPrevXRef.current = clientX;
    pointerAccumRef.current = 0;
    pointerVelocityRef.current = 0;
    pointerLastTimeRef.current = performance.now();

    // スキャン状態を開始（方向はmove時に確定）
    if (cooldownTimerRef.current) {
      clearTimeout(cooldownTimerRef.current);
      cooldownTimerRef.current = null;
    }
    scanColIndexRef.current = 0;
    scanStateRef.current = "SCANNING";
    scanDirectionRef.current = "forward";
  }, []);

  const handlePointerMove = useCallback((clientX: number) => {
    if (!pointerActiveRef.current || pointerPrevXRef.current === null) return;

    const now = performance.now();
    const dt = now - pointerLastTimeRef.current;
    const deltaX = clientX - pointerPrevXRef.current;

    if (dt > 0) {
      pointerVelocityRef.current = deltaX / dt; // px/ms
    }

    const totalCols = totalColsRef.current;
    if (totalCols === 0) return;

    // 移動方向で表示方向を決定
    if (Math.abs(deltaX) > 2) {
      if (deltaX > 0) {
        // 右移動: forward（左→右）
        if (scanDirectionRef.current !== "forward") {
          scanDirectionRef.current = "forward";
          scanColIndexRef.current = 0;
          pointerAccumRef.current = 0;
        }
        pointerAccumRef.current += deltaX;
      } else {
        // 左移動: backward（右→左）
        if (scanDirectionRef.current !== "backward") {
          scanDirectionRef.current = "backward";
          scanColIndexRef.current = totalCols - 1;
          pointerAccumRef.current = 0;
        }
        pointerAccumRef.current += Math.abs(deltaX);
      }
    }

    // 画面幅に対する累積移動量の割合 → 列インデックス
    const screenW = window.innerWidth;
    // 画面幅の80%で全列を表示する（速すぎず遅すぎず）
    const progress = Math.min(pointerAccumRef.current / (screenW * 0.8), 1.0);

    if (scanDirectionRef.current === "forward") {
      scanColIndexRef.current = Math.floor(progress * (totalCols - 1));
    } else {
      scanColIndexRef.current = Math.floor((1 - progress) * (totalCols - 1));
    }

    scanStateRef.current = "SCANNING";
    pointerPrevXRef.current = clientX;
    pointerLastTimeRef.current = now;
  }, []);

  const handlePointerEnd = useCallback(() => {
    pointerActiveRef.current = false;
    pointerPrevXRef.current = null;
    pointerAccumRef.current = 0;
    endScan();
  }, [endScan]);

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
      // DPRは最大2で上限。過度な解像度はパフォーマンスを落とす
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
        <p className="text-white/50 text-sm text-center">
          PCではマウスドラッグでテストできます
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

      <div
        ref={guideRef}
        className="absolute bottom-16 left-0 right-0 flex justify-center pointer-events-none"
        style={{ transition: "opacity 0.3s" }}
      >
        <p className="text-white/60 text-sm text-center px-8">
          スマホを横に素早く振ってください<br />
          <span className="text-white/40 text-xs">PCはマウスを左右にドラッグでテスト</span>
        </p>
      </div>
    </div>
  );
}
