## redfour

A small library that implements a binary semaphore using Redis. See our [blog post](https://mixmax.com/blog/redfour-semaphore-redis-node) introducing this library.

This is useful if you'd like to restrict access to one part of your code such that only one resource (the one with the lock) can access it at a time. Then, if another resource wants to access it, it will have to wait until the first resource is finished.

[Other redis-based locks](https://github.com/TheDeveloper/warlock/blob/master/lib/warlock.js#L67) implement the 'wait' behavior using polling. Redfour's implemention is MUCH faster, as it relies on Redis pubsub notifications to get notified when the lock is released.

For example, say you have code that checks to see if an access token is expired, and then if it is, refreshes it. You don't want two parallel processes trying to check for expiration - both will consider the token expired and refresh at the same time. Instead, you can use this module to ensure only one resource has access to that codepath at a time.

## Install

```sh
npm install redfour
```

or

```sh
yarn add redfour
```

## Usage example

```js
const Lock = require('redfour');

const testLock = new Lock({
  // Can also be an `Object` of options to pass to `redis.createClient`
  // https://github.com/NodeRedis/node_redis#rediscreateclient, or an existing
  // instance of `RedisClient` (if you want to reuse one connection, though this
  // module must create a second).
  redis: 'redis://localhost:6381',
  namespace: 'mylock'
});
const id = Math.random();

// First, acquire the lock.
let firstLock;
try {
  firstLock = await testLock.acquireLock(id, 60 * 1000 /* Lock expires after 60sec if not released */);
  if (!firstLock.success) {
    console.log('lock exists', firstLock);
  } else {
    console.log('lock acquired initially');
  }
} catch (err) {
  console.log('error acquiring', err);
}

// Another server might be waiting for the lock like this. (This example is in a `setTimeout` so that
// we can test this using a single process, though.)
setTimeout(async () => {
  let lock;
  try {
    lock = await testLock.waitAcquireLock(id, 60 * 1000 /* Lock expires after 60sec */ , 10 * 1000 /* Wait for lock for up to 10sec */);
    if (!lock.success) {
      console.log('wait expired without acquiring lock');
    } else {
      // The lock.immediate boolean will be false in this case, but if waitAcquireLock managed to
      // acquire the lock immediately, the boolean would be true.
      console.log('lock acquired after wait!', lock);
    }
  } catch (err) {
    console.log('error wait acquiring', err);
  }
});

// When the original lock is released, `waitAcquireLock` is fired on the other server.
setTimeout(async () => {
  try {
    await testLock.releaseLock(firstLock);
    console.log('released lock (after several seconds)');
  } catch (err) {
    console.log('error releasing', err);
  }
}, 3 * 1000);
```

Barring errors, the above example will print something like

```
lock acquired initially { id: 0.7904874225813969, success: true, index: 3, ttl: 60000 }
released lock (after several seconds)
lock acquired after wait! { id: 0.7904874225813969, success: true, index: 4, ttl: 60000 }
```

## Contributing

We welcome pull requests! Please lint your code.

## Etymology

Shortened (and easier to pronounce) version of "Redis Semaphore"
