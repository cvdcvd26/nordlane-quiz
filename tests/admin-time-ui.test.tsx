import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MessageList } from "@/components/chat/MessageList";
import { useAdminI18n } from "@/components/admin/i18n";
import type { ChatMessage } from "@/lib/api";

afterEach(() => vi.useRealTimers());

describe("admin timestamp wiring", () => {
  it("formats activity and other shared admin timestamps in Kyiv", () => {
    const instant = "2026-11-10T12:10:00Z";
    vi.useFakeTimers();
    vi.setSystemTime(new Date(instant));
    function ActivityTime() {
      const { time } = useAdminI18n();
      return <time dateTime={instant}>{time(instant)}</time>;
    }
    expect(renderToStaticMarkup(<ActivityTime />)).toBe(`<time dateTime="${instant}">14:10</time>`);
  });

  it.each(["visitor", "admin", "system"] as const)("shows %s messages in the viewer's zone without changing their timestamp", sender => {
    const instant = "2026-07-15T12:10:00Z";
    vi.useFakeTimers();
    vi.setSystemTime(new Date(instant));
    const message: ChatMessage = { id: "sample", clientMessageId: "sample", sender, body: "Test", createdAt: instant, files: [] };
    for (const viewer of ["admin", "visitor"] as const) {
      const markup = renderToStaticMarkup(<MessageList messages={[message]} viewer={viewer} appearance={viewer} emptyText="Empty" locale="en-US" />);
      expect(markup).toContain(viewer === "admin" ? "15:10" : "14:10");
      expect(markup).toContain(`dateTime="${instant}"`);
    }
  });
});
