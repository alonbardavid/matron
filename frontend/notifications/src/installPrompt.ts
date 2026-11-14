import { useSyncExternalStore } from "react";

/** Chrome's install event; not in the DOM typings. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
}

/** How this browser installs the app: its own prompt, the Share sheet on iOS, or not at all. */
export type InstallMethod = "prompt" | "ios-instructions" | null;

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let installed = false;
const subscribers = new Set<() => void>();

/** Keeps the browser's install prompt for a button to show later; call once at startup. */
export function captureInstallPrompt(): void {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    installed = true;
    notify();
  });
}

export function useInstallMethod(): InstallMethod {
  return useSyncExternalStore(subscribe, currentInstallMethod);
}

export async function promptInstall(): Promise<void> {
  const prompt = deferredPrompt;
  if (!prompt) return;
  deferredPrompt = null;
  notify();
  await prompt.prompt();
}

/** Launched from the home screen or the app list rather than a browser tab. */
export function isRunningInstalled(): boolean {
  const iosStandalone = (navigator as { standalone?: boolean }).standalone;
  return (
    iosStandalone === true || window.matchMedia("(display-mode: standalone)").matches
  );
}

/** Safari on an iPhone or iPad, where push reaches only an app added to the Home Screen. */
export function isIosSafari(): boolean {
  const ua = navigator.userAgent;
  const iPadAsMac = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  const ios = /iPhone|iPad|iPod/.test(ua) || iPadAsMac;
  return ios && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
}

function currentInstallMethod(): InstallMethod {
  if (installed || isRunningInstalled()) return null;
  if (deferredPrompt) return "prompt";
  return isIosSafari() ? "ios-instructions" : null;
}

function subscribe(onChange: () => void): () => void {
  subscribers.add(onChange);
  return () => subscribers.delete(onChange);
}

function notify(): void {
  subscribers.forEach((onChange) => onChange());
}
