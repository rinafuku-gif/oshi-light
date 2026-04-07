"use client";

import { useEffect, useRef, useState } from "react";

interface POVModeProps {
  text: string;
  textColor: string;
  acceleration: number; // x-axis from DeviceMotion
  permissionState: "unknown" | "granted" | "denied" | "unavailable";
  onRequestPermission: () => Promise<void>;
}

// 振りを検知してフラッシュ表示するPOVモード（方式C）
export function POVMode({
  text,
  textColor,
  acceleration,
  permissionState,
  onRequestPermission,
}: POVModeProps) {
  const [isFlashing, setIsFlashing] = useState(false);
  const prevAccRef = useRef(0);
  const velocityRef = useRef(0);
  const flashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debugAccRef = useRef({ x: 0, raw: 0 });
  const [debugDisplay, setDebugDisplay] = useState({ x: 0, velocity: 0 });

  // 加速度から振りを検知してフラッシュ
  useEffect(() => {
    if (permissionState !== "granted") return;

    const raw = acceleration;
    const delta = Math.abs(raw - prevAccRef.current);
    prevAccRef.current = raw;

    // ローパスフィルター
    velocityRef.current = velocityRef.current * 0.4 + delta * 0.6;

    debugAccRef.current = { x: raw, raw: velocityRef.current };

    // デバッグ表示を更新（100msごとに制限）
    setDebugDisplay({ x: Math.round(raw * 100) / 100, velocity: Math.round(velocityRef.current * 1000) / 1000 });

    const threshold = 0.3; // 振りの閾値（iOSのaccelerationは重力除外で小さい値になるため低め）

    if (velocityRef.current > threshold) {
      setIsFlashing(true);

      // フラッシュ継続タイマーをリセット
      if (flashTimeoutRef.current) {
        clearTimeout(flashTimeoutRef.current);
      }
      flashTimeoutRef.current = setTimeout(() => {
        setIsFlashing(false);
      }, 120); // 振りが止まって120ms後に消える
    }
  }, [acceleration, permissionState]);

  // クリーンアップ
  useEffect(() => {
    return () => {
      if (flashTimeoutRef.current) {
        clearTimeout(flashTimeoutRef.current);
      }
    };
  }, []);

  // センサー未対応
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

  // 許可拒否
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

  // 許可待ち（iOS：必ずタップが必要）
  if (permissionState === "unknown") {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-8 bg-black px-8">
        <div className="text-7xl">✋</div>
        <div className="text-center">
          <p className="text-white font-bold text-2xl mb-3">POVモード</p>
          <p className="text-white/60 text-base leading-relaxed">
            スマホを横に振ると<br />
            文字がフラッシュ表示されます
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

  // granted — フラッシュ表示モード
  return (
    <div className="w-full h-full relative bg-black flex items-center justify-center">
      {/* メインテキスト：振り検知時にフラッシュ */}
      <div
        className="select-none transition-opacity"
        style={{
          opacity: isFlashing ? 1 : 0.05,
          transition: isFlashing ? "opacity 0.02s ease-in" : "opacity 0.08s ease-out",
          fontSize: "clamp(3rem, 20vw, 10rem)",
          fontWeight: 900,
          color: textColor,
          textShadow: isFlashing
            ? `0 0 30px ${textColor}, 0 0 60px ${textColor}, 0 0 90px ${textColor}`
            : "none",
          whiteSpace: "nowrap",
          letterSpacing: "0.05em",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        {text || "推し活ライト"}
      </div>

      {/* 振り方ガイド（フラッシュ中は非表示） */}
      {!isFlashing && (
        <div className="absolute bottom-8 left-0 right-0 flex justify-center pointer-events-none">
          <p className="text-white/25 text-sm">スマホを横に素早く振ってください</p>
        </div>
      )}

      {/* デバッグ表示：加速度の値をリアルタイム表示 */}
      <div className="absolute top-3 left-3 pointer-events-none">
        <div
          className="text-xs font-mono leading-tight px-2 py-1 rounded"
          style={{
            color: "rgba(255,255,255,0.4)",
            background: "rgba(0,0,0,0.5)",
            fontSize: "10px",
          }}
        >
          <div>x: {debugDisplay.x.toFixed(3)}</div>
          <div>vel: {debugDisplay.velocity.toFixed(3)}</div>
          <div>flash: {isFlashing ? "ON" : "—"}</div>
        </div>
      </div>
    </div>
  );
}
