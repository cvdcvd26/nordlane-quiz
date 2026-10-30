// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MessageList } from "@/components/chat/MessageList";
import type { ChatMessage, PublicFile } from "@/lib/api";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  HTMLElement.prototype.scrollIntoView = vi.fn();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const pdf: PublicFile = {
  id: "3d3a7c6b-f7e5-4d05-b723-6f3d1948d038", name: "Umowa_Zofia Żółć.pdf",
  mime: "application/pdf", size: 88000, url: "/api/files/3d3a7c6b-f7e5-4d05-b723-6f3d1948d038",
};

const message = (files: PublicFile[]): ChatMessage => ({
  id: "message", clientMessageId: "client-message", sequence: "1", sender: "admin", body: "",
  createdAt: "2026-10-30T10:59:00.000Z", files,
});

describe("chat attachment links", () => {
  it.each(["visitor", "admin"] as const)("offers a direct PDF download with the original filename for %s", async viewer => {
    await act(async () => root.render(<MessageList messages={[message([pdf])]} viewer={viewer} appearance={viewer} emptyText="Empty" />));

    const link = host.querySelector<HTMLAnchorElement>("a")!;
    expect(link.getAttribute("href")).toBe(`${pdf.url}?download`);
    expect(link.download).toBe(pdf.name);
    expect(link.hasAttribute("target")).toBe(false);
    expect(link.textContent).toContain(pdf.name);
    expect(link.textContent).toContain("86 KB");
  });

  it("keeps screenshot previews separate from PDF downloads in a mixed message", async () => {
    const image: PublicFile = { ...pdf, id: "image", name: "test.png", mime: "image/png", url: "/api/files/image" };
    await act(async () => root.render(<MessageList messages={[message([image, pdf])]} viewer="visitor" emptyText="Empty" />));

    const links = [...host.querySelectorAll<HTMLAnchorElement>("a")];
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute("href")).toBe(image.url);
    expect(links[0].target).toBe("_blank");
    expect(links[0].rel).toBe("noopener");
    expect(links[0].hasAttribute("download")).toBe(false);
    expect(links[0].querySelector("img")?.getAttribute("src")).toBe(image.url);
    expect(links[0].querySelector("img")?.alt).toBe(image.name);
    expect(links[1].getAttribute("href")).toBe(`${pdf.url}?download`);
    expect(links[1].download).toBe(pdf.name);
  });
});
