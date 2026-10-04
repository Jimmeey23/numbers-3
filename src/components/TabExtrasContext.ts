import { createContext, type ReactNode } from 'react';

export interface TabExtrasRegistry {
  register: (id: string, content: ReactNode) => () => void;
}

export const TabExtrasContext = createContext<TabExtrasRegistry | null>(null);
