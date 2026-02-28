import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "SaaS Anti-Fraude",
    description: "Identificador de fraudes em devoluções",
};

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html lang="pt-BR">
            <body>
                <nav className="p-4 bg-gray-800 text-white flex gap-4">
                    <a href="/" className="font-bold">Home (Placeholder)</a>
                    <a href="/dashboard">Dashboard (Placeholder)</a>
                </nav>
                <main className="p-8">{children}</main>
            </body>
        </html>
    );
}
