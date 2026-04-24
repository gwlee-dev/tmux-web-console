import { describe, it, expect } from "vitest";
// @ts-expect-error -- src/tmux.js is native ESM JS, no .d.ts emitted.
import { parseTable, tokenizeInput } from "../../src/tmux.js";

// Control/escape bytes used to build exact input strings matching
// SPECIAL_SEQUENCE_MAP / CONTROL_CHARACTER_MAP in src/tmux.js.
const ESC = "\x1b";
const CTRL_A = "\x01";
const CTRL_B = "\x02";
const CTRL_C = "\x03";
const CTRL_D = "\x04";
const CTRL_E = "\x05";
const CTRL_F = "\x06";
const CTRL_K = "\x0b";
const CTRL_L = "\x0c";
const CTRL_N = "\x0e";
const CTRL_P = "\x10";
const CTRL_U = "\x15";
const CTRL_Z = "\x1a";
const BSPACE = "\x7f";

describe("parseTable", () => {
  it("parses a tab-separated table with the given columns", () => {
    const stdout = "s1\talpha\n" + "s2\tbeta\n" + "s3\tgamma\n";
    const rows = parseTable(stdout, ["id", "name"]);

    expect(rows).toEqual([
      { id: "s1", name: "alpha" },
      { id: "s2", name: "beta" },
      { id: "s3", name: "gamma" },
    ]);
  });

  it("returns an empty array for empty stdout", () => {
    expect(parseTable("", ["id", "name"])).toEqual([]);
  });

  it("returns an empty array for whitespace-only stdout", () => {
    expect(parseTable("\n\n  \n", ["id", "name"])).toEqual([]);
  });

  it("fills missing trailing columns with empty strings", () => {
    const stdout = "s1\talpha\ns2\t\n";
    const rows = parseTable(stdout, ["id", "name", "extra"]);

    expect(rows).toEqual([
      { id: "s1", name: "alpha", extra: "" },
      { id: "s2", name: "", extra: "" },
    ]);
  });

  it("ignores extra fields beyond the declared column count", () => {
    const stdout = "s1\talpha\tignored\tagain\n";
    const rows = parseTable(stdout, ["id", "name"]);

    expect(rows).toEqual([{ id: "s1", name: "alpha" }]);
  });

  it("preserves empty-string fields in the middle of a row", () => {
    const stdout = "s1\t\tgamma\n";
    const rows = parseTable(stdout, ["id", "name", "label"]);

    expect(rows).toEqual([{ id: "s1", name: "", label: "gamma" }]);
  });

  it("handles a fixed list-sessions sample (session_id/name/windows/attached/created)", () => {
    const stdout =
      "$0\twork\t3\t1\t1714000000\n" +
      "$1\tscratch\t1\t0\t1714005000\n";
    const rows = parseTable(stdout, ["id", "name", "windows", "attached", "created"]);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: "$0", name: "work", windows: "3", attached: "1" });
    expect(rows[1]).toMatchObject({ id: "$1", name: "scratch", windows: "1", attached: "0" });
  });

  it("handles a fixed list-windows sample with active flag as string", () => {
    const stdout = "work\t@0\t0\tmain\t1\t1\n" + "work\t@1\t1\tlogs\t0\t2\n";
    const rows = parseTable(stdout, ["sessionName", "id", "index", "name", "active", "panes"]);

    expect(rows).toEqual([
      { sessionName: "work", id: "@0", index: "0", name: "main", active: "1", panes: "1" },
      { sessionName: "work", id: "@1", index: "1", name: "logs", active: "0", panes: "2" },
    ]);
  });

  it("handles a fixed list-panes sample", () => {
    const stdout =
      "work\t@0\t%0\t0\t1\tzsh\tzsh\t/home/gwlee\n" +
      "work\t@0\t%1\t1\t0\tvim\tvim\t/home/gwlee/src\n";
    const rows = parseTable(stdout, [
      "sessionName",
      "windowId",
      "id",
      "index",
      "active",
      "title",
      "currentCommand",
      "currentPath",
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[0].id).toBe("%0");
    expect(rows[1].currentPath).toBe("/home/gwlee/src");
  });

  it("drops fully empty rows (filter(Boolean))", () => {
    const stdout = "s1\talpha\n\ns2\tbeta\n";
    const rows = parseTable(stdout, ["id", "name"]);

    expect(rows).toEqual([
      { id: "s1", name: "alpha" },
      { id: "s2", name: "beta" },
    ]);
  });
});

describe("tokenizeInput", () => {
  it("returns an empty array for empty input", () => {
    expect(tokenizeInput("")).toEqual([]);
  });

  it("tokenizes plain text as a single literal token", () => {
    expect(tokenizeInput("hello")).toEqual([{ type: "literal", value: "hello" }]);
  });

  it("recognises the Up arrow escape sequence", () => {
    expect(tokenizeInput(`${ESC}[A`)).toEqual([{ type: "key", value: "Up" }]);
  });

  it("recognises the Down/Right/Left arrow escape sequences", () => {
    expect(tokenizeInput(`${ESC}[B${ESC}[C${ESC}[D`)).toEqual([
      { type: "key", value: "Down" },
      { type: "key", value: "Right" },
      { type: "key", value: "Left" },
    ]);
  });

  it("recognises Home/End/PageUp/PageDown", () => {
    expect(tokenizeInput(`${ESC}[H${ESC}[F${ESC}[5~${ESC}[6~`)).toEqual([
      { type: "key", value: "Home" },
      { type: "key", value: "End" },
      { type: "key", value: "PageUp" },
      { type: "key", value: "PageDown" },
    ]);
  });

  it("recognises function keys F1-F4", () => {
    expect(tokenizeInput(`${ESC}OP${ESC}OQ${ESC}OR${ESC}OS`)).toEqual([
      { type: "key", value: "F1" },
      { type: "key", value: "F2" },
      { type: "key", value: "F3" },
      { type: "key", value: "F4" },
    ]);
  });

  it("recognises Ctrl+C as the C-c control key", () => {
    expect(tokenizeInput(CTRL_C)).toEqual([{ type: "key", value: "C-c" }]);
  });

  it("recognises Enter for both \\r and \\n", () => {
    expect(tokenizeInput("\r")).toEqual([{ type: "key", value: "Enter" }]);
    expect(tokenizeInput("\n")).toEqual([{ type: "key", value: "Enter" }]);
  });

  it("recognises Tab and Backspace", () => {
    expect(tokenizeInput(`\t${BSPACE}`)).toEqual([
      { type: "key", value: "Tab" },
      { type: "key", value: "BSpace" },
    ]);
  });

  it("emits Escape for a lone ESC", () => {
    expect(tokenizeInput(ESC)).toEqual([{ type: "key", value: "Escape" }]);
  });

  it("tokenizes mixed literals, control keys, and escape sequences in order", () => {
    // "ls" + Enter + Ctrl+C + "echo hi" + Up
    const input = `ls\r${CTRL_C}echo hi${ESC}[A`;
    expect(tokenizeInput(input)).toEqual([
      { type: "literal", value: "ls" },
      { type: "key", value: "Enter" },
      { type: "key", value: "C-c" },
      { type: "literal", value: "echo hi" },
      { type: "key", value: "Up" },
    ]);
  });

  it("flushes the trailing literal buffer", () => {
    expect(tokenizeInput(`${CTRL_C}tail`)).toEqual([
      { type: "key", value: "C-c" },
      { type: "literal", value: "tail" },
    ]);
  });

  it("keeps consecutive special sequences in order", () => {
    expect(tokenizeInput(`${ESC}[A${ESC}[A${ESC}[B`)).toEqual([
      { type: "key", value: "Up" },
      { type: "key", value: "Up" },
      { type: "key", value: "Down" },
    ]);
  });

  it("preserves unicode literals in the literal buffer", () => {
    expect(tokenizeInput("안녕")).toEqual([{ type: "literal", value: "안녕" }]);
  });

  it("recognises the Insert (IC) and Delete (DC) sequences", () => {
    expect(tokenizeInput(`${ESC}[2~${ESC}[3~`)).toEqual([
      { type: "key", value: "IC" },
      { type: "key", value: "DC" },
    ]);
  });

  it("recognises a selection of C-* control characters", () => {
    // C-a C-b C-d C-e C-f C-k C-l C-n C-p C-u C-z
    const input =
      CTRL_A + CTRL_B + CTRL_D + CTRL_E + CTRL_F + CTRL_K + CTRL_L + CTRL_N + CTRL_P + CTRL_U + CTRL_Z;
    expect(tokenizeInput(input)).toEqual([
      { type: "key", value: "C-a" },
      { type: "key", value: "C-b" },
      { type: "key", value: "C-d" },
      { type: "key", value: "C-e" },
      { type: "key", value: "C-f" },
      { type: "key", value: "C-k" },
      { type: "key", value: "C-l" },
      { type: "key", value: "C-n" },
      { type: "key", value: "C-p" },
      { type: "key", value: "C-u" },
      { type: "key", value: "C-z" },
    ]);
  });
});
