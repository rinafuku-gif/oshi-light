"use client";

import { useState, useEffect, useCallback, useRef } from "react";

interface MotionData {
  x: number;
  y: number;
  z: number;
}

interface UseDeviceMotionReturn {
  acceleration: MotionData;
  permissionState: "unknown" | "granted" | "denied" | "unavailable";
  requestPermission: () => Promise<void>;
}

export function useDeviceMotion(enabled: boolean): UseDeviceMotionReturn {
  const [acceleration, setAcceleration] = useState<MotionData>({ x: 0, y: 0, z: 0 });
  const [permissionState, setPermissionState] = useState<"unknown" | "granted" | "denied" | "unavailable">("unknown");
  const listeningRef = useRef(false);

  const handleMotion = useCallback((event: DeviceMotionEvent) => {
    // acceleration（重力除外）優先、なければaccelerationIncludingGravityにフォールバック
    const acc = event.acceleration ?? event.accelerationIncludingGravity;
    if (!acc) return;
    setAcceleration({
      x: acc.x ?? 0,
      y: acc.y ?? 0,
      z: acc.z ?? 0,
    });
  }, []);

  const startListening = useCallback(() => {
    if (listeningRef.current) return;
    listeningRef.current = true;
    window.addEventListener("devicemotion", handleMotion);
  }, [handleMotion]);

  const requestPermission = useCallback(async () => {
    if (typeof window === "undefined") return;

    // iOS 13+ requires explicit permission
    const DeviceMotionEventAny = DeviceMotionEvent as unknown as {
      requestPermission?: () => Promise<string>;
    };

    if (typeof DeviceMotionEventAny.requestPermission === "function") {
      try {
        const response = await DeviceMotionEventAny.requestPermission();
        if (response === "granted") {
          setPermissionState("granted");
          startListening();
        } else {
          setPermissionState("denied");
        }
      } catch {
        setPermissionState("denied");
      }
    } else {
      // Android or desktop — no permission needed
      setPermissionState("granted");
      startListening();
    }
  }, [startListening]);

  useEffect(() => {
    if (typeof window === "undefined") {
      setPermissionState("unavailable");
      return;
    }

    if (!("DeviceMotionEvent" in window)) {
      setPermissionState("unavailable");
      return;
    }

    // Check if permission API exists (iOS 13+)
    const DeviceMotionEventAny = DeviceMotionEvent as unknown as {
      requestPermission?: () => Promise<string>;
    };

    if (typeof DeviceMotionEventAny.requestPermission !== "function") {
      // Android or desktop: auto-grant
      setPermissionState("granted");
      startListening();
    }
    // iOS: stays "unknown" until user taps the button
  }, [startListening]);

  // enabled/permissionState変化に応じてリスナーを開始/解除
  useEffect(() => {
    if (enabled && permissionState === "granted") {
      startListening();
    } else if (!enabled && listeningRef.current) {
      window.removeEventListener("devicemotion", handleMotion);
      listeningRef.current = false;
      setAcceleration({ x: 0, y: 0, z: 0 });
    }
  }, [enabled, permissionState, startListening, handleMotion]);

  // クリーンアップ
  useEffect(() => {
    return () => {
      if (listeningRef.current) {
        window.removeEventListener("devicemotion", handleMotion);
        listeningRef.current = false;
      }
    };
  }, [handleMotion]);

  return { acceleration, permissionState, requestPermission };
}
