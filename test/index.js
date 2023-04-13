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
    expect(newLock.immediate).to.equal(false);
    expect(Date.now() - start).to.be.above(1450);

    await testLock.releaseLock(newLock);
  });

  it('should wait and not acquire a lock', async function() {
    const initialLock = await testLock.acquireLock(testKey, 1 * 60 * 1000);
    expect(initialLock.success).to.equal(true);

    const start = Date.now();
    const newLock = await testLock.waitAcquireLock(testKey, 1 * 60 * 1000, 1500);
    expect(newLock.success).to.equal(false);
    expect(Date.now() - start).to.be.above(1450);

    await testLock.releaseLock(initialLock);
  });

  it('should acquire the lock immediately with waitAcquireLock', async function() {
    const initialLock = await testLock.waitAcquireLock(testKey, 1 * 60 * 1000, 1500);
    expect(initialLock.success).to.equal(true);
    expect(initialLock.immediate).to.equal(true);

    await testLock.releaseLock(initialLock);
  });

  it('should be able to be constructed from a pre-existing connection', async function() {
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
    expect(newLock.immediate).to.equal(false);
    expect(Date.now() - start).to.be.above(1450);

    await testExistingLock.releaseLock(newLock);
  });

  it('should renew and release a lock with a valid index', async () => {
    const lock = await testLock.acquireLock(testKey, 60 * 100);

    expect(lock.success).to.equal(true);
    expect(lock.id).to.equal(testKey);
    expect(lock.index).to.be.above(0);

    const renewLock = await testLock.renewLock(lock, 60 * 100);

    expect(renewLock.success).to.equal(true);
    expect(renewLock.result).to.equal('renewed');
    expect(renewLock.id).to.equal(testKey);
    expect(renewLock.index).to.equal(lock.index);

    const release = await testLock.releaseLock(renewLock);
    expect(release.success).to.equal(true);
  });

  it('should not be able to renew and release a lock with a invalid index', async () => {
    const lock = await testLock.acquireLock(testKey, 60 * 100);

    expect(lock.success).to.equal(true);
    expect(lock.id).to.equal(testKey);
    expect(lock.index).to.be.above(0);

    const invalidLock = { id: lock.id, index: lock.index + 1 };
    const invalidRenewLock = await testLock.renewLock(invalidLock, 60 * 100);

    expect(invalidRenewLock.success).to.equal(false);
    expect(invalidRenewLock.result).to.equal('conflict');
    expect(invalidRenewLock.id).to.equal(testKey);
    expect(invalidRenewLock.index).to.equal(-1);

    const release = await testLock.releaseLock(invalidRenewLock);
    expect(release.success).to.equal(false);
  });

  it('should not be able to renew a lock that does not exist', async () => {
    const nonExistentLock = { id: 'non-existent-lock', index: 0 };
    const nonExistentRenewLock = await testLock.renewLock(nonExistentLock, 60 * 100);

    expect(nonExistentRenewLock.success).to.equal(false);
    expect(nonExistentRenewLock.result).to.equal('missing');
    expect(nonExistentRenewLock.id).to.equal(nonExistentLock.id);
    expect(nonExistentRenewLock.index).to.equal(-1);
  });

  it('should throw if redis is not provided', function() {
    expect(function() {
      new Lock({
        namespace: 'testExistingLock',
      });
    }).to.throw(/must provide a redis/i);
  });
});
