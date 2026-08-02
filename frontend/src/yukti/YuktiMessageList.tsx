import { useEffect, useRef } from 'react';
import type { YuktiMessage } from '../types/yukti';
import './Yukti.css';

interface YuktiMessageListProps {
  messages: YuktiMessage[];
}

export function YuktiMessageList({ messages }: YuktiMessageListProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [messages.length]);

  return (
    <div className="yukti-message-list" role="log" aria-live="polite" aria-label="Yukti conversation">
      {messages.length === 0 && (
        <p className="yukti-message-list__empty">
          Ask me to open login, open registration, or help fill a registration field.
        </p>
      )}
      {messages.map((message) => (
        <div
          key={message.id}
          className={`yukti-message yukti-message--${message.role}`}
        >
          {message.text}
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}
