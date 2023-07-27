import type { CreateBidAttrs, Bid } from '$services/types';
import { client } from '$services/redis';
import { withLock } from '$services/redis/lock';
import { bidHistoryKey, itemsKey, itemsByPriceKey } from '$services/keys';
import { DateTime } from 'luxon';
import { getItem } from './items';

export const createBid = async (attrs: CreateBidAttrs) => {
	return withLock(attrs.itemId, async (lockedClient: typeof client, signal: any) => {
		const item = await getItem(attrs.itemId);
			if (!item) {
				throw new Error('Item does not exist.');
			};
			if (item.price >= attrs.amount) {
				throw new Error('Bid too low.');
			};
			if (item.endingAt.diff(DateTime.now()).toMillis() < 0) {
				throw new Error('Item closed to bidding.');
			};

			const serialized = serializeHistory(attrs.amount, attrs.createdAt.toMillis());
			
			if (signal.expired) {
				throw new Error('Lock expired, can\'t write anymore data.');
			}
			return Promise.all([
				lockedClient.rPush(bidHistoryKey(attrs.itemId), serialized),
				lockedClient.hSet(itemsKey(item.id), {
						bids: item.bids + 1,
						price: attrs.amount,
						highestBidUserId: attrs.userId
				}),
				lockedClient.zAdd(itemsByPriceKey(), {
					value: item.id,
					score: attrs.amount
				})
			]);
	});
	// redis transaction to avoid concurrent updates
	// return client.executeIsolated(async (isolatedClient) => {
	// 	await isolatedClient.watch(itemsKey(attrs.itemId))
	// 	const item = await getItem(attrs.itemId);
	// 		if (!item) {
	// 			throw new Error('Item does not exist.')
	// 		};
	// 		if (item.price >= attrs.amount) {
	// 			throw new Error('Bid too low.')
	// 		};
	// 		if (item.endingAt.diff(DateTime.now()).toMillis() < 0) {
	// 			throw new Error('Item closed to bidding.')
	// 		};

	// 		const serialized = serializeHistory(attrs.amount, attrs.createdAt.toMillis());

	// 		return isolatedClient
	// 			.multi()
	// 			.rPush(bidHistoryKey(attrs.itemId), serialized)
	// 			.hSet(itemsKey(item.id), {
	// 					bids: item.bids + 1,
	// 					price: attrs.amount,
	// 					highestBidUserId: attrs.userId
	// 			})
	// 			.zAdd(itemsByPriceKey(), {
	// 				value: item.id,
	// 				score: attrs.amount
	// 			})
	// 			.exec();
	// });
};

export const getBidHistory = async (itemId: string, offset = 0, count = 10): Promise<Bid[]> => {
	// get the last elements indeces in a list
	const startIndex = -1 * offset - count;
	const endIndex = -1 - offset;
	const result = await client.lRange(bidHistoryKey(itemId), startIndex, endIndex);
	return result.map(bid => deserializeHistory(bid));
};

const serializeHistory = (amount: number, createdAt: number) => {
	return `${amount}:${createdAt}`;
};

const deserializeHistory = (value: string) => {
	const [amount, createdAt] = value.split(':');
	return {
		amount: parseFloat(amount),
		createdAt: DateTime.fromMillis(parseInt(createdAt))
	};
};