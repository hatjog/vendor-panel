import type { HttpTypes } from '@medusajs/types';

import type { CustomerGroupListResponse } from '../types/customer-group';
import type { ExtendedAdminOrderResponse, OrderCommission } from '../types/order';
import type {
  ExtendedAdminProductListResponse,
  ExtendedAdminProductResponse,
  ExtendedAdminProductVariant,
  ProductAttributesResponse
} from '../types/products';
import type { VendorPromotionRuleValueParams } from '../types/promotion';
import { fetchQuery } from './client';

/**
 * `@mercurjs/vendor@2.1.1` re-exported UI surface.
 *
 * Story 8.3 ratified waiver (review-fix 2026-05-27 H-01/H-02):
 * `@mercurjs/vendor@2.1.1` publishes only React UI primitives
 * (`Notifications`, `TabbedForm`, `useTabbedForm`, `App`, `TabDefinition`);
 * upstream does not export a typed HTTP client. The typed transport surface
 * for `/vendor/*` lives below in `mercurVendorClient` and routes through the
 * existing `fetchQuery` auth transport (bearer + publishable key).
 *
 * Re-exporting the genuine UI surface (NOT a single marker hook) keeps
 * value-level consumption of `@mercurjs/vendor` honest for FR-Ga.2 AC1 grep,
 * unblocks Epic 6 Story 6.4 `/security` page to import these primitives via
 * `@/lib/mercur-vendor-client` (single canonical re-export point), and is
 * tree-shakeable per consumer.
 *
 * Premise gap vs. architecture D-118 ("Path B Dual-SDK Completion") is
 * tracked as Deferred:architectural in story 8.3 Dev Agent Record →
 * D-118 reassess (Story 8.4 drift validator must accept the hand-rolled
 * facade pattern as canonical until upstream ships a typed vendor SDK).
 */
export {
  Notifications as MercurVendorNotifications,
  TabbedForm as MercurVendorTabbedForm,
  useTabbedForm as useMercurVendorTabbedForm
} from '@mercurjs/vendor';
export type { TabDefinition as MercurVendorTabDefinition } from '@mercurjs/vendor';

type VendorQueryValue = string | number | boolean | string[] | object | null | undefined;

type VendorQuery = Record<string, VendorQueryValue>;

type VendorFetchOptions<TBody extends object = object, TQuery = unknown> = {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  body?: TBody;
  query?: TQuery;
};

// `body` is constrained to `object` so it serialises through `fetchQuery`
// without unsafe widening; `query` is preserved as `TQuery` (caller-declared
// typed params, e.g. `AdminProductListParams`) and only widened to
// `fetchQuery`'s transport signature at the boundary. Result is narrowed to
// `TResponse` declared by each caller; per review-fix waiver M-01 / L-03
// (2026-05-27) the response narrowing is the boundary cost of the hand-rolled
// facade until `@mercurjs/vendor` ships a typed HTTP client (H-02 deferral).
const vendorFetch = <TResponse, TBody extends object = object, TQuery = unknown>({
  method,
  path,
  body,
  query
}: VendorFetchOptions<TBody, TQuery>) =>
  fetchQuery(path, {
    method,
    body,
    query: query as Record<string, string | number | object> | undefined
  }) as Promise<TResponse>;

export type ProductVariantsListResponse = {
  variants: ExtendedAdminProductVariant[];
  count: number;
  offset: number;
  limit: number;
};

type BatchRemovePromotionRulesReq = {
  rules: string[];
};

/**
 * Story 8.3 typed vendor client singleton.
 *
 * Replicates Story 8.1 Golden PR pattern while preserving the existing
 * vendor-panel auth transport (`fetchQuery`: bearer token + publishable key).
 * Epic 6 Story 6.4 must import this named singleton instead of creating
 * another vendor client instance.
 */
export const mercurVendorClient = {
  products: {
    options: {
      create: (productId: string, payload: HttpTypes.AdminCreateProductOption) =>
        vendorFetch<unknown, HttpTypes.AdminCreateProductOption>({
          method: 'POST',
          path: `/vendor/products/${productId}/options`,
          body: payload
        }),
      update: (productId: string, optionId: string, payload: HttpTypes.AdminUpdateProductOption) =>
        vendorFetch<unknown, HttpTypes.AdminUpdateProductOption>({
          method: 'POST',
          path: `/vendor/products/${productId}/options/${optionId}`,
          body: payload
        }),
      delete: (productId: string, optionId: string) =>
        vendorFetch<unknown>({
          method: 'DELETE',
          path: `/vendor/products/${productId}/options/${optionId}`
        })
    },
    variants: {
      list: (
        productId: string,
        query?: Record<string, string | number | boolean | string[] | object | undefined>
      ) =>
        vendorFetch<ProductVariantsListResponse>({
          method: 'GET',
          path: `/vendor/products/${productId}/variants`,
          query
        }),
      create: (productId: string, payload: HttpTypes.AdminCreateProductVariant) =>
        vendorFetch<unknown, HttpTypes.AdminCreateProductVariant>({
          method: 'POST',
          path: `/vendor/products/${productId}/variants`,
          body: payload
        }),
      update: (
        productId: string,
        variantId: string,
        payload: HttpTypes.AdminUpdateProductVariant | Record<string, unknown>
      ) =>
        vendorFetch<unknown, HttpTypes.AdminUpdateProductVariant | Record<string, unknown>>({
          method: 'POST',
          path: `/vendor/products/${productId}/variants/${variantId}`,
          body: payload
        }),
      delete: (
        productId: string,
        variantId: string
      ): Promise<HttpTypes.AdminProductVariantDeleteResponse> =>
        vendorFetch<HttpTypes.AdminProductVariantDeleteResponse>({
          method: 'DELETE',
          path: `/vendor/products/${productId}/variants/${variantId}`
        })
    },
    retrieve: <TResponse = ExtendedAdminProductResponse>(id: string, query?: VendorQuery) =>
      vendorFetch<TResponse>({
        method: 'GET',
        path: `/vendor/products/${id}`,
        query
      }),
    list: (query?: HttpTypes.AdminProductListParams & { tag_id?: string | string[] }) =>
      vendorFetch<ExtendedAdminProductListResponse>({
        method: 'GET',
        path: '/vendor/products',
        query
      }),
    create: (payload: unknown) =>
      vendorFetch<HttpTypes.AdminProductResponse, object>({
        method: 'POST',
        path: '/vendor/products',
        body: payload as object
      }),
    update: (
      id: string,
      payload: HttpTypes.AdminUpdateProduct & {
        additional_data?: { values: Record<string, string>[] };
      }
    ) =>
      vendorFetch<HttpTypes.AdminProductResponse, typeof payload>({
        method: 'POST',
        path: `/vendor/products/${id}`,
        body: payload
      }),
    delete: (id: string): Promise<HttpTypes.AdminProductDeleteResponse> =>
      vendorFetch<HttpTypes.AdminProductDeleteResponse>({
        method: 'DELETE',
        path: `/vendor/products/${id}`
      }),
    applicableAttributes: (id: string, query?: VendorQuery) =>
      vendorFetch<ProductAttributesResponse>({
        method: 'GET',
        path: `/vendor/products/${id}/applicable-attributes`,
        query: { fields: '+is_required', ...query }
      }),
    export: (
      payload: HttpTypes.AdminExportProductRequest,
      query?: HttpTypes.AdminProductListParams
    ) =>
      vendorFetch<HttpTypes.AdminExportProductResponse & { url: string }, typeof payload>({
        method: 'POST',
        path: '/vendor/products/export',
        body: payload,
        query
      })
  },
  inventoryItems: {
    list: (query?: HttpTypes.AdminInventoryItemsParams) =>
      vendorFetch<HttpTypes.AdminInventoryItemListResponse>({
        method: 'GET',
        path: '/vendor/inventory-items',
        query
      }),
    retrieve: (id: string, query?: VendorQuery) =>
      vendorFetch<HttpTypes.AdminInventoryItemResponse>({
        method: 'GET',
        path: `/vendor/inventory-items/${id}`,
        query
      }),
    update: (id: string, payload: HttpTypes.AdminUpdateInventoryItem) =>
      vendorFetch<HttpTypes.AdminInventoryItemResponse, typeof payload>({
        method: 'POST',
        path: `/vendor/inventory-items/${id}`,
        body: payload
      }),
    delete: (id: string) =>
      vendorFetch<HttpTypes.AdminInventoryItemDeleteResponse>({
        method: 'DELETE',
        path: `/vendor/inventory-items/${id}`
      }),
    locationLevels: {
      list: (inventoryItemId: string, query?: VendorQuery) =>
        // M-02 (review-fix 2026-05-27): `location_levels: any[]` preserved as
        // Deferred:architectural — downstream `ExtendedLocationLevel` /
        // `AdminInventoryLevel` consumer types diverge from the upstream
        // `InventoryItemLocationLevel` shape (stock_locations + created_at /
        // updated_at / deleted_at field-type drift). Tightening here cascades
        // into reservation-edit + location-list table types out-of-scope for
        // Story 8.3; routed to Story 8.3.1 / Sprint 5 hardening.
        vendorFetch<HttpTypes.AdminInventoryLevelListResponse & { location_levels: any[] }>({
          method: 'GET',
          path: `/vendor/inventory-items/${inventoryItemId}/location-levels`,
          query
        }),
      update: (
        inventoryItemId: string,
        locationId: string,
        payload: HttpTypes.AdminUpdateInventoryLevel
      ) =>
        vendorFetch<HttpTypes.AdminInventoryItemResponse, typeof payload>({
          method: 'POST',
          path: `/vendor/inventory-items/${inventoryItemId}/location-levels/${locationId}`,
          body: payload
        }),
      delete: (inventoryItemId: string, locationId: string) =>
        vendorFetch<HttpTypes.AdminInventoryLevelDeleteResponse>({
          method: 'DELETE',
          path: `/vendor/inventory-items/${inventoryItemId}/location-levels/${locationId}`
        }),
      batchForItem: (
        inventoryItemId: string,
        payload: HttpTypes.AdminBatchInventoryItemLocationLevels
      ) =>
        vendorFetch<HttpTypes.AdminBatchInventoryItemLocationLevelsResponse, typeof payload>({
          method: 'POST',
          path: `/vendor/inventory-items/${inventoryItemId}/location-levels/batch`,
          body: payload
        }),
      batch: (payload: HttpTypes.AdminBatchInventoryItemsLocationLevels) =>
        vendorFetch<HttpTypes.AdminBatchInventoryItemsLocationLevelsResponse, typeof payload>({
          method: 'POST',
          path: '/vendor/inventory-items/location-levels/batch',
          body: payload
        })
    }
  },
  customerGroups: {
    retrieve: (id: string, query?: VendorQuery) =>
      vendorFetch<HttpTypes.AdminCustomerGroupResponse>({
        method: 'GET',
        path: `/vendor/customer-groups/${id}`,
        query
      }),
    list: () =>
      vendorFetch<CustomerGroupListResponse>({
        method: 'GET',
        path: '/vendor/customer-groups'
      }),
    create: (payload: HttpTypes.AdminCreateCustomerGroup) =>
      vendorFetch<HttpTypes.AdminCustomerGroupResponse, typeof payload>({
        method: 'POST',
        path: '/vendor/customer-groups',
        body: payload
      }),
    update: (id: string, payload: HttpTypes.AdminUpdateCustomerGroup) =>
      vendorFetch<HttpTypes.AdminCustomerGroupResponse, typeof payload>({
        method: 'POST',
        path: `/vendor/customer-groups/${id}`,
        body: payload
      }),
    delete: (id: string) =>
      vendorFetch<HttpTypes.AdminCustomerGroupDeleteResponse>({
        method: 'DELETE',
        path: `/vendor/customer-groups/${id}`
      }),
    customers: {
      add: (id: string, payload: HttpTypes.AdminBatchLink['add']) =>
        vendorFetch<HttpTypes.AdminCustomerGroupResponse, { add: HttpTypes.AdminBatchLink['add'] }>(
          {
            method: 'POST',
            path: `/vendor/customer-groups/${id}/customers`,
            body: { add: payload }
          }
        ),
      remove: (id: string, payload: HttpTypes.AdminBatchLink['remove']) =>
        vendorFetch<
          HttpTypes.AdminCustomerGroupResponse,
          { remove: HttpTypes.AdminBatchLink['remove'] }
        >({
          method: 'POST',
          path: `/vendor/customer-groups/${id}/customers`,
          body: { remove: payload }
        })
    }
  },
  orders: {
    retrieve: <TResponse = ExtendedAdminOrderResponse>(id: string, query?: VendorQuery) =>
      vendorFetch<TResponse>({
        method: 'GET',
        path: `/vendor/orders/${id}`,
        query
      }),
    commission: (id: string, query?: VendorQuery) =>
      vendorFetch<OrderCommission>({
        method: 'GET',
        path: `/vendor/orders/${id}/commission`,
        query
      }),
    list: (query?: HttpTypes.AdminOrderFilters) =>
      vendorFetch<HttpTypes.AdminOrderListResponse>({
        method: 'GET',
        path: '/vendor/orders',
        query
      }),
    changes: (id: string) =>
      vendorFetch<HttpTypes.AdminOrderChangesResponse>({
        method: 'GET',
        path: `/vendor/orders/${id}/changes`
      }),
    fulfillments: {
      create: (orderId: string, payload: HttpTypes.AdminCreateOrderFulfillment) =>
        vendorFetch<HttpTypes.AdminOrderResponse, typeof payload>({
          method: 'POST',
          path: `/vendor/orders/${orderId}/fulfillments`,
          body: payload
        }),
      createShipment: (
        orderId: string,
        fulfillmentId: string,
        payload: HttpTypes.AdminCreateOrderShipment
      ) =>
        vendorFetch<{ order: HttpTypes.AdminOrder }, typeof payload>({
          method: 'POST',
          path: `/vendor/orders/${orderId}/fulfillments/${fulfillmentId}/shipments`,
          body: payload
        }),
      markAsDelivered: (orderId: string, fulfillmentId: string) =>
        vendorFetch<{ order: HttpTypes.AdminOrder }>({
          method: 'POST',
          path: `/vendor/orders/${orderId}/fulfillments/${fulfillmentId}/mark-as-delivered`
        })
    },
    cancel: (orderId: string) =>
      vendorFetch<HttpTypes.AdminOrderResponse>({
        method: 'POST',
        path: `/vendor/orders/${orderId}/cancel`
      }),
    complete: (orderId: string) =>
      vendorFetch<HttpTypes.AdminOrderResponse>({
        method: 'POST',
        path: `/vendor/orders/${orderId}/complete`
      })
  },
  promotions: {
    retrieve: (id: string) =>
      vendorFetch<HttpTypes.AdminPromotionResponse>({
        method: 'GET',
        path: `/vendor/promotions/${id}`,
        query: { fields: '+status' }
      }),
    rules: (id: string, ruleType: string, query?: HttpTypes.AdminGetPromotionRuleParams) =>
      vendorFetch<HttpTypes.AdminPromotionRuleListResponse>({
        method: 'GET',
        path: `/vendor/promotions/${id}/${ruleType}`,
        query
      }),
    list: (query?: HttpTypes.AdminGetPromotionsParams) =>
      vendorFetch<HttpTypes.AdminPromotionListResponse>({
        method: 'GET',
        path: '/vendor/promotions',
        query
      }),
    ruleAttributes: (ruleType: string, promotionType?: string) =>
      vendorFetch<HttpTypes.AdminRuleAttributeOptionsListResponse>({
        method: 'GET',
        path: `/vendor/promotions/rule-attribute-options/${ruleType}`,
        query: { promotion_type: promotionType }
      }),
    ruleValues: (ruleType: string, ruleValue: string, query?: VendorPromotionRuleValueParams) =>
      vendorFetch<HttpTypes.AdminRuleValueOptionsListResponse>({
        method: 'GET',
        path: `/vendor/promotions/rule-value-options/${ruleType}/${ruleValue}`,
        query
      }),
    delete: (id: string) =>
      vendorFetch<HttpTypes.DeleteResponse<'promotion'>>({
        method: 'DELETE',
        path: `/vendor/promotions/${id}`
      }),
    create: (
      payload: HttpTypes.AdminCreatePromotion & {
        status: 'active' | 'draft' | 'inactive';
      }
    ) =>
      vendorFetch<HttpTypes.AdminPromotionResponse, typeof payload>({
        method: 'POST',
        path: '/vendor/promotions',
        body: payload
      }),
    update: (id: string, payload: HttpTypes.AdminUpdatePromotion) =>
      vendorFetch<HttpTypes.AdminPromotionResponse, typeof payload>({
        method: 'POST',
        path: `/vendor/promotions/${id}`,
        body: payload
      }),
    removeFromCampaign: (promotionId: string) =>
      vendorFetch<HttpTypes.AdminPromotionResponse, { campaign_id: null }>({
        method: 'POST',
        path: `/vendor/promotions/${promotionId}`,
        body: { campaign_id: null }
      }),
    rulesBatch: {
      add: (id: string, ruleType: string, payload: HttpTypes.BatchAddPromotionRulesReq) =>
        vendorFetch<
          HttpTypes.AdminPromotionResponse,
          { create: HttpTypes.BatchAddPromotionRulesReq['rules'] }
        >({
          method: 'POST',
          path: `/vendor/promotions/${id}/${ruleType}/batch`,
          body: { create: payload.rules }
        }),
      remove: (id: string, ruleType: string, payload: BatchRemovePromotionRulesReq) =>
        vendorFetch<
          HttpTypes.AdminPromotionResponse,
          { delete: BatchRemovePromotionRulesReq['rules'] }
        >({
          method: 'POST',
          path: `/vendor/promotions/${id}/${ruleType}/batch`,
          body: { delete: payload.rules }
        }),
      replace: async (
        id: string,
        ruleType: string,
        payload: HttpTypes.BatchUpdatePromotionRulesReq
      ) => {
        const { rules } = await mercurVendorClient.promotions.rules(id, ruleType);
        const ruleIds = rules.map(rule => rule.id);

        await vendorFetch<HttpTypes.AdminPromotionResponse, { delete: string[] }>({
          method: 'POST',
          path: `/vendor/promotions/${id}/${ruleType}/batch`,
          body: { delete: ruleIds }
        });

        return vendorFetch<HttpTypes.AdminPromotionResponse, object>({
          method: 'POST',
          path: `/vendor/promotions/${id}/${ruleType}/batch`,
          body: {
            create: payload.rules.map(rule => ({
              attribute: rule.attribute,
              operator: rule.operator,
              values: rule.values
            }))
          }
        });
      }
    }
  }
} as const;
