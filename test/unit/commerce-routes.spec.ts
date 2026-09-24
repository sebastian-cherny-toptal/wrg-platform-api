import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RequestMethod } from "@nestjs/common";
import {
  METHOD_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
} from "@nestjs/common/constants";
import { CompatibilityPaymentService } from "../../src/modules/commerce/compatibility-payment.module.js";
import { CommerceModule } from "../../src/modules/commerce/commerce.module.js";

describe("native commerce routes", () => {
  it("does not expose a client-priced checkout endpoint", () => {
    const controllers =
      (Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, CommerceModule) as
        | Array<new (...args: never[]) => object>
        | undefined) ?? [];

    const routes = controllers.flatMap((controller) => {
      const controllerPath = Reflect.getMetadata(
        PATH_METADATA,
        controller,
      ) as string | undefined;
      return Object.getOwnPropertyNames(controller.prototype).flatMap(
        (methodName) => {
          const method = Object.getOwnPropertyDescriptor(
            controller.prototype,
            methodName,
          )?.value as object | undefined;
          if (!method) return [];
          const methodPath = Reflect.getMetadata(PATH_METADATA, method) as
            | string
            | undefined;
          const requestMethod = Reflect.getMetadata(
            METHOD_METADATA,
            method,
          ) as RequestMethod | undefined;
          return methodPath === undefined || requestMethod === undefined
            ? []
            : [{ controllerPath, methodPath, requestMethod }];
        },
      );
    });

    assert.equal(
      routes.some(
        ({ controllerPath, methodPath, requestMethod }) =>
          controllerPath === "organizations/:organizationId/commerce" &&
          methodPath === "checkout" &&
          requestMethod === RequestMethod.POST,
      ),
      false,
    );
  });

  it("refuses to fulfill legacy client-priced native orders", async () => {
    let entitlementUpdated = false;
    const service = new CompatibilityPaymentService(
      {
        order: {
          findUnique: () =>
            Promise.resolve({
              id: "order-id",
              paymentMethod: "card",
              items: [
                {
                  productId: "report-response-detail",
                  amountMinor: 1,
                  keys: { productId: "report-response-detail" },
                },
              ],
              organizationProgram: {
                id: "enrollment-id",
                stage: "Closed",
                reportAccess: { RD_Access: "no" },
                metrics: {},
                paymentDetails: {},
                dealExternalId: null,
              },
            }),
          update: () => Promise.resolve({ id: "order-id" }),
        },
        organizationProgram: {
          update: () => {
            entitlementUpdated = true;
            return Promise.resolve({ id: "enrollment-id" });
          },
        },
        $transaction: (operations: Array<Promise<unknown>>) =>
          Promise.all(operations),
      } as never,
      { get: () => "sk_test_example" } as never,
      {} as never,
    );

    await assert.rejects(
      service.fulfillPaidOrder("pi_legacy_native"),
      /server-priced checkout/u,
    );
    assert.equal(entitlementUpdated, false);
  });
});
