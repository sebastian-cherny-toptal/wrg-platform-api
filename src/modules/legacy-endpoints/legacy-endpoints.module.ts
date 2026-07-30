import { Module } from "@nestjs/common";
import { LegacyEndpointsController } from "./legacy-endpoints.controller.js";
import { LegacyRuntimeService } from "./legacy-runtime.service.js";

@Module({
  controllers: [LegacyEndpointsController],
  providers: [LegacyRuntimeService],
})
export class LegacyEndpointsModule {}
