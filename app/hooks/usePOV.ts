"use client";

import { useEffect, useRef, useState, useCallback } from "react";

interface POVOptions {
  text: string;
  color: string;
  enabled: boolean;
  acceleration: number; // x-axis acceleration
}

// テキストをピクセル列の配列に変換
function textToColumns(
  text: string,
  color: string,
  height: number
): { on: boolean }[][] {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return [];

  const fontSize = Math.floor(height * 0.7);
  ctx.font = `bold ${fontSize}px Arial, sans-serif`;

  const metrics = ctx.measureText(text);
  const width = Math.ceil(metrics.width) + 20;

  canvas.width = width;
  canvas.height = height;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = color;
  ctx.font = `bold ${fontSize}px Arial, sans-serif`;
  ctx.textBaseline = "middle";
  ctx.fillText(text, 10, height / 2);

  const imageData = ctx.getImageData(0, 0, width, height);
  const columns: { on: boolean }[][] = [];

  for (let x = 0; x < width; x++) {
    const col: { on: boolean }[] = [];
    for (let y = 0; y < height; y++) {
      const idx = (y * width + x) * 4;
      const alpha = imageData.data[idx + 3];
      col.push({ on: alpha > 64 });
    }
    columns.push(col);
  }

  return columns;
}

export function usePOV(options: POVOptions) {
  const { text, color, enabled, acceleration } = options;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const columnsRef = useRef<{ on: boolean }[][]>([]);
  const colIndexRef = useRef(0);
  const lastAccRef = useRef(0);
  const accVelocityRef = useRef(0);
  const animFrameRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);
  const [isSwinging, setIsSwinging] = useState(false);

  // テキストが変わったらビットマップを再生成
  const rebuildColumns = useCallback(() => {
    if (!canvasRef.current) return;
    const h = canvasRef.current.height || 400;
    columnsRef.current = textToColumns(text, color, h);
    colIndexRef.current = 0;
  }, [text, color]);

  // 加速度から描画列を決定する
  useEffect(() => {
    if (!enabled) return;

    const dx = acceleration - lastAccRef.current;
    lastAccRef.current = acceleration;

    // 速度を加算（ローパス）
    accVelocityRef.current = accVelocityRef.current * 0.7 + Math.abs(dx) * 0.3;

    const speed = accVelocityRef.current;
    setIsSwinging(speed > 0.5);

    if (speed > 0.5 && columnsRef.current.length > 0) {
      // 速度に応じてスキップする列数を決定
      const skip = Math.max(1, Math.floor(speed * 0.8));
      colIndexRef.current = (colIndexRef.current + skip) % columnsRef.current.length;
    }
  }, [acceleration, enabled]);

  const drawFrame = useCallback((canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext("2d");
    if (!ctx || !columnsRef.current.length) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    if (!isSwinging && colIndexRef.current === 0) return;

    // 現在の列を中心に前後の列を表示（残像幅）
    const cols = columnsRef.current;
    const totalCols = cols.length;
    const displayWidth = Math.min(totalCols, 80); // 表示する列数
    const cellW = w / displayWidth;
    const cellH = h / (cols[0]?.length ?? 1);

    ctx.shadowBlur = 8;
    ctx.shadowColor = color;

    for (let i = 0; i < displayWidth; i++) {
      const colIdx = (colIndexRef.current + i) % totalCols;
      const col = cols[colIdx];
      if (!col) continue;

      for (let y = 0; y < col.length; y++) {
        if (col[y].on) {
          ctx.fillStyle = color;
          ctx.fillRect(i * cellW, y * cellH, cellW + 0.5, cellH + 0.5);
        }
      }
    }
  }, [color, isSwinging]);

  // アニメーションループ
  const startLoop = useCallback((canvas: HTMLCanvasElement) => {
    const loop = (time: number) => {
      if (time - lastTimeRef.current > 16) {
        drawFrame(canvas);
        lastTimeRef.current = time;
      }
      animFrameRef.current = requestAnimationFrame(loop);
    };
    animFrameRef.current = requestAnimationFrame(loop);
  }, [drawFrame]);

  const setCanvas = useCallback((canvas: HTMLCanvasElement | null) => {
    canvasRef.current = canvas;
    if (canvas) {
      rebuildColumns();
      if (enabled) startLoop(canvas);
    }
  }, [enabled, rebuildColumns, startLoop]);

  useEffect(() => {
    if (!enabled && animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    } else if (enabled && canvasRef.current && animFrameRef.current === null) {
      startLoop(canvasRef.current);
    }
  }, [enabled, startLoop]);

  useEffect(() => {
    rebuildColumns();
  }, [rebuildColumns]);

  useEffect(() => {
    return () => {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, []);

  return { setCanvas, isSwinging };
}
