import { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { AnimatePresence, motion } from 'framer-motion';
import Markdown from './Markdown';
import { FiMessageSquare, FiSend, FiX } from 'react-icons/fi';
import { selectChatMessages, selectChatStatus, sendChatMessage } from '../Redux/slices/chatSlice';
import { cx } from './ui';

export default function ChatPanel() {
  const dispatch = useDispatch();
  const messages = useSelector(selectChatMessages);
  const status = useSelector(selectChatStatus);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const endRef = useRef(null);
  const loading = status === 'loading';

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
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
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex max-w-[calc(100vw-32px)] flex-col items-end gap-2">
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
            className="pointer-events-auto flex max-h-[min(520px,70vh)] w-[min(360px,100%)] flex-col overflow-hidden rounded-lg bg-white shadow-lg ring-1 ring-line"
            role="dialog"
            aria-label="AI Field Assistant"
          >
            <header className="bg-primary px-4 py-3 text-sm font-semibold text-white">AI Field Assistant</header>
            <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-3">
              {messages.length === 0 && (
                <p className="text-xs italic text-faint">Ask me about flagged properties, ward statistics, or next steps.</p>
              )}
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={cx(
                    'max-w-[85%] animate-fade-up rounded-2xl px-3 py-2 text-sm',
                    m.role === 'user'
                      ? 'self-end whitespace-pre-wrap rounded-br-sm bg-primary text-white'
                      : 'markdown self-start rounded-bl-sm bg-canvas',
                  )}
                >
                  {m.role === 'user' ? m.content : <Markdown>{m.content}</Markdown>}
                </div>
              ))}
              {loading && (
                <div className="flex gap-1 self-start rounded-2xl rounded-bl-sm bg-canvas px-3 py-3" aria-label="Assistant is typing">
                  {[0, 0.15, 0.3].map((d) => (
                    <span key={d} className="size-1.5 animate-typing rounded-full bg-subtle" style={{ animationDelay: `${d}s` }} />
                  ))}
                </div>
              )}
              <div ref={endRef} />
            </div>
            <div className="flex items-end gap-2 border-t border-line-light p-2">
              <textarea
                rows={1}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Ask a question…"
                className="max-h-28 min-h-10 flex-1 resize-none rounded-md border border-line bg-canvas px-3 py-2 text-sm focus:border-primary focus:shadow-focus focus:outline-none"
              />
              <button
                type="button"
                onClick={send}
                disabled={!text.trim() || loading}
                aria-label="Send"
                className="inline-flex size-10 shrink-0 items-center justify-center rounded-md bg-primary text-white hover:bg-primary-hover disabled:opacity-50"
              >
                <FiSend />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-medium text-white shadow-lg transition hover:bg-primary-hover"
      >
        {open ? <><FiX /> Close Chat</> : <><FiMessageSquare /> AI Assistant</>}
      </button>
    </div>
  );
}
