## Release History

* 2.2.1 Added `noop` handling of `error` events for internal redis subscriber connection

* 2.2.0 Add renew lock functionality

* 2.1.0 Add lock immediate-acquisition indicator

* 2.0.0 Promisify

* 1.0.5 Still allow yarn for install

* 1.0.4 deyarn

* 1.0.3 Fix reliance on instanceof

* 1.0.2 Don't use `instanceof` to determine if the `redis` constructor option is of
        type `redis.RedisClient`.

* 1.0.1 Fix issue where you could only pass in a Redis connection URI.

* 1.0.0 Initial release.
