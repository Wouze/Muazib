import ReactMarkdown, { type Components } from 'react-markdown';

const components: Components = {
  p: ({ children }) => <p className="mb-2.5 last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-date-900">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  ul: ({ children }) => <ul className="mb-2.5 last:mb-0 list-disc pl-5 space-y-1 marker:text-saffron-500">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2.5 last:mb-0 list-decimal pl-5 space-y-1 marker:text-saffron-600">{children}</ol>,
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  h1: ({ children }) => <h3 className="font-display text-base font-semibold text-date-900 mb-1.5">{children}</h3>,
  h2: ({ children }) => <h3 className="font-display text-base font-semibold text-date-900 mb-1.5">{children}</h3>,
  h3: ({ children }) => <h4 className="font-semibold text-date-900 mb-1">{children}</h4>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-saffron-700 underline underline-offset-2">
      {children}
    </a>
  ),
  code: ({ children }) => <code className="font-mono text-[0.85em] bg-sand-100 rounded px-1 py-0.5">{children}</code>,
  hr: () => <hr className="my-3 border-sand-200" />,
  blockquote: ({ children }) => <blockquote className="border-l-2 border-sand-300 pl-3 text-date-600 my-2">{children}</blockquote>
};

export default function Markdown({ children }: { children: string }) {
  return <ReactMarkdown components={components}>{children}</ReactMarkdown>;
}
