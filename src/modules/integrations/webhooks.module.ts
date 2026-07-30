import { Module } from "@nestjs/common";
import { CrmSyncModule } from "../crm-sync/crm-sync.module.js";
import {
  CheckMarketSignatureGuard,
  WebhooksController,
  ZohoSignatureGuard,
} from "./webhooks.controller.js";

@Module({
  imports: [CrmSyncModule],
  providers: [ZohoSignatureGuard, CheckMarketSignatureGuard],
  controllers: [WebhooksController],
})
export class WebhooksModule {}
