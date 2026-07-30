import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import type { Env } from "../../config/env.js";
import { PrismaService } from "../../database/prisma.service.js";
export interface Principal {
    sub: string;
    organizationId: string | null;
    roles: string[];
    permissions: string[];
}
export declare const CurrentUser: (...dataOrPipes: unknown[]) => ParameterDecorator;
declare const JwtAuthGuard_base: import("@nestjs/passport").Type<import("@nestjs/passport").IAuthGuard>;
export declare class JwtAuthGuard extends JwtAuthGuard_base {
}
export declare class AuthService {
    private readonly prisma;
    private readonly jwt;
    private readonly config;
    constructor(prisma: PrismaService, jwt: JwtService, config: ConfigService<Env, true>);
    login(email: string, password: string): Promise<{
        accessToken: string;
        refreshToken: string;
    }>;
    refresh(token: string): Promise<{
        accessToken: string;
    }>;
    logoutAll(userId: string): Promise<void>;
}
export declare class AuthModule {
}
export {};
