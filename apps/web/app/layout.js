import "./globals.css";

export const metadata = {
  title: "MCP Arena Prototype",
  description: "Robot script upload + battle simulator for MCP agents",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
