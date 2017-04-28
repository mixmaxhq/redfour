'use strict';

var Lock = require('../src');
var expect = require('chai').expect;
var RedisServer = require('redis-server');
var redisServerInstance = new RedisServer(6399);

// We need an unique key just in case a previous test run ended with an exception
// and testing keys were not immediately deleted (these expire automatically after a while)
var testKey = 'TEST:' + Date.now();
var testMax = 2;

describe('lock', function() {
  var testLock;

  beforeEach((done) => {
    redisServerInstance.open(function(err) {
      if (err) throw err;

      testLock = new Lock({
        redis: 'redis://localhost:6399',
        namespace: 'testLock',
        number: testMax
      });

      done();
    });
  });

  // expect(false).to.be.equal(true);

  it('should only be able to acquire up to testMax, should only release with valid index', function(done) {
    testLock.acquireLock(testKey, 60 * 100, (err, lock) => {

      expect(err).not.to.be.ok;
      expect(lock.success).to.equal(true);
      expect(lock.id).to.equal(testKey);
      expect(lock.index).to.be.above(0);
      // expect(false).to.be.equal(true);

      testLock.acquireLock(testKey, 60 * 100, (err, lock2) => {
        expect(err).not.to.be.ok;
        expect(lock2.success).to.equal(true);
        expect(lock2.id).to.equal(testKey);
        expect(lock2.index).to.be.above(0);

        testLock.acquireLock(testKey, 60 * 100, (err, invalidLock) => {
          expect(err).not.to.be.ok;
          expect(invalidLock.success).to.equal(false);

          testLock.releaseLock(Object.assign({}, lock, {
            index: -10
          }), (err, invalidRelease) => {
            expect(err).not.to.be.ok;
            expect(invalidRelease.success).to.equal(false);

            testLock.releaseLock(lock, (err, release) => {
              expect(err).not.to.be.ok;
              expect(release.success).to.equal(true);

              testLock.releaseLock(lock2, (err, release) => {
                expect(err).not.to.be.ok;
                expect(release.success).to.equal(true);

                testLock.releaseLock(lock, (err, release) => {
                  
                  expect(err).not.to.be.ok;
                  expect(release.success).to.equal(true);
                  expect(release.result).to.equal("expired");
                  done();
                });
              });
            });
          });
          // done();
        });
      });
    });
  });


  it('should be able to acquire lock after ttl expires, but only one', function(done) {
    testLock.acquireLock(testKey, 500, function(err, initialLock) {
      expect(err).to.not.be.ok;
      expect(initialLock.success).to.equal(true);

      testLock.acquireLock(testKey, 1 * 60 * 1000, function(err, nextLock) {
        expect(err).to.not.be.ok;
        expect(nextLock.success).to.equal(true);

        var start = Date.now();
        testLock.waitAcquireLock(testKey, 60 * 100, 1500, function(err, newLock) {
          expect(err).to.not.be.ok;
          expect(newLock.success).to.equal(true);
          expect(Date.now() - start).to.be.above(500);

          testLock.acquireLock(testKey, 1 * 60 * 1000, function(err, invalidLock) {
            expect(err).to.not.be.ok;
            expect(invalidLock.success).to.equal(false);

            testLock.releaseLock(newLock, function(err) {
              expect(err).to.not.be.ok;
              testLock.releaseLock(nextLock, function(err) {
                expect(err).to.not.be.ok;
                done();
              });
            });
          });
        });
      });     
    });
  });


  it('should wait and acquire a lock', function(done) {
    testLock.acquireLock(testKey, 1 * 60 * 1000, function(err, initialLock) {
      expect(err).to.not.be.ok;
      expect(initialLock.success).to.equal(true);

      testLock.acquireLock(testKey, 1 * 60 * 1000, function(err, nextLock) {
        expect(err).to.not.be.ok;
        expect(nextLock.success).to.equal(true);
      });

      var start = Date.now();
      testLock.waitAcquireLock(testKey, 60 * 100, 3000, function(err, newLock) {
        expect(err).to.not.be.ok;
        expect(newLock.success).to.equal(true);
        expect(Date.now() - start).to.be.above(1450);

        testLock.acquireLock(testKey, 1 * 60 * 1000, function(err, invalidLock) {
          expect(err).to.not.be.ok;
          expect(invalidLock.success).to.equal(false);

          testLock.releaseLock(newLock, function(err) {
            expect(err).to.not.be.ok;
            done();
          });
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
});
