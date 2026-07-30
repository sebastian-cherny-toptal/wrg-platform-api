import { CanActivate, ExecutionContext } from "@nestjs/common";
export declare class TenantGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean;
}
export declare class TenantsModule {
}
