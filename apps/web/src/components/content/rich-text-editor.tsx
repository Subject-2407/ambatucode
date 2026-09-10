"use client";

import { useEffect, useState } from "react";
import { Box, Flex, IconButton, Separator } from "@chakra-ui/react";
import {
  Bold,
  Code,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Quote,
  Strikethrough,
  SquareCode,
} from "lucide-react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { richTextDocumentSchema, type RichTextDocument } from "@ambatucode/shared";
import { PromptDialog } from "@/components/ui/prompt-dialog";
import { toaster } from "@/components/ui/toaster";
import { sanitizeHref } from "./rich-text";

/**
 * The Material editor.
 *
 * Its toolbar offers exactly what `RichTextView` can render and nothing more.
 * A mark the reader silently drops is worse than a missing button: the
 * Architect sees their emphasis in the editor and the Coder never does. That
 * is also why underline is switched off rather than left to its keyboard
 * shortcut.
 */
export type RichTextEditorProps = {
  value: RichTextDocument;
  onChange: (document: RichTextDocument) => void;
  placeholder?: string;
};

export function RichTextEditor({ value, onChange }: RichTextEditorProps) {
  const editor = useEditor({
    // The document is rendered on the server too; TipTap must not try to
    // hydrate its own markup on top of that.
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        underline: false,
        heading: { levels: [2, 3] },
        link: { openOnClick: false, autolink: false },
      }),
    ],
    content: value,
    onUpdate: ({ editor: instance }) => {
      // Parsed before it leaves the editor, with the same schema the API will
      // apply. A document that fails here is a bug in the extension set, and
      // it is far cheaper to notice now than as a rejected save.
      const parsed = richTextDocumentSchema.safeParse(instance.getJSON());
      if (parsed.success) onChange(parsed.data);
    },
  });

  // Switching to a different Material must replace the buffer; without this the
  // editor keeps showing the document it was first mounted with.
  useEffect(() => {
    if (!editor) return;
    const current = editor.getJSON();
    if (JSON.stringify(current) !== JSON.stringify(value)) {
      editor.commands.setContent(value, { emitUpdate: false });
    }
  }, [editor, value]);

  if (!editor) return <Box height="20rem" />;

  return (
    <Box borderWidth="1px" borderColor="border.default" borderRadius="md" overflow="hidden">
      <Toolbar editor={editor} />
      <Box
        px="4"
        py="3"
        minHeight="18rem"
        maxHeight="32rem"
        overflowY="auto"
        css={{
          "& .tiptap": {
            outline: "none",
            display: "flex",
            flexDirection: "column",
            gap: "0.75rem",
          },
          "& .tiptap h2": { fontSize: "1.25rem", fontWeight: 600 },
          "& .tiptap h3": { fontSize: "1.1rem", fontWeight: 600 },
          "& .tiptap ul, & .tiptap ol": { paddingInlineStart: "1.5rem" },
          "& .tiptap pre": {
            fontFamily: "var(--chakra-fonts-mono)",
            fontSize: "0.85rem",
            background: "var(--chakra-colors-bg-subtle)",
            borderRadius: "0.375rem",
            padding: "0.75rem",
            overflowX: "auto",
          },
          "& .tiptap blockquote": {
            borderInlineStartWidth: "4px",
            borderColor: "var(--chakra-colors-border-default)",
            paddingInlineStart: "1rem",
            color: "var(--chakra-colors-fg-muted)",
          },
        }}
      >
        <EditorContent editor={editor} />
      </Box>
    </Box>
  );
}

type ToolbarAction = {
  key: string;
  label: string;
  icon: React.ReactNode;
  isActive: (editor: Editor) => boolean;
  run: (editor: Editor) => void;
};

const BLOCK_ACTIONS: ToolbarAction[] = [
  {
    key: "bold",
    label: "Bold",
    icon: <Bold size={16} />,
    isActive: (editor) => editor.isActive("bold"),
    run: (editor) => editor.chain().focus().toggleBold().run(),
  },
  {
    key: "italic",
    label: "Italic",
    icon: <Italic size={16} />,
    isActive: (editor) => editor.isActive("italic"),
    run: (editor) => editor.chain().focus().toggleItalic().run(),
  },
  {
    key: "strike",
    label: "Strikethrough",
    icon: <Strikethrough size={16} />,
    isActive: (editor) => editor.isActive("strike"),
    run: (editor) => editor.chain().focus().toggleStrike().run(),
  },
  {
    key: "code",
    label: "Inline code",
    icon: <Code size={16} />,
    isActive: (editor) => editor.isActive("code"),
    run: (editor) => editor.chain().focus().toggleCode().run(),
  },
  {
    key: "h2",
    label: "Heading",
    icon: <Heading2 size={16} />,
    isActive: (editor) => editor.isActive("heading", { level: 2 }),
    run: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    key: "h3",
    label: "Subheading",
    icon: <Heading3 size={16} />,
    isActive: (editor) => editor.isActive("heading", { level: 3 }),
    run: (editor) => editor.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  {
    key: "bulletList",
    label: "Bulleted list",
    icon: <List size={16} />,
    isActive: (editor) => editor.isActive("bulletList"),
    run: (editor) => editor.chain().focus().toggleBulletList().run(),
  },
  {
    key: "orderedList",
    label: "Numbered list",
    icon: <ListOrdered size={16} />,
    isActive: (editor) => editor.isActive("orderedList"),
    run: (editor) => editor.chain().focus().toggleOrderedList().run(),
  },
  {
    key: "codeBlock",
    label: "Code block",
    icon: <SquareCode size={16} />,
    isActive: (editor) => editor.isActive("codeBlock"),
    run: (editor) => editor.chain().focus().toggleCodeBlock().run(),
  },
  {
    key: "blockquote",
    label: "Quote",
    icon: <Quote size={16} />,
    isActive: (editor) => editor.isActive("blockquote"),
    run: (editor) => editor.chain().focus().toggleBlockquote().run(),
  },
  {
    key: "horizontalRule",
    label: "Divider",
    icon: <Minus size={16} />,
    isActive: () => false,
    run: (editor) => editor.chain().focus().setHorizontalRule().run(),
  },
];

function Toolbar({ editor }: { editor: Editor }) {
  const [linkOpen, setLinkOpen] = useState(false);

  // getAttributes is untyped by design — the attribute set depends on the
  // extension — so the href is narrowed rather than trusted.
  const attributes: Record<string, unknown> = editor.getAttributes("link");
  const currentHref = typeof attributes.href === "string" ? attributes.href : "";

  /**
   * The same scheme check the renderer applies, run before the mark is even
   * stored. Rejecting here means an unsafe href never reaches the database,
   * rather than being stored and quietly dropped at read time.
   */
  function setLink(input: string) {
    setLinkOpen(false);

    const href = sanitizeHref(input);
    if (href === null) {
      toaster.error({
        title: "Link not added",
        description: "Only http, https, mailto, and in-app links are allowed.",
      });
      return;
    }
    editor.chain().focus().setLink({ href }).run();
  }

  return (
    <Flex
      wrap="wrap"
      gap="1"
      px="2"
      py="2"
      borderBottomWidth="1px"
      borderColor="border.default"
      bg="bg.subtle"
    >
      {BLOCK_ACTIONS.map((action) => (
        <IconButton
          key={action.key}
          aria-label={action.label}
          title={action.label}
          size="xs"
          variant={action.isActive(editor) ? "subtle" : "ghost"}
          onClick={() => action.run(editor)}
        >
          {action.icon}
        </IconButton>
      ))}
      <Separator orientation="vertical" height="6" alignSelf="center" mx="1" />
      <IconButton
        aria-label="Link"
        title="Link"
        size="xs"
        variant={editor.isActive("link") ? "subtle" : "ghost"}
        onClick={() => setLinkOpen(true)}
      >
        <Link2 size={16} />
      </IconButton>

      {linkOpen ? (
        <PromptDialog
          title="Add link"
          label="URL"
          initialValue={currentHref}
          placeholder="https://example.org"
          helperText="http, https, mailto, or a path inside Ambatucode."
          confirmLabel="Add link"
          onConfirm={setLink}
          onClose={() => setLinkOpen(false)}
        />
      ) : null}
    </Flex>
  );
}
