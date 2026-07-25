import { Node, mergeAttributes, nodeInputRule } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import BubbleMenu from '@tiptap/extension-bubble-menu';

// Custom Citation Node
export const Citation = Node.create({
  name: 'citation',
  group: 'inline',
  inline: true,
  selectable: false,
  atom: true,

  addAttributes() {
    return {
      label: {
        default: null,
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span.grounded-citation',
        getAttrs: dom => ({
          label: (dom as HTMLElement).innerText,
        }),
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'grounded-citation text-[var(--primary)] font-bold cursor-help underline decoration-dotted' }), HTMLAttributes.label]
  },

  addInputRules() {
    return [
      nodeInputRule({
        find: /\[Doc: ([^\]]+)\]$/,
        type: this.type,
        getAttributes: (match) => ({ label: `[Doc: ${match[1]}]` }),
      }),
    ]
  },

  renderText({ node }) {
    return node.attrs.label
  },
});

export const defaultExtensions = [
  StarterKit.configure({ link: false }),
  Markdown.configure({}),
  Citation,
  Link.configure({
    openOnClick: false,
    HTMLAttributes: {
      class: 'text-[var(--primary)] underline decoration-[var(--primary)]/30 hover:decoration-[var(--primary)] transition-all cursor-pointer font-medium',
    },
    validate: href => /^https?:\/\//.test(href),
  }),
  Image.configure({
    HTMLAttributes: {
      class: 'rounded-lg max-w-full h-auto mx-auto border border-[var(--border-tertiary)]',
    },
  }),
  BubbleMenu.configure({
    element: null, // Managed by React BubbleMenu component
  }),
];
