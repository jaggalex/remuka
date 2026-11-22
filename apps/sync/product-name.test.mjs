import { describe, expect, it, vi } from "vitest";
import { productName, productNameOverride, warnDeprecatedProductName } from "./product-name.mjs";

describe("the installation's own name (ADR-254)", () => {
  it("reads the new variable", () => {
    expect(productNameOverride({ REMO_PRODUCT_NAME: "Acme Boards" })).toBe("Acme Boards");
  });

  it("still reads the deprecated mail variable as a synonym", () => {
    expect(productNameOverride({ REMO_MAIL_PRODUCT_NAME: "acme" })).toBe("acme");
  });

  it("prefers the new variable over the synonym", () => {
    expect(
      productNameOverride({ REMO_PRODUCT_NAME: "Acme Boards", REMO_MAIL_PRODUCT_NAME: "acme" }),
    ).toBe("Acme Boards");
  });

  it("treats a blank new variable as unset and falls back to the synonym", () => {
    expect(productNameOverride({ REMO_PRODUCT_NAME: "   ", REMO_MAIL_PRODUCT_NAME: "acme" })).toBe(
      "acme",
    );
  });

  it("returns null when neither variable is set, so the brand applies", () => {
    expect(productNameOverride({})).toBeNull();
    expect(productNameOverride({ REMO_PRODUCT_NAME: "", REMO_MAIL_PRODUCT_NAME: " " })).toBeNull();
  });

  it("resolves to the brand's English spelling for the service", () => {
    expect(productName({})).toBe("Remuka");
    expect(productName({ REMO_PRODUCT_NAME: "Acme Boards" })).toBe("Acme Boards");
  });

  it("warns once at startup when only the deprecated variable is set", () => {
    const log = vi.fn();
    warnDeprecatedProductName({ REMO_MAIL_PRODUCT_NAME: "acme" }, log);
    expect(log).toHaveBeenCalledTimes(1);
    warnDeprecatedProductName({ REMO_PRODUCT_NAME: "Acme Boards", REMO_MAIL_PRODUCT_NAME: "acme" }, log);
    warnDeprecatedProductName({}, log);
    expect(log).toHaveBeenCalledTimes(1);
  });
});
