import { useEffect, useState } from "react";
import { Avatar, Button, Popover } from "@remo/ui";
import type { Presence } from "@remo/doc";
import { api, type Grant } from "../api";
import { pluralForm, useI18n, type TranslationKey } from "../i18n";
import { useMenuFocus } from "../useMenuFocus";

/**
 * Who is here: up to four faces and a “+N”, one control (ADR-266 §4).
 *
 * The old header showed every face as its own button, then a separate eye with a
 * viewer count, including zero. The faces are a group now: one click opens the list
 * with roles and the people watching by link, and zero is never drawn.
 */
export function PeopleMenu({
  open,
  onOpen,
  peers,
  self,
  boardId,
  role,
  narrow,
  followTarget,
  onToggleFollow,
  myFollowers,
  onFollow,
}: {
  open: boolean;
  onOpen: (value: boolean) => void;
  /** Everyone but me; the group is the people beside my own account. */
  peers: Presence[];
  self: Presence | undefined;
  boardId: string;
  /** My role, the one role the browser already knows. */
  role: string | null;
  /** Below 900 px: two faces, the rest behind “+N”. */
  narrow: boolean;
  followTarget: string | null;
  onToggleFollow: (target: string, label: string) => void;
  myFollowers: number;
  onFollow: () => void;
}) {
  const { t, lang } = useI18n();
  const anchor = useMenuFocus(open, true, ".rm-popover button, .rm-popover a");
  const [grants, setGrants] = useState<Grant[]>([]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    api
      .grants(boardId)
      .then((result) => {
        if (alive) setGrants(result.grants);
      })
      .catch(() => {
        // A viewer may read the room but not its grants: roles stay unnamed, not wrong.
        if (alive) setGrants([]);
      });
    return () => {
      alive = false;
    };
  }, [open, boardId]);

  const total = peers.length + (self ? 1 : 0);
  if (total === 0) return null;

  const max = narrow ? 2 : 4;
  const faces = [...(self ? [self] : []), ...peers].slice(0, max);
  const hidden = total - faces.length;
  const guests = peers.filter((peer) => !peer.self && !peer.accountId).length;
  const roleOf = (accountId: string | null): string | null => {
    if (!accountId) return "guest";
    return grants.find((grant) => grant.subject_type === "user" && grant.subject_id === accountId)?.role ?? null;
  };
  const roleText = (value: string | null) =>
    value ? t(`role.${value}` as TranslationKey) : t("people.roleUnknown");
  const watchingKey: TranslationKey =
    pluralForm(lang, guests) === 0
      ? "people.watchingOne"
      : pluralForm(lang, guests) === 1
        ? "people.watchingFew"
        : "people.watchingMany";

  return (
    <span className="topbar-anchor" ref={anchor}>
      <button
        type="button"
        className="people-trigger presence"
        aria-label={t("people.trigger", { n: total })}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => onOpen(!open)}
      >
        {faces.map((face) => (
          <span
            key={face.sessionKey}
            className={face.self ? "people-face self" : "peer people-face"}
            title={
              face.self
                ? t("board.peerYou", { name: face.label })
                : face.handle
                  ? `${face.label} @${face.handle}`
                  : face.label
            }
          >
            <Avatar name={face.label} background={face.color} />
          </span>
        ))}
        {hidden > 0 && <span className="people-more">+{hidden}</span>}
      </button>
      {open && (
        <Popover title={t("people.title")} width={320} onClose={() => onOpen(false)}>
          <ul className="people-list">
            {self && (
              <li className="people-row">
                <Avatar name={self.label} background={self.color} ring />
                <span className="people-main">
                  <span className="people-name">
                    {self.label}
                    <span className="people-you"> · {t("people.you")}</span>
                  </span>
                  <span className="people-role">{roleText(role)}</span>
                </span>
              </li>
            )}
            {peers.map((peer) => {
              const following = followTarget === peer.sessionKey;
              return (
                <li key={peer.sessionKey} className="people-row">
                  <Avatar name={peer.label} background={peer.color} />
                  <span className="people-main">
                    <span className="people-name">
                      {peer.label}
                      {peer.handle && <span className="people-handle"> @{peer.handle}</span>}
                    </span>
                    <span className="people-role">{roleText(roleOf(peer.accountId))}</span>
                  </span>
                  <Button
                    size="compact"
                    variant={following ? "secondary" : "ghost"}
                    onClick={() => {
                      onToggleFollow(peer.sessionKey, peer.label);
                      onOpen(false);
                    }}
                  >
                    {following ? t("follow.stop") : t("follow.follow", { name: peer.label })}
                  </Button>
                </li>
              );
            })}
          </ul>
          {myFollowers > 0 && (
            <button
              type="button"
              className="rm-menu-item account-item follow-counter"
              onClick={() => {
                onOpen(false);
                onFollow();
              }}
              aria-label={t("follow.counter", { n: myFollowers })}
            >
              {t("people.followers", { n: myFollowers })}
            </button>
          )}
          {guests > 0 && (
            <p className="people-watching">{t(watchingKey, { n: guests })}</p>
          )}
        </Popover>
      )}
    </span>
  );
}
