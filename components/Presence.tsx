import { AnimatePresence } from 'framer-motion';
import type { ReactNode } from 'react';

/**
 * Обёртка над AnimatePresence: при «уменьшенном движении» выход не анимируется, узел
 * снимается с дерева сразу. Иначе закрытая панель зависит от того, успеет ли «доиграть»
 * анимация — на слабом железе, фоновой вкладке или в тестовом рантайме (где нет кадров)
 * она осталась бы в DOM.
 */
export default function Presence({ reduced, mode, initial, onExitComplete, children }: {
  reduced: boolean;
  mode?: 'sync' | 'wait' | 'popLayout';
  initial?: boolean;
  onExitComplete?: () => void;
  children: ReactNode;
}) {
  if (reduced) return <>{children}</>;
  return <AnimatePresence mode={mode} initial={initial} onExitComplete={onExitComplete}>{children}</AnimatePresence>;
}
