import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import {
  efsQueueName,
  ProgramEfsJobs,
  ProgramEfsWorker,
} from "./program-efs-jobs.js";
import { AuthModule } from "../auth/auth.module.js";
import { HistoricalImportController } from "./historical-import.controller.js";
import { HistoricalImportService } from "./historical-import.service.js";
import { ProgramSurveyDefinitionController } from "./program-survey-definition.controller.js";
import { ProgramSurveyDefinitionService } from "./program-survey-definition.service.js";

@Module({
  imports: [AuthModule, BullModule.registerQueue({ name: efsQueueName })],
  providers: [
    HistoricalImportService,
    ProgramSurveyDefinitionService,
    ProgramEfsJobs,
    ProgramEfsWorker,
  ],
  controllers: [HistoricalImportController, ProgramSurveyDefinitionController],
})
export class HistoricalImportModule {}
