"use client";

import { useState, useEffect, useCallback } from "react";

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

  const handleMotion = useCallback((event: DeviceMotionEvent) => {
    const acc = event.accelerationIncludingGravity;
    if (!acc) return;
    setAcceleration({
      x: acc.x ?? 0,
      y: acc.y ?? 0,
      z: acc.z ?? 0,
    });
  }, []);

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
          window.addEventListener("devicemotion", handleMotion);
        } else {
          setPermissionState("denied");
        }
      } catch {
        setPermissionState("denied");
      }
    } else {
      // Android or desktop — no permission needed
      setPermissionState("granted");
      window.addEventListener("devicemotion", handleMotion);
    }
  }, [handleMotion]);

  useEffect(() => {
    if (typeof window === "undefined") {
      setPermissionState("unavailable");
      return;
    }

    if (!("DeviceMotionEvent" in window)) {
      setPermissionState("unavailable");
      return;
    }

    // Check if permission API exists (iOS)
    const DeviceMotionEventAny = DeviceMotionEvent as unknown as {
      requestPermission?: () => Promise<string>;
    };

    if (typeof DeviceMotionEventAny.requestPermission !== "function") {
      // Android: auto-grant and start listening
      setPermissionState("granted");
      window.addEventListener("devicemotion", handleMotion);
    }
    // iOS: stays "unknown" until user taps
  }, []);

  useEffect(() => {
    if (!enabled || permissionState !== "granted") return;

    window.addEventListener("devicemotion", handleMotion);
    return () => {
      window.removeEventListener("devicemotion", handleMotion);
    };
  }, [enabled, permissionState, handleMotion]);

  return { acceleration, permissionState, requestPermission };
}
