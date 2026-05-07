import type { Metadata } from 'next';
import { PrivyRoot } from '../components/privy-root';
import './globals.css';

export const metadata: Metadata = {
  title: 'My-Soso Dashboard',
  description: 'Link your chat channels and tune your personal market agent.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <PrivyRoot>{children}</PrivyRoot>
      </body>
    </html>
  );
}
