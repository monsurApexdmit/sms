import { api } from "../api/client";
import { t } from "../i18n";

/** Registers public/sw.js (production builds only, so the dev server never serves stale code). */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => console.warn("Service worker registration failed", error));
  });
}

export type PushState = "unsupported" | "dev" | "denied" | "off" | "on";

export const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

/** Web push needs the service worker, which only runs in production builds. */
export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  if (!import.meta.env.PROD) return "dev";
  if (Notification.permission === "denied") return "denied";
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  return subscription ? "on" : "off";
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function enablePush(publicKey: string): Promise<void> {
  if ((await Notification.requestPermission()) !== "granted") throw new Error(t("Notifications are blocked in this browser."));
  const registration = await navigator.serviceWorker.ready;
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
  const json = subscription.toJSON();
  await api.post("/notifications/push/subscribe", { endpoint: json.endpoint, keys: json.keys });
}

export async function disablePush(): Promise<void> {
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  await api.post("/notifications/push/unsubscribe", { endpoint: subscription.endpoint });
  await subscription.unsubscribe();
}
