import { useMemo } from "react";
import qrcode from "qrcode-generator";

/**
 * The enrolment QR (`spec/totp.md` §8, `spec/operator-actions.md` §2).
 *
 * The picture is drawn in the browser from the `otpauth://` line the server returned once:
 * no request, no CDN, no change to the CSP. The library is `qrcode-generator` (MIT, no
 * dependencies) and its own SVG output is black on white regardless of the theme, because
 * a scanner reads ink, not a design token. The key below stays on screen as the text
 * alternative for anyone who cannot use the picture.
 *
 * The URI is a secret. It is never logged, never put in a metric and never cached by the
 * service (`Cache-Control: no-store`); this component only renders it.
 */
export function MfaQrCode({ uri, label }: { uri: string; label: string }) {
  const svg = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(uri, "Byte");
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }, [uri]);
  return (
    <div
      className="mfa-qr"
      role="img"
      aria-label={label}
      // The markup is generated from booleans by the library, never from user input.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
