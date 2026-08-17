import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";

export function resolveHttpErrorStatus(exception: unknown): number {
  return exception instanceof HttpException
    ? exception.getStatus()
    : HttpStatus.INTERNAL_SERVER_ERROR;
}

export function resolveHttpErrorMessage(exception: unknown): string {
  if (exception instanceof HttpException) {
    const response = exception.getResponse();
    if (typeof response === "string") return response;
    if ("message" in response) {
      const message = (response as { message: unknown }).message;
      if (Array.isArray(message)) return message.map(String).join("; ");
      if (typeof message === "string") return message;
    }
  }
  if (exception instanceof Error) return exception.message;
  return "Internal server error";
}

export function resolveHttpErrorBody(
  exception: unknown,
  status: number,
): string | Record<string, unknown> {
  if (exception instanceof HttpException) {
    const response = exception.getResponse();
    if (typeof response === "string") {
      return { statusCode: status, message: response };
    }
    return {
      statusCode: status,
      ...(response as Record<string, unknown>),
    };
  }
  return {
    statusCode: status,
    message:
      status >= HttpStatus.INTERNAL_SERVER_ERROR.valueOf()
        ? "Internal server error"
        : resolveHttpErrorMessage(exception),
  };
}

@Catch()
export class ServerErrorLoggingFilter implements ExceptionFilter {
  private readonly logger = new Logger(ServerErrorLoggingFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();
    const status = resolveHttpErrorStatus(exception);
    const message = resolveHttpErrorMessage(exception);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR.valueOf()) {
      const payload = {
        err: exception instanceof Error ? exception : undefined,
        method: request.method,
        url: request.url,
        statusCode: status,
        correlationId: request.id,
        message,
      };
      if (typeof request.log.error === "function") {
        request.log.error(payload, "request failed with server error");
      } else {
        this.logger.error(
          {
            ...payload,
            stack: exception instanceof Error ? exception.stack : undefined,
          },
          "request failed with server error",
        );
      }
    }

    response.status(status).send(resolveHttpErrorBody(exception, status));
  }
}
