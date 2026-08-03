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
import { filterCustomerGroups } from '../../routes/orders/common/customerGroupFiltering';
import { CustomerGroupListResponse } from '../../types/customer-group';
import { customersQueryKeys } from './customers';

const CUSTOMER_GROUPS_QUERY_KEY = 'customer_groups' as const;
export const customerGroupsQueryKeys = queryKeysFactory(CUSTOMER_GROUPS_QUERY_KEY);

export const useCustomerGroup = (
  id: string,
  query?: Record<string, string | number>,
  options?: Omit<
    UseQueryOptions<
      HttpTypes.AdminCustomerGroupResponse,
      FetchError,
      HttpTypes.AdminCustomerGroupResponse,
      QueryKey
    >,
    'queryFn' | 'queryKey'
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: customerGroupsQueryKeys.detail(id, query),
    // migrated via Story 8.3 (FR-Ga.2; pattern from Story 8.1 Golden PR)
    queryFn: async () => mercurVendorClient.customerGroups.retrieve(id, query),
    ...options
  });

  return { ...data, ...rest };
};

export const useCustomerGroups = (
  query?: HttpTypes.AdminGetCustomerGroupsParams,
  options?: Omit<
    UseQueryOptions<
      HttpTypes.AdminGetCustomerGroupsParams,
      FetchError,
      CustomerGroupListResponse,
      QueryKey
    >,
    'queryFn' | 'queryKey'
  >,
  filters?: any
) => {
  const { data, ...rest } = useQuery({
    queryFn: () => mercurVendorClient.customerGroups.list(),
    queryKey: customerGroupsQueryKeys.list(query),
    ...options
  });

  const filteredData = filterCustomerGroups(data?.customer_groups, filters, filters?.sort);

  const customer_groups = filteredData?.filter(item => item.customer_group);

  const count = customer_groups?.length || 0;

  return {
    ...rest,
    count,
    customer_groups,
    offset: data?.offset,
    limit: data?.limit
  };
};

export const useCreateCustomerGroup = (
  options?: UseMutationOptions<
    HttpTypes.AdminCustomerGroupResponse,
    FetchError,
    HttpTypes.AdminCreateCustomerGroup
  >
) => {
  return useMutation({
    mutationFn: payload => mercurVendorClient.customerGroups.create(payload),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: customerGroupsQueryKeys.lists()
      });
      options?.onSuccess?.(data, variables, context);
    },
    ...options
  });
};

export const useUpdateCustomerGroup = (
  id: string,
  options?: UseMutationOptions<
    HttpTypes.AdminCustomerGroupResponse,
    FetchError,
    HttpTypes.AdminUpdateCustomerGroup
  >
) => {
  return useMutation({
    mutationFn: payload => mercurVendorClient.customerGroups.update(id, payload),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: customerGroupsQueryKeys.lists()
      });
      queryClient.invalidateQueries({
        queryKey: customerGroupsQueryKeys.detail(id)
      });

      options?.onSuccess?.(data, variables, context);
    },
    ...options
  });
};

export const useDeleteCustomerGroup = (
  id: string,
  options?: UseMutationOptions<HttpTypes.AdminCustomerGroupDeleteResponse, FetchError, void>
) => {
  return useMutation({
    mutationFn: () => mercurVendorClient.customerGroups.delete(id),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: customerGroupsQueryKeys.lists()
      });
      queryClient.invalidateQueries({
        queryKey: customerGroupsQueryKeys.detail(id)
      });

      options?.onSuccess?.(data, variables, context);
    },
    ...options
  });
};

export const useDeleteCustomerGroupLazy = (
  options?: UseMutationOptions<
    HttpTypes.AdminCustomerGroupDeleteResponse,
    FetchError,
    { id: string }
  >
) => {
  return useMutation({
    mutationFn: ({ id }) => mercurVendorClient.customerGroups.delete(id),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: customerGroupsQueryKeys.lists()
      });
      queryClient.invalidateQueries({
        queryKey: customerGroupsQueryKeys.detail(variables.id)
      });

      options?.onSuccess?.(data, variables, context);
    },
    ...options
  });
};

export const useAddCustomersToGroup = (
  id: string,
  options?: UseMutationOptions<
    HttpTypes.AdminCustomerGroupResponse,
    FetchError,
    HttpTypes.AdminBatchLink['add']
  >
) => {
  return useMutation({
    mutationFn: payload => mercurVendorClient.customerGroups.customers.add(id, payload),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: customerGroupsQueryKeys.lists()
      });
      queryClient.invalidateQueries({
        queryKey: customerGroupsQueryKeys.detail(id)
      });
      queryClient.invalidateQueries({
        queryKey: customersQueryKeys.lists()
      });

      options?.onSuccess?.(data, variables, context);
    },
    ...options
  });
};

export const useRemoveCustomersFromGroup = (
  id: string,
  options?: UseMutationOptions<
    HttpTypes.AdminCustomerGroupResponse,
    FetchError,
    HttpTypes.AdminBatchLink['remove']
  >
) => {
  return useMutation({
    mutationFn: payload => mercurVendorClient.customerGroups.customers.remove(id, payload),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: customerGroupsQueryKeys.lists()
      });
      queryClient.invalidateQueries({
        queryKey: customerGroupsQueryKeys.detail(id)
      });
      queryClient.invalidateQueries({
        queryKey: customersQueryKeys.lists()
      });

      options?.onSuccess?.(data, variables, context);
    },
    ...options
  });
};
