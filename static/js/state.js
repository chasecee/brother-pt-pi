let saveTimer = null;

export async function pushServerState(partial) {
  const resp = await fetch("/api/state", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(partial),
  });
  if (!resp.ok) {
    let msg = resp.statusText;
    try {
      const data = await resp.json();
      if (data && data.err) msg = data.err;
    } catch {
      // ignore
    }
    throw new Error(msg || "save failed");
  }
}

export async function loadServerState() {
  const resp = await fetch("/api/state");
  return resp.json();
}

export function scheduleStateSave(buildPayload, delayMs = 400) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    await pushServerState(buildPayload());
  }, delayMs);
}

export function flushStateSave(buildPayload) {
  clearTimeout(saveTimer);
  saveTimer = null;
  fetch("/api/state", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildPayload()),
    keepalive: true,
  });
}
