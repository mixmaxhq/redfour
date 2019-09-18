'use strict';

const Lock = require('../src');
const expect = require('chai').expect;
const redis = require('redis');
const RedisServer = require('redis-server');
const redisServerInstance = new RedisServer(6399);

// We need an unique key just in case a previous test run ended with an exception
// and testing keys were not immediately deleted (these expire automatically after a while)
const testKey = 'TEST:' + Date.now();

describe('lock', function() {
  let testLock;

  beforeEach((done) => {
    redisServerInstance.open(function(err) {
      if (err) throw err;

      testLock = new Lock({
        redis: 'redis://localhost:6399',
        namespace: 'testLock',
      });

      done();
    });
  });

  it('should acquire and release a lock only with a valid index', async function() {
    const lock = await testLock.acquireLock(testKey, 60 * 100);

    expect(lock.success).to.equal(true);
    expect(lock.id).to.equal(testKey);
    expect(lock.index).to.be.above(0);

    const invalidLock = await testLock.acquireLock(testKey, 60 * 100);

    expect(invalidLock.success).to.equal(false);

    const invalidRelease = await testLock.releaseLock({
      id: testKey,
      index: -10,
    });
    expect(invalidRelease.success).to.equal(false);

    const release = await testLock.releaseLock(lock);
    expect(release.success).to.equal(true);
  });

  it('should wait and acquire a lock', async function() {
    const initialLock = await testLock.acquireLock(testKey, 1 * 60 * 1000);
    expect(initialLock.success).to.equal(true);

    setTimeout(function() {
      testLock.releaseLock(initialLock).catch((err) => {
        expect(err).to.not.be.ok;
      });
    }, 1500);

    const start = Date.now();
    const newLock = await testLock.waitAcquireLock(testKey, 60 * 100, 3000);
    expect(newLock.success).to.equal(true);
    expect(Date.now() - start).to.be.above(1450);

    await testLock.releaseLock(newLock);
  });

  it('Should wait and not acquire a lock', async function() {
    const initialLock = await testLock.acquireLock(testKey, 1 * 60 * 1000);
    expect(initialLock.success).to.equal(true);

    const start = Date.now();
    const newLock = await testLock.waitAcquireLock(testKey, 1 * 60 * 1000, 1500);
    expect(newLock.success).to.equal(false);
    expect(Date.now() - start).to.be.above(1450);

    await testLock.releaseLock(initialLock);
  });

  it('Should be able to be constructed from a pre-existing connection', async function() {
    const client = redis.createClient('redis://localhost:6399');
    const testExistingLock = new Lock({
      redis: client,
      namespace: 'testExistingLock',
    });

    const initialLock = await testExistingLock.acquireLock(testKey, 1 * 60 * 1000);
    expect(initialLock.success).to.equal(true);

    setTimeout(function() {
      testExistingLock.releaseLock(initialLock).catch((err) => {
        expect(err).to.not.be.ok;
      });
    }, 1500);

    const start = Date.now();
    const newLock = await testExistingLock.waitAcquireLock(testKey, 60 * 100, 3000);
    expect(newLock.success).to.equal(true);
    expect(Date.now() - start).to.be.above(1450);

    await testExistingLock.releaseLock(newLock);
  });

  it('should throw if redis is not provided', function() {
    expect(function() {
      new Lock({
        namespace: 'testExistingLock',
      });
    }).to.throw(/must provide a redis/i);
  });
});
