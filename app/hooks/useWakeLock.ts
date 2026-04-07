"use client";

import { useEffect, useRef } from "react";

export function useWakeLock(active: boolean) {
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    if (!active) {
      wakeLockRef.current?.release().catch(() => undefined);
      wakeLockRef.current = null;
      return;
    }

    if (!("wakeLock" in navigator)) return;

    let released = false;

    navigator.wakeLock.request("screen").then((lock) => {
      if (released) {
        lock.release().catch(() => undefined);
        return;
      }
      wakeLockRef.current = lock;
    }).catch(() => undefined);

    const reacquire = () => {
      if (released || document.visibilityState !== "visible") return;
      navigator.wakeLock.request("screen").then((lock) => {
        if (released) {
          lock.release().catch(() => undefined);
          return;
        }
        wakeLockRef.current = lock;
      }).catch(() => undefined);
    };

    document.addEventListener("visibilitychange", reacquire);

    return () => {
      released = true;
      document.removeEventListener("visibilitychange", reacquire);
      wakeLockRef.current?.release().catch(() => undefined);
      wakeLockRef.current = null;
    };
  }, [active]);
}
