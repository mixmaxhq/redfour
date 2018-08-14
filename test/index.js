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
        namespace: 'testLock'
      });

      done();
    });
  });

  it('should acquire and release a lock only with a valid index', function(done) {
    testLock.acquireLock(testKey, 60 * 100, (err, lock) => {
      expect(err).not.to.be.ok;
      expect(lock.success).to.equal(true);
      expect(lock.id).to.equal(testKey);
      expect(lock.index).to.be.above(0);

      testLock.acquireLock(testKey, 60 * 100, (err, invalidLock) => {
        expect(err).not.to.be.ok;
        expect(invalidLock.success).to.equal(false);

        testLock.releaseLock({
          id: testKey,
          index: -10
        }, (err, invalidRelease) => {
          expect(err).not.to.be.ok;
          expect(invalidRelease.success).to.equal(false);

          testLock.releaseLock(lock, (err, release) => {
            expect(err).not.to.be.ok;
            expect(release.success).to.equal(true);
            done();
          });
        });
      });
    });
  });

  it('should wait and acquire a lock', function(done) {
    testLock.acquireLock(testKey, 1 * 60 * 1000, function(err, initialLock) {
      expect(err).to.not.be.ok;
      expect(initialLock.success).to.equal(true);

      const start = Date.now();
      testLock.waitAcquireLock(testKey, 60 * 100, 3000, function(err, newLock) {
        expect(err).to.not.be.ok;
        expect(newLock.success).to.equal(true);
        expect(Date.now() - start).to.be.above(1450);

        testLock.releaseLock(newLock, function(err) {
          expect(err).to.not.be.ok;
          done();
        });
      });

      setTimeout(function() {
        testLock.releaseLock(initialLock, function(err) {
          expect(err).to.not.be.ok;
        });
      }, 1500);
    });
  });

  it('Should wait and not acquire a lock', function(done) {
    testLock.acquireLock(testKey, 1 * 60 * 1000, function(err, initialLock) {
      expect(err).to.not.be.ok;
      expect(initialLock.success).to.equal(true);

      const start = Date.now();
      testLock.waitAcquireLock(testKey, 1 * 60 * 1000, 1500, function(err, newLock) {
        expect(err).to.not.be.ok;
        expect(newLock.success).to.equal(false);
        expect(Date.now() - start).to.be.above(1450);
        testLock.releaseLock(initialLock, function(err) {
          expect(err).to.not.be.ok;
          done();
        });
      });
    });
  });

  it('Should be able to be constructed from a pre-existing connection', function(done) {
    const client = redis.createClient('redis://localhost:6399');
    let testExistingLock = new Lock({
      redis: client,
      namespace: 'testExistingLock'
    });

    testExistingLock.acquireLock(testKey, 1 * 60 * 1000, function(err, initialLock) {
      expect(err).to.not.be.ok;
      expect(initialLock.success).to.equal(true);

      const start = Date.now();
      testExistingLock.waitAcquireLock(testKey, 60 * 100, 3000, function(err, newLock) {
        expect(err).to.not.be.ok;
        expect(newLock.success).to.equal(true);
        expect(Date.now() - start).to.be.above(1450);

        testExistingLock.releaseLock(newLock, function(err) {
          expect(err).to.not.be.ok;
          done();
        });
      });

      setTimeout(function() {
        testExistingLock.releaseLock(initialLock, function(err) {
          expect(err).to.not.be.ok;
        });
      }, 1500);
    });
  });

  it ('should throw if redis is not provided', function() {
    expect(function() {
      new Lock({
        namespace: 'testExistingLock'
      });
    }).to.throw(/must provide a redis/i);
  });
});
