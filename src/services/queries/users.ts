import type { CreateUserAttrs } from '$services/types';
import { genId } from '$services/utils';
import { client } from '$services/redis';
import { usersKey, usernamesUniqueKey, usernamesKey } from '$services/keys';

export const getUserByUsername = async (username: string) => {
  const decimalId = await client.zScore(usernamesKey(), username);
  if (!decimalId) {
    throw new Error('User does not exists.');
  };
  const id = decimalId.toString(16); // converts base ten number to hex string
  return getUserById(id);
};

export const getUserById = async (id: string) => {
  const user = await client.hGetAll(usersKey(id));
  return deserialize(id, user);
}; 

export const createUser = async (attrs: CreateUserAttrs) => {
  const exists = await client.sIsMember(usernamesUniqueKey(), attrs.username)
  if (exists) {
    throw new Error('Username is taken');
  }
  const id = genId();
  await client.hSet(usersKey(id), serialize(attrs));
  // usernameUnique could be replaced by sorted set used in logging in process
  await client.sAdd(usernamesUniqueKey(), attrs.username);
  await client.zAdd(usernamesKey(), {
    value: attrs.username,
    score: parseInt(id, 16) // converts hex string to base 10 int
  });
  return id;
};

const serialize = (user: CreateUserAttrs) => {
  return {
    username: user.username,
    password: user.password  
  };
};

const deserialize = (id: string, user: { [key: string]: string }) => {
  return {
    id,
    username: user.username,
    password: user.password
  }
};