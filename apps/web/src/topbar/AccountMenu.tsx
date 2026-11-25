import { Avatar, Button, Icon, Input, Popover } from "@remo/ui";
import { useEffect, useState } from "react";
import type { Presence } from "@remo/doc";
import { api, ApiError, type SessionUser } from "../api";
import { authCapabilities, resendVerification } from "../apiMail";
import { useSupportSurface } from "../SupportPanel";
import { useI18n, type Lang } from "../i18n";
import { docsHref } from "../docsLinks";
import { useConsent } from "../ConsentProvider";
import { aboutLabel } from "../about";
import { useMenuFocus } from "../useMenuFocus";
import { resetHints } from "../hints";
import { AccountDeletionDialog } from "../AccountDeletion";
import type { DeletionSchedule } from "../accountDeletionApi";
import { SecurityDialog } from "../mfa/SecurityDialog";
import { GuestNameNotice } from "../legal/GuestNameNotice";
import { commandGroup, menuCommands, type ChromeContext } from "../commands";
import { useChromeSurfaceRegistration } from "../chromeSurfaces";
import type { Theme } from "../useTheme";

/**
 * The account menu (ADR-266 §2): who I am here, and everything that is about me.
 *
 * Theme, language, all rooms and help moved here from the header's right edge; the
 * rows themselves come from the chrome registry, so this menu and the command search
 * cannot disagree. The name fields stay fields: editing a name is not a command.
 */
export function AccountMenu({
  open,
  onOpen,
  name,
  handle,
  self,
  color,
  signedIn,
  emailVerified,
  roleLine,
  identityName,
  onRenameSelf,
  onAccountRenamed,
  onSessions,
  onSignIn,
  onSignOut,
  onAllRooms,
  onOrg,
  theme,
  setTheme,
  calm,
  setCalm,
  lang,
  setLang,
  /** Below 900 px the header hides Agent and Comments; the menu carries them. */
  narrow = false,
  agentAvailable = false,
  /** The home still has the two interface toggles next to the account (ADR-194). */
  withView = true,
  onAgent,
  onComments,
  /** A room passes this; the search exists only where there is a board to search in. */
  onSearch,
  /** The home needs the date to keep its banner after the account stops working. */
  onDeleteScheduled,
  onDeleteCancelled,
}: {
  open: boolean;
  onOpen: (value: boolean) => void;
  /** The display name for the tooltip and the face. */
  name: string;
  handle: string;
  /** This person in the presence list, when the room shows people at all. */
  self: Presence | undefined;
  /** The cursor colour: the face and the pointer of one person must match. */
  color: string;
  signedIn: boolean;
  /** `false` shows the "Confirm your email" row when the server can send mail. */
  emailVerified?: boolean;
  roleLine: string | null;
  identityName: string;
  onRenameSelf: (value: string) => void;
  onAccountRenamed: (user: SessionUser) => void;
  onSessions: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
  /** Close the menu and go to the room list (the room screen) or stay (the home). */
  onAllRooms: () => void;
  onOrg: () => void;
  theme: Theme;
  setTheme: (value: Theme) => void;
  calm: boolean;
  setCalm: (value: boolean) => void;
  lang: Lang;
  setLang: (value: Lang) => void;
  narrow?: boolean;
  agentAvailable?: boolean;
  withView?: boolean;
  onAgent?: () => void;
  onComments?: () => void;
  /** The argument is the control to return focus to after the search closes. */
  onSearch?: (returnTo: HTMLElement | null) => void;
  onDeleteScheduled?: (schedule: DeletionSchedule) => void;
  onDeleteCancelled?: () => void;
}) {
  const { t, productName, docsOrigin } = useI18n();
  const { openSettings: openCookieSettings } = useConsent();
  const anchor = useMenuFocus(open, true, ".rm-popover input");
  const [nameDraft, setNameDraft] = useState(name);
  const [handleDraft, setHandleDraft] = useState(handle);
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameSaved, setNameSaved] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [securityOpen, setSecurityOpen] = useState(false);

  // Support is a server fact (ADR-250): the menu learns it when it opens, and a 404 in
  // `none` mode simply means no entry. The surface opens the operator's page for `link`
  // and mounts the isolated frame for `chatwoot`; nothing here guesses a provider.
  const support = useSupportSurface({ active: open && signedIn });

  useEffect(() => setNameDraft(name), [name]);
  useEffect(() => setHandleDraft(handle), [handle]);

  const [mailEnabled, setMailEnabled] = useState(false);
  const [resendState, setResendState] = useState<"idle" | "busy" | "sent" | "already" | "error" | "rate">("idle");

  // The row exists only when the address is unconfirmed and the installation can write.
  useEffect(() => {
    if (!open) return;
    setResendState("idle");
    if (!signedIn || emailVerified !== false) {
      setMailEnabled(false);
      return;
    }
    let alive = true;
    authCapabilities()
      .then((result) => {
        if (alive) setMailEnabled(result.mail);
      })
      .catch(() => {
        if (alive) setMailEnabled(false);
      });
    return () => {
      alive = false;
    };
  }, [open, signedIn, emailVerified]);

  const resendVerificationLetter = async () => {
    setResendState("busy");
    try {
      const result = await resendVerification();
      setResendState(result.alreadyVerified ? "already" : "sent");
    } catch (failure) {
      const code = failure instanceof ApiError ? failure.code : "";
      setResendState(code === "RATE_LIMITED" ? "rate" : "error");
    }
  };

  const saveName = async () => {
    const next = nameDraft.trim();
    const nextHandle = handleDraft.trim().toLowerCase();
    if (!next || !nextHandle || savingName) return;
    if (next === name && nextHandle === handle) return;
    setSavingName(true);
    setNameError(null);
    setNameSaved(false);
    try {
      const result = await api.renameAccount({ name: next, handle: nextHandle });
      onAccountRenamed(result.user);
      setNameSaved(true);
    } catch (failure) {
      const code = failure instanceof ApiError ? failure.code : "";
      setNameError(
        code === "HANDLE_TAKEN"
          ? t("account.handleTaken")
          : code === "BAD_HANDLE" || code === "HANDLE_TOO_SHORT" || code === "HANDLE_TOO_LONG" || code === "HANDLE_RESERVED"
            ? t("account.handleInvalid")
            : t("account.nameFailed"),
      );
    } finally {
      setSavingName(false);
    }
  };

  const checked = (id: string): boolean =>
    (id === "account.theme.light" && theme === "light") ||
    (id === "account.theme.dark" && theme === "dark") ||
    (id === "account.motion.calm" && calm) ||
    (id === "account.lang.ru" && lang === "ru") ||
    (id === "account.lang.en" && lang === "en");

  /**
   * Account rows are registry commands like every other menu. Theme and language stay
   * open so the check mark can be compared; every other row closes and does its work.
   */
  const actions: Record<string, () => void> = {
    "account.allRooms": onAllRooms,
    "account.theme.light": () => setTheme("light"),
    "account.theme.dark": () => setTheme("dark"),
    "account.motion.calm": () => setCalm(!calm),
    "account.lang.ru": () => setLang("ru"),
    "account.lang.en": () => setLang("en"),
    "account.help": () => window.location.assign(`/help/${lang}`),
    "help.resetHints": () => resetHints(),
    "account.sessions": onSessions,
    "account.security": () => setSecurityOpen(true),
    "account.org": onOrg,
    "account.support": () => support.launch(),
    "account.cookies": () => openCookieSettings(),
    "account.documents": () =>
      window.location.assign(`${window.location.pathname}?legal=documents`),
    "account.docs": () => {
      // The guide belongs to the installation; without one the row is hidden (ADR-284).
      const href = docsHref(docsOrigin, `/guide/${lang}/overview/index.html`);
      if (href) window.open(href, "_blank", "noopener");
    },
    "account.delete": () => setDeleteOpen(true),
    "account.signOut": onSignOut,
    "account.signIn": onSignIn,
    "header.agent": () => onAgent?.(),
    "header.comments": () => onComments?.(),
    "search.open": () => {
      // The row is gone once the menu closes, so the search opens a frame later, after
      // the menu has handed focus back to the avatar; the dialog then returns it there.
      const trigger = anchor.current?.querySelector<HTMLElement>("button") ?? null;
      window.requestAnimationFrame(() => onSearch?.(trigger));
    },
  };
  const ctx: ChromeContext = {
    can: {
      signedIn,
      support: support.available,
      agents: agentAvailable,
      docs: docsOrigin !== null,
      search: Boolean(onSearch),
    },
    run: (id) => {
      const action = actions[id];
      if (!action) return;
      if (!id.startsWith("account.theme.") && !id.startsWith("account.lang.") && !id.startsWith("account.motion.")) onOpen(false);
      action();
    },
  };
  useChromeSurfaceRegistration("account-menu", ctx);
  const rows = menuCommands(["account", "help"], ctx, { narrow }).filter(
    (command) =>
      (command.id !== "account.support" || support.available) &&
      (withView ||
        (!command.id.startsWith("account.theme.") && !command.id.startsWith("account.lang."))),
  );

  return (
    <span className="topbar-anchor topbar-account" ref={anchor}>
      <button
        type="button"
        className={signedIn ? "account-button peer self" : "account-button"}
        aria-label={signedIn ? `${t("account.menu")}: ${name}` : t("account.menu")}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={signedIn ? t("board.peerYou", { name }) : identityName}
        onClick={() => onOpen(!open)}
      >
        <Avatar
          name={signedIn ? name : identityName}
          background={self?.color ?? color}
          ring={signedIn}
        />
      </button>
      {open && (
        <Popover label={t("account.menu")} width={304} onClose={() => onOpen(false)}>
          {signedIn ? (
            <div className="account-who">
              <strong>{name}</strong>
              <span className="account-role">@{handle}</span>
              {roleLine && <span className="account-role">{roleLine}</span>}
            </div>
          ) : (
            <p className="account-role">{t("auth.loginHint")}</p>
          )}

          {signedIn && emailVerified === false && mailEnabled && (
            <div className="account-field">
              <span className="account-role">{t("mail.verifyTitle")}</span>
              <span className="auth-hint">{t("mail.verifyBody")}</span>
              <Button
                size="compact"
                variant="secondary"
                loading={resendState === "busy"}
                disabled={resendState === "sent" || resendState === "already"}
                onClick={() => void resendVerificationLetter()}
              >
                {t("mail.resend")}
              </Button>
              {resendState === "sent" && <span className="auth-hint">{t("mail.resendSent")}</span>}
              {resendState === "already" && <span className="auth-hint">{t("mail.resendAlready")}</span>}
              {resendState === "rate" && <span className="auth-error">{t("mail.resendRateLimited")}</span>}
              {resendState === "error" && <span className="auth-error">{t("mail.resendFailed")}</span>}
            </div>
          )}

          {signedIn && (
            <div className="account-field account-name-field">
              <Input
                label={t("account.name")}
                hint={t("account.nameHint")}
                value={nameDraft}
                maxLength={80}
                onChange={(event) => setNameDraft(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  void saveName();
                }}
              />
              <Input
                label={t("account.handle")}
                hint={t("account.handleHint")}
                prefix="@"
                value={handleDraft}
                maxLength={32}
                onChange={(event) => setHandleDraft(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  void saveName();
                }}
              />
              <Button
                size="compact"
                variant="primary"
                loading={savingName}
                disabled={
                  !nameDraft.trim() ||
                  !handleDraft.trim() ||
                  (nameDraft.trim() === name && handleDraft.trim().toLowerCase() === handle)
                }
                onClick={() => void saveName()}
              >
                {t("account.save")}
              </Button>
              {nameError && <p className="auth-error">{nameError}</p>}
              {nameSaved && <p className="account-role">{t("account.nameSaved")}</p>}
            </div>
          )}

          {/* A signed-in cursor is named by the account; only a guest names this browser. */}
          {!signedIn && (
            <>
              <Input
                label={t("account.cursorName")}
                value={identityName}
                maxLength={80}
                onChange={(event) => onRenameSelf(event.currentTarget.value)}
              />
              <GuestNameNotice />
            </>
          )}

          <span className="account-sep" role="separator" />
          <div className="account-commands">
            {rows.map((command, index) => {
              const available = command.available(ctx);
              const group = commandGroup(command);
              const previous = index > 0 ? commandGroup(rows[index - 1]!) : group;
              return (
                <span key={command.id} className="account-command-wrap">
                  {index > 0 && group !== previous && <span className="account-sep" role="separator" />}
                  <button
                    type="button"
                    className={
                      command.danger
                        ? "rm-menu-item account-item is-danger"
                        : "rm-menu-item account-item"
                    }
                    data-command={command.id}
                    aria-disabled={available === true ? undefined : true}
                    onClick={available === true ? () => ctx.run(command.id) : undefined}
                  >
                    <span className="rm-menu-icon">
                      {checked(command.id) ? (
                        <Icon name="check" />
                      ) : command.icon ? (
                        <Icon name={command.icon} />
                      ) : null}
                    </span>
                    <span className="rm-menu-label">
                      {t(command.title)}
                      {available !== true && (
                        <span className="rm-menu-hint">{t(available.reason)}</span>
                      )}
                    </span>
                  </button>
                </span>
              );
            })}
          </div>

          <div className="account-about">
            <span className="muted">{aboutLabel(lang, productName)}</span>
          </div>
        </Popover>
      )}
      {support.panel}
      <SecurityDialog open={securityOpen} onClose={() => setSecurityOpen(false)} />
      <AccountDeletionDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onScheduled={(schedule) => {
          onDeleteScheduled?.(schedule);
          // The server ended every session; the screen must stop pretending otherwise.
          onSignOut();
        }}
        onCancelled={() => onDeleteCancelled?.()}
      />
    </span>
  );
}
