"use client";

import { useState, useCallback } from "react";
import type { AppState } from "./types";
import { StaticMode } from "./components/StaticMode";
import { ScrollMode } from "./components/ScrollMode";
import { POVMode } from "./components/POVMode";
import { BlinkMode } from "./components/BlinkMode";
import { SettingsPanel } from "./components/SettingsPanel";
import { useWakeLock } from "./hooks/useWakeLock";
import { useDeviceMotion } from "./hooks/useDeviceMotion";

const DEFAULT_STATE: AppState = {
  mode: "static",
  text: "推し",
  textColor: "#FF69B4",
  bgColor: "#000000",
  scrollSpeed: 150,
  blinkSpeed: 300,
  imageUrl: null,
  overlayText: false,
  panelOpen: false,
};

export default function Home() {
  const [state, setState] = useState<AppState>(DEFAULT_STATE);

  const patch = useCallback((update: Partial<AppState>) => {
    setState((prev) => ({ ...prev, ...update }));
  }, []);

  const togglePanel = useCallback(() => {
    setState((prev) => {
      if (prev.mode === "pov") return prev;
      return { ...prev, panelOpen: !prev.panelOpen };
    });
  }, []);

  const closePanel = useCallback(() => {
    setState((prev) => ({ ...prev, panelOpen: false }));
  }, []);

  // 画面スリープ防止
  useWakeLock(true);

  // 加速度センサー（POVモード）
  const { permissionState, requestPermission } = useDeviceMotion(
    state.mode === "pov"
  );

  const handleRequestPermission = useCallback(async () => {
    await requestPermission();
  }, [requestPermission]);

  return (
    <div
      className="fixed inset-0 overflow-hidden select-none"
      onClick={togglePanel}
    >
      {/* メイン表示エリア */}
      <div className="w-full h-full">
        {state.mode === "static" && (
          <StaticMode
            text={state.text}
            textColor={state.textColor}
            bgColor={state.bgColor}
            imageUrl={state.imageUrl}
            overlayText={state.overlayText}
          />
        )}

        {state.mode === "scroll" && (
          <ScrollMode
            text={state.text}
            textColor={state.textColor}
            bgColor={state.bgColor}
            speed={state.scrollSpeed}
          />
        )}

        {state.mode === "pov" && (
          <POVMode
            text={state.text}
            textColor={state.textColor}
            permissionState={permissionState}
            onRequestPermission={handleRequestPermission}
          />
        )}

        {state.mode === "blink" && (
          <BlinkMode
            color={state.textColor}
            blinkSpeed={state.blinkSpeed}
          />
        )}
      </div>

      {/* 設定ボタン（パネル閉じている時のみ） */}
      {!state.panelOpen && (
        <div
          className="absolute bottom-6 right-5 z-40 pointer-events-auto"
          onClick={(e) => {
            e.stopPropagation();
            setState((prev) => ({ ...prev, panelOpen: true }));
          }}
        >
          <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center">
            <span className="text-xl">⚙️</span>
          </div>
        </div>
      )}

      {/* 設定パネル */}
      {state.panelOpen && (
        <>
          {/* オーバーレイ */}
          <div
            className="absolute inset-0 z-40"
            onClick={closePanel}
          />
          <SettingsPanel
            state={state}
            onChange={patch}
            onClose={closePanel}
          />
        </>
      )}
    </div>
  );
}
