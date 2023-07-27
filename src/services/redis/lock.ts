import { randomBytes } from 'crypto';
import { client } from '$services/redis';

export const withLock = async (key: string, cb: (redisClient: Client, signal: any) => any) => {
	const timeoutMillis = 2000;
	const retryDelayMillis = 100;
	let retries = 20;

	const token = randomBytes(6).toString('hex');

	const lockKey = `lock:${key}`;

	while (retries >= 0) {
		retries--;
		
		const acquired = await client.set(lockKey, token, {
			NX: true,
			// in case of a server failure
			// this ensures that the lock is deleted and the function can proceed to work normally
			PX: timeoutMillis
		});

		if (!acquired) {
			await pause(retryDelayMillis);
			continue;
		}

		// delete lock in case of an error inside callback function
		try {
			const signal = { expired: false };
			setTimeout(() => {
				signal.expired = true;
			}, timeoutMillis);
			const proxiedClient = buildClientProxy(timeoutMillis);
			const result = cb(proxiedClient, signal);
			return result;
		} finally {
			await client.unlock(lockKey, token);
		}
	}
};

type Client = typeof client;

const buildClientProxy = (timeoutMillis: number) => {
	const startTime = Date.now();

	const handler = {
		get(target: Client, prop: keyof Client) {
			if (Date.now() >= startTime + timeoutMillis) {
				throw new Error('Lock has expired.');
			}
			const value = target[prop];
			return typeof value === 'function' ? value.bind(target) : value;
		}
	}

	return new Proxy(client, handler) as Client;
};

const pause = (duration: number) => {
	return new Promise((resolve) => {
		setTimeout(resolve, duration);
	});
};
