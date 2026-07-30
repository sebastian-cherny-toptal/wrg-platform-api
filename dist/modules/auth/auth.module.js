var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { Body, Controller, createParamDecorator, Inject, Injectable, Module, Post, UnauthorizedException, UseGuards, } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtModule, JwtService } from "@nestjs/jwt";
import { AuthGuard, PassportModule, PassportStrategy } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { hash, verify } from "argon2";
import { IsEmail, IsString, MinLength } from "class-validator";
import { ExtractJwt, Strategy } from "passport-jwt";
import { PrismaService } from "../../database/prisma.service.js";
class LoginDto {
    email;
    password;
}
__decorate([
    IsEmail(),
    __metadata("design:type", String)
], LoginDto.prototype, "email", void 0);
__decorate([
    IsString(),
    MinLength(8),
    __metadata("design:type", String)
], LoginDto.prototype, "password", void 0);
class RefreshDto {
    refreshToken;
}
__decorate([
    IsString(),
    __metadata("design:type", String)
], RefreshDto.prototype, "refreshToken", void 0);
export const CurrentUser = createParamDecorator((_data, context) => context.switchToHttp().getRequest().user);
let JwtAuthGuard = class JwtAuthGuard extends AuthGuard("jwt") {
};
JwtAuthGuard = __decorate([
    Injectable()
], JwtAuthGuard);
export { JwtAuthGuard };
let JwtStrategy = class JwtStrategy extends PassportStrategy(Strategy) {
    constructor(config) {
        const secret = config.get("JWT_ACCESS_SECRET", { infer: true });
        if (!secret) {
            throw new Error("JWT_ACCESS_SECRET is required");
        }
        super({
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            secretOrKey: secret,
        });
    }
    validate(payload) {
        return payload;
    }
};
JwtStrategy = __decorate([
    Injectable(),
    __param(0, Inject(ConfigService)),
    __metadata("design:paramtypes", [ConfigService])
], JwtStrategy);
let AuthService = class AuthService {
    prisma;
    jwt;
    config;
    constructor(prisma, jwt, config) {
        this.prisma = prisma;
        this.jwt = jwt;
        this.config = config;
    }
    async login(email, password) {
        const user = await this.prisma.user.findUnique({
            where: { email: email.toLowerCase() },
            include: {
                roles: {
                    include: {
                        role: {
                            include: { permissions: { include: { permission: true } } },
                        },
                    },
                },
            },
        });
        if (!user) {
            throw new UnauthorizedException("Invalid credentials");
        }
        if (user.status !== "ACTIVE" ||
            !(await verify(user.passwordHash, password))) {
            throw new UnauthorizedException("Invalid credentials");
        }
        const principal = {
            sub: user.id,
            organizationId: user.organizationId,
            roles: user.roles.map(({ role }) => role.key),
            permissions: [
                ...new Set(user.roles.flatMap(({ role }) => role.permissions.map(({ permission }) => permission.key))),
            ],
        };
        const accessToken = await this.jwt.signAsync(principal, {
            secret: this.config.get("JWT_ACCESS_SECRET", { infer: true }),
            expiresIn: this.config.get("JWT_ACCESS_TTL", { infer: true }),
        });
        const sessionId = crypto.randomUUID();
        const refreshToken = await this.jwt.signAsync({ sub: user.id, sid: sessionId }, {
            secret: this.config.get("JWT_REFRESH_SECRET", { infer: true }),
            expiresIn: `${this.config.get("JWT_REFRESH_TTL_DAYS", { infer: true })}d`,
            jwtid: sessionId,
        });
        await this.prisma.session.create({
            data: {
                id: sessionId,
                userId: user.id,
                refreshTokenHash: await hash(refreshToken),
                expiresAt: new Date(Date.now() +
                    this.config.get("JWT_REFRESH_TTL_DAYS", { infer: true }) *
                        86_400_000),
            },
        });
        return { accessToken, refreshToken };
    }
    async refresh(token) {
        const payload = await this.jwt.verifyAsync(token, {
            secret: this.config.get("JWT_REFRESH_SECRET", { infer: true }),
        });
        const session = await this.prisma.session.findUnique({
            where: { id: payload.sid },
            include: { user: true },
        });
        if (!session ||
            session.revokedAt ||
            session.expiresAt < new Date() ||
            !(await verify(session.refreshTokenHash, token))) {
            throw new UnauthorizedException("Invalid refresh token");
        }
        const accessToken = await this.jwt.signAsync({
            sub: session.userId,
            organizationId: session.user.organizationId,
            roles: [],
            permissions: [],
        }, {
            secret: this.config.get("JWT_ACCESS_SECRET", { infer: true }),
            expiresIn: this.config.get("JWT_ACCESS_TTL", { infer: true }),
        });
        return { accessToken };
    }
    async logoutAll(userId) {
        await this.prisma.session.updateMany({
            where: { userId, revokedAt: null },
            data: { revokedAt: new Date() },
        });
    }
};
AuthService = __decorate([
    Injectable(),
    __param(0, Inject(PrismaService)),
    __param(1, Inject(JwtService)),
    __param(2, Inject(ConfigService)),
    __metadata("design:paramtypes", [PrismaService,
        JwtService,
        ConfigService])
], AuthService);
export { AuthService };
let AuthController = class AuthController {
    auth;
    constructor(auth) {
        this.auth = auth;
    }
    login(body) {
        return this.auth.login(body.email, body.password);
    }
    refresh(body) {
        return this.auth.refresh(body.refreshToken);
    }
    async logout(user) {
        await this.auth.logoutAll(user.sub);
        return { ok: true };
    }
};
__decorate([
    Post("login"),
    __param(0, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [LoginDto]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "login", null);
__decorate([
    Post("refresh"),
    __param(0, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [RefreshDto]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "refresh", null);
__decorate([
    Post("logout"),
    ApiBearerAuth(),
    UseGuards(JwtAuthGuard),
    __param(0, CurrentUser()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "logout", null);
AuthController = __decorate([
    ApiTags("auth"),
    Controller("auth"),
    __param(0, Inject(AuthService)),
    __metadata("design:paramtypes", [AuthService])
], AuthController);
let AuthModule = class AuthModule {
};
AuthModule = __decorate([
    Module({
        imports: [PassportModule, JwtModule.register({})],
        providers: [AuthService, JwtStrategy, JwtAuthGuard],
        controllers: [AuthController],
        exports: [AuthService, JwtAuthGuard],
    })
], AuthModule);
export { AuthModule };
//# sourceMappingURL=auth.module.js.map