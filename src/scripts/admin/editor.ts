import { Editor, Extension, type Range } from "@tiptap/core";
import Highlight from "@tiptap/extension-highlight";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import TextAlign from "@tiptap/extension-text-align";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { Suggestion, type SuggestionProps } from "@tiptap/suggestion";

type MarkdownEditor = Editor & {
  getMarkdown: () => string;
};

type SlashItem = {
  title: string;
  hint: string;
  keywords: string;
  run: (editor: Editor) => void;
};

export type DocsEditorFormatState = {
  block: "paragraph" | "h1" | "h2" | "h3" | "quote" | "code";
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  code: boolean;
  highlight: boolean;
  bulletList: boolean;
  orderedList: boolean;
  taskList: boolean;
  blockquote: boolean;
  codeBlock: boolean;
  align: "left" | "center" | "right" | "justify";
  canUndo: boolean;
  canRedo: boolean;
  selectionText: string;
  words: number;
  characters: number;
};

type DocsEditorOptions = {
  element: HTMLElement;
  initialMarkdown?: string;
  placeholder?: string;
  onUpdate?: (markdown: string) => void;
  onSelectionUpdate?: (state: DocsEditorFormatState) => void;
  onRequestLink?: () => void;
  onRequestImage?: () => void;
};

export type DocsEditorHandle = {
  editor: Editor;
  getMarkdown: () => string;
  setMarkdown: (markdown: string) => void;
  getSelectedText: () => string;
  insertMarkdown: (markdown: string) => void;
  insertText: (text: string) => void;
  insertImage: (src: string, alt?: string) => void;
  setLink: (url: string, text?: string) => void;
  runCommand: (command: string) => void;
  getFormatState: () => DocsEditorFormatState;
  toggleBold: () => void;
  toggleItalic: () => void;
  toggleUnderline: () => void;
  toggleCode: () => void;
  setTextAlign: (align: "left" | "center" | "right" | "justify") => void;
  undo: () => void;
  redo: () => void;
  focus: () => void;
  destroy: () => void;
};

function normalizeUrl(url: string) {
  const trimmed = url.trim();
  if (!trimmed) return "";
  if (/^(https?:\/\/|mailto:|\/)/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function renderSlashMenu(container: HTMLElement, props: SuggestionProps<SlashItem>) {
  const items = props.items;
  container.innerHTML = items.length
    ? items.map((item, index) => `
      <button type="button" data-index="${index}" class="${index === 0 ? "active" : ""}">
        <strong>${item.title}</strong>
        <span>${item.hint}</span>
      </button>
    `).join("")
    : "<p>No blocks found.</p>";
}

function slashCommandExtension(options: Pick<DocsEditorOptions, "onRequestImage" | "onRequestLink">) {
  return Extension.create({
    name: "slashCommands",

    addProseMirrorPlugins() {
      const editor = this.editor;
      const items: SlashItem[] = [
        {
          title: "Paragraph",
          hint: "Plain body text",
          keywords: "paragraph text body",
          run: (activeEditor) => activeEditor.chain().focus().setParagraph().run()
        },
        {
          title: "Heading 1",
          hint: "Page section title",
          keywords: "heading title h1",
          run: (activeEditor) => activeEditor.chain().focus().setHeading({ level: 1 }).run()
        },
        {
          title: "Heading",
          hint: "Large section title",
          keywords: "heading title h2",
          run: (activeEditor) => activeEditor.chain().focus().setHeading({ level: 2 }).run()
        },
        {
          title: "Subheading",
          hint: "Smaller section title",
          keywords: "heading subtitle h3",
          run: (activeEditor) => activeEditor.chain().focus().setHeading({ level: 3 }).run()
        },
        {
          title: "Bullet list",
          hint: "Simple unordered list",
          keywords: "bullet list ul",
          run: (activeEditor) => activeEditor.chain().focus().toggleBulletList().run()
        },
        {
          title: "Numbered list",
          hint: "Ordered steps",
          keywords: "number ordered list ol",
          run: (activeEditor) => activeEditor.chain().focus().toggleOrderedList().run()
        },
        {
          title: "Task list",
          hint: "Checklist with tasks",
          keywords: "todo task checklist checkbox",
          run: (activeEditor) => activeEditor.chain().focus().toggleTaskList().run()
        },
        {
          title: "Quote",
          hint: "Quoted paragraph",
          keywords: "quote blockquote",
          run: (activeEditor) => activeEditor.chain().focus().toggleBlockquote().run()
        },
        {
          title: "Code block",
          hint: "Preformatted code",
          keywords: "code pre",
          run: (activeEditor) => activeEditor.chain().focus().toggleCodeBlock().run()
        },
        {
          title: "Divider",
          hint: "Horizontal rule",
          keywords: "rule divider hr",
          run: (activeEditor) => activeEditor.chain().focus().setHorizontalRule().run()
        },
        {
          title: "Table",
          hint: "3 by 3 content grid",
          keywords: "table grid cells",
          run: (activeEditor) => activeEditor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
        },
        {
          title: "Link",
          hint: "Attach a URL",
          keywords: "link url",
          run: () => options.onRequestLink?.()
        },
        {
          title: "Image",
          hint: "Upload and insert media",
          keywords: "image photo media upload",
          run: () => options.onRequestImage?.()
        }
      ];

      return [
        Suggestion<SlashItem>({
          editor,
          char: "/",
          allowSpaces: true,
          items: ({ query }) => {
            const normalized = query.trim().toLowerCase();
            return normalized
              ? items.filter((item) => `${item.title} ${item.keywords}`.toLowerCase().includes(normalized)).slice(0, 8)
              : items;
          },
          command: ({ editor: activeEditor, range, props }) => {
            activeEditor.chain().focus().deleteRange(range as Range).run();
            props.run(activeEditor);
          },
          render: () => {
            let popup: HTMLElement | null = null;
            let selectedIndex = 0;
            let currentProps: SuggestionProps<SlashItem> | null = null;

            const updatePosition = (props: SuggestionProps<SlashItem>) => {
              if (!popup || !props.clientRect) return;
              const rect = props.clientRect();
              if (!rect) return;
              popup.style.left = `${Math.min(rect.left, window.innerWidth - 280)}px`;
              popup.style.top = `${rect.bottom + 8}px`;
            };

            const update = (props: SuggestionProps<SlashItem>) => {
              if (!popup) return;
              currentProps = props;
              selectedIndex = Math.min(selectedIndex, Math.max(props.items.length - 1, 0));
              renderSlashMenu(popup, props);
              const buttons = Array.from(popup.querySelectorAll("button"));
              buttons.forEach((button, index) => {
                button.classList.toggle("active", index === selectedIndex);
                button.addEventListener("mousedown", (event) => {
                  event.preventDefault();
                  props.command(props.items[index]);
                });
              });
              updatePosition(props);
            };

            return {
              onStart: (props) => {
                selectedIndex = 0;
                popup = document.createElement("div");
                popup.className = "slash-menu tiptap-slash-menu";
                popup.setAttribute("role", "listbox");
                document.body.appendChild(popup);
                update(props);
              },
              onUpdate: (props) => update(props),
              onKeyDown: ({ event }) => {
                const props = currentProps;
                if (!props?.items.length) return false;
                if (event.key === "ArrowDown") {
                  selectedIndex = (selectedIndex + 1) % props.items.length;
                  update(props);
                  return true;
                }
                if (event.key === "ArrowUp") {
                  selectedIndex = (selectedIndex - 1 + props.items.length) % props.items.length;
                  update(props);
                  return true;
                }
                if (event.key === "Enter") {
                  props.command(props.items[selectedIndex]);
                  return true;
                }
                if (event.key === "Escape") {
                  popup?.remove();
                  popup = null;
                  return false;
                }
                return false;
              },
              onExit: () => {
                popup?.remove();
                popup = null;
              }
            };
          }
        })
      ];
    }
  });
}

function getFormatState(editor: Editor): DocsEditorFormatState {
  const text = editor.getText();
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const { from, to } = editor.state.selection;
  const selectionText = editor.state.doc.textBetween(from, to, " ").trim();
  let block: DocsEditorFormatState["block"] = "paragraph";
  if (editor.isActive("heading", { level: 1 })) block = "h1";
  else if (editor.isActive("heading", { level: 2 })) block = "h2";
  else if (editor.isActive("heading", { level: 3 })) block = "h3";
  else if (editor.isActive("blockquote")) block = "quote";
  else if (editor.isActive("codeBlock")) block = "code";
  const align = (["center", "right", "justify"].find((value) => editor.isActive({ textAlign: value })) || "left") as DocsEditorFormatState["align"];

  return {
    block,
    bold: editor.isActive("bold"),
    italic: editor.isActive("italic"),
    underline: editor.isActive("underline"),
    strike: editor.isActive("strike"),
    code: editor.isActive("code"),
    highlight: editor.isActive("highlight"),
    bulletList: editor.isActive("bulletList"),
    orderedList: editor.isActive("orderedList"),
    taskList: editor.isActive("taskList"),
    blockquote: editor.isActive("blockquote"),
    codeBlock: editor.isActive("codeBlock"),
    align,
    canUndo: editor.can().undo(),
    canRedo: editor.can().redo(),
    selectionText,
    words,
    characters: Array.from(text.replace(/\s/g, "")).length
  };
}

export function createDocsEditor(options: DocsEditorOptions): DocsEditorHandle {
  const editor = new Editor({
    element: options.element,
    extensions: [
      StarterKit.configure({
        link: false
      }),
      Link.configure({
        autolink: true,
        defaultProtocol: "https",
        openOnClick: false,
        HTMLAttributes: {
          rel: "noreferrer",
          target: "_blank"
        }
      }),
      Image.configure({
        allowBase64: false,
        HTMLAttributes: {
          loading: "lazy"
        }
      }),
      Placeholder.configure({
        placeholder: options.placeholder || "Start writing. Type / for blocks."
      }),
      Highlight.configure({ multicolor: false }),
      TextAlign.configure({
        types: ["heading", "paragraph"]
      }),
      TaskList,
      TaskItem.configure({
        nested: true
      }),
      Table.configure({
        resizable: true
      }),
      TableRow,
      TableHeader,
      TableCell,
      Markdown.configure({
        markedOptions: {
          gfm: true,
          breaks: false
        }
      }),
      slashCommandExtension(options)
    ],
    content: options.initialMarkdown || "",
    contentType: "markdown",
    editorProps: {
      attributes: {
        class: "tiptap-doc",
        "aria-label": "Post body"
      }
    },
    onUpdate: ({ editor }) => {
      options.onUpdate?.((editor as MarkdownEditor).getMarkdown());
      options.onSelectionUpdate?.(getFormatState(editor));
    },
    onSelectionUpdate: ({ editor }) => {
      options.onSelectionUpdate?.(getFormatState(editor));
    },
    onFocus: ({ editor }) => {
      options.onSelectionUpdate?.(getFormatState(editor));
    }
  });

  const markdownEditor = editor as MarkdownEditor;

  const runCommand = (command: string) => {
    const chain = editor.chain().focus();
    if (command === "h1") chain.toggleHeading({ level: 1 }).run();
    else if (command === "h2") chain.toggleHeading({ level: 2 }).run();
    else if (command === "h3") chain.toggleHeading({ level: 3 }).run();
    else if (command === "ul") chain.toggleBulletList().run();
    else if (command === "ol") chain.toggleOrderedList().run();
    else if (command === "task") chain.toggleTaskList().run();
    else if (command === "quote") chain.toggleBlockquote().run();
    else if (command === "code") chain.toggleCodeBlock().run();
    else if (command === "hr") chain.setHorizontalRule().run();
    else if (command === "table") chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
    else if (command === "add-row") chain.addRowAfter().run();
    else if (command === "add-column") chain.addColumnAfter().run();
    else if (command === "delete-table") chain.deleteTable().run();
    else if (command === "paragraph") chain.setParagraph().run();
    else if (command === "strike") chain.toggleStrike().run();
    else if (command === "highlight") chain.toggleHighlight().run();
    else if (command === "clear") chain.unsetAllMarks().clearNodes().run();
  };

  return {
    editor,
    getMarkdown: () => markdownEditor.getMarkdown().trim(),
    setMarkdown: (markdown: string) => {
      editor.commands.setContent(markdown || "", { contentType: "markdown" });
    },
    getSelectedText: () => {
      const { from, to } = editor.state.selection;
      return editor.state.doc.textBetween(from, to, " ").trim();
    },
    insertMarkdown: (markdown: string) => {
      editor.commands.insertContent(markdown, { contentType: "markdown" });
    },
    insertText: (text: string) => {
      editor.chain().focus().insertContent(text).run();
    },
    insertImage: (src: string, alt = "") => {
      editor.chain().focus().setImage({ src, alt }).run();
    },
    setLink: (url: string, text = "link text") => {
      const href = normalizeUrl(url);
      if (!href) return;
      const selectedText = editor.state.selection.empty ? "" : editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, " ");
      if (selectedText) {
        editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
        return;
      }
      editor.commands.insertContent(`[${text || href}](${href})`, { contentType: "markdown" });
    },
    runCommand,
    getFormatState: () => getFormatState(editor),
    toggleBold: () => editor.chain().focus().toggleBold().run(),
    toggleItalic: () => editor.chain().focus().toggleItalic().run(),
    toggleUnderline: () => editor.chain().focus().toggleUnderline().run(),
    toggleCode: () => editor.chain().focus().toggleCode().run(),
    setTextAlign: (align) => editor.chain().focus().setTextAlign(align).run(),
    undo: () => editor.chain().focus().undo().run(),
    redo: () => editor.chain().focus().redo().run(),
    focus: () => editor.chain().focus().run(),
    destroy: () => editor.destroy()
  };
}
