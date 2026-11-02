"use client";

// These markers contain only a random generation, never an e-mail or account ID.
export const CANDIDATE_IDENTITY_KEY = "ab_candidate_identity_generation";
const TAB_IDENTITY_KEY = "ab_candidate_identity_seen";
const CHANNEL = "alleybiz-candidate-identity";
let currentCheck: (() => boolean) | null = null;
let adoptLocalGeneration: ((generation: string) => void) | null = null;

export function clearCandidateDrafts() {
  try {
    Object.keys(sessionStorage).filter(key =>
      key === "nl_review_draft" || key === "nl_submit_key" || key.startsWith("nl_revision_draft_"))
      .forEach(key => sessionStorage.removeItem(key));
  } catch { /* A full reload also discards all in-memory drafts. */ }
}

function readGeneration(): string | undefined {
  try { return localStorage.getItem(CANDIDATE_IDENTITY_KEY) ?? ""; }
  catch { return undefined; }
}

function rememberGeneration(generation: string) {
  try { sessionStorage.setItem(TAB_IDENTITY_KEY, generation); } catch { /* Storage can be unavailable. */ }
}

/** Called only after the server has changed the signed-in candidate. */
export function announceCandidateIdentityChange() {
  const generation = crypto.randomUUID();
  clearCandidateDrafts();
  rememberGeneration(generation);
  adoptLocalGeneration?.(generation);
  try { localStorage.setItem(CANDIDATE_IDENTITY_KEY, generation); } catch { /* BroadcastChannel still reaches live tabs. */ }
  try {
    const channel = new BroadcastChannel(CHANNEL);
    channel.postMessage(generation);
    channel.close();
  } catch { /* The storage event/focus check covers browsers without BroadcastChannel. */ }
}

/** Guard polling, saves and uploads as well as background tabs resuming later. */
export function candidateIdentityIsCurrent() {
  return currentCheck?.() ?? true;
}

export function observeCandidateIdentity(onChanged: () => void) {
  let baseline = readGeneration();
  let invalidated = false;
  const invalidate = (generation: string | undefined) => {
    if (invalidated) return;
    invalidated = true;
    clearCandidateDrafts();
    if (generation !== undefined) rememberGeneration(generation);
    onChanged();
  };
  const check = () => {
    const generation = readGeneration();
    if (!invalidated && baseline !== undefined && generation !== undefined && generation !== baseline) invalidate(generation);
    return !invalidated;
  };
  const adopt = (generation: string) => { baseline = generation; };
  currentCheck = check;
  adoptLocalGeneration = adopt;

  // A suspended/duplicated tab may have missed both events. Check its saved generation
  // before loading the session or allowing its old task draft to be used again.
  if (baseline !== undefined) {
    try {
      const previous = sessionStorage.getItem(TAB_IDENTITY_KEY);
      if (previous !== null && previous !== baseline) invalidate(baseline);
      else rememberGeneration(baseline);
    } catch { /* Do not enter a reload loop when storage is blocked. */ }
  }

  const onStorage = (event: StorageEvent) => {
    if (event.key === CANDIDATE_IDENTITY_KEY || event.key === null) check();
  };
  const onResume = () => { if (document.visibilityState === "visible") check(); };
  let channel: BroadcastChannel | undefined;
  try {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = event => {
      if (typeof event.data !== "string" || !/^[a-f0-9-]{36}$/.test(event.data)) return;
      if (event.data === baseline) return;
      const generation = readGeneration();
      if (generation === undefined) invalidate(undefined);
      else check(); // Ignore delayed broadcasts if localStorage already has our generation.
    };
  } catch { /* Storage events and resume checks remain available. */ }
  window.addEventListener("storage", onStorage);
  window.addEventListener("focus", onResume);
  window.addEventListener("pageshow", onResume);
  document.addEventListener("visibilitychange", onResume);

  return {
    isCurrent: check,
    dispose() {
      if (currentCheck === check) currentCheck = null;
      if (adoptLocalGeneration === adopt) adoptLocalGeneration = null;
      channel?.close();
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onResume);
      window.removeEventListener("pageshow", onResume);
      document.removeEventListener("visibilitychange", onResume);
    },
  };
}
