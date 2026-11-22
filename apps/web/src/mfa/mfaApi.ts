/**
 * The second factor as the browser sees it (`spec/totp.md` §4, §8; ADR-260).
 *
 * One module for the account screen and the console, because both ask the same server:
 * `GET /account/mfa` is the only read, and every change names a password or a code.
 * Nothing here ever receives the secret after `begin`.
 */
import { call } from "../apiCall";

export interface MfaStatus {
  enrolled: boolean;
  pending: boolean;
  confirmedAt: string | null;
  recoveryLeft: number;
  /** The entry's name in the authenticator; differs between clouds (§2). */
  issuer?: string;
}

export interface MfaEnrollmentStart {
  secret: string;
  uri: string;
}

export const mfaApi = {
  status: () => call<MfaStatus>("/account/mfa"),
  /** Shown once: the Base32 key and the `otpauth://` line (§4.2). */
  begin: (password: string) =>
    call<MfaEnrollmentStart>("/account/mfa/begin", { method: "POST", body: { password } }),
  /** Confirm with the first code; the answer carries the ten recovery codes once (§4.3–4). */
  confirm: (code: string) =>
    call<{ confirmedAt: string; recoveryCodes: string[] }>("/account/mfa/confirm", {
      method: "POST",
      body: { code },
    }),
  /** A new list replaces the old one in the same transaction (§4). */
  regenerate: (code: string) =>
    call<{ recoveryCodes: string[] }>("/account/mfa/recovery", {
      method: "POST",
      body: { code },
    }),
  disable: (code: string) =>
    call<{ ok: true }>("/account/mfa/disable", { method: "POST", body: { code } }),
};
