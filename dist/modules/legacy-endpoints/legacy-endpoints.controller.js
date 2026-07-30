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
import { All, Controller, Req, Res, VERSION_NEUTRAL } from "@nestjs/common";
import { LegacyRuntimeService } from "./legacy-runtime.service.js";
let LegacyEndpointsController = class LegacyEndpointsController {
    runtime;
    constructor(runtime) {
        this.runtime = runtime;
    }
    user(request, reply) { return this.runtime.handle(request, reply); }
    userOne(request, reply) { return this.runtime.handle(request, reply); }
    userTwo(request, reply) { return this.runtime.handle(request, reply); }
    userThree(request, reply) { return this.runtime.handle(request, reply); }
    userFour(request, reply) { return this.runtime.handle(request, reply); }
    client(request, reply) { return this.runtime.handle(request, reply); }
    clientOne(request, reply) { return this.runtime.handle(request, reply); }
    clientTwo(request, reply) { return this.runtime.handle(request, reply); }
    clientThree(request, reply) { return this.runtime.handle(request, reply); }
    clientFour(request, reply) { return this.runtime.handle(request, reply); }
    admin(request, reply) { return this.runtime.handle(request, reply); }
    adminOne(request, reply) { return this.runtime.handle(request, reply); }
    adminTwo(request, reply) { return this.runtime.handle(request, reply); }
    adminThree(request, reply) { return this.runtime.handle(request, reply); }
    adminFour(request, reply) { return this.runtime.handle(request, reply); }
    dashboard(request, reply) { return this.runtime.handle(request, reply); }
    dashboardOne(request, reply) { return this.runtime.handle(request, reply); }
    dashboardTwo(request, reply) { return this.runtime.handle(request, reply); }
    payment(request, reply) { return this.runtime.handle(request, reply); }
    paymentOne(request, reply) { return this.runtime.handle(request, reply); }
    paymentTwo(request, reply) { return this.runtime.handle(request, reply); }
    zoho(request, reply) { return this.runtime.handle(request, reply); }
    zohoOne(request, reply) { return this.runtime.handle(request, reply); }
    zohoTwo(request, reply) { return this.runtime.handle(request, reply); }
    webhook(request, reply) { return this.runtime.handle(request, reply); }
    webhookOne(request, reply) { return this.runtime.handle(request, reply); }
    webhookTwo(request, reply) { return this.runtime.handle(request, reply); }
    webhookThree(request, reply) { return this.runtime.handle(request, reply); }
    webhookFour(request, reply) { return this.runtime.handle(request, reply); }
    ping(request, reply) { return this.runtime.handle(request, reply); }
    deployCheck(request, reply) { return this.runtime.handle(request, reply); }
    health(request, reply) { return this.runtime.handle(request, reply); }
};
__decorate([
    All("user"),
    __param(0, Req()),
    __param(1, Res()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], LegacyEndpointsController.prototype, "user", null);
__decorate([
    All("user/:one"),
    __param(0, Req()),
    __param(1, Res()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], LegacyEndpointsController.prototype, "userOne", null);
__decorate([
    All("user/:one/:two"),
    __param(0, Req()),
    __param(1, Res()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], LegacyEndpointsController.prototype, "userTwo", null);
__decorate([
    All("user/:one/:two/:three"),
    __param(0, Req()),
    __param(1, Res()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], LegacyEndpointsController.prototype, "userThree", null);
__decorate([
    All("user/:one/:two/:three/:four"),
    __param(0, Req()),
    __param(1, Res()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], LegacyEndpointsController.prototype, "userFour", null);
__decorate([
    All("client"),
    __param(0, Req()),
    __param(1, Res()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], LegacyEndpointsController.prototype, "client", null);
__decorate([
    All("client/:one"),
    __param(0, Req()),
    __param(1, Res()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], LegacyEndpointsController.prototype, "clientOne", null);
__decorate([
    All("client/:one/:two"),
    __param(0, Req()),
    __param(1, Res()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], LegacyEndpointsController.prototype, "clientTwo", null);
__decorate([
    All("client/:one/:two/:three"),
    __param(0, Req()),
    __param(1, Res()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], LegacyEndpointsController.prototype, "clientThree", null);
__decorate([
    All("client/:one/:two/:three/:four"),
    __param(0, Req()),
    __param(1, Res()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], LegacyEndpointsController.prototype, "clientFour", null);
__decorate([
    All("admin"),
    __param(0, Req()),
    __param(1, Res()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], LegacyEndpointsController.prototype, "admin", null);
__decorate([
    All("admin/:one"),
    __param(0, Req()),
    __param(1, Res()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], LegacyEndpointsController.prototype, "adminOne", null);
__decorate([
    All("admin/:one/:two"),
    __param(0, Req()),
    __param(1, Res()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], LegacyEndpointsController.prototype, "adminTwo", null);
__decorate([
    All("admin/:one/:two/:three"),
    __param(0, Req()),
    __param(1, Res()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], LegacyEndpointsController.prototype, "adminThree", null);
__decorate([
    All("admin/:one/:two/:three/:four"),
    __param(0, Req()),
    __param(1, Res()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], LegacyEndpointsController.prototype, "adminFour", null);
__decorate([
    All("dashboard"),
    __param(0, Req()),
    __param(1, Res()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], LegacyEndpointsController.prototype, "dashboard", null);
__decorate([
    All("dashboard/:one"),
    __param(0, Req()),
    __param(1, Res()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], LegacyEndpointsController.prototype, "dashboardOne", null);
__decorate([
    All("dashboard/:one/:two"),
    __param(0, Req()),
    __param(1, Res()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], LegacyEndpointsController.prototype, "dashboardTwo", null);
__decorate([
    All("payment"),
    __param(0, Req()),
    __param(1, Res()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], LegacyEndpointsController.prototype, "payment", null);
__decorate([
    All("payment/:one"),
    __param(0, Req()),
    __param(1, Res()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], LegacyEndpointsController.prototype, "paymentOne", null);
__decorate([
    All("payment/:one/:two"),
    __param(0, Req()),
    __param(1, Res()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], LegacyEndpointsController.prototype, "paymentTwo", null);
__decorate([
    All("zoho"),
    __param(0, Req()),
    __param(1, Res()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], LegacyEndpointsController.prototype, "zoho", null);
__decorate([
    All("zoho/:one"),
    __param(0, Req()),
    __param(1, Res()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], LegacyEndpointsController.prototype, "zohoOne", null);
__decorate([
    All("zoho/:one/:two"),
    __param(0, Req()),
    __param(1, Res()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], LegacyEndpointsController.prototype, "zohoTwo", null);
__decorate([
    All("webhook"),
    __param(0, Req()),
    __param(1, Res()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], LegacyEndpointsController.prototype, "webhook", null);
__decorate([
    All("webhook/:one"),
    __param(0, Req()),
    __param(1, Res()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], LegacyEndpointsController.prototype, "webhookOne", null);
__decorate([
    All("webhook/:one/:two"),
    __param(0, Req()),
    __param(1, Res()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], LegacyEndpointsController.prototype, "webhookTwo", null);
__decorate([
    All("webhook/:one/:two/:three"),
    __param(0, Req()),
    __param(1, Res()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], LegacyEndpointsController.prototype, "webhookThree", null);
__decorate([
    All("webhook/:one/:two/:three/:four"),
    __param(0, Req()),
    __param(1, Res()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], LegacyEndpointsController.prototype, "webhookFour", null);
__decorate([
    All("ping"),
    __param(0, Req()),
    __param(1, Res()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], LegacyEndpointsController.prototype, "ping", null);
__decorate([
    All("deploy-check"),
    __param(0, Req()),
    __param(1, Res()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], LegacyEndpointsController.prototype, "deployCheck", null);
__decorate([
    All("health"),
    __param(0, Req()),
    __param(1, Res()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], LegacyEndpointsController.prototype, "health", null);
LegacyEndpointsController = __decorate([
    Controller({ path: "", version: VERSION_NEUTRAL }),
    __metadata("design:paramtypes", [LegacyRuntimeService])
], LegacyEndpointsController);
export { LegacyEndpointsController };
//# sourceMappingURL=legacy-endpoints.controller.js.map