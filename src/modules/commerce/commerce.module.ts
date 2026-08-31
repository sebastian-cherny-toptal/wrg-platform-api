import {
  Controller,
  Get,
  Inject,
  Injectable,
  Module,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  ApiBearerAuth,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from "@nestjs/swagger";
import {
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Min,
} from "class-validator";
import type { Prisma } from "@prisma/client";
import Stripe from "stripe";
import { BodyDto } from "../../common/http/body-dto.js";
import type { Env } from "../../config/env.js";
import { PrismaService } from "../../database/prisma.service.js";
import { JwtAuthGuard } from "../auth/auth.module.js";
import { TenantGuard } from "../tenants/tenants.module.js";

class CheckoutDto {
  @ApiProperty({ type: String, enum: ["USD", "CAD", "GBP"] })
  @IsString()
  @IsIn(["USD", "CAD", "GBP"])
  currency!: string;

  @ApiProperty({ type: Number, minimum: 1 })
  @IsInt()
  @Min(1)
  amountMinor!: number;

  @ApiProperty({
    type: "array",
    items: { type: "object", additionalProperties: true },
  })
  @IsArray()
  @IsObject({ each: true })
  items!: Array<Record<string, unknown>>;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  organizationProgramId?: string;

  @ApiProperty({ type: String, enum: ["card", "invoice"] })
  @IsIn(["card", "invoice"])
  paymentMethod!: "card" | "invoice";
}

const asJson = (value: unknown): Prisma.InputJsonValue =>
  value as Prisma.InputJsonValue;

@Injectable()
class CommerceService {
  private readonly stripe: Stripe;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConfigService) private readonly config: ConfigService<Env, true>,
  ) {
    this.stripe = new Stripe(config.get("STRIPE_SECRET_KEY", { infer: true }));
  }

  async checkout(organizationId: string, dto: CheckoutDto) {
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
    });
    const organizationProgram = dto.organizationProgramId
      ? await this.prisma.organizationProgram.findFirstOrThrow({
          where: { id: dto.organizationProgramId, organizationId },
          select: { id: true, projectId: true, programId: true },
        })
      : null;
    const orderContext = {
      organizationProgramId: organizationProgram?.id ?? null,
      projectId: organizationProgram?.projectId ?? null,
      programId: organizationProgram?.programId ?? null,
    };
    if (dto.paymentMethod === "invoice") {
      return this.prisma.order.create({
        data: {
          organizationId,
          ...orderContext,
          currency: dto.currency,
          amountMinor: dto.amountMinor,
          items: asJson(dto.items),
          paymentMethod: "invoice",
          status: "INVOICED",
        },
      });
    }

    if (this.config.get("INTEGRATIONS_MOCK", { infer: true })) {
      return this.prisma.order.create({
        data: {
          organizationId,
          ...orderContext,
          paymentIntentId: `pi_mock_${crypto.randomUUID()}`,
          currency: dto.currency,
          amountMinor: dto.amountMinor,
          items: asJson(dto.items),
          paymentMethod: "card",
          status: "REQUIRES_PAYMENT",
        },
      });
    }
    const intent = await this.stripe.paymentIntents.create(
      {
        amount: dto.amountMinor,
        currency: dto.currency.toLowerCase(),
        ...(organization.stripeCustomerId
          ? { customer: organization.stripeCustomerId }
          : {}),
        metadata: { organizationId },
      },
      { idempotencyKey: `checkout:${organizationId}:${crypto.randomUUID()}` },
    );
    const order = await this.prisma.order.create({
      data: {
        organizationId,
        ...orderContext,
        paymentIntentId: intent.id,
        currency: dto.currency,
        amountMinor: dto.amountMinor,
        items: asJson(dto.items),
        paymentMethod: "card",
        status: "REQUIRES_PAYMENT",
      },
    });
    return { ...order, clientSecret: intent.client_secret };
  }
}

@ApiTags("commerce")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller("organizations/:organizationId/commerce")
class CommerceController {
  constructor(
    @Inject(CommerceService) private readonly commerce: CommerceService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  @Post("checkout")
  checkout(
    @Param("organizationId") organizationId: string,
    @BodyDto(CheckoutDto) body: CheckoutDto,
  ) {
    return this.commerce.checkout(organizationId, body);
  }

  @Get("orders")
  orders(@Param("organizationId") organizationId: string) {
    return this.prisma.order.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
    });
  }
}

@Module({ providers: [CommerceService], controllers: [CommerceController] })
export class CommerceModule {}
