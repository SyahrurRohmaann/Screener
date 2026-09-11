import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import webPush from "web-push";
import { signalHref } from "./deep-link";

export type Subscription = { endpoint: string; keys: { p256dh: string; auth: string } };
type PushSignal = { key: string; coin: string; sig: "LONG" | "SHORT"; score: number };

export function validPushEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    const host = url.hostname;
    return url.protocol === "https:" && !url.username && !url.password && !url.port && !url.hash && (
      host === "fcm.googleapis.com" || host === "updates.push.services.mozilla.com" ||
      host === "web.push.apple.com" || /^[a-z0-9-]+\.notify\.windows\.com$/.test(host)
    );
  } catch { return false; }
}

export function parseSubscription(value: unknown): Subscription {
  const sub = value as Subscription | null;
  const keyValid = (key: unknown, bytes: number) => typeof key === "string" && /^[A-Za-z0-9_-]+$/.test(key) &&
    Buffer.from(key, "base64url").length === bytes && Buffer.from(key, "base64url").toString("base64url") === key;
  if (!sub || !validPushEndpoint(sub.endpoint) || !keyValid(sub.keys?.auth, 16) ||
      !keyValid(sub.keys?.p256dh, 65) || Buffer.from(sub.keys.p256dh, "base64url")[0] !== 4) throw new Error("invalid_subscription");
  return { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } };
}

export async function readPushBody(request: Request): Promise<unknown> {
  if (Number(request.headers.get("content-length")) > 4096) throw new Error("payload_too_large");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("invalid_payload");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) { await reader.cancel(); throw new Error("payload_too_large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new Error("invalid_payload"); }
}

export function sameOriginMutation(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin === "null" || ["cross-site", "same-site"].includes(request.headers.get("sec-fetch-site") ?? "")) return false;
  // Standalone request URLs use the container hostname, not the public proxy host.
  const host = (request.headers.get("x-forwarded-host")?.split(",")[0] ?? request.headers.get("host"))?.trim();
  if (!host) return false;
  const protocol = request.headers.get("x-forwarded-proto")?.split(",")[0].trim() ??
    (/^localhost(?::\d+)?$/i.test(host) ? "http" : "https");
  return ["http", "https"].includes(protocol) && origin === `${protocol}://${host}`;
}

export function pushPayload(signal: PushSignal) {
  const coin = signal.coin.slice(0, 20);
  return { title: `Sinyal baru: ${coin} ${signal.sig}`, body: `${coin} ${signal.sig} | skor ${signal.score}`, tag: signal.key.slice(0, 100), url: signalHref(signal.key) };
}

export const pushConfigured = () => Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

export function createPushService(options: {
  dir: string; configured: () => boolean;
  send: (subscription: Subscription, payload: string) => Promise<unknown>;
  timeoutMs?: number;
}) {
  let queue: Promise<unknown> = Promise.resolve();
  let baseline = true;
  let sent: Set<string> | undefined;
  const exclusive = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = queue.then(operation);
    queue = next.catch(() => undefined);
    return next;
  };
  const load = async <T>(name: string, fallback: T): Promise<T> => {
    try { return JSON.parse(await readFile(join(options.dir, name), "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback; throw error; }
  };
  const save = async (name: string, data: unknown) => {
    await mkdir(options.dir, { recursive: true });
    const target = join(options.dir, name);
    await writeFile(`${target}.tmp`, JSON.stringify(data), { mode: 0o600 });
    await rename(`${target}.tmp`, target);
  };
  const subscriptions = async () => (await load<Subscription[]>("push-subscriptions.json", [])).map(parseSubscription);
  return {
    subscribe: (value: unknown) => exclusive(async () => {
      if (!options.configured()) throw new Error("push_not_configured");
      const sub = parseSubscription(value);
      const all = await subscriptions();
      const next = all.filter((item) => item.endpoint !== sub.endpoint);
      if (next.length >= 1000) throw new Error("subscription_limit");
      await save("push-subscriptions.json", [...next, sub]);
    }),
    unsubscribe: (endpoint: string) => exclusive(async () => {
      if (!validPushEndpoint(endpoint)) throw new Error("invalid_subscription");
      await save("push-subscriptions.json", (await subscriptions()).filter((sub) => sub.endpoint !== endpoint));
    }),
    publish: (candidates: PushSignal[], addedKeys: string[]) => exclusive(async () => {
      if (!options.configured()) return;
      if (!sent) sent = new Set(await load<string[]>("push-sent.json", []));
      const added = new Set(addedKeys);
      const fresh = candidates.filter((signal) => added.has(signal.key) && !sent!.has(signal.key));
      const silent = baseline;
      // Claim durably before sending: at-most-once attempts, not guaranteed delivery.
      const next = new Set(sent);
      for (const signal of fresh) next.add(signal.key);
      if (fresh.length) await save("push-sent.json", Array.from(next).slice(-4000));
      sent = new Set(Array.from(next).slice(-4000));
      baseline = false;
      if (silent || !fresh.length) return;
      const all = await subscriptions();
      const expired = new Set<string>();
      for (const signal of fresh) {
        await Promise.all(all.filter((sub) => !expired.has(sub.endpoint)).map(async (sub) => {
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            await Promise.race([
              options.send(sub, JSON.stringify(pushPayload(signal))),
              new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("push_timeout")), options.timeoutMs ?? 5000); }),
            ]);
          } catch (error) {
            const status = (error as { statusCode?: number })?.statusCode;
            if (status === 404 || status === 410) expired.add(sub.endpoint);
          } finally { if (timer) clearTimeout(timer); }
        }));
      }
      if (expired.size) await save("push-subscriptions.json", all.filter((sub) => !expired.has(sub.endpoint)));
    }),
  };
}

const globalPush = globalThis as typeof globalThis & { screenerPush?: ReturnType<typeof createPushService> };
export function pushService() {
  return globalPush.screenerPush ??= createPushService({
    dir: process.env.SCREENER_DATA_DIR ?? join(process.cwd(), ".data"),
    configured: pushConfigured,
    send: (sub, payload) => webPush.sendNotification(sub, payload, {
      timeout: 5000, TTL: 300,
      vapidDetails: { subject: process.env.VAPID_SUBJECT ?? "https://localhost", publicKey: process.env.VAPID_PUBLIC_KEY!, privateKey: process.env.VAPID_PRIVATE_KEY! },
    }),
  });
}
