import { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import Markdown from './Markdown';
import { FiMessageSquare, FiSend, FiX } from 'react-icons/fi';
import { selectChatMessages, selectChatStatus, sendChatMessage } from '../Redux/slices/chatSlice';
import { cx } from './ui';

/**
 * Question-answering assistant. Rendered as a top-bar button that opens a docked side panel,
 * so it is available everywhere without floating over tables and maps.
 */
export default function ChatPanel() {
  const dispatch = useDispatch();
  const messages = useSelector(selectChatMessages);
  const status = useSelector(selectChatStatus);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const endRef = useRef(null);
  const loading = status === 'loading';

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [messages, loading, open]);

  const send = () => {
    const t = text.trim();
    if (!t || loading) return;
    dispatch(sendChatMessage(t));
    setText('');
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title={open ? 'Close the assistant' : 'Ask questions about the data, matches and conflicts'}
        className={cx(
          'inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs',
          open ? 'border-primary bg-primary-light text-primary-dark' : 'border-line text-subtle hover:bg-hover hover:text-ink',
        )}
      >
        <FiMessageSquare /> <span className="hidden sm:inline">Assistant</span>
      </button>

      {open && (
        <aside
          role="dialog"
          aria-label="Assistant"
          className="fixed bottom-0 right-0 top-12 z-40 flex w-full max-w-sm flex-col border-l border-line bg-white shadow-lg"
        >
          <header className="flex items-center gap-2 border-b border-line bg-canvas px-3 py-2">
            <h2 className="flex-1 text-sm font-semibold">Assistant</h2>
            <button type="button" aria-label="Close" title="Close" onClick={() => setOpen(false)} className="rounded-sm p-1 text-subtle hover:bg-hover hover:text-ink"><FiX /></button>
          </header>
          <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-3">
            {messages.length === 0 && (
              <p className="text-xs text-subtle">Ask about data sources, matches, conflicts or how to resolve them — e.g. “Why is ward 2 blocked?” or “What should I do next?”</p>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                className={cx(
                  'max-w-[90%] rounded-md px-3 py-2 text-sm',
                  m.role === 'user' ? 'self-end whitespace-pre-wrap bg-primary-light text-ink' : 'markdown self-start border border-line-light bg-canvas',
                )}
              >
                {m.role === 'user' ? m.content : <Markdown>{m.content}</Markdown>}
              </div>
            ))}
            {loading && <p className="self-start text-xs text-subtle" aria-label="Assistant is typing">Working…</p>}
            <div ref={endRef} />
          </div>
          <div className="flex items-end gap-2 border-t border-line p-2">
            <textarea
              rows={2}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Ask a question…"
              className="max-h-28 min-h-10 flex-1 resize-none rounded-md border border-line px-2.5 py-1.5 text-sm focus:border-primary focus:shadow-focus focus:outline-none"
            />
            <button
              type="button"
              onClick={send}
              disabled={!text.trim() || loading}
              aria-label="Send"
              title="Send (Enter)"
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-primary text-white hover:bg-primary-hover disabled:opacity-50"
            >
              <FiSend />
            </button>
          </div>
        </aside>
      )}
    </>
  );
}
