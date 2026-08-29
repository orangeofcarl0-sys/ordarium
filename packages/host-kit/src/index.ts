/**
 * The versioned host adapter kit (G18): the first-class entry for
 * third-party host adapters. Curated re-exports only — the contract
 * handshake, the port types a host maps its tool calls onto, the error base
 * hosts classify with, and the portable conformance runner. The kit is an
 * entry, not a wall: nothing stops a host from importing @ordarium/core
 * directly. No Palimpsest-shaped or host-specific fields live here
 * (COMPAT-PAL-001 discipline).
 */

export {
  HOST_CONTRACT_VERSION,
  assertHostContract,
  HostContractMismatchError,
  OrdariumError,
} from "@ordarium/core";

export type {
  Action,
  AuthorizationDecision,
  HostInvocation,
  HostInvocationPort,
  InvocationIdentity,
  ProviderPrincipalRef,
} from "@ordarium/core";

export { HostAdapterHarness, runHostAdapterConformance } from "@ordarium/testing";

export type { HostAdapterHarnessOptions, HostHarnessCallOptions } from "@ordarium/testing";
