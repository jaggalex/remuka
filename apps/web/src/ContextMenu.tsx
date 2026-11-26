import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { Icon, IconButton, type IconName } from "@remo/ui";

/** One swatch of a colour grid. */
export interface MenuGridChoice {
  value: string;
  label: string;
}

/** The palette grid a row opens instead of acting (ADR-267 §3). */
export interface MenuGrid {
  title: string;
  caption?: string;
  choices: MenuGridChoice[];
  /** The current value as lower-case hex, or "" when the selection disagrees. */
  current: string;
  pick: (value: string) => void;
  /** A visible row in the main menu stays in sync with edits from other tabs. */
  inline?: { subscribe: (listener: () => void) => () => void; read: () => string };
  /** A named choice under the grid ("Same as the column"). */
  reset?: { label: string; active: boolean; pick: () => void };
}

/** One row of the canvas menu, built from a registry command. */
export interface MenuItem {
  /** The registry id the row runs (ADR-050): a row without one is a defect. */
  commandId?: string;
  label: string;
  visibleLabel?: string;
  icon?: IconName;
  /** The keys, already formatted for display. */
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  action?: () => void;
  grid?: MenuGrid;
  stepper?: MenuStepper;
  pairedWithNext?: boolean;
}

interface MenuStepper {
  subscribe: (listener: () => void) => () => void;
  read: () => number;
  write: (next: number) => void;
  lower: string; higher: string; empty: string; hint: string;
}

function MenuStepControl({ item, control }: { item: MenuItem; control: MenuStepper }) {
  const value = useSyncExternalStore(control.subscribe, control.read);
  // A menu item stays focusable when its step reaches a boundary. Disabling a
  // focused native button would send focus to the page and lose the menu's Escape.
  function step(delta: number) {
    const next = control.read() + delta;
    if (!item.disabled && next >= 0 && next <= 999) control.write(next);
  }
  return <div className="context-menu-stepper" data-command={item.commandId} role="group" aria-label={item.label}>
    <span>{item.label}</span>
    <IconButton role="menuitem" tabIndex={-1} label={control.lower} icon="minus" size="compact" variant="secondary"
      disabled={item.disabled} aria-disabled={item.disabled || value <= 0}
      className={value <= 0 ? "is-disabled" : undefined} onClick={() => step(-1)} />
    <output aria-label={item.label}>{value || control.empty}</output>
    <IconButton role="menuitem" tabIndex={-1} label={control.higher} icon="plus" size="compact" variant="secondary"
      disabled={item.disabled} aria-disabled={item.disabled || value >= 999}
      className={value >= 999 ? "is-disabled" : undefined} onClick={() => step(1)} />
    <small>{control.hint}</small>
  </div>;
}

export interface MenuState {
  /** Client coordinates of the click that opened the menu. */
  x: number;
  y: number;
  /** What was right-clicked: "Sticky note", "3 objects", "Column “Doing”". */
  title: string;
  /** Separated groups in reading order (ADR-267 §3). */
  groups: MenuItem[][];
}

/** Rows that can take focus: disabled ones stay reachable but do nothing. */
const ROWS = '[role="menuitem"], [role="menuitemradio"]';

function focusables(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  return Array.from(container.querySelectorAll<HTMLElement>(ROWS)).filter(row => !row.hasAttribute("disabled"));
}

function move(container: HTMLElement | null, step: number): void {
  const list = focusables(container);
  if (!list.length) return;
  const at = list.indexOf(document.activeElement as HTMLElement);
  const next = at === -1 ? (step > 0 ? 0 : list.length - 1) : (at + step + list.length) % list.length;
  list[next]?.focus();
}

function InlinePalette({ grid, disabled }: { grid: MenuGrid; disabled?: boolean }) {
  const current = useSyncExternalStore(grid.inline!.subscribe, grid.inline!.read);
  return <div className="context-menu-inline-palette" role="group" aria-label={grid.title}
    onKeyDown={event => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      event.stopPropagation();
      move(event.currentTarget, event.key === "ArrowLeft" ? -1 : 1);
    }}>
    <span>{grid.caption ?? grid.title}</span>
    <div className="context-menu-swatch-grid" role="presentation">
      {grid.choices.slice(0, 7).map(choice =>
        <button key={choice.value} type="button" role="menuitemradio" tabIndex={-1}
          disabled={disabled} aria-checked={choice.value === current} aria-label={choice.label}
          title={choice.label} className="context-menu-swatch" style={{background: choice.value}}
          onClick={() => grid.pick(choice.value)} />)}
    </div>
  </div>;
}

/**
 * Canvas context menu.
 *
 * The rows come from `boardMenu.ts`, which builds them from the command registry
 * (ADR-050): this component knows about groups, icons, keys and the colour grid, but not
 * about a single action. The mockup's shape — paper, ink outline, a hard 3 px shadow, a
 * title, grouped rows 36 px high, the dangerous row last — is ADR-267 §3.
 */
export function ContextMenu({ state, onClose }: { state: MenuState | null; onClose: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  /** What held focus before the menu opened; Escape gives it back (T6). */
  const opener = useRef<HTMLElement | null>(null);
  const [placement, setPlacement] = useState<{ left: number; top: number } | null>(null);
  const [openGrid, setOpenGrid] = useState<number | null>(null);
  const [gridPlacement, setGridPlacement] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!state) {
      setPlacement(null);
      setOpenGrid(null);
      setGridPlacement(null);
      return;
    }
    // Captured before the first row takes focus, so Escape can hand focus back to the
    // canvas (or the bar) that was active when the menu opened (T6).
    opener.current = document.activeElement as HTMLElement | null;
    setOpenGrid(null);
    setGridPlacement(null);
    const node = ref.current;
    if (!node) return;
    const margin = 8;
    const { width, height } = node.getBoundingClientRect();
    const maxLeft = Math.max(margin, window.innerWidth - width - margin);
    const maxTop = Math.max(margin, window.innerHeight - height - margin);
    const left = Math.min(Math.max(margin, state.x), maxLeft);
    // Prefer opening downwards from the click; flip above it when there is no room,
    // which is what keeps the first items visible instead of just the last ones.
    const top =
      state.y + height + margin > window.innerHeight
        ? Math.min(Math.max(margin, state.y - height), maxTop)
        : Math.min(Math.max(margin, state.y), maxTop);
    setPlacement({ left, top });
  }, [state]);

  // The menu takes focus when it opens; without it a keyboard user reaches nothing.
  useEffect(() => {
    if (!state || !placement) return;
    focusables(ref.current)[0]?.focus();
  }, [state, placement]);

  // Escape closes the grid first, then the menu; either way focus comes back to where
  // it was before the right click.
  useEffect(() => {
    if (!state) return;
    return () => {
      // A row may have opened something that takes focus itself (the column title
      // editor, a dialog). Only an ordinary close gives focus back to the canvas.
      const active = document.activeElement;
      const insideMenu =
        active == null ||
        active === document.body ||
        ref.current?.contains(active) ||
        gridRef.current?.contains(active);
      if (insideMenu) opener.current?.focus?.();
      opener.current = null;
    };
  }, [state]);

  useEffect(() => {
    if (!state) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (ref.current?.contains(target) || gridRef.current?.contains(target)) return;
      onClose();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, [onClose, state]);

  const closeGrid = useCallback(() => {
    const at = openGrid;
    setOpenGrid(null);
    setGridPlacement(null);
    if (at != null) {
      ref.current?.querySelector<HTMLElement>(`[data-row="${at}"]`)?.focus();
    }
  }, [openGrid]);

  const openGridAt = useCallback((index: number) => {
    setOpenGrid(index);
    setGridPlacement(null);
  }, []);

  // The grid sits beside its row, flipped left when the right edge is close, and never
  // below the viewport: the last swatch must stay clickable (ADR-045).
  useLayoutEffect(() => {
    if (openGrid == null || !gridRef.current) return;
    const row = ref.current?.querySelector<HTMLElement>(`[data-row="${openGrid}"]`);
    if (!row) return;
    const anchor = row.getBoundingClientRect();
    const { width, height } = gridRef.current.getBoundingClientRect();
    const margin = 8;
    let left = anchor.right + 4;
    if (left + width > window.innerWidth - margin) left = anchor.left - width - 4;
    const top = Math.min(Math.max(margin, anchor.top - 6), window.innerHeight - height - margin);
    setGridPlacement({ left: Math.max(margin, left), top });
  }, [openGrid]);

  // Placed and visible: only now can a swatch take focus (a hidden node cannot).
  useEffect(() => {
    if (openGrid == null || !gridPlacement) return;
    focusables(gridRef.current)[0]?.focus();
  }, [openGrid, gridPlacement]);

  if (!state) return null;

  const run = (item: MenuItem, index: number) => {
    if (item.disabled) return;
    if (item.grid) {
      openGridAt(index);
      return;
    }
    item.action?.();
    onClose();
  };

  const onMenuKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      move(ref.current, 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      move(ref.current, -1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusables(ref.current)[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      const list = focusables(ref.current);
      list[list.length - 1]?.focus();
    } else if (event.key === "ArrowRight" || event.key === "Enter" || event.key === " ") {
      const row = (event.target as HTMLElement).closest<HTMLElement>("[data-row]");
      const index = row ? Number(row.dataset.row) : -1;
      const item = index >= 0 ? state.groups.flat()[index] : undefined;
      if (item?.grid && !item.disabled) {
        event.preventDefault();
        openGridAt(index);
      } else if (event.key === "ArrowRight") {
        // Nothing to open to the right: keep the key from scrolling the board.
        event.preventDefault();
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    } else if (event.key === "Tab") {
      // A menu is not a tab stop: leaving it closes it, as every desktop menu does.
      event.preventDefault();
      onClose();
    }
  };

  const onGridKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      move(gridRef.current, event.key === "ArrowDown" ? 7 : 1);
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      move(gridRef.current, event.key === "ArrowUp" ? -7 : -1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeGrid();
    } else if (event.key === "Tab") {
      event.preventDefault();
      onClose();
    }
  };

  const flat = state.groups.flat();
  const indexOf = (item: MenuItem) => flat.indexOf(item);
  const gridItem = openGrid != null ? flat[openGrid] : undefined;
  const renderItem = (item: MenuItem, paired = false) => {
    const index = indexOf(item);
    if (item.stepper) return <MenuStepControl key={item.commandId} item={item} control={item.stepper} />;
    if (item.grid?.inline) return <InlinePalette key={item.commandId} grid={item.grid} disabled={item.disabled} />;
    return (
      <button
        key={`${index}-${item.label}`}
        type="button"
        role="menuitem"
        data-row={index}
        data-command={item.commandId}
        tabIndex={-1}
        className={item.danger ? "context-menu-item danger" : "context-menu-item"}
        aria-label={item.visibleLabel ? item.label : undefined}
        aria-disabled={item.disabled || undefined}
        aria-haspopup={item.grid ? "menu" : undefined}
        aria-expanded={item.grid ? openGrid === index : undefined}
        onClick={() => run(item, index)}
      >
        {!paired && <span className="context-menu-icon" aria-hidden="true">
          {item.icon && <Icon name={item.icon} size={16} />}
        </span>}
        <span className="context-menu-label">{item.visibleLabel ?? item.label}</span>
        {item.shortcut ? (
          <span className="context-menu-key" aria-hidden="true">
            {item.shortcut}
          </span>
        ) : item.grid ? (
          <span className="context-menu-icon" aria-hidden="true">
            <Icon name="chevron-right" size={16} />
          </span>
        ) : null}
      </button>
    );
  };

  return (
    <>
      <div
        ref={ref}
        className="context-menu"
        style={{
          left: (placement ?? { left: state.x, top: state.y }).left,
          top: (placement ?? { left: state.x, top: state.y }).top,
          // Hidden for the one frame before the measurement lands, so the menu never
          // flashes at a position it is about to leave.
          visibility: placement ? undefined : "hidden",
        }}
        role="menu"
        aria-label={state.title}
        onKeyDown={onMenuKey}
      >
        <div className="context-menu-title" role="presentation">
          {state.title}
        </div>
        {state.groups.map((group, groupIndex) => (
          <div className="context-menu-group" key={groupIndex} role="presentation">
            {group.map((item, index) => {
              if (group[index - 1]?.pairedWithNext) return null;
              const next = group[index + 1];
              if (item.pairedWithNext && next) {
                return <div key={index} className="rm-menu-pair" role="presentation">
                  {renderItem(item, true)}
                  <span aria-hidden="true">·</span>
                  {renderItem(next, true)}
                </div>;
              }
              return renderItem(item);
            })}
          </div>
        ))}
      </div>
      {gridItem?.grid && (
        <div
          ref={gridRef}
          className="context-menu context-menu-grid"
          style={{
            left: (gridPlacement ?? { left: 0, top: 0 }).left,
            top: (gridPlacement ?? { left: 0, top: 0 }).top,
            visibility: gridPlacement ? undefined : "hidden",
          }}
          role="menu"
          aria-label={gridItem.grid.title}
          onKeyDown={onGridKey}
        >
          <div className="context-menu-title" role="presentation">
            {gridItem.grid.title}
          </div>
          <div className="context-menu-swatch-grid" role="presentation">
            {gridItem.grid.choices.map((choice) => (
              <button
                key={choice.value}
                type="button"
                role="menuitemradio"
                aria-checked={choice.value.toLowerCase() === gridItem.grid!.current}
                aria-label={choice.label}
                title={choice.label}
                tabIndex={-1}
                className="context-menu-swatch"
                // Data, not a style literal: the colour is the palette value being offered.
                style={{ background: choice.value }}
                onClick={() => {
                  gridItem.grid!.pick(choice.value);
                  onClose();
                }}
              />
            ))}
          </div>
          {gridItem.grid.reset && (
            <button
              type="button"
              role="menuitemradio"
              aria-checked={gridItem.grid.reset.active}
              tabIndex={-1}
              className="context-menu-item context-menu-grid-reset"
              onClick={() => {
                gridItem.grid!.reset!.pick();
                onClose();
              }}
            >
              <span className="context-menu-icon" aria-hidden="true">
                <Icon name="check" size={16} />
              </span>
              <span className="context-menu-label">{gridItem.grid.reset.label}</span>
            </button>
          )}
        </div>
      )}
    </>
  );
}
