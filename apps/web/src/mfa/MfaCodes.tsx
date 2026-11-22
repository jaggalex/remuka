import { useState } from "react";
import { Button } from "@remo/ui";
import { useI18n } from "../i18n";

/**
 * The ten recovery codes, shown once (`spec/totp.md` §4.4).
 *
 * Copy and download exist because a printout is the point: the codes are the way back in
 * when the phone is gone, and they are never readable from the server again.
 */
export function MfaCodes({ codes }: { codes: readonly string[] }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const text = codes.join("\n");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // A browser that refuses the clipboard still shows the codes to copy by hand.
    }
  };

  const download = () => {
    const blob = new Blob([`${text}\n`], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "two-factor-recovery-codes.txt";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mfa-codes">
      <ol className="mfa-code-list">
        {codes.map((code) => (
          <li key={code}>
            <code>{code}</code>
          </li>
        ))}
      </ol>
      <div className="mfa-actions">
        <Button size="compact" variant="secondary" onClick={() => void copy()}>
          {copied ? t("mfa.copied") : t("mfa.copy")}
        </Button>
        <Button size="compact" variant="secondary" onClick={download}>
          {t("mfa.download")}
        </Button>
      </div>
    </div>
  );
}
