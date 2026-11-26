import { useId, useRef } from "react";
import { Input } from "@remo/ui";
import { useI18n } from "../i18n";

/** Input from the authenticator, including a complete code pasted into any cell. */
export function CodeCells({ value, onChange, error }: {
  value: string; onChange: (value: string) => void; error: string | null;
}) {
  const { t } = useI18n();
  const group = useRef<HTMLFieldSetElement>(null);
  const errorId = useId();
  const cells = value.padEnd(6, " ").split("");
  const focus = (index: number) => group.current?.querySelectorAll("input")[index]?.select();
  const insert = (start: number, input: string) => {
    const digits = input.replace(/\D/g, "");
    if (!digits) {
      cells[start] = " ";
      onChange(cells.join(""));
      return;
    }
    const index = digits.length >= 6 ? 0 : start;
    const added = digits.slice(0, 6 - index).split("");
    cells.splice(index, added.length, ...added);
    onChange(cells.join(""));
    focus(Math.min(5, index + added.length));
  };
  return <fieldset ref={group} className="stepup-cells" aria-describedby={error ? errorId : undefined}>
    <legend>{t("mfa.sixDigits")}</legend>
    <div>{cells.map((digit, index) => <Input key={index}
      aria-label={t("mfa.digit", { n: index + 1 })}
      inputMode="numeric" autoComplete={index === 0 ? "one-time-code" : "off"}
      value={digit.trim()} aria-invalid={Boolean(error)}
      onFocus={event => event.currentTarget.select()}
      onPaste={event => { event.preventDefault(); insert(index, event.clipboardData.getData("text")); }}
      onChange={event => insert(index, event.currentTarget.value)}
      onKeyDown={event => {
        if (event.key === "ArrowLeft" && index > 0) { event.preventDefault(); focus(index - 1); }
        if (event.key === "ArrowRight" && index < 5) { event.preventDefault(); focus(index + 1); }
        if (event.key === "Backspace" && !digit.trim() && index > 0) {
          event.preventDefault(); insert(index - 1, ""); focus(index - 1);
        }
      }} />)}</div>
    {error && <p id={errorId} className="auth-error" role="alert">{error}</p>}
  </fieldset>;
}
