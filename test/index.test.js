'use strict';

const { waitOn } = require('promise-callbacks');
const redis = require('redis');
const RedisServer = require('redis-server');

const Lock = require('../src');

const redisServerInstance = new RedisServer(6399);

// We need an unique key just in case a previous test run ended with an exception
// and testing keys were not immediately deleted (these expire automatically after a while)
const testKey = 'TEST:' + Date.now();

afterAll(() => redisServerInstance.close());

describe('lock', function() {
  let testLock;

  beforeEach(async () => {
    await redisServerInstance.open();

    testLock = new Lock({
      redis: 'redis://localhost:6399',
      namespace: 'testLock',
    });
  });

  afterEach(() => testLock.close());

  it('should acquire and release a lock only with a valid index', async () => {
    const lock = await testLock.acquireLock(testKey, 60 * 100);

    expect(lock.success).toBe(true);
    expect(lock.id).toBe(testKey);
    expect(lock.index).toBeGreaterThan(0);

    const invalidLock = await testLock.acquireLock(testKey, 60 * 100);

    expect(invalidLock.success).toBe(false);

    const invalidRelease = await testLock.releaseLock({
      id: testKey,
      index: -10,
    });
    expect(invalidRelease.success).toBe(false);

    const release = await testLock.releaseLock(lock);
    expect(release.success).toBe(true);
  });

  it('should wait and acquire a lock', async () => {
    const initialLock = await testLock.acquireLock(testKey, 1 * 60 * 1000);
    expect(initialLock.success).toBe(true);

    setTimeout(function() {
      testLock.releaseLock(initialLock).catch((err) => {
        expect(err).toBeFalsy();
      });
    }, 1500);

    const start = Date.now();
    const newLock = await testLock.waitAcquireLock(testKey, 60 * 100, 3000);
    expect(newLock.success).toBe(true);
    expect(newLock.immediate).toBe(false);
    expect(Date.now() - start).toBeGreaterThan(1450);

    await testLock.releaseLock(newLock);
  });

  it('should wait and not acquire a lock', async () => {
    const initialLock = await testLock.acquireLock(testKey, 1 * 60 * 1000);
    expect(initialLock.success).toBe(true);

    const start = Date.now();
    const newLock = await testLock.waitAcquireLock(testKey, 1 * 60 * 1000, 1500);
    expect(newLock.success).toBe(false);
    expect(Date.now() - start).toBeGreaterThan(1450);

    await testLock.releaseLock(initialLock);
  });

  it('should acquire the lock immediately with waitAcquireLock', async () => {
    const initialLock = await testLock.waitAcquireLock(testKey, 1 * 60 * 1000, 1500);
    expect(initialLock.success).toBe(true);
    expect(initialLock.immediate).toBe(true);

    await testLock.releaseLock(initialLock);
  });

  it('should be able to be constructed from a pre-existing connection', async () => {
    const client = redis.createClient('redis://localhost:6399');
    const testExistingLock = new Lock({
      redis: client,
      namespace: 'testExistingLock',
    });

    const initialLock = await testExistingLock.acquireLock(testKey, 1 * 60 * 1000);
    expect(initialLock.success).toBe(true);

    setTimeout(function() {
      testExistingLock.releaseLock(initialLock).catch((err) => {
        expect(err).toBeFalsy();
      });
    }, 1500);

    const start = Date.now();
    const newLock = await testExistingLock.waitAcquireLock(testKey, 60 * 100, 3000);
    expect(newLock.success).toBe(true);
    expect(newLock.immediate).toBe(false);
    expect(Date.now() - start).toBeGreaterThan(1450);

    await testExistingLock.releaseLock(newLock);
  });

  it('should close the connections', async () => {
    await waitOn(testLock._redisConnection, 'ready', true);

    // Should wait a total of at least 300ms, as it should wait for both operations to complete (and
    // one with wait for the other).
    const start = process.hrtime.bigint();
    testLock.waitAcquireLock(testKey, 300, 1000);
    testLock.waitAcquireLock(testKey, 300, 1000);

    await testLock.close();
    expect(process.hrtime.bigint() - start).toBeGreaterThan(3e8);
  });

  it('should throw if redis is not provided', () => {
    expect(
      () =>
        new Lock({
          namespace: 'testExistingLock',
        })
    ).toThrow(/must provide a redis/i);
  });
});
