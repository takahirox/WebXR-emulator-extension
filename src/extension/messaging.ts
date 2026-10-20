import type { RuntimeMessage } from '../types/contracts';

export function sendRuntimeMessage(envelope: RuntimeMessage): void {
  if (!chrome.runtime?.id) return;
  chrome.runtime.sendMessage(envelope, () => {
    // A receiver can disappear during navigation/extension reload. Each new
    // message wakes the worker; no port, retry timer, or keep-alive is needed.
    void chrome.runtime.lastError;
  });
}
