"use client";

import { useEffect, useRef, useCallback } from "react";

interface POVModeProps {
  text: string;
  textColor: string;
  acceleration: number; // x-axis from DeviceMotion
  permissionState: "unknown" | "granted" | "denied" | "unavailable";
  onRequestPermission: () => Promise<void>;
}

// テキストをビットマップ列配列に変換
function buildColumns(text: string, color: string, height: number): Uint8Array[] {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return [];

  const fontSize = Math.floor(height * 0.65);
  ctx.font = `bold ${fontSize}px Arial, sans-serif`;
  const metrics = ctx.measureText(text || " ");
  const width = Math.ceil(metrics.width) + 24;

  canvas.width = width;
  canvas.height = height;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = color;
  ctx.font = `bold ${fontSize}px Arial, sans-serif`;
  ctx.textBaseline = "middle";
  ctx.fillText(text, 12, height / 2);

  const imageData = ctx.getImageData(0, 0, width, height);
  const columns: Uint8Array[] = [];

  for (let x = 0; x < width; x++) {
    const col = new Uint8Array(height);
    for (let y = 0; y < height; y++) {
      const idx = (y * width + x) * 4;
      col[y] = imageData.data[idx + 3] > 64 ? 1 : 0;
    }
    columns.push(col);
  }

  return columns;
}

export function POVMode({
  text,
  textColor,
  acceleration,
  permissionState,
  onRequestPermission,
}: POVModeProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const columnsRef = useRef<Uint8Array[]>([]);
  const colIndexRef = useRef(0);
  const prevAccRef = useRef(0);
  const velocityRef = useRef(0);
  const animRef = useRef<number | null>(null);
  const lastRenderRef = useRef(0);

  // キャンバスにサイズをセット＋ビットマップ再構築
  const initCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const h = window.innerHeight;
    const w = window.innerWidth;
    canvas.width = w;
    canvas.height = h;
    columnsRef.current = buildColumns(text || "推し活ライト", textColor, h);
    colIndexRef.current = 0;
  }, [text, textColor]);

  useEffect(() => {
    initCanvas();
  }, [initCanvas]);

  // 加速度から列インデックスを更新
  useEffect(() => {
    if (permissionState !== "granted") return;

    const delta = Math.abs(acceleration - prevAccRef.current);
    prevAccRef.current = acceleration;

    // ローパスフィルター（感度を上げる）
    velocityRef.current = velocityRef.current * 0.3 + delta * 0.7;

    // 閾値を大幅に下げて検知しやすく
    if (velocityRef.current > 0.05 && columnsRef.current.length > 0) {
      const skip = Math.max(1, Math.round(velocityRef.current * 3));
      colIndexRef.current = (colIndexRef.current + skip) % columnsRef.current.length;
    }
  }, [acceleration, permissionState]);

  // 描画ループ
  useEffect(() => {
    if (permissionState !== "granted") return;

    const draw = (time: number) => {
      if (time - lastRenderRef.current < 14) {
        animRef.current = requestAnimationFrame(draw);
        return;
      }
      lastRenderRef.current = time;

      const canvas = canvasRef.current;
      if (!canvas) {
        animRef.current = requestAnimationFrame(draw);
        return;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        animRef.current = requestAnimationFrame(draw);
        return;
      }

      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      const cols = columnsRef.current;
      if (!cols.length) {
        animRef.current = requestAnimationFrame(draw);
        return;
      }

      const speed = velocityRef.current;
      const isMoving = speed > 0.05;

      if (!isMoving) {
        // 静止時: テキスト全体を薄く表示（ガイド）
        const totalCols = cols.length;
        const cellW = w / totalCols;
        const cellH = h / (cols[0].length);

        ctx.globalAlpha = 0.15;
        ctx.fillStyle = textColor;
        for (let x = 0; x < totalCols; x++) {
          const col = cols[x];
          for (let y = 0; y < col.length; y++) {
            if (col[y]) {
              ctx.fillRect(x * cellW, y * cellH, cellW + 0.5, cellH + 0.5);
            }
          }
        }
        ctx.globalAlpha = 1;
      } else {
        // 振り中: 現在の列を表示
        const col = cols[colIndexRef.current % cols.length];
        if (!col) {
          animRef.current = requestAnimationFrame(draw);
          return;
        }

        const ledSize = Math.max(2, Math.floor(w / 4));
        const cellH = h / col.length;

        ctx.shadowBlur = 12;
        ctx.shadowColor = textColor;
        ctx.fillStyle = textColor;

        for (let y = 0; y < col.length; y++) {
          if (col[y]) {
            const cx = w / 2;
            const cy = y * cellH;
            ctx.fillRect(cx - ledSize / 2, cy, ledSize, cellH);
          }
        }
        ctx.shadowBlur = 0;
      }

      animRef.current = requestAnimationFrame(draw);
    };

    animRef.current = requestAnimationFrame(draw);
    return () => {
      if (animRef.current !== null) {
        cancelAnimationFrame(animRef.current);
        animRef.current = null;
      }
    };
  }, [permissionState, textColor]);

  // 権限なし表示
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

  if (permissionState === "unknown") {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-8 bg-black px-8">
        <div className="text-7xl">✋</div>
        <div className="text-center">
          <p className="text-white font-bold text-2xl mb-3">POVモード</p>
          <p className="text-white/60 text-base leading-relaxed">
            スマホを横に振ると<br />
            残像で文字が浮かび上がります
          </p>
        </div>
        <button
          onClick={onRequestPermission}
          className="px-10 py-5 rounded-2xl text-black font-black text-xl active:scale-95 transition-transform"
          style={{ background: textColor }}
        >
          センサーを有効にする
        </button>
        <p className="text-white/30 text-sm text-center">
          iOS 13以降はモーションセンサーの<br />許可が必要です
        </p>
      </div>
    );
  }

  // granted
  return (
    <div className="w-full h-full relative bg-black">
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        style={{ display: "block" }}
      />
      <div className="absolute bottom-8 left-0 right-0 flex justify-center pointer-events-none">
        <p className="text-white/25 text-sm">スマホを横に素早く振ってください</p>
      </div>
    </div>
  );
}
