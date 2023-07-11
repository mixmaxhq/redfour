declare module "redfour" {

  interface LockOptions {
    redis: any // the parameters of createClient from redis are untyped?
    namespace?: string
  }

  interface LockObject {
    id: string
    success: boolean
    index: string
    result: any
  }

  interface AcquiredLockObject {
    id: string  
    success: boolean
    index: string
    ttl: number
  }

  class Lock {
    constructor(options: LockOptions);
    acquireLock(id: string, ttl: number): Promise<AcquiredLockObject>
    releaseLock(lock: Lock): Promise<LockObject>
    waitAcquireLock(id: string, lockTtl: number, waitTtl: number): Promise<AcquiredLockObject & { immediate: boolean }>
    renewLock(lock: {id: string, index: string}, ttl: number): Promise<LockObject>
  }

  export = Lock
}