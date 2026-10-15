import type { RuntimeMessage } from '../types/contracts';
import { isDeviceMessage, isPanelMessage } from '../types/contracts';

// Register synchronously on every worker start. Routing has no connection or
// tab registry to lose when Chrome suspends the worker or a frame goes away.
chrome.runtime.onMessage.addListener((envelope: RuntimeMessage, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !envelope?.message) return;
  const message = envelope.message;
  const complete = () => {
    // No open panel / navigated or closed tab is an ordinary lifecycle event.
    void chrome.runtime.lastError;
    respond();
  };
  if (envelope.source === 'content' && sender.tab?.id !== undefined && isDeviceMessage(message)) {
    // Derive the tab from Chrome, never from data the inspected page supplies.
    chrome.runtime.sendMessage({source: 'background', message: {...message, tabId: sender.tab.id}}, complete);
    return true;
  }
  if (envelope.source === 'panel' && !sender.tab &&
      sender.url === chrome.runtime.getURL('src/app/panel.html') &&
      Number.isInteger(message.tabId) && isPanelMessage(message)) {
    // Omitting frameId broadcasts to every live content script in the tab,
    // including frames created after the panel/worker started.
    chrome.tabs.sendMessage(message.tabId!, {source: 'background', message}, complete);
    return true;
  }
});
