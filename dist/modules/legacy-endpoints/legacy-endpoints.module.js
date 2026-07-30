var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Module } from "@nestjs/common";
import { LegacyEndpointsController } from "./legacy-endpoints.controller.js";
import { LegacyRuntimeService } from "./legacy-runtime.service.js";
let LegacyEndpointsModule = class LegacyEndpointsModule {
};
LegacyEndpointsModule = __decorate([
    Module({
        controllers: [LegacyEndpointsController],
        providers: [LegacyRuntimeService],
    })
], LegacyEndpointsModule);
export { LegacyEndpointsModule };
//# sourceMappingURL=legacy-endpoints.module.js.map