import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** Renders AI-generated markdown (GFM: tables, lists, strikethrough). */
export default function Markdown({ children }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>;
}
