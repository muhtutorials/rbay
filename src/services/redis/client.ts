import { createClient, defineScript } from 'redis';
import { itemsKey, itemsByViewsKey, itemsViewsKey } from '$services/keys';

const client = createClient({
	socket: {
		host: process.env.REDIS_HOST,
		port: parseInt(process.env.REDIS_PORT)
	},
	password: process.env.REDIS_PW,
	scripts: {
		// prevents deleting another request's lock when lock automatically is deleted by redis and
		// then deleted second time by delayed delete command (chapter 16, video 9 explanation)
		unlock: defineScript({
			NUMBER_OF_KEYS: 1,
			SCRIPT: `
				if redis.call('GET', KEYS[1]) == ARGV[1] then
					return redis.call('DEL', KEYS[1])
				end				
			`,
			transformArguments(key: string, token: string) {
				return [key, token]
			},
			transformReply(reply: any) {
				return reply;
			}			
		}),
		incrementView: defineScript({
			NUMBER_OF_KEYS: 3,
			SCRIPT: `
				local itemsViewsKey = KEYS[1]
				local itemsKey = KEYS[2]
				local itemsByViewsKey = KEYS[3]

				local itemId = ARGV[1]
				local userId = ARGV[2]

				local inserted = redis.call('PFADD', itemsViewsKey, userId)

				if inserted == 1 then
					redis.call('HINCRBY', itemsKey, 'views', 1)
					redis.call('ZINCRBY', itemsByViewsKey, 1, itemId)
				end
			`,
			transformArguments(itemId: string, userId: string) {
				return [
					itemsViewsKey(itemId), // -> items:views#someId
					itemsKey(itemId), // -> items#someId
					itemsByViewsKey(), // -> items:views
					itemId, // -> someItemId
					userId // -> someUserId
				]
				// EVALSHA ID 3 items:views#someId items#someId items:views someItemId someUserId
			},
			// nothing to return
			transformReply() {}
		}),
	}
});

client.on('error', (err) => console.error(err));
client.connect();

export { client };
