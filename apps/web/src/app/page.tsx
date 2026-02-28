export default function Home() {
    return (
        <div className="flex flex-col gap-4">
            <h1 className="text-3xl font-bold">Identificação Automática de Fraude em Devoluções</h1>
            <p>Projeto Base - ETAPA 0 Inicializada com sucesso.</p>

            <div className="p-4 border border-gray-300 rounded">
                <h2 className="text-xl font-semibold mb-2">Testes da API</h2>
                <div className="flex gap-2">
                    <a href="http://localhost:3001/health" target="_blank" className="p-2 bg-blue-500 text-white rounded">Testar /health</a>
                    <a href="http://localhost:3001/db/ping" target="_blank" className="p-2 bg-green-500 text-white rounded">Testar /db/ping</a>
                </div>
            </div>
        </div>
    );
}
