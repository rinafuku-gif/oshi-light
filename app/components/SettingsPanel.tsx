"use client";

import { useRef, useCallback } from "react";
import type { AppState, Mode } from "../types";
import { COLOR_PRESETS, BG_PRESETS } from "../types";

interface SettingsPanelProps {
  state: AppState;
  onChange: (patch: Partial<AppState>) => void;
  onClose: () => void;
}

const MODES: { value: Mode; label: string; icon: string }[] = [
  { value: "static", label: "うちわ", icon: "🪭" },
  { value: "scroll", label: "電光掲示板", icon: "💫" },
  { value: "pov", label: "POV", icon: "✨" },
  { value: "blink", label: "サイリウム", icon: "🌈" },
];

function ColorSwatch({
  value,
  selected,
  onSelect,
  label,
}: {
  value: string;
  selected: boolean;
  onSelect: () => void;
  label: string;
}) {
  return (
    <button
      aria-label={label}
      onClick={onSelect}
      className="w-10 h-10 rounded-full border-2 transition-all active:scale-90"
      style={{
        backgroundColor: value,
        borderColor: selected ? "#ffffff" : "transparent",
        boxShadow: selected ? `0 0 0 2px ${value}` : "none",
      }}
    />
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  formatValue,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  formatValue?: (v: number) => string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-between items-center">
        <span className="text-white/70 text-sm">{label}</span>
        <span className="text-white/50 text-xs">
          {formatValue ? formatValue(value) : value}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-2 rounded-full appearance-none cursor-pointer"
        style={{
          accentColor: "#FF69B4",
          background: `linear-gradient(to right, #FF69B4 ${((value - min) / (max - min)) * 100}%, rgba(255,255,255,0.15) 0%)`,
        }}
      />
    </div>
  );
}

export function SettingsPanel({ state, onChange, onClose }: SettingsPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const url = URL.createObjectURL(file);
      onChange({ imageUrl: url });
    },
    [onChange]
  );

  const clearImage = useCallback(() => {
    if (state.imageUrl) {
      URL.revokeObjectURL(state.imageUrl);
    }
    onChange({ imageUrl: null });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [state.imageUrl, onChange]);

  const isTextMode = state.mode === "static" || state.mode === "scroll" || state.mode === "pov";
  const isBlinkMode = state.mode === "blink";

  return (
    <div
      className="absolute inset-x-0 bottom-0 z-50 glass rounded-t-3xl"
      style={{ maxHeight: "80vh", overflowY: "auto" }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* ドラッグハンドル */}
      <div className="flex justify-center pt-3 pb-1">
        <div className="w-10 h-1 bg-white/20 rounded-full" />
      </div>

      <div className="px-5 pb-10 pt-2 flex flex-col gap-5">
        {/* 閉じるボタン */}
        <div className="flex justify-between items-center">
          <h2 className="text-white font-bold text-lg">設定</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white/60 active:bg-white/20"
          >
            ✕
          </button>
        </div>

        {/* モード選択 */}
        <div>
          <p className="text-white/50 text-xs mb-2 uppercase tracking-wider">モード</p>
          <div className="grid grid-cols-4 gap-2">
            {MODES.map((m) => (
              <button
                key={m.value}
                onClick={() => onChange({ mode: m.value })}
                className="flex flex-col items-center gap-1.5 py-3 px-2 rounded-2xl text-xs font-bold transition-all active:scale-95"
                style={{
                  background:
                    state.mode === m.value
                      ? "rgba(255,105,180,0.3)"
                      : "rgba(255,255,255,0.06)",
                  border:
                    state.mode === m.value
                      ? "1px solid rgba(255,105,180,0.6)"
                      : "1px solid transparent",
                  color: state.mode === m.value ? "#FF69B4" : "rgba(255,255,255,0.5)",
                }}
              >
                <span className="text-2xl">{m.icon}</span>
                <span>{m.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* テキスト入力 */}
        {isTextMode && (
          <div>
            <p className="text-white/50 text-xs mb-2 uppercase tracking-wider">テキスト</p>
            <input
              type="text"
              value={state.text}
              onChange={(e) => onChange({ text: e.target.value })}
              placeholder="推しの名前など..."
              maxLength={30}
              className="w-full bg-white/10 border border-white/15 rounded-2xl px-4 py-3 text-white placeholder-white/30 text-base outline-none focus:border-white/40"
            />
          </div>
        )}

        {/* 文字色 */}
        {(isTextMode || isBlinkMode) && (
          <div>
            <p className="text-white/50 text-xs mb-2 uppercase tracking-wider">
              {isBlinkMode ? "点滅カラー" : "文字色"}
            </p>
            <div className="flex gap-3 flex-wrap items-center">
              {COLOR_PRESETS.map((c) => (
                <ColorSwatch
                  key={c.value}
                  value={c.value}
                  label={c.label}
                  selected={state.textColor === c.value}
                  onSelect={() => onChange({ textColor: c.value, bgColor: isBlinkMode ? c.value : state.bgColor })}
                />
              ))}
              <div className="relative">
                <input
                  type="color"
                  value={state.textColor}
                  onChange={(e) => onChange({ textColor: e.target.value })}
                  className="w-10 h-10 rounded-full cursor-pointer opacity-0 absolute inset-0"
                  title="カスタムカラー"
                />
                <div
                  className="w-10 h-10 rounded-full border-2 border-dashed border-white/30 flex items-center justify-center text-white/50 text-xs"
                  style={{ backgroundColor: state.textColor }}
                >
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 背景色（テキストモードのみ） */}
        {isTextMode && state.mode !== "pov" && (
          <div>
            <p className="text-white/50 text-xs mb-2 uppercase tracking-wider">背景色</p>
            <div className="flex gap-3 flex-wrap items-center">
              {BG_PRESETS.map((c) => (
                <ColorSwatch
                  key={c.value}
                  value={c.value}
                  label={c.label}
                  selected={state.bgColor === c.value}
                  onSelect={() => onChange({ bgColor: c.value })}
                />
              ))}
              <div className="relative">
                <input
                  type="color"
                  value={state.bgColor}
                  onChange={(e) => onChange({ bgColor: e.target.value })}
                  className="w-10 h-10 rounded-full cursor-pointer opacity-0 absolute inset-0"
                  title="カスタム背景色"
                />
                <div
                  className="w-10 h-10 rounded-full border-2 border-dashed border-white/30"
                  style={{ backgroundColor: state.bgColor }}
                />
              </div>
            </div>
          </div>
        )}

        {/* スクロール速度 */}
        {state.mode === "scroll" && (
          <Slider
            label="スクロール速度"
            value={state.scrollSpeed}
            min={60}
            max={500}
            step={10}
            onChange={(v) => onChange({ scrollSpeed: v })}
            formatValue={(v) => `${v}px/s`}
          />
        )}

        {/* 点滅設定 */}
        {isBlinkMode && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <span className="text-white/70 text-sm">BPM連動</span>
              <button
                onClick={() => onChange({ blinkSpeed: state.blinkSpeed })}
                className="relative w-12 h-6 rounded-full transition-colors"
                style={{ background: "rgba(255,255,255,0.15)" }}
              >
                <span className="text-white/40 text-xs">OFF</span>
              </button>
            </div>

            <Slider
              label="点滅速度"
              value={state.blinkSpeed}
              min={80}
              max={1000}
              step={20}
              onChange={(v) => onChange({ blinkSpeed: v })}
              formatValue={(v) => {
                const bpm = Math.round(60000 / (v * 2));
                return `${bpm} BPM`;
              }}
            />
          </div>
        )}

        {/* 画像アップロード（staticモードのみ） */}
        {state.mode === "static" && (
          <div>
            <p className="text-white/50 text-xs mb-2 uppercase tracking-wider">画像</p>
            {state.imageUrl ? (
              <div className="flex flex-col gap-2">
                <div className="relative w-full h-32 rounded-2xl overflow-hidden">
                  <img
                    src={state.imageUrl}
                    alt="アップロード済み"
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => onChange({ overlayText: !state.overlayText })}
                    className="flex-1 py-2.5 rounded-xl text-sm font-bold transition-all"
                    style={{
                      background: state.overlayText
                        ? "rgba(255,105,180,0.3)"
                        : "rgba(255,255,255,0.08)",
                      border: state.overlayText
                        ? "1px solid rgba(255,105,180,0.5)"
                        : "1px solid rgba(255,255,255,0.1)",
                      color: state.overlayText ? "#FF69B4" : "rgba(255,255,255,0.6)",
                    }}
                  >
                    テキスト重ね {state.overlayText ? "ON" : "OFF"}
                  </button>
                  <button
                    onClick={clearImage}
                    className="px-4 py-2.5 rounded-xl text-sm text-white/50 bg-white/08 border border-white/10 active:bg-white/15"
                  >
                    削除
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-4 rounded-2xl border border-dashed border-white/20 text-white/40 text-sm flex flex-col items-center gap-2 active:bg-white/05"
              >
                <span className="text-3xl">📷</span>
                <span>カメラロールから選択</span>
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handleImageUpload}
            />
          </div>
        )}

        {/* 輝度案内 */}
        <div className="bg-white/05 rounded-2xl p-4 text-center">
          <p className="text-white/40 text-xs">
            📱 スマホの画面輝度を最大にすると<br />より明るく見えます
          </p>
        </div>
      </div>
    </div>
  );
}
