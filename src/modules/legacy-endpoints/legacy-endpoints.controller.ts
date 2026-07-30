import { All, Controller, Req, Res, VERSION_NEUTRAL } from "@nestjs/common";
import { LegacyRuntimeService } from "./legacy-runtime.service.js";

type AnyRecord = Record<string, any>;

@Controller({ path: "", version: VERSION_NEUTRAL })
export class LegacyEndpointsController {
  constructor(private readonly runtime: LegacyRuntimeService) {}

  @All("user")
  user(@Req() request: AnyRecord, @Res() reply: AnyRecord) {
    return this.runtime.handle(request, reply);
  }

  @All("user/:one")
  userOne(@Req() request: AnyRecord, @Res() reply: AnyRecord) {
    return this.runtime.handle(request, reply);
  }
  @All("user/:one/:two")
  userTwo(@Req() request: AnyRecord, @Res() reply: AnyRecord) {
    return this.runtime.handle(request, reply);
  }
  @All("user/:one/:two/:three")
  userThree(@Req() request: AnyRecord, @Res() reply: AnyRecord) {
    return this.runtime.handle(request, reply);
  }
  @All("user/:one/:two/:three/:four")
  userFour(@Req() request: AnyRecord, @Res() reply: AnyRecord) {
    return this.runtime.handle(request, reply);
  }

  @All("webhook")
  webhook(@Req() request: AnyRecord, @Res() reply: AnyRecord) {
    return this.runtime.handle(request, reply);
  }
  @All("webhook/:one")
  webhookOne(@Req() request: AnyRecord, @Res() reply: AnyRecord) {
    return this.runtime.handle(request, reply);
  }
  @All("webhook/:one/:two")
  webhookTwo(@Req() request: AnyRecord, @Res() reply: AnyRecord) {
    return this.runtime.handle(request, reply);
  }
  @All("webhook/:one/:two/:three")
  webhookThree(@Req() request: AnyRecord, @Res() reply: AnyRecord) {
    return this.runtime.handle(request, reply);
  }
  @All("webhook/:one/:two/:three/:four")
  webhookFour(@Req() request: AnyRecord, @Res() reply: AnyRecord) {
    return this.runtime.handle(request, reply);
  }
}
