import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Module,
  NotFoundException,
  OnModuleDestroy,
  Post,
  Put,
  Param,
  ServiceUnavailableException,
  UnauthorizedException,
  UseGuards,
  VERSION_NEUTRAL,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from "@nestjs/swagger";
import { Prisma } from "@prisma/client";
import { hash, verify } from "argon2";
import { Redis } from "ioredis";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";
import { createRequire } from "node:module";
import {
  IsEmail,
  IsOptional,
  IsString,
  Length,
  MinLength,
} from "class-validator";
import { BodyDto } from "../../common/http/body-dto.js";
import type { Env } from "../../config/env.js";
import { PrismaService } from "../../database/prisma.service.js";
import {
  AuthModule,
  AuthService,
  CurrentUser,
  JwtAuthGuard,
  type Principal,
} from "../auth/auth.module.js";
import {
  AdminRoleGuard,
  UserInvitationMailer,
  UsersModule,
} from "./users.module.js";

interface TotpSecret {
  ascii: string;
  hex: string;
  base32: string;
  otpauth_url?: string;
}

interface Speakeasy {
  generateSecret(options: { name: string; length?: number }): TotpSecret;
  totp: {
    verify(options: {
      secret: string;
      encoding: "base32";
      token: string;
      window?: number;
    }): boolean;
  };
}

const require = createRequire(import.meta.url);
const speakeasy = require("speakeasy") as Speakeasy;
const forgotPasswordTtlSeconds = 15 * 60;
const adminResetTtlSeconds = 60 * 60;
const temporaryPasswordTtlSeconds = 24 * 60 * 60;

type AccountSecretNamespace =
  "forgot-password" | "admin-reset" | "temporary-password";

class ManagementLoginStartDto {
  @ApiProperty({ type: String })
  @IsEmail()
  email!: string;

  @ApiProperty({ type: String, minLength: 8 })
  @IsString()
  @MinLength(8)
  password!: string;
}

class ManagementLoginCompleteDto {
  @ApiProperty({ type: String })
  @IsString()
  @MinLength(1)
  userId!: string;

  @ApiPropertyOptional({ type: String, minLength: 6, maxLength: 6 })
  @IsOptional()
  @IsString()
  @Length(6, 6)
  enteredOtp?: string;
}

class ValidateTwoFactorDto {
  @ApiProperty({ type: String, minLength: 6, maxLength: 6 })
  @IsString()
  @Length(6, 6)
  token!: string;
}

class AdminResetPasswordDto {
  @ApiProperty({
    type: String,
    description: "A native user ID or a migrated legacy user ID.",
  })
  @IsString()
  @MinLength(1)
  userId!: string;
}

class ResetPasswordDto {
  @ApiProperty({ type: String })
  @IsString()
  @MinLength(1)
  key!: string;

  @ApiProperty({ type: String, minLength: 8 })
  @IsString()
  @MinLength(8)
  password!: string;
}

class CompleteForgotPasswordDto extends ResetPasswordDto {
  @ApiProperty({ type: String, minLength: 6, maxLength: 6 })
  @IsString()
  @Length(6, 6)
  otp!: string;
}

class ForgotPasswordDto {
  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  @MinLength(1)
  username?: string;
}

class ForgotUsernameDto {
  @ApiProperty({ type: String })
  @IsEmail()
  email!: string;
}

class CompatibilityRefreshDto {
  @ApiProperty({ type: String })
  @IsString()
  @MinLength(1)
  refreshToken!: string;
}

class ChangeTemporaryPasswordDto {
  @ApiProperty({ type: String, minLength: 8 })
  @IsString()
  @MinLength(8)
  newPassword!: string;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    value,
  );
}

function jsonObject(value: Prisma.JsonValue): Prisma.JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function secretFromMetadata(metadata: Prisma.JsonValue): string | null {
  const secret = jsonObject(metadata).mfaSecret;
  if (secret === null || typeof secret !== "object" || Array.isArray(secret)) {
    return null;
  }
  return typeof secret.base32 === "string" ? secret.base32 : null;
}

function secureCodeEquals(expected: string, supplied: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  return (
    expectedBuffer.length === suppliedBuffer.length &&
    timingSafeEqual(expectedBuffer, suppliedBuffer)
  );
}

@Injectable()
export class AccountRecoveryStore implements OnModuleDestroy {
  private readonly redis: Redis;
  private connection: Promise<void> | undefined;

  constructor(@Inject(ConfigService) config: ConfigService<Env, true>) {
    this.redis = new Redis(config.get("REDIS_URL", { infer: true }), {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
  }

  private async client(): Promise<Redis> {
    if (this.redis.status === "wait") {
      this.connection ??= this.redis.connect();
      await this.connection;
    }
    return this.redis;
  }

  async set(
    namespace: AccountSecretNamespace,
    key: string,
    value: Record<string, string>,
    ttlSeconds: number,
  ): Promise<void> {
    const redis = await this.client();
    await redis.set(
      this.storageKey(namespace, key),
      JSON.stringify(value),
      "EX",
      ttlSeconds,
    );
  }

  async get(
    namespace: AccountSecretNamespace,
    key: string,
  ): Promise<Record<string, string> | null> {
    const redis = await this.client();
    const stored = await redis.get(this.storageKey(namespace, key));
    if (!stored) return null;
    try {
      const value: unknown = JSON.parse(stored);
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return null;
      }
      return Object.fromEntries(
        Object.entries(value).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      );
    } catch {
      return null;
    }
  }

  async delete(namespace: AccountSecretNamespace, key: string): Promise<void> {
    const redis = await this.client();
    await redis.del(this.storageKey(namespace, key));
  }

  onModuleDestroy(): void {
    this.redis.disconnect();
  }

  private storageKey(namespace: AccountSecretNamespace, key: string): string {
    const digest = createHash("sha256").update(key).digest("hex");
    return `account-access:${namespace}:${digest}`;
  }
}

@Injectable()
export class AccountAccessService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AccountRecoveryStore)
    private readonly recovery: AccountRecoveryStore,
    @Inject(UserInvitationMailer)
    private readonly mailer: UserInvitationMailer,
    @Inject(ConfigService) private readonly config: ConfigService<Env, true>,
  ) {}

  async startManagementLogin(dto: ManagementLoginStartDto): Promise<{
    success: true;
    message: "Login Successfully";
    data: { userId: string; "2faVerified": boolean };
  }> {
    const user = await this.managementUserByEmail(dto.email);
    let passwordMatches = false;
    try {
      passwordMatches = await verify(user.passwordHash, dto.password);
    } catch {
      passwordMatches = false;
    }
    if (!passwordMatches) {
      throw new UnauthorizedException("Invalid credentials");
    }
    return {
      success: true,
      message: "Login Successfully",
      data: {
        userId: user.legacyId ?? user.id,
        "2faVerified": user.mfaEnabled,
      },
    };
  }

  async completeManagementLogin(dto: ManagementLoginCompleteDto): Promise<{
    success: true;
    message: "Login Successful";
    data: {
      user: Record<string, unknown>;
      accessToken: string;
      refreshToken: string;
    };
  }> {
    const user = await this.managementUserByReference(dto.userId);
    if (user.mfaEnabled) {
      const secret = secretFromMetadata(user.metadata);
      if (
        !secret ||
        !dto.enteredOtp ||
        !speakeasy.totp.verify({
          secret,
          encoding: "base32",
          token: dto.enteredOtp,
          window: 1,
        })
      ) {
        throw new UnauthorizedException("Invalid OTP");
      }
    }
    const principal = this.principal(user);
    const tokens = await this.auth.issueTokens(principal);
    return {
      success: true,
      message: "Login Successful",
      data: {
        user: this.compatibilityUser(user),
        ...tokens,
      },
    };
  }

  async registerTwoFactor(principal: Principal): Promise<TotpSecret> {
    const user = await this.prisma.user.findUnique({
      where: { id: principal.sub },
      select: { id: true, email: true, metadata: true },
    });
    if (!user) throw new NotFoundException("User not found");
    const secret = speakeasy.generateSecret({
      name: `WRG Admin: ${user.email}`,
      length: 20,
    });
    const metadata: Prisma.InputJsonObject = {
      ...jsonObject(user.metadata),
      mfaSecret: {
        ascii: secret.ascii,
        hex: secret.hex,
        base32: secret.base32,
        ...(secret.otpauth_url ? { otpauth_url: secret.otpauth_url } : {}),
      },
    };
    await this.prisma.user.update({
      where: { id: user.id },
      data: { metadata, mfaEnabled: false },
    });
    return secret;
  }

  async validateTwoFactor(
    principal: Principal,
    token: string,
  ): Promise<{ verified: boolean }> {
    const user = await this.prisma.user.findUnique({
      where: { id: principal.sub },
      select: { id: true, metadata: true },
    });
    if (!user) throw new NotFoundException("User not found");
    const secret = secretFromMetadata(user.metadata);
    if (!secret) throw new BadRequestException("Two-factor setup is required");
    const verified = speakeasy.totp.verify({
      secret,
      encoding: "base32",
      token,
      window: 1,
    });
    await this.prisma.user.update({
      where: { id: user.id },
      data: { mfaEnabled: verified },
    });
    return { verified };
  }

  async requestAdminReset(userReference: string): Promise<{
    success: true;
    message: "sent successfully";
  }> {
    const frontendUrl = this.config.get("FRONTEND_URL", { infer: true });
    if (!frontendUrl) {
      throw new ServiceUnavailableException(
        "Password reset URL is not configured",
      );
    }
    this.mailer.assertConfigured();
    const user = await this.prisma.user.findFirst({
      where: isUuid(userReference)
        ? { id: userReference }
        : { legacyId: userReference },
      select: { id: true, email: true },
    });
    if (!user) throw new NotFoundException("User not found");
    const key = randomBytes(32).toString("base64url");
    await this.recovery.set(
      "admin-reset",
      key,
      { userId: user.id },
      adminResetTtlSeconds,
    );
    const resetUrl = new URL("/reset-password/", frontendUrl);
    resetUrl.searchParams.set("token", key);
    await this.mailer.send(
      user.email,
      "Password Reset",
      `Click on the link to reset your password: ${resetUrl.toString()}`,
    );
    return { success: true, message: "sent successfully" };
  }

  async completeAdminReset(dto: ResetPasswordDto): Promise<{
    success: true;
    message: "password changed successfully";
  }> {
    const data = await this.recovery.get("admin-reset", dto.key);
    if (!data?.userId) {
      throw new NotFoundException("key is incorrect or expired");
    }
    await this.replacePassword(data.userId, dto.password);
    await this.recovery.delete("admin-reset", dto.key);
    return { success: true, message: "password changed successfully" };
  }

  async requestForgotPassword(dto: ForgotPasswordDto): Promise<{
    success: true;
    message: "true";
    data: { key: string };
  }> {
    const email = dto.email?.trim().toLowerCase();
    const username = dto.username?.trim();
    if (!email && !username) {
      throw new BadRequestException("Please provide email or username");
    }
    this.mailer.assertConfigured();
    const identity: Prisma.UserWhereInput = email
      ? { email }
      : username
        ? { username }
        : {};
    const user = await this.prisma.user.findFirst({
      where: {
        status: "ACTIVE",
        ...identity,
        roles: {
          none: { role: { key: { in: ["client", "user"] } } },
        },
      },
      select: { id: true, email: true },
    });
    if (!user) throw new NotFoundException("email or username is incorrect");
    const key = randomBytes(32).toString("base64url");
    const otp = randomInt(100_000, 1_000_000).toString();
    await this.recovery.set(
      "forgot-password",
      key,
      { userId: user.id, otp },
      forgotPasswordTtlSeconds,
    );
    await this.mailer.send(user.email, "Reset Password", `Your OTP is: ${otp}`);
    return { success: true, message: "true", data: { key } };
  }

  async completeForgotPassword(dto: CompleteForgotPasswordDto): Promise<{
    success: true;
    message: "password changed successfully";
  }> {
    const data = await this.recovery.get("forgot-password", dto.key);
    if (!data?.userId || !data.otp) {
      throw new NotFoundException("key is incorrect or expired");
    }
    if (!secureCodeEquals(data.otp, dto.otp)) {
      throw new NotFoundException("otp is incorrect");
    }
    await this.replacePassword(data.userId, dto.password);
    await this.recovery.delete("forgot-password", dto.key);
    return { success: true, message: "password changed successfully" };
  }

  async forgotUsername(emailValue: string): Promise<{
    success: true;
    message: "sent successfully";
  }> {
    this.mailer.assertConfigured();
    const email = emailValue.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { email: true, username: true },
    });
    if (!user?.username) {
      throw new NotFoundException("username is incorrect");
    }
    await this.mailer.send(
      user.email,
      "Username",
      `Your username is: ${user.username}`,
    );
    return { success: true, message: "sent successfully" };
  }

  async refresh(refreshToken: string): Promise<{
    message: "true";
    userId: string;
    role: string | null;
    token: string;
    refreshToken: string;
  }> {
    const rotated = await this.auth.rotateRefreshToken(refreshToken);
    return {
      message: "true",
      userId: rotated.principal.sub,
      role: rotated.principal.roles[0] ?? null,
      token: rotated.accessToken,
      refreshToken: rotated.refreshToken,
    };
  }

  async generateTemporaryPassword(userReference: string): Promise<{
    success: true;
    message: "Temporary password generated";
    data: {
      username: string;
      email: string;
      temporaryPassword: string;
    };
  }> {
    const user = await this.userByReference(userReference);
    const temporaryPassword = randomBytes(12).toString("base64url");
    const encrypted = this.encryptTemporaryPassword(temporaryPassword);
    await this.recovery.set(
      "temporary-password",
      user.id,
      encrypted,
      temporaryPasswordTtlSeconds,
    );
    try {
      const passwordHash = await hash(temporaryPassword);
      await this.prisma.$transaction(async (transaction) => {
        await transaction.user.update({
          where: { id: user.id },
          data: {
            passwordHash,
            status: "ACTIVE",
            metadata: {
              ...jsonObject(user.metadata),
              passwordChangeRequired: true,
            },
          },
        });
        await transaction.session.updateMany({
          where: { userId: user.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      });
    } catch (error) {
      await this.recovery.delete("temporary-password", user.id);
      throw error;
    }
    return {
      success: true,
      message: "Temporary password generated",
      data: {
        username: user.username ?? user.email,
        email: user.email,
        temporaryPassword,
      },
    };
  }

  async getTemporaryPassword(userReference: string): Promise<{
    success: true;
    data: {
      username: string;
      email: string;
      temporaryPassword: string;
    };
  }> {
    const user = await this.userByReference(userReference);
    const encrypted = await this.recovery.get("temporary-password", user.id);
    if (!encrypted) {
      throw new NotFoundException(
        "No temporary password set for this user or it has expired",
      );
    }
    let temporaryPassword: string;
    try {
      temporaryPassword = this.decryptTemporaryPassword(encrypted);
    } catch {
      await this.recovery.delete("temporary-password", user.id);
      throw new NotFoundException(
        "No temporary password set for this user or it has expired",
      );
    }
    return {
      success: true,
      data: {
        username: user.username ?? user.email,
        email: user.email,
        temporaryPassword,
      },
    };
  }

  async changeTemporaryPassword(
    principal: Principal,
    newPassword: string,
  ): Promise<{ success: true; message: "Password changed successfully" }> {
    const user = await this.prisma.user.findUnique({
      where: { id: principal.sub },
      select: { id: true, metadata: true },
    });
    if (!user) throw new NotFoundException("User not found");
    const metadata = jsonObject(user.metadata);
    if (metadata.passwordChangeRequired !== true) {
      throw new ForbiddenException(
        "A temporary password change is not required",
      );
    }
    const passwordHash = await hash(newPassword);
    await this.prisma.$transaction(async (transaction) => {
      await transaction.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          metadata: { ...metadata, passwordChangeRequired: false },
        },
      });
      await transaction.session.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
    await this.recovery.delete("temporary-password", user.id);
    return { success: true, message: "Password changed successfully" };
  }

  private async replacePassword(
    userId: string,
    password: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, metadata: true },
    });
    if (!user) throw new NotFoundException("user is not found");
    const passwordHash = await hash(password);
    await this.prisma.$transaction(async (transaction) => {
      await transaction.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          status: "ACTIVE",
          metadata: {
            ...jsonObject(user.metadata),
            passwordChangeRequired: false,
          },
        },
      });
      await transaction.session.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
    await this.recovery.delete("temporary-password", user.id);
  }

  private async userByReference(reference: string) {
    const user = await this.prisma.user.findFirst({
      where: isUuid(reference) ? { id: reference } : { legacyId: reference },
      select: {
        id: true,
        email: true,
        username: true,
        metadata: true,
      },
    });
    if (!user) throw new NotFoundException("User not found");
    return user;
  }

  private encryptionKey(): Buffer {
    return createHash("sha256")
      .update(this.config.get("JWT_REFRESH_SECRET", { infer: true }))
      .digest();
  }

  private encryptTemporaryPassword(
    temporaryPassword: string,
  ): Record<string, string> {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.encryptionKey(), iv);
    const ciphertext = Buffer.concat([
      cipher.update(temporaryPassword, "utf8"),
      cipher.final(),
    ]);
    return {
      iv: iv.toString("base64url"),
      tag: cipher.getAuthTag().toString("base64url"),
      ciphertext: ciphertext.toString("base64url"),
    };
  }

  private decryptTemporaryPassword(encrypted: Record<string, string>): string {
    if (!encrypted.iv || !encrypted.tag || !encrypted.ciphertext) {
      throw new Error("Invalid encrypted credential");
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.encryptionKey(),
      Buffer.from(encrypted.iv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(encrypted.tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted.ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  }

  private async managementUserByEmail(emailValue: string) {
    const email = emailValue.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: this.managementUserRelations(),
    });
    if (!user || !this.isManagementUser(user)) {
      throw new UnauthorizedException("Invalid credentials");
    }
    return user;
  }

  private async managementUserByReference(reference: string) {
    const user = await this.prisma.user.findFirst({
      where: isUuid(reference) ? { id: reference } : { legacyId: reference },
      include: this.managementUserRelations(),
    });
    if (!user || !this.isManagementUser(user)) {
      throw new UnauthorizedException("Invalid credentials");
    }
    return user;
  }

  private managementUserRelations() {
    return {
      roles: {
        include: {
          role: {
            include: { permissions: { include: { permission: true } } },
          },
        },
      },
      projects: {
        include: { project: true },
      },
    } satisfies Prisma.UserInclude;
  }

  private isManagementUser(user: {
    status: "INVITED" | "ACTIVE" | "DISABLED";
    roles: Array<{ role: { key: string } }>;
  }): boolean {
    return (
      user.status === "ACTIVE" &&
      user.roles.length > 0 &&
      user.roles.every(
        ({ role }) => role.key !== "client" && role.key !== "user",
      )
    );
  }

  private principal(user: {
    id: string;
    organizationId: string | null;
    roles: Array<{
      role: {
        key: string;
        permissions: Array<{ permission: { key: string } }>;
      };
    }>;
  }): Principal {
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

  private compatibilityUser(user: {
    id: string;
    legacyId: string | null;
    email: string;
    username: string | null;
    fullName: string;
    status: "INVITED" | "ACTIVE" | "DISABLED";
    mfaEnabled: boolean;
    metadata: Prisma.JsonValue;
    roles: Array<{
      role: {
        id: string;
        legacyId: string | null;
        key: string;
        permissions: Array<{ permission: { key: string } }>;
      };
    }>;
    projects: Array<{
      project: {
        id: string;
        legacyId: string | null;
        name: string;
      };
    }>;
  }): Record<string, unknown> {
    const metadata = jsonObject(user.metadata);
    const role = user.roles[0]?.role;
    return {
      _id: user.legacyId ?? user.id,
      id: user.id,
      email: user.email,
      username: user.username,
      fullName: user.fullName,
      role: role?.key ?? null,
      roleId: role
        ? {
            _id: role.legacyId ?? role.id,
            id: role.id,
            role: role.key,
            permissions: role.permissions.map(
              ({ permission }) => permission.key,
            ),
          }
        : null,
      projects: user.projects.map(
        ({ project }) => project.legacyId ?? project.id,
      ),
      isActive: user.status === "ACTIVE",
      "2faVerified": user.mfaEnabled,
      passwordChangeRequired: metadata.passwordChangeRequired === true,
    };
  }
}

@ApiTags("auth")
@Controller({ path: "user", version: VERSION_NEUTRAL })
export class AccountAccessController {
  constructor(
    @Inject(AccountAccessService)
    private readonly accountAccess: AccountAccessService,
  ) {}

  @Post("management/login")
  @HttpCode(200)
  @ApiOkResponse({ description: "The management credentials were verified." })
  startManagementLogin(
    @BodyDto(ManagementLoginStartDto) body: ManagementLoginStartDto,
  ) {
    return this.accountAccess.startManagementLogin(body);
  }

  @Put("management/login")
  @ApiOkResponse({ description: "The management login was completed." })
  completeManagementLogin(
    @BodyDto(ManagementLoginCompleteDto) body: ManagementLoginCompleteDto,
  ) {
    return this.accountAccess.completeManagementLogin(body);
  }

  @Post("management/register2fa")
  @HttpCode(200)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  registerTwoFactor(@CurrentUser() principal: Principal) {
    return this.accountAccess.registerTwoFactor(principal);
  }

  @Post("management/validate2fa")
  @HttpCode(200)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  validateTwoFactor(
    @CurrentUser() principal: Principal,
    @BodyDto(ValidateTwoFactorDto) body: ValidateTwoFactorDto,
  ) {
    return this.accountAccess.validateTwoFactor(principal, body.token);
  }

  @Post("admin-reset-password")
  @HttpCode(200)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AdminRoleGuard)
  requestAdminReset(
    @BodyDto(AdminResetPasswordDto) body: AdminResetPasswordDto,
  ) {
    return this.accountAccess.requestAdminReset(body.userId);
  }

  @Put("admin-reset-password-verify")
  completeAdminReset(@BodyDto(ResetPasswordDto) body: ResetPasswordDto) {
    return this.accountAccess.completeAdminReset(body);
  }

  @Post("forgot-password")
  @HttpCode(200)
  requestForgotPassword(@BodyDto(ForgotPasswordDto) body: ForgotPasswordDto) {
    return this.accountAccess.requestForgotPassword(body);
  }

  @Put("forgot-password")
  completeForgotPassword(
    @BodyDto(CompleteForgotPasswordDto) body: CompleteForgotPasswordDto,
  ) {
    return this.accountAccess.completeForgotPassword(body);
  }

  @Post("forgot-username")
  @HttpCode(200)
  forgotUsername(@BodyDto(ForgotUsernameDto) body: ForgotUsernameDto) {
    return this.accountAccess.forgotUsername(body.email);
  }

  @Post("refreshtoken")
  @HttpCode(200)
  refresh(@BodyDto(CompatibilityRefreshDto) body: CompatibilityRefreshDto) {
    return this.accountAccess.refresh(body.refreshToken);
  }

  @Post("admin-generate-temp-password")
  @HttpCode(200)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AdminRoleGuard)
  generateTemporaryPassword(
    @BodyDto(AdminResetPasswordDto) body: AdminResetPasswordDto,
  ) {
    return this.accountAccess.generateTemporaryPassword(body.userId);
  }

  @Get("get-temporary-password/:userId")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AdminRoleGuard)
  getTemporaryPassword(@Param("userId") userId: string) {
    return this.accountAccess.getTemporaryPassword(userId);
  }

  @Post("change-password-after-reset")
  @HttpCode(200)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  changeTemporaryPassword(
    @CurrentUser() principal: Principal,
    @BodyDto(ChangeTemporaryPasswordDto) body: ChangeTemporaryPasswordDto,
  ) {
    return this.accountAccess.changeTemporaryPassword(
      principal,
      body.newPassword,
    );
  }
}

@Module({
  imports: [AuthModule, UsersModule],
  providers: [AccountAccessService, AccountRecoveryStore],
  controllers: [AccountAccessController],
})
export class AccountAccessModule {}
