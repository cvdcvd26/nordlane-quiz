import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MessageHandler, MessageMetadata, RetryHandler } from "@vercel/queue";

const mocks = vi.hoisted(() => ({
  send: vi.fn(), publish: vi.fn(), client: vi.fn(), verify: vi.fn(), callback: vi.fn(),
  handler: undefined as MessageHandler | undefined,
  retry: undefined as RetryHandler | undefined,
  register: vi.fn(), delivery: vi.fn(), info: vi.fn(), warn: vi.fn(),
}));
vi.mock("@vercel/queue", () => ({
  send: mocks.send,
  handleCallback: (handler: MessageHandler, options: { retry?: RetryHandler }) => {
    mocks.handler = handler; mocks.retry = options.retry; mocks.register();
    return mocks.callback;
  },
}));
vi.mock("@upstash/qstash", () => ({
  Client: class {
    constructor(options: unknown) { mocks.client(options); }
    publishJSON = mocks.publish;
  },
  Receiver: class { verify = mocks.verify; },
}));
vi.mock("@/server/services/delivery", () => ({ deliverScheduledMessage: mocks.delivery }));
vi.mock("@/server/log", () => ({ log: { info: mocks.info, warn: mocks.warn } }));

let queueModule: typeof import("@/server/queue");
const now = new Date("2026-10-30T10:00:00.000Z");
const jobId = randomUUID();
const metadata = (deliveryCount = 1): MessageMetadata => ({
  messageId: "queue-message-test", deliveryCount, topicName: "alleybiz-auto-replies",
  consumerGroup: "auto-reply-consumer", region: "iad1", createdAt: now,
  expiresAt: new Date(now.getTime() + 604800000),
});

beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now);
  vi.stubEnv("VERCEL", "1"); vi.stubEnv("VERCEL_REGION", "iad1");
  vi.stubEnv("QSTASH_TOKEN", ""); vi.stubEnv("QSTASH_URL", ""); vi.stubEnv("APP_URL", "");
  mocks.handler = undefined; mocks.retry = undefined;
  mocks.send.mockResolvedValue({ messageId: "native-message" });
  mocks.publish.mockResolvedValue({ messageId: "qstash-message" });
  mocks.delivery.mockResolvedValue("sent");
  mocks.callback.mockResolvedValue(new Response(null, { status: 200 }));
  queueModule = await import("@/server/queue"); queueModule.setQueue(null);
});
afterEach(() => {
  queueModule.setQueue(null); vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks();
});

describe("managed delayed auto replies", () => {
  it("uses native Queues on Vercel without external keys or a public callback URL", async () => {
    // A stale former callback origin must not affect native delivery.
    vi.stubEnv("APP_URL", "not-an-origin");
    const due = new Date(now.getTime() + 30001);
    expect(await queueModule.queue().scheduleDelivery(jobId, due)).toBe("vercel:native-message");
    expect(mocks.send).toHaveBeenCalledExactlyOnceWith("alleybiz-auto-replies", { scheduledMessageId: jobId }, {
      delaySeconds: 31, retentionSeconds: 604800, idempotencyKey: `scheduled-${jobId}`,
    });
    expect(mocks.publish).not.toHaveBeenCalled(); expect(mocks.client).not.toHaveBeenCalled();
  });

  it("preserves a full-day delay, sends overdue jobs immediately and reuses the deduplication key", async () => {
    await queueModule.queue().scheduleDelivery(jobId, new Date(now.getTime() + 86400000));
    await queueModule.queue().scheduleDelivery(jobId, new Date(now.getTime() - 5000));
    expect(mocks.send.mock.calls[0][2]).toMatchObject({ delaySeconds: 86400, retentionSeconds: 604800 });
    expect(mocks.send.mock.calls[1][2]).toMatchObject({ delaySeconds: 0, idempotencyKey: `scheduled-${jobId}` });
    expect(mocks.send.mock.calls[0][2].idempotencyKey).toBe(mocks.send.mock.calls[1][2].idempotencyKey);
  });

  it("does not hide rejected publications or mistake deferred acceptance for a known message ID", async () => {
    mocks.send.mockResolvedValueOnce({ messageId: null });
    expect(await queueModule.queue().scheduleDelivery(jobId, now)).toBeNull();
    mocks.send.mockRejectedValueOnce(new Error("queue temporarily unavailable"));
    await expect(queueModule.queue().scheduleDelivery(jobId, now)).rejects.toThrow("queue temporarily unavailable");
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it("rejects invalid and expired-at-first-delivery schedules before publishing", async () => {
    for (const due of [new Date("invalid"), new Date(now.getTime() + 604800000)]) {
      await expect(queueModule.queue().scheduleDelivery(jobId, due)).rejects.toThrow(RangeError);
    }
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("retains QStash for a non-Vercel host and the existing injectable test queue", async () => {
    vi.stubEnv("VERCEL", ""); vi.stubEnv("APP_URL", "https://self-hosted.example");
    vi.stubEnv("QSTASH_TOKEN", "local-test-placeholder");
    const due = new Date(now.getTime() + 45000);
    expect(await queueModule.queue().scheduleDelivery(jobId, due)).toBe("qstash-message");
    expect(mocks.publish).toHaveBeenCalledExactlyOnceWith({
      url: "https://self-hosted.example/api/jobs/deliver", body: { scheduledMessageId: jobId },
      notBefore: Math.ceil(due.getTime() / 1000), deduplicationId: `scheduled-${jobId}`, retries: 5,
    });
    expect(mocks.send).not.toHaveBeenCalled();
    const custom = { scheduleDelivery: vi.fn(async () => "custom-job") };
    queueModule.setQueue(custom); expect(await queueModule.queue().scheduleDelivery(jobId, due)).toBe("custom-job");
    queueModule.setQueue(null); vi.stubEnv("QSTASH_TOKEN", "");
    expect(await queueModule.queue().scheduleDelivery(jobId, due)).toBeNull();
  });

  it("keeps the daily safety net and registers the native consumer as a private queue trigger", () => {
    const config = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
    expect(config.crons).toContainEqual({ path: "/api/jobs/sweep", schedule: "0 6 * * *" });
    expect(config.functions["src/app/api/jobs/queue-deliver/route.ts"]).toEqual({
      maxDuration: 60,
      experimentalTriggers: [{ type: "queue/v2beta", topic: queueModule.AUTO_REPLY_TOPIC }],
    });
  });
});

describe("native auto-reply consumer", () => {
  it("routes valid jobs through the existing idempotent delivery service, including duplicate deliveries", async () => {
    const { POST, maxDuration } = await import("@/app/api/jobs/queue-deliver/route");
    expect(maxDuration).toBe(60); expect(mocks.register).toHaveBeenCalledOnce();
    mocks.delivery.mockResolvedValueOnce("sent").mockResolvedValueOnce("already_sent");
    await mocks.handler!({ scheduledMessageId: jobId }, metadata());
    await mocks.handler!({ scheduledMessageId: jobId }, metadata(2));
    expect(mocks.delivery.mock.calls).toEqual([[jobId], [jobId]]);
    expect(mocks.info).toHaveBeenLastCalledWith("scheduler.queue", "scheduled delivery completed", {
      scheduledId: jobId, messageId: "queue-message-test", deliveryCount: 2, outcome: "already_sent",
    });
    const request = new Request("https://callback.example/api/jobs/queue-deliver", { method: "POST" });
    expect((await POST(request)).status).toBe(200); expect(mocks.callback).toHaveBeenCalledWith(request);
  });

  it.each(["busy", "not_due"])("keeps a %s job retryable instead of acknowledging it early", async outcome => {
    await import("@/app/api/jobs/queue-deliver/route");
    mocks.delivery.mockResolvedValueOnce(outcome);
    await expect(mocks.handler!({ scheduledMessageId: jobId }, metadata())).rejects.toThrow(`scheduled_delivery_${outcome}`);
    for (const count of [1, 2, 5, 20, 100]) {
      const directive = mocks.retry!(new Error("transient"), metadata(count));
      expect(directive).toEqual({ afterSeconds: Math.min(30, 2 ** Math.min(count, 5)) });
    }
  });

  it("acknowledges invalid payloads without touching jobs or logging private extra fields", async () => {
    await import("@/app/api/jobs/queue-deliver/route");
    for (const payload of [null, {}, { scheduledMessageId: "not-a-uuid" }, { scheduledMessageId: jobId, privateBody: "must-not-log" }]) {
      await mocks.handler!(payload, metadata());
    }
    expect(mocks.delivery).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledTimes(4);
    expect(mocks.warn.mock.calls.every(call => JSON.stringify(call) === JSON.stringify([
      "scheduler.queue", "discarded invalid queue payload", { messageId: "queue-message-test" },
    ]))).toBe(true);
  });

  it("propagates database failures for SDK-managed retry", async () => {
    await import("@/app/api/jobs/queue-deliver/route");
    mocks.delivery.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(mocks.handler!({ scheduledMessageId: jobId }, metadata())).rejects.toThrow("database unavailable");
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it("has no unauthenticated native callback on self-hosted servers", async () => {
    vi.stubEnv("VERCEL", "");
    const { POST } = await import("@/app/api/jobs/queue-deliver/route");
    const request = new Request("https://self-hosted.example/api/jobs/queue-deliver", {
      method: "POST", headers: { "ce-type": "com.vercel.queue.v2beta", "ce-vqsreceipthandle": "forged" },
      body: JSON.stringify({ scheduledMessageId: jobId }),
    });
    expect((await POST(request)).status).toBe(404);
    expect(mocks.register).not.toHaveBeenCalled(); expect(mocks.callback).not.toHaveBeenCalled();
    expect(mocks.delivery).not.toHaveBeenCalled();
  });

  it("uses an SDK boundary that rejects a plain public JSON body before invoking the consumer", async () => {
    const actual = await vi.importActual<typeof import("@vercel/queue")>("@vercel/queue");
    const consumer = vi.fn();
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const client = new actual.QueueClient({ region: "iad1", token: "test-placeholder" });
      const callback = client.handleCallback(consumer);
      const response = await callback(new Request("https://callback.example/api/jobs/queue-deliver", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scheduledMessageId: jobId }),
      }));
      expect(response.status).toBe(400); expect(consumer).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
});
