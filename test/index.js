/* eslint-disable indent */
'use strict';

var Lock = require('../src');
var expect = require('chai').expect;
var redis = require('redis');
var RedisServer = require('redis-server');
var redisServerInstance = new RedisServer(6399);

// We need an unique key just in case a previous test run ended with an exception
// and testing keys were not immediately deleted (these expire automatically after a while)
var testKey = 'TEST:' + Date.now();

describe('lock', function() {
  var testLock;

  beforeEach((done) => {
    // redisServerInstance.open(function(err) {
    //   console.log("handling err");
    //   if (err) throw err;

      testLock = new Lock({
        redis: 'redis://localhost:6399',
        namespace: 'testLock'
      });

      done();
    // });
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

      var start = Date.now();
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

      var start = Date.now();
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

      var start = Date.now();
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

  it.only('should support specifiying the number of resources that may be used simultaneously', function(done){
      const semaphoreTestLock = new Lock({
          redis: 'redis://localhost:6399',
          namespace: 'testLock',
          resourceCount: 2,
      });
      semaphoreTestLock.acquireLock(testKey, 60 * 1000 /* Lock expires after 60sec if not released */ , function(err, lock) {
          // Up to 5 resources are allowed inside the code block at time
          // expect(err).to.be.ok;
          console.log(err);
          expect(err).to.be.null;
          expect(lock.success).to.be.true;
          semaphoreTestLock.acquireLock(testKey, 60 * 1000 /* Lock expires after 60sec if not released */ , function(err, lock2) {
              // Up to 5 resources are allowed inside the code block at time
              console.log(err);
              expect(err).to.be.null;
              expect(lock2.success).to.be.true;

              semaphoreTestLock.acquireLock(testKey, 60 * 1000 /* Lock expires after 60sec if not released */ , function(err, lock3) {
                  // Up to 5 resources are allowed inside the code block at time
                  expect(err).to.be.null;
                  expect(lock3.success).to.be.false;
                  done();
              });
          });
      });
  });

});
