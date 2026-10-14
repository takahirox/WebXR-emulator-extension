import type { CDPSession } from 'playwright';
/** Attach to real DevTools/OOPIF targets, which Playwright doesn't expose as Pages. */
export async function attachTarget(cdp: CDPSession, targetId: string) {
  const {sessionId}: {sessionId: string} = await cdp.send('Target.attachToTarget', {targetId, flatten: false});
  let nextId = 0;
  const pending = new Map<number, {resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout>}>();
  const receive = (event: {sessionId: string; message: string}) => {
    if (event.sessionId !== sessionId) return;
    const message = JSON.parse(event.message) as {id?: number; error?: {message: string}; result?: unknown};
    if (message.id === undefined) return;
    const callback = pending.get(message.id);
    if (!callback) return;
    pending.delete(message.id);
    clearTimeout(callback.timer);
    if (message.error) callback.reject(new Error(message.error.message));
    else callback.resolve(message.result);
  };
  cdp.on('Target.receivedMessageFromTarget', receive);
  async function command<T>(method: string, params: object): Promise<T> {
    const id = ++nextId;
    const result = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 20000);
      pending.set(id, {resolve, reject, timer});
    });
    await cdp.send('Target.sendMessageToTarget', {sessionId, message: JSON.stringify({id, method, params})});
    return await result as T;
  }
  return {
    command,
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
