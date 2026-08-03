import { FetchError } from '@medusajs/js-sdk';
import { HttpTypes } from '@medusajs/types';
import {
  QueryKey,
  useMutation,
  UseMutationOptions,
  useQuery,
  UseQueryOptions
} from '@tanstack/react-query';

import { mercurVendorClient } from '../../lib/mercur-vendor-client';
import { queryClient } from '../../lib/query-client';
import { queryKeysFactory } from '../../lib/query-key-factory';
import { VendorPromotionRuleValueParams } from '../../types/promotion';
import { campaignsQueryKeys } from './campaigns';

const PROMOTIONS_QUERY_KEY = 'promotions' as const;

export const promotionsQueryKeys = {
  ...queryKeysFactory(PROMOTIONS_QUERY_KEY),
  // TODO: handle invalidations properly
  listRules: (
    id: string | null,
    ruleType: string,
    query?: HttpTypes.AdminGetPromotionRuleParams
  ) => [PROMOTIONS_QUERY_KEY, id, ruleType, query],
  listRuleAttributes: (ruleType: string, promotionType?: string) => [
    PROMOTIONS_QUERY_KEY,
    ruleType,
    promotionType
  ],
  listRuleValues: (ruleType: string, ruleValue: string, query: VendorPromotionRuleValueParams) => [
    PROMOTIONS_QUERY_KEY,
    ruleType,
    ruleValue,
    query
  ]
};

export const usePromotion = (
  id: string,
  options?: Omit<
    UseQueryOptions<
      HttpTypes.AdminPromotionResponse,
      FetchError,
      HttpTypes.AdminPromotionResponse,
      QueryKey
    >,
    'queryFn' | 'queryKey'
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: promotionsQueryKeys.detail(id),
    // migrated via Story 8.3 (FR-Ga.2; pattern from Story 8.1 Golden PR)
    queryFn: async () => mercurVendorClient.promotions.retrieve(id),
    ...options
  });

  return { ...data, ...rest };
};

export const usePromotionRules = (
  id: string | null,
  ruleType: string,
  query?: HttpTypes.AdminGetPromotionRuleParams,
  options?: Omit<
    UseQueryOptions<
      HttpTypes.AdminPromotionRuleListResponse,
      FetchError,
      HttpTypes.AdminPromotionRuleListResponse,
      QueryKey
    >,
    'queryFn' | 'queryKey'
  >
) => {
  if (!id) {
    return {
      rules: [],
      isLoading: false
    };
  }

  const { data, ...rest } = useQuery({
    queryKey: promotionsQueryKeys.listRules(id, ruleType, query),
    queryFn: async () => mercurVendorClient.promotions.rules(id, ruleType, query),
    ...options
  });

  return { ...data, ...rest };
};

export const usePromotions = (
  query?: HttpTypes.AdminGetPromotionsParams,
  options?: Omit<
    UseQueryOptions<
      HttpTypes.AdminPromotionListResponse,
      FetchError,
      HttpTypes.AdminPromotionListResponse,
      QueryKey
    >,
    'queryFn' | 'queryKey'
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: promotionsQueryKeys.list(query),
    queryFn: async () => mercurVendorClient.promotions.list(query),
    ...options
  });

  return { ...data, ...rest };
};

export const usePromotionRuleAttributes = (
  ruleType: string,
  promotionType?: string,
  options?: Omit<
    UseQueryOptions<
      HttpTypes.AdminRuleAttributeOptionsListResponse,
      FetchError,
      HttpTypes.AdminRuleAttributeOptionsListResponse,
      QueryKey
    >,
    'queryFn' | 'queryKey'
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: promotionsQueryKeys.listRuleAttributes(ruleType, promotionType),
    queryFn: async () => mercurVendorClient.promotions.ruleAttributes(ruleType, promotionType),
    ...options
  });

  return { ...data, ...rest };
};

export const usePromotionRuleValues = (
  ruleType: string,
  ruleValue: string,
  query?: VendorPromotionRuleValueParams,
  options?: Omit<
    UseQueryOptions<
      HttpTypes.AdminRuleValueOptionsListResponse,
      FetchError,
      HttpTypes.AdminRuleValueOptionsListResponse,
      QueryKey
    >,
    'queryFn' | 'queryKey'
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: promotionsQueryKeys.listRuleValues(ruleType, ruleValue, query || {}),
    queryFn: async () => await mercurVendorClient.promotions.ruleValues(ruleType, ruleValue, query),
    ...options
  });

  return { ...data, ...rest };
};

export const useDeletePromotion = (
  id: string,
  options?: UseMutationOptions<HttpTypes.DeleteResponse<'promotion'>, FetchError, void>
) => {
  return useMutation({
    mutationFn: () => mercurVendorClient.promotions.delete(id),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: promotionsQueryKeys.lists()
      });
      queryClient.invalidateQueries({
        queryKey: promotionsQueryKeys.detail(id)
      });

      options?.onSuccess?.(data, variables, context);
    },
    ...options
  });
};

export const useCreatePromotion = (
  options?: UseMutationOptions<
    HttpTypes.AdminPromotionResponse,
    FetchError,
    HttpTypes.AdminCreatePromotion & { status: 'active' | 'draft' | 'inactive' }
  >
) => {
  return useMutation({
    mutationFn: payload => mercurVendorClient.promotions.create(payload),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: promotionsQueryKeys.lists()
      });
      queryClient.invalidateQueries({
        queryKey: campaignsQueryKeys.lists()
      });
      options?.onSuccess?.(data, variables, context);
    },
    ...options
  });
};

export const useUpdatePromotion = (
  id: string,
  options?: UseMutationOptions<
    HttpTypes.AdminPromotionResponse,
    FetchError,
    HttpTypes.AdminUpdatePromotion
  >
) => {
  return useMutation({
    mutationFn: payload => mercurVendorClient.promotions.update(id, payload),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: promotionsQueryKeys.all
      });
      queryClient.invalidateQueries({
        queryKey: campaignsQueryKeys.details()
      });
      queryClient.invalidateQueries({
        queryKey: campaignsQueryKeys.lists()
      });

      options?.onSuccess?.(data, variables, context);
    },
    ...options
  });
};

export const useRemovePromotionFromCampaign = (
  promotionId: string,
  options?: UseMutationOptions<HttpTypes.AdminPromotionResponse, FetchError, void>
) => {
  return useMutation({
    mutationFn: () => mercurVendorClient.promotions.removeFromCampaign(promotionId),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: promotionsQueryKeys.all
      });
      queryClient.invalidateQueries({
        queryKey: campaignsQueryKeys.details()
      });
      queryClient.invalidateQueries({
        queryKey: campaignsQueryKeys.lists()
      });

      options?.onSuccess?.(data, variables, context);
    },
    ...options
  });
};

export const usePromotionAddRules = (
  id: string,
  ruleType: string,
  options?: UseMutationOptions<
    HttpTypes.AdminPromotionResponse,
    FetchError,
    HttpTypes.BatchAddPromotionRulesReq
  >
) => {
  return useMutation({
    mutationFn: payload => mercurVendorClient.promotions.rulesBatch.add(id, ruleType, payload),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: promotionsQueryKeys.all
      });

      options?.onSuccess?.(data, variables, context);
    },
    ...options
  });
};

type BatchRemovePromotionRulesReq = {
  rules: string[];
};

export const usePromotionRemoveRules = (
  id: string,
  ruleType: string,
  options?: UseMutationOptions<
    HttpTypes.AdminPromotionResponse,
    FetchError,
    BatchRemovePromotionRulesReq
  >
) => {
  return useMutation({
    mutationFn: payload => mercurVendorClient.promotions.rulesBatch.remove(id, ruleType, payload),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: promotionsQueryKeys.all
      });

      options?.onSuccess?.(data, variables, context);
    },
    ...options
  });
};

export const usePromotionUpdateRules = (
  id: string,
  ruleType: string,
  options?: UseMutationOptions<
    HttpTypes.AdminPromotionResponse,
    FetchError,
    HttpTypes.BatchUpdatePromotionRulesReq
  >
) => {
  return useMutation({
    mutationFn: async payload =>
      mercurVendorClient.promotions.rulesBatch.replace(id, ruleType, payload),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: promotionsQueryKeys.all
      });

      options?.onSuccess?.(data, variables, context);
    },
    ...options
  });
};
