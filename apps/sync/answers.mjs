/**
 * Two-sided sticky notes in the command layer (ADR-320).
 *
 * The model and the document own the text and the frame state; this module owns the
 * command surface: the back-side fields of `board.item.*` and `board.frame.answers`.
 */
import { answersKey, backTextKey } from "@remo/model";
import { displayTextOf } from "@remo/text";
import {
  MARKDOWN_TYPES,
  markdownDelta,
  replaceText,
  replaceTextDelta,
  seedText,
  seedTextDelta,
} from "./command-text.mjs";
import { CommandError } from "./command-error.mjs";

function object(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CommandError("BAD_INPUT", `${name} must be an object`);
  }
  return value;
}

function text(value, name, max = 20_000) {
  if (typeof value !== "string") throw new CommandError("BAD_INPUT", `${name} must be a string`);
  if (value.length > max) throw new CommandError("BAD_INPUT", `${name} is longer than ${max}`);
  return value;
}

function texts(ydoc) {
  return ydoc.getMap("texts");
}

/** Plain text of a shared value, without the tags `Y.XmlText.toString()` adds. */
function sharedPlain(value) {
  if (!value) return "";
  if (typeof value.toDelta === "function") {
    return value
      .toDelta()
      .filter((op) => typeof op.insert === "string")
      .map((op) => op.insert)
      .join("");
  }
  return typeof value.toString === "function" ? value.toString() : "";
}

function hasBackText(ydoc, id) {
  return sharedPlain(texts(ydoc).get(backTextKey(id))).trim().length > 0;
}

/** `board.item.create`: a back side only on a sticky note, one text path only. */
export function validateBackCreate(data) {
  if (data.back !== undefined && data.back !== null) text(data.back, "back");
  if (data.backMarkdown !== undefined) {
    text(data.backMarkdown, "backMarkdown");
    if (data.back !== undefined) {
      throw new CommandError("TEXT_CONFLICT", "send back or backMarkdown, not both");
    }
    if (!MARKDOWN_TYPES.has(data.type)) {
      throw new CommandError("NOT_TEXT", `${data.type} does not hold formatted text`);
    }
  }
  if ((data.back !== undefined || data.backMarkdown !== undefined) && data.type !== "sticky_note") {
    throw new CommandError("NOT_TEXT", "only a sticky_note has a back side");
  }
}

/** The back value a create input asks for; empty means one-sided. */
export function backFromCreateInput(input) {
  if (input.backMarkdown === undefined) return { delta: null, plain: input.back ?? "" };
  const delta = markdownDelta(input.backMarkdown);
  return { delta, plain: displayTextOf(delta) };
}

/** Write the back text of a freshly created sticker in the caller's transaction. */
export function seedBackText(ydoc, widget, back) {
  if (typeof back?.plain !== "string" || !back.plain.trim()) return;
  if (back.delta) seedTextDelta(ydoc, widget, back.delta, backTextKey(widget.id));
  else seedText(ydoc, widget, back.plain, backTextKey(widget.id));
}

/** `board.item.update`: validate the two back paths without knowing the object yet. */
export function validateBackPatch(patch) {
  if (patch.back !== undefined && patch.back !== null) text(patch.back, "back");
  if (patch.backMarkdown !== undefined) {
    text(patch.backMarkdown, "backMarkdown");
    if (patch.back !== undefined) {
      throw new CommandError("TEXT_CONFLICT", "send back or backMarkdown, not both");
    }
  }
}

/**
 * Apply a back patch and strip the input fields from `patch`.
 *
 * Runs inside the caller's transaction, so the widget update and the second text are
 * one Yjs change. `null` and `""` delete the side; `backMarkdown` replaces it.
 */
export function applyBackPatch(ydoc, id, patch, type) {
  const delta = patch.backMarkdown !== undefined ? markdownDelta(patch.backMarkdown) : null;
  const plain = patch.back;
  const action =
    patch.backMarkdown !== undefined
      ? delta && delta.length
        ? "replace"
        : "delete"
      : patch.back === undefined
        ? null
        : patch.back === null || patch.back.trim() === ""
          ? "delete"
          : "replace";
  delete patch.back;
  delete patch.backMarkdown;
  if (!action) return;
  if (type !== "sticky_note") {
    throw new CommandError("NOT_TEXT", "only a sticky_note has a back side");
  }
  const key = backTextKey(id);
  if (action === "delete") texts(ydoc).delete(key);
  else if (delta) replaceTextDelta(ydoc, id, delta, key);
  else replaceText(ydoc, id, plain ?? "", key);
}

function existingFrame(ydoc, id) {
  const widget = ydoc.getMap("widgets").get(id);
  if (!widget) throw new CommandError("OBJECT_NOT_FOUND", `no object ${id}`, 404);
  if (widget.type !== "frame") throw new CommandError("BAD_INPUT", "frameId must name a frame");
  return widget;
}

/** `board.frame.answers`: one frame state, one event, no per-sticker writes. */
export function frameAnswersCommand() {
  return {
    capabilities: ["board.facilitate"],
    validate(input) {
      const data = object(input, "input");
      for (const key of Object.keys(data)) {
        if (!["frameId", "target"].includes(key)) {
          throw new CommandError("BAD_INPUT", `input.${key} is not allowed`);
        }
      }
      text(data.frameId, "frameId", 200);
      if (data.target !== "answers" && data.target !== "questions") {
        throw new CommandError("BAD_INPUT", 'target must be "answers" or "questions"');
      }
      return data;
    },
    apply({ ydoc, input }) {
      existingFrame(ydoc, input.frameId);
      const key = answersKey(input.frameId);
      const store = ydoc.getMap("meta");
      const shown = store.get(key) === "1";
      const next = input.target === "answers";
      const changed = shown !== next;
      let count = 0;
      ydoc.getMap("widgets").forEach((widget, id) => {
        if (widget?.type !== "sticky_note" || widget.parentId !== input.frameId) return;
        if (hasBackText(ydoc, id)) count += 1;
      });
      if (changed) {
        ydoc.transact(() => {
          if (next) store.set(key, "1");
          else store.delete(key);
        });
      }
      return { id: input.frameId, frameId: input.frameId, target: input.target, changed, count };
    },
    events({ result }) {
      if (!result.changed) return [];
      return [
        {
          type: "board.frame.answers",
          subject: result.frameId,
          payload: { target: result.target, count: result.count },
        },
      ];
    },
  };
}
