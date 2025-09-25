export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(abortErr(signal));

        const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
            cleanup();
            resolve();
        }, ms);

        const onAbort = () => {
            cleanup();
            reject(abortErr(signal));
        };

        const cleanup = () => {
            clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
        };

        signal?.addEventListener('abort', onAbort, { once: true });
    });
}

function abortErr(signal?: AbortSignal): Error {
    const reason = signal?.reason;
    const err = reason instanceof Error
        ? reason
        : new Error(typeof reason === 'string' ? reason : 'Aborted');
    err.name = 'AbortError';
    return err;
}