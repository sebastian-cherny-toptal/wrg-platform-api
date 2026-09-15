import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { HistoricalImportController } from "./historical-import.controller.js";
import { HistoricalImportService } from "./historical-import.service.js";
import { ProgramSurveyDefinitionController } from "./program-survey-definition.controller.js";
import { ProgramSurveyDefinitionService } from "./program-survey-definition.service.js";

@Module({
  imports: [AuthModule],
  providers: [HistoricalImportService, ProgramSurveyDefinitionService],
  controllers: [HistoricalImportController, ProgramSurveyDefinitionController],
})
export class HistoricalImportModule {}
