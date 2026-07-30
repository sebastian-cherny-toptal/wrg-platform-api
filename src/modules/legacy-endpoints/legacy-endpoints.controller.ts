import { All, Controller, Req, Res, VERSION_NEUTRAL } from "@nestjs/common";
import { LegacyRuntimeService } from "./legacy-runtime.service.js";

type AnyRecord = Record<string, any>;

@Controller({ path: "", version: VERSION_NEUTRAL })
export class LegacyEndpointsController {
  constructor(private readonly runtime: LegacyRuntimeService) {}

  @All("user")
  user(@Req() request: AnyRecord, @Res() reply: AnyRecord) { return this.runtime.handle(request, reply); }

  @All("user/:one")
  userOne(@Req() request: AnyRecord, @Res() reply: AnyRecord) { return this.runtime.handle(request, reply); }
  @All("user/:one/:two")
  userTwo(@Req() request: AnyRecord, @Res() reply: AnyRecord) { return this.runtime.handle(request, reply); }
  @All("user/:one/:two/:three")
  userThree(@Req() request: AnyRecord, @Res() reply: AnyRecord) { return this.runtime.handle(request, reply); }
  @All("user/:one/:two/:three/:four")
  userFour(@Req() request: AnyRecord, @Res() reply: AnyRecord) { return this.runtime.handle(request, reply); }

  @All("client")
  client(@Req() request: AnyRecord, @Res() reply: AnyRecord) { return this.runtime.handle(request, reply); }
  @All("client/:one")
  clientOne(@Req() request: AnyRecord, @Res() reply: AnyRecord) { return this.runtime.handle(request, reply); }
  @All("client/:one/:two")
  clientTwo(@Req() request: AnyRecord, @Res() reply: AnyRecord) { return this.runtime.handle(request, reply); }
  @All("client/:one/:two/:three")
  clientThree(@Req() request: AnyRecord, @Res() reply: AnyRecord) { return this.runtime.handle(request, reply); }
  @All("client/:one/:two/:three/:four")
  clientFour(@Req() request: AnyRecord, @Res() reply: AnyRecord) { return this.runtime.handle(request, reply); }

  @All("admin")
  admin(@Req() request: AnyRecord, @Res() reply: AnyRecord) { return this.runtime.handle(request, reply); }
  @All("admin/:one")
  adminOne(@Req() request: AnyRecord, @Res() reply: AnyRecord) { return this.runtime.handle(request, reply); }
  @All("admin/:one/:two")
  adminTwo(@Req() request: AnyRecord, @Res() reply: AnyRecord) { return this.runtime.handle(request, reply); }
  @All("admin/:one/:two/:three")
  adminThree(@Req() request: AnyRecord, @Res() reply: AnyRecord) { return this.runtime.handle(request, reply); }
  @All("admin/:one/:two/:three/:four")
  adminFour(@Req() request: AnyRecord, @Res() reply: AnyRecord) { return this.runtime.handle(request, reply); }

  @All("dashboard")
  dashboard(@Req() request: AnyRecord, @Res() reply: AnyRecord) { return this.runtime.handle(request, reply); }
  @All("dashboard/:one")
  dashboardOne(@Req() request: AnyRecord, @Res() reply: AnyRecord) { return this.runtime.handle(request, reply); }
  @All("dashboard/:one/:two")
  dashboardTwo(@Req() request: AnyRecord, @Res() reply: AnyRecord) { return this.runtime.handle(request, reply); }

  @All("payment")
  payment(@Req() request: AnyRecord, @Res() reply: AnyRecord) { return this.runtime.handle(request, reply); }
  @All("payment/:one")
  paymentOne(@Req() request: AnyRecord, @Res() reply: AnyRecord) { return this.runtime.handle(request, reply); }
  @All("payment/:one/:two")
  paymentTwo(@Req() request: AnyRecord, @Res() reply: AnyRecord) { return this.runtime.handle(request, reply); }

  @All("zoho")
  zoho(@Req() request: AnyRecord, @Res() reply: AnyRecord) { return this.runtime.handle(request, reply); }
  @All("zoho/:one")
  zohoOne(@Req() request: AnyRecord, @Res() reply: AnyRecord) { return this.runtime.handle(request, reply); }
  @All("zoho/:one/:two")
  zohoTwo(@Req() request: AnyRecord, @Res() reply: AnyRecord) { return this.runtime.handle(request, reply); }

  @All("webhook")
  webhook(@Req() request: AnyRecord, @Res() reply: AnyRecord) { return this.runtime.handle(request, reply); }
  @All("webhook/:one")
  webhookOne(@Req() request: AnyRecord, @Res() reply: AnyRecord) { return this.runtime.handle(request, reply); }
  @All("webhook/:one/:two")
  webhookTwo(@Req() request: AnyRecord, @Res() reply: AnyRecord) { return this.runtime.handle(request, reply); }
  @All("webhook/:one/:two/:three")
  webhookThree(@Req() request: AnyRecord, @Res() reply: AnyRecord) { return this.runtime.handle(request, reply); }
  @All("webhook/:one/:two/:three/:four")
  webhookFour(@Req() request: AnyRecord, @Res() reply: AnyRecord) { return this.runtime.handle(request, reply); }

  @All("ping")
  ping(@Req() request: AnyRecord, @Res() reply: AnyRecord) { return this.runtime.handle(request, reply); }

  @All("deploy-check")
  deployCheck(@Req() request: AnyRecord, @Res() reply: AnyRecord) { return this.runtime.handle(request, reply); }

  @All("health")
  health(@Req() request: AnyRecord, @Res() reply: AnyRecord) { return this.runtime.handle(request, reply); }
}
