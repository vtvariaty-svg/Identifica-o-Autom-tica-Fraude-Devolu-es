import Link from "next/link";

export default function Home() {
    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex flex-col items-center justify-center p-8 text-center">
            <h1 className="text-5xl font-extrabold text-blue-900 tracking-tight mb-4">
                ShieldDev SaaS
            </h1>
            <p className="text-xl text-blue-700 mb-8 max-w-xl">
                A plataforma definitiva para Identificação Automática de Fraude em Devoluções.
            </p>

            <div className="flex gap-4">
                <Link href="/login" className="px-6 py-3 bg-white text-blue-600 font-semibold rounded-lg shadow-md hover:bg-gray-50 transition-colors border border-blue-100">
                    Fazer Login
                </Link>
                <Link href="/signup" className="px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 transition-colors">
                    Criar Conta
                </Link>
            </div>

            <div className="mt-12 text-sm text-gray-500">
                Se você já está conectado: <Link href="/app" className="text-blue-600 font-medium hover:underline">Acessar Painel &rarr;</Link>
            </div>
        </div>
    );
}
