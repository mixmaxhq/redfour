'use strict';

var Lock = require('../src');
var expect = require('chai').expect;
var RedisServer = require('redis-server');
var redisServerInstance = new RedisServer(6399);

// We need an unique key just in case a previous test run ended with an exception
// and testing keys were not immediatelly deleted (these expire automatically after a while)
var testKey = 'TEST:' + Date.now();

describe('lock', function() {
  var testLock;

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

        testLock.releaseLock(testKey, -10, (err, invalidRelease) => {
          expect(err).not.to.be.ok;
          expect(invalidRelease.success).to.equal(false);

          testLock.releaseLock(testKey, lock.index, (err, release) => {
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

      var start = Date.now();
      testLock.waitAcquireLock(testKey, 60 * 100, 3000, function(err, newLock) {
        expect(err).to.not.be.ok;
        expect(newLock.success).to.equal(true);
        expect(Date.now() - start).to.be.above(1450);

        testLock.releaseLock(testKey, newLock.index, function(err) {
          expect(err).to.not.be.ok;
          done();
        });
      });

      setTimeout(function() {
        testLock.releaseLock(testKey, initialLock.index, function(err) {
          expect(err).to.not.be.ok;
        });
      }, 1500);
    });
  });

  it('Should wait and not acquire a lock', function(done) {
    testLock.acquireLock(testKey, 1 * 60 * 1000, function(err, initialLock) {
      expect(err).to.not.be.ok;
      expect(initialLock.success).to.equal(true);

      var start = Date.now();
      testLock.waitAcquireLock(testKey, 1 * 60 * 1000, 1500, function(err, newLock) {
        expect(err).to.not.be.ok;
        expect(newLock.success).to.equal(false);
        expect(Date.now() - start).to.be.above(1450);
        testLock.releaseLock(testKey, initialLock.index, function(err) {
          expect(err).to.not.be.ok;
          done();
        });
      });
    });
  });
});