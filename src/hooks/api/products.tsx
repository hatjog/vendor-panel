import { FetchError } from '@medusajs/js-sdk';
import { HttpTypes } from '@medusajs/types';
import {
  QueryKey,
  useMutation,
  UseMutationOptions,
  useQuery,
  UseQueryOptions
} from '@tanstack/react-query';

import { importProductsQuery, sdk } from '../../lib/client';
import {
  mercurVendorClient,
  type ProductVariantsListResponse
} from '../../lib/mercur-vendor-client';
import { queryClient } from '../../lib/query-client';
import { queryKeysFactory } from '../../lib/query-key-factory';
import {
  ExtendedAdminProductListResponse,
  ExtendedAdminProductResponse,
  ProductAttributesResponse
} from '../../types/products';
import productsImagesFormatter from '../../utils/products-images-formatter';
import { inventoryItemsQueryKeys } from './inventory.tsx';

const PRODUCTS_QUERY_KEY = 'products' as const;
export const productsQueryKeys = queryKeysFactory(PRODUCTS_QUERY_KEY);

const VARIANTS_QUERY_KEY = 'product_variants' as const;
export const variantsQueryKeys = queryKeysFactory(VARIANTS_QUERY_KEY);

const OPTIONS_QUERY_KEY = 'product_options' as const;
export const optionsQueryKeys = queryKeysFactory(OPTIONS_QUERY_KEY);

const productAttributesQueryKey = (productId: string) => [
  'product',
  productId,
  'product-attributes'
];

export const useCreateProductOption = (
  productId: string,
  options?: UseMutationOptions<any, FetchError, any>
) => {
  return useMutation({
    // migrated via Story 8.3 (FR-Ga.2; pattern from Story 8.1 Golden PR)
    mutationFn: (payload: HttpTypes.AdminCreateProductOption) =>
      mercurVendorClient.products.options.create(productId, payload),
    onSuccess: (data: any, variables: any, context: any) => {
      queryClient.invalidateQueries({
        queryKey: optionsQueryKeys.lists()
      });
      queryClient.invalidateQueries({
        queryKey: productsQueryKeys.detail(productId)
      });
      options?.onSuccess?.(data, variables, context);
    },
    ...options
  });
};

export const useUpdateProductOption = (
  productId: string,
  optionId: string,
  options?: UseMutationOptions<any, FetchError, any>
) => {
  return useMutation({
    mutationFn: (payload: HttpTypes.AdminUpdateProductOption) =>
      mercurVendorClient.products.options.update(productId, optionId, payload),
    onSuccess: (data: any, variables: any, context: any) => {
      queryClient.invalidateQueries({
        queryKey: optionsQueryKeys.lists()
      });
      queryClient.invalidateQueries({
        queryKey: optionsQueryKeys.detail(optionId)
      });
      queryClient.invalidateQueries({
        queryKey: productsQueryKeys.detail(productId)
      });

      options?.onSuccess?.(data, variables, context);
    },
    ...options
  });
};

export const useDeleteProductOption = (
  productId: string,
  optionId: string,
  options?: UseMutationOptions<any, FetchError, void>
) => {
  return useMutation({
    mutationFn: () => mercurVendorClient.products.options.delete(productId, optionId),
    onSuccess: (data: any, variables: any, context: any) => {
      queryClient.invalidateQueries({
        queryKey: optionsQueryKeys.lists()
      });
      queryClient.invalidateQueries({
        queryKey: optionsQueryKeys.detail(optionId)
      });
      queryClient.invalidateQueries({
        queryKey: productsQueryKeys.detail(productId)
      });

      options?.onSuccess?.(data, variables, context);
    },
    ...options
  });
};

export const useProductVariant = (
  productId: string,
  variantId: string,
  query?: HttpTypes.AdminProductVariantParams,
  options?: Omit<
    UseQueryOptions<
      HttpTypes.AdminProductVariantResponse,
      FetchError,
      HttpTypes.AdminProductVariantResponse,
      QueryKey
    >,
    'queryFn' | 'queryKey'
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () => {
      const { product } = await mercurVendorClient.products.retrieve(productId, {
        fields: '*variants,*variants.inventory,*variants.inventory.location_levels'
      });

      const variant = product.variants?.find(
        ({ id }: { id: string }) => id === variantId
      ) as HttpTypes.AdminProductVariant;

      return { variant };
    },
    queryKey: variantsQueryKeys.detail(variantId, query),
    ...options
  });

  return { ...data, ...rest };
};

export const useProductVariants = (
  productId: string,
  query?: Record<string, string | number | boolean | string[] | object | undefined>,
  options?: Omit<
    UseQueryOptions<ProductVariantsListResponse, FetchError, ProductVariantsListResponse, QueryKey>,
    'queryFn' | 'queryKey'
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () => {
      return await mercurVendorClient.products.variants.list(productId, query);
    },
    queryKey: variantsQueryKeys.list({
      productId,
      ...query
    }),
    ...options
  });

  return { ...data, ...rest };
};

export const useCreateProductVariant = (
  productId: string,
  options?: UseMutationOptions<any, FetchError, any>
) => {
  return useMutation({
    mutationFn: (payload: HttpTypes.AdminCreateProductVariant) =>
      mercurVendorClient.products.variants.create(productId, payload),
    onSuccess: (data: any, variables: any, context: any) => {
      queryClient.invalidateQueries({
        queryKey: variantsQueryKeys.lists()
      });
      queryClient.invalidateQueries({
        queryKey: productsQueryKeys.detail(productId)
      });
      options?.onSuccess?.(data, variables, context);
    },
    ...options
  });
};

export const useUpdateProductVariant = (
  productId: string,
  variantId: string,
  options?: UseMutationOptions<any, FetchError, any>
) => {
  return useMutation({
    mutationFn: (body: HttpTypes.AdminUpdateProductVariant) =>
      mercurVendorClient.products.variants.update(productId, variantId, body),
    onSuccess: (data: any, variables: any, context: any) => {
      queryClient.invalidateQueries({
        queryKey: variantsQueryKeys.lists()
      });
      queryClient.invalidateQueries({
        queryKey: variantsQueryKeys.detail(variantId)
      });
      queryClient.invalidateQueries({
        queryKey: productsQueryKeys.detail(productId)
      });

      options?.onSuccess?.(data, variables, context);
    },
    ...options
  });
};

// TODO: Change this to use endpoint that updates multiple variants at once
export const useUpdateProductVariantsBatch = (
  productId: string,
  options?: UseMutationOptions<any, FetchError, any>
) => {
  return useMutation({
    mutationFn: async (variants: Array<{ id: string; [key: string]: any }>) => {
      const promises = variants.map(variant => {
        const { id, ...updateData } = variant;
        return mercurVendorClient.products.variants.update(productId, id, updateData);
      });

      return Promise.all(promises);
    },
    onSuccess: (data: any, variables: any, context: any) => {
      options?.onSuccess?.(data, variables, context);
    },
    ...options
  });
};

export const useProductVariantsInventoryItemsBatch = (
  productId: string,
  options?: UseMutationOptions<
    HttpTypes.AdminBatchProductVariantInventoryItemResponse,
    FetchError,
    HttpTypes.AdminBatchProductVariantInventoryItemRequest
  >
) => {
  return useMutation({
    mutationFn: payload => sdk.admin.product.batchVariantInventoryItems(productId, payload),
    onSuccess: (data: any, variables: any, context: any) => {
      queryClient.invalidateQueries({
        queryKey: variantsQueryKeys.lists()
      });
      queryClient.invalidateQueries({
        queryKey: variantsQueryKeys.details()
      });
      queryClient.invalidateQueries({
        queryKey: productsQueryKeys.detail(productId)
      });

      options?.onSuccess?.(data, variables, context);
    },
    ...options
  });
};

export const useDeleteVariant = (
  productId: string,
  variantId: string,
  options?: UseMutationOptions<any, FetchError, void>
) => {
  return useMutation({
    mutationFn: () => mercurVendorClient.products.variants.delete(productId, variantId),
    onSuccess: (data: any, variables: any, context: any) => {
      queryClient.invalidateQueries({
        queryKey: variantsQueryKeys.lists()
      });
      queryClient.invalidateQueries({
        queryKey: variantsQueryKeys.detail(variantId)
      });
      queryClient.invalidateQueries({
        queryKey: productsQueryKeys.detail(productId)
      });

      options?.onSuccess?.(data, variables, context);
    },
    ...options
  });
};

export const useDeleteVariantLazy = (
  productId: string,
  options?: UseMutationOptions<
    HttpTypes.AdminProductVariantDeleteResponse,
    FetchError,
    { variantId: string }
  >
) => {
  return useMutation({
    mutationFn: ({ variantId }) =>
      mercurVendorClient.products.variants.delete(productId, variantId),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: variantsQueryKeys.lists()
      });
      queryClient.invalidateQueries({
        queryKey: variantsQueryKeys.detail(variables.variantId)
      });
      queryClient.invalidateQueries({
        queryKey: productsQueryKeys.detail(productId)
      });

      options?.onSuccess?.(data, variables, context);
    },
    ...options
  });
};

export const useProductAttributes = (id: string) => {
  const { data, ...rest } = useQuery<ProductAttributesResponse>({
    queryFn: () => mercurVendorClient.products.applicableAttributes(id),
    queryKey: productAttributesQueryKey(id)
  });

  return { ...data, ...rest };
};

export const useProduct = (
  id: string,
  query?: Record<string, any>,
  options?: Omit<
    UseQueryOptions<
      ExtendedAdminProductResponse,
      FetchError,
      ExtendedAdminProductResponse,
      QueryKey
    >,
    'queryFn' | 'queryKey'
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () => {
      const response = await mercurVendorClient.products.retrieve(id, query);

      return {
        ...response,
        product: productsImagesFormatter(response.product)
      } as ExtendedAdminProductResponse;
    },
    queryKey: productsQueryKeys.detail(id, query),
    ...options
  });

  return {
    ...data,
    ...rest
  };
};

export const useProducts = (
  query?: HttpTypes.AdminProductListParams & { tag_id?: string | string[] },
  options?: Omit<
    UseQueryOptions<
      ExtendedAdminProductListResponse,
      FetchError,
      ExtendedAdminProductListResponse,
      QueryKey
    >,
    'queryFn' | 'queryKey'
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () => mercurVendorClient.products.list(query),
    queryKey: productsQueryKeys.list(query),
    ...options
  });

  return { ...data, ...rest };
};

export const useCreateProduct = (
  options?: UseMutationOptions<HttpTypes.AdminProductResponse, FetchError, any>
) => {
  return useMutation({
    mutationFn: async payload => await mercurVendorClient.products.create(payload),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: productsQueryKeys.lists()
      });
      queryClient.invalidateQueries({
        queryKey: inventoryItemsQueryKeys.lists()
      });
      options?.onSuccess?.(data, variables, context);
    },
    ...options
  });
};

export const useUpdateProduct = (
  id: string,
  options?: UseMutationOptions<
    HttpTypes.AdminProductResponse,
    FetchError,
    HttpTypes.AdminUpdateProduct & { additional_data?: { values: Record<string, string>[] } }
  >
) => {
  return useMutation({
    mutationFn: async payload => {
      return mercurVendorClient.products.update(id, payload);
    },
    onSuccess: async (data, variables, context) => {
      await queryClient.invalidateQueries({
        queryKey: productsQueryKeys.lists()
      });
      await queryClient.invalidateQueries({
        queryKey: productsQueryKeys.detail(id)
      });
      await queryClient.invalidateQueries({
        queryKey: productAttributesQueryKey(id)
      });

      options?.onSuccess?.(data, variables, context);
    },
    ...options
  });
};

export const useDeleteProduct = (
  id: string,
  options?: UseMutationOptions<HttpTypes.AdminProductDeleteResponse, FetchError, void>
) => {
  return useMutation({
    mutationFn: () => mercurVendorClient.products.delete(id),
    onSuccess: (data: any, variables: any, context: any) => {
      queryClient.invalidateQueries({
        queryKey: productsQueryKeys.lists()
      });
      queryClient.invalidateQueries({
        queryKey: productsQueryKeys.detail(id)
      });

      options?.onSuccess?.(data, variables, context);
    },
    ...options
  });
};

export const useBulkDeleteProducts = (
  options?: UseMutationOptions<HttpTypes.AdminProductDeleteResponse[], FetchError, string[]>
) => {
  return useMutation({
    mutationFn: async (productIds: string[]) => {
      const deletePromises = productIds.map(id => mercurVendorClient.products.delete(id));
      return Promise.all(deletePromises);
    },
    onSuccess: (data: any, variables: any, context: any) => {
      queryClient.invalidateQueries({
        queryKey: productsQueryKeys.lists()
      });

      variables.forEach((id: string) => {
        queryClient.invalidateQueries({
          queryKey: productsQueryKeys.detail(id)
        });
      });

      options?.onSuccess?.(data, variables, context);
    },
    ...options
  });
};

export const useExportProducts = (
  query?: HttpTypes.AdminProductListParams,
  options?: UseMutationOptions<
    HttpTypes.AdminExportProductResponse & { url: string },
    FetchError,
    HttpTypes.AdminExportProductRequest
  >
) => {
  return useMutation({
    mutationFn: payload => mercurVendorClient.products.export(payload, query),
    onSuccess: (data, variables, context) => {
      options?.onSuccess?.(data, variables, context);
    },
    ...options
  });
};

export const useImportProducts = (
  options?: UseMutationOptions<
    HttpTypes.AdminImportProductResponse,
    FetchError,
    HttpTypes.AdminImportProductRequest
  >
) => {
  return useMutation({
    mutationFn: payload => importProductsQuery(payload.file),
    onSuccess: (data, variables, context) => {
      options?.onSuccess?.(data, variables, context);
    },
    ...options
  });
};

export const useConfirmImportProducts = (options?: UseMutationOptions<{}, FetchError, string>) => {
  return useMutation({
    mutationFn: payload => sdk.admin.product.confirmImport(payload),
    onSuccess: (data, variables, context) => {
      options?.onSuccess?.(data, variables, context);
    },
    ...options
  });
};
