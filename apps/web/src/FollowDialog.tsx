import { FacilitationBody } from "./FacilitationPanel";
import { HintCopy } from "./HintCopy";
import { actedOnHint } from "./hintCatalog";
import { Button, Switch } from "@remo/ui";
import { HelpLink } from "./help/HelpLink";
import { useI18n } from "./i18n";

/**
 * Who is following me, and what I may do about it (ADR-076).
 *
 * The follower count is public on purpose; hiding it is a policy, hiding the *fact* of
 * following from the followed person is not. Follow itself is ephemeral: closing the tab
 * ends it and nothing here is written to the board.
 */
export function FollowDialog({
  open,
  followers,
  peers,
  allowBringEveryone,
  canFacilitate,
  onStopFollowers,
  onBringEveryone,
  onToggleAuto,
}: {
  open: boolean;
  /** Names of the people currently mirroring this person. */
  followers: string[];
  /** How many other people are in the room; a request needs somebody to ask. */
  peers: number;
  allowBringEveryone: boolean;
  canFacilitate: boolean;
  onStopFollowers: () => void;
  onBringEveryone: () => void;
  onToggleAuto: (enabled: boolean) => void;
}) {
  const { t, count } = useI18n();
  if (!open) return null;

  return (
    <FacilitationBody
      title={t("follow.title")}
      description={t("follow.body")}
      help={<HelpLink topicId="facilitation.follow" />}
    >
      <div className="follow-dialog">
        <p className="follow-count">{count("followers", followers.length)}</p>
        {followers.length ? (
          <ul className="follow-names">
            {followers.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        ) : (
          <p className="muted">{t("follow.none")}</p>
        )}

        <div className="follow-actions">
          <Button disabled={followers.length === 0} onClick={onStopFollowers}>
            {t("follow.stopFollowers")}
          </Button>
          <Button variant="primary" disabled={peers === 0} onClick={onBringEveryone}>
            {t("follow.bringEveryone")}
          </Button>
        </div>

        {canFacilitate && (
          <Switch
            className="follow-auto"
              checked={allowBringEveryone}
              onChange={(event) => { actedOnHint("follow.explain"); onToggleAuto(event.target.checked); }}
            label={<>
              {t("follow.auto")}
              <span className="muted"> — <HintCopy slot="follow.explain" text="follow.autoHint" /></span>
            </>}
          />
        )}
      </div>
    </FacilitationBody>
  );
}
