import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { richTextSchema, safeHttpUrl } from "@/lib/rich-text";
import { editorJsonToRichText } from "@/lib/rich-text-editor";

/** The editor and its DOM tests use the same allowlisted schema and size guard. */
export function createRichTextExtensions(maxLength: number, onLimit: () => void) {
  return [
    StarterKit.configure({
      blockquote: false, bulletList: false, code: false, codeBlock: false,
      heading: false, horizontalRule: false, listItem: false, listKeymap: false,
      orderedList: false, strike: false, trailingNode: false,
      link: {
        openOnClick: false, autolink: false, linkOnPaste: false, markdownLinks: false,
        defaultProtocol: "https", protocols: ["http", "https"],
        isAllowedUri: candidate => safeHttpUrl(candidate) !== null,
        HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
      },
    }),
    Extension.create({
      name: "messageContentLimit",
      addProseMirrorPlugins: () => [new Plugin({
        filterTransaction: transaction => {
          if (!transaction.docChanged) return true;
          const next = editorJsonToRichText(transaction.doc.toJSON());
          const valid = next.body.length <= maxLength && (!next.bodyRich || richTextSchema.safeParse(next.bodyRich).success);
          if (!valid) queueMicrotask(onLimit);
          return valid;
        },
      })],
    }),
  ];
}
