/**
 * The two halves of sign-in (`spec/totp.md` §5, ADR-260).
 *
 * A password may open a session or, when the account has a factor, only a challenge;
 * the second call spends that challenge. Kept beside `api.ts` so the surface there stays
 * one list of product calls and this pair carries the union type a caller must narrow.
 */
import { call } from "./apiCall";
import type { SessionUser } from "./sessionUser";

export type LoginResult =
  | { user: SessionUser; mfaRequired?: false }
  | { user?: undefined; mfaRequired: true; challenge: string; expiresAt?: string };

export const authApi = {
  login: (body: { email: string; password: string }) =>
    call<LoginResult>("/auth/login", { method: "POST", body }),
  /** The second step: a TOTP code or one recovery code, never both. */
  loginMfa: (body: { challenge: string; code?: string; recoveryCode?: string }) =>
    call<{ user: SessionUser; recoveryLeft?: number }>("/auth/login/mfa", {
      method: "POST",
      body,
    }),
};
