import {
  Body,
  type PipeTransform,
  type Type,
  ValidationPipe,
} from "@nestjs/common";
import { ApiBody } from "@nestjs/swagger";

/**
 * Like `@Body()`, but validates against an explicit DTO class.
 * Needed because `tsx` (start/start:dev) does not emit `design:paramtypes`,
 * so the global ValidationPipe cannot infer the metatype and skips validation.
 * Also registers the DTO with Swagger (`@ApiBody`) for `/docs`.
 */
class ExplicitDtoPipe<T extends object> implements PipeTransform {
  private readonly pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });

  constructor(private readonly dto: Type<T>) {}

  transform(value: unknown): Promise<T> {
    return this.pipe.transform(value, {
      type: "body",
      metatype: this.dto,
      data: "",
    }) as Promise<T>;
  }
}

export function BodyDto<T extends object>(dto: Type<T>): ParameterDecorator {
  return (target, propertyKey, parameterIndex) => {
    Body(new ExplicitDtoPipe(dto))(target, propertyKey, parameterIndex);
    if (propertyKey == null) {
      return;
    }
    const descriptor = Object.getOwnPropertyDescriptor(target, propertyKey) ?? {
      value: (target as Record<string | symbol, unknown>)[propertyKey],
    };
    ApiBody({ type: dto, required: true })(
      target,
      propertyKey,
      descriptor as TypedPropertyDescriptor<unknown>,
    );
  };
}
