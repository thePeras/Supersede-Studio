import { describe, it, expect, vi } from "vitest";
import TableTable from "@/components/tableview/TableTable.vue";

const methods = (TableTable as any).options.methods;

function makeCell() {
  const element = document.createElement("div");
  return {
    getElement: () => element,
    edit: vi.fn(),
  } as any;
}

function makeContext(cell: any, overrides: Record<string, unknown> = {}) {
  return {
    editable: true,
    focusingTable: () => true,
    cellEditCheck: () => true,
    tabulator: {
      modules: {
        edit: { currentCell: null },
        selectRange: { getActiveCell: () => ({ getComponent: () => cell }) },
      },
    },
    ...overrides,
  };
}

function keydown(key: string, init: KeyboardEventInit = {}) {
  return new KeyboardEvent("keydown", { key, cancelable: true, ...init });
}

describe("TableTable.vue — type to edit", () => {
  it("starts editing the active cell and swallows the keystroke", () => {
    const cell = makeCell();
    const e = keydown("a");

    methods.handleTypeToEdit.call(makeContext(cell), e);

    expect(cell.edit).toHaveBeenCalledOnce();
    expect(e.defaultPrevented).toBe(true);
  });

  it("puts the typed character into a textarea editor", () => {
    const cell = makeCell();
    cell.edit.mockImplementation(() => {
      const textarea = document.createElement("textarea");
      textarea.value = "old value";
      cell.getElement().appendChild(textarea);
    });

    methods.handleTypeToEdit.call(makeContext(cell), keydown("x"));

    expect(cell.getElement().querySelector("textarea").value).toBe("x");
  });

  it.each([
    ["modifier shortcuts", keydown("c", { metaKey: true })],
    ["ctrl shortcuts", keydown("c", { ctrlKey: true })],
    ["non-printable keys", keydown("ArrowDown")],
    ["IME composition", keydown("a", { isComposing: true })],
  ])("ignores %s", (_label, e) => {
    const cell = makeCell();
    methods.handleTypeToEdit.call(makeContext(cell), e);
    expect(cell.edit).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });

  it("ignores typing while a cell is already being edited", () => {
    const cell = makeCell();
    const ctx = makeContext(cell);
    ctx.tabulator.modules.edit.currentCell = {};
    methods.handleTypeToEdit.call(ctx, keydown("a"));
    expect(cell.edit).not.toHaveBeenCalled();
  });

  it("ignores read-only cells and read-only tables", () => {
    const cell = makeCell();
    methods.handleTypeToEdit.call(makeContext(cell, { cellEditCheck: () => false }), keydown("a"));
    methods.handleTypeToEdit.call(makeContext(cell, { editable: false }), keydown("a"));
    expect(cell.edit).not.toHaveBeenCalled();
  });
});

describe("TableTable.vue — delete key", () => {
  function makeDeleteContext(selecting: string) {
    const ranges = [{}];
    return {
      editable: true,
      focusingTable: () => true,
      isWholeRowSelection: methods.isWholeRowSelection,
      setRangesNull: vi.fn(),
      addRowsToPendingDeletes: vi.fn(),
      getSelectedRows: () => ["row"],
      tabulator: {
        getRanges: () => ranges,
        modules: { selectRange: { selecting } },
      },
    };
  }

  it("clears selected cells instead of deleting their rows", () => {
    const ctx = makeDeleteContext("cell");
    methods.deleteTableSelection.call(ctx, keydown("Delete"));
    expect(ctx.setRangesNull).toHaveBeenCalledOnce();
    expect(ctx.addRowsToPendingDeletes).not.toHaveBeenCalled();
  });

  it("leaves plain Backspace on cells to the null-selection binding", () => {
    const ctx = makeDeleteContext("cell");
    methods.deleteTableSelection.call(ctx, keydown("Backspace"));
    expect(ctx.setRangesNull).not.toHaveBeenCalled();
    expect(ctx.addRowsToPendingDeletes).not.toHaveBeenCalled();
  });

  it("deletes rows when whole rows are selected", () => {
    const ctx = makeDeleteContext("row");
    methods.deleteTableSelection.call(ctx, keydown("Delete"));
    expect(ctx.addRowsToPendingDeletes).toHaveBeenCalledWith(["row"]);
  });

  it("deletes rows with ctrl/cmd+backspace even on a cell selection", () => {
    const ctx = makeDeleteContext("cell");
    methods.deleteTableSelection.call(ctx, keydown("Backspace", { metaKey: true }));
    expect(ctx.addRowsToPendingDeletes).toHaveBeenCalledWith(["row"]);
  });

  it("deletes rows from the context menu", () => {
    const ctx = makeDeleteContext("cell");
    methods.deleteTableSelection.call(ctx, undefined);
    expect(ctx.addRowsToPendingDeletes).toHaveBeenCalledWith(["row"]);
  });
});
