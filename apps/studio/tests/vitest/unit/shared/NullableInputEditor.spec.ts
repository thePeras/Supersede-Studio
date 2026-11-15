import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import NullableInputEditor from "@shared/components/tabulator/NullableInputEditor.vue";

function mountEditor(cellValue: unknown, params: Record<string, unknown>) {
  return mount(NullableInputEditor, {
    attachTo: document.body,
    propsData: { cell: { getValue: () => cellValue }, params: { allowEmpty: true, ...params } },
  });
}

async function render(wrapper: any) {
  wrapper.setData({ rendered: true });
  await wrapper.vm.$nextTick();
  await wrapper.vm.$nextTick();
}

describe("NullableInputEditor", () => {
  it("shows the cell value when opened normally", async () => {
    const wrapper = mountEditor("hello", {});
    await render(wrapper);
    expect((wrapper.find("input").element as HTMLInputElement).value).toBe("hello");
    wrapper.destroy();
  });

  it("replaces the cell value with the typed character, caret at the end", async () => {
    const wrapper = mountEditor("hello", { initialValue: "x" });
    await render(wrapper);
    const input = wrapper.find("input").element as HTMLInputElement;
    expect(input.value).toBe("x");
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(1);
    expect(input.selectionEnd).toBe(1);
    wrapper.destroy();
  });

  it("submits the typed value", async () => {
    const wrapper = mountEditor("hello", { initialValue: "x" });
    await render(wrapper);
    await wrapper.find("input").trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("value")).toEqual([["x"]]);
    wrapper.destroy();
  });
});
