import { afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { createDocsEditor, type DocsEditorHandle } from "../src/scripts/admin/editor";

let activeWindow: Window | null = null;
let activeEditor: DocsEditorHandle | null = null;

function setupEditor(markdown: string) {
  activeWindow = new Window();
  (activeWindow as any).SyntaxError = SyntaxError;
  const { document } = activeWindow;
  (globalThis as any).window = activeWindow;
  (globalThis as any).document = document;
  (globalThis as any).navigator = activeWindow.navigator;
  (globalThis as any).HTMLElement = activeWindow.HTMLElement;
  (globalThis as any).Element = activeWindow.Element;
  (globalThis as any).Node = activeWindow.Node;
  (globalThis as any).ShadowRoot = activeWindow.ShadowRoot;
  (globalThis as any).DOMParser = activeWindow.DOMParser;
  (globalThis as any).getSelection = activeWindow.getSelection.bind(activeWindow);
  (globalThis as any).getComputedStyle = () => ({
    overflow: "visible",
    overflowX: "visible",
    overflowY: "visible",
    getPropertyValue: () => "visible"
  });
  (globalThis as any).requestAnimationFrame = (callback: FrameRequestCallback) => setTimeout(callback, 0);
  (globalThis as any).cancelAnimationFrame = (id: number) => clearTimeout(id);

  const element = document.createElement("div");
  document.body.appendChild(element);
  activeEditor = createDocsEditor({ element: element as unknown as HTMLElement, initialMarkdown: markdown });
  return activeEditor;
}

afterEach(() => {
  activeEditor?.destroy();
  activeEditor = null;
  activeWindow?.close();
  activeWindow = null;
});

describe("Tiptap Markdown editor", () => {
  test("round-trips rich Markdown blocks", () => {
    const markdown = [
      "# Heading one",
      "",
      "Paragraph with **bold**, *italic*, [link](https://example.com), `inline code`, emoji 😀, and 中文内容。",
      "",
      "![Chart](/uploads/chart.png)",
      "",
      "- first",
      "- second",
      "",
      "> quoted text",
      "",
      "```ts",
      "const value = 1;",
      "```"
    ].join("\n");

    const editor = setupEditor(markdown);
    const result = editor.getMarkdown();

    expect(result).toContain("# Heading one");
    expect(result).toContain("**bold**");
    expect(result).toContain("*italic*");
    expect(result).toContain("[link](https://example.com)");
    expect(result).toContain("`inline code`");
    expect(result).toContain("emoji 😀");
    expect(result).toContain("中文内容");
    expect(result).toContain("![Chart](/uploads/chart.png)");
    expect(result).toContain("- first");
    expect(result).toContain("> quoted text");
    expect(result).toContain("```ts");
    expect(result).toContain("const value = 1;");
  });

  test("programmatic link and image insertion serialize as Markdown", () => {
    const editor = setupEditor("Draft body");

    editor.insertMarkdown("\n\n## Inserted heading");
    editor.setLink("example.com", "Example");
    editor.insertImage("/uploads/photo.png", "Photo");

    const result = editor.getMarkdown();
    expect(result).toContain("## Inserted heading");
    expect(result).toContain("[Example](https://example.com)");
    expect(result).toContain("![Photo](/uploads/photo.png)");
  });

  test("docs-style block commands serialize durable Markdown", () => {
    const editor = setupEditor("Checklist item");

    editor.runCommand("task");
    editor.runCommand("table");

    const result = editor.getMarkdown();
    expect(result).toContain("- [ ] Checklist item");
    expect(result).toContain("| --- | --- | --- |");
    expect(editor.getFormatState().words).toBeGreaterThan(0);
  });
});
