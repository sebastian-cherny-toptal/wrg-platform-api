import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { HistoricalImportController } from "./historical-import.controller.js";
import { HistoricalImportService } from "./historical-import.service.js";

@Module({
  imports: [AuthModule],
  providers: [HistoricalImportService],
  controllers: [HistoricalImportController],
})
export class HistoricalImportModule {}
