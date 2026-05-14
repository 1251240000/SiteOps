'use client';

import {
  useMutation,
  useQuery,
  type UseMutationOptions,
  type UseQueryOptions,
} from '@tanstack/react-query';

import { api, type ApiError, type ApiRequestInit, type ApiSuccess } from '@/lib/api-client';

/**
 * Generic GET hook. Returns the `data` field of the API envelope so the
 * component never has to unwrap `{ data, meta }`. If you need `meta`, use
 * `useQuery` directly with `apiFetch`.
 */
export function useApi<T>(
  path: string,
  options: {
    query?: ApiRequestInit['query'];
    enabled?: boolean;
    queryOptions?: Omit<
      UseQueryOptions<ApiSuccess<T>, ApiError, T>,
      'queryKey' | 'queryFn' | 'select'
    >;
  } = {},
) {
  return useQuery<ApiSuccess<T>, ApiError, T>({
    queryKey: ['api', path, options.query ?? null],
    queryFn: () => api.get<T>(path, { query: options.query }),
    enabled: options.enabled,
    select: (envelope) => envelope.data,
    ...options.queryOptions,
  });
}

export type UseApiMutationOptions<TInput, TData> = Omit<
  UseMutationOptions<ApiSuccess<TData>, ApiError, TInput>,
  'mutationFn'
>;

/** Convenience: POST `body` to `path`. */
export function useApiPost<TInput, TData = unknown>(
  path: string,
  options: UseApiMutationOptions<TInput, TData> = {},
) {
  return useMutation<ApiSuccess<TData>, ApiError, TInput>({
    mutationFn: (input) => api.post<TData>(path, input),
    ...options,
  });
}

/** Convenience: PATCH `body` to `path`. */
export function useApiPatch<TInput, TData = unknown>(
  path: string,
  options: UseApiMutationOptions<TInput, TData> = {},
) {
  return useMutation<ApiSuccess<TData>, ApiError, TInput>({
    mutationFn: (input) => api.patch<TData>(path, input),
    ...options,
  });
}

export { ApiError } from '@/lib/api-client';
