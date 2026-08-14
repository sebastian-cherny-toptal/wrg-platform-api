import {
  Controller,
  createParamDecorator,
  ExecutionContext,
  Inject,
  Injectable,
  Module,
  Optional,
  Post,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtModule, JwtService } from "@nestjs/jwt";
import { AuthGuard, PassportModule, PassportStrategy } from "@nestjs/passport";
import { ApiBearerAuth, ApiProperty, ApiTags } from "@nestjs/swagger";
import { hash, verify } from "argon2";
import { IsEmail, IsString, MinLength } from "class-validator";
import { ExtractJwt, Strategy } from "passport-jwt";
import { BodyDto } from "../../common/http/body-dto.js";
import type { Env } from "../../config/env.js";
import { PrismaService } from "../../database/prisma.service.js";

export interface Principal {
  sub: string;
  organizationId: string | null;
  roles: string[];
  permissions: string[];
  localAuthBypass?: boolean;
  impersonation?: {
    grantId: string;
    actorUserId: string;
    actorDisplayName: string;
    organizationId: string;
    programId: string;
    startedAt: string;
  };
}

class LoginDto {
  @ApiProperty({ type: String, example: "admin@example.test" })
  @IsEmail()
  email!: string;

  @ApiProperty({ type: String, example: "ChangeMe123!", minLength: 8 })
  @IsString()
  @MinLength(8)
  password!: string;
}

class RefreshDto {
  @ApiProperty({ type: String })
  @IsString()
  refreshToken!: string;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Principal =>
    context.switchToHttp().getRequest<{ user: Principal }>().user,
);

@Injectable()
export class JwtAuthGuard extends AuthGuard("jwt") {
  constructor(
    @Optional()
    @Inject(ConfigService)
    private readonly config?: ConfigService<Env, true>,
  ) {
    super();
  }

  override canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<{
      user?: Principal;
      headers?: { authorization?: string | string[] };
      params?: Record<string, string | undefined>;
      query?: Record<string, string | undefined>;
    }>();
    const authorization = request.headers?.authorization;
    const hasBearerToken =
      typeof authorization === "string" &&
      /^Bearer\s+\S+/iu.test(authorization);
    if (
      this.config?.get("BYPASS_LOGIN_AUTH", { infer: true }) &&
      !hasBearerToken
    ) {
      request.user ??= {
        sub: "bypass-login-auth",
        organizationId:
          request.params?.organizationId ??
          request.query?.organizationId ??
          null,
        roles: ["admin"],
        permissions: ["ops.manage"],
        localAuthBypass: true,
      };
      return true;
    }
    return super.canActivate(context);
  }
}

@Injectable()
class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    @Inject(ConfigService)
    private readonly config: ConfigService<Env, true>,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {
    const secret = config.get("JWT_ACCESS_SECRET", { infer: true });
    if (!secret) {
      throw new Error("JWT_ACCESS_SECRET is required");
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: secret,
    });
  }

  async validate(payload: Principal): Promise<Principal> {
    const principal = this.config.get("BYPASS_LOGIN_AUTH", { infer: true })
      ? { ...payload, localAuthBypass: true }
      : payload;
    if (principal.impersonation) {
      const activeGrant = await this.prisma.impersonationGrant.findFirst({
        where: {
          id: principal.impersonation.grantId,
          targetUserId: principal.sub,
          consumedAt: { not: null },
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        select: { id: true },
      });
      if (!activeGrant) {
        throw new UnauthorizedException("Dashboard preview has ended");
      }
    }
    return principal;
  }
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(ConfigService) private readonly config: ConfigService<Env, true>,
  ) {}

  async login(
    email: string,
    password: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
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
    if (
      user.status !== "ACTIVE" ||
      !(await verify(user.passwordHash, password))
    ) {
      throw new UnauthorizedException("Invalid credentials");
    }

    const principal: Principal = {
      sub: user.id,
      organizationId: user.organizationId,
      roles: user.roles.map(({ role }) => role.key),
      permissions: [
        ...new Set(
          user.roles.flatMap(({ role }) =>
            role.permissions.map(({ permission }) => permission.key),
          ),
        ),
      ],
    };
    return this.issueTokens(principal);
  }

  async issueTokens(
    principal: Principal,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const accessToken = await this.issueAccessToken(principal);
    const sessionId = crypto.randomUUID();
    const refreshToken = await this.jwt.signAsync(
      { sub: principal.sub, sid: sessionId },
      {
        secret: this.config.get("JWT_REFRESH_SECRET", { infer: true }),
        expiresIn: `${this.config.get("JWT_REFRESH_TTL_DAYS", { infer: true })}d`,
        jwtid: sessionId,
      },
    );
    await this.prisma.session.create({
      data: {
        id: sessionId,
        userId: principal.sub,
        refreshTokenHash: await hash(refreshToken),
        expiresAt: new Date(
          Date.now() +
            this.config.get("JWT_REFRESH_TTL_DAYS", { infer: true }) *
              86_400_000,
        ),
      },
    });
    return { accessToken, refreshToken };
  }

  issueAccessToken(
    principal: Principal,
    expiresIn: string = this.config.get("JWT_ACCESS_TTL", { infer: true }),
  ): Promise<string> {
    return this.jwt.signAsync(principal, {
      secret: this.config.get("JWT_ACCESS_SECRET", { infer: true }),
      expiresIn: expiresIn as never,
    });
  }

  async principalForUserId(userId: string): Promise<Principal> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
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
    if (user?.status !== "ACTIVE") {
      throw new UnauthorizedException("User is not available");
    }
    return {
      sub: user.id,
      organizationId: user.organizationId,
      roles: user.roles.map(({ role }) => role.key),
      permissions: [
        ...new Set(
          user.roles.flatMap(({ role }) =>
            role.permissions.map(({ permission }) => permission.key),
          ),
        ),
      ],
    };
  }

  async rotateRefreshToken(token: string): Promise<{
    accessToken: string;
    refreshToken: string;
    principal: Principal;
  }> {
    let payload: { sub: string; sid: string };
    try {
      payload = await this.jwt.verifyAsync<{ sub: string; sid: string }>(
        token,
        {
          secret: this.config.get("JWT_REFRESH_SECRET", { infer: true }),
        },
      );
    } catch {
      throw new UnauthorizedException("Invalid refresh token");
    }
    const session = await this.prisma.session.findUnique({
      where: { id: payload.sid },
      include: {
        user: {
          include: {
            roles: {
              include: {
                role: {
                  include: {
                    permissions: { include: { permission: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt < new Date() ||
      session.user.status !== "ACTIVE" ||
      session.userId !== payload.sub ||
      !(await verify(session.refreshTokenHash, token))
    ) {
      throw new UnauthorizedException("Invalid refresh token");
    }
    const principal: Principal = {
      sub: session.userId,
      organizationId: session.user.organizationId,
      roles: session.user.roles.map(({ role }) => role.key),
      permissions: [
        ...new Set(
          session.user.roles.flatMap(({ role }) =>
            role.permissions.map(({ permission }) => permission.key),
          ),
        ),
      ],
    };
    const rotated = await this.issueTokens(principal);
    await this.prisma.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });
    return { ...rotated, principal };
  }

  async refresh(token: string): Promise<{ accessToken: string }> {
    const { accessToken } = await this.rotateRefreshToken(token);
    return { accessToken };
  }

  async logoutAll(userId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}

@ApiTags("auth")
@Controller("auth")
class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Post("login")
  login(@BodyDto(LoginDto) body: LoginDto) {
    return this.auth.login(body.email, body.password);
  }

  @Post("refresh")
  refresh(@BodyDto(RefreshDto) body: RefreshDto) {
    return this.auth.refresh(body.refreshToken);
  }

  @Post("logout")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  async logout(@CurrentUser() user: Principal): Promise<{ ok: true }> {
    await this.auth.logoutAll(user.sub);
    return { ok: true };
  }
}

@Module({
  imports: [PassportModule, JwtModule.register({})],
  providers: [AuthService, JwtStrategy, JwtAuthGuard],
  controllers: [AuthController],
  exports: [AuthService, JwtAuthGuard],
})
export class AuthModule {}
