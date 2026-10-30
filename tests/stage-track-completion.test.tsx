// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StageTrack, StageStepper } from "@/components/admin/ui";
import { setAdminLang } from "@/components/admin/i18n";
import { adminDicts, type AdminLang } from "@/config/admin-i18n";
import { workflowCopy } from "@/config/admin-workflow";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe("list stage completion distinction", () => {
  it.each<[AdminLang, string, string]>([
    ["ru", "Задание выполнено", "Выполняет задание"],
    ["pl", "Zadanie wykonane", "Wykonuje zadanie"],
    ["en", "Task completed", "Working on task"],
  ])("distinguishes the submitted badge from an active task in %s", async (lang, completed, active) => {
    setAdminLang(lang);
    await act(async () => root.render(<>
      <div id="submitted"><StageTrack stage="submitted" answered={3} total={3} /></div>
      <div id="active"><StageTrack stage="task" answered={3} total={3} /></div>
      <div id="questions"><StageTrack stage="questions" answered={2} total={3} /></div>
      <div id="stepper"><StageStepper stage="submitted" answered={3} total={3} /></div>
    </>));
    const submitted = host.querySelector("#submitted")!;
    const badge = submitted.firstElementChild!;
    expect(submitted.textContent).toBe(completed);
    expect(badge.className).toContain("rounded-full");
    expect(badge.className).toContain("border-adm-green/30");
    expect(badge.className).toContain("bg-adm-green-bg");
    expect(badge.getAttribute("title")).toBe(workflowCopy[lang].stageSubmittedHint);
    expect(submitted.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(submitted.querySelector('span[aria-hidden="true"]')).toBeNull();

    const task = host.querySelector("#active")!;
    expect(task.textContent).toBe(active);
    expect(task.querySelector("svg")).toBeNull();
    const bars = [...task.querySelector('span[aria-hidden="true"]')!.children];
    expect(bars).toHaveLength(4);
    expect(bars.filter(bar => bar.className.includes("bg-adm-blue"))).toHaveLength(3);
    expect(task.querySelector(".bg-adm-green-bg")).toBeNull();

    const questions = host.querySelector("#questions")!;
    expect(questions.textContent).toContain(adminDicts[lang].ui.workflow.answered(2, 3));
    expect(questions.querySelector('span[aria-hidden="true"]')!.children).toHaveLength(4);
    const stepper = host.querySelector("#stepper")!;
    expect(stepper.querySelectorAll("li")).toHaveLength(4);
    expect(stepper.textContent).toContain(adminDicts[lang].ui.workflow.steps[3]);
    expect(stepper.textContent).not.toContain(completed);
  });
});
