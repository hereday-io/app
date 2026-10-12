import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CrmError, NON_RETRYABLE, crmRpc } from '@/lib/crm/rpc';
import type { Deal, DealDetail, Signup, SignupScope, StaffMember } from '@/lib/crm/types';

/**
 * React Query hooks for the CRM — the first feature to use the
 * QueryClientProvider that App.tsx already mounts. Every key starts with
 * 'crm', so one invalidation after any write refreshes the list, the open
 * deal and the signups queue together.
 */

const retry = (count: number, error: CrmError) =>
  !(error instanceof CrmError && NON_RETRYABLE.includes(error.code)) && count < 2;

export const crmKeys = {
  all: ['crm'] as const,
  deals: (includeClosed: boolean) => ['crm', 'deals', { includeClosed }] as const,
  deal: (slug: string) => ['crm', 'deal', slug] as const,
  staff: ['crm', 'staff'] as const,
  signups: (scope: SignupScope) => ['crm', 'signups', scope] as const,
};

export const useDeals = (includeClosed: boolean) =>
  useQuery<Deal[], CrmError>({
    queryKey: crmKeys.deals(includeClosed),
    queryFn: () => crmRpc<Deal[]>('crm_list_deals', { p_include_closed: includeClosed }),
    retry,
    staleTime: 30_000,
  });

export const useDeal = (slug: string | null) =>
  useQuery<DealDetail, CrmError>({
    queryKey: crmKeys.deal(slug ?? ''),
    enabled: !!slug,
    queryFn: () => crmRpc<DealDetail>('crm_get_deal', { p_slug: slug }),
    retry,
  });

export const useStaff = () =>
  useQuery<StaffMember[], CrmError>({
    queryKey: crmKeys.staff,
    queryFn: () => crmRpc<StaffMember[]>('crm_list_staff'),
    retry,
    staleTime: 5 * 60_000,
  });

export const useSignups = (scope: SignupScope, enabled: boolean) =>
  useQuery<Signup[], CrmError>({
    queryKey: crmKeys.signups(scope),
    enabled,
    queryFn: () => crmRpc<Signup[]>('crm_list_signups', { p_scope: scope }),
    retry,
  });

/**
 * One mutation per RPC. Writes are never retried automatically: a claim
 * or a logged send must not happen twice.
 */
export const useCrmAction = <TResult = unknown, TArgs extends Record<string, unknown> = Record<string, unknown>>(
  rpcName: string,
) => {
  const queryClient = useQueryClient();
  return useMutation<TResult, CrmError, TArgs>({
    mutationFn: (args) => crmRpc<TResult>(rpcName, args),
    retry: false,
    onSettled: () => queryClient.invalidateQueries({ queryKey: crmKeys.all }),
  });
};
