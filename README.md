## redfour

A small library that implements a binary semaphore using Redis.

## Install

`npm install redfour`

## Usage example

```js
var Lock = require('redfour');

var testLock = new Lock({
  redis: 'redis://localhost:6381',
  namespace: 'mylock'
});
var id = Math.random();
var firstlock;

// First, acquire the lock.
testLock.acquireLock(id, 60 * 1000 /* Lock expires after 60sec if not released */ , function(err, res) {
  if (err) {
    console.log('error acquiring', err);
  } else {
    console.log('lock acquired initially');
    firstlock = res;
  }
});

// Another server might be waiting for the lock like this.
testLock.waitAcquireLock(id, 60 * 1000 /* Lock expires after 60sec */ , 10 * 1000 /* Wait for lock for up to 10sec */ , function(err, lock) {
  if (err) {
    console.log('error wait acquiring', err);
  } else {
    console.log('lock acquired after wait!', lock);
  }
});

// When the original lock is released, `waitAcquireLock` is fired on the other server.
setTimeout(() => {
  testLock.releaseLock(id, firstlock.index, (err) => {
    if (err) {
      console.log('error releasing', err);
    } else {
      console.log('released lock');
    }
  });
}, 3 * 1000);
```

## Contributing

We welcome pull requests! Please lint your code.

## Release History

* 1.0.0 Initial release.

## Etymology

Shortened (and easier to pronouce) version of "Redis Semaphore"