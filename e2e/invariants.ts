import type { Page } from "@playwright/test";

/**
 * Layout invariants of an open surface (a panel, a menu, a dialog), checked in the page.
 *
 * They describe what a person must never see, whatever the data: a surface wider than
 * its box, a control pushed outside it, text cut off without an ellipsis, an internal
 * id where a name belongs, text below the caption size, or two controls on top of each
 * other. They are meant to run on rooms full of long and missing names, not on the
 * tidy data of a mockup.
 */
export interface Violation {
  surface: string;
  rule: "overflow" | "outside" | "offscreen" | "clipped" | "internal-id" | "tiny-text" | "overlap";
  detail: string;
}

export const INTERNAL_ID = /\b(?:item|conn|card|frame|sticky|board|user|org)_[a-z0-9]{8,}\b/;

export async function surfaceViolations(page: Page, surface: string, selector: string): Promise<Violation[]> {
  return page.evaluate(
    ({ surface, selector, idSource }) => {
      const idPattern = new RegExp(idSource);
      const out: { surface: string; rule: string; detail: string }[] = [];
      const visible = (el: Element) => {
        const box = el.getBoundingClientRect();
        if (box.width < 1 || box.height < 1) return false;
        const style = getComputedStyle(el);
        return style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) > 0.05;
      };
      const name = (el: Element) => {
        const cls = typeof el.className === "string" && el.className ? `.${el.className.trim().split(/\s+/).slice(0, 2).join(".")}` : "";
        const text = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
        return `${el.tagName.toLowerCase()}${cls}${text ? ` «${text}»` : ""}`;
      };
      const scrollsX = (el: Element) => /auto|scroll/.test(getComputedStyle(el).overflowX);
      const clipsX = (el: Element) => /hidden|clip/.test(getComputedStyle(el).overflowX);
      // What a person can see of an element: its box cut by every ancestor that clips or
      // scrolls, up to the surface. A row scrolled out of a list is not on the screen.
      const seen = (el: Element, root: Element) => {
        let r = el.getBoundingClientRect();
        let left = r.left, top = r.top, right = r.right, bottom = r.bottom;
        for (let a = el.parentElement; a && a !== root.parentElement; a = a.parentElement) {
          const style = getComputedStyle(a);
          if (style.overflowX === "visible" && style.overflowY === "visible") continue;
          const c = a.getBoundingClientRect();
          if (style.overflowY !== "visible") { top = Math.max(top, c.top); bottom = Math.min(bottom, c.bottom); }
          if (style.overflowX !== "visible" && a !== root) { left = Math.max(left, c.left); right = Math.min(right, c.right); }
        }
        r = new DOMRect(left, top, Math.max(0, right - left), Math.max(0, bottom - top));
        return r;
      };
      const ownText = (el: Element) =>
        [...el.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim());

      for (const root of [...document.querySelectorAll(selector)].filter(visible)) {
        const box = root.getBoundingClientRect();
        if (root.scrollWidth > root.clientWidth + 1) {
          out.push({ surface, rule: "overflow", detail: `${name(root)} is ${root.scrollWidth}px wide in ${root.clientWidth}px` });
        }
        if (box.right > window.innerWidth + 1 || box.left < -1) {
          out.push({ surface, rule: "offscreen", detail: `${name(root)} spans ${Math.round(box.left)}…${Math.round(box.right)} of ${window.innerWidth}` });
        }
        const text = (root as HTMLElement).innerText ?? "";
        const id = text.match(idPattern);
        if (id) out.push({ surface, rule: "internal-id", detail: `shows ${id[0]}` });

        const controls: Element[] = [];
        for (const el of root.querySelectorAll("*")) {
          if (!visible(el)) continue;
          const r = el.getBoundingClientRect();
          // Anything that sticks out of the surface on the right, unless a scroller of
          // its own between it and the surface hides it.
          let scroller: Element | null = el.parentElement;
          while (scroller && scroller !== root && !scrollsX(scroller) && !clipsX(scroller)) scroller = scroller.parentElement;
          if ((scroller === root || scroller === null) && r.right > box.right + 1 && r.width > 2) {
            out.push({ surface, rule: "outside", detail: `${name(el)} ends ${Math.round(r.right - box.right)}px past the edge` });
          }
          const style = getComputedStyle(el);
          if (ownText(el) && clipsX(el) && el.scrollWidth > el.clientWidth + 1 && style.textOverflow !== "ellipsis") {
            out.push({ surface, rule: "clipped", detail: `${name(el)} cuts ${el.scrollWidth - el.clientWidth}px of text` });
          }
          // 11 px is the design system's floor (type-kbd, micro); anything smaller is too small.
          if (ownText(el) && Number.parseFloat(style.fontSize) < 11) {
            out.push({ surface, rule: "tiny-text", detail: `${name(el)} at ${style.fontSize}` });
          }
          if (el.matches('button, a[href], input, select, textarea, [role="menuitem"], [role="tab"], [role="option"]')) {
            const v = seen(el, root);
            if (v.width > 2 && v.height > 2) controls.push(el);
          }
        }
        for (let i = 0; i < controls.length; i++) {
          for (let j = i + 1; j < controls.length; j++) {
            const a = controls[i]!;
            const b = controls[j]!;
            if (a.contains(b) || b.contains(a)) continue;
            // A control laid over another on purpose (a tile's menu over its picture) is
            // positioned; two controls that collide in the flow are the defect.
            const placed = (el: Element, other: Element) => {
              for (let x: Element | null = el; x && x !== root && !x.contains(other); x = x.parentElement) {
                if (/absolute|fixed/.test(getComputedStyle(x).position)) return true;
              }
              return false;
            };
            if (placed(a, b) || placed(b, a)) continue;
            const p = seen(a, root);
            const q = seen(b, root);
            const w = Math.min(p.right, q.right) - Math.max(p.left, q.left);
            const h = Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top);
            if (w > 2 && h > 2) out.push({ surface, rule: "overlap", detail: `${name(a)} over ${name(b)} by ${Math.round(w)}×${Math.round(h)}` });
          }
        }
      }
      return out as never;
    },
    { surface, selector, idSource: INTERNAL_ID.source },
  );
}
