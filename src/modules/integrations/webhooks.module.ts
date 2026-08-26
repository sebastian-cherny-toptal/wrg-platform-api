import { Module } from "@nestjs/common";
import { CrmSyncModule } from "../crm-sync/crm-sync.module.js";
import { CompatibilityPaymentModule } from "../commerce/compatibility-payment.module.js";
import {
  CheckMarketSignatureGuard,
  WebhookIngestionService,
  WebhooksController,
  ZohoSignatureGuard,
} from "./webhooks.controller.js";

@Module({
  imports: [CrmSyncModule, CompatibilityPaymentModule],
  providers: [
    ZohoSignatureGuard,
    CheckMarketSignatureGuard,
    WebhookIngestionService,
  ],
  controllers: [WebhooksController],
  exports: [WebhookIngestionService],
})
export class WebhooksModule {}
