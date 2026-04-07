"use client";

import { useEffect, useRef, useState, useCallback } from "react";

interface POVModeProps {
  text: string;
  textColor: string;
  acceleration: number; // x-axis from DeviceMotion (passed in but we also handle internally)
  permissionState: "unknown" | "granted" | "denied" | "unavailable";
  onRequestPermission: () => Promise<void>;
}

// ============================================================
// テキストをビットマップ列配列に変換
// columns[x][y] = true/false
// heightRows: 解像度（縦方向のサンプル数、100〜200程度）
// ============================================================
function textToBitmap(
  text: string,
  textColor: string,
  heightRows: number
): boolean[][] {
  const displayText = text || "推し活ライト";

  // オフスクリーンCanvas
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return [];

  // フォントサイズをheightRowsに合わせる（縦方向いっぱいに描く）
  const fontSize = heightRows * 0.75;
  ctx.font = `900 ${fontSize}px system-ui, -apple-system, sans-serif`;

  // テキスト幅を計測してCanvas幅を決める
  const metrics = ctx.measureText(displayText);
  const textWidth = Math.ceil(metrics.width);
  const padding = Math.ceil(fontSize * 0.2);

  const canvasWidth = textWidth + padding * 2;
  const canvasHeight = heightRows;

  canvas.width = canvasWidth;
  canvas.height = canvasHeight;

  // 背景は黒
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  // テキストを白で描画（後でON/OFF判定するので色は問わない）
  ctx.font = `900 ${fontSize}px system-ui, -apple-system, sans-serif`;
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "middle";
  ctx.fillText(displayText, padding, canvasHeight / 2);

  // ピクセルデータを取得
  const imageData = ctx.getImageData(0, 0, canvasWidth, canvasHeight);
  const data = imageData.data;

  // 列ごとにON/OFF配列を作成
  // columns[x][y]
  const columns: boolean[][] = [];
  for (let x = 0; x < canvasWidth; x++) {
    const col: boolean[] = [];
    for (let y = 0; y < canvasHeight; y++) {
      const idx = (y * canvasWidth + x) * 4;
      // R値が128以上なら ON
      col.push(data[idx] > 128);
    }
    columns.push(col);
  }

  return columns;
}

// ============================================================
// 列にONピクセルが1つでもあるか判定
// ============================================================
function columnHasPixel(col: boolean[]): boolean {
  return col.some((v) => v);
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
  // ---- ビットマップ ----
  const bitmapRef = useRef<boolean[][]>([]);
  const totalColsRef = useRef(0);

  // ---- POV状態 ----
  const currentColRef = useRef(0);
  const directionRef = useRef<1 | -1>(1); // 1=右向き, -1=左向き
  const isSwingingRef = useRef(false);

  // ---- 加速度処理 ----
  const velocityRef = useRef(0);
  const prevAccRef = useRef(0);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- 画面色 ----
  // "on" = textColor, "off" = black
  const [screenOn, setScreenOn] = useState(false);

  // ---- デバッグ表示 ----
  const [debug, setDebug] = useState({
    x: 0,
    vel: 0,
    col: 0,
    total: 0,
    dir: "→",
  });

  // ---- rAF ----
  const rafRef = useRef<number | null>(null);

  // ---- タッチスワイプ用（デバッグ・PC/録画テスト用） ----
  const touchPrevXRef = useRef<number | null>(null);
  const swipeVelocityRef = useRef(0);

  // ---- ビットマップ生成 ----
  const buildBitmap = useCallback(() => {
    const heightRows = 150; // 縦解像度
    const cols = textToBitmap(text, textColor, heightRows);
    bitmapRef.current = cols;
    totalColsRef.current = cols.length;
    currentColRef.current = 0;
  }, [text, textColor]);

  useEffect(() => {
    if (permissionState === "granted") {
      buildBitmap();
    }
  }, [buildBitmap, permissionState]);

  // ---- 加速度センサー値の処理 ----
  // accelerationはpage.tsxから渡されるが、ここで独自にローパスフィルターをかける
  useEffect(() => {
    if (permissionState !== "granted") return;

    const raw = acceleration;
    const delta = raw - prevAccRef.current;
    prevAccRef.current = raw;

    // ローパスフィルター（変化量の絶対値でvelocityを算出）
    velocityRef.current = velocityRef.current * 0.5 + Math.abs(delta) * 0.5;

    // 振り方向（acceleration.x の符号）
    if (Math.abs(raw) > 0.01) {
      directionRef.current = raw > 0 ? 1 : -1;
    }

    const threshold = 0.05;

    if (velocityRef.current > threshold) {
      isSwingingRef.current = true;

      // 停止タイマーをリセット
      if (stopTimerRef.current) {
        clearTimeout(stopTimerRef.current);
      }
      stopTimerRef.current = setTimeout(() => {
        isSwingingRef.current = false;
        currentColRef.current = 0;
        setScreenOn(false);
      }, 300); // 0.3秒静止で停止
    }
  }, [acceleration, permissionState]);

  // ---- タッチスワイプハンドラ（テスト用） ----
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchPrevXRef.current = e.touches[0].clientX;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (touchPrevXRef.current === null) return;
    const currentX = e.touches[0].clientX;
    const deltaX = currentX - touchPrevXRef.current;
    touchPrevXRef.current = currentX;

    // スワイプのdeltaXをaccelerationの代わりに使う
    // deltaXの絶対値をvelocityに加算（スケール調整）
    const swipeAcc = deltaX * 0.05;
    swipeVelocityRef.current =
      swipeVelocityRef.current * 0.5 + Math.abs(swipeAcc) * 0.5;

    if (Math.abs(deltaX) > 0.1) {
      directionRef.current = deltaX > 0 ? 1 : -1;
    }

    const threshold = 0.05;
    if (swipeVelocityRef.current > threshold) {
      isSwingingRef.current = true;
      velocityRef.current = swipeVelocityRef.current;

      if (stopTimerRef.current) {
        clearTimeout(stopTimerRef.current);
      }
      stopTimerRef.current = setTimeout(() => {
        isSwingingRef.current = false;
        swipeVelocityRef.current = 0;
        currentColRef.current = 0;
        setScreenOn(false);
      }, 300);
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    touchPrevXRef.current = null;
  }, []);

  // ---- rAF ループ（メインPOVロジック） ----
  useEffect(() => {
    if (permissionState !== "granted") return;

    let lastTime = performance.now();
    // 列を進める速度: velocity が大きいほど速く進む
    // velocity=0.05(最低)で約 1列/frame, velocity=0.3で約 6列/frame
    const BASE_COL_SPEED = 20; // velocity 1.0のときの1msあたりの列進み量

    const loop = (now: number) => {
      const dt = now - lastTime;
      lastTime = now;

      if (isSwingingRef.current && totalColsRef.current > 0) {
        const vel = Math.max(velocityRef.current, swipeVelocityRef.current);
        // 1フレーム(dt ms)で進む列数
        const colStep = Math.max(1, Math.round(vel * BASE_COL_SPEED * dt * 0.001 * 60));

        // 振りの方向に応じて列を進める
        currentColRef.current =
          (currentColRef.current + colStep * directionRef.current + totalColsRef.current * 100) %
          totalColsRef.current;

        const col = bitmapRef.current[currentColRef.current];
        const isOn = col ? columnHasPixel(col) : false;
        setScreenOn(isOn);

        // デバッグ更新（毎フレームは重いので間引き）
        if (Math.random() < 0.1) {
          setDebug({
            x: Math.round(prevAccRef.current * 100) / 100,
            vel: Math.round(vel * 1000) / 1000,
            col: currentColRef.current,
            total: totalColsRef.current,
            dir: directionRef.current === 1 ? "→" : "←",
          });
        }
      } else {
        setScreenOn(false);
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [permissionState]);

  // クリーンアップ
  useEffect(() => {
    return () => {
      if (stopTimerRef.current) {
        clearTimeout(stopTimerRef.current);
      }
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
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
  // granted — バーサライトPOVモード
  // 画面全体が 1色（textColor or 黒）に切り替わる
  // ============================================================
  return (
    <div
      className="w-full h-full relative"
      style={{
        backgroundColor: screenOn ? textColor : "#000000",
        // transitionなし：残像効果のため即座に切り替える
      }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
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
          className="text-xs font-mono leading-tight px-2 py-1 rounded"
          style={{
            color: "rgba(255,255,255,0.5)",
            background: "rgba(0,0,0,0.6)",
            fontSize: "10px",
          }}
        >
          <div>x: {debug.x.toFixed(3)}</div>
          <div>vel: {debug.vel.toFixed(3)}</div>
          <div>col: {debug.col} / {debug.total}</div>
          <div>dir: {debug.dir}</div>
        </div>
      </div>
    </div>
  );
}
