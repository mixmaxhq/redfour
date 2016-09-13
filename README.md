## redfour

A small library that implements a binary semaphore using Redis.

## Install

`npm install redfour`

## Usage example

```
var Lock = require('redfour');

var testLock = new Lock({
	redis: 'redis://localhost:6381',
	namespace: 'mylock'
});
var id = Math.random();
var firstlock;

// First, acquire the lock.
testLock.acquireLock(id, 'arbitrarystate', 60 * 1000 /* 60 sec timeout */ , function(err, res) {
  if (err) console.log('error acquiring', err);
	else firstlock = res;
});

// Another server might be waiting for the lock like this.
testLock.waitAcquireLock(id, '', 10 * 1000, 10 * 1000, function(err, lock) {
  if (err) console.log('error wait acquiring', err);
	else console.log('lock acquired! ', lock);
});

// When the original lock is released, `waitAcquireLock` is fired on the other server.
setTimeout(() => {
	testLock.releaseLock(id, firstlock.index, (err) => {
		if (err) console.log('error releasing', err);
		else console.log('got lock!');
	});
}, 3 * 1000);
```

Additionally, optional `state` parameter can be used to store arbitrary information when the lock is created. It's passed to the callback of `releaseLock`.

## Etymology

Shortened (and easier to pronouce) version of "Redis Semaphore"