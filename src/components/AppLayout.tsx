import type { ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { MobileTopBar } from './MobileTopBar';

export function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden antialiased">
      <Sidebar />
      <MobileTopBar />
      <main className="flex-1 flex flex-col h-full overflow-y-auto pt-14 md:pt-0">
        <div className="p-6 max-w-[1400px] mx-auto w-full @container">
          {children}
        </div>
      </main>
    </div>
  );
}
