import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  type Provider,
} from "@nestjs/common";
import { APP_GUARD, Reflector } from "@nestjs/core";
import {
  getOptionsToken,
  getStorageToken,
  Throttle,
  ThrottlerGuard,
  type ThrottlerModuleOptions,
  type ThrottlerStorage,
} from "@nestjs/throttler";

export const globalRateLimit = { ttl: 60_000, limit: 120 } as const;

@Injectable()
class GlobalThrottlerGuard extends ThrottlerGuard {
  constructor(
    @Inject(getOptionsToken()) options: ThrottlerModuleOptions,
    @Inject(getStorageToken()) storage: ThrottlerStorage,
    @Inject(Reflector) reflector: Reflector,
  ) {
    super(options, storage, reflector);
  }

  protected override throwThrottlingException(): Promise<void> {
    return Promise.reject(
      new HttpException("Too Many Requests", HttpStatus.TOO_MANY_REQUESTS),
    );
  }
}

const globalThrottlerGuardProvider: Provider = {
  provide: APP_GUARD,
  useExisting: GlobalThrottlerGuard,
};

export const rateLimitingProviders: Provider[] = [
  Reflector,
  GlobalThrottlerGuard,
  globalThrottlerGuardProvider,
];

const loginRateLimit = { ttl: 60_000, limit: 10 } as const;
const verificationRateLimit = { ttl: 5 * 60_000, limit: 5 } as const;
const recoveryRateLimit = { ttl: 15 * 60_000, limit: 5 } as const;

export const ThrottleLogin = () => Throttle({ default: loginRateLimit });

export const ThrottleVerification = () =>
  Throttle({ default: verificationRateLimit });

export const ThrottleRecovery = () => Throttle({ default: recoveryRateLimit });
