import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mncreation | Score Player",
  description: "MusicXMLの楽譜を表示して再生します。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
