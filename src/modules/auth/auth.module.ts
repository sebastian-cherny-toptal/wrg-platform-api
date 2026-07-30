import {
  Controller,
  createParamDecorator,
  ExecutionContext,
  Inject,
  Injectable,
  Module,
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
export class JwtAuthGuard extends AuthGuard("jwt") {}

@Injectable()
class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(@Inject(ConfigService) config: ConfigService<Env, true>) {
    const secret = config.get("JWT_ACCESS_SECRET", { infer: true });
    if (!secret) {
      throw new Error("JWT_ACCESS_SECRET is required");
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: secret,
    });
  }

  validate(payload: Principal): Principal {
    return payload;
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
    const accessToken = await this.jwt.signAsync(principal, {
      secret: this.config.get("JWT_ACCESS_SECRET", { infer: true }),
      expiresIn: this.config.get("JWT_ACCESS_TTL", { infer: true }) as never,
    });
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
