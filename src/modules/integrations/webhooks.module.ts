import { Module } from "@nestjs/common";
import { CrmSyncModule } from "../crm-sync/crm-sync.module.js";
import {
  CheckMarketSignatureGuard,
  WebhookIngestionService,
  WebhooksController,
  ZohoSignatureGuard,
} from "./webhooks.controller.js";

@Module({
  imports: [CrmSyncModule],
  providers: [
    ZohoSignatureGuard,
    CheckMarketSignatureGuard,
    WebhookIngestionService,
  ],
  controllers: [WebhooksController],
  exports: [WebhookIngestionService],
})
export class WebhooksModule {}
