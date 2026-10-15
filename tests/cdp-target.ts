import type { CDPSession } from 'playwright';
/** Attach to real DevTools/OOPIF targets, which Playwright doesn't expose as Pages. */
export async function attachTarget(cdp: CDPSession, targetId: string) {
  const {sessionId}: {sessionId: string} = await cdp.send('Target.attachToTarget', {targetId, flatten: false});
  let nextId = 0;
  const events = new Map<string, (params: unknown) => void>();
  const errors: string[] = [];
  const pending = new Map<number, {resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout>; method: string}>();
  const receive = (event: {sessionId: string; message: string}) => {
    if (event.sessionId !== sessionId) return;
    const message = JSON.parse(event.message) as {id?: number; error?: {message: string}; result?: unknown; method?: string; params?: unknown};
    if (message.id === undefined) {
      if (message.method === 'Runtime.exceptionThrown' || message.method === 'Log.entryAdded') {
        const data = message.params as {exceptionDetails?: {text: string}; entry?: {level: string; text: string}};
        if (data.exceptionDetails) errors.push(data.exceptionDetails.text);
        if (data.entry?.level === 'error') errors.push(data.entry.text);
      }
      if (message.method) events.get(message.method)?.(message.params);
      return;
    }
    const callback = pending.get(message.id);
    if (!callback) return;
    pending.delete(message.id);
    clearTimeout(callback.timer);
    if (message.error) callback.reject(new Error(`${callback.method}: ${message.error.message}`));
    else callback.resolve(message.result);
  };
  cdp.on('Target.receivedMessageFromTarget', receive);
  async function command<T>(method: string, params: object): Promise<T> {
    const id = ++nextId;
    const result = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 20000);
      pending.set(id, {resolve, reject, timer, method});
    });
    await cdp.send('Target.sendMessageToTarget', {sessionId, message: JSON.stringify({id, method, params})});
    return await result as T;
  }
  return {
    command,
    errors,
    nextEvent<T>(method: string): Promise<T> {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { events.delete(method); reject(new Error(`Timed out: ${method}`)); }, 20000);
        events.set(method, params => { clearTimeout(timer); events.delete(method); resolve(params as T); });
      });
    },
    async detach() {
      cdp.off('Target.receivedMessageFromTarget', receive);
      for (const callback of pending.values()) { clearTimeout(callback.timer); callback.reject(new Error('Target detached')); }
      pending.clear();
      await cdp.send('Target.detachFromTarget', {sessionId});
    },
    async evaluate<T, A = undefined>(callback: (argument: A) => T | Promise<T>, argument?: A): Promise<T> {
      const response = await command<{result: {value: T}; exceptionDetails?: {text: string; exception?: {description?: string}}}>('Runtime.evaluate', {
        expression: `(${callback.toString()})(${JSON.stringify(argument ?? null)})`,
        awaitPromise: true, returnByValue: true, userGesture: true,
      });
      if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
      return response.result.value;
    },
  };
}
export interface TargetInfo { targetId: string; type: string; title: string; url: string }
export async function getTargets(cdp: CDPSession): Promise<TargetInfo[]> {
  const result: {targetInfos: TargetInfo[]} = await cdp.send('Target.getTargets');
  return result.targetInfos;
}
