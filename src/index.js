'use strict';

const { asCallback, deferred } = require('promise-callbacks');
const assert = require('assert');
const redis = require('redis');
const Scripty = require('node-redis-scripty');
const { EventEmitter } = require('events');

/**
 * Lock constructor.
 *
 * @param {Object} options
 *   @property {String|Object} redis - Redis connection string, options to pass
 *     to `redis.createClient`, or an existing instance of `RedisClient`.
 *   @property {Object} redisConnection Pre-existing Redis connection.
 *   @property {String=} namespace - An optional namespace under which to prefix all Redis keys and
 *     channels used by this lock.
 */
class Lock {
  constructor(options = {}) {
    options.namespace = options.namespace || 'lock';

    this._namespace = options.namespace;

    // Create Redis connection for issuing normal commands as well as one for
    // the subscription, since a Redis connection with subscribers is not allowed
    // to issue commands.
    assert(
      options.redis,
      'Must provide a Redis connection string, options object, or client instance.'
    );

    // Unfortunately, we cannot use `instanceof` to check redis connection
    // objects (due to the module being loaded multiple times by different
    // dependent modules). So instead, if the parameter is an object and it
    // has the `address` property, then we know it's an instantiated Redis
    // connection (as the constructor options do not provide for an address
    // option).
    if (options.redis && options.redis.address) {
      this._redisConnection = options.redis;

      const redisAddress = this._redisConnection.address;
      this._redisSubscriber = redis.createClient(`redis://${redisAddress}`);
    } else {
      // We assume `options.redis` is a connection string or options object.
      this._redisConnection = redis.createClient(options.redis);
      this._redisSubscriber = redis.createClient(options.redis);
    }

    // Handler to run LUA scripts. Uses caching if possible
    this._scripty = new Scripty(this._redisConnection);

    // Create event handler to register waiting locks
    this._subscribers = new EventEmitter();
    this._subscribers.setMaxListeners(Infinity);

    // Whenever a lock is released it is published to the namespaced '-release' channel
    // using the lock key as the message.
    this._redisSubscriber.subscribe(`${this._namespace}-release`);
    this._redisSubscriber.on('message', (channel, message) => {
      if (channel !== `${this._namespace}-release` || !this._subscribers.listenerCount(message)) {
        // just ignore, nothing to do here
        return;
      }

      // Notify all waiting instances about the released lock
      this._subscribers.emit(message);
    });
  }

  /**
   * Acquire a lock for a specific ID value. Callback returns the following value:
   *
   *   {
   *     success: either true (lock was acquired) of false (lock was not aquired)
   *     ttl: expiration time for the lock
   *   }
   *
   * Lock index is a shared incrementing number (signed 64bit) that should ensure rogue
   * lock holders would not be able to mess with newer locks for the same resource.
   *
   * @param {String} id Identifies the lock. This is an arbitrary string that should be consistent among
   *    different processes trying to acquire this lock.
   * @param {Number} ttl Automatically release lock after TTL (ms). Must be positive integer
   *
   * @return {Promise<Lock>}
   */
  async acquireLock(id, ttl) {
    const acquireScript = `
        local ttl=tonumber(ARGV[1]);
        if redis.call("EXISTS", KEYS[1]) == 1 then
          return {0, -1, redis.call("PTTL", KEYS[1])};
        end;
        --[[
          Use a global incrementing counter
          It is a signed 64bit integer, so it should not overflow any time soon.
          The number gets converted to JS which uses 64bit floats but even if the
          boundary would be much smaller Number.MAX_SAFE_INTEGER it would take thousands
          of years to reach that limit assuming we make 100k incrementations in a second
        --]]
        local index = redis.call("INCR", KEYS[2]);
        redis.call("HMSET", KEYS[1], "index", index);
        redis.call("PEXPIRE", KEYS[1], ttl);
        return {1, index, ttl};
      `;

    const scriptPromise = deferred();
    this._scripty.loadScript('acquireScript', acquireScript, scriptPromise.defer());
    const script = await scriptPromise;

    const runPromise = deferred();
    script.run(2, `${this._namespace}:${id}`, `${this._namespace}index`, ttl, runPromise.defer());
    const evalResponse = await runPromise;

    return {
      id,
      success: !!evalResponse[0],
      index: evalResponse[1],
      ttl: evalResponse[2],
    };
  }

  /**
   * Releases a lock. Operation only succeeds if a correct modification index is provided.
   * If modification index has been changed then it should indicate that the previously held
   * lock was expired in the meantime and someone has already acquired a new lock for the same id.
   * If lock is not released manually then it expires automatically after the ttl
   *
   * Callback returns the following value:
   *
   *   {
   *     success: either true (lock was released or did not exist) of false (lock was not released)
   *     result: status text. Either 'expired', 'released' or 'conflict'
   *   }
   *
   * @param {Object} lock A lock returned by acquireLock or waitAcquireLock
   *
   * @return {Promise<Lock>}
   */
  async releaseLock(lock) {
    const releaseScript = `
        local index = tonumber(ARGV[1]);
        if redis.call("EXISTS", KEYS[1]) == 0 then
          return {1, "expired", "expired", 0};
        end;
        local data = {
          ["index"]=tonumber(redis.call("HGET", KEYS[1], "index"))
        };
        if data.index == index then
          redis.call("DEL", KEYS[1]);
          -- Notify potential queue that this lock is now freed
          redis.call("PUBLISH", "${this._namespace}-release", KEYS[1]);
          return {1, "released", data.index};
        end;
        return {0, "conflict", data.index};
      `;

    const scriptPromise = deferred();
    this._scripty.loadScript('releaseScript', releaseScript, scriptPromise.defer());
    const script = await scriptPromise;

    const runPromise = deferred();
    script.run(1, `${this._namespace}:${lock.id}`, lock.index, runPromise.defer());
    const evalResponse = await runPromise;

    return {
      id: lock.id,
      success: !!evalResponse[0],
      result: evalResponse[1],
      index: evalResponse[2],
    };
  }

  /**
   * Acquire a lock for a specific ID value. If the lock is not available then waits
   * up to {waitTtl} milliseconds before giving up. The callback returns the following values:
   *
   *   {
   *     success: either true (lock was acquired) of false (lock was not aquired by given ttl)
   *     ttl: expiration time for the lock
   *   }
   *
   * @param {String} id Identifies the lock. This is an arbitrary string that should be consistent among
   *    different processes trying to acquire this lock.
   * @param {Number} ttl Automatically release acquired lock after TTL (ms). Must be positive integer
   * @param {Number} waitTtl Give up until ttl (in ms) or wait indefinitely if value is 0
   *
   * @return {Promise<Lock>}
   */
  waitAcquireLock(id, lockTtl, waitTtl) {
    let expired = false; // flag to indicate that the TTL wait time was expired
    let acquiring = false; // flag to indicate that a Redis query is in process

    let ttlTimer;
    let expireLockTimer;

    return new Promise((resolve, reject) => {
      // A looping function that tries to acquire a lock. The loop goes on until
      // the lock is acquired or the wait ttl kicks in
      const tryAcquire = (initial = false) => {
        this._subscribers.removeListener(`${this._namespace}:${id}`, tryAcquire); // clears pubsub listener
        clearTimeout(ttlTimer); // clears the timer that waits until existing lock is expired
        acquiring = true;
        asCallback(this.acquireLock(id, lockTtl), (err, lock) => {
          acquiring = false;
          if (err) {
            // stop waiting if we hit into an error
            clearTimeout(expireLockTimer);
            return reject(err);
          }
          if (lock.success || expired) {
            // we got a lock or the wait TTL was expired, return what we have
            clearTimeout(expireLockTimer);
            lock.immediate = initial;
            return resolve(lock);
          }

          // Wait for either a Redis publish event or for the lock expiration timer to expire
          this._subscribers.addListener(`${this._namespace}:${id}`, tryAcquire);
          // Remaining TTL for the lock might be very low, even 0 (lock expires by next ms)
          // in any case we do not make a next polling try sooner than after 100ms delay
          // We might make the call sooner if the key is released manually and we get a notification
          // from Redis PubSub about it
          ttlTimer = setTimeout(tryAcquire, Math.max(lock.ttl, 100));
        });
      };

      if (waitTtl > 0) {
        expireLockTimer = setTimeout(() => {
          expired = true;
          this._subscribers.removeListener(`${this._namespace}:${id}`, tryAcquire);
          clearTimeout(ttlTimer);
          // Try one last time and return whatever the acquireLock returns
          if (!acquiring) {
            tryAcquire();
          }
        }, waitTtl);
      }

      // try to acquire a lock
      tryAcquire(true);
    });
  }

  /**
   * Renews a lock in Redis by extending its TTL (time to live).
   *
   * @async
   * @param {Object} lock The lock to renew.
   * @param {string} lock.id The ID of the lock to renew.
   * @param {string} lock.index The index of the lock to renew.
   * @param {number} ttl The new TTL (time to live) for the lock, in milliseconds.
   *
   * @returns {Promise<Lock>} A Promise that resolves to an object with the renewed lock's ID, success status, TTL, and index.
   * @throws {Error} If there is an error executing the renew lock script in Redis.
   */
  async renewLock(lock, ttl) {
    const renewScript = `
      if redis.call("EXISTS", KEYS[1]) == 0 then
        return {0, "missing", -1};
      end;

      local index = redis.call("HGET", KEYS[1], "index");
      if index ~= ARGV[1] then
        return {0, "conflict", -1};
      end;

      redis.call("PEXPIRE", KEYS[1], ARGV[2]);
      return {1, "renewed", tonumber(ARGV[1])};
    `;
    const scriptPromise = deferred();
    this._scripty.loadScript('renewScript', renewScript, scriptPromise.defer());
    const script = await scriptPromise;

    const runPromise = deferred();
    script.run(1, `${this._namespace}:${lock.id}`, lock.index, ttl, runPromise.defer());
    const evalResponse = await runPromise;

    return {
      id: lock.id,
      success: !!evalResponse[0],
      result: evalResponse[1],
      index: evalResponse[2],
    };
  }
}

module.exports = Lock;
